"use client"

import { useEffect, useState } from "react"
import {
  ArrowUp01Icon,
  ChartAverageIcon,
  CheckmarkCircle02Icon,
  FileDownloadIcon,
  NoteEditIcon,
  PrinterIcon,
  WorkoutRunIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { BarChart } from "@mui/x-charts"
import { Button } from "@/components/ui/button"
import { COACH_TEAM_COOKIE, getCookieValue, ROLE_COOKIE } from "@/lib/auth-session"
import { mockAthletes, mockPRs, mockTeams, mockWellness } from "@/lib/mock-data"
import {
  getCoachDashboardSnapshotForCurrentUser,
  getCoachWellnessEntriesForCurrentUser,
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
  "& .MuiBarElement-root": {
    rx: 8,
    ry: 8,
  },
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

export default function CoachReportsPage() {
  const backendMode = getBackendMode()
  const role = getCookieValue(ROLE_COOKIE)
  const coachTeamId = getCookieValue(COACH_TEAM_COOKIE)
  const [backendSnapshot, setBackendSnapshot] = useState<CoachDashboardSnapshot | null>(null)
  const [backendWellness, setBackendWellness] = useState<typeof mockWellness>([])
  const [backendError, setBackendError] = useState<string | null>(null)

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

  const sourceAthletes = backendMode === "supabase" ? (backendSnapshot?.athletes ?? []) : mockAthletes
  const sourcePrs = backendMode === "supabase" ? (backendSnapshot?.prs ?? []) : mockPRs
  const sourceTeams = backendMode === "supabase" ? (backendSnapshot?.teams ?? []) : mockTeams
  const sourceWellness = backendMode === "supabase" ? backendWellness : mockWellness
  const scopedAthletes =
    role === "coach" && coachTeamId ? sourceAthletes.filter((athlete) => athlete.teamId === coachTeamId) : sourceAthletes
  const athleteIds = new Set(scopedAthletes.map((athlete) => athlete.id))
  const scopedPrs = sourcePrs.filter((pr) => athleteIds.has(pr.athleteId))
  const scopedWellness = sourceWellness.filter((entry) => athleteIds.has(entry.athleteId))
  const scopedTeam = sourceTeams.find((team) => team.id === coachTeamId)

  const readinessSummary = {
    green: scopedAthletes.filter((athlete) => athlete.readiness === "green").length,
    yellow: scopedAthletes.filter((athlete) => athlete.readiness === "yellow").length,
    red: scopedAthletes.filter((athlete) => athlete.readiness === "red").length,
  }

  const readinessTotal = readinessSummary.green + readinessSummary.yellow + readinessSummary.red
  const adherenceAverage =
    scopedAthletes.length > 0
      ? Math.round(scopedAthletes.reduce((sum, athlete) => sum + athlete.adherence, 0) / scopedAthletes.length)
      : 0

  const lowAdherenceRows = [...scopedAthletes].sort((left, right) => left.adherence - right.adherence).slice(0, 6)
  const recentPrs = [...scopedPrs].slice(0, 5)
  const prByCategory = Object.entries(
    scopedPrs.reduce<Record<string, number>>((acc, pr) => {
      acc[pr.category] = (acc[pr.category] ?? 0) + 1
      return acc
    }, {}),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
  const prChartRows = prByCategory.map(([category, count]) => ({ category, count }))
  const adherenceChartRows = lowAdherenceRows.map((athlete) => ({
    athlete: athlete.name.split(" ")[0],
    adherence: athlete.adherence,
  }))

  const wellnessAverages = scopedWellness.length
    ? {
        sleep: Number((scopedWellness.reduce((sum, entry) => sum + entry.sleep, 0) / scopedWellness.length).toFixed(1)),
        soreness: Number((scopedWellness.reduce((sum, entry) => sum + entry.soreness, 0) / scopedWellness.length).toFixed(1)),
        fatigue: Number((scopedWellness.reduce((sum, entry) => sum + entry.fatigue, 0) / scopedWellness.length).toFixed(1)),
        mood: Number((scopedWellness.reduce((sum, entry) => sum + entry.mood, 0) / scopedWellness.length).toFixed(1)),
        stress: Number((scopedWellness.reduce((sum, entry) => sum + entry.stress, 0) / scopedWellness.length).toFixed(1)),
      }
    : { sleep: 0, soreness: 0, fatigue: 0, mood: 0, stress: 0 }

  const wellnessBars = [
    { label: "Sleep", value: wellnessAverages.sleep, max: 10, tone: "bg-[#1f8cff]" },
    { label: "Mood", value: wellnessAverages.mood, max: 5, tone: "bg-[#4759ff]" },
    { label: "Fatigue", value: wellnessAverages.fatigue, max: 5, tone: "bg-amber-400" },
    { label: "Stress", value: wellnessAverages.stress, max: 5, tone: "bg-rose-400" },
  ]
  const overviewCards = [
    {
      label: "Readiness",
      value: readinessSummary.green,
      suffix: readinessTotal ? `/${readinessTotal} ready` : "No athletes",
      tone: "border-slate-200 bg-white",
      badgeTone: "bg-[#e8f2ff]",
      icon: CheckmarkCircle02Icon,
    },
    {
      label: "Plan Adherence",
      value: adherenceAverage,
      suffix: "% avg",
      tone: "border-slate-200 bg-white",
      badgeTone: "bg-[#f0e9ff]",
      icon: ChartAverageIcon,
    },
    {
      label: "PR Movement",
      value: scopedPrs.length,
      suffix: "records",
      tone: "border-slate-200 bg-white",
      badgeTone: "bg-[#fff0e5]",
      icon: WorkoutRunIcon,
    },
    {
      label: "Daily Logs",
      value: scopedWellness.length,
      suffix: "wellness",
      tone: "border-slate-200 bg-white",
      badgeTone: "bg-[#edf5df]",
      icon: NoteEditIcon,
    },
  ]

  const exportAthleteAdherence = () => {
    const rows = [
      ["Athlete", "Group", "Readiness", "Plan Adherence", "Last Wellness"],
      ...scopedAthletes.map((athlete) => [
        athlete.name,
        athlete.eventGroup,
        athlete.readiness,
        `${athlete.adherence}%`,
        athlete.lastWellness,
      ]),
    ]
    downloadCsv("coach-athlete-adherence.csv", rows)
  }

  const exportPrs = () => {
    const rows = [
      ["Athlete", "Event", "Best", "Previous", "Date", "Legal/Wind"],
      ...scopedPrs.map((pr) => [
        pr.athleteName,
        pr.event,
        pr.bestValue,
        pr.previousValue ?? "-",
        pr.date,
        pr.wind ? `Legal (${pr.wind})` : pr.legal ? "Legal" : "Wind assisted",
      ]),
    ]
    downloadCsv("coach-pr-report.csv", rows)
  }

  const exportWellness = () => {
    const rows = [
      ["Athlete ID", "Date", "Sleep", "Soreness", "Fatigue", "Mood", "Stress", "Readiness"],
      ...scopedWellness.map((entry) => [
        entry.athleteId,
        entry.date,
        String(entry.sleep),
        String(entry.soreness),
        String(entry.fatigue),
        String(entry.mood),
        String(entry.stress),
        entry.readiness,
      ]),
    ]
    downloadCsv("coach-wellness-export.csv", rows)
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:space-y-6 sm:p-6 print:p-0">
      <section className="space-y-4 pt-1">
        {backendError ? (
          <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Backend sync issue: {backendError}
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-[2.35rem] leading-[0.95] font-semibold tracking-[-0.07em] text-slate-950 sm:text-[2.8rem]">Reports</h1>
            <p className="max-w-xl text-[0.95rem] leading-6 text-slate-600">
              Review adherence risk, wellness signals, and PR movement across the active squad.
              {scopedTeam ? ` Viewing ${scopedTeam.name}.` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={exportWellness}
            aria-label="Export wellness CSV"
            className="flex size-14 shrink-0 items-center justify-center rounded-[24px] bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_14px_34px_rgba(31,140,255,0.32),0_0_28px_rgba(71,89,255,0.18)] hover:opacity-95"
          >
            <HugeiconsIcon icon={FileDownloadIcon} className="size-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {overviewCards.map((card) => (
            <div key={card.label} className={cn("rounded-[26px] border p-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)]", card.tone)}>
              <div className="flex items-center gap-2.5">
                <div className={cn("flex size-10 items-center justify-center rounded-full", card.badgeTone)}>
                  <HugeiconsIcon icon={card.icon} className="size-4 text-slate-950" />
                </div>
                <p className="text-sm font-medium leading-5 text-slate-700">{card.label}</p>
              </div>
              <div className="mt-2 flex items-end gap-1">
                <p className="text-[2rem] font-semibold leading-none tracking-[-0.06em] text-slate-950">{card.value}</p>
                <p className="pb-1 text-sm text-slate-500">{card.suffix}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 lg:hidden">
          <Button type="button" variant="outline" className="mobile-action-secondary bg-white" onClick={exportAthleteAdherence}>
            <HugeiconsIcon icon={FileDownloadIcon} className="size-4" />
            Adherence
          </Button>
          <Button type="button" variant="outline" className="mobile-action-secondary bg-white" onClick={exportPrs}>
            <HugeiconsIcon icon={FileDownloadIcon} className="size-4" />
            PR CSV
          </Button>
        </div>
        <div className="hidden flex-wrap gap-2 lg:flex">
          <Button
            type="button"
            variant="outline"
            className="mobile-action-secondary bg-white px-5"
            onClick={exportAthleteAdherence}
          >
            <HugeiconsIcon icon={FileDownloadIcon} className="size-4" />
            Adherence CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            className="mobile-action-secondary bg-white px-5"
            onClick={exportPrs}
          >
            <HugeiconsIcon icon={FileDownloadIcon} className="size-4" />
            PR CSV
          </Button>
          <Button
            type="button"
            className="mobile-action-primary"
            onClick={exportWellness}
          >
            <HugeiconsIcon icon={FileDownloadIcon} className="size-4" />
            Wellness CSV
          </Button>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
        <div className="mobile-card-primary">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Readiness Snapshot</p>
              <h2 className="text-[1.8rem] font-semibold leading-none tracking-[-0.055em] text-slate-950">Current Squad State</h2>
              <p className="text-sm text-slate-500">One view of readiness mix, adherence, and daily recovery.</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)]">
            <div className="space-y-4">
              <div className="rounded-[28px] border border-slate-200 bg-white p-3.5 shadow-[0_16px_40px_rgba(15,23,42,0.05)] sm:p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-950">Readiness Status</p>
                  <p className="text-xs text-slate-500">{readinessTotal} athletes</p>
                </div>
                <div className="mt-3 space-y-2.5">
                  {[
                    { label: "Ready", value: readinessSummary.green, tone: "bg-[#1f8cff]" },
                    { label: "Watch", value: readinessSummary.yellow, tone: "bg-amber-400" },
                    { label: "Review", value: readinessSummary.red, tone: "bg-rose-500" },
                  ].map((item) => (
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

              <div className="rounded-[24px] border border-slate-200 bg-[#fffaf4] p-4 shadow-[0_14px_32px_rgba(15,23,42,0.04)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Plan Adherence</p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="text-3xl font-semibold tracking-[-0.05em] text-slate-950">{adherenceAverage}%</p>
                  <p className="hidden max-w-[13rem] text-right text-sm text-slate-500 sm:block">
                    Baseline adherence for the current reporting scope.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-[#f9fcf5] p-4 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Wellness Signals</p>
                  <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950">Daily Recovery</h3>
                </div>
                <p className="text-xs text-slate-500">Avg values</p>
              </div>
              <div className="mt-4 space-y-3">
                {wellnessBars.map((item) => (
                  <div key={item.label}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-950">{item.label}</span>
                      <span className="text-slate-500">{item.value}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-200">
                      <div className={cn("h-2 rounded-full", item.tone)} style={{ width: `${(item.value / item.max) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Exports</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Takeaway Actions</h2>
          </div>
          <div className="mt-4 space-y-3">
            {[
              {
                title: "Adherence CSV",
                body: "Roster-level readiness, plan adherence, and last wellness timestamp.",
                action: exportAthleteAdherence,
                primary: true,
              },
              {
                title: "PR CSV",
                body: "Scoped record movement with previous marks and legality context.",
                action: exportPrs,
                primary: false,
              },
              {
                title: "Wellness CSV",
                body: "Daily wellness responses for meetings, review, and historical export.",
                action: exportWellness,
                primary: false,
              },
            ].map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={item.action}
                className={cn(
                  "w-full rounded-[18px] border px-4 py-4 text-left transition hover:-translate-y-0.5",
                  item.primary
                    ? "border-[#cfe2ff] bg-[linear-gradient(135deg,#eff6ff_0%,#f8fbff_100%)] shadow-[0_12px_28px_rgba(31,140,255,0.12)]"
                    : "border-slate-200 bg-slate-50 hover:border-[#cfe2ff] hover:bg-[#f8fbff]",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{item.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{item.body}</p>
                  </div>
                  <HugeiconsIcon icon={FileDownloadIcon} className="mt-0.5 size-4 text-[#1f8cff]" />
                </div>
              </button>
            ))}
            <Button
              type="button"
              variant="outline"
              className="mobile-action-secondary w-full"
              onClick={() => window.print()}
            >
              <HugeiconsIcon icon={PrinterIcon} className="size-4" />
              Print / PDF
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Adherence Risk</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Who Needs Follow-Up</h2>
          </div>
          <div className="mt-4">
            {lowAdherenceRows.length > 0 ? (
              <div className="mobile-card-secondary overflow-hidden p-2.5 sm:p-3">
                <BarChart
                  dataset={adherenceChartRows}
                  xAxis={[{ scaleType: "band", dataKey: "athlete" }]}
                  yAxis={[{ min: 0, max: 100 }]}
                  series={[{ dataKey: "adherence", label: "Plan Adherence", color: "#1f8cff" }]}
                  grid={{ horizontal: true }}
                  margin={{ left: 28, right: 16, top: 18, bottom: 24 }}
                  height={280}
                  sx={chartSx}
                />
              </div>
            ) : (
              <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No adherence risks in the current scope.
              </div>
            )}
          </div>
        </div>

        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">PR Movement</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Where Improvement Is Landing</h2>
          </div>
          <div className="mt-4">
            {prByCategory.length > 0 ? (
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
                No PR movement in the current scope.
              </div>
            )}
          </div>

          <div className="mobile-card-secondary mt-5">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Recent Records</p>
              <h3 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">Latest Improvements</h3>
            </div>
            <div className="mt-4 space-y-3">
              {recentPrs.length > 0 ? (
                recentPrs.map((pr) => (
                  <div key={pr.id} className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] px-3.5 py-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-950">{pr.athleteName}</p>
                        <p className="text-sm text-slate-500">{pr.event}</p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#1f8cff]">
                        <HugeiconsIcon icon={ArrowUp01Icon} className="size-4" />
                        {pr.bestValue}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {pr.previousValue ? `${pr.previousValue} -> ` : ""}{pr.date}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No PR records available.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
