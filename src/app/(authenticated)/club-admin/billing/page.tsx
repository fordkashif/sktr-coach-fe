import { useCallback, useEffect, useState, type FormEvent } from "react"
import { PaperPlaneTilt, PencilSimple } from "@phosphor-icons/react"
import {
  Button,
  DataTable,
  EmptyState,
  Fact,
  FactList,
  Field,
  FormActions,
  Input,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  Select,
  SkeletonRows,
  Split,
  Stat,
  StatStrip,
  StatusText,
  Tag,
  Textarea,
  type DataTableColumn,
  type StateTone,
} from "@/components/sk"
import { getPackageById, packageOptions, type PackageDefinition, type PackageId } from "@/lib/billing/package-catalog"
import {
  getClubAdminPackageUpgradeRequests,
  getClubAdminPackageUsage,
  getCurrentClubAdminActivationState,
  insertAuditEvent,
  submitClubAdminPackageUpgradeRequest,
  updateClubAdminBillingContact,
} from "@/lib/data/club-admin/ops-data"
import { useRole } from "@/lib/role-context"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { formatDateTime } from "../ops-format"
import { loadClubTeams, loadClubUsers } from "../state"

const MOCK_BILLING_KEY = "pacelab:billing-profile"
const MOCK_REQUESTS_KEY = "pacelab:package-change-requests"
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Resource = "teams" | "coaches" | "athletes"
type Usage = Record<Resource, number>
type Contact = { name: string; email: string }
type RequestStatus = "pending" | "approved" | "rejected" | "cancelled"
type ChangeRequest = {
  id: string
  currentPackage: string
  requestedPackage: string
  reason: string | null
  status: RequestStatus
  reviewNotes: string | null
  reviewedAt: string | null
  createdAt: string
}

const RESOURCES: Array<{ key: Resource; label: string; one: string }> = [
  { key: "teams", label: "Teams", one: "team" },
  { key: "coaches", label: "Coaches", one: "coach" },
  { key: "athletes", label: "Athletes", one: "athlete" },
]

const STATUS: Record<RequestStatus, { label: string; tone: StateTone }> = {
  pending: { label: "In review", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Declined", tone: "coral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(key))
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  window.localStorage.setItem(tenantStorageKey(key), JSON.stringify(value))
}

function packageLabel(id: string | null | undefined) {
  return getPackageById(id)?.label ?? (id ? id : "Unknown")
}

function limitText(definition: PackageDefinition, resource: Resource) {
  const limit = definition.limits[resource]
  return Number.isFinite(limit) ? limit.toLocaleString() : "No limit"
}

/** The club's package, how much of it is in use, who to contact about billing, and package change requests. */
export default function ClubAdminBillingPage() {
  const isSupabaseMode = getBackendMode() === "supabase"
  const { userEmail } = useRole()

  const [loading, setLoading] = useState(true)
  const [packageId, setPackageId] = useState<PackageId | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [contact, setContact] = useState<Contact | null>(null)
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual" | null>(null)
  const [contactLoadError, setContactLoadError] = useState<string | null>(null)
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [requestsError, setRequestsError] = useState<string | null>(null)

  const [editingContact, setEditingContact] = useState(false)
  const [contactDraft, setContactDraft] = useState<Contact>({ name: "", email: "" })
  const [contactErrors, setContactErrors] = useState<Partial<Record<keyof Contact, string>>>({})
  const [contactSaveError, setContactSaveError] = useState<string | null>(null)
  const [contactAuditError, setContactAuditError] = useState<string | null>(null)
  const [contactSaving, setContactSaving] = useState(false)
  const [contactSaved, setContactSaved] = useState(false)

  const [requestedPackage, setRequestedPackage] = useState<PackageId | "">("")
  const [reason, setReason] = useState("")
  const [requestError, setRequestError] = useState<string | null>(null)
  const [requestSending, setRequestSending] = useState(false)
  const [requestSent, setRequestSent] = useState(false)

  const logMock = async (action: string, target: string, detail: string) => {
    const mockAudit = await import("@/lib/mock-audit")
    mockAudit.logAuditEvent({ actor: "club-admin", action, target, detail })
  }

  const loadRequests = useCallback(async () => {
    const result = await getClubAdminPackageUpgradeRequests()
    if (!result.ok) {
      setRequestsError(result.error.message)
      return
    }
    setRequestsError(null)
    setRequests(result.data)
  }, [])

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false

    void Promise.all([getClubAdminPackageUsage(), getCurrentClubAdminActivationState(), loadRequests()]).then(([usageResult, activationResult]) => {
      if (cancelled) return
      if (usageResult.ok) {
        setUsage(usageResult.data.usage)
        setUsageError(null)
      } else {
        setUsageError(usageResult.error.message)
      }
      if (activationResult.ok) {
        setContact({ name: activationResult.data.billingContactName ?? "", email: activationResult.data.billingContactEmail ?? "" })
        setBillingCycle(activationResult.data.billingCycle)
        setContactLoadError(null)
      } else {
        setContactLoadError(activationResult.error.message)
      }
      setPackageId((usageResult.ok ? usageResult.data.packageId : null) ?? (activationResult.ok ? activationResult.data.requestedPlan : null))
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode, loadRequests])

  useEffect(() => {
    if (isSupabaseMode) return
    let cancelled = false

    void import("@/lib/mock-data").then((mockData) => {
      if (cancelled) return
      const stored = readJson<{ plan?: string; contactName?: string; contactEmail?: string }>(MOCK_BILLING_KEY, {})
      setPackageId(getPackageById(stored.plan)?.id ?? "pro")
      setContact({ name: stored.contactName ?? "Club Admin", email: stored.contactEmail ?? userEmail ?? "clubadmin@pacelab.local" })
      setUsage({
        teams: loadClubTeams().filter((team) => team.status !== "archived").length,
        coaches: loadClubUsers().filter((user) => user.role === "coach" && user.status === "active").length,
        athletes: mockData.mockAthletes.length,
      })
      setRequests(readJson<ChangeRequest[]>(MOCK_REQUESTS_KEY, []))
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode, userEmail])

  const currentPackage = getPackageById(packageId)
  const pendingRequest = requests.find((request) => request.status === "pending") ?? null
  const choices = packageOptions.filter((option) => option.id !== packageId)
  const chosen = getPackageById(requestedPackage)
  const overChosenLimits =
    chosen && usage
      ? RESOURCES.filter((resource) => usage[resource.key] > chosen.limits[resource.key]).map(
          (resource) => `${usage[resource.key]} ${resource.label.toLowerCase()} (limit ${limitText(chosen, resource.key)})`,
        )
      : []
  const atLimit =
    currentPackage && usage ? RESOURCES.filter((resource) => Number.isFinite(currentPackage.limits[resource.key]) && usage[resource.key] >= currentPackage.limits[resource.key]) : []

  const startEditingContact = () => {
    setContactDraft(contact ?? { name: "", email: "" })
    setContactErrors({})
    setContactSaveError(null)
    setContactSaved(false)
    setEditingContact(true)
  }

  const saveContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (contactSaving) return
    const next = { name: contactDraft.name.trim(), email: contactDraft.email.trim().toLowerCase() }
    const errors: Partial<Record<keyof Contact, string>> = {}
    if (!next.name) errors.name = "Enter the name of the person we should contact."
    if (!next.email) errors.email = "Enter their email address."
    else if (!EMAIL.test(next.email)) errors.email = "That does not look like an email address."
    if (Object.keys(errors).length > 0) {
      setContactErrors(errors)
      setContactSaveError(null)
      return
    }

    setContactSaving(true)
    setContactSaveError(null)
    setContactAuditError(null)
    if (isSupabaseMode) {
      const result = await updateClubAdminBillingContact(next)
      if (!result.ok) {
        setContactSaving(false)
        setContactSaveError(
          result.error.code === "NOT_FOUND"
            ? "Changing the billing contact is not switched on for this workspace yet. Message the SKTR team and they will update it for you."
            : `Could not save the billing contact. ${result.error.message}`,
        )
        return
      }
      const auditResult = await insertAuditEvent({ action: "billing_update", target: "billing-contact", detail: next.email })
      if (!auditResult.ok) setContactAuditError(auditResult.error.message)
    } else {
      try {
        writeJson(MOCK_BILLING_KEY, { plan: packageId ?? "pro", contactName: next.name, contactEmail: next.email })
      } catch {
        setContactSaving(false)
        setContactSaveError("Could not save the billing contact on this device.")
        return
      }
      await logMock("billing_update", "billing-contact", next.email)
    }
    setContact(next)
    setContactSaving(false)
    setEditingContact(false)
    setContactSaved(true)
  }

  const sendRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (requestSending || pendingRequest) return
    if (!requestedPackage) {
      setRequestError("Choose the package you want to move to.")
      return
    }

    setRequestSending(true)
    setRequestError(null)
    if (isSupabaseMode) {
      const result = await submitClubAdminPackageUpgradeRequest({ requestedPackage, reason })
      if (!result.ok) {
        setRequestSending(false)
        setRequestError(`Could not send your request. ${result.error.message}`)
        return
      }
      await loadRequests()
    } else {
      const next: ChangeRequest[] = [
        {
          id: `request-${Date.now()}`,
          currentPackage: packageId ?? "pro",
          requestedPackage,
          reason: reason.trim() || null,
          status: "pending",
          reviewNotes: null,
          reviewedAt: null,
          createdAt: new Date().toISOString(),
        },
        ...requests,
      ]
      try {
        writeJson(MOCK_REQUESTS_KEY, next)
      } catch {
        setRequestSending(false)
        setRequestError("Could not save your request on this device.")
        return
      }
      setRequests(next)
      await logMock("package_upgrade_requested", requestedPackage, `Requested package change from ${packageId ?? "pro"} to ${requestedPackage}.`)
    }
    setRequestSending(false)
    setRequestSent(true)
    setRequestedPackage("")
    setReason("")
  }

  const packageColumns: Array<DataTableColumn<PackageDefinition>> = [
    {
      key: "package",
      header: "Package",
      cell: (option) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {option.label}
          {option.id === packageId ? <Tag tone="blue">Your package</Tag> : null}
        </span>
      ),
    },
    ...RESOURCES.map(
      (resource): DataTableColumn<PackageDefinition> => ({ key: resource.key, header: resource.label, align: "right", cell: (option) => limitText(option, resource.key) }),
    ),
  ]

  return (
    <Screen>
      <ScreenHeader
        title="Billing"
        lede={
          loading
            ? "Your package, how much of it the club is using, and who we contact about billing."
            : currentPackage
              ? `Your club is on the ${currentPackage.label} package. Here is how much of it you are using and who we contact about billing.`
              : "How much the club is using and who we contact about billing."
        }
      />

      <Notice>
        Card payments and invoices are not in the app. Nothing is charged from this screen and there are no invoices to download. Package changes are reviewed by the SKTR team before they take effect.
      </Notice>

      {loading ? (
        <Section title="In use">
          <SkeletonRows rows={3} label="Loading billing" />
        </Section>
      ) : (
        <>
          {usageError ? (
            <Notice tone="error">We could not load how much of your package is in use. {usageError}</Notice>
          ) : usage ? (
            <StatStrip aria-label="How much of your package is in use">
              {RESOURCES.map((resource) => {
                const used = usage[resource.key]
                const limit = currentPackage ? currentPackage.limits[resource.key] : null
                if (limit === null) return <Stat key={resource.key} label={resource.label} value={used.toLocaleString()} hint="In use" />
                if (!Number.isFinite(limit)) return <Stat key={resource.key} label={resource.label} value={used.toLocaleString()} hint="No limit" />
                const left = Math.max(limit - used, 0)
                return (
                  <Stat
                    key={resource.key}
                    label={resource.label}
                    value={used.toLocaleString()}
                    of={limit.toLocaleString()}
                    hint={left === 0 ? "At the limit" : `${left.toLocaleString()} more before the limit`}
                  />
                )
              })}
            </StatStrip>
          ) : null}

          {atLimit.length > 0 ? (
            <Notice tone="warning">
              You have reached the limit for {atLimit.map((resource) => resource.label.toLowerCase()).join(" and ")}. Ask for a bigger package below to add more.
            </Notice>
          ) : null}
          {!currentPackage ? (
            <Notice tone="warning">We could not read which package this club is on, so limits are not shown. The SKTR team can confirm it for you.</Notice>
          ) : null}

          <Split
            main={
              <>
                <Section title="Packages" hint={currentPackage ? currentPackage.description : "What each package allows."}>
                  <DataTable caption="What each package allows" columns={packageColumns} rows={packageOptions} rowKey={(option) => option.id} />
                </Section>

                <Section title="Change package" hint="Tell us which package you want. The SKTR team reviews every request and the answer shows in the history.">
                  {requestSent ? (
                    <Notice tone="success" className="mb-4">
                      Request sent. You will see the decision in the history.
                    </Notice>
                  ) : null}
                  {pendingRequest ? (
                    <FactList aria-label="Request in review">
                      <Fact label="Asked to move to">{packageLabel(pendingRequest.requestedPackage)}</Fact>
                      <Fact label="Sent">{formatDateTime(pendingRequest.createdAt)}</Fact>
                      <Fact label="Status">
                        <StatusText tone="amber">With the SKTR team</StatusText>
                      </Fact>
                      <Fact label="What next" stack>
                        You can send another request once this one has an answer.
                      </Fact>
                    </FactList>
                  ) : (
                    <form className="mt-2 flex flex-col gap-4" onSubmit={(event) => void sendRequest(event)} noValidate>
                      <Field label="Package you want" error={requestError} className="sm:max-w-xs">
                        <Select
                          value={requestedPackage}
                          onChange={(event) => {
                            setRequestedPackage(event.target.value as PackageId | "")
                            setRequestError(null)
                            setRequestSent(false)
                          }}
                        >
                          <option value="">Choose a package</option>
                          {choices.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {overChosenLimits.length > 0 && chosen ? (
                        <Notice tone="warning">
                          The club is using more than {chosen.label} allows: {overChosenLimits.join(", ")}. You can still send the request, and the SKTR team will talk it through with you.
                        </Notice>
                      ) : null}
                      <Field label="Why you need the change" optional>
                        <Textarea rows={3} maxLength={500} placeholder="We are adding a second sprint group in January" value={reason} onChange={(event) => setReason(event.target.value)} />
                      </Field>
                      <FormActions className="sm:justify-start">
                        <Button type="submit" variant="primary" disabled={requestSending}>
                          <PaperPlaneTilt className="size-5" weight="bold" aria-hidden />
                          {requestSending ? "Sending..." : "Send request"}
                        </Button>
                      </FormActions>
                    </form>
                  )}
                </Section>
              </>
            }
            side={
              <>
                <Section
                  title="Billing contact"
                  hint="The person the SKTR team gets in touch with about your package."
                  action={
                    contact && !editingContact ? (
                      <Button variant="quiet" size="sm" className="-my-2" onClick={startEditingContact}>
                        <PencilSimple className="size-4" weight="bold" aria-hidden />
                        Edit
                      </Button>
                    ) : null
                  }
                >
                  {contactLoadError ? (
                    <Notice tone="error">We could not load the billing contact. {contactLoadError}</Notice>
                  ) : editingContact ? (
                    <form className="flex flex-col gap-4" onSubmit={(event) => void saveContact(event)} noValidate>
                      <Field label="Billing contact name" error={contactErrors.name}>
                        <Input
                          autoComplete="name"
                          maxLength={80}
                          value={contactDraft.name}
                          onChange={(event) => {
                            setContactDraft((current) => ({ ...current, name: event.target.value }))
                            setContactErrors((current) => ({ ...current, name: undefined }))
                          }}
                        />
                      </Field>
                      <Field label="Billing contact email" error={contactErrors.email}>
                        <Input
                          type="email"
                          autoComplete="email"
                          autoCapitalize="none"
                          maxLength={120}
                          value={contactDraft.email}
                          onChange={(event) => {
                            setContactDraft((current) => ({ ...current, email: event.target.value }))
                            setContactErrors((current) => ({ ...current, email: undefined }))
                          }}
                        />
                      </Field>
                      {contactSaveError ? <Notice tone="error">{contactSaveError}</Notice> : null}
                      <FormActions>
                        <Button variant="quiet" onClick={() => setEditingContact(false)} disabled={contactSaving}>
                          Cancel
                        </Button>
                        <Button type="submit" disabled={contactSaving}>
                          {contactSaving ? "Saving..." : "Save billing contact"}
                        </Button>
                      </FormActions>
                    </form>
                  ) : contact ? (
                    <>
                      {contactSaved ? (
                        <Notice tone="success" className="mb-3">
                          Billing contact saved.
                        </Notice>
                      ) : null}
                      {contactAuditError ? (
                        <Notice tone="warning" className="mb-3">
                          Saved, but we could not add the change to the activity log. {contactAuditError}
                        </Notice>
                      ) : null}
                      <FactList aria-label="Billing contact">
                        <Fact label="Name" empty="Not added yet">
                          {contact.name}
                        </Fact>
                        <Fact label="Email" empty="Not added yet">
                          {contact.email}
                        </Fact>
                        {billingCycle ? <Fact label="Billing cycle chosen at setup">{billingCycle === "annual" ? "Annual" : "Monthly"}</Fact> : null}
                      </FactList>
                    </>
                  ) : null}
                </Section>

                <Section title="Request history" meta={requests.length > 0 ? `${requests.length} ${requests.length === 1 ? "request" : "requests"}` : undefined}>
                  {requestsError ? (
                    <Notice tone="error">We could not load your package requests. {requestsError}</Notice>
                  ) : requests.length === 0 ? (
                    <EmptyState title="No package requests yet" body="When you ask for a different package, the request and the SKTR team's decision are listed here." />
                  ) : (
                    <List aria-label="Package requests">
                      {requests.map((request) => {
                        const status = STATUS[request.status] ?? { label: request.status, tone: "neutral" as const }
                        return (
                          <ListRow key={request.id} className="items-start" trailing={<StatusText tone={status.tone}>{status.label}</StatusText>}>
                            <span className="sk-list-title">
                              {packageLabel(request.currentPackage)} to {packageLabel(request.requestedPackage)}
                            </span>
                            <span className="sk-list-sub mt-0.5">
                              Sent {formatDateTime(request.createdAt)}
                              {request.reviewedAt ? `. Answered ${formatDateTime(request.reviewedAt)}` : ""}
                            </span>
                            {request.reason ? <span className="sk-list-sub mt-1 break-words">Your note: {request.reason}</span> : null}
                            {request.reviewNotes ? <span className="sk-list-sub mt-1 break-words text-sk-ink-2">SKTR team: {request.reviewNotes}</span> : null}
                          </ListRow>
                        )
                      })}
                    </List>
                  )}
                </Section>
              </>
            }
          />
        </>
      )}
    </Screen>
  )
}
