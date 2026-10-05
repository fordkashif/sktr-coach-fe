import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  Button,
  DataTable,
  EmptyState,
  Fact,
  FactList,
  Field,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  Sheet,
  SkeletonRows,
  StatusText,
  SubSection,
  SubSections,
  TableSub,
  Tag,
  Textarea,
  type DataTableColumn,
  type TagTone,
} from "@/components/sk"
import { getPackageById, type PackageDefinition } from "@/lib/billing/package-catalog"
import {
  getPlatformAdminPackageUpgradeRequests,
  getPlatformAdminRequestQueue,
  getPlatformTenantSizes,
  reviewTenantPackageUpgradeRequest,
  type PlatformAdminPackageUpgradeRequestRecord,
  type PlatformAdminRequestRecord,
  type PlatformTenantSize,
} from "@/lib/data/platform-admin/ops-data"
import { formatDateTime, plural } from "@/lib/format/ops-format"

type Resource = "teams" | "coaches" | "athletes"
type Decision = "approved" | "rejected"
type UpgradeRequest = PlatformAdminPackageUpgradeRequestRecord
type LimitRow = { key: Resource; label: string; inUse: number | null; from: string; to: string }

const RESOURCES: Array<{ key: Resource; label: string }> = [
  { key: "teams", label: "Teams" },
  { key: "coaches", label: "Coaches" },
  { key: "athletes", label: "Athletes" },
]

const STATUS: Record<UpgradeRequest["status"], { label: string; tone: TagTone }> = {
  pending: { label: "Waiting", tone: "yellow" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Declined", tone: "coral" },
  cancelled: { label: "Cancelled", tone: "plain" },
}

const HISTORY_PAGE = 20

function packageLabel(id: string | null | undefined) {
  return getPackageById(id)?.label ?? (id ? id : "Unknown")
}

function limitText(definition: PackageDefinition | null, resource: Resource) {
  if (!definition) return "Unknown"
  const limit = definition.limits[resource]
  return Number.isFinite(limit) ? limit.toLocaleString() : "No limit"
}

/** Package change requests from clubs: the ones waiting for a decision, and the ones already decided. */
export default function PlatformAdminCommercialPage() {
  const [upgradeRequests, setUpgradeRequests] = useState<UpgradeRequest[]>([])
  const [clubs, setClubs] = useState<PlatformAdminRequestRecord[]>([])
  /** Live club sizes by tenant id. Null when they cannot be read, and sign-up estimates are shown instead. */
  const [sizes, setSizes] = useState<Map<string, PlatformTenantSize> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clubsError, setClubsError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [confirm, setConfirm] = useState<Decision | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [historyVisible, setHistoryVisible] = useState(HISTORY_PAGE)

  const load = useCallback(async () => {
    const [upgradeResult, clubResult, sizesResult] = await Promise.all([getPlatformAdminPackageUpgradeRequests(), getPlatformAdminRequestQueue(), getPlatformTenantSizes()])
    setSizes(sizesResult)
    if (clubResult.ok) {
      setClubs(clubResult.data)
      setClubsError(null)
    } else {
      setClubsError(clubResult.error.message)
    }
    if (upgradeResult.ok) {
      setUpgradeRequests(upgradeResult.data)
      setLoadError(null)
    } else {
      setLoadError(upgradeResult.error.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** The club's own record (newest first), which holds its real name, package in force and billing contact. */
  const clubByTenant = useMemo(() => {
    const map = new Map<string, PlatformAdminRequestRecord>()
    for (const club of clubs) {
      if (club.provisionedTenantId && !map.has(club.provisionedTenantId)) map.set(club.provisionedTenantId, club)
    }
    return map
  }, [clubs])

  const clubName = (request: UpgradeRequest) => clubByTenant.get(request.tenantId)?.organizationName ?? request.organizationName

  const pending = upgradeRequests.filter((request) => request.status === "pending")
  const decided = upgradeRequests
    .filter((request) => request.status !== "pending")
    .sort((left, right) => (right.reviewedAt ?? right.createdAt).localeCompare(left.reviewedAt ?? left.createdAt))
  const open = openId ? (pending.find((request) => request.id === openId) ?? null) : null

  const openRequest = (request: UpgradeRequest) => {
    setDone(null)
    setNote("")
    setConfirm(null)
    setReviewError(null)
    setNoteError(null)
    setOpenId(request.id)
  }

  const closeRequest = () => {
    if (busy) return
    setOpenId(null)
    setConfirm(null)
  }

  const pick = (decision: Decision) => {
    if (decision === "rejected" && !note.trim()) {
      setConfirm(null)
      setNoteError("Write a note before you decline. The club sees it on their billing screen.")
      return
    }
    setNoteError(null)
    setReviewError(null)
    setConfirm(decision)
  }

  const decide = async (request: UpgradeRequest, decision: Decision) => {
    if (busy) return
    const reviewNotes = note.trim()
    if (decision === "rejected" && !reviewNotes) return
    setBusy(true)
    setReviewError(null)
    const result = await reviewTenantPackageUpgradeRequest({ upgradeRequestId: request.id, status: decision, reviewNotes })
    if (!result.ok) {
      setBusy(false)
      setReviewError(`Could not save your decision. ${result.error.message}`)
      return
    }
    const name = clubName(request)
    setDone(
      decision === "approved"
        ? `${name} is now on ${packageLabel(request.requestedPackage)}. The new limits apply straight away.`
        : `Declined the request from ${name}. They will see your note on their billing screen.`,
    )
    setOpenId(null)
    setConfirm(null)
    setNote("")
    await load()
    setBusy(false)
  }

  const decidedColumns: Array<DataTableColumn<UpgradeRequest>> = [
    {
      key: "club",
      header: "Club",
      cell: (request) => (
        <>
          <span className="break-words">{clubName(request)}</span>
          <TableSub>
            {packageLabel(request.currentPackage)} to {packageLabel(request.requestedPackage)}
          </TableSub>
        </>
      ),
    },
    { key: "asked", header: "Asked", cell: (request) => formatDateTime(request.createdAt) },
    { key: "decided", header: "Decided", cell: (request) => (request.reviewedAt ? formatDateTime(request.reviewedAt) : <span className="text-sk-mute">Not recorded</span>) },
    { key: "reason", header: "Their reason", className: "max-w-[16rem]", cell: (request) => request.reason ?? <span className="text-sk-mute">None given</span> },
    { key: "note", header: "Your note", className: "max-w-[16rem]", cell: (request) => request.reviewNotes ?? <span className="text-sk-mute">No note was sent</span> },
    { key: "status", header: "Status", phone: "trailing", cell: (request) => <Tag tone={STATUS[request.status]?.tone ?? "plain"}>{STATUS[request.status]?.label ?? request.status}</Tag> },
  ]

  const review = (request: UpgradeRequest) => {
    const club = clubByTenant.get(request.tenantId) ?? null
    const usage = sizes?.get(request.tenantId) ?? null
    const fromPackage = getPackageById(request.currentPackage)
    const toPackage = getPackageById(request.requestedPackage)
    const packageNow = club?.requestedPlan ?? null
    const stale = packageNow !== null && packageNow !== request.currentPackage
    const limitRows: LimitRow[] = RESOURCES.map((resource) => ({
      key: resource.key,
      label: resource.label,
      inUse: usage ? usage[resource.key] : null,
      from: limitText(fromPackage, resource.key),
      to: limitText(toPackage, resource.key),
    }))
    const limitColumns: Array<DataTableColumn<LimitRow>> = [
      { key: "limit", header: "Limit", cell: (row) => row.label },
      ...(usage ? [{ key: "use", header: "In use now", align: "right" as const, cell: (row: LimitRow) => (row.inUse ?? 0).toLocaleString() }] : []),
      { key: "from", header: packageLabel(request.currentPackage), align: "right", cell: (row) => row.from },
      { key: "to", header: packageLabel(request.requestedPackage), align: "right", strong: true, phone: "trailing", cell: (row) => row.to },
    ]
    const name = clubName(request)

    const body = (
      <SubSections>
        <StatusText tone="amber">Waiting for your decision</StatusText>
        {stale ? (
          <Notice tone="warning">
            This club is on {packageLabel(packageNow)} now, not {packageLabel(request.currentPackage)} as it was when they asked.
            {packageNow === request.requestedPackage ? " Approving will not change anything." : ""}
          </Notice>
        ) : null}

        <SubSection title="The request">
          <FactList>
            <Fact label="Change">
              {packageLabel(request.currentPackage)} to {packageLabel(request.requestedPackage)}
            </Fact>
            <Fact label="Asked">
              {formatDateTime(request.createdAt)}
              {request.requestedByEmail ? ` by ${request.requestedByEmail}` : ""}
            </Fact>
            <Fact label="Their reason" empty="They did not give a reason" stack>
              {request.reason?.trim()}
            </Fact>
            <Fact label="Billing contact" empty="None on record">
              {club?.billingContactEmail ? `${club.billingContactName?.trim() || club.billingContactEmail} (${club.billingContactEmail})` : null}
            </Fact>
            {club && !usage ? (
              <Fact label="Expected at sign-up">
                {plural(club.expectedCoachCount ?? 0, "coach", "coaches")}, {plural(club.expectedAthleteCount ?? 0, "athlete")}
              </Fact>
            ) : null}
          </FactList>
        </SubSection>

        <SubSection
          title="Limits"
          hint={
            usage
              ? "In use now counts teams that are not archived, active coaches and athletes."
              : "Live counts of the club's teams, coaches and athletes could not be loaded."
          }
        >
          <DataTable caption="Package limits now and after the change" columns={limitColumns} rows={limitRows} rowKey={(row) => row.key} />
        </SubSection>

      </SubSections>
    )

    const footer = (
      <div className="flex w-full min-w-0 flex-col gap-3">
        {reviewError ? <Notice tone="error">{reviewError}</Notice> : null}
          <Field label="Note to the club" error={noteError} hint="Needed to decline, optional to approve. The club admin sees it next to the decision on their billing screen.">
            <Textarea
              rows={2}
              maxLength={500}
              value={note}
              disabled={busy}
              onChange={(event) => {
                setNote(event.target.value)
                setNoteError(null)
              }}
            />
          </Field>
        {confirm ? (
          <div role="group" aria-label="Confirm your decision" className="flex flex-col gap-3">
            <p className="text-[0.9375rem] text-sk-ink">
              <span className="font-bold">{confirm === "approved" ? `Move ${name} to ${packageLabel(request.requestedPackage)}?` : `Decline this request from ${name}?`}</span>{" "}
              {confirm === "approved"
                ? "Their package limits change as soon as you confirm. Nothing is charged, because payments are not collected in the app."
                : "They stay on their current package and see your note. They can send a new request afterwards."}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="quiet" disabled={busy} onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button variant={confirm === "approved" ? "primary" : "danger"} disabled={busy} onClick={() => void decide(request, confirm)}>
                {busy ? "Saving..." : confirm === "approved" ? "Yes, change package" : "Yes, decline"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="danger" disabled={busy} onClick={() => pick("rejected")}>
              Decline
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => pick("approved")}>
              Approve
            </Button>
          </div>
        )}
      </div>
    )
    return { body, footer, name }
  }

  const openReview = open ? review(open) : null

  return (
    <Screen>
      <ScreenHeader
        title="Package requests"
        lede="Clubs ask here when they want a different package. Approving changes their limits straight away. Declining sends your note back to them."
      />

      {loadError ? <Notice tone="error">We could not load package requests. {loadError}</Notice> : null}
      {done ? <Notice tone="success">{done}</Notice> : null}
      {clubsError ? <Notice tone="warning">Club details could not be loaded, so club names and current packages may be missing below. {clubsError}</Notice> : null}

      <Section title="Waiting for you" meta={loading || pending.length === 0 ? undefined : `${pending.length} waiting`} hint="Open a request to see the club's reason and how its limits would change.">
        {loading ? (
          <SkeletonRows rows={2} label="Loading package requests" />
        ) : pending.length === 0 ? (
          loadError ? null : (
            <EmptyState title="Nothing to review" body="When a club admin asks for a different package from their billing screen, the request lands here with their reason." />
          )
        ) : (
          <List aria-label="Package requests waiting for you">
            {pending.map((request) => (
              <ListRow
                key={request.id}
                onClick={() => openRequest(request)}
                chevron
                title={clubName(request)}
                subtitle={`${packageLabel(request.currentPackage)} to ${packageLabel(request.requestedPackage)}, asked ${formatDateTime(request.createdAt)}`}
                trailing={<StatusText tone="amber">Waiting</StatusText>}
                aria-label={`Review the request from ${clubName(request)}`}
              />
            ))}
          </List>
        )}
      </Section>

      <Section
        title="Decided"
        hint="Newest decision first. Every decision is also written to Platform activity."
        meta={decided.length > 0 ? plural(decided.length, "request") : undefined}
        action={
          decided.length === 0 ? (
            <Link to="/platform-admin/billing" className="sk-link">
              Club billing
            </Link>
          ) : undefined
        }
      >
        {loading ? (
          <SkeletonRows rows={3} label="Loading decisions" />
        ) : decided.length === 0 ? (
          <EmptyState title="No decisions yet" body="Approved and declined requests are kept here with your note." />
        ) : (
          <>
            <DataTable caption="Package requests that were decided" columns={decidedColumns} rows={decided.slice(0, historyVisible)} rowKey={(request) => request.id} />
            {decided.length > historyVisible ? (
              <Button className="mt-3 self-start" onClick={() => setHistoryVisible((current) => current + HISTORY_PAGE)}>
                Load {Math.min(HISTORY_PAGE, decided.length - historyVisible)} more
              </Button>
            ) : null}
          </>
        )}
      </Section>

      <Sheet
        open={Boolean(open)}
        onOpenChange={(next) => (next ? null : closeRequest())}
        title={openReview?.name ?? "Package request"}
        description={open ? `Wants to move from ${packageLabel(open.currentPackage)} to ${packageLabel(open.requestedPackage)}` : undefined}
        className="sm:max-w-[560px]"
        footer={openReview?.footer}
      >
        {openReview?.body}
      </Sheet>
    </Screen>
  )
}
