import { useCallback, useEffect, useMemo, useState } from "react"
import { DownloadSimple } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import {
  Button,
  DataTable,
  EmptyState,
  Fact,
  FactList,
  Field,
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
  Select,
  Sheet,
  SkeletonRows,
  StatusText,
  SubSection,
  SubSections,
  TableSub,
  Tag,
  Textarea,
  type DataTableColumn,
} from "@/components/sk"
import { ClosedClubsSection } from "@/components/platform-admin/closed-clubs-section"
import { getPackageById, packageOptions, type PackageId } from "@/lib/billing/package-catalog"
import {
  getPlatformAdminPackageUpgradeRequests,
  getPlatformAuditEvents,
  getPlatformTenantSizes,
  logPlatformAdminExport,
  setTenantPackage,
  setTenantRequestLifecycleState,
  type PlatformAdminPackageUpgradeRequestRecord,
  type PlatformAuditEventRecord,
  type PlatformTenantSize,
} from "@/lib/data/platform-admin/ops-data"
import {
  auditReason,
  auditSentence,
  BILLING_STATUS_LABEL,
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
import { downloadCsv, plural } from "@/lib/format/ops-format"
import type { TenantBillingStatus, TenantLifecycleStatus } from "@/lib/tenant/lifecycle"

const CLUB_STATES = LIFECYCLE_ORDER.filter((state) => state !== "pending_review")
type StatusFilter = "all" | TenantLifecycleStatus
type PackageFilter = "all" | PackageId

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
        "This blocks the whole club straight away. The club admin, coaches and athletes can still sign in, but they see a notice that the club's access is paused and cannot read or change anything. All data is kept, and reactivating gives access back at once. It is written to the platform activity.",
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
        "This marks the club and its billing as cancelled and blocks the whole club straight away. Members can still sign in, but they see a notice that the club's access has ended and cannot read or change anything. All data is kept. It is written to the platform activity. You can restore a cancelled club from Club requests.",
      confirm: "Cancel club",
      keep: "Keep club",
    })
  }

  return actions
}

function liveSizeOf(club: PlatformClubRecord, sizes: Map<string, PlatformTenantSize> | null) {
  return club.provisionedTenantId ? (sizes?.get(club.provisionedTenantId) ?? null) : null
}

function liveSizeText(size: PlatformTenantSize) {
  return [plural(size.teams, "team"), plural(size.coaches, "coach", "coaches"), plural(size.athletes, "athlete")].join(", ")
}

function expectedSize(club: PlatformClubRecord) {
  const parts = [
    club.expectedCoachCount !== null ? plural(club.expectedCoachCount, "coach", "coaches") : null,
    club.expectedAthleteCount !== null ? plural(club.expectedAthleteCount, "athlete") : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : null
}

/** "12 now, limit 40": the live count when the platform has it, otherwise the number given at sign-up. */
function UsageFact({ label, live, expected: signUp, limit }: { label: string; live: number | null; expected: number | null; limit: number | null }) {
  const count = live ?? signUp
  const finite = limit !== null && Number.isFinite(limit)
  const over = finite && count !== null && count > (limit as number)
  const limitWords = limit === null ? "" : finite ? `limit ${limit}` : "no limit"
  const countWords = live !== null ? `${live.toLocaleString()} now` : signUp !== null ? `${signUp.toLocaleString()} expected` : ""
  const joined = [countWords, limitWords].filter(Boolean).join(", ")
  const text = joined ? joined.charAt(0).toUpperCase() + joined.slice(1) : "Not given"
  return <Fact label={label}>{over ? <StatusText tone="coral">{text}</StatusText> : text}</Fact>
}

/** Every club: its package, status, admin and real size. Open one to change its status or its package. */
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [packageFilter, setPackageFilter] = useState<PackageFilter>("all")

  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<LifecycleAction["key"] | null>(null)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState(false)
  const [changingPackage, setChangingPackage] = useState(false)
  const [newPackage, setNewPackage] = useState<PackageId | "">("")
  const [packageReason, setPackageReason] = useState("")
  const [packageErrors, setPackageErrors] = useState<{ package?: string; reason?: string }>({})
  const [sheetError, setSheetError] = useState<string | null>(null)
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

  const activeFilters = (statusFilter !== "all" ? 1 : 0) + (packageFilter !== "all" ? 1 : 0)
  const filtersActive = search.trim() !== "" || activeFilters > 0
  const clearFilters = () => {
    setSearch("")
    setStatusFilter("all")
    setPackageFilter("all")
  }

  const visibleClubs = useMemo(() => {
    const query = search.trim().toLowerCase()
    return clubs.filter((club) => {
      if (statusFilter !== "all" && lifecycleOf(club) !== statusFilter) return false
      if (packageFilter !== "all" && club.requestedPlan !== packageFilter) return false
      if (!query) return true
      return [club.organizationName, club.requestorName, club.requestorEmail, club.region ?? "", club.provisionedTenantId ?? ""].join(" ").toLowerCase().includes(query)
    })
  }, [clubs, packageFilter, search, statusFilter])

  const resetForms = () => {
    setConfirmKey(null)
    setReason("")
    setReasonError(false)
    setChangingPackage(false)
    setNewPackage("")
    setPackageReason("")
    setPackageErrors({})
    setSheetError(null)
  }

  const openClub = (clubId: string) => {
    resetForms()
    setOpenId(clubId)
  }

  const closeClub = () => {
    if (busy) return
    resetForms()
    setOpenId(null)
  }

  const handleLifecycle = async (club: PlatformClubRecord, action: LifecycleAction) => {
    const note = reason.trim()
    if (action.reasonRequired && !note) {
      setReasonError(true)
      return
    }

    setBusy(true)
    setSheetError(null)
    const result = await setTenantRequestLifecycleState({
      requestId: club.id,
      lifecycleStatus: action.next,
      billingStatus: action.billingStatus,
      reviewNotes: note || undefined,
    })

    if (!result.ok) {
      setSheetError(result.error.message)
      setBusy(false)
      return
    }

    const reloadError = await load()
    setError(reloadError)
    setNotice(`${club.organizationName} is now ${LIFECYCLE_META[action.next].label.toLowerCase()}.`)
    setBusy(false)
    resetForms()
  }

  const handlePackageChange = async (club: PlatformClubRecord) => {
    const note = packageReason.trim()
    const errors: { package?: string; reason?: string } = {}
    if (!newPackage) errors.package = "Choose the package to move the club to."
    if (note.length < 3) errors.reason = "Add a reason first. It is saved with the change and sent to the club."
    if (errors.package || errors.reason || !newPackage || !club.provisionedTenantId) {
      setPackageErrors(errors)
      return
    }

    setBusy(true)
    setSheetError(null)
    const result = await setTenantPackage({ requestId: club.id, tenantId: club.provisionedTenantId, packageId: newPackage, reason: note })
    if (!result.ok) {
      setSheetError(result.error.message)
      setBusy(false)
      return
    }

    const reloadError = await load()
    setError(reloadError)
    setNotice(`${club.organizationName} is now on the ${packageLabel(newPackage)} package. The new limits apply straight away.`)
    setBusy(false)
    resetForms()
  }

  const handleExport = () => {
    downloadCsv("platform-admin-clubs.csv", [
      ["Club", "Package", "Status", "Billing", "Club admin", "Club admin email", "Teams now", "Coaches now", "Athletes now", "Expected coaches", "Expected athletes", "Region", "Tenant ID", "Created"],
      ...visibleClubs.map((club) => [
        club.organizationName,
        packageLabel(club.requestedPlan),
        LIFECYCLE_META[lifecycleOf(club)].label,
        club.billingStatus ? BILLING_STATUS_LABEL[club.billingStatus] : "",
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

  const columns: Array<DataTableColumn<PlatformClubRecord>> = [
    {
      key: "club",
      header: "Club",
      cell: (club) => (
        <>
          <button
            type="button"
            className="cursor-pointer rounded-[6px] text-left font-bold text-sk-ink hover:text-sk-blue-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
            aria-label={`Open ${club.organizationName}`}
            onClick={(event) => {
              event.stopPropagation()
              openClub(club.id)
            }}
          >
            <span className="break-words">{club.organizationName}</span>
          </button>
          {club.region ? <TableSub>{club.region}</TableSub> : null}
        </>
      ),
    },
    { key: "package", header: "Package", cell: (club) => packageLabel(club.requestedPlan) },
    {
      key: "admin",
      header: "Club admin",
      phone: "plain",
      cell: (club) => (
        <span className="min-w-0">
          <span className="block text-sk-ink">{club.requestorName}</span>
          <span className="block break-all text-sm text-sk-mute">{club.requestorEmail}</span>
        </span>
      ),
    },
    {
      key: "size",
      header: sizes ? "Size now" : "Expected at sign-up",
      cell: (club) => {
        const live = liveSizeOf(club, sizes)
        // Live counts when the platform has them. A club with no workspace yet only has its sign-up numbers.
        const text = live ? liveSizeText(live) : expectedSize(club)
        return text ? (
          <>
            {text}
            {!live && sizes ? <span className="block text-sm text-sk-mute">Expected at sign-up</span> : null}
          </>
        ) : (
          <span className="text-sk-mute">Not given</span>
        )
      },
    },
    { key: "created", header: "Created", phone: "hide", cell: (club) => <time dateTime={club.createdAt}>{formatLocalDate(club.createdAt)}</time> },
    {
      key: "status",
      header: "Status",
      phone: "trailing",
      cell: (club) => {
        const state = lifecycleOf(club)
        return (
          <Tag tone={LIFECYCLE_META[state].tone} className="whitespace-nowrap">
            {LIFECYCLE_META[state].label}
          </Tag>
        )
      },
    },
  ]

  const lede = loading
    ? "Every club, with its package, status and size."
    : clubs.length === 0
      ? "No clubs yet. A club appears here once you approve its request."
      : `${plural(clubs.length, "club")}. Open one to see its contact, package and history, or to change its status or package.`

  const openClubRecord = openId ? (clubs.find((club) => club.id === openId) ?? null) : null

  return (
    <Screen>
      <ScreenHeader
        title="Clubs"
        lede={lede}
        actions={
          <Button disabled={loading || visibleClubs.length === 0} onClick={handleExport}>
            <DownloadSimple className="size-5" weight="bold" aria-hidden />
            Export CSV
          </Button>
        }
      />

      {error ? (
        <Notice
          tone="error"
          action={
            <Button variant="quiet" size="sm" onClick={() => setError(null)}>
              Dismiss
            </Button>
          }
        >
          {error}
        </Notice>
      ) : null}
      {notice ? (
        <Notice
          tone="success"
          action={
            <Button variant="quiet" size="sm" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          }
        >
          {notice}
        </Notice>
      ) : null}

      <ClosedClubsSection onChanged={() => void load()} />

      {loading ? (
        <Section title="Clubs">
          <SkeletonRows rows={5} label="Loading clubs" />
        </Section>
      ) : clubs.length === 0 ? (
        <Section>
          <EmptyState
            title="No clubs yet"
            body="Approve a club request and it appears here with its package, status and club admin."
            action={
              <LinkButton to="/platform-admin/requests" size="sm">
                Open requests
              </LinkButton>
            }
          />
        </Section>
      ) : (
        <Section title="All clubs" meta={`${visibleClubs.length} of ${clubs.length}`} aria-label="Clubs">
          <FilterBar
            className="mb-2 mt-2"
            search={<SearchInput aria-label="Search clubs" placeholder="Club, club admin or email" value={search} onChange={(event) => setSearch(event.target.value)} />}
            activeCount={activeFilters}
            onClear={clearFilters}
          >
            <FilterChips<StatusFilter>
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All" },
                ...CLUB_STATES.filter((state) => clubs.some((club) => lifecycleOf(club) === state) || state === statusFilter).map((state) => ({
                  value: state,
                  label: LIFECYCLE_META[state].label,
                  count: clubs.filter((club) => lifecycleOf(club) === state).length,
                })),
              ]}
            />
            <FilterChips<PackageFilter>
              label="Package"
              value={packageFilter}
              onChange={setPackageFilter}
              options={[{ value: "all", label: "All" }, ...packageOptions.map((option) => ({ value: option.id, label: option.label }))]}
            />
          </FilterBar>

          {visibleClubs.length === 0 ? (
            <EmptyState
              title="No club matches"
              body={`There are ${plural(clubs.length, "club")}, but none fit that search${filtersActive ? " and those filters" : ""}.`}
              action={
                <Button size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <DataTable
              caption={`Clubs${filtersActive ? ", filtered" : ""}`}
              columns={columns}
              rows={visibleClubs}
              rowKey={(club) => club.id}
              rowProps={(club) => ({ "data-club": club.organizationName, onClick: () => openClub(club.id) })}
            />
          )}
        </Section>
      )}

      <Sheet
        open={Boolean(openClubRecord)}
        onOpenChange={(open) => (open ? null : closeClub())}
        title={openClubRecord?.organizationName ?? "Club"}
        description={openClubRecord ? `Created ${formatLocalDate(openClubRecord.createdAt)}` : undefined}
        className="sm:max-w-[560px]"
      >
        {openClubRecord ? (
          <ClubDetail
            club={openClubRecord}
            liveSize={liveSizeOf(openClubRecord, sizes)}
            history={clubHistory(auditEvents, openClubRecord)}
            clubNames={clubNames}
            pendingUpgrade={upgrades.find((item) => item.status === "pending" && item.tenantId === openClubRecord.provisionedTenantId) ?? null}
            error={sheetError}
            busy={busy}
            confirmKey={confirmKey}
            reason={reason}
            reasonError={reasonError}
            onPick={(key) => {
              setReason("")
              setReasonError(false)
              setSheetError(null)
              setChangingPackage(false)
              setConfirmKey((current) => (current === key ? null : key))
            }}
            onReason={(value) => {
              setReason(value)
              if (value.trim()) setReasonError(false)
            }}
            onCancel={resetForms}
            onConfirm={(action) => void handleLifecycle(openClubRecord, action)}
            changingPackage={changingPackage}
            newPackage={newPackage}
            packageReason={packageReason}
            packageErrors={packageErrors}
            onStartPackageChange={() => {
              resetForms()
              setChangingPackage(true)
            }}
            onNewPackage={(value) => {
              setNewPackage(value)
              setPackageErrors((current) => ({ ...current, package: undefined }))
            }}
            onPackageReason={(value) => {
              setPackageReason(value)
              if (value.trim().length >= 3) setPackageErrors((current) => ({ ...current, reason: undefined }))
            }}
            onConfirmPackage={() => void handlePackageChange(openClubRecord)}
          />
        ) : null}
      </Sheet>
    </Screen>
  )
}

function ClubDetail({
  club,
  liveSize,
  history,
  clubNames,
  pendingUpgrade,
  error,
  busy,
  confirmKey,
  reason,
  reasonError,
  onPick,
  onReason,
  onCancel,
  onConfirm,
  changingPackage,
  newPackage,
  packageReason,
  packageErrors,
  onStartPackageChange,
  onNewPackage,
  onPackageReason,
  onConfirmPackage,
}: {
  club: PlatformClubRecord
  liveSize: PlatformTenantSize | null
  history: PlatformAuditEventRecord[]
  clubNames: Map<string, string>
  pendingUpgrade: PlatformAdminPackageUpgradeRequestRecord | null
  error: string | null
  busy: boolean
  confirmKey: LifecycleAction["key"] | null
  reason: string
  reasonError: boolean
  onPick: (key: LifecycleAction["key"]) => void
  onReason: (value: string) => void
  onCancel: () => void
  onConfirm: (action: LifecycleAction) => void
  changingPackage: boolean
  newPackage: PackageId | ""
  packageReason: string
  packageErrors: { package?: string; reason?: string }
  onStartPackageChange: () => void
  onNewPackage: (value: PackageId | "") => void
  onPackageReason: (value: string) => void
  onConfirmPackage: () => void
}) {
  const state = lifecycleOf(club)
  const pack = getPackageById(club.requestedPlan)
  const actions = actionsFor(club)
  const confirming = actions.find((action) => action.key === confirmKey) ?? null
  const billingContact = [club.billingContactName?.trim(), club.billingContactEmail?.trim()].filter(Boolean).join(", ")
  const canChangePackage = Boolean(club.provisionedTenantId) && club.status === "approved" && state !== "cancelled"
  const chosen = getPackageById(newPackage)
  const overChosen =
    chosen && liveSize
      ? (["teams", "coaches", "athletes"] as const).filter((key) => liveSize[key] > chosen.limits[key]).map((key) => `${liveSize[key]} ${key} (limit ${chosen.limits[key]})`)
      : []

  return (
    <SubSections>
      <StatusText tone={LIFECYCLE_META[state].state}>{LIFECYCLE_META[state].label}</StatusText>
      {error ? <Notice tone="error">{error}</Notice> : null}

      {club.provisionedTenantId ? (
        <LinkButton to={`/platform-admin/tenants/${encodeURIComponent(club.provisionedTenantId)}`} size="sm" className="self-start">
          Club overview
        </LinkButton>
      ) : null}

      <SubSection title="Contact">
        <FactList>
          <Fact label="Club admin">
            {club.requestorName}
            {club.jobTitle ? `, ${club.jobTitle}` : ""}
          </Fact>
          <Fact label="Email">
            <a href={`mailto:${club.requestorEmail}`} className="sk-link break-all">
              {club.requestorEmail}
            </a>
          </Fact>
          <Fact label="Billing contact" empty="Not given yet">
            {billingContact}
          </Fact>
          {club.region ? <Fact label="Region">{club.region}</Fact> : null}
          {club.organizationWebsite ? <Fact label="Website">{club.organizationWebsite}</Fact> : null}
          <Fact label="Club admin invite" empty="Not sent yet">
            {club.accessInviteLastError ? (
              <StatusText tone="coral">Failed to send: {club.accessInviteLastError}</StatusText>
            ) : club.accessInviteSentAt ? (
              `Sent ${formatLocalDateTime(club.accessInviteSentAt)}`
            ) : null}
          </Fact>
        </FactList>
      </SubSection>

      <SubSection
        title="Package and size"
        action={
          canChangePackage && !changingPackage ? (
            <Button variant="quiet" size="sm" disabled={busy} onClick={onStartPackageChange}>
              Change package
            </Button>
          ) : null
        }
      >
        <FactList>
          <Fact label="Package">{packageLabel(club.requestedPlan)}</Fact>
          {pendingUpgrade ? (
            <Fact label="Package request">
              <Link to="/platform-admin/commercial" className="sk-link">
                Asked to move to {packageLabel(pendingUpgrade.requestedPackage)}
              </Link>
            </Fact>
          ) : null}
          <Fact label="Billing">
            {club.billingStatus ? BILLING_STATUS_LABEL[club.billingStatus] : "Not set up"}
            {club.billingCycle ? `, ${club.billingCycle}` : ""}
          </Fact>
          <UsageFact label="Teams" live={liveSize?.teams ?? null} expected={null} limit={pack?.limits.teams ?? null} />
          <UsageFact label="Coaches" live={liveSize?.coaches ?? null} expected={club.expectedCoachCount} limit={pack?.limits.coaches ?? null} />
          <UsageFact label="Athletes" live={liveSize?.athletes ?? null} expected={club.expectedAthleteCount} limit={pack?.limits.athletes ?? null} />
        </FactList>
        <p className="sk-list-sub mt-2">
          {liveSize
            ? `Counted now: teams that are not archived, active coaches and every athlete on the roster. At sign-up the club expected ${expectedSize(club) ?? "no set number"}.`
            : club.provisionedTenantId
              ? "These are the numbers the club gave at sign-up. Live team, coach and athlete counts could not be loaded."
              : "These are the numbers the club gave at sign-up. The club has no workspace yet, so there is nothing to count."}
        </p>

        {changingPackage ? (
          <form
            className="mt-4 flex flex-col gap-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              onConfirmPackage()
            }}
          >
            <p className="sk-list-title">Change the package of {club.organizationName}?</p>
            <p className="sk-list-sub">
              The club's limits change as soon as you confirm, the same way an approved package request does. The club's admins are told, and the change and your reason are written to the platform activity and
              to the club's own activity. Nothing is charged.
            </p>
            <Field label="New package" error={packageErrors.package}>
              <Select value={newPackage} disabled={busy} onChange={(event) => onNewPackage(event.target.value as PackageId | "")}>
                <option value="">Choose a package</option>
                {packageOptions
                  .filter((option) => option.id !== club.requestedPlan)
                  .map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
              </Select>
            </Field>
            {overChosen.length > 0 && chosen ? (
              <Notice tone="warning">
                The club is using more than {chosen.label} allows: {overChosen.join(", ")}. Nothing is removed, but the club cannot add more until it is back under the limit.
              </Notice>
            ) : null}
            <Field label="Reason" error={packageErrors.reason} hint="The club's admins see this.">
              <Textarea rows={2} maxLength={500} value={packageReason} disabled={busy} onChange={(event) => onPackageReason(event.target.value)} />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="quiet" disabled={busy} onClick={onCancel}>
                Keep package
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving..." : "Yes, change package"}
              </Button>
            </div>
          </form>
        ) : null}
      </SubSection>

      <SubSection title="Status" hint={club.reviewNotes ? `Last note: ${club.reviewNotes}` : undefined}>
        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button key={action.key} size="sm" variant={action.danger ? "danger" : "secondary"} aria-expanded={confirmKey === action.key} disabled={busy} onClick={() => onPick(action.key)}>
                {action.button}
              </Button>
            ))}
          </div>
        ) : (
          <p className="sk-list-sub">A cancelled club has no status changes left on this screen. Restore it from Club requests.</p>
        )}

        {confirming ? (
          <div role="group" aria-label="Confirm" className="mt-4 flex flex-col gap-3">
            <p className="sk-list-title">{confirming.question}</p>
            <p className="sk-list-sub">{confirming.effect}</p>
            <Field label="Reason" optional={!confirming.reasonRequired} error={reasonError ? "Add a reason first." : undefined} hint="Saved on the club and in the platform activity.">
              <Textarea rows={2} value={reason} disabled={busy} onChange={(event) => onReason(event.target.value)} />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="quiet" disabled={busy} onClick={onCancel}>
                {confirming.keep}
              </Button>
              <Button variant={confirming.danger ? "danger" : "primary"} disabled={busy} onClick={() => onConfirm(confirming)}>
                {busy ? "Saving..." : confirming.confirm}
              </Button>
            </div>
          </div>
        ) : null}
      </SubSection>

      <SubSection title="History">
        <FactList>
          <Fact label="Requested">{formatLocalDate(club.createdAt)}</Fact>
          <Fact label="Approved">{formatLocalDate(club.reviewedAt)}</Fact>
          <Fact label="Billing set up">{formatLocalDate(club.billingStartedAt, "Not yet")}</Fact>
          {club.billingFailedAt ? <Fact label="Billing failed">{formatLocalDate(club.billingFailedAt)}</Fact> : null}
          {state === "suspended" && club.previousLifecycleStatus ? <Fact label="Before suspension">{LIFECYCLE_META[club.previousLifecycleStatus].label}</Fact> : null}
        </FactList>
        {history.length > 0 ? (
          <List ordered aria-label="Events for this club" className="mt-2">
            {history.slice(0, 8).map((event) => {
              const note = auditReason(event)
              return (
                <ListRow key={event.id} className="items-start">
                  <span className="sk-list-title break-words">{auditSentence(event, clubNames)}</span>
                  {note ? <span className="sk-list-sub mt-0.5 break-words text-sk-ink-2">Reason: {note}</span> : null}
                  <span className="sk-list-sub mt-0.5 break-words">
                    <time dateTime={event.occurredAt}>{formatLocalDateTime(event.occurredAt)}</time>
                    {event.actorEmail ? `, by ${event.actorEmail}` : ""}
                  </span>
                </ListRow>
              )
            })}
          </List>
        ) : (
          <p className="sk-list-sub mt-2">No events for this club in the latest platform activity.</p>
        )}
      </SubSection>
    </SubSections>
  )
}
