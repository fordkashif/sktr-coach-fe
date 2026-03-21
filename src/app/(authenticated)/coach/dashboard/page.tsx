import { useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  BitcoinDown02Icon,
  BitcoinUp02Icon,
  MinusSignIcon,
  Alert02Icon,
  ChartHistogramIcon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons"
import { Link } from "react-router-dom"
import { BarChart, LineChart } from "@mui/x-charts"
import { COACH_TEAM_COOKIE, getCookieValue, ROLE_COOKIE } from "@/lib/auth-session"
import { Button } from "@/components/ui/button"
import { mockAthletes, mockPRs, mockTeams, mockTestWeekResults, mockTrendSeries } from "@/lib/mock-data"
import {
  getCoachDashboardSnapshotForCurrentUser,
  type CoachDashboardSnapshot,
} from "@/lib/data/coach/dashboard-data"
import { getBackendMode } from "@/lib/supabase/config"
import { cn } from "@/lib/utils"

const chartSx = {
  "& .MuiChartsAxis-line, & .MuiChartsAxis-tick": {
    stroke: "#cbd5e1",
  },
  "& .MuiChartsAxis-tickLabel": {
    fill: "#64748b",
    fontSize: 11,
    fontFamily: "inherit",
  },
  "& .MuiChartsGrid-line": {
    stroke: "#dbe4f0",
    strokeDasharray: "4 6",
  },
  "& .MuiMarkElement-root": {
    strokeWidth: 0,
  },
  "& .MuiLineElement-root": {
    strokeLinecap: "round",
  },
}

function ChangeIcon({ change }: { change: "up" | "down" | "same" }) {
  if (change === "up") {
    return <HugeiconsIcon icon={BitcoinUp02Icon} className="size-4 text-[#1f5fd1]" />
  }
  if (change === "down") {
    return <HugeiconsIcon icon={BitcoinDown02Icon} className="size-4 text-rose-600" />
  }
  return <HugeiconsIcon icon={MinusSignIcon} className="size-4 text-slate-400" />
}

function athleteInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export default function CoachDashboardPage() {
  const backendMode = getBackendMode()
  const role = getCookieValue(ROLE_COOKIE)
  const coachTeamId = getCookieValue(COACH_TEAM_COOKIE)
  const [backendSnapshot, setBackendSnapshot] = useState<CoachDashboardSnapshot | null>(null)
  const [backendError, setBackendError] = useState<string | null>(null)

  useEffect(() => {
    if (backendMode !== "supabase") return
    let cancelled = false

    const loadSnapshot = async () => {
      const result = await getCoachDashboardSnapshotForCurrentUser({ scopeTeamId: role === "coach" ? coachTeamId : null })
      if (cancelled) return
      if (!result.ok) {
        setBackendError(result.error.message)
        return
      }
      setBackendError(null)
      setBackendSnapshot(result.data)
    }

    void loadSnapshot()
    return () => {
      cancelled = true
    }
  }, [backendMode, coachTeamId, role])

  const sourceAthletes = backendMode === "supabase" ? (backendSnapshot?.athletes ?? []) : mockAthletes
  const sourcePrs = backendMode === "supabase" ? (backendSnapshot?.prs ?? []) : mockPRs
  const sourceTests = backendMode === "supabase" ? (backendSnapshot?.tests ?? []) : mockTestWeekResults
  const sourceTeams = backendMode === "supabase" ? (backendSnapshot?.teams ?? []) : mockTeams
  const sourceTrends = backendMode === "supabase" ? (backendSnapshot?.trendSeries ?? {}) : mockTrendSeries

  const scopedAthletes =
    role === "coach" && coachTeamId ? sourceAthletes.filter((athlete) => athlete.teamId === coachTeamId) : sourceAthletes
  const athleteIds = new Set(scopedAthletes.map((athlete) => athlete.id))
  const scopedPrs = sourcePrs.filter((pr) => athleteIds.has(pr.athleteId))
  const scopedTests = sourceTests.filter((row) => athleteIds.has(row.athleteId))
  const scopedTeam = sourceTeams.find((team) => team.id === coachTeamId)

  const readinessSummary = {
    green: scopedAthletes.filter((athlete) => athlete.readiness === "green").length,
    yellow: scopedAthletes.filter((athlete) => athlete.readiness === "yellow").length,
    red: scopedAthletes.filter((athlete) => athlete.readiness === "red").length,
  }

  const adherenceAverage =
    scopedAthletes.length > 0
      ? Math.round(scopedAthletes.reduce((sum, athlete) => sum + athlete.adherence, 0) / scopedAthletes.length)
      : 0

  const rosterHref = role === "coach" && coachTeamId ? `/coach/teams/${coachTeamId}` : "/coach/teams"
  const alertRows = scopedAthletes
    .filter((athlete) => athlete.readiness !== "green" || athlete.adherence < 75)
    .sort((left, right) => left.adherence - right.adherence)
    .slice(0, 5)

  const prMomentum = Object.entries(
    scopedPrs.reduce<Record<string, number>>((acc, pr) => {
      acc[pr.category] = (acc[pr.category] ?? 0) + 1
      return acc
    }, {}),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)

  const adherenceRows = [...scopedAthletes].sort((left, right) => right.adherence - left.adherence).slice(0, 6)

  const trendRows = scopedAthletes.map((athlete) => sourceTrends[athlete.id]).filter((series): series is NonNullable<
    typeof sourceTrends[string]
  > => Boolean(series))

  const trendDates = trendRows[0]?.map((point) => point.date) ?? []
  const readinessTrendValues = trendDates.map((date, index) => {
    const dayPoints = trendRows
      .map((series) => series[index])
      .filter((point) => point?.date === date)
    if (!dayPoints.length) return 0
    return Math.round(dayPoints.reduce((sum, point) => sum + point.readiness, 0) / dayPoints.length)
  })
  const trainingLoadValues = trendDates.map((date, index) => {
    const dayPoints = trendRows
      .map((series) => series[index])
      .filter((point) => point?.date === date)
    if (!dayPoints.length) return 0
    return Math.round(dayPoints.reduce((sum, point) => sum + point.trainingLoad, 0) / dayPoints.length)
  })
  const fallbackTrendBars = [
    { label: "Mon", value: 74 },
    { label: "Tue", value: 81 },
    { label: "Wed", value: 77 },
    { label: "Thu", value: 84 },
    { label: "Fri", value: 79 },
  ]

  const readinessTotal = readinessSummary.green + readinessSummary.yellow + readinessSummary.red
  const adherenceChartRows = adherenceRows.map((athlete) => ({
    name: athlete.name.split(" ")[0],
    adherence: athlete.adherence,
  }))
  const prChartRows = prMomentum.map(([category, count]) => ({ category, count }))
  const summaryBars =
    trendDates.length > 0
      ? trendDates.map((date, index) => ({
          label: date,
          short: new Date(date).toLocaleDateString(undefined, { weekday: "short" }),
          value: readinessTrendValues[index] ?? 0,
          tone: index === trendDates.length - 1 ? "bg-[#0f172a]" : "bg-[#1f8cff]",
        }))
      : fallbackTrendBars.map((item, index) => ({
          label: item.label,
          short: item.label,
          value: item.value,
          tone: index === fallbackTrendBars.length - 1 ? "bg-[#0f172a]" : "bg-[#1f8cff]",
        }))
  const maxSummaryValue = Math.max(...summaryBars.map((item) => item.value), 1)
  const readinessSegments = [
    { label: "Ready", value: readinessSummary.green, tone: "bg-[#1f8cff]", text: "text-[#1f5fd1]", surface: "bg-[#eef5ff]" },
    { label: "Watch", value: readinessSummary.yellow, tone: "bg-amber-400", text: "text-amber-700", surface: "bg-amber-50" },
    { label: "Review", value: readinessSummary.red, tone: "bg-rose-500", text: "text-rose-700", surface: "bg-rose-50" },
  ]

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="space-y-4 pt-1">
        {backendError ? (
          <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Backend sync issue: {backendError}
          </div>
        ) : null}
        <div className="space-y-2">
          <h1 className="text-[2.35rem] leading-[0.95] font-semibold tracking-[-0.07em] text-slate-950 sm:text-[2.8rem]">Dashboard</h1>
          <p className="max-w-xl text-[0.95rem] leading-6 text-slate-600">
            Monitor readiness, plan adherence, progress, and testing across the current squad.
            {scopedTeam ? ` Viewing ${scopedTeam.name}.` : ""}
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
          <div className="rounded-[30px] border border-slate-200 bg-white p-4 shadow-[0_14px_32px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex size-10 items-center justify-center rounded-full bg-[#e8f2ff]">
                  <HugeiconsIcon icon={ChartHistogramIcon} className="size-4 text-slate-950" />
                </div>
                <p className="text-base font-medium text-slate-950">Readiness Trend</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                Last {summaryBars.length} check-ins
              </span>
            </div>

            <div className="mt-4 rounded-[24px] bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
              <div className="flex items-end gap-3">
                {summaryBars.map((item) => (
                  <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
                    <div className="flex h-28 w-full items-end justify-center">
                      <div
                        className={cn("flex w-full max-w-[56px] items-start justify-center rounded-[16px] pt-2 text-[11px] font-semibold text-white", item.tone)}
                        style={{ height: `${Math.max((item.value / maxSummaryValue) * 100, 22)}%` }}
                      >
                        {item.value}
                      </div>
                    </div>
                    <p className="text-[11px] font-medium text-slate-400">{item.label.slice(5)}</p>
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{item.short}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
              <div className="flex items-center gap-2.5">
                <div className="flex size-10 items-center justify-center rounded-full bg-[#f0e9ff]">
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4 text-slate-950" />
                </div>
                <p className="text-sm font-medium leading-5 text-slate-700">Plan Adherence</p>
              </div>
              <div className="mt-2 flex items-end gap-1">
                <p className="text-[2rem] font-semibold leading-none tracking-[-0.06em] text-slate-950">{adherenceAverage}</p>
                <p className="pb-1 text-sm text-slate-500">% avg</p>
              </div>
            </div>

            <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
              <div className="flex items-center gap-2.5">
                <div className="flex size-10 items-center justify-center rounded-full bg-[#fff0e5]">
                  <HugeiconsIcon icon={Alert02Icon} className="size-4 text-slate-950" />
                </div>
                <p className="text-sm font-medium leading-5 text-slate-700">Open Flags</p>
              </div>
              <div className="mt-2 flex items-end gap-1">
                <p className="text-[2rem] font-semibold leading-none tracking-[-0.06em] text-slate-950">{alertRows.length}</p>
                <p className="pb-1 text-sm text-slate-500">to review</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.9fr)]">
        <div className="mobile-card-primary">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Team State</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Squad Snapshot</h2>
              <p className="text-sm text-slate-500">{scopedTeam?.name ?? "All current athletes"}</p>
            </div>
            <div className="hidden -space-x-2 sm:flex">
              {scopedAthletes.slice(0, 5).map((athlete, index) => (
                <div
                  key={athlete.id}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold shadow-sm",
                    [
                      "bg-[#dbeafe] text-[#1d4ed8]",
                      "bg-[#ede9fe] text-[#6d28d9]",
                      "bg-[#dcfce7] text-[#15803d]",
                      "bg-[#fee2e2] text-[#b91c1c]",
                      "bg-[#fef3c7] text-[#b45309]",
                    ][index % 5],
                  )}
                  title={athlete.name}
                >
                  {athleteInitials(athlete.name)}
                </div>
              ))}
              {scopedAthletes.length > 5 ? (
                <div className="flex size-9 items-center justify-center rounded-full border-2 border-white bg-slate-950 text-[11px] font-semibold text-white shadow-sm">
                  +{scopedAthletes.length - 5}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:mt-5 lg:gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
            <div className="space-y-3 sm:space-y-4">
              <div className="rounded-[28px] border border-slate-200 bg-white p-3.5 shadow-[0_16px_40px_rgba(15,23,42,0.05)] sm:p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-950">Readiness Status</p>
                  <p className="text-xs text-slate-500">{readinessTotal} athletes</p>
                </div>
                <div className="mt-3 space-y-2.5">
                  {readinessSegments.map((item) => (
                    <div key={item.label} className="rounded-[18px] border border-slate-200 bg-[#fbfcfe] px-4 py-3.5 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <span className={cn("size-2.5 rounded-full", item.tone)} />
                          <div>
                            <p className="text-sm font-medium text-slate-950">{item.label}</p>
                            <p className="text-xs text-slate-500">
                              {item.label === "Ready"
                                ? "Available to train"
                                : item.label === "Watch"
                                  ? "Monitor workload"
                                  : "Needs review"}
                            </p>
                          </div>
                        </div>
                        <p className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">{item.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-3.5 shadow-[0_16px_40px_rgba(15,23,42,0.05)] sm:p-4">
              <div className="space-y-1 border-b border-slate-200 pb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Live Signals</p>
                <h3 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">Coaching Focus</h3>
              </div>

              <div className="mt-4 rounded-[18px] border border-[#d7e5f8] bg-white px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Plan Adherence</p>
                    <p className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-slate-950">{adherenceAverage}%</p>
                  </div>
                  <div
                    className="relative size-16 shrink-0 rounded-full"
                    style={{
                      background: `conic-gradient(from 180deg, #1f8cff 0deg, #4759ff ${adherenceAverage * 3.6}deg, #e2e8f0 ${adherenceAverage * 3.6}deg, #e2e8f0 360deg)`,
                    }}
                  >
                    <div className="absolute inset-[7px] rounded-full bg-white" />
                    <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-slate-600">{adherenceAverage}%</div>
                  </div>
                </div>
                <div className="mt-3 h-2 rounded-full bg-slate-200">
                  <div
                    className="h-2 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)]"
                    style={{ width: `${adherenceAverage}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-slate-500">{scopedAthletes.length} athletes currently in scope.</p>
              </div>

              <div className="mt-3 space-y-2.5">
                <div className="mobile-card-utility bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Alerts</p>
                      <p className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950">{alertRows.length} need review</p>
                    </div>
                    <span className={cn(
                      "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                      alertRows.length > 0 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600",
                    )}>
                      {alertRows.length > 0 ? "Open" : "Clear"}
                    </span>
                  </div>
                  {alertRows[0] ? (
                    <p className="mt-2 text-sm text-slate-500">
                      Lowest adherence: <span className="font-medium text-slate-700">{alertRows[0].name}</span> at {alertRows[0].adherence}%.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">No current readiness or adherence flags.</p>
                  )}
                </div>

                <div className="mobile-card-utility bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">PR Momentum</p>
                      <p className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950">{scopedPrs.length} records logged</p>
                    </div>
                    <span className="inline-flex rounded-full bg-[#eef5ff] px-2.5 py-1 text-xs font-semibold text-[#1f5fd1]">
                      {prMomentum[0]?.[0] ?? "No trend"}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {prMomentum.slice(0, 3).map(([category, count]) => (
                      <div key={category} className="flex items-center gap-3">
                        <div className="w-20 shrink-0 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{category}</div>
                        <div className="h-2 flex-1 rounded-full bg-slate-200">
                          <div
                            className="h-2 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)]"
                            style={{ width: `${Math.max((count / Math.max(scopedPrs.length, 1)) * 100, 12)}%` }}
                          />
                        </div>
                        <div className="w-6 text-right text-sm font-semibold text-slate-950">{count}</div>
                      </div>
                    ))}
                    {prMomentum.length === 0 ? <p className="text-sm text-slate-500">No recent PR activity.</p> : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.05)] sm:p-5">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Athletes To Review</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Flags</h2>
            </div>
            <span className="inline-flex rounded-full bg-[#eef5ff] px-2.5 py-1 text-xs font-semibold text-[#1f5fd1]">
              {alertRows.length} open
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {alertRows.length > 0 ? (
              alertRows.slice(0, 3).map((athlete) => (
                <div key={athlete.id} className="rounded-[22px] border border-slate-200 bg-[#fbfcfe] px-3.5 py-3.5 shadow-[0_10px_24px_rgba(15,23,42,0.04)] sm:px-4 sm:py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] text-sm font-semibold text-white shadow-[0_10px_20px_rgba(31,140,255,0.22)]">
                        {athleteInitials(athlete.name)}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-950">{athlete.name}</p>
                        <p className="text-sm text-slate-500">{athlete.primaryEvent}</p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                        athlete.readiness === "green"
                          ? "bg-[#eef5ff] text-[#1f5fd1]"
                          : athlete.readiness === "yellow"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700",
                      )}
                    >
                      {athlete.readiness === "green" ? "Ready" : athlete.readiness === "yellow" ? "Watch" : "Review"}
                    </span>
                  </div>
                  <div className="mt-3 rounded-[14px] border border-slate-200 bg-white px-3 py-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-slate-950">Plan Adherence</span>
                      <span className="text-slate-500">{athlete.adherence}%</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-200">
                      <div
                        className={cn(
                          "h-2 rounded-full",
                          athlete.adherence >= 85
                            ? "bg-[#1f8cff]"
                            : athlete.adherence >= 75
                              ? "bg-amber-400"
                              : "bg-rose-500",
                        )}
                        style={{ width: `${athlete.adherence}%` }}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-500">
                      <span>Last wellness: {athlete.lastWellness}</span>
                      <Link to={rosterHref} className="font-medium text-[#1f5fd1] hover:text-[#194fb0]">
                        Review
                      </Link>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No active alerts.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="mobile-card-primary">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Readiness Trend</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Team Trend</h2>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#1f8cff]" /> Readiness</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-slate-900" /> Training load</span>
            </div>
          </div>

          <div className="mt-5">
            {readinessTrendValues.length > 0 ? (
              <>
                <div className="mobile-card-secondary overflow-hidden p-2.5 sm:p-3">
                  <LineChart
                    xAxis={[
                      {
                        scaleType: "point",
                        data: trendDates.map((date) => new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" })),
                      },
                    ]}
                    yAxis={[{ min: 0, max: 100 }]}
                    series={[
                      { data: readinessTrendValues, label: "Readiness", color: "#1f8cff", curve: "monotoneX" },
                      { data: trainingLoadValues, label: "Training load", color: "#0f172a", curve: "monotoneX" },
                    ]}
                    grid={{ horizontal: true }}
                    margin={{ left: 28, right: 16, top: 18, bottom: 24 }}
                    height={220}
                    sx={chartSx}
                  />
                </div>
              </>
            ) : (
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No trend data available for this scope.
              </div>
            )}
          </div>
        </div>

        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Adherence Distribution</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Top Adherence</h2>
          </div>
          <div className="mobile-card-secondary overflow-hidden p-2.5 sm:p-3">
            <BarChart
              dataset={adherenceChartRows}
              xAxis={[{ scaleType: "band", dataKey: "name" }]}
              yAxis={[{ min: 0, max: 100 }]}
              series={[{ dataKey: "adherence", label: "Plan Adherence", color: "#1f8cff" }]}
              grid={{ horizontal: true }}
              margin={{ left: 28, right: 16, top: 18, bottom: 24 }}
              height={260}
              sx={chartSx}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">PR Momentum</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Where Progress Is Happening</h2>
          </div>
          <div className="mt-4">
            {prMomentum.length > 0 ? (
              <div className="mobile-card-secondary overflow-hidden p-2.5 sm:p-3">
                <BarChart
                  dataset={prChartRows}
                  xAxis={[{ scaleType: "band", dataKey: "category" }]}
                  series={[{ dataKey: "count", label: "PR count", color: "#4759ff" }]}
                  grid={{ horizontal: true }}
                  margin={{ left: 28, right: 16, top: 18, bottom: 24 }}
                  height={260}
                  sx={chartSx}
                />
              </div>
            ) : (
              <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No recent PRs in the current scope.
              </div>
            )}
          </div>
        </div>

        <div className="mobile-card-primary">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Test Snapshot</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Latest Testing Movement</h2>
            </div>
            <Button asChild className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95">
              <Link to="/coach/test-week">
                Create Test Week
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </Link>
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            {scopedTests.length > 0 ? (
              scopedTests.map((row) => (
                <div key={row.athleteId} className="mobile-card-secondary bg-slate-50 px-3.5 py-3.5 sm:px-4 sm:py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{row.athleteName}</p>
                      <p className="text-xs text-slate-500">Latest test week results</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {[
                      { label: "30m", metric: row.thirtyM },
                      { label: "Flying 30m", metric: row.flyingThirtyM },
                      { label: "150m", metric: row.oneHundredFiftyM },
                      { label: "Squat 1RM", metric: row.squat1RM },
                      { label: "CMJ", metric: row.cmj },
                    ].map((item) => (
                      <div key={item.label} className="mobile-stat-card bg-white">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="font-semibold text-slate-950">{item.metric?.value ?? "-"}</span>
                          {item.metric ? <ChangeIcon change={item.metric.change} /> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No current test week results.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
