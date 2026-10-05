import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FilterBar,
  FilterChips,
  LinkButton,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  SearchInput,
  Section,
  SkeletonRows,
  Stat,
  StatStrip,
  TableSub,
  Tag,
  type DataTableColumn,
  type TagTone,
} from "@/components/sk"
import { getPackageById, packageOptions, type PackageId } from "@/lib/billing/package-catalog"
import { getPlatformAdminRequestQueue, setTenantRequestLifecycleState, type PlatformAdminRequestRecord } from "@/lib/data/platform-admin/ops-data"
import { formatDateTime, plural } from "@/lib/format/ops-format"
import { tenantLifecycleLabels, type TenantBillingStatus, type TenantLifecycleStatus } from "@/lib/tenant/lifecycle"

type BillingAction = "fail" | "reopen"
type StatusFilter = "all" | TenantBillingStatus
type PackageFilter = "all" | PackageId
type CycleFilter = "all" | "monthly" | "annual" | "none"

const PAGE_SIZE = 50

/** Lifecycle states that mean the request became (or is becoming) a club with a billing record. */
const CLUB_LIFECYCLES: TenantLifecycleStatus[] = ["approved_pending_billing", "billing_failed", "active_onboarding", "active", "suspended"]

const BILLING_STATUS: Record<TenantBillingStatus, { label: string; tone: TagTone; meaning: string }> = {
  pending: {
    label: "Setup not done",
    tone: "yellow",
    meaning: "The club is approved but its admin has not confirmed a billing contact and cycle yet. The club cannot go live until they do.",
  },
  mocked_complete: {
    label: "Setup done",
    tone: "green",
    meaning: "The club admin confirmed a billing contact and a billing cycle. No card was entered and no payment was taken.",
  },
  failed: {
    label: "Marked failed",
    tone: "coral",
    meaning: "Someone on the SKTR team marked billing as failed from this screen. The club admin is sent back to billing setup the next time they open the app.",
  },
  active: {
    label: "Active",
    tone: "green",
    meaning: "Reserved for when a payment provider is connected. Nothing in the app sets this on its own today.",
  },
  past_due: {
    label: "Past due",
    tone: "coral",
    meaning: "Reserved for when a payment provider is connected. Nothing in the app sets this on its own today.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "plain",
    meaning: "Set when you cancel a club from the Clubs screen. Reserved for a payment provider otherwise.",
  },
}

function statusOf(record: PlatformAdminRequestRecord): TenantBillingStatus {
  return record.billingStatus ?? "pending"
}

function packageLabel(id: string | null | undefined) {
  return getPackageById(id)?.label ?? (id ? id : "Unknown")
}

function cycleLabel(cycle: PlatformAdminRequestRecord["billingCycle"]) {
  return cycle === "annual" ? "Annual" : cycle === "monthly" ? "Monthly" : "Not chosen"
}

/** A provider name worth showing. The database default "mock-billing" is a placeholder, not a provider. */
function realProvider(record: PlatformAdminRequestRecord) {
  const provider = record.billingProvider?.trim()
  return provider && provider !== "mock-billing" ? provider : null
}

/** Every club's package, billing setup, cycle and billing contact, exactly as stored. */
export default function PlatformAdminBillingPage() {
  const [records, setRecords] = useState<PlatformAdminRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [packageFilter, setPackageFilter] = useState<PackageFilter>("all")
  const [cycleFilter, setCycleFilter] = useState<CycleFilter>("all")
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [confirm, setConfirm] = useState<{ club: PlatformAdminRequestRecord; action: BillingAction } | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await getPlatformAdminRequestQueue()
    if (!result.ok) {
      setLoadError(result.error.message)
      setLoading(false)
      return
    }
    setRecords(result.data)
    setLoadError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const clubs = useMemo(
    () =>
      records
        .filter((record) => Boolean(record.provisionedTenantId) || (record.lifecycleStatus !== null && CLUB_LIFECYCLES.includes(record.lifecycleStatus)))
        .sort((left, right) => left.organizationName.localeCompare(right.organizationName)),
    [records],
  )

  const summary = useMemo(
    () => ({
      total: clubs.length,
      done: clubs.filter((club) => statusOf(club) === "mocked_complete" || statusOf(club) === "active").length,
      waiting: clubs.filter((club) => statusOf(club) === "pending").length,
      failed: clubs.filter((club) => statusOf(club) === "failed" || statusOf(club) === "past_due").length,
    }),
    [clubs],
  )

  const statusesInUse = useMemo(() => [...new Set(clubs.map(statusOf))], [clubs])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return clubs.filter((club) => {
      if (statusFilter !== "all" && statusOf(club) !== statusFilter) return false
      if (packageFilter !== "all" && club.requestedPlan !== packageFilter) return false
      if (cycleFilter !== "all" && (club.billingCycle ?? "none") !== cycleFilter) return false
      if (!needle) return true
      return [club.organizationName, club.billingContactName ?? "", club.billingContactEmail ?? "", club.requestorEmail, packageLabel(club.requestedPlan)].some((value) =>
        value.toLowerCase().includes(needle),
      )
    })
  }, [clubs, cycleFilter, packageFilter, query, statusFilter])

  const activeFilters = (statusFilter !== "all" ? 1 : 0) + (packageFilter !== "all" ? 1 : 0) + (cycleFilter !== "all" ? 1 : 0)
  const clearFilters = () => {
    setQuery("")
    setStatusFilter("all")
    setPackageFilter("all")
    setCycleFilter("all")
  }

  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [query, statusFilter, packageFilter, cycleFilter])

  const shown = filtered.slice(0, visible)

  const runAction = async () => {
    if (!confirm || busy) return
    const { club, action } = confirm
    setBusy(true)
    setActionError(null)
    setDone(null)
    const result = await setTenantRequestLifecycleState(
      action === "fail"
        ? { requestId: club.id, lifecycleStatus: "billing_failed", billingStatus: "failed" }
        : { requestId: club.id, lifecycleStatus: "approved_pending_billing", billingStatus: "pending" },
    )
    if (!result.ok) {
      setBusy(false)
      setActionError(`Could not save the change. ${result.error.message}`)
      return
    }
    setConfirm(null)
    setDone(
      action === "fail"
        ? `Billing for ${club.organizationName} is marked failed. Their admin will be asked to redo billing setup.`
        : `Billing setup is open again for ${club.organizationName}. Their admin can complete it the next time they sign in.`,
    )
    await load()
    setBusy(false)
  }

  const columns: Array<DataTableColumn<PlatformAdminRequestRecord>> = [
    {
      key: "club",
      header: "Club",
      cell: (club) => (
        <>
          <span className="break-words">{club.organizationName}</span>
          <TableSub>{club.lifecycleStatus ? (tenantLifecycleLabels[club.lifecycleStatus] ?? club.lifecycleStatus) : "Status not set"}</TableSub>
        </>
      ),
    },
    { key: "package", header: "Package", cell: (club) => packageLabel(club.requestedPlan) },
    {
      key: "status",
      header: "Billing status",
      phone: "trailing",
      cell: (club) => {
        const status = statusOf(club)
        const info = BILLING_STATUS[status]
        const provider = realProvider(club)
        return (
          <span className="inline-flex flex-col items-start gap-1 max-sm:items-end">
            <Tag tone={info?.tone ?? "plain"}>{info?.label ?? status}</Tag>
            {club.billingFailedAt && (status === "failed" || club.lifecycleStatus === "billing_failed") ? <span className="text-sm text-sk-mute">{formatDateTime(club.billingFailedAt)}</span> : null}
            {provider ? <span className="text-sm text-sk-mute">Provider: {provider}</span> : null}
          </span>
        )
      },
    },
    { key: "cycle", header: "Cycle", cell: (club) => (club.billingCycle ? cycleLabel(club.billingCycle) : <span className="text-sk-mute">Not chosen</span>) },
    {
      key: "contact",
      header: "Billing contact",
      phone: "plain",
      cell: (club) =>
        club.billingContactName?.trim() || club.billingContactEmail ? (
          <span className="min-w-0">
            <span className="block break-words text-sk-ink">{club.billingContactName?.trim() || "No name"}</span>
            {club.billingContactEmail ? (
              <a href={`mailto:${club.billingContactEmail}`} className="sk-link block break-all text-sm font-semibold">
                {club.billingContactEmail}
              </a>
            ) : (
              <span className="block text-sm text-sk-mute">No email</span>
            )}
          </span>
        ) : (
          <span className="text-sk-mute">Not added yet</span>
        ),
    },
    { key: "setup", header: "Setup done on", cell: (club) => (club.billingStartedAt ? formatDateTime(club.billingStartedAt) : <span className="text-sk-mute">Not yet</span>) },
    {
      key: "action",
      header: "Action",
      align: "right",
      phone: "plain",
      cell: (club) => {
        const canFail = club.lifecycleStatus === "approved_pending_billing" || club.lifecycleStatus === "active_onboarding" || club.lifecycleStatus === "active"
        const canReopen = club.lifecycleStatus === "billing_failed"
        if (!canFail && !canReopen) return null
        return (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setActionError(null)
              setConfirm({ club, action: canFail ? "fail" : "reopen" })
            }}
          >
            {canFail ? "Mark failed" : "Reopen setup"}
          </Button>
        )
      },
    },
  ]

  return (
    <Screen>
      <ScreenHeader title="Club billing" lede="Every club's package, billing setup, cycle and billing contact, exactly as stored." />

      {loadError ? (
        <Notice tone="error">
          {records.length === 0 ? "We could not load club billing. " : ""}
          {loadError}
        </Notice>
      ) : null}

      <Notice>
        Payments are not collected in the app. No payment provider is connected, so there are no charges, invoices or revenue figures, and packages have no prices on record. The billing status only says
        whether a club finished the billing setup step, or whether you marked it failed by hand.
      </Notice>

      {done ? <Notice tone="success">{done}</Notice> : null}

      {loading ? (
        <Section title="Clubs">
          <SkeletonRows rows={5} label="Loading club billing" />
        </Section>
      ) : clubs.length === 0 ? (
        loadError ? null : (
          <Section>
            <EmptyState
              title="No clubs to bill yet"
              body="A club appears here once you approve its request. You will see its package, whether billing setup is done, and who to contact."
              action={
                <LinkButton to="/platform-admin/requests" size="sm">
                  Open club requests
                </LinkButton>
              }
            />
          </Section>
        )
      ) : (
        <>
          <StatStrip aria-label="Billing setup across clubs">
            <Stat label="Clubs" value={summary.total.toLocaleString()} hint="Approved or live" />
            <Stat label="Setup done" value={summary.done.toLocaleString()} hint="Contact and cycle confirmed" />
            <Stat label="Setup not done" value={summary.waiting.toLocaleString()} hint="Waiting on the club admin" />
            <Stat label="Marked failed" value={summary.failed.toLocaleString()} hint="Sent back to billing setup" />
          </StatStrip>

          <Section title="Billing by club" meta={`${filtered.length} of ${plural(clubs.length, "club")}`} aria-label="Billing by club">
            <FilterBar
              className="mb-2 mt-2"
              search={<SearchInput aria-label="Search clubs" placeholder="Club or billing contact" value={query} onChange={(event) => setQuery(event.target.value)} />}
              activeCount={activeFilters}
              onClear={clearFilters}
            >
              <FilterChips<StatusFilter>
                label="Billing status"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[{ value: "all", label: "All" }, ...statusesInUse.map((status) => ({ value: status, label: BILLING_STATUS[status]?.label ?? status }))]}
              />
              <FilterChips<PackageFilter>
                label="Package"
                value={packageFilter}
                onChange={setPackageFilter}
                options={[{ value: "all", label: "All" }, ...packageOptions.map((option) => ({ value: option.id, label: option.label }))]}
              />
              <FilterChips<CycleFilter>
                label="Cycle"
                value={cycleFilter}
                onChange={setCycleFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "monthly", label: "Monthly" },
                  { value: "annual", label: "Annual" },
                  { value: "none", label: "Not chosen" },
                ]}
              />
            </FilterBar>

            {filtered.length === 0 ? (
              <EmptyState
                title="No clubs match these filters"
                body={`There are ${plural(clubs.length, "club")}, but none fit the current search and filters.`}
                action={
                  <Button size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <>
                <DataTable caption={`Billing state for each club${activeFilters > 0 || query.trim() ? ", filtered" : ""}`} columns={columns} rows={shown} rowKey={(club) => club.id} rowProps={(club) => ({ "data-club": club.organizationName })} />
                {filtered.length > shown.length ? (
                  <Button className="mt-3 self-start" onClick={() => setVisible((current) => current + PAGE_SIZE)}>
                    Load {Math.min(PAGE_SIZE, filtered.length - shown.length)} more
                  </Button>
                ) : null}
              </>
            )}
          </Section>

          <Section
            title="What each billing status means"
            hint="These are stored labels, not payment results."
            action={
              <Link to="/platform-admin/commercial" className="sk-link">
                Package requests
              </Link>
            }
          >
            <List aria-label="Billing statuses">
              {(Object.keys(BILLING_STATUS) as TenantBillingStatus[]).map((status) => (
                <ListRow key={status} title={BILLING_STATUS[status].label} subtitle={BILLING_STATUS[status].meaning} />
              ))}
            </List>
          </Section>
        </>
      )}

      <Dialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null)
        }}
        title={confirm ? (confirm.action === "fail" ? `Mark billing as failed for ${confirm.club.organizationName}?` : `Reopen billing setup for ${confirm.club.organizationName}?`) : "Confirm"}
        description={
          confirm?.action === "fail"
            ? "The club is locked out of the app until its admin completes billing setup again. No payment is involved. The change is written to Platform activity."
            : "The status goes back to setup not done, and the club admin can complete billing setup the next time they sign in. The change is written to Platform activity."
        }
        footer={
          <>
            <Button variant="quiet" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant={confirm?.action === "fail" ? "danger" : "primary"} disabled={busy} onClick={() => void runAction()}>
              {busy ? "Saving..." : confirm?.action === "fail" ? "Yes, mark failed" : "Yes, reopen setup"}
            </Button>
          </>
        }
      >
        {actionError ? <Notice tone="error">{actionError}</Notice> : null}
      </Dialog>
    </Screen>
  )
}
