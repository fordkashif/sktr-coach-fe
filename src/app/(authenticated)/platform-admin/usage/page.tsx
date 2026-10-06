import { useEffect, useMemo, useState } from "react"
import { DownloadSimple } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import {
  Button,
  DataTable,
  EmptyState,
  Fact,
  FactList,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  Segmented,
  SkeletonRows,
  Split,
  Stat,
  StatStrip,
  StatusDot,
  TableSub,
  Tag,
  TrendBars,
  type DataTableColumn,
} from "@/components/sk"
import { PlatformHomeTabs } from "@/components/ops/platform-tabs"
import { logPlatformAdminExport } from "@/lib/data/platform-admin/ops-data"
import { LIFECYCLE_META } from "@/lib/data/platform-admin/tenants-data"
import { getPlatformUsage, type PlatformUsage } from "@/lib/data/platform-admin/tools-data"
import { activeMembers, atRiskClubs, isAtRisk, usageCsvRows, usageTotals, weekLabel, type ClubUsage, type UsagePeriod } from "@/lib/data/platform-admin/tools-logic"
import { csvFileName, downloadCsv, plural } from "@/lib/format/ops-format"
import type { TenantLifecycleStatus } from "@/lib/tenant/lifecycle"

const PERIODS: Array<{ value: `${UsagePeriod}`; label: string }> = [
  { value: "7", label: "7 days" },
  { value: "28", label: "28 days" },
  { value: "90", label: "90 days" },
]

function clubState(club: ClubUsage) {
  if (club.isClosed) return { label: "Closing", tone: "plain" as const }
  if (isAtRisk(club)) return { label: "No activity", tone: "coral" as const }
  const meta = club.lifecycleStatus ? LIFECYCLE_META[club.lifecycleStatus as TenantLifecycleStatus] : null
  return meta ? { label: meta.label, tone: meta.tone } : { label: "Active", tone: "green" as const }
}

/** How much every club used the app in a period. Counts only: no person is listed except each club's owner. */
export default function PlatformAdminUsagePage() {
  const [days, setDays] = useState<UsagePeriod>(28)
  const [usage, setUsage] = useState<PlatformUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void getPlatformUsage(days).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setUsage(result.data)
        setError(null)
      } else {
        setError(result.error.message)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [days])

  const clubs = useMemo(() => usage?.clubs ?? [], [usage])
  const totals = useMemo(() => usageTotals(clubs), [clubs])
  const atRisk = useMemo(() => atRiskClubs(clubs), [clubs])
  const weeks = usage?.weeks ?? []
  const thisWeek = weeks[weeks.length - 1]?.sessionsLogged ?? 0
  const lastWeek = weeks[weeks.length - 2]?.sessionsLogged ?? 0
  const shown = usage?.days === days && !loading

  const handleExport = () => {
    if (!usage) return
    downloadCsv(csvFileName("platform-usage", `${usage.days}-days`), usageCsvRows(clubs, usage.days))
    void logPlatformAdminExport({ target: "usage", format: "csv", recordCount: clubs.length, filters: { days: usage.days } })
  }

  const columns: Array<DataTableColumn<ClubUsage>> = [
    {
      key: "club",
      header: "Club",
      className: "lg:min-w-[240px]",
      cell: (club) => (
        <>
          <Link to={`/platform-admin/tenants/${encodeURIComponent(club.tenantId)}`} className="font-bold text-sk-ink hover:text-sk-blue-link">
            <span className="break-words">{club.clubName}</span>
          </Link>
          {club.ownerEmail ? (
            <TableSub>
              <span className="[overflow-wrap:anywhere]">{[club.ownerName, club.ownerEmail].filter(Boolean).join(", ")}</span>
            </TableSub>
          ) : null}
        </>
      ),
    },
    { key: "staff", header: "Staff", align: "right", cell: (club) => (club.activeClubAdmins + club.activeCoaches).toLocaleString() },
    { key: "athletes", header: "Athletes", align: "right", cell: (club) => club.activeAthletes.toLocaleString() },
    { key: "guardians", header: "Guardians", align: "right", phone: "hide", cell: (club) => club.activeGuardians.toLocaleString() },
    { key: "sessions", header: "Sessions", align: "right", cell: (club) => club.sessionsLogged.toLocaleString() },
    { key: "plans", header: "Plans", align: "right", phone: "hide", cell: (club) => club.plansPublished.toLocaleString() },
    { key: "messages", header: "Messages", align: "right", cell: (club) => club.messagesSent.toLocaleString() },
    { key: "reminders", header: "Reminders", align: "right", phone: "hide", cell: (club) => club.remindersSent.toLocaleString() },
    { key: "pushes", header: "Pushes", align: "right", phone: "hide", cell: (club) => club.pushesSent.toLocaleString() },
    {
      key: "emails",
      header: "Emails",
      align: "right",
      cell: (club) => (
        <span className="whitespace-nowrap">
          {club.emailsSent.toLocaleString()}
          {club.emailsFailed > 0 ? <span className="font-semibold text-sk-coral-ink">, {club.emailsFailed} failed</span> : null}
        </span>
      ),
    },
    { key: "new", header: "New", align: "right", phone: "hide", cell: (club) => club.newAthletes.toLocaleString() },
    {
      key: "state",
      header: "State",
      phone: "trailing",
      cell: (club) => {
        const state = clubState(club)
        return (
          <Tag tone={state.tone} className="whitespace-nowrap">
            {state.label}
          </Tag>
        )
      },
    },
  ]

  const lede =
    !usage || loading
      ? "How much each club used the app."
      : clubs.length === 0
        ? "No clubs yet. Usage appears here once a club has a workspace."
        : `${plural(clubs.length, "club")} in the last ${usage.days} days. ${atRisk.length === 0 ? "Every live club was active." : `${plural(atRisk.length, "club")} had no activity.`}`

  return (
    <Screen>
      <ScreenHeader
        title="Usage"
        lede={lede}
        actions={
          <Button disabled={!usage || clubs.length === 0} onClick={handleExport}>
            <DownloadSimple className="size-5" weight="bold" aria-hidden />
            Export CSV
          </Button>
        }
      />
      <PlatformHomeTabs />

      {error ? <Notice tone="error">Could not load usage: {error}</Notice> : null}

      <Segmented label="Period" value={`${days}`} onChange={(next) => setDays(Number(next) as UsagePeriod)} options={PERIODS} className="self-start" />

      <StatStrip aria-label={`All clubs, last ${days} days`}>
        <Stat label="Active people" value={shown ? activeMembers(totals).toLocaleString() : "-"} hint="Signed in or did something" />
        <Stat label="Sessions logged" value={shown ? totals.sessionsLogged.toLocaleString() : "-"} />
        <Stat label="Messages sent" value={shown ? totals.messagesSent.toLocaleString() : "-"} hint="A count. Nobody here can read them" />
        <Stat label="Clubs with no activity" value={shown ? atRisk.length : "-"} of={shown ? clubs.filter((club) => !club.isClosed).length : undefined} />
      </StatStrip>

      <Split
        main={
          <Section title="Sessions logged per week" hint="Every club together, the last 12 weeks. Not changed by the period above.">
            {!usage ? (
              <SkeletonRows rows={4} label="Loading the chart" />
            ) : (
              <>
                <p className="sk-list-sub mb-2">
                  <span className="font-bold text-sk-ink">{thisWeek.toLocaleString()}</span> so far this week, {lastWeek.toLocaleString()} last week.
                </p>
                <TrendBars
                  label={`Sessions logged per week across all clubs over the last 12 weeks. ${thisWeek} so far this week, ${lastWeek} last week.`}
                  seriesName="Sessions logged"
                  minPeak={Math.ceil(Math.max(4, ...weeks.map((week) => week.sessionsLogged)) * 1.15)}
                  points={weeks.map((week) => ({ x: weekLabel(week.weekStart), y: week.sessionsLogged }))}
                />
              </>
            )}
          </Section>
        }
        side={
          <Section title="All clubs" hint={`The last ${days} days.`}>
            {!shown ? (
              <SkeletonRows rows={6} label="Loading totals" />
            ) : (
              <FactList aria-label={`Totals for the last ${days} days`}>
                <Fact label="Active club admins">{totals.activeClubAdmins.toLocaleString()}</Fact>
                <Fact label="Active coaches">{totals.activeCoaches.toLocaleString()}</Fact>
                <Fact label="Active athletes">{totals.activeAthletes.toLocaleString()}</Fact>
                <Fact label="Active guardians">{totals.activeGuardians.toLocaleString()}</Fact>
                <Fact label="Plans published">{totals.plansPublished.toLocaleString()}</Fact>
                <Fact label="Reminders sent">{totals.remindersSent.toLocaleString()}</Fact>
                <Fact label="Pushes sent">{totals.pushesSent.toLocaleString()}</Fact>
                <Fact label="Emails sent">{totals.emailsSent.toLocaleString()}</Fact>
                <Fact label="Emails failed">{totals.emailsFailed.toLocaleString()}</Fact>
                <Fact label="New athletes">{totals.newAthletes.toLocaleString()}</Fact>
              </FactList>
            )}
          </Section>
        }
      />

      <Section title="No activity" hint={`Live clubs where nobody signed in, logged, published or messaged in the last ${days} days.`} meta={shown && atRisk.length > 0 ? plural(atRisk.length, "club") : undefined}>
        {!shown ? (
          <SkeletonRows rows={2} label="Loading clubs with no activity" />
        ) : atRisk.length === 0 ? (
          <EmptyState title="Every live club was active" body="A club shows up here when nobody in it signs in or does anything for the whole period." />
        ) : (
          <List aria-label="Clubs with no activity">
            {atRisk.map((club) => (
              <ListRow
                key={club.tenantId}
                to={`/platform-admin/tenants/${encodeURIComponent(club.tenantId)}`}
                leading={<StatusDot tone="coral" />}
                title={club.clubName}
                subtitle={club.ownerEmail ? `Owner: ${[club.ownerName, club.ownerEmail].filter(Boolean).join(", ")}` : "No owner contact on file"}
              />
            ))}
          </List>
        )}
      </Section>

      <Section title="By club" hint="People who signed in or did something, and what the club did. Counts only. New is new athletes." meta={shown ? plural(clubs.length, "club") : undefined}>
        {!shown ? (
          <SkeletonRows rows={5} label="Loading usage by club" />
        ) : clubs.length === 0 ? (
          <EmptyState title="No clubs yet" body="Approve a club request and its usage appears here." />
        ) : (
          <DataTable caption={`Usage by club, last ${days} days`} columns={columns} rows={clubs} rowKey={(club) => club.tenantId} rowProps={(club) => ({ "data-club": club.clubName })} />
        )}
      </Section>
    </Screen>
  )
}
