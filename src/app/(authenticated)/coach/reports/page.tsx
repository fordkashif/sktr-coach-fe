"use client"

import { useEffect, useState } from "react"
import { DownloadSimple, MagnifyingGlass, Printer } from "@phosphor-icons/react"
import { BarChart } from "@mui/x-charts"
import { Link } from "react-router-dom"
import { EmptyState, Meter, PageHeader, Panel, ReadinessTag, Segmented, Tag, scoreTone } from "@/components/sk"
import { PersonAvatar } from "@/components/account/person-avatar"
import { useCoachTeamScope } from "@/lib/coach-teams"
import type { Athlete, PR, Team, WellnessEntry } from "@/lib/mock-data"
import {
  getCoachDashboardSnapshotForCurrentUser,
  getCoachWellnessEntriesForCurrentUser,
  type CoachDashboardSnapshot,
} from "@/lib/data/coach/dashboard-data"
import { getBackendMode } from "@/lib/supabase/config"

type ReportKey = "adherence" | "prs" | "wellness"
type ReadinessFilter = "all" | "green" | "yellow" | "red"

const READINESS_LABEL = { green: "Ready", yellow: "Watch", red: "Review" } as const

const chartSx = {
  "& .MuiChartsAxis-line, & .MuiChartsAxis-tick": { stroke: "transparent" },
  "& .MuiChartsAxis-tickLabel": { fill: "#6a7385", fontSize: 12, fontFamily: "inherit", fontWeight: 600 },
  "& .MuiChartsGrid-line": { stroke: "#e3e6ee" },
  "& .MuiBarElement-root": { rx: 8, ry: 8 },
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

function prLegality(pr: PR) {
  if (pr.legal) return pr.wind ? `Legal (${pr.wind})` : "Legal"
  return pr.wind ? `Wind assisted (${pr.wind})` : "Not legal"
}

function longDate(isoDate: string) {
  const parsed = new Date(`${isoDate}T00:00:00`)
  return Number.isNaN(parsed.getTime())
    ? isoDate
    : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
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

export default function CoachReportsPage() {
  const { role, coachTeamId } = useCoachTeamScope()
  // One report screen per team: switching team reloads the data and clears the filters.
  return <CoachReports key={coachTeamId ?? "all"} role={role} coachTeamId={coachTeamId} />
}

function CoachReports({ role, coachTeamId }: { role: string | null; coachTeamId: string | null }) {
  const backendMode = getBackendMode()
  const [backendSnapshot, setBackendSnapshot] = useState<CoachDashboardSnapshot | null>(null)
  const [backendWellness, setBackendWellness] = useState<WellnessEntry[]>([])
  const [backendError, setBackendError] = useState<string | null>(null)
  const [mockData, setMockData] = useState<{
    athletes: Athlete[]
    prs: PR[]
    teams: Team[]
    wellness: WellnessEntry[]
  }>({ athletes: [], prs: [], teams: [], wellness: [] })
  const [mockLoaded, setMockLoaded] = useState(false)
  const [report, setReport] = useState<ReportKey>("adherence")
  const [search, setSearch] = useState("")
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>("all")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  useEffect(() => {
    if (backendMode !== "supabase") return
    let cancelled = false

    const loadSnapshot = async () => {
      const [snapshotResult, wellnessResult] = await Promise.all([
        getCoachDashboardSnapshotForCurrentUser({ scopeTeamId: role === "coach" ? coachTeamId : null }),
        getCoachWellnessEntriesForCurrentUser({ scopeTeamId: role === "coach" ? coachTeamId : null }),
      ])
      if (cancelled) return

      if (!snapshotResult.ok) {
        setBackendError(snapshotResult.error.message)
        return
      }
      if (!wellnessResult.ok) {
        setBackendError(wellnessResult.error.message)
        return
      }

      setBackendError(null)
      setBackendSnapshot(snapshotResult.data)
      setBackendWellness(wellnessResult.data)
    }

    void loadSnapshot()
    return () => {
      cancelled = true
    }
  }, [backendMode, coachTeamId, role])

  useEffect(() => {
    if (backendMode === "supabase") return
    let cancelled = false

    void import("@/lib/mock-data").then((module) => {
      if (!cancelled) {
        setMockData({
          athletes: module.mockAthletes,
          prs: module.mockPRs,
          teams: module.mockTeams,
          wellness: module.mockWellness,
        })
        setMockLoaded(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [backendMode])

  const sourceAthletes = backendMode === "supabase" ? (backendSnapshot?.athletes ?? []) : mockData.athletes
  const sourcePrs = backendMode === "supabase" ? (backendSnapshot?.prs ?? []) : mockData.prs
  const sourceTeams = backendMode === "supabase" ? (backendSnapshot?.teams ?? []) : mockData.teams
  const sourceWellness = backendMode === "supabase" ? backendWellness : mockData.wellness
  const scopedAthletes =
    role === "coach" && coachTeamId ? sourceAthletes.filter((athlete) => athlete.teamId === coachTeamId) : sourceAthletes
  const athleteIds = new Set(scopedAthletes.map((athlete) => athlete.id))
  const scopedPrs = sourcePrs.filter((pr) => athleteIds.has(pr.athleteId))
  const scopedWellness = sourceWellness.filter((entry) => athleteIds.has(entry.athleteId))
  const scopedTeam = sourceTeams.find((team) => team.id === coachTeamId)


  const loading = backendMode === "supabase" ? !backendSnapshot && !backendError : !mockLoaded
  const athleteNameById = new Map(scopedAthletes.map((athlete) => [athlete.id, athlete.name]))
  const query = search.trim().toLowerCase()
  const matchesSearch = (name: string) => !query || name.toLowerCase().includes(query)

  const adherenceRows = [...scopedAthletes]
    .filter((athlete) => matchesSearch(athlete.name))
    .filter((athlete) => readinessFilter === "all" || athlete.readiness === readinessFilter)
    .sort((left, right) => left.adherence - right.adherence)

  const prCategories = [...new Set(scopedPrs.map((pr) => pr.category))].sort()
  const prRows = scopedPrs
    .filter((pr) => matchesSearch(pr.athleteName) || pr.event.toLowerCase().includes(query))
    .filter((pr) => categoryFilter === "all" || pr.category === categoryFilter)
  const prChartRows = Object.entries(
    prRows.reduce<Record<string, number>>((acc, pr) => {
      acc[pr.category] = (acc[pr.category] ?? 0) + 1
      return acc
    }, {}),
  )
    .sort((left, right) => right[1] - left[1])
    .map(([category, count]) => ({ category, count }))

  const wellnessRows = scopedWellness
    .map((entry) => ({ ...entry, athleteName: athleteNameById.get(entry.athleteId) ?? "Athlete" }))
    .filter((entry) => matchesSearch(entry.athleteName))
    .filter((entry) => readinessFilter === "all" || entry.readiness === readinessFilter)
    .filter((entry) => (!dateFrom || entry.date >= dateFrom) && (!dateTo || entry.date <= dateTo))
    .sort((left, right) => right.date.localeCompare(left.date))

  const filtersActive =
    Boolean(query) ||
    (report !== "prs" && readinessFilter !== "all") ||
    (report === "prs" && categoryFilter !== "all") ||
    (report === "wellness" && Boolean(dateFrom || dateTo))
  const clearFilters = () => {
    setSearch("")
    setReadinessFilter("all")
    setCategoryFilter("all")
    setDateFrom("")
    setDateTo("")
  }

  const exportAthleteAdherence = () => {
    downloadCsv("coach-athlete-adherence.csv", [
      ["Athlete", "Event group", "Primary event", "Readiness", "Plan adherence (%)", "Last check-in"],
      ...adherenceRows.map((athlete) => [
        athlete.name,
        athlete.eventGroup,
        athlete.primaryEvent,
        READINESS_LABEL[athlete.readiness],
        String(athlete.adherence),
        athlete.lastWellness === "-" ? "" : athlete.lastWellness,
      ]),
    ])
  }

  const exportPrs = () => {
    downloadCsv("coach-pr-report.csv", [
      ["Athlete", "Event", "Category", "Best", "Previous", "Date", "Legal / wind"],
      ...prRows.map((pr) => [pr.athleteName, pr.event, pr.category, pr.bestValue, pr.previousValue ?? "", pr.date, prLegality(pr)]),
    ])
  }

  const exportWellness = () => {
    downloadCsv("coach-wellness-export.csv", [
      ["Athlete", "Date", "Sleep (hours)", "Soreness (1-5)", "Fatigue (1-5)", "Mood (1-5)", "Stress (1-5)", "Readiness", "Notes"],
      ...wellnessRows.map((entry) => [
        entry.athleteName,
        entry.date,
        String(entry.sleep),
        String(entry.soreness),
        String(entry.fatigue),
        String(entry.mood),
        String(entry.stress),
        READINESS_LABEL[entry.readiness],
        entry.notes ?? "",
      ]),
    ])
  }

  const reports = {
    adherence: {
      title: "Plan adherence",
      hint: "Lowest adherence first, so you can see who to follow up with.",
      count: adherenceRows.length,
      total: scopedAthletes.length,
      noun: "athletes",
      exportLabel: "Adherence CSV",
      onExport: exportAthleteAdherence,
    },
    prs: {
      title: "Personal records",
      hint: "Every personal best logged for your athletes.",
      count: prRows.length,
      total: scopedPrs.length,
      noun: "records",
      exportLabel: "PR CSV",
      onExport: exportPrs,
    },
    wellness: {
      title: "Wellness check-ins",
      hint: "Daily check-ins from your athletes, newest first.",
      count: wellnessRows.length,
      total: scopedWellness.length,
      noun: "check-ins",
      exportLabel: "Wellness CSV",
      onExport: exportWellness,
    },
  } satisfies Record<ReportKey, unknown>
  const active = reports[report]

  const adherenceAverage = adherenceRows.length
    ? Math.round(adherenceRows.reduce((sum, athlete) => sum + athlete.adherence, 0) / adherenceRows.length)
    : null

  const th = "whitespace-nowrap px-3 py-2.5 font-semibold"
  const td = "whitespace-nowrap px-3 py-3.5"
  const num = "text-right tabular-nums"

  return (
    <div className="sk-page print:p-0">
      {backendError ? (
        <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
          We could not load your reports. {backendError}
        </p>
      ) : null}

      <PageHeader
        title="Reports"
        lede={
          scopedTeam
            ? `Adherence, personal records and wellness for ${scopedTeam.name}. What you see in the table is what you download.`
            : "Adherence, personal records and wellness for your athletes. What you see in the table is what you download."
        }
        actions={
          <button type="button" className="sk-btn sk-btn-quiet print:hidden" onClick={() => window.print()}>
            <Printer className="size-5" weight="bold" aria-hidden />
            Print / PDF
          </button>
        }
      />

      <Segmented<ReportKey>
        label="Choose a report"
        value={report}
        onChange={setReport}
        className="print:hidden"
        options={[
          { value: "adherence", label: "Adherence" },
          { value: "prs", label: "PRs" },
          { value: "wellness", label: "Wellness" },
        ]}
      />

      <Panel
        title={active.title}
        hint={active.hint}
        action={
          <button
            type="button"
            className="sk-btn sk-btn-primary hidden sm:inline-flex print:hidden"
            onClick={active.onExport}
          >
            <DownloadSimple className="size-5" weight="bold" aria-hidden />
            {active.exportLabel}
          </button>
        }
      >
        <div role="tabpanel" aria-label={active.title} className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:flex lg:flex-wrap lg:items-end print:hidden">
            {active.total > 0 ? (
              <>
            <label className="col-span-2 block lg:w-72">
              <span className="sk-label mb-1.5 block">{report === "prs" ? "Search athlete or event" : "Search athlete"}</span>
              <span className="relative block">
                <MagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-sk-mute" weight="bold" aria-hidden />
                <input
                  type="search"
                  className="sk-field pl-11"
                  placeholder={report === "prs" ? "Name or event" : "Name"}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </span>
            </label>

            {report === "prs" ? (
              <label className="col-span-2 block lg:w-48">
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
            ) : (
              <label className="col-span-2 block lg:w-48">
                <span className="sk-label mb-1.5 block">Readiness</span>
                <select
                  className="sk-field"
                  value={readinessFilter}
                  onChange={(event) => setReadinessFilter(event.target.value as ReadinessFilter)}
                >
                  <option value="all">All</option>
                  <option value="green">Ready</option>
                  <option value="yellow">Watch</option>
                  <option value="red">Review</option>
                </select>
              </label>
            )}

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

            <button
              type="button"
              className="sk-btn sk-btn-primary col-span-2 sm:hidden"
              onClick={active.onExport}
            >
              <DownloadSimple className="size-5" weight="bold" aria-hidden />
              {active.exportLabel}
            </button>
          </div>

          {loading ? (
            <p className="py-10 text-center text-sm font-semibold text-sk-mute" role="status">
              Loading your reports
            </p>
          ) : active.total === 0 ? (
            report === "adherence" ? (
              <EmptyState
                className="border-0 bg-sk-canvas"
                title="No athletes on your roster yet"
                body="Once athletes join your team and have sessions scheduled, their plan adherence shows up here."
                action={
                  <Link to="/coach/teams" className="sk-btn sk-btn-quiet sk-btn-sm">
                    Go to teams
                  </Link>
                }
              />
            ) : report === "prs" ? (
              <EmptyState
                className="border-0 bg-sk-canvas"
                title="No personal records yet"
                body="When you or your athletes log a new best mark, it lands in this report."
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
              {report === "adherence" ? (
                <Summary
                  items={[
                    { label: "Average adherence", value: adherenceAverage ?? 0, unit: "%" },
                    { label: "Ready", value: adherenceRows.filter((athlete) => athlete.readiness === "green").length },
                    { label: "Watch", value: adherenceRows.filter((athlete) => athlete.readiness === "yellow").length },
                    { label: "Review", value: adherenceRows.filter((athlete) => athlete.readiness === "red").length },
                  ]}
                />
              ) : null}

              {report === "prs" && prChartRows.length > 1 ? (
                <div className="rounded-2xl bg-sk-canvas p-3">
                  <p className="px-2 pt-1 text-sm font-semibold text-sk-mute">Records by category</p>
                  <BarChart
                    dataset={prChartRows}
                    xAxis={[{ scaleType: "band", dataKey: "category", disableLine: true, disableTicks: true, tickLabelStyle: { fill: "#6a7385", fontSize: 12, fontFamily: "inherit", fontWeight: 600 } }]}
                    yAxis={[{ tickMinStep: 1, disableLine: true, disableTicks: true, tickLabelStyle: { fill: "#6a7385", fontSize: 12, fontFamily: "inherit", fontWeight: 600 } }]}
                    series={[{ dataKey: "count", label: "Records", color: "#2152ff" }]}
                    grid={{ horizontal: true }}
                    hideLegend
                    margin={{ left: 0, right: 12, top: 16, bottom: 0 }}
                    height={200}
                    sx={chartSx}
                  />
                </div>
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

              <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6 print:overflow-visible">
                {report === "adherence" ? (
                  <table className="w-full min-w-[680px] text-left">
                    <caption className="sr-only">Plan adherence by athlete</caption>
                    <thead>
                      <tr className="border-b border-sk-line text-sm text-sk-mute">
                        <th scope="col" className={`${th} pl-0`}>Athlete</th>
                        <th scope="col" className={th}>Event group</th>
                        <th scope="col" className={th}>Readiness</th>
                        <th scope="col" className={th}>Plan adherence</th>
                        <th scope="col" className={`${th} pr-0 text-right`}>Last check-in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adherenceRows.map((athlete) => (
                        <tr key={athlete.id} className="border-b border-sk-line last:border-b-0">
                          <th scope="row" className={`${td} pl-0 font-normal`}>
                            <Link to={`/coach/athletes/${athlete.id}`} className="group flex items-center gap-3">
                              <PersonAvatar name={athlete.name} athleteId={athlete.id} size="sm" />
                              <span>
                                <span className="block font-bold text-sk-ink group-hover:text-sk-blue">{athlete.name}</span>
                                <span className="block text-sm text-sk-mute">{athlete.primaryEvent}</span>
                              </span>
                            </Link>
                          </th>
                          <td className={`${td} text-sk-ink-2`}>{athlete.eventGroup}</td>
                          <td className={td}>
                            <ReadinessTag status={athlete.readiness} />
                          </td>
                          <td className={td}>
                            <span className="flex items-center gap-3">
                              <Meter value={athlete.adherence} tone={scoreTone(athlete.adherence)} className="w-28" />
                              <span className="w-11 text-right font-bold tabular-nums text-sk-ink">{athlete.adherence}%</span>
                            </span>
                          </td>
                          <td className={`${td} pr-0 text-right text-sk-ink-2`}>
                            {athlete.lastWellness && athlete.lastWellness !== "-" ? athlete.lastWellness : <span className="text-sk-mute">None yet</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                {report === "prs" ? (
                  <table className="w-full min-w-[720px] text-left">
                    <caption className="sr-only">Personal records</caption>
                    <thead>
                      <tr className="border-b border-sk-line text-sm text-sk-mute">
                        <th scope="col" className={`${th} pl-0`}>Athlete</th>
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
                          <th scope="row" className={`${td} pl-0 font-bold text-sk-ink`}>
                            <Link to={`/coach/athletes/${pr.athleteId}`} className="hover:text-sk-blue">
                              {pr.athleteName}
                            </Link>
                          </th>
                          <td className={`${td} text-sk-ink-2`}>{pr.event}</td>
                          <td className={`${td} text-sk-ink-2`}>{pr.category}</td>
                          <td className={`${td} ${num} text-lg font-extrabold text-sk-ink`}>{pr.bestValue}</td>
                          <td className={`${td} ${num} text-sk-mute`}>{pr.previousValue ?? "First mark"}</td>
                          <td className={`${td} text-sk-ink-2`}>{pr.date}</td>
                          <td className={`${td} pr-0`}>
                            {pr.legal ? <span className="text-sk-ink-2">{prLegality(pr)}</span> : <Tag tone="yellow">{prLegality(pr)}</Tag>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                {report === "wellness" ? (
                  <table className="w-full min-w-[860px] text-left">
                    <caption className="sr-only">Wellness check-ins</caption>
                    <thead>
                      <tr className="border-b border-sk-line text-sm text-sk-mute">
                        <th scope="col" className={`${th} pl-0`}>Athlete</th>
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
                          <th scope="row" className={`${td} pl-0 font-bold text-sk-ink`}>
                            <Link to={`/coach/athletes/${entry.athleteId}`} className="hover:text-sk-blue">
                              {entry.athleteName}
                            </Link>
                          </th>
                          <td className={`${td} text-sk-ink-2`}>{longDate(entry.date)}</td>
                          <td className={`${td} ${num} font-semibold text-sk-ink`}>{entry.sleep}</td>
                          <td className={`${td} ${num} font-semibold text-sk-ink`}>{entry.soreness}</td>
                          <td className={`${td} ${num} font-semibold text-sk-ink`}>{entry.fatigue}</td>
                          <td className={`${td} ${num} font-semibold text-sk-ink`}>{entry.mood}</td>
                          <td className={`${td} ${num} font-semibold text-sk-ink`}>{entry.stress}</td>
                          <td className={td}>
                            <ReadinessTag status={entry.readiness} />
                          </td>
                          <td className="max-w-[260px] truncate px-3 py-3.5 pr-0 text-sm text-sk-ink-2" title={entry.notes}>
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
              </p>
            </>
          )}
        </div>
      </Panel>
    </div>
  )
}
