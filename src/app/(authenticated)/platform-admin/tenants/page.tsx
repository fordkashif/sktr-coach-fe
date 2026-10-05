import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Buildings, CaretDown, DownloadSimple, MagnifyingGlass, X } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import { EmptyState, Initials, Meter, PageHeader, Panel, Tag } from "@/components/sk"
import { getPackageById, packageOptions } from "@/lib/billing/package-catalog"
import {
  getPlatformAdminPackageUpgradeRequests,
  getPlatformAuditEvents,
  getPlatformTenantSizes,
  logPlatformAdminExport,
  setTenantRequestLifecycleState,
  type PlatformAdminPackageUpgradeRequestRecord,
  type PlatformAuditEventRecord,
  type PlatformTenantSize,
} from "@/lib/data/platform-admin/ops-data"
import {
  auditReason,
  auditSentence,
  clubHistory,
  formatLocalDate,
  formatLocalDateTime,
  getPlatformAdminClubs,
  LIFECYCLE_META,
  LIFECYCLE_ORDER,
  lifecycleOf,
  packageLabel,
  type PlatformClubRecord,
} from "@/lib/data/platform-admin/tenants-data"
import type { TenantBillingStatus, TenantLifecycleStatus } from "@/lib/tenant/lifecycle"
import { cn } from "@/lib/utils"

const alertClass = "rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]"
const th = "px-3 py-3 font-semibold"

const BILLING_LABEL: Record<TenantBillingStatus, string> = {
  pending: "Not set up",
  mocked_complete: "Set up (test billing)",
  failed: "Failed",
  active: "Active",
  past_due: "Past due",
  cancelled: "Cancelled",
}

const CLUB_STATES = LIFECYCLE_ORDER.filter((state) => state !== "pending_review")

type LifecycleAction = {
  key: "suspend" | "reactivate" | "cancel" | "activate" | "billing-failed"
  button: string
  next: TenantLifecycleStatus
  billingStatus?: TenantBillingStatus | null
  reasonRequired: boolean
  danger: boolean
  question: string
  /** What this does today, and nothing more. Checked against the route guards and database functions. */
  effect: string
  confirm: string
  keep: string
}

/** The lifecycle moves this screen offers, all through set_tenant_request_lifecycle_state. */
function actionsFor(club: PlatformClubRecord): LifecycleAction[] {
  const state = lifecycleOf(club)
  const name = club.organizationName
  const actions: LifecycleAction[] = []

  if (state === "active_onboarding") {
    actions.push({
      key: "activate",
      button: "Mark active",
      next: "active",
      reasonRequired: false,
      danger: false,
      question: `Mark ${name} as active?`,
      effect:
        "Nothing changes for the club's people. A club moves to active on its own when its admin finishes setup, so use this only when you want to mark it active before that.",
      confirm: "Mark active",
      keep: "Keep as onboarding",
    })
  }

  if (state === "approved_pending_billing") {
    actions.push({
      key: "billing-failed",
      button: "Mark billing failed",
      next: "billing_failed",
      billingStatus: "failed",
      reasonRequired: true,
      danger: true,
      question: `Mark billing as failed for ${name}?`,
      effect: "The club admin stays on the billing setup step, sees that the last attempt failed and can try again.",
      confirm: "Mark billing failed",
      keep: "Leave as it is",
    })
  }

  if (state === "active" || state === "active_onboarding") {
    actions.push({
      key: "suspend",
      button: "Suspend",
      next: "suspended",
      billingStatus: club.billingStatus ?? (state === "active" ? "active" : "mocked_complete"),
      reasonRequired: true,
      danger: true,
      question: `Suspend ${name}?`,
      effect:
        "This blocks the whole club straight away. The club admin, coaches and athletes can still sign in, but they see a notice that the club's access is paused and cannot read or change anything. All data is kept, and reactivating gives access back at once. It is written to the platform audit.",
      confirm: "Suspend club",
      keep: "Keep as it is",
    })
  }

  if (state === "suspended") {
    const back = club.previousLifecycleStatus ?? "active"
    actions.push({
      key: "reactivate",
      button: "Reactivate",
      next: back,
      billingStatus: club.billingStatus ?? "active",
      reasonRequired: false,
      danger: false,
      question: `Reactivate ${name}?`,
      effect: `Puts the club back to ${LIFECYCLE_META[back].label.toLowerCase()}, where it was before it was suspended. Everyone in the club gets their access back straight away.`,
      confirm: "Reactivate club",
      keep: "Keep suspended",
    })
  }

  if (state !== "cancelled") {
    actions.push({
      key: "cancel",
      button: "Cancel club",
      next: "cancelled",
      billingStatus: "cancelled",
      reasonRequired: true,
      danger: true,
      question: `Cancel ${name}?`,
      effect:
        "This marks the club and its billing as cancelled and blocks the whole club straight away. Members can still sign in, but they see a notice that the club's access has ended and cannot read or change anything. All data is kept. It is written to the platform audit. You can restore a cancelled club from Club requests.",
      confirm: "Cancel club",
      keep: "Keep club",
    })
  }

  return actions
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function liveSizeOf(club: PlatformClubRecord, sizes: Map<string, PlatformTenantSize> | null) {
  return club.provisionedTenantId ? (sizes?.get(club.provisionedTenantId) ?? null) : null
}

function liveSizeParts(size: PlatformTenantSize) {
  return [
    `${size.teams.toLocaleString()} ${size.teams === 1 ? "team" : "teams"}`,
    `${size.coaches.toLocaleString()} ${size.coaches === 1 ? "coach" : "coaches"}`,
    `${size.athletes.toLocaleString()} ${size.athletes === 1 ? "athlete" : "athletes"}`,
  ]
}

function expectedSize(club: PlatformClubRecord) {
  const parts = [
    club.expectedCoachCount !== null ? `${club.expectedCoachCount} ${club.expectedCoachCount === 1 ? "coach" : "coaches"}` : null,
    club.expectedAthleteCount !== null ? `${club.expectedAthleteCount} ${club.expectedAthleteCount === 1 ? "athlete" : "athletes"}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : null
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-semibold text-sk-mute">{label}</dt>
      <dd className="mt-0.5 break-words text-sk-ink">{children}</dd>
    </div>
  )
}

/** `live` is the real count when the platform has it. Otherwise the number given at sign-up is shown as "expected". */
function LimitRow({ label, live, expected: signUp, limit }: { label: string; live: number | null; expected: number | null; limit: number | null }) {
  const expected = live ?? signUp
  const finite = limit !== null && Number.isFinite(limit)
  const over = finite && expected !== null && expected > (limit as number)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold text-sk-ink">{label}</span>
        <span className={cn("text-sk-ink-2", over && "font-bold text-[#b32a0c]")}>
          {live !== null ? `${live.toLocaleString()} now` : expected !== null ? `${expected} expected` : "Not given"}
          {limit === null ? "" : finite ? `, limit ${limit}` : ", no limit"}
        </span>
      </div>
      {finite && expected !== null ? <Meter className="mt-2" value={(expected / (limit as number)) * 100} tone={over ? "coral" : "blue"} /> : null}
    </div>
  )
}

export default function PlatformAdminTenantsPage() {
  const [clubs, setClubs] = useState<PlatformClubRecord[]>([])
  const [auditEvents, setAuditEvents] = useState<PlatformAuditEventRecord[]>([])
  const [upgrades, setUpgrades] = useState<PlatformAdminPackageUpgradeRequestRecord[]>([])
  /** Live club sizes by tenant id. Null when the platform cannot read them, and sign-up estimates are shown instead. */
  const [sizes, setSizes] = useState<Map<string, PlatformTenantSize> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | TenantLifecycleStatus>("all")
  const [packageFilter, setPackageFilter] = useState("all")

  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<LifecycleAction["key"] | null>(null)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [clubsResult, auditResult, upgradesResult, sizesResult] = await Promise.all([
      getPlatformAdminClubs(),
      getPlatformAuditEvents(250),
      getPlatformAdminPackageUpgradeRequests(),
      getPlatformTenantSizes(),
    ])
    setSizes(sizesResult)

    if (clubsResult.ok) setClubs(clubsResult.data)
    // History and package requests are extras: the table still works without them.
    if (auditResult.ok) setAuditEvents(auditResult.data)
    if (upgradesResult.ok) setUpgrades(upgradesResult.data)

    return clubsResult.ok ? null : clubsResult.error.message
  }, [])

  useEffect(() => {
    let cancelled = false
    void load().then((message) => {
      if (cancelled) return
      setError(message)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const clubNames = useMemo(() => {
    const map = new Map<string, string>()
    clubs.forEach((club) => {
      if (club.provisionedTenantId) map.set(club.provisionedTenantId, club.organizationName)
    })
    return map
  }, [clubs])

  const filtersActive = search.trim() !== "" || statusFilter !== "all" || packageFilter !== "all"

  const visibleClubs = useMemo(() => {
    const query = search.trim().toLowerCase()
    return clubs.filter((club) => {
      if (statusFilter !== "all" && lifecycleOf(club) !== statusFilter) return false
      if (packageFilter !== "all" && club.requestedPlan !== packageFilter) return false
      if (!query) return true
      return [club.organizationName, club.requestorName, club.requestorEmail, club.region ?? "", club.provisionedTenantId ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query)
    })
  }, [clubs, packageFilter, search, statusFilter])

  const closeConfirm = () => {
    setConfirmKey(null)
    setReason("")
    setReasonError(false)
  }

  const toggleClub = (clubId: string) => {
    closeConfirm()
    setOpenId((current) => (current === clubId ? null : clubId))
  }

  const handleLifecycle = async (club: PlatformClubRecord, action: LifecycleAction) => {
    const note = reason.trim()
    if (action.reasonRequired && !note) {
      setReasonError(true)
      return
    }

    setBusy(true)
    const result = await setTenantRequestLifecycleState({
      requestId: club.id,
      lifecycleStatus: action.next,
      billingStatus: action.billingStatus,
      reviewNotes: note || undefined,
    })

    if (!result.ok) {
      setError(result.error.message)
      setNotice(null)
      setBusy(false)
      return
    }

    const reloadError = await load()
    setError(reloadError)
    setNotice(`${club.organizationName} is now ${LIFECYCLE_META[action.next].label.toLowerCase()}.`)
    setBusy(false)
    closeConfirm()
  }

  const handleExport = () => {
    downloadCsv("platform-admin-clubs.csv", [
      ["Club", "Package", "Status", "Billing", "Club admin", "Club admin email", "Teams now", "Coaches now", "Athletes now", "Expected coaches", "Expected athletes", "Region", "Tenant ID", "Created"],
      ...visibleClubs.map((club) => [
        club.organizationName,
        packageLabel(club.requestedPlan),
        LIFECYCLE_META[lifecycleOf(club)].label,
        club.billingStatus ? BILLING_LABEL[club.billingStatus] : "",
        club.requestorName,
        club.requestorEmail,
        // Blank when live counts are not available for this club.
        ...(["teams", "coaches", "athletes"] as const).map((key) => {
          const live = liveSizeOf(club, sizes)
          return live ? String(live[key]) : ""
        }),
        club.expectedCoachCount === null ? "" : String(club.expectedCoachCount),
        club.expectedAthleteCount === null ? "" : String(club.expectedAthleteCount),
        club.region ?? "",
        club.provisionedTenantId ?? "",
        formatLocalDateTime(club.createdAt, ""),
      ]),
    ])
    void logPlatformAdminExport({
      target: "clubs",
      format: "csv",
      recordCount: visibleClubs.length,
      filters: { search: search.trim() || null, status: statusFilter, package: packageFilter },
    })
  }

  const lede = loading
    ? "Loading clubs..."
    : clubs.length === 0
      ? "No clubs yet. A club appears here once you approve its request."
      : `${clubs.length} ${clubs.length === 1 ? "club" : "clubs"}. Open one to see its contact, package and history, or to change its status.`

  return (
    <div className="sk-page">
      <PageHeader
        title="Clubs"
        lede={lede}
        actions={
          <button type="button" className="sk-btn sk-btn-quiet" disabled={loading || visibleClubs.length === 0} onClick={handleExport}>
            <DownloadSimple className="size-5" weight="bold" />
            Export CSV
          </button>
        }
      />

      {error ? (
        <div role="alert" className={`${alertClass} flex items-start justify-between gap-3`}>
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" className="shrink-0" onClick={() => setError(null)}>
            <X className="size-4" weight="bold" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="flex items-start justify-between gap-3 rounded-2xl bg-sk-green-tint px-4 py-3 text-sm font-semibold text-[#07673f]">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" className="shrink-0" onClick={() => setNotice(null)}>
            <X className="size-4" weight="bold" />
          </button>
        </div>
      ) : null}

      {loading ? (
        <p role="status" className="sk-card text-sm font-semibold text-sk-mute">
          Loading...
        </p>
      ) : clubs.length === 0 ? (
        <EmptyState
          icon={<Buildings className="size-6" weight="fill" />}
          title="No clubs yet"
          body="Approve a club request and it appears here with its package, status and club admin."
          action={
            <Link to="/platform-admin/requests" className="sk-btn sk-btn-primary sk-btn-sm">
              Open requests
            </Link>
          }
        />
      ) : (
        <Panel flush>
          <div className="flex flex-col gap-3 border-b border-sk-line p-5 sm:p-6 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-sk-mute" weight="bold" />
              <input
                type="search"
                aria-label="Search clubs"
                placeholder="Search by club, club admin or email"
                className="sk-field pl-11"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 md:flex">
              <select
                aria-label="Filter by status"
                className="sk-field md:w-48"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              >
                <option value="all">Any status</option>
                {CLUB_STATES.map((state) => (
                  <option key={state} value={state}>
                    {LIFECYCLE_META[state].label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by package"
                className="sk-field md:w-40"
                value={packageFilter}
                onChange={(event) => setPackageFilter(event.target.value)}
              >
                <option value="all">Any package</option>
                {packageOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {visibleClubs.length === 0 ? (
            <div className="flex flex-col items-start gap-3 p-5 sm:p-6">
              <p className="text-sm text-sk-mute">No club matches that search or filter.</p>
              <button
                type="button"
                className="sk-btn sk-btn-quiet sk-btn-sm"
                onClick={() => {
                  setSearch("")
                  setStatusFilter("all")
                  setPackageFilter("all")
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="md:overflow-x-auto">
            <table className="block w-full text-left md:table">
              <caption className="sr-only">Clubs{filtersActive ? ", filtered" : ""}</caption>
              <thead className="hidden md:table-header-group">
                <tr className="border-b border-sk-line text-sm text-sk-mute">
                  <th scope="col" className={`${th} pl-6`}>Club</th>
                  <th scope="col" className={th}>Package</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}>Club admin</th>
                  <th scope="col" className={`${th} max-lg:hidden`}>{sizes ? "Size now" : "Expected at sign-up"}</th>
                  <th scope="col" className={`${th} pr-6`}>Created</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group">
                {visibleClubs.map((club) => {
                  const state = lifecycleOf(club)
                  const open = openId === club.id
                  const live = liveSizeOf(club, sizes)
                  // Live counts when the platform has them. A club with no workspace yet only has its sign-up numbers.
                  const size = live ? liveSizeParts(live).join(", ") : expectedSize(club)
                  const sizeIsEstimate = !live && Boolean(sizes) && Boolean(size)
                  return (
                    <Fragment key={club.id}>
                      <tr
                        data-club={club.organizationName}
                        className={cn(
                          "grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-t border-sk-line px-5 py-4 first:border-t-0 hover:bg-sk-canvas md:table-row md:px-0 md:py-0",
                          open && "bg-sk-canvas",
                        )}
                        onClick={() => toggleClub(club.id)}
                      >
                        <th scope="row" className="min-w-0 font-normal md:py-3.5 md:pl-6 md:pr-3">
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-controls={`club-detail-${club.id}`}
                            className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
                          >
                            <Initials name={club.organizationName} />
                            <span className="min-w-0 font-bold leading-snug text-sk-ink md:truncate">{club.organizationName}</span>
                            <CaretDown className={cn("size-4 shrink-0 text-sk-mute transition-transform", open && "rotate-180")} weight="bold" aria-hidden />
                          </button>
                        </th>
                        <td className="max-md:row-start-3 max-md:pl-[52px] text-sm text-sk-ink-2 md:px-3 md:py-3.5">
                          {packageLabel(club.requestedPlan)}
                          <span className="md:hidden"> package</span>
                        </td>
                        <td className="max-md:col-start-2 max-md:row-start-1 max-md:justify-self-end md:px-3 md:py-3.5">
                          <Tag tone={LIFECYCLE_META[state].tone} className="whitespace-nowrap">{LIFECYCLE_META[state].label}</Tag>
                        </td>
                        <td className="max-md:col-span-2 max-md:row-start-2 max-md:pl-[52px] min-w-0 text-sm md:px-3 md:py-3.5">
                          <span className="block text-sk-ink max-md:hidden md:max-w-[14rem] xl:max-w-[16rem] md:truncate">{club.requestorName}</span>
                          <span className="block text-sk-mute max-md:break-all md:max-w-[14rem] xl:max-w-[16rem] md:truncate" title={club.requestorEmail}>
                            {club.requestorEmail}
                          </span>
                        </td>
                        <td className="hidden text-sm text-sk-ink-2 lg:table-cell lg:px-3 lg:py-3.5">
                          {size
                            ? size.split(", ").map((part) => (
                                <span key={part} className="block whitespace-nowrap">
                                  {part}
                                </span>
                              ))
                            : "Not given"}
                          {sizeIsEstimate ? <span className="block whitespace-nowrap text-sk-mute">expected at sign-up</span> : null}
                        </td>
                        <td className="max-md:row-start-3 max-md:justify-self-end whitespace-nowrap text-sm text-sk-ink-2 md:py-3.5 md:pl-3 md:pr-6">
                          <time dateTime={club.createdAt}>{formatLocalDate(club.createdAt)}</time>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="block border-t border-sk-line bg-sk-canvas md:table-row">
                          <td colSpan={6} id={`club-detail-${club.id}`} className="block px-5 pb-6 pt-5 md:table-cell md:px-6">
                            <ClubDetail
                              club={club}
                              liveSize={live}
                              history={clubHistory(auditEvents, club)}
                              clubNames={clubNames}
                              pendingUpgrade={upgrades.find((item) => item.status === "pending" && item.tenantId === club.provisionedTenantId) ?? null}
                              confirmKey={confirmKey}
                              reason={reason}
                              reasonError={reasonError}
                              busy={busy}
                              onPick={(key) => {
                                setReason("")
                                setReasonError(false)
                                setConfirmKey((current) => (current === key ? null : key))
                              }}
                              onReason={(value) => {
                                setReason(value)
                                if (value.trim()) setReasonError(false)
                              }}
                              onCancel={closeConfirm}
                              onConfirm={(action) => void handleLifecycle(club, action)}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

function ClubDetail({
  club,
  liveSize,
  history,
  clubNames,
  pendingUpgrade,
  confirmKey,
  reason,
  reasonError,
  busy,
  onPick,
  onReason,
  onCancel,
  onConfirm,
}: {
  club: PlatformClubRecord
  liveSize: PlatformTenantSize | null
  history: PlatformAuditEventRecord[]
  clubNames: Map<string, string>
  pendingUpgrade: PlatformAdminPackageUpgradeRequestRecord | null
  confirmKey: LifecycleAction["key"] | null
  reason: string
  reasonError: boolean
  busy: boolean
  onPick: (key: LifecycleAction["key"]) => void
  onReason: (value: string) => void
  onCancel: () => void
  onConfirm: (action: LifecycleAction) => void
}) {
  const state = lifecycleOf(club)
  const pack = getPackageById(club.requestedPlan)
  const actions = actionsFor(club)
  const confirming = actions.find((action) => action.key === confirmKey) ?? null
  const reasonId = `club-reason-${club.id}`
  const billingContact = [club.billingContactName?.trim(), club.billingContactEmail?.trim()].filter(Boolean).join(", ")

  return (
    <div className="space-y-6">
      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-3">
        <section aria-label="Contact">
          <h3 className="sk-h3">Contact</h3>
          <dl className="mt-3 space-y-3">
            <Fact label="Club admin">
              {club.requestorName}
              {club.jobTitle ? <span className="text-sk-mute">, {club.jobTitle}</span> : null}
            </Fact>
            <Fact label="Email">
              <a href={`mailto:${club.requestorEmail}`} className="font-semibold text-sk-blue hover:underline">
                {club.requestorEmail}
              </a>
            </Fact>
            <Fact label="Billing contact">{billingContact || "Not given yet"}</Fact>
            {club.region ? <Fact label="Region">{club.region}</Fact> : null}
            {club.organizationWebsite ? <Fact label="Website">{club.organizationWebsite}</Fact> : null}
            <Fact label="Club admin invite">
              {club.accessInviteLastError ? (
                <span className="font-semibold text-[#b32a0c]">Failed to send: {club.accessInviteLastError}</span>
              ) : club.accessInviteSentAt ? (
                `Sent ${formatLocalDateTime(club.accessInviteSentAt)}`
              ) : (
                "Not sent yet"
              )}
            </Fact>
          </dl>
        </section>

        <section aria-label="Package and size">
          <h3 className="sk-h3">Package and size</h3>
          <dl className="mt-3 space-y-3">
            <Fact label="Package">
              {packageLabel(club.requestedPlan)}
              {pendingUpgrade ? (
                <>
                  {". "}
                  <Link to="/platform-admin/commercial" className="font-semibold text-sk-blue hover:underline">
                    Asked to move to {packageLabel(pendingUpgrade.requestedPackage)}
                  </Link>
                </>
              ) : null}
            </Fact>
            <Fact label="Billing">
              {club.billingStatus ? BILLING_LABEL[club.billingStatus] : "Not set up"}
              {club.billingCycle ? `, ${club.billingCycle}` : ""}
            </Fact>
          </dl>
          <div className="mt-4 space-y-3">
            {liveSize ? <LimitRow label="Teams" live={liveSize.teams} expected={null} limit={pack?.limits.teams ?? null} /> : null}
            <LimitRow label="Coaches" live={liveSize?.coaches ?? null} expected={club.expectedCoachCount} limit={pack?.limits.coaches ?? null} />
            <LimitRow label="Athletes" live={liveSize?.athletes ?? null} expected={club.expectedAthleteCount} limit={pack?.limits.athletes ?? null} />
            {pack && !liveSize ? (
              <p className="text-sm text-sk-ink-2">
                <span className="font-semibold text-sk-ink">Teams</span>
                {Number.isFinite(pack.limits.teams) ? `: limit ${pack.limits.teams}` : ": no limit"}
              </p>
            ) : null}
          </div>
          <p className="mt-3 text-sm text-sk-mute">
            {liveSize
              ? `Counted now: teams that are not archived, active coaches and every athlete on the roster. At sign-up the club expected ${expectedSize(club) ?? "no set number"}.`
              : club.provisionedTenantId
                ? "These are the numbers the club gave at sign-up. Live team, coach and athlete counts could not be loaded."
                : "These are the numbers the club gave at sign-up. The club has no workspace yet, so there is nothing to count."}
          </p>
        </section>

        <section aria-label="History">
          <h3 className="sk-h3">History</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <Fact label="Requested">{formatLocalDate(club.createdAt)}</Fact>
            <Fact label="Approved">{formatLocalDate(club.reviewedAt)}</Fact>
            <Fact label="Billing set up">{formatLocalDate(club.billingStartedAt, "Not yet")}</Fact>
            {club.billingFailedAt ? <Fact label="Billing failed">{formatLocalDate(club.billingFailedAt)}</Fact> : null}
            {state === "suspended" && club.previousLifecycleStatus ? (
              <Fact label="Before suspension">{LIFECYCLE_META[club.previousLifecycleStatus].label}</Fact>
            ) : null}
          </dl>
          {history.length > 0 ? (
            <ol className="mt-4 space-y-3 border-t border-sk-line pt-4">
              {history.slice(0, 8).map((event) => {
                const note = auditReason(event)
                return (
                  <li key={event.id} className="text-sm">
                    <p className="font-semibold text-sk-ink">{auditSentence(event, clubNames)}</p>
                    {note ? <p className="text-sk-ink-2">Reason: {note}</p> : null}
                    <p className="break-words text-sk-mute">
                      <time dateTime={event.occurredAt}>{formatLocalDateTime(event.occurredAt)}</time>
                      {event.actorEmail ? `, by ${event.actorEmail}` : ""}
                    </p>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="mt-4 border-t border-sk-line pt-4 text-sm text-sk-mute">No events for this club in the latest platform activity.</p>
          )}
        </section>
      </div>

      <section aria-label="Status" className="border-t border-sk-line pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="sk-h3">Status: {LIFECYCLE_META[state].label}</h3>
            {club.reviewNotes ? <p className="mt-0.5 text-sm text-sk-mute">Last note: {club.reviewNotes}</p> : null}
          </div>
          {actions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  aria-expanded={confirmKey === action.key}
                  className={cn("sk-btn sk-btn-sm max-sm:h-11 max-sm:flex-1", action.danger ? "sk-btn-danger" : "sk-btn-quiet")}
                  disabled={busy}
                  onClick={() => onPick(action.key)}
                >
                  {action.button}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-sk-mute">A cancelled club has no status changes left on this screen.</p>
          )}
        </div>

        {confirming ? (
          <div
            role="group"
            aria-label="Confirm"
            className={cn("mt-4 space-y-3 rounded-2xl p-4", confirming.danger ? "bg-sk-coral-tint" : "bg-sk-blue-tint")}
          >
            <div>
              <p className="font-bold text-sk-ink">{confirming.question}</p>
              <p className="mt-1 max-w-[72ch] text-sm text-sk-ink-2">{confirming.effect}</p>
            </div>
            <div>
              <label htmlFor={reasonId} className="text-sm font-semibold text-sk-ink">
                Reason{confirming.reasonRequired ? "" : " (optional)"}
              </label>
              <textarea
                id={reasonId}
                rows={2}
                className="sk-field mt-1.5 h-auto py-2.5"
                placeholder="Saved on the club and in the platform audit"
                value={reason}
                aria-invalid={reasonError}
                aria-describedby={reasonError ? `${reasonId}-error` : undefined}
                onChange={(event) => onReason(event.target.value)}
              />
              {reasonError ? (
                <p id={`${reasonId}-error`} role="alert" className="mt-1.5 text-sm font-semibold text-[#b32a0c]">
                  Add a reason first.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm max-sm:h-11 max-sm:flex-1" disabled={busy} onClick={onCancel}>
                {confirming.keep}
              </button>
              <button
                type="button"
                className={cn("sk-btn sk-btn-sm max-sm:h-11 max-sm:flex-1", confirming.danger ? "sk-btn-danger" : "sk-btn-ink")}
                disabled={busy}
                onClick={() => onConfirm(confirming)}
              >
                {busy ? "Saving..." : confirming.confirm}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
