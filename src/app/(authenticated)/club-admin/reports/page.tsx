"use client"

import { useEffect, useState } from "react"
import { DownloadSimple, MagnifyingGlass, Printer } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import { EmptyState, Meter, PageHeader, Panel, ReadinessTag, Segmented, Tag, scoreTone } from "@/components/sk"
import { PersonAvatar } from "@/components/account/person-avatar"
import {
  CLUB_REPORT_WINDOW_DAYS,
  getClubAdminPerformanceReport,
  insertAuditEvent,
} from "@/lib/data/club-admin/ops-data"
import { getBackendMode } from "@/lib/supabase/config"
import { downloadCsv, formatDay, localIsoDay, type MockAuditLogger } from "../ops-format"
import { loadClubTeams, loadClubUsers } from "../state"

type ReportKey = "teams" | "adherence" | "wellness" | "prs"
type Readiness = "green" | "yellow" | "red"
type ReadinessFilter = "all" | Readiness

const NO_TEAM = "__none__"
const READINESS_LABEL = { green: "Ready", yellow: "Watch", red: "Review" } as const

type TeamRow = { id: string; name: string; eventGroup: string | null; status: string; leadCoach: string | null }
type AthleteRow = {
  id: string
  teamId: string | null
  name: string
  eventGroup: string | null
  primaryEvent: string | null
  readiness: Readiness | null
  adherence: number | null
  /** Null when the source does not break adherence into sessions (demo data). */
  sessionsPlanned: number | null
  sessionsDone: number | null
  /** YYYY-MM-DD, or a ready-made label in demo data. */
  lastCheckIn: string | null
}
type PrRow = {
  id: string
  athleteId: string
  event: string
  category: string
  bestValue: string
  previousValue: string | null
  /** YYYY-MM-DD, or a ready-made label in demo data. */
  date: string
  legal: boolean
  wind: string | null
}
type WellnessRow = {
  id: string
  athleteId: string
  date: string
  sleep: number
  soreness: number
  fatigue: number
  mood: number
  stress: number
  readiness: Readiness
  notes: string | null
}
type ReportData = {
  teams: TeamRow[]
  athletes: AthleteRow[]
  prs: PrRow[]
  wellness: WellnessRow[]
  prTotal: number
  wellnessTotal: number
  adherenceComplete: boolean
}

const EMPTY_DATA: ReportData = { teams: [], athletes: [], prs: [], wellness: [], prTotal: 0, wellnessTotal: 0, adherenceComplete: true }

function prLegality(pr: PrRow) {
  if (pr.legal) return pr.wind ? `Legal (${pr.wind})` : "Legal"
  return pr.wind ? `Wind assisted (${pr.wind})` : "Not legal"
}

function average(values: number[]) {
  return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : null
}

function Summary({ items }: { items: Array<{ label: string; value: string | number; unit?: string }> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl bg-sk-canvas p-4 sm:flex sm:flex-wrap sm:gap-x-10 sm:px-5">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col-reverse gap-1">
          <dt className="text-sm font-semibold text-sk-mute">{item.label}</dt>
          <dd className="sk-num text-[1.75rem]">
            {item.value}
            {item.unit ? <span className="ml-0.5 text-sm font-bold tracking-normal text-sk-mute">{item.unit}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function AdherenceCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-sk-mute">No sessions set</span>
  return (
    <span className="flex items-center gap-3">
      <Meter value={value} tone={scoreTone(value)} className="w-28" />
      <span className="w-11 text-right font-bold tabular-nums text-sk-ink">{value}%</span>
    </span>
  )
}

export default function ClubAdminReportsPage() {
  const isSupabaseMode = getBackendMode() === "supabase"
  const [data, setData] = useState<ReportData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [mockAuditLogger, setMockAuditLogger] = useState<MockAuditLogger | null>(null)
  const [report, setReport] = useState<ReportKey>("teams")
  const [search, setSearch] = useState("")
  const [teamFilter, setTeamFilter] = useState("all")
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>("all")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false

    void getClubAdminPerformanceReport().then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setLoadError(result.error.message)
        setLoading(false)
        return
      }
      setLoadError(null)
      setData({
        teams: result.data.teams,
        athletes: result.data.athletes,
        prs: result.data.prs.map((pr) => ({ ...pr, date: pr.measuredOn })),
        wellness: result.data.wellness,
        prTotal: result.data.prTotal,
        wellnessTotal: result.data.wellnessTotal,
        adherenceComplete: result.data.adherenceComplete,
      })
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  useEffect(() => {
    if (isSupabaseMode) return
    let cancelled = false

    void Promise.all([import("@/lib/mock-data"), import("@/lib/mock-audit")]).then(([mockData, mockAudit]) => {
      if (cancelled) return
      const users = loadClubUsers()
      setData({
        teams: loadClubTeams()
          .filter((team) => team.status !== "archived")
          .map((team) => ({
            id: team.id,
            name: team.name,
            eventGroup: team.eventGroup,
            status: team.status,
            leadCoach:
              users.find((user) => user.id === team.coachUserId)?.name ??
              users.find((user) => team.coachEmail && user.email === team.coachEmail)?.name ??
              null,
          })),
        athletes: mockData.mockAthletes.map((athlete) => ({
          id: athlete.id,
          teamId: athlete.teamId,
          name: athlete.name,
          eventGroup: athlete.eventGroup,
          primaryEvent: athlete.primaryEvent,
          readiness: athlete.readiness,
          adherence: athlete.adherence,
          sessionsPlanned: null,
          sessionsDone: null,
          lastCheckIn: athlete.lastWellness && athlete.lastWellness !== "-" ? athlete.lastWellness : null,
        })),
        prs: mockData.mockPRs.map((pr) => ({
          id: pr.id,
          athleteId: pr.athleteId,
          event: pr.event,
          category: pr.category,
          bestValue: pr.bestValue,
          previousValue: pr.previousValue ?? null,
          date: pr.date,
          legal: pr.legal,
          wind: pr.wind ?? null,
        })),
        wellness: mockData.mockWellness.map((entry) => ({ ...entry, notes: entry.notes ?? null })),
        prTotal: mockData.mockPRs.length,
        wellnessTotal: mockData.mockWellness.length,
        adherenceComplete: true,
      })
      setMockAuditLogger(() => mockAudit.logAuditEvent)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  const emitAudit = async (action: string, target: string, detail?: string) => {
    if (isSupabaseMode) {
      const result = await insertAuditEvent({ action, target, detail })
      setAuditError(result.ok ? null : result.error.message)
      return
    }
    mockAuditLogger?.({ actor: "club-admin", action, target, detail })
  }

  const teamById = new Map(data.teams.map((team) => [team.id, team]))
  const athleteById = new Map(data.athletes.map((athlete) => [athlete.id, athlete]))
  const teamName = (teamId: string | null) => (teamId ? teamById.get(teamId)?.name ?? "No team" : "No team")
  const teamKey = (teamId: string | null) => (teamId && teamById.has(teamId) ? teamId : NO_TEAM)
  const hasUnassigned = data.athletes.some((athlete) => teamKey(athlete.teamId) === NO_TEAM)

  const query = search.trim().toLowerCase()
  const matches = (...values: Array<string | null | undefined>) =>
    !query || values.some((value) => (value ?? "").toLowerCase().includes(query))
  const inTeam = (teamId: string | null) => teamFilter === "all" || teamKey(teamId) === teamFilter

  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 6)
  const weekAgoIso = localIsoDay(weekAgo)

  const teamSummaries = [
    ...data.teams.map((team) => ({ key: team.id, name: team.name, eventGroup: team.eventGroup, leadCoach: team.leadCoach, status: team.status })),
    ...(hasUnassigned ? [{ key: NO_TEAM, name: "No team", eventGroup: null, leadCoach: null, status: "" }] : []),
  ].map((team) => {
    const athletes = data.athletes.filter((athlete) => teamKey(athlete.teamId) === team.key)
    const athleteIds = new Set(athletes.map((athlete) => athlete.id))
    const scored = athletes.filter((athlete) => athlete.adherence !== null)
    return {
      ...team,
      athletes: athletes.length,
      adherence: scored.length ? Math.round(scored.reduce((sum, athlete) => sum + (athlete.adherence ?? 0), 0) / scored.length) : null,
      ready: athletes.filter((athlete) => athlete.readiness === "green").length,
      watch: athletes.filter((athlete) => athlete.readiness === "yellow").length,
      review: athletes.filter((athlete) => athlete.readiness === "red").length,
      checkedIn: new Set(data.wellness.filter((entry) => athleteIds.has(entry.athleteId) && entry.date >= weekAgoIso).map((entry) => entry.athleteId)).size,
      prs: data.prs.filter((pr) => athleteIds.has(pr.athleteId)).length,
    }
  })

  const teamRows = teamSummaries
    .filter((team) => teamFilter === "all" || team.key === teamFilter)
    .filter((team) => matches(team.name, team.leadCoach, team.eventGroup))

  const adherenceRows = data.athletes
    .filter((athlete) => inTeam(athlete.teamId))
    .filter((athlete) => matches(athlete.name, athlete.primaryEvent))
    .filter((athlete) => readinessFilter === "all" || athlete.readiness === readinessFilter)
    .sort((left, right) => (left.adherence ?? 101) - (right.adherence ?? 101) || left.name.localeCompare(right.name))

  const wellnessAll = data.wellness.map((entry) => {
    const athlete = athleteById.get(entry.athleteId)
    return { ...entry, athleteName: athlete?.name ?? "Athlete", teamId: athlete?.teamId ?? null }
  })
  const wellnessRows = wellnessAll
    .filter((entry) => inTeam(entry.teamId))
    .filter((entry) => matches(entry.athleteName))
    .filter((entry) => readinessFilter === "all" || entry.readiness === readinessFilter)
    .filter((entry) => (!dateFrom || entry.date >= dateFrom) && (!dateTo || entry.date <= dateTo))
    .sort((left, right) => right.date.localeCompare(left.date) || left.athleteName.localeCompare(right.athleteName))

  const prAll = data.prs.map((pr) => {
    const athlete = athleteById.get(pr.athleteId)
    return { ...pr, athleteName: athlete?.name ?? "Athlete", teamId: athlete?.teamId ?? null }
  })
  const prCategories = [...new Set(prAll.map((pr) => pr.category))].sort()
  const prRows = prAll
    .filter((pr) => inTeam(pr.teamId))
    .filter((pr) => matches(pr.athleteName, pr.event))
    .filter((pr) => categoryFilter === "all" || pr.category === categoryFilter)

  const filtersActive =
    Boolean(query) ||
    teamFilter !== "all" ||
    ((report === "adherence" || report === "wellness") && readinessFilter !== "all") ||
    (report === "prs" && categoryFilter !== "all") ||
    (report === "wellness" && Boolean(dateFrom || dateTo))
  const clearFilters = () => {
    setSearch("")
    setTeamFilter("all")
    setReadinessFilter("all")
    setCategoryFilter("all")
    setDateFrom("")
    setDateTo("")
  }

  const exportReport = async (target: ReportKey, filename: string, rows: string[][]) => {
    downloadCsv(filename, rows)
    await emitAudit("export_csv", target, `${filename}, ${rows.length - 1} rows`)
  }

  const reports = {
    teams: {
      title: "Team summary",
      hint: `One row per team. Adherence and readiness cover the last ${CLUB_REPORT_WINDOW_DAYS} days.`,
      count: teamRows.length,
      total: teamSummaries.length,
      noun: "teams",
      exportLabel: "Teams CSV",
      searchLabel: "Search team or coach",
      searchPlaceholder: "Team or coach",
      onExport: () =>
        exportReport("teams", "club-team-summary.csv", [
          ["Team", "Event group", "Lead coach", "Athletes", "Average plan adherence (%)", "Ready", "Watch", "Review", "Athletes checked in (last 7 days)", "Personal records"],
          ...teamRows.map((team) => [
            team.name,
            team.eventGroup ?? "",
            team.leadCoach ?? "",
            String(team.athletes),
            team.adherence === null ? "" : String(team.adherence),
            String(team.ready),
            String(team.watch),
            String(team.review),
            String(team.checkedIn),
            String(team.prs),
          ]),
        ]),
    },
    adherence: {
      title: "Plan adherence",
      hint: `Sessions done out of sessions set in the last ${CLUB_REPORT_WINDOW_DAYS} days. Lowest first.`,
      count: adherenceRows.length,
      total: data.athletes.length,
      noun: "athletes",
      exportLabel: "Adherence CSV",
      searchLabel: "Search athlete",
      searchPlaceholder: "Name or event",
      onExport: () =>
        exportReport("adherence", "club-adherence.csv", [
          ["Athlete", "Team", "Event group", "Primary event", "Readiness", "Sessions done", "Sessions set", "Plan adherence (%)", "Last check-in"],
          ...adherenceRows.map((athlete) => [
            athlete.name,
            teamName(athlete.teamId),
            athlete.eventGroup ?? "",
            athlete.primaryEvent ?? "",
            athlete.readiness ? READINESS_LABEL[athlete.readiness] : "",
            athlete.sessionsDone === null ? "" : String(athlete.sessionsDone),
            athlete.sessionsPlanned === null ? "" : String(athlete.sessionsPlanned),
            athlete.adherence === null ? "" : String(athlete.adherence),
            athlete.lastCheckIn ?? "",
          ]),
        ]),
    },
    wellness: {
      title: "Wellness check-ins",
      hint: "Daily check-ins from every team, newest first.",
      count: wellnessRows.length,
      total: wellnessAll.length,
      noun: "check-ins",
      exportLabel: "Wellness CSV",
      searchLabel: "Search athlete",
      searchPlaceholder: "Name",
      onExport: () =>
        exportReport("wellness", "club-wellness.csv", [
          ["Athlete", "Team", "Date", "Sleep (hours)", "Soreness (1-5)", "Fatigue (1-5)", "Mood (1-5)", "Stress (1-5)", "Readiness", "Notes"],
          ...wellnessRows.map((entry) => [
            entry.athleteName,
            teamName(entry.teamId),
            entry.date,
            String(entry.sleep),
            String(entry.soreness),
            String(entry.fatigue),
            String(entry.mood),
            String(entry.stress),
            READINESS_LABEL[entry.readiness],
            entry.notes ?? "",
          ]),
        ]),
    },
    prs: {
      title: "Personal records",
      hint: "Every personal best logged across the club, newest first.",
      count: prRows.length,
      total: prAll.length,
      noun: "records",
      exportLabel: "PR CSV",
      searchLabel: "Search athlete or event",
      searchPlaceholder: "Name or event",
      onExport: () =>
        exportReport("prs", "club-prs.csv", [
          ["Athlete", "Team", "Event", "Category", "Best", "Previous", "Date", "Legal / wind"],
          ...prRows.map((pr) => [pr.athleteName, teamName(pr.teamId), pr.event, pr.category, pr.bestValue, pr.previousValue ?? "", pr.date, prLegality(pr)]),
        ]),
    },
  } satisfies Record<ReportKey, unknown>
  const active = reports[report]

  const scoredAdherence = adherenceRows.filter((athlete) => athlete.adherence !== null)
  const adherenceAverage = scoredAdherence.length
    ? Math.round(scoredAdherence.reduce((sum, athlete) => sum + (athlete.adherence ?? 0), 0) / scoredAdherence.length)
    : null

  const capNote =
    report === "prs" && data.prTotal > data.prs.length && data.prs.length > 0
      ? `This report holds the latest ${data.prs.length.toLocaleString()} of ${data.prTotal.toLocaleString()} records on file.`
      : report === "wellness" && data.wellnessTotal > data.wellness.length && data.wellness.length > 0
        ? `This report holds the latest ${data.wellness.length.toLocaleString()} of ${data.wellnessTotal.toLocaleString()} check-ins on file.`
        : report === "teams" && (data.prTotal > data.prs.length || data.wellnessTotal > data.wellness.length)
          ? "Personal record and check-in counts use the latest 1,000 rows of each."
          : (report === "teams" || report === "adherence") && !data.adherenceComplete
            ? "This club has more session history than we can count here, so adherence may be understated."
            : null

  const th = "whitespace-nowrap px-3 py-2.5 font-semibold"
  const td = "whitespace-nowrap px-3 py-3.5"
  const num = "text-right tabular-nums"

  const exportButton = (className: string) => (
    <button type="button" className={`sk-btn sk-btn-primary print:hidden ${className}`} onClick={() => void active.onExport()} disabled={loading || active.count === 0}>
      <DownloadSimple className="size-5" weight="bold" aria-hidden />
      {active.exportLabel}
    </button>
  )

  return (
    <div className="sk-page print:p-0">
      {loadError ? (
        <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
          We could not load the club reports. {loadError}
        </p>
      ) : null}
      {auditError ? (
        <p role="alert" className="rounded-2xl bg-sk-yellow-tint px-4 py-3 text-sm font-semibold text-[#7a5600]">
          Your file downloaded, but we could not add the export to the activity log. {auditError}
        </p>
      ) : null}

      <PageHeader
        title="Reports"
        lede="Teams, adherence, wellness and personal records across the whole club. What you see in the table is what you download."
        actions={
          <button
            type="button"
            className="sk-btn sk-btn-quiet print:hidden"
            onClick={() => {
              window.print()
              void emitAudit("export_pdf", "reports", active.title)
            }}
          >
            <Printer className="size-5" weight="bold" aria-hidden />
            Print / PDF
          </button>
        }
      />

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 print:hidden">
        <Segmented<ReportKey>
          label="Choose a report"
          value={report}
          onChange={setReport}
          options={[
            { value: "teams", label: "Teams" },
            { value: "adherence", label: "Adherence" },
            { value: "wellness", label: "Wellness" },
            { value: "prs", label: "PRs" },
          ]}
        />
      </div>

      <Panel title={active.title} hint={active.hint} action={exportButton("hidden sm:inline-flex")}>
        <div role="tabpanel" aria-label={active.title} className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:flex lg:flex-wrap lg:items-end print:hidden">
            {active.total > 0 ? (
              <>
                <label className="col-span-2 block lg:w-64">
                  <span className="sk-label mb-1.5 block">{active.searchLabel}</span>
                  <span className="relative block">
                    <MagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-sk-mute" weight="bold" aria-hidden />
                    <input
                      type="search"
                      className="sk-field pl-11"
                      placeholder={active.searchPlaceholder}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </span>
                </label>

                <label className={`block min-w-0 lg:w-48 ${report === "teams" ? "col-span-2" : ""}`}>
                  <span className="sk-label mb-1.5 block">Team</span>
                  <select className="sk-field" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
                    <option value="all">All teams</option>
                    {data.teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                    {hasUnassigned ? <option value={NO_TEAM}>No team</option> : null}
                  </select>
                </label>

                {report === "prs" ? (
                  <label className="block min-w-0 lg:w-44">
                    <span className="sk-label mb-1.5 block">Category</span>
                    <select className="sk-field" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                      <option value="all">All categories</option>
                      {prCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {report === "adherence" || report === "wellness" ? (
                  <label className="block min-w-0 lg:w-40">
                    <span className="sk-label mb-1.5 block">Readiness</span>
                    <select className="sk-field" value={readinessFilter} onChange={(event) => setReadinessFilter(event.target.value as ReadinessFilter)}>
                      <option value="all">All</option>
                      <option value="green">Ready</option>
                      <option value="yellow">Watch</option>
                      <option value="red">Review</option>
                    </select>
                  </label>
                ) : null}

                {report === "wellness" ? (
                  <>
                    <label className="block min-w-0 lg:w-44">
                      <span className="sk-label mb-1.5 block">From</span>
                      <input type="date" className="sk-field" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} />
                    </label>
                    <label className="block min-w-0 lg:w-44">
                      <span className="sk-label mb-1.5 block">To</span>
                      <input type="date" className="sk-field" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} />
                    </label>
                  </>
                ) : null}

                {filtersActive ? (
                  <button type="button" className="sk-btn sk-btn-ghost col-span-2 justify-self-start" onClick={clearFilters}>
                    Clear filters
                  </button>
                ) : null}
              </>
            ) : null}

            {exportButton("col-span-2 sm:hidden")}
          </div>

          {loading ? (
            <p className="py-10 text-center text-sm font-semibold text-sk-mute" role="status">
              Loading club reports
            </p>
          ) : loadError ? null : active.total === 0 ? (
            report === "teams" ? (
              <EmptyState
                className="border-0 bg-sk-canvas"
                title="No teams yet"
                body="Create your first team and add athletes. Each team then gets a row here with its adherence and readiness."
                action={
                  <Link to="/club-admin/teams" className="sk-btn sk-btn-quiet sk-btn-sm">
                    Go to teams
                  </Link>
                }
              />
            ) : report === "adherence" ? (
              <EmptyState
                className="border-0 bg-sk-canvas"
                title="No athletes in the club yet"
                body="Once athletes join a team and have sessions set, their plan adherence shows up here."
                action={
                  <Link to="/club-admin/users" className="sk-btn sk-btn-quiet sk-btn-sm">
                    Go to people
                  </Link>
                }
              />
            ) : report === "prs" ? (
              <EmptyState
                className="border-0 bg-sk-canvas"
                title="No personal records yet"
                body="When a coach or athlete logs a new best mark, it lands in this report."
              />
            ) : (
              <EmptyState
                className="border-0 bg-sk-canvas"
                title="No wellness check-ins yet"
                body="Each daily check-in an athlete submits (sleep, soreness, fatigue, mood, stress) appears here."
              />
            )
          ) : active.count === 0 ? (
            <EmptyState
              className="border-0 bg-sk-canvas"
              title="Nothing matches these filters"
              body={`There are ${active.total} ${active.noun} in this report, but none fit the current search and filters.`}
              action={
                <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm" onClick={clearFilters}>
                  Clear filters
                </button>
              }
            />
          ) : (
            <>
              {report === "teams" ? (
                <Summary
                  items={[
                    { label: "Teams", value: teamRows.filter((team) => team.key !== NO_TEAM).length },
                    { label: "Athletes", value: teamRows.reduce((sum, team) => sum + team.athletes, 0) },
                    { label: "Ready", value: teamRows.reduce((sum, team) => sum + team.ready, 0) },
                    { label: "Watch", value: teamRows.reduce((sum, team) => sum + team.watch, 0) },
                    { label: "Review", value: teamRows.reduce((sum, team) => sum + team.review, 0) },
                  ]}
                />
              ) : null}

              {report === "adherence" ? (
                <Summary
                  items={[
                    adherenceAverage === null
                      ? { label: "Average adherence", value: "None" }
                      : { label: "Average adherence", value: adherenceAverage, unit: "%" },
                    { label: "Ready", value: adherenceRows.filter((athlete) => athlete.readiness === "green").length },
                    { label: "Watch", value: adherenceRows.filter((athlete) => athlete.readiness === "yellow").length },
                    { label: "Review", value: adherenceRows.filter((athlete) => athlete.readiness === "red").length },
                  ]}
                />
              ) : null}

              {report === "wellness" ? (
                <Summary
                  items={[
                    { label: "Average sleep", value: average(wellnessRows.map((entry) => entry.sleep)) ?? "0", unit: "h" },
                    { label: "Soreness", value: average(wellnessRows.map((entry) => entry.soreness)) ?? "0", unit: "/ 5" },
                    { label: "Fatigue", value: average(wellnessRows.map((entry) => entry.fatigue)) ?? "0", unit: "/ 5" },
                    { label: "Mood", value: average(wellnessRows.map((entry) => entry.mood)) ?? "0", unit: "/ 5" },
                    { label: "Stress", value: average(wellnessRows.map((entry) => entry.stress)) ?? "0", unit: "/ 5" },
                  ]}
                />
              ) : null}

              {report === "prs" ? (
                <Summary
                  items={[
                    { label: "Records", value: prRows.length },
                    { label: "Athletes", value: new Set(prRows.map((pr) => pr.athleteId)).size },
                    { label: "Events", value: new Set(prRows.map((pr) => pr.event)).size },
                  ]}
                />
              ) : null}

              <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6 print:overflow-visible">
                {report === "teams" ? (
                  <table className="w-full min-w-[860px] text-left">
                    <caption className="sr-only">Summary by team</caption>
                    <thead>
                      <tr className="border-b border-sk-line text-sm text-sk-mute">
                        <th scope="col" className={`${th} pl-0`}>Team</th>
                        <th scope="col" className={th}>Lead coach</th>
                        <th scope="col" className={`${th} text-right`}>Athletes</th>
                        <th scope="col" className={th}>Average adherence</th>
                        <th scope="col" className={`${th} text-right`}>Ready</th>
                        <th scope="col" className={`${th} text-right`}>Watch</th>
                        <th scope="col" className={`${th} text-right`}>Review</th>
                        <th scope="col" className={`${th} text-right`}>Checked in, 7 days</th>
                        <th scope="col" className={`${th} pr-0 text-right`}>PRs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamRows.map((team) => (
                        <tr key={team.key} className="border-b border-sk-line last:border-b-0">
                          <th scope="row" className={`${td} pl-0 font-normal`}>
                            <span className="block font-bold text-sk-ink">{team.name}</span>
                            <span className="block text-sm text-sk-mute">
                              {team.key === NO_TEAM ? "Athletes not on a team" : [team.eventGroup, team.status === "draft" ? "Draft" : null].filter(Boolean).join(", ") || "No event group"}
                            </span>
                          </th>
                          <td className={`${td} text-sk-ink-2`}>{team.leadCoach ?? <span className="text-sk-mute">Not assigned</span>}</td>
                          <td className={`${td} ${num} font-bold text-sk-ink`}>{team.athletes}</td>
                          <td className={td}>
                            {team.athletes === 0 ? <span className="text-sk-mute">No athletes</span> : <AdherenceCell value={team.adherence} />}
                          </td>
                          <td className={`${td} ${num} font-semibold text-sk-ink`}>{team.ready}</td>
                          <td className={`${td} ${num} font-semibold text-sk-ink`}>{team.watch}</td>
                          <td className={`${td} ${num} font-semibold ${team.review > 0 ? "text-[#b32a0c]" : "text-sk-ink"}`}>{team.review}</td>
                          <td className={`${td} ${num} text-sk-ink-2`}>
                            {team.checkedIn} of {team.athletes}
                          </td>
                          <td className={`${td} ${num} pr-0 font-semibold text-sk-ink`}>{team.prs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                {report === "adherence" ? (
                  <table className="w-full min-w-[820px] text-left">
                    <caption className="sr-only">Plan adherence by athlete</caption>
                    <thead>
                      <tr className="border-b border-sk-line text-sm text-sk-mute">
                        <th scope="col" className={`${th} pl-0`}>Athlete</th>
                        <th scope="col" className={th}>Team</th>
                        <th scope="col" className={th}>Readiness</th>
                        {isSupabaseMode ? <th scope="col" className={`${th} text-right`}>Sessions done</th> : null}
                        <th scope="col" className={th}>Plan adherence</th>
                        <th scope="col" className={`${th} pr-0 text-right`}>Last check-in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adherenceRows.map((athlete) => (
                        <tr key={athlete.id} className="border-b border-sk-line last:border-b-0">
                          <th scope="row" className={`${td} pl-0 font-normal`}>
                            <span className="flex items-center gap-3">
                              <PersonAvatar name={athlete.name} athleteId={athlete.id} size="sm" />
                              <span>
                                <span className="block font-bold text-sk-ink">{athlete.name}</span>
                                <span className="block text-sm text-sk-mute">{athlete.primaryEvent ?? athlete.eventGroup ?? "No event set"}</span>
                              </span>
                            </span>
                          </th>
                          <td className={`${td} text-sk-ink-2`}>{teamName(athlete.teamId)}</td>
                          <td className={td}>{athlete.readiness ? <ReadinessTag status={athlete.readiness} /> : <span className="text-sk-mute">Not set</span>}</td>
                          {isSupabaseMode ? (
                            <td className={`${td} ${num} text-sk-ink-2`}>
                              {athlete.sessionsPlanned ? `${athlete.sessionsDone ?? 0} of ${athlete.sessionsPlanned}` : ""}
                            </td>
                          ) : null}
                          <td className={td}>
                            <AdherenceCell value={athlete.adherence} />
                          </td>
                          <td className={`${td} pr-0 text-right text-sk-ink-2`}>
                            {athlete.lastCheckIn ? formatDay(athlete.lastCheckIn) : <span className="text-sk-mute">None yet</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                {report === "prs" ? (
                  <table className="w-full min-w-[820px] text-left">
                    <caption className="sr-only">Personal records</caption>
                    <thead>
                      <tr className="border-b border-sk-line text-sm text-sk-mute">
                        <th scope="col" className={`${th} pl-0`}>Athlete</th>
                        <th scope="col" className={th}>Team</th>
                        <th scope="col" className={th}>Event</th>
                        <th scope="col" className={th}>Category</th>
                        <th scope="col" className={`${th} text-right`}>Best</th>
                        <th scope="col" className={`${th} text-right`}>Previous</th>
                        <th scope="col" className={th}>Date</th>
                        <th scope="col" className={`${th} pr-0`}>Legal / wind</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prRows.map((pr) => (
                        <tr key={pr.id} className="border-b border-sk-line last:border-b-0">
                          <th scope="row" className={`${td} pl-0 font-bold text-sk-ink`}>{pr.athleteName}</th>
                          <td className={`${td} text-sk-ink-2`}>{teamName(pr.teamId)}</td>
                          <td className={`${td} text-sk-ink-2`}>{pr.event}</td>
                          <td className={`${td} text-sk-ink-2`}>{pr.category}</td>
                          <td className={`${td} ${num} text-lg font-extrabold text-sk-ink`}>{pr.bestValue}</td>
                          <td className={`${td} ${num} text-sk-mute`}>{pr.previousValue ?? "First mark"}</td>
                          <td className={`${td} text-sk-ink-2`}>{formatDay(pr.date)}</td>
                          <td className={`${td} pr-0`}>
                            {pr.legal ? <span className="text-sk-ink-2">{prLegality(pr)}</span> : <Tag tone="yellow">{prLegality(pr)}</Tag>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                {report === "wellness" ? (
                  <table className="w-full min-w-[940px] text-left">
                    <caption className="sr-only">Wellness check-ins</caption>
                    <thead>
                      <tr className="border-b border-sk-line text-sm text-sk-mute">
                        <th scope="col" className={`${th} pl-0`}>Athlete</th>
                        <th scope="col" className={th}>Team</th>
                        <th scope="col" className={th}>Date</th>
                        <th scope="col" className={`${th} text-right`}>Sleep (h)</th>
                        <th scope="col" className={`${th} text-right`}>Soreness</th>
                        <th scope="col" className={`${th} text-right`}>Fatigue</th>
                        <th scope="col" className={`${th} text-right`}>Mood</th>
                        <th scope="col" className={`${th} text-right`}>Stress</th>
                        <th scope="col" className={th}>Readiness</th>
                        <th scope="col" className={`${th} pr-0`}>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wellnessRows.map((entry) => (
                        <tr key={entry.id} className="border-b border-sk-line last:border-b-0">
                          <th scope="row" className={`${td} pl-0 font-bold text-sk-ink`}>{entry.athleteName}</th>
                          <td className={`${td} text-sk-ink-2`}>{teamName(entry.teamId)}</td>
                          <td className={`${td} text-sk-ink-2`}>{formatDay(entry.date)}</td>
                          <td className={`${td} ${num} font-semibold text-sk-ink`}>{entry.sleep}</td>
                          <td className={`${td} ${num} font-semibold text-sk-ink`}>{entry.soreness}</td>
                          <td className={`${td} ${num} font-semibold text-sk-ink`}>{entry.fatigue}</td>
                          <td className={`${td} ${num} font-semibold text-sk-ink`}>{entry.mood}</td>
                          <td className={`${td} ${num} font-semibold text-sk-ink`}>{entry.stress}</td>
                          <td className={td}>
                            <ReadinessTag status={entry.readiness} />
                          </td>
                          <td className="max-w-[260px] truncate px-3 py-3.5 pr-0 text-sm text-sk-ink-2" title={entry.notes ?? undefined}>
                            {entry.notes ?? ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>

              <p className="text-sm text-sk-mute" aria-live="polite">
                Showing {active.count} of {active.total} {active.noun}
                {report === "wellness" ? ". Soreness, fatigue, mood and stress are scored 1 to 5." : "."}
                {capNote ? ` ${capNote}` : ""}
              </p>
            </>
          )}
        </div>
      </Panel>
    </div>
  )
}
