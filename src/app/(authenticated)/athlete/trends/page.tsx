"use client"

import { useEffect, useMemo, useState } from "react"
import { ClockCounterClockwise, Plus } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import { BestStatus, eventHistoryPath, meetDatesText, ProgressTabs, ResultMark, whenAndWhere } from "@/components/athlete/results-parts"
import {
  DayLabel,
  EmptyState,
  LinkButton,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  Segmented,
  Skeleton,
  SkeletonRows,
  Split,
  Stat,
  StatStrip,
  StatusText,
  TrendBars,
  TrendLine,
} from "@/components/sk"
import { parseSessionCompletions, SESSION_COMPLETIONS_STORAGE_KEY } from "@/lib/athlete-session"
import { getCompetitionsForCurrentAthlete, splitCompetitions } from "@/lib/data/competition/competition-data"
import type { CompetitionWithEntries } from "@/lib/data/competition/types"
import { inSeason, resultConditions, type AthleteResult } from "@/lib/data/pr/marks"
import { addDays, formatFullDay, formatShortDay, localDayKey, parseLocalDay, weekStart } from "@/lib/data/pr/pr-display"
import { getCurrentAthleteRecords, type AthleteRecords } from "@/lib/data/pr/results-data"
import { getCurrentAthleteWeeklySessionCompletions } from "@/lib/data/session/session-data"
import { getCurrentAthleteTestWeekHistory } from "@/lib/data/test-week/test-week-data"
import type { AthleteTestWeekHistoryItem } from "@/lib/data/test-week/types"
import { getCurrentAthleteWellnessTrend } from "@/lib/data/wellness/wellness-data"
import type { WellnessTrendPoint } from "@/lib/data/wellness/types"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/** Most recent check-ins loaded for the "All" range (a little over a year of daily entries). */
const TREND_LIMIT = 400
const LATEST_RESULT_LIMIT = 5

type Range = "4w" | "3m" | "all"
const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: "4w", label: "4 weeks" },
  { value: "3m", label: "3 months" },
  { value: "all", label: "All" },
]

type BucketUnit = "day" | "week" | "month"
type Bucket = { key: string; start: Date }

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

function daysUntil(date: string, today: Date): number {
  const day = parseLocalDay(date)
  return day ? Math.round((day.getTime() - today.getTime()) / 86_400_000) : 0
}

export default function AthleteTrendsPage() {
  const isSupabase = getBackendMode() === "supabase"
  const today = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])
  const todayKey = localDayKey(today)

  const [range, setRange] = useState<Range>("4w")
  const [records, setRecords] = useState<AthleteRecords | null>(null)
  const [competitions, setCompetitions] = useState<CompetitionWithEntries[] | null>(null)
  const [testWeeks, setTestWeeks] = useState<AthleteTestWeekHistoryItem[] | null>(null)
  const [backendTrend, setBackendTrend] = useState<WellnessTrendPoint[] | null>(null)
  const [backendCompletionDays, setBackendCompletionDays] = useState<string[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mockLocalCompletionDays] = useState<string[]>(() => (isSupabase ? [] : readMockCompletionDays()))

  useEffect(() => {
    let cancelled = false
    const note = (message: string) => setLoadError((current) => current ?? message)

    void getCurrentAthleteRecords().then((result) => {
      if (cancelled) return
      if (result.ok) setRecords(result.data)
      else {
        note(result.error.message)
        setRecords({ results: [], season: { start: `${todayKey.slice(0, 4)}-01-01`, end: `${todayKey.slice(0, 4)}-12-31` }, events: [], viewerUserId: null })
      }
    })
    void getCompetitionsForCurrentAthlete().then((result) => {
      if (cancelled) return
      if (!result.ok) note(result.error.message)
      setCompetitions(result.ok ? result.data : [])
    })
    void getCurrentAthleteTestWeekHistory().then((result) => {
      if (cancelled) return
      if (!result.ok) note(result.error.message)
      setTestWeeks(result.ok ? result.data : [])
    })

    if (isSupabase) {
      void getCurrentAthleteWellnessTrend(TREND_LIMIT).then((result) => {
        if (cancelled) return
        if (!result.ok) note(result.error.message)
        setBackendTrend(result.ok ? result.data : [])
      })
      void getCurrentAthleteWeeklySessionCompletions("2000-01-01", todayKey).then((result) => {
        if (cancelled) return
        if (!result.ok) note(result.error.message)
        setBackendCompletionDays(result.ok ? result.data.map((row) => row.completionDate.slice(0, 10)) : [])
      })
    }
    return () => {
      cancelled = true
    }
  }, [isSupabase, todayKey])

  /* ---------- Results ---------- */

  const results = useMemo(() => records?.results ?? [], [records])
  const seasonResults = records ? results.filter((result) => inSeason(result.date, records.season)) : []
  const bestIds = useMemo(() => {
    const personal = new Set<string>()
    const season = new Set<string>()
    for (const event of records?.events ?? []) {
      if (event.bests.personalBest) personal.add(event.bests.personalBest.id)
      if (event.bests.seasonBest) season.add(event.bests.seasonBest.id)
    }
    return { personal, season }
  }, [records])
  const personalBestsThisSeason = records ? records.events.filter((event) => event.bests.personalBest && inSeason(event.bests.personalBest.date, records.season)).length : 0
  const latestResults = results.slice(0, LATEST_RESULT_LIMIT)

  const upcoming = competitions ? splitCompetitions(competitions).upcoming : []
  const nextCompetition = upcoming.find((item) => item.entries.some((entry) => entry.status === "entered")) ?? upcoming[0] ?? null
  const latestTestWeek = testWeeks?.[0] ?? null

  /* ---------- Readiness and sessions over time ---------- */

  const trendLoading = isSupabase && (backendTrend === null || backendCompletionDays === null)

  const trend = useMemo(() => {
    const source = isSupabase ? (backendTrend ?? []) : buildMockTrend(today)
    return source
      .map((point) => ({ day: parseLocalDay(point.date), readiness: point.readiness }))
      .filter((point): point is { day: Date; readiness: number } => point.day !== null)
      .sort((a, b) => a.day.getTime() - b.day.getTime())
  }, [isSupabase, backendTrend, today])

  const completionDays = useMemo(() => {
    const keys = isSupabase ? (backendCompletionDays ?? []) : [...buildMockCompletionDays(today), ...mockLocalCompletionDays]
    return keys
      .map((key) => parseLocalDay(key))
      .filter((day): day is Date => day !== null)
      .sort((a, b) => a.getTime() - b.getTime())
  }, [isSupabase, backendCompletionDays, mockLocalCompletionDays, today])

  const latestCheckIn = trend[trend.length - 1]
  const thisWeekStart = weekStart(today)
  const sessionsThisWeek = completionDays.filter((day) => day.getTime() >= thisWeekStart.getTime()).length

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
  const readinessTitle = readinessUnit === "day" ? "Readiness each day" : readinessUnit === "week" ? "Readiness each week" : "Readiness each month"

  const sessionWindow = resolveWindow(range, completionDays[0] ?? null, today, false)
  const sessionBuckets = sessionWindow ? buildBuckets(sessionWindow.from, today, sessionWindow.unit) : []
  const sessionUnit: BucketUnit = sessionWindow?.unit ?? "week"
  const sessionCounts = sessionBuckets.map((bucket) => completionDays.filter((day) => localDayKey(startOfBucket(day, sessionUnit)) === bucket.key).length)
  const sessionsInRange = sessionCounts.reduce((sum, count) => sum + count, 0)
  const sessionSpansYears = sessionBuckets.length > 0 && sessionBuckets[0].start.getFullYear() !== today.getFullYear()
  const sessionTitle = sessionUnit === "month" ? "Sessions each month" : "Sessions each week"

  const rangeWords = range === "4w" ? "the last 4 weeks" : range === "3m" ? "the last 3 months" : "your history"
  const rangeFrom = (buckets: Bucket[]) => (buckets.length > 0 ? `${formatFullDay(buckets[0].start)} to ${formatFullDay(today)}` : "")

  const resultRow = (result: AthleteResult) => {
    const conditions = resultConditions(result)
    return (
      <ListRow
        key={result.id}
        to={eventHistoryPath(result.eventGroup)}
        title={result.eventLabel}
        subtitle={
          <>
            {whenAndWhere(result)}
            {conditions ? `. ${conditions}` : ""}
            {bestIds.personal.has(result.id) ? (
              <span className="mt-0.5 block text-sm">
                <BestStatus kind="pb" />
              </span>
            ) : bestIds.season.has(result.id) ? (
              <span className="mt-0.5 block text-sm">
                <BestStatus kind="sb" />
              </span>
            ) : null}
          </>
        }
        trailing={<ResultMark result={result} />}
      />
    )
  }

  return (
    <Screen>
      <ScreenHeader
        title="Progress"
        lede="Your results and records first, then how training has been going."
        actions={
          <>
            <LinkButton to="/athlete/prs/add" variant="primary">
              <Plus className="size-[18px]" weight="bold" aria-hidden />
              Add a result
            </LinkButton>
            <LinkButton to="/athlete/history">
              <ClockCounterClockwise className="size-[18px]" weight="bold" aria-hidden />
              Session history
            </LinkButton>
          </>
        }
      />
      <ProgressTabs />

      {loadError ? <Notice tone="error">Some of your progress could not be loaded. {loadError}</Notice> : null}

      <StatStrip aria-label="This season and this week">
        <Stat label="Results this season" value={records ? seasonResults.length : <Skeleton className="my-2 h-7 w-10" />} hint={records && results.length > seasonResults.length ? `${results.length} in total` : undefined} />
        <Stat label="Personal bests this season" value={records ? personalBestsThisSeason : <Skeleton className="my-2 h-7 w-10" />} hint={records ? `${records.events.length} ${records.events.length === 1 ? "event" : "events"} on record` : undefined} />
        <Stat label="Sessions this week" value={trendLoading ? <Skeleton className="my-2 h-7 w-10" /> : sessionsThisWeek} hint={`Since ${formatShortDay(thisWeekStart)}`} />
        <Stat
          label="Latest readiness"
          value={trendLoading ? <Skeleton className="my-2 h-7 w-10" /> : latestCheckIn ? latestCheckIn.readiness : "None"}
          of={latestCheckIn && !trendLoading ? 100 : undefined}
          hint={trendLoading ? undefined : latestCheckIn ? formatFullDay(latestCheckIn.day) : "No check-ins yet"}
        />
      </StatStrip>

      <Split
        main={
          <Section
            title="Latest results"
            action={
              results.length > 0 ? (
                <Link className="sk-link" to="/athlete/prs">
                  All records
                </Link>
              ) : undefined
            }
          >
            {records === null ? (
              <SkeletonRows rows={4} label="Loading your results" />
            ) : latestResults.length > 0 ? (
              <List>{latestResults.map(resultRow)}</List>
            ) : (
              <EmptyState
                title="No results yet"
                body="Marks from test weeks and competitions land here, and you can add one yourself. Your bests are worked out from them."
                action={
                  <LinkButton to="/athlete/prs/add" size="sm">
                    Add a result
                  </LinkButton>
                }
              />
            )}
          </Section>
        }
        side={
          <>
            <Section
              title="Next competition"
              action={
                <Link className="sk-link" to="/athlete/competitions">
                  Calendar
                </Link>
              }
            >
              {competitions === null ? (
                <SkeletonRows rows={1} label="Loading competitions" />
              ) : nextCompetition ? (
                <List>
                  <ListRow
                    to={`/athlete/competitions/${nextCompetition.id}`}
                    leading={
                      <DayLabel
                        weekday={(parseLocalDay(nextCompetition.startDate) ?? today).toLocaleDateString(undefined, { month: "short" })}
                        number={(parseLocalDay(nextCompetition.startDate) ?? today).getDate()}
                      />
                    }
                    title={nextCompetition.name}
                    subtitle={
                      <>
                        {meetDatesText(nextCompetition.startDate, nextCompetition.endDate)}
                        {daysUntil(nextCompetition.startDate, today) > 0 ? `, in ${daysUntil(nextCompetition.startDate, today)} ${daysUntil(nextCompetition.startDate, today) === 1 ? "day" : "days"}` : ", on now"}
                        <span className="block">
                          {nextCompetition.entries.filter((entry) => entry.status === "entered").length > 0
                            ? nextCompetition.entries
                                .filter((entry) => entry.status === "entered")
                                .map((entry) => entry.eventLabel)
                                .join(", ")
                            : "You are not entered yet"}
                        </span>
                      </>
                    }
                  />
                </List>
              ) : (
                <EmptyState
                  title="Nothing on the calendar"
                  body="Meets your coach enters you in show up here. You can add one you entered yourself."
                  action={
                    <LinkButton to="/athlete/competitions/new" size="sm">
                      Add a competition
                    </LinkButton>
                  }
                />
              )}
            </Section>

            <Section
              title="Last test week"
              hint={latestTestWeek ? `${latestTestWeek.name}, ${formatFullDay(latestTestWeek.startDate)}` : undefined}
              action={
                latestTestWeek ? (
                  <Link className="sk-link" to="/athlete/test-week/history">
                    History
                  </Link>
                ) : undefined
              }
            >
              {testWeeks === null ? (
                <SkeletonRows rows={3} label="Loading test results" />
              ) : latestTestWeek ? (
                <List>
                  {latestTestWeek.results.map((result) => (
                    <ListRow
                      key={result.testDefinitionId}
                      title={result.name}
                      subtitle={
                        result.change ? (
                          <StatusText tone={result.change.improved ? "green" : "coral"}>{result.change.text}</StatusText>
                        ) : result.previousValueText ? (
                          "Same as last time"
                        ) : (
                          "First result"
                        )
                      }
                      trailing={result.valueText}
                    />
                  ))}
                </List>
              ) : (
                <EmptyState
                  title="No test results yet"
                  body="When your coach opens a test week and you submit your marks, they show here with the change from last time."
                  action={
                    <LinkButton to="/athlete/test-week" size="sm">
                      Go to tests
                    </LinkButton>
                  }
                />
              )}
            </Section>
          </>
        }
      />

      <Section title="Training over time" hint="Readiness from your check-ins and the sessions you finished. Pick how far back to look.">
        <Segmented value={range} onChange={setRange} options={RANGE_OPTIONS} label="Time range for both charts" className="mt-2 self-start" />
      </Section>

      <Split
        main={
          <Section
            title={readinessTitle}
            meta={readinessAverage !== null ? `Average ${readinessAverage} of 100` : undefined}
            hint={readinessBuckets.length > 0 && readinessInRange.length > 0 ? `${rangeFrom(readinessBuckets)}, from ${readinessInRange.length} ${readinessInRange.length === 1 ? "check-in" : "check-ins"}.` : undefined}
          >
            {trendLoading ? (
              <SkeletonRows rows={3} label="Loading readiness" />
            ) : trend.length === 0 ? (
              <EmptyState
                title="No check-ins yet"
                body="Do your wellness check-in and your readiness score is charted here."
                action={
                  <LinkButton to="/athlete/wellness" size="sm">
                    Do a check-in
                  </LinkButton>
                }
              />
            ) : readinessInRange.length === 0 ? (
              <EmptyState title={`No check-ins in ${rangeWords}`} body={`Your last one was on ${formatFullDay(latestCheckIn?.day)}. Try a longer range.`} />
            ) : (
              <TrendLine
                className="mt-2"
                points={readinessBuckets.map((bucket, index) => ({ x: bucketLabel(bucket, readinessUnit, readinessSpansYears), y: readinessValues[index] }))}
                seriesName={readinessUnit === "day" ? "Readiness" : "Average readiness"}
                formatValue={(value) => String(Math.round(value))}
                min={0}
                max={100}
                smooth
                label={`${readinessTitle}, ${rangeFrom(readinessBuckets)}. Average ${readinessAverage} out of 100 from ${readinessInRange.length} check-ins.`}
              />
            )}
          </Section>
        }
        side={
          <Section
            title={sessionTitle}
            meta={sessionsInRange > 0 ? `${sessionsInRange} done` : undefined}
            hint={sessionBuckets.length > 0 && sessionsInRange > 0 ? `${rangeFrom(sessionBuckets)}.` : undefined}
          >
            {trendLoading ? (
              <SkeletonRows rows={3} label="Loading sessions" />
            ) : completionDays.length === 0 ? (
              <EmptyState
                title="No finished sessions yet"
                body="Each session you mark as done counts toward its week here."
                action={
                  <LinkButton to="/athlete/home" size="sm">
                    Go to today
                  </LinkButton>
                }
              />
            ) : sessionsInRange === 0 ? (
              <EmptyState title={`No sessions done in ${rangeWords}`} body={`Your last one was on ${formatFullDay(completionDays[completionDays.length - 1])}. Try a longer range.`} />
            ) : (
              <TrendBars
                className="mt-2"
                points={sessionBuckets.map((bucket, index) => ({ x: bucketLabel(bucket, sessionUnit, sessionSpansYears), y: sessionCounts[index] }))}
                seriesName="Sessions done"
                formatValue={(value) => `${value} ${value === 1 ? "session" : "sessions"}`}
                label={`${sessionTitle}, ${rangeFrom(sessionBuckets)}. ${sessionsInRange} in total.`}
              />
            )}
          </Section>
        }
      />
    </Screen>
  )
}
