"use client"

import { useEffect, useState } from "react"
import { LineChart } from "@mui/x-charts"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, ArrowUp01Icon, StarAward02Icon } from "@hugeicons/core-free-icons"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { getCurrentAthletePrRecords } from "@/lib/data/pr/pr-data"
import type { PrRecord } from "@/lib/data/pr/types"
import { getLatestBenchmarkSnapshotForCurrentAthlete } from "@/lib/data/test-week/test-week-data"
import { getCurrentAthleteWellnessTrend } from "@/lib/data/wellness/wellness-data"
import type { WellnessTrendPoint } from "@/lib/data/wellness/types"
import { getBackendMode } from "@/lib/supabase/config"

const fallbackAthlete = { id: "fallback-athlete" }
const fallbackPrs = [
  { id: "fallback-pr-1", athleteId: "fallback-athlete", event: "30m", date: "Mar 2, 2026", bestValue: "4.05s", previousValue: "4.10s" },
  { id: "fallback-pr-2", athleteId: "fallback-athlete", event: "Flying 30m", date: "Mar 2, 2026", bestValue: "2.89s", previousValue: "2.95s" },
  { id: "fallback-pr-3", athleteId: "fallback-athlete", event: "Squat 1RM", date: "Mar 2, 2026", bestValue: "185kg", previousValue: "180kg" },
  { id: "fallback-pr-4", athleteId: "fallback-athlete", event: "CMJ", date: "Mar 2, 2026", bestValue: "72cm", previousValue: "70cm" },
]
const fallbackLatestTest = {
  thirtyM: { value: "4.05s" },
  flyingThirtyM: { value: "2.89s" },
  squat1RM: { value: "185kg" },
  cmj: { value: "72cm" },
}
const fallbackTrendSeries: Record<string, WellnessTrendPoint[]> = {
  "fallback-athlete": [
    { date: "2026-03-01", readiness: 78, fatigue: 32, trainingLoad: 64 },
    { date: "2026-03-08", readiness: 82, fatigue: 28, trainingLoad: 68 },
    { date: "2026-03-15", readiness: 84, fatigue: 30, trainingLoad: 70 },
    { date: "2026-03-22", readiness: 86, fatigue: 27, trainingLoad: 66 },
  ],
}

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
  "& .MuiLineElement-root": {
    strokeLinecap: "round",
  },
  "& .MuiMarkElement-root": {
    stroke: "#ffffff",
    strokeWidth: 2,
  },
}

export default function AthleteTrendsPage() {
  const backendMode = getBackendMode()
  const athlete = fallbackAthlete
  const [backendTrend, setBackendTrend] = useState<WellnessTrendPoint[]>([])
  const [backendPrs, setBackendPrs] = useState<PrRecord[]>([])
  const [backendBenchmarks, setBackendBenchmarks] = useState<Record<string, string>>({})
  const [backendError, setBackendError] = useState<string | null>(null)

  const trend = backendMode === "supabase" ? backendTrend : fallbackTrendSeries[athlete.id] ?? []
  const athletePrs =
    backendMode === "supabase"
      ? backendPrs.slice(0, 4).map((pr) => ({
          id: pr.id,
          event: pr.event,
          date: new Date(`${pr.measuredOn}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
          bestValue: pr.bestValue,
          previousValue: pr.previousValue ?? undefined,
        }))
      : fallbackPrs.filter((pr) => pr.athleteId === athlete.id).slice(0, 4)
  const latestTest = fallbackLatestTest

  useEffect(() => {
    if (typeof window === "undefined") return
    ;(window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }).__PACELAB_MOBILE_DETAIL_MODE = true
    window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: true } }))
    const handleBack = () => window.history.back()
    window.addEventListener("pacelab:mobile-detail-back", handleBack)

    return () => {
      ;(window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }).__PACELAB_MOBILE_DETAIL_MODE = false
      window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: false } }))
      window.removeEventListener("pacelab:mobile-detail-back", handleBack)
    }
  }, [])

  useEffect(() => {
    if (backendMode !== "supabase") return
    let cancelled = false

    const loadBackendData = async () => {
      const [trendResult, prResult, benchmarkResult] = await Promise.all([
        getCurrentAthleteWellnessTrend(28),
        getCurrentAthletePrRecords(),
        getLatestBenchmarkSnapshotForCurrentAthlete(),
      ])

      if (cancelled) return

      if (!trendResult.ok) {
        setBackendError(trendResult.error.message)
      } else {
        setBackendTrend(trendResult.data)
      }

      if (!prResult.ok) {
        setBackendError((current) => current ?? prResult.error.message)
      } else {
        setBackendPrs(prResult.data)
      }

      if (!benchmarkResult.ok) {
        setBackendError((current) => current ?? benchmarkResult.error.message)
      } else {
        const mapped = Object.fromEntries(
          (benchmarkResult.data?.results ?? []).map((row) => [row.label.toLowerCase(), row.valueText]),
        )
        setBackendBenchmarks(mapped)
      }
    }

    void loadBackendData()
    return () => {
      cancelled = true
    }
  }, [backendMode])

  const averages = trend.length
    ? {
        readiness: Math.round(trend.reduce((sum, point) => sum + point.readiness, 0) / trend.length),
        fatigue: Math.round(trend.reduce((sum, point) => sum + point.fatigue, 0) / trend.length),
        load: Math.round(trend.reduce((sum, point) => sum + point.trainingLoad, 0) / trend.length),
      }
    : { readiness: 0, fatigue: 0, load: 0 }

  const latestPoint = trend[trend.length - 1]

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="space-y-2">
        <h1 className="text-[2.15rem] leading-[0.95] font-semibold tracking-[-0.07em] text-slate-950 sm:text-[2.5rem]">
          Progress
        </h1>
        <p className="text-base leading-7 text-slate-600">
          Best marks, trend lines, and testing signals in one athlete progress surface.
        </p>
        {backendError ? <p className="text-sm text-rose-700">Some backend data could not be loaded: {backendError}</p> : null}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="mobile-card-primary">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Trend Lines</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Performance Signals</h2>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#1f8cff]" /> Readiness</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#4759ff]" /> Load</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-slate-900" /> Fatigue</span>
            </div>
          </div>

          <div className="mt-4">
            {trend.length > 0 ? (
              <div className="overflow-hidden rounded-[18px] border border-[#d9e6f7] bg-[radial-gradient(circle_at_top,rgba(31,140,255,0.16),transparent_45%),linear-gradient(180deg,#fbfdff_0%,#eef5ff_100%)] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] sm:rounded-[22px] sm:p-3">
                <div className="mb-3 grid grid-cols-3 gap-2">
                  {[
                    { label: "Readiness", value: latestPoint?.readiness ?? 0, tone: "bg-[#1f8cff]" },
                    { label: "Load", value: latestPoint?.trainingLoad ?? 0, tone: "bg-[#4759ff]" },
                    { label: "Fatigue", value: latestPoint?.fatigue ?? 0, tone: "bg-slate-900" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[14px] border border-white/80 bg-white/80 px-3 py-2.5 backdrop-blur">
                      <div className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${item.tone}`} />
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                      </div>
                      <p className="mt-1 text-lg font-semibold tracking-[-0.04em] text-slate-950">{item.value}</p>
                    </div>
                  ))}
                </div>
                <LineChart
                  xAxis={[
                    {
                      scaleType: "point",
                      data: trend.map((point) => new Date(point.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })),
                    },
                  ]}
                  yAxis={[{ min: 0, max: 100 }]}
                  series={[
                    { data: trend.map((point) => point.readiness), label: "Readiness", color: "#1f8cff", curve: "monotoneX", showMark: true },
                    { data: trend.map((point) => point.trainingLoad), label: "Load", color: "#4759ff", curve: "monotoneX", showMark: false },
                    { data: trend.map((point) => point.fatigue), label: "Fatigue", color: "#0f172a", curve: "monotoneX", showMark: false },
                  ]}
                  grid={{ horizontal: true }}
                  margin={{ left: 28, right: 16, top: 18, bottom: 24 }}
                  height={248}
                  sx={chartSx}
                />
              </div>
            ) : (
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No trend data available.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="mobile-card-primary">
            <div className="space-y-1 border-b border-slate-200 pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Averages</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Baseline View</h2>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { label: "Readiness", value: averages.readiness },
                { label: "Fatigue", value: averages.fatigue },
                { label: "Load", value: averages.load },
              ].map((item) => (
                <div key={item.label} className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-3 text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                  <p className="mt-1.5 text-2xl font-semibold tracking-[-0.05em] text-slate-950">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mobile-card-primary">
            <div className="space-y-1 border-b border-slate-200 pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Testing</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Latest Benchmarks</h2>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                {
                  label: "30m",
                  value:
                    backendMode === "supabase"
                      ? backendBenchmarks["30m sprint"] ?? backendBenchmarks["30m"] ?? "-"
                      : latestTest?.thirtyM?.value ?? "-",
                },
                {
                  label: "Flying 30m",
                  value:
                    backendMode === "supabase"
                      ? backendBenchmarks["flying 30m"] ?? backendBenchmarks["flying 30"] ?? "-"
                      : latestTest?.flyingThirtyM?.value ?? "-",
                },
                {
                  label: "Squat 1RM",
                  value:
                    backendMode === "supabase"
                      ? backendBenchmarks["back squat 1rm"] ?? backendBenchmarks["squat 1rm"] ?? "-"
                      : latestTest?.squat1RM?.value ?? "-",
                },
                {
                  label: "CMJ",
                  value:
                    backendMode === "supabase"
                      ? backendBenchmarks["cmj"] ?? backendBenchmarks["counter movement jump"] ?? "-"
                      : latestTest?.cmj?.value ?? "-",
                },
              ].map((item) => (
                <div key={item.label} className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
                  <p className="mt-1.5 text-lg font-semibold tracking-[-0.03em] text-slate-950">{item.value}</p>
                </div>
              ))}
            </div>
            <Button asChild variant="outline" className="mt-4 h-11 w-full rounded-full border-slate-200 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950">
              <Link to="/athlete/test-week">
                Open test week
                <HugeiconsIcon icon={StarAward02Icon} className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="mobile-card-primary">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">PR Momentum</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Recent Bests</h2>
            </div>
            <Button asChild variant="outline" className="mobile-action-secondary">
              <Link to="/athlete/prs">
                View all PRs
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </Link>
            </Button>
          </div>
          <div className="mt-4 space-y-3">
            {athletePrs.map((pr) => (
              <div key={pr.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{pr.event}</p>
                    <p className="mt-1 text-sm text-slate-500">{pr.date}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#1f8cff]">
                    <HugeiconsIcon icon={ArrowUp01Icon} className="size-4" />
                    {pr.bestValue}
                  </span>
                </div>
                {pr.previousValue ? <p className="mt-2 text-xs text-slate-500">Previous {pr.previousValue}</p> : null}
              </div>
            ))}
          </div>
        </div>

        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Progress Workflow</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Quick Actions</h2>
          </div>
          <div className="mt-4 grid gap-3">
            {[
              { label: "All PRs", href: "/athlete/prs" },
              { label: "Submit test week", href: "/athlete/test-week" },
              { label: "Back to today", href: "/athlete/home" },
            ].map((item) => (
              <Button key={item.href} asChild variant="outline" className="mobile-action-secondary">
                <Link to={item.href}>{item.label}</Link>
              </Button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
