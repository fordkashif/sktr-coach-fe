"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { BarChart, LineChart } from "@mui/x-charts"
import { ArrowRight, Barbell, Heartbeat, Timer, TrendDown, TrendUp, Trophy } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import { EmptyState, PageHeader, Panel, Segmented, Stat, scoreTone } from "@/components/sk"
import { parseSessionCompletions, SESSION_COMPLETIONS_STORAGE_KEY } from "@/lib/athlete-session"
import { mockLatestBenchmarks, mockPrRecords } from "@/lib/data/pr/mock-pr-records"
import {
  addDays,
  applyMockPrOverrides,
  compareMarks,
  formatFullDay,
  formatShortDay,
  localDayKey,
  parseLocalDay,
  parseMark,
  sameMark,
  sortPrsNewestFirst,
  weekStart,
} from "@/lib/data/pr/pr-display"
import { getCurrentAthletePrRecords } from "@/lib/data/pr/pr-data"
import type { PrRecord } from "@/lib/data/pr/types"
import { getCurrentAthleteWeeklySessionCompletions } from "@/lib/data/session/session-data"
import { getLatestBenchmarkSnapshotForCurrentAthlete } from "@/lib/data/test-week/test-week-data"
import type { LatestBenchmarkSnapshot } from "@/lib/data/test-week/types"
import { getCurrentAthleteWellnessTrend } from "@/lib/data/wellness/wellness-data"
import type { WellnessTrendPoint } from "@/lib/data/wellness/types"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { cn } from "@/lib/utils"

const PR_OVERRIDE_STORAGE_KEY = "pacelab:pr-overrides"
/** Most recent check-ins loaded for the "All" range (a little over a year of daily entries). */
const TREND_LIMIT = 400
const RECENT_PR_LIMIT = 4

type Range = "4w" | "3m" | "all"
const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: "4w", label: "4 weeks" },
  { value: "3m", label: "3 months" },
  { value: "all", label: "All" },
]

type BucketUnit = "day" | "week" | "month"
type Bucket = { key: string; start: Date }

const tickLabelStyle = { fontFamily: "inherit", fontSize: 12, fontWeight: 600, fill: "#6a7385" }

const chartSx = {
  "& .MuiChartsAxis-line, & .MuiChartsAxis-tick": { stroke: "transparent" },
  "& .MuiChartsAxis-tickLabel": { fill: "#6a7385", fontSize: 12, fontFamily: "inherit", fontWeight: 600 },
  "& .MuiChartsGrid-line": { stroke: "#e3e6ee" },
  "& .MuiMarkElement-root": { strokeWidth: 2, fill: "#ffffff" },
  "& .MuiLineElement-root": { strokeLinecap: "round", strokeWidth: 3 },
  "& .MuiBarLabel-root": { fill: "#0e1320", fontSize: 12, fontFamily: "inherit", fontWeight: 700 },
}

function startOfBucket(date: Date, unit: BucketUnit): Date {
  if (unit === "week") return weekStart(date)
  if (unit === "month") return new Date(date.getFullYear(), date.getMonth(), 1)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function nextBucket(date: Date, unit: BucketUnit): Date {
  if (unit === "week") return addDays(date, 7)
  if (unit === "month") return new Date(date.getFullYear(), date.getMonth() + 1, 1)
  return addDays(date, 1)
}

function buildBuckets(from: Date, to: Date, unit: BucketUnit): Bucket[] {
  const buckets: Bucket[] = []
  let cursor = startOfBucket(from, unit)
  const end = startOfBucket(to, unit)
  while (cursor.getTime() <= end.getTime() && buckets.length < 600) {
    buckets.push({ key: localDayKey(cursor), start: cursor })
    cursor = nextBucket(cursor, unit)
  }
  return buckets
}

/** Which days the range covers and how they are grouped. Null when "All" has no data to span. */
function resolveWindow(range: Range, firstDay: Date | null, today: Date, allowDaily: boolean): { from: Date; unit: BucketUnit } | null {
  const thisWeek = weekStart(today)
  if (range === "4w") {
    return allowDaily ? { from: addDays(today, -27), unit: "day" } : { from: addDays(thisWeek, -21), unit: "week" }
  }
  if (range === "3m") return { from: addDays(thisWeek, -84), unit: "week" }
  if (!firstDay) return null
  const weeks = Math.round((thisWeek.getTime() - weekStart(firstDay).getTime()) / (7 * 86_400_000)) + 1
  if (weeks > 26) return { from: new Date(firstDay.getFullYear(), firstDay.getMonth(), 1), unit: "month" }
  const fourWeeksBack = addDays(thisWeek, -21)
  const first = weekStart(firstDay)
  return { from: first.getTime() < fourWeeksBack.getTime() ? first : fourWeeksBack, unit: "week" }
}

function bucketLabel(bucket: Bucket, unit: BucketUnit, spansYears: boolean): string {
  if (unit !== "month") return formatShortDay(bucket.start)
  const month = bucket.start.toLocaleDateString(undefined, { month: "short" })
  return spansYears ? `${month} '${String(bucket.start.getFullYear()).slice(2)}` : month
}

function describeWindow(buckets: Bucket[], today: Date): string {
  if (buckets.length === 0) return ""
  return `${formatFullDay(buckets[0].start)} to ${formatFullDay(today)}`
}

/** Mock mode only: a believable run of check-ins ending yesterday, so the demo charts have something to draw. */
function buildMockTrend(today: Date): WellnessTrendPoint[] {
  const points: WellnessTrendPoint[] = []
  for (let back = 104; back >= 1; back -= 1) {
    if (back % 6 === 4) continue
    const wave = Math.round(7 * Math.sin(back / 4.5))
    const readiness = Math.max(40, Math.min(96, 70 + wave + (back % 3) * 2 + Math.round((104 - back) / 13)))
    points.push({
      date: localDayKey(addDays(today, -back)),
      readiness,
      fatigue: Math.max(10, 100 - readiness - 20),
      trainingLoad: 60 + (back % 5) * 3,
    })
  }
  return points
}

/** Mock mode only: demo completions for past weeks. Sessions the athlete marks done in the app are added on top. */
function buildMockCompletionDays(today: Date): string[] {
  const days: string[] = []
  const thisWeek = weekStart(today)
  for (let week = 15; week >= 1; week -= 1) {
    const monday = addDays(thisWeek, -7 * week)
    const offsets = week % 5 === 3 ? [0, 3] : week % 4 === 2 ? [0, 1, 3] : week % 3 === 0 ? [0, 1, 2, 3, 4] : [0, 1, 3, 4]
    offsets.forEach((offset) => days.push(localDayKey(addDays(monday, offset))))
  }
  return days
}

function readMockCompletionDays(): string[] {
  if (typeof window === "undefined") return []
  return parseSessionCompletions(window.localStorage.getItem(tenantStorageKey(SESSION_COMPLETIONS_STORAGE_KEY)))
}

function readMockPrOverrides(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    return JSON.parse(window.localStorage.getItem(tenantStorageKey(PR_OVERRIDE_STORAGE_KEY)) ?? "{}") as Record<string, string>
  } catch {
    return {}
  }
}

function useElementWidth<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0))
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return [setNode, width] as const
}

function MarkValue({ text, className }: { text: string; className?: string }) {
  const mark = parseMark(text)
  return (
    <span className={cn("sk-num whitespace-nowrap", className)}>
      {mark.numeral}
      {mark.unit ? <span className="ml-0.5 text-[0.5em] font-bold tracking-normal text-sk-ink-2">{mark.unit}</span> : null}
    </span>
  )
}

function ChangeLine({ direction, children }: { direction: "up" | "down" | "flat"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm font-semibold",
        direction === "up" && "text-[#07673f]",
        direction === "down" && "text-[#b32a0c]",
        direction === "flat" && "text-sk-mute",
      )}
    >
      {direction === "up" ? <TrendUp className="size-4 shrink-0" weight="bold" aria-hidden /> : null}
      {direction === "down" ? <TrendDown className="size-4 shrink-0" weight="bold" aria-hidden /> : null}
      {children}
    </span>
  )
}

export default function AthleteTrendsPage() {
  const backendMode = getBackendMode()
  const isSupabase = backendMode === "supabase"
  const today = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])

  const [range, setRange] = useState<Range>("4w")
  const [backendTrend, setBackendTrend] = useState<WellnessTrendPoint[]>([])
  const [backendPrs, setBackendPrs] = useState<PrRecord[]>([])
  const [backendSnapshot, setBackendSnapshot] = useState<LatestBenchmarkSnapshot | null>(null)
  const [backendCompletionDays, setBackendCompletionDays] = useState<string[]>([])
  const [backendError, setBackendError] = useState<string | null>(null)
  const [backendLoaded, setBackendLoaded] = useState(false)
  const [mockOverrides] = useState<Record<string, string>>(() => (isSupabase ? {} : readMockPrOverrides()))
  const [mockLocalCompletionDays] = useState<string[]>(() => (isSupabase ? [] : readMockCompletionDays()))

  useEffect(() => {
    if (backendMode !== "supabase") return
    let cancelled = false

    const loadBackendData = async () => {
      const [trendResult, prResult, benchmarkResult, completionResult] = await Promise.all([
        getCurrentAthleteWellnessTrend(TREND_LIMIT),
        getCurrentAthletePrRecords(),
        getLatestBenchmarkSnapshotForCurrentAthlete(),
        getCurrentAthleteWeeklySessionCompletions("2000-01-01", localDayKey(today)),
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
        setBackendSnapshot(benchmarkResult.data)
      }

      if (!completionResult.ok) {
        setBackendError((current) => current ?? completionResult.error.message)
      } else {
        setBackendCompletionDays(completionResult.data.map((row) => row.completionDate.slice(0, 10)))
      }

      setBackendLoaded(true)
    }

    void loadBackendData()
    return () => {
      cancelled = true
    }
  }, [backendMode, today])

  const loading = isSupabase && !backendLoaded

  /* ---------- Data for this athlete (real in supabase mode, demo in mock mode) ---------- */

  const trend = useMemo(() => {
    const source = isSupabase ? backendTrend : buildMockTrend(today)
    return source
      .map((point) => ({ day: parseLocalDay(point.date), readiness: point.readiness }))
      .filter((point): point is { day: Date; readiness: number } => point.day !== null)
      .sort((a, b) => a.day.getTime() - b.day.getTime())
  }, [isSupabase, backendTrend, today])

  const completionDays = useMemo(() => {
    const keys = isSupabase ? backendCompletionDays : [...buildMockCompletionDays(today), ...mockLocalCompletionDays]
    return keys
      .map((key) => parseLocalDay(key))
      .filter((day): day is Date => day !== null)
      .sort((a, b) => a.getTime() - b.getTime())
  }, [isSupabase, backendCompletionDays, mockLocalCompletionDays, today])

  const allPrs = useMemo(
    () => sortPrsNewestFirst(isSupabase ? backendPrs : applyMockPrOverrides(mockPrRecords, mockOverrides)),
    [isSupabase, backendPrs, mockOverrides],
  )
  const recentPrs = allPrs.slice(0, RECENT_PR_LIMIT)
  const snapshot = isSupabase ? backendSnapshot : mockLatestBenchmarks

  /* ---------- Latest test results, each compared with the athlete's record for that test ---------- */

  const testRows = (snapshot?.results ?? []).map((result) => {
    const pr = allPrs.find((item) => item.event.trim().toLowerCase() === result.label.trim().toLowerCase())
    let direction: "up" | "down" | "flat" | null = null
    let note: string | null = null

    if (pr) {
      if (sameMark(result.valueText, pr.bestValue)) {
        const setThisWeek = Boolean(pr.sourceRef && snapshot && pr.sourceRef.startsWith(snapshot.testWeekId))
        const gain = setThisWeek ? compareMarks(pr.bestValue, pr.previousValue, pr.category) : null
        if (setThisWeek && gain?.improved) {
          direction = "up"
          note = `New record, ${gain.text}`
        } else if (setThisWeek) {
          direction = "up"
          note = "New record"
        } else {
          direction = "flat"
          note = "Matches your record"
        }
      } else {
        const gap = compareMarks(result.valueText, pr.bestValue, pr.category)
        if (gap && !gap.improved) {
          direction = "down"
          note = `${gap.text} than your record of ${pr.bestValue}`
        }
      }
    }

    return { id: result.testDefinitionId, label: result.label, valueText: result.valueText, direction, note }
  })

  /* ---------- Headline numbers ---------- */

  const latestCheckIn = trend[trend.length - 1]
  const fourWeeksAgo = addDays(today, -27)
  const checkInsLast4Weeks = trend.filter((point) => point.day.getTime() >= fourWeeksAgo.getTime()).length
  const thisWeekStart = weekStart(today)
  const sessionsThisWeek = completionDays.filter((day) => day.getTime() >= thisWeekStart.getTime()).length

  /* ---------- Readiness over time ---------- */

  const readinessWindow = resolveWindow(range, trend[0]?.day ?? null, today, true)
  const readinessBuckets = readinessWindow ? buildBuckets(readinessWindow.from, today, readinessWindow.unit) : []
  const readinessUnit: BucketUnit = readinessWindow?.unit ?? "day"
  const readinessValues = readinessBuckets.map((bucket) => {
    const scores = trend.filter((point) => localDayKey(startOfBucket(point.day, readinessUnit)) === bucket.key).map((point) => point.readiness)
    return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null
  })
  const readinessInRange = readinessWindow ? trend.filter((point) => point.day.getTime() >= readinessWindow.from.getTime()) : []
  const readinessAverage = readinessInRange.length
    ? Math.round(readinessInRange.reduce((sum, point) => sum + point.readiness, 0) / readinessInRange.length)
    : null
  const readinessSpansYears = readinessBuckets.length > 0 && readinessBuckets[0].start.getFullYear() !== today.getFullYear()
  const readinessTitle =
    readinessUnit === "day" ? "Readiness score each day" : readinessUnit === "week" ? "Average readiness each week" : "Average readiness each month"

  /* ---------- Sessions completed over time ---------- */

  const sessionWindow = resolveWindow(range, completionDays[0] ?? null, today, false)
  const sessionBuckets = sessionWindow ? buildBuckets(sessionWindow.from, today, sessionWindow.unit) : []
  const sessionUnit: BucketUnit = sessionWindow?.unit ?? "week"
  const sessionCounts = sessionBuckets.map(
    (bucket) => completionDays.filter((day) => localDayKey(startOfBucket(day, sessionUnit)) === bucket.key).length,
  )
  const sessionsInRange = sessionCounts.reduce((sum, count) => sum + count, 0)
  const sessionSpansYears = sessionBuckets.length > 0 && sessionBuckets[0].start.getFullYear() !== today.getFullYear()
  const sessionTitle = sessionUnit === "month" ? "Sessions completed each month" : "Sessions completed each week"
  // One step of headroom so the value label above the tallest bar is never clipped.
  const sessionPeak = Math.max(4, ...sessionCounts) + 1

  const [barWrapRef, barWrapWidth] = useElementWidth<HTMLDivElement>()
  // Keep bars slim (about 28px) however few weeks are shown.
  const barGapRatio =
    barWrapWidth > 0 && sessionBuckets.length > 0
      ? Math.max(0.3, Math.min(0.94, 1 - (28 * sessionBuckets.length) / Math.max(1, barWrapWidth - 56)))
      : 0.6

  const rangeWords = range === "4w" ? "the last 4 weeks" : range === "3m" ? "the last 3 months" : "your history"

  return (
    <div className="sk-page">
      <PageHeader
        title="Progress"
        lede="Your records, your latest tests and how training has been going."
        actions={
          <Link to="/athlete/prs" className="sk-btn sk-btn-quiet">
            <Trophy className="size-5" weight="bold" aria-hidden />
            All personal records
          </Link>
        }
      >
        {backendError ? (
          <p role="alert" className="text-sm font-semibold text-[#b32a0c]">
            Some of your data could not be loaded: {backendError}
          </p>
        ) : null}
      </PageHeader>

      {loading ? (
        <p className="text-base font-semibold text-sk-mute" role="status">
          Loading your progress
        </p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-label="Summary">
            <Stat
              tone="yellow"
              label="Personal records"
              value={allPrs.length}
              hint={allPrs[0] ? `Latest: ${allPrs[0].event}` : "None yet"}
            />
            <Stat
              tone={latestCheckIn ? scoreTone(latestCheckIn.readiness) : "plain"}
              label="Latest readiness"
              value={latestCheckIn ? latestCheckIn.readiness : "No data"}
              unit={latestCheckIn ? "/100" : undefined}
              hint={latestCheckIn ? formatFullDay(latestCheckIn.day) : "No check-ins yet"}
              className={latestCheckIn ? undefined : "[&_.sk-num]:text-2xl sm:[&_.sk-num]:text-3xl"}
            />
            <Stat tone="plain" label="Sessions this week" value={sessionsThisWeek} hint={`Since ${formatShortDay(thisWeekStart)}`} />
            <Stat tone="plain" label="Check-ins" value={checkInsLast4Weeks} unit="/28" hint="Days in the last 4 weeks" />
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel
              title="Newest records"
              className="min-w-0"
              action={
                allPrs.length > 0 ? (
                  <Link to="/athlete/prs" className="sk-btn sk-btn-ghost sk-btn-sm -mr-2">
                    See all {allPrs.length}
                    <ArrowRight className="size-4" weight="bold" aria-hidden />
                  </Link>
                ) : undefined
              }
            >
              {recentPrs.length > 0 ? (
                <ul>
                  {recentPrs.map((pr) => {
                    const gain = compareMarks(pr.bestValue, pr.previousValue, pr.category)
                    return (
                      <li key={pr.id} className="sk-row">
                        <div className="min-w-0">
                          <p className="truncate text-base font-bold text-sk-ink">{pr.event}</p>
                          <p className="mt-0.5 text-sm text-sk-mute">{formatFullDay(pr.measuredOn)}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <MarkValue text={pr.bestValue} className="text-[1.75rem]" />
                          {gain?.improved ? (
                            <ChangeLine direction="up">{gain.text}</ChangeLine>
                          ) : pr.previousValue ? (
                            <ChangeLine direction="flat">Before: {pr.previousValue}</ChangeLine>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <EmptyState
                  icon={<Trophy className="size-6" weight="fill" />}
                  title="No records yet"
                  body="Your best mark in each test lands here the first time you submit a test week result."
                  action={
                    <Link to="/athlete/test-week" className="sk-btn sk-btn-quiet sk-btn-sm">
                      Go to test week
                    </Link>
                  }
                  className="border-0 bg-sk-canvas"
                />
              )}
            </Panel>

            <Panel
              title="Latest test results"
              hint={
                snapshot
                  ? `${snapshot.testWeekName}, ${formatFullDay(snapshot.startDate)} to ${formatFullDay(snapshot.endDate)}`
                  : undefined
              }
              className="min-w-0"
            >
              {testRows.length > 0 ? (
                <>
                  <ul>
                    {testRows.map((row) => (
                      <li key={row.id} className="sk-row">
                        <div className="min-w-0">
                          <p className="truncate text-base font-bold text-sk-ink">{row.label}</p>
                          {row.note && row.direction ? (
                            <p className="mt-0.5">
                              <ChangeLine direction={row.direction}>{row.note}</ChangeLine>
                            </p>
                          ) : null}
                        </div>
                        <MarkValue text={row.valueText} className="shrink-0 text-[1.75rem]" />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-sm text-sk-mute">Each result is compared with your personal record for that test.</p>
                </>
              ) : (
                <EmptyState
                  icon={<Timer className="size-6" weight="fill" />}
                  title="No test results yet"
                  body="When your coach opens a test week and you submit your marks, the latest ones show here."
                  action={
                    <Link to="/athlete/test-week" className="sk-btn sk-btn-quiet sk-btn-sm">
                      Go to test week
                    </Link>
                  }
                  className="border-0 bg-sk-canvas"
                />
              )}
            </Panel>
          </div>

          <section className="space-y-4" aria-labelledby="over-time-heading">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 id="over-time-heading" className="sk-h2">
                Over time
              </h2>
              <Segmented value={range} onChange={setRange} options={RANGE_OPTIONS} label="Time range for both charts" className="self-start" />
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <Panel title={readinessTitle} hint={readinessBuckets.length > 0 ? `${describeWindow(readinessBuckets, today)}. Scored 0 to 100 from your check-ins.` : undefined} className="min-w-0">
                {trend.length === 0 ? (
                  <EmptyState
                    icon={<Heartbeat className="size-6" weight="fill" />}
                    title="No check-ins yet"
                    body="Fill in your daily wellness check-in and your readiness score is charted here."
                    action={
                      <Link to="/athlete/wellness" className="sk-btn sk-btn-quiet sk-btn-sm">
                        Do a check-in
                      </Link>
                    }
                    className="border-0 bg-sk-canvas"
                  />
                ) : readinessInRange.length === 0 ? (
                  <p className="sk-well text-sm text-sk-ink-2">
                    No check-ins in {rangeWords}. Your last one was on {formatFullDay(latestCheckIn?.day)}. Try a longer range.
                  </p>
                ) : (
                  <>
                    <p className="flex items-baseline gap-2">
                      <span className="sk-num text-[2.5rem]">{readinessAverage}</span>
                      <span className="text-sm font-semibold text-sk-mute">
                        average from {readinessInRange.length} {readinessInRange.length === 1 ? "check-in" : "check-ins"}
                      </span>
                    </p>
                    <div
                      className="-mx-2 mt-2 overflow-hidden"
                      role="img"
                      aria-label={`${readinessTitle}, ${describeWindow(readinessBuckets, today)}. Average ${readinessAverage} out of 100 from ${readinessInRange.length} check-ins.`}
                    >
                      <LineChart
                        xAxis={[
                          {
                            scaleType: "point",
                            data: readinessBuckets.map((bucket) => bucketLabel(bucket, readinessUnit, readinessSpansYears)),
                            disableLine: true,
                            disableTicks: true,
                            tickLabelStyle,
                          },
                        ]}
                        yAxis={[{ min: 0, max: 100, width: 36, disableLine: true, disableTicks: true, tickLabelStyle }]}
                        series={[
                          {
                            data: readinessValues,
                            label: readinessUnit === "day" ? "Readiness" : "Average readiness",
                            color: "#2152ff",
                            curve: "monotoneX",
                            connectNulls: true,
                            showMark: readinessBuckets.length <= 31,
                            valueFormatter: (value) => (value === null ? "No check-in" : `${value} / 100`),
                          },
                        ]}
                        grid={{ horizontal: true }}
                        margin={{ left: 0, right: 24, top: 12, bottom: 0 }}
                        height={240}
                        hideLegend
                        sx={chartSx}
                      />
                    </div>
                  </>
                )}
              </Panel>

              <Panel title={sessionTitle} hint={sessionBuckets.length > 0 ? `${describeWindow(sessionBuckets, today)}.${sessionUnit === "week" ? " Weeks start on Monday." : ""}` : undefined} className="min-w-0">
                {completionDays.length === 0 ? (
                  <EmptyState
                    icon={<Barbell className="size-6" weight="fill" />}
                    title="No completed sessions yet"
                    body="Each session you mark as done counts toward its week here."
                    action={
                      <Link to="/athlete/home" className="sk-btn sk-btn-quiet sk-btn-sm">
                        Go to today
                      </Link>
                    }
                    className="border-0 bg-sk-canvas"
                  />
                ) : sessionsInRange === 0 ? (
                  <p className="sk-well text-sm text-sk-ink-2">
                    No sessions marked done in {rangeWords}. Your last one was on {formatFullDay(completionDays[completionDays.length - 1])}. Try a longer range.
                  </p>
                ) : (
                  <>
                    <p className="flex items-baseline gap-2">
                      <span className="sk-num text-[2.5rem]">{sessionsInRange}</span>
                      <span className="text-sm font-semibold text-sk-mute">
                        {sessionsInRange === 1 ? "session" : "sessions"} done in {rangeWords}
                      </span>
                    </p>
                    <div
                      ref={barWrapRef}
                      className="-mx-2 mt-2 overflow-hidden"
                      role="img"
                      aria-label={`${sessionTitle}, ${describeWindow(sessionBuckets, today)}. ${sessionsInRange} in total.`}
                    >
                      <BarChart
                        xAxis={[
                          {
                            scaleType: "band",
                            data: sessionBuckets.map((bucket) => bucketLabel(bucket, sessionUnit, sessionSpansYears)),
                            categoryGapRatio: barGapRatio,
                            disableLine: true,
                            disableTicks: true,
                            tickLabelStyle,
                          },
                        ]}
                        yAxis={[{ min: 0, max: sessionPeak, tickMinStep: 1, width: 36, disableLine: true, disableTicks: true, tickLabelStyle }]}
                        series={[
                          {
                            data: sessionCounts,
                            label: "Sessions completed",
                            color: "#0c9d61",
                            barLabel: sessionBuckets.length <= 13 ? (item) => (item.value ? String(item.value) : null) : undefined,
                            barLabelPlacement: "outside",
                            valueFormatter: (value) => `${value ?? 0} ${value === 1 ? "session" : "sessions"}`,
                          },
                        ]}
                        borderRadius={6}
                        grid={{ horizontal: true }}
                        margin={{ left: 0, right: 24, top: 20, bottom: 0 }}
                        height={240}
                        hideLegend
                        sx={chartSx}
                      />
                    </div>
                  </>
                )}
              </Panel>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
