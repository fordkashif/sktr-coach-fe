import { attendanceCounts, attendanceRate, type AttendanceStatus } from "../coach/attendance"
import { currentBest, goalProgressPercent, goalState, type AthleteGoal } from "../goals/goal-logic"
import {
  describeDifference,
  formatMark,
  formatMarkWithUnit,
  formatWind,
  groupResultsByEvent,
  standingsOverTime,
  type AthleteResult,
  type ResultStanding,
  type Season,
} from "../pr/marks"
import { adherenceCounts, adherencePercent } from "../session/adherence"
import { bodyAreasSummary, PAIN_SEVERITY_WORDS, painImpactLabel } from "../wellness/pain-report-types"

/**
 * The athlete report: what a coach can put on it, the period it covers, and how the saved
 * snapshot is shaped from the athlete's data.
 *
 * Pure (no browser, no network), so the unit tests and both backend modes share it. The numbers
 * come from the same rules the screens use: adherenceCounts, attendanceRate, standingsOverTime,
 * groupResultsByEvent, goalProgressPercent.
 *
 * Two privacy rules live here:
 * - Private coach notes are never part of a report. The source type has no field for them and
 *   the snapshot has no key for them.
 * - Wellness and injuries are health information. They are off unless the coach ticks them, and
 *   a snapshot only carries those keys when its sections say so (the database checks this too).
 */

/* ---------- Sections ------------------------------------------------------------------------------ */

export type ReportSectionKey = "summary" | "attendance" | "training" | "results" | "tests" | "goals" | "wellness" | "injuries"

export type ReportSection = {
  key: ReportSectionKey
  label: string
  detail: string
  /** Health information: off by default, needs consent to share. */
  health: boolean
}

export const REPORT_SECTIONS: ReportSection[] = [
  { key: "summary", label: "Your summary", detail: "What you write about the period.", health: false },
  { key: "attendance", label: "Attendance and adherence", detail: "Sessions attended and planned sessions done.", health: false },
  { key: "training", label: "Training done", detail: "Sessions finished, week by week.", health: false },
  { key: "results", label: "Results and bests", detail: "Marks in the period, with season and all-time bests.", health: false },
  { key: "tests", label: "Test results", detail: "Each test with the change since last time.", health: false },
  { key: "goals", label: "Goals", detail: "Targets and how far along they are.", health: false },
  { key: "wellness", label: "Wellness trend", detail: "Readiness from check-ins over the period.", health: true },
  { key: "injuries", label: "Injury notes", detail: "Pain reports and time out injured or sick.", health: true },
]

export const HEALTH_SECTIONS: ReportSectionKey[] = REPORT_SECTIONS.filter((section) => section.health).map((section) => section.key)

/** What is ticked when a coach starts a report: everything except the health sections. */
export const DEFAULT_REPORT_SECTIONS: ReportSectionKey[] = REPORT_SECTIONS.filter((section) => !section.health).map((section) => section.key)

export const HEALTH_CONSENT_LINE = "This is health information. Share it only with the athlete's consent, or a parent's or guardian's for an athlete under 18."

export const REPORT_SUMMARY_MAX = 4000

/** Known sections only, once each, in sheet order. The summary is always part of a report. */
export function cleanReportSections(keys: readonly string[] | null | undefined): ReportSectionKey[] {
  const wanted = new Set(keys ?? [])
  wanted.add("summary")
  return REPORT_SECTIONS.filter((section) => wanted.has(section.key)).map((section) => section.key)
}

export function isHealthSection(key: ReportSectionKey) {
  return HEALTH_SECTIONS.includes(key)
}

export function includesHealth(sections: readonly ReportSectionKey[]) {
  return sections.some(isHealthSection)
}

/* ---------- Periods ------------------------------------------------------------------------------- */

export type ReportRange = { from: string; to: string }
export type ReportPeriodKind = "4w" | "12w" | "season" | "custom"

export const REPORT_PERIOD_OPTIONS: Array<{ value: ReportPeriodKind; label: string }> = [
  { value: "4w", label: "Last 4 weeks" },
  { value: "12w", label: "Last 12 weeks" },
  { value: "season", label: "This season" },
  { value: "custom", label: "Custom" },
]

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function toUtc(day: string): number {
  const [year, month, date] = day.split("-").map(Number)
  return Date.UTC(year, month - 1, date)
}

export function addReportDays(day: string, amount: number): string {
  return new Date(toUtc(day) + amount * 86_400_000).toISOString().slice(0, 10)
}

/** Days in a range, both ends included. */
export function reportRangeDays(range: ReportRange): number {
  return Math.round((toUtc(range.to) - toUtc(range.from)) / 86_400_000) + 1
}

export function isValidReportRange(range: ReportRange): boolean {
  return ISO_DAY.test(range.from) && ISO_DAY.test(range.to) && !Number.isNaN(toUtc(range.from)) && !Number.isNaN(toUtc(range.to)) && range.from <= range.to
}

/** Longest period a report covers: two years. */
export const REPORT_MAX_DAYS = 731

/** Why a custom range cannot be used, or null. */
export function reportRangeProblem(range: ReportRange, today: string): string | null {
  if (!ISO_DAY.test(range.from) || !ISO_DAY.test(range.to)) return "Choose the first and the last day."
  if (range.from > range.to) return "The first day is after the last day."
  if (range.from > today) return "The period has not started yet."
  if (reportRangeDays(range) > REPORT_MAX_DAYS) return "Choose a period of two years or less."
  return null
}

/**
 * The days a period choice covers, today included.
 * "This season" is the club's season that today falls in, from its first day to today (or to its
 * last day when that has passed); with no such season it is the calendar year so far.
 */
export function reportRangeFor(kind: Exclude<ReportPeriodKind, "custom">, today: string, season?: { start: string; end: string } | null): ReportRange {
  if (kind === "4w") return { from: addReportDays(today, -27), to: today }
  if (kind === "12w") return { from: addReportDays(today, -83), to: today }
  if (season && season.start <= today) return { from: season.start, to: season.end < today ? season.end : today }
  return { from: `${today.slice(0, 4)}-01-01`, to: today }
}

/**
 * The period for "duplicate for the next period": the same number of days, starting the day
 * after the old one ended, and never past today. When the old period ended today (or later) there
 * is no next one yet, so it is the same length ending today.
 */
export function nextReportRange(range: ReportRange, today: string): ReportRange {
  const days = reportRangeDays(range)
  const from = addReportDays(range.to, 1)
  if (from > today) return { from: addReportDays(today, -(days - 1)), to: today }
  const to = addReportDays(from, days - 1)
  return { from, to: to > today ? today : to }
}

/** "5 Oct 2026" */
export function reportDayText(day: string | null | undefined, withYear = true): string {
  if (!day || !ISO_DAY.test(day.slice(0, 10))) return day ?? ""
  return new Date(toUtc(day.slice(0, 10))).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC", ...(withYear ? { year: "numeric" } : {}) })
}

/** "8 Sep to 5 Oct 2026" */
export function reportRangeText(range: ReportRange): string {
  return `${reportDayText(range.from, range.from.slice(0, 4) !== range.to.slice(0, 4))} to ${reportDayText(range.to)}`
}

/** The Monday of the week a day is in. */
export function reportWeekStart(day: string): string {
  const weekday = new Date(toUtc(day)).getUTCDay()
  return addReportDays(day, weekday === 0 ? -6 : 1 - weekday)
}

/** Every week (Monday first) that has a day inside the range, oldest first. */
export function reportWeeks(range: ReportRange): string[] {
  const weeks: string[] = []
  for (let week = reportWeekStart(range.from); week <= range.to; week = addReportDays(week, 7)) weeks.push(week)
  return weeks
}

/* ---------- The source: what the app knows about the athlete ------------------------------------- */

export type ReportClub = { name: string; shortName: string | null; color: string; logoUrl: string | null }

export type ReportSourceSession = {
  id: string
  /** The day it was planned for, yyyy-mm-dd. */
  isoDate: string
  status: string
  /** "plan" or "athlete" (added by the athlete: never counts towards adherence). */
  origin: string
  durationMinutes: number | null
}

export type ReportSourceTest = {
  name: string
  value: string
  previousValue: string | null
  change: "up" | "down" | "same" | null
  /** ISO day or timestamp. */
  submittedAt: string
}

export type ReportSourcePain = {
  bodyAreas: string[]
  severity: number
  startedOn: string
  trainingImpact: "none" | "modified" | "cannot_train"
  note: string | null
  status: string
  resolvedAt: string | null
  createdAt: string
}

/**
 * Everything a report can draw on. There is deliberately no field for private coach notes, for
 * the coach's notes on sessions, or for the reasons written on attendance marks.
 */
export type AthleteReportSource = {
  club: ReportClub | null
  athlete: { id: string; name: string; teamName: string | null; primaryEvent: string | null }
  coachName: string
  sessions: ReportSourceSession[]
  attendance: Array<{ date: string; status: AttendanceStatus }>
  availability: Array<{ kind: string; startsOn: string; endsOn: string | null }>
  results: AthleteResult[]
  season: Season
  tests: ReportSourceTest[]
  goals: AthleteGoal[]
  wellness: Array<{ date: string; readinessScore: number; sleep: number | null }>
  painReports: ReportSourcePain[]
}

/* ---------- The snapshot: what is saved and shown -------------------------------------------------- */

export type ReportResultRow = {
  event: string
  mark: string
  date: string
  where: string | null
  standing: ResultStanding
  seasonBest: string | null
  personalBest: string | null
}

export type ReportTestRow = { name: string; value: string; previous: string | null; change: "better" | "worse" | "same" | null; changeText: string | null; date: string }

export type ReportGoalRow = {
  event: string
  target: string
  targetDate: string | null
  current: string | null
  percent: number
  state: "achieved" | "past-date" | "on-track"
  stateLabel: string
}

export type AthleteReportSnapshot = {
  version: 1
  /** The day the numbers were taken, yyyy-mm-dd. */
  savedOn: string
  club: ReportClub | null
  athlete: { name: string; teamName: string | null; primaryEvent: string | null }
  coachName: string
  period: ReportRange
  sections: ReportSectionKey[]
  summary: string
  attendance?: {
    adherence: { due: number; done: number; excused: number; percent: number | null }
    marks: { attended: number; counted: number; percent: number | null; present: number; late: number; absent: number; excused: number }
  }
  training?: {
    /** Sessions finished in the period, planned or added by the athlete. */
    done: number
    /** Sessions the plan set in the period. */
    planned: number
    /** Minutes of the finished sessions, when the plan gave a length. */
    minutes: number | null
    weeks: Array<{ weekStart: string; planned: number; done: number }>
  }
  results?: { rows: ReportResultRow[]; more: number }
  tests?: { rows: ReportTestRow[] }
  goals?: { rows: ReportGoalRow[] }
  wellness?: { checkIns: number; averageReadiness: number | null; averageSleep: number | null; points: Array<{ date: string; score: number }> }
  injuries?: {
    reports: Array<{ areas: string; severity: string; since: string; impact: string; resolved: boolean; note: string | null }>
    timeOut: Array<{ kind: string; from: string; to: string | null }>
  }
}

export type ReportBuildOptions = {
  range: ReportRange
  sections: readonly string[]
  summary: string
  /** yyyy-mm-dd */
  today: string
}

const RESULT_ROW_LIMIT = 14
const TEST_ROW_LIMIT = 12
const GOAL_ROW_LIMIT = 8
const WELLNESS_POINT_LIMIT = 120

function inRange(day: string, range: ReportRange) {
  const date = day.slice(0, 10)
  return date >= range.from && date <= range.to
}

function markOf(result: AthleteResult): string {
  const mark = formatMarkWithUnit(result.display, result.unit)
  const wind = formatWind(result.wind)
  return wind ? `${mark} (${wind})` : mark
}

function average(values: number[], decimals = 0): number | null {
  if (values.length === 0) return null
  const factor = 10 ** decimals
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * factor) / factor
}

function buildAttendance(source: AthleteReportSource, range: ReportRange): NonNullable<AthleteReportSnapshot["attendance"]> {
  const count = adherenceCounts(
    source.sessions.map((session) => ({ id: session.id, athleteId: source.athlete.id, scheduledFor: session.isoDate, status: session.status, origin: session.origin })),
    new Set<string>(),
    source.availability.map((period) => ({ athleteId: source.athlete.id, startsOn: period.startsOn, endsOn: period.endsOn })),
    range,
  ).get(source.athlete.id) ?? { due: 0, done: 0, excused: 0 }
  const marks = source.attendance.filter((record) => inRange(record.date, range))
  const rate = attendanceRate(marks)
  const counts = attendanceCounts(marks)
  return {
    adherence: { ...count, percent: adherencePercent(count) },
    marks: { attended: rate.attended, counted: rate.counted, percent: rate.percent, present: counts.present, late: counts.late, absent: counts.absent, excused: counts.excused },
  }
}

function buildTraining(source: AthleteReportSource, range: ReportRange): NonNullable<AthleteReportSnapshot["training"]> {
  const sessions = source.sessions.filter((session) => inRange(session.isoDate, range))
  const finished = sessions.filter((session) => session.status === "completed")
  const lengths = finished.map((session) => session.durationMinutes).filter((value): value is number => typeof value === "number" && value > 0)
  const isPlanned = (session: ReportSourceSession) => (session.origin || "plan") === "plan"
  return {
    done: finished.length,
    planned: sessions.filter(isPlanned).length,
    minutes: lengths.length > 0 ? lengths.reduce((sum, value) => sum + value, 0) : null,
    weeks: reportWeeks(range).map((weekStart) => {
      const weekEnd = addReportDays(weekStart, 6)
      const inWeek = sessions.filter((session) => session.isoDate >= weekStart && session.isoDate <= weekEnd)
      return { weekStart, planned: inWeek.filter(isPlanned).length, done: inWeek.filter((session) => session.status === "completed").length }
    }),
  }
}

function buildResults(source: AthleteReportSource, range: ReportRange): NonNullable<AthleteReportSnapshot["results"]> {
  const events = groupResultsByEvent(source.results, source.season)
  const standings = new Map<string, ResultStanding>()
  const bests = new Map<string, { seasonBest: string | null; personalBest: string | null }>()
  for (const event of events) {
    for (const [id, standing] of standingsOverTime(event.results)) standings.set(id, standing)
    bests.set(event.group, {
      seasonBest: event.bests.seasonBest ? markOf(event.bests.seasonBest) : null,
      personalBest: event.bests.personalBest ? markOf(event.bests.personalBest) : null,
    })
  }
  const inPeriod = source.results.filter((result) => inRange(result.date, range)).sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt))
  return {
    rows: inPeriod.slice(0, RESULT_ROW_LIMIT).map((result) => ({
      event: result.eventLabel,
      mark: markOf(result),
      date: result.date,
      where: result.location,
      standing: standings.get(result.id) ?? null,
      seasonBest: bests.get(result.eventGroup)?.seasonBest ?? null,
      personalBest: bests.get(result.eventGroup)?.personalBest ?? null,
    })),
    more: Math.max(0, inPeriod.length - RESULT_ROW_LIMIT),
  }
}

function buildTests(source: AthleteReportSource, range: ReportRange): NonNullable<AthleteReportSnapshot["tests"]> {
  // The test results the coach's athlete screen lists, each already compared with the time before.
  const listed = source.tests.filter((test) => inRange(test.submittedAt, range))
  if (listed.length > 0) {
    const seen = new Set<string>()
    const rows: ReportTestRow[] = []
    for (const test of [...listed].sort((left, right) => right.submittedAt.localeCompare(left.submittedAt))) {
      // The newest result of each test in the period.
      if (seen.has(test.name)) continue
      seen.add(test.name)
      rows.push({
        name: test.name,
        value: test.value,
        previous: test.previousValue,
        change: test.change === "up" ? "better" : test.change === "down" ? "worse" : test.change,
        changeText: test.change === "up" ? "Better" : test.change === "down" ? "Not as good" : test.change === "same" ? "Same" : null,
        date: test.submittedAt.slice(0, 10),
      })
    }
    return { rows: rows.slice(0, TEST_ROW_LIMIT) }
  }
  // Otherwise the test week marks in the athlete's results, compared with the test before.
  const rows: ReportTestRow[] = []
  for (const event of groupResultsByEvent(source.results.filter((result) => result.source === "test_week"), source.season)) {
    const latest = event.results.find((result) => inRange(result.date, range))
    if (!latest) continue
    const previous = event.results.find((result) => result.date < latest.date) ?? null
    const difference = previous ? describeDifference(latest, previous) : null
    rows.push({
      name: event.label,
      value: markOf(latest),
      previous: previous ? markOf(previous) : null,
      change: !previous ? null : !difference ? "same" : difference.improved ? "better" : "worse",
      changeText: !previous ? null : (difference?.text ?? "Same"),
      date: latest.date,
    })
  }
  return { rows: rows.slice(0, TEST_ROW_LIMIT) }
}

function buildGoals(source: AthleteReportSource, range: ReportRange, today: string): NonNullable<AthleteReportSnapshot["goals"]> {
  // Open goals, and goals reached inside the period.
  const goals = source.goals.filter((goal) => !goal.achievedOn || inRange(goal.achievedOn, range))
  return {
    rows: goals.slice(0, GOAL_ROW_LIMIT).map((goal) => {
      const state = goalState(goal, today)
      const best = currentBest(source.results, goal.eventGroup, goal.lowerIsBetter)
      const text = (value: number) => formatMarkWithUnit(formatMark(value, goal.unit), goal.unit)
      return {
        event: goal.eventLabel,
        target: text(goal.targetValue),
        targetDate: goal.targetDate,
        current: best ? text(best.compareValue) : null,
        percent: goal.achievedOn ? 100 : goalProgressPercent(goal.startValue, best?.compareValue ?? null, goal.targetValue, goal.lowerIsBetter),
        state: state.kind,
        stateLabel: state.label,
      }
    }),
  }
}

function buildWellness(source: AthleteReportSource, range: ReportRange): NonNullable<AthleteReportSnapshot["wellness"]> {
  const entries = source.wellness.filter((entry) => inRange(entry.date, range)).sort((left, right) => left.date.localeCompare(right.date))
  return {
    checkIns: entries.length,
    averageReadiness: average(entries.map((entry) => entry.readinessScore)),
    averageSleep: average(entries.map((entry) => entry.sleep).filter((value): value is number => typeof value === "number" && value > 0), 1),
    points: entries.slice(-WELLNESS_POINT_LIMIT).map((entry) => ({ date: entry.date.slice(0, 10), score: Math.round(entry.readinessScore) })),
  }
}

function buildInjuries(source: AthleteReportSource, range: ReportRange): NonNullable<AthleteReportSnapshot["injuries"]> {
  // Reported inside the period, or still open during it.
  const reports = source.painReports.filter((report) => {
    const reported = report.createdAt.slice(0, 10)
    if (reported > range.to) return false
    return report.status === "open" || report.resolvedAt === null || report.resolvedAt.slice(0, 10) >= range.from
  })
  const timeOut = source.availability.filter((period) => (period.kind === "injured" || period.kind === "sick") && period.startsOn <= range.to && (period.endsOn === null || period.endsOn >= range.from))
  return {
    reports: reports.slice(0, 10).map((report) => ({
      areas: bodyAreasSummary(report.bodyAreas),
      severity: `${PAIN_SEVERITY_WORDS[report.severity - 1] ?? "Pain"} (${report.severity} of 5)`,
      since: report.startedOn,
      impact: painImpactLabel(report.trainingImpact),
      resolved: report.status !== "open",
      note: report.note,
    })),
    timeOut: timeOut.slice(0, 10).map((period) => ({ kind: period.kind === "injured" ? "Injured" : "Sick", from: period.startsOn, to: period.endsOn })),
  }
}

/**
 * The snapshot of a report: only the sections that are ticked, shaped for the sheet. Saving this
 * is what makes a report stay the same when the athlete's data changes later.
 */
export function buildAthleteReportSnapshot(source: AthleteReportSource, options: ReportBuildOptions): AthleteReportSnapshot {
  const sections = cleanReportSections(options.sections)
  const has = (key: ReportSectionKey) => sections.includes(key)
  const { range } = options
  const snapshot: AthleteReportSnapshot = {
    version: 1,
    savedOn: options.today,
    club: source.club ? { name: source.club.name, shortName: source.club.shortName, color: source.club.color, logoUrl: source.club.logoUrl } : null,
    athlete: { name: source.athlete.name, teamName: source.athlete.teamName, primaryEvent: source.athlete.primaryEvent },
    coachName: source.coachName,
    period: { from: range.from, to: range.to },
    sections,
    summary: options.summary.trim().slice(0, REPORT_SUMMARY_MAX),
  }
  if (has("attendance")) snapshot.attendance = buildAttendance(source, range)
  if (has("training")) snapshot.training = buildTraining(source, range)
  if (has("results")) snapshot.results = buildResults(source, range)
  if (has("tests")) snapshot.tests = buildTests(source, range)
  if (has("goals")) snapshot.goals = buildGoals(source, range, options.today)
  if (has("wellness")) snapshot.wellness = buildWellness(source, range)
  if (has("injuries")) snapshot.injuries = buildInjuries(source, range)
  return snapshot
}

/** The same report with other words from the coach. Nothing else changes. */
export function withReportSummary(snapshot: AthleteReportSnapshot, summary: string): AthleteReportSnapshot {
  return { ...snapshot, summary: summary.trim().slice(0, REPORT_SUMMARY_MAX) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const SNAPSHOT_KEYS = ["version", "savedOn", "club", "athlete", "coachName", "period", "sections", "summary", "attendance", "training", "results", "tests", "goals", "wellness", "injuries"] as const

/**
 * Reads a stored snapshot (from the database, a link, or this browser). Returns null for anything
 * that is not a report. Keys the sheet does not know are dropped, and a health section that the
 * snapshot's own sections do not list is dropped too.
 */
export function readAthleteReportSnapshot(value: unknown): AthleteReportSnapshot | null {
  if (!isRecord(value) || value.version !== 1) return null
  const athlete = value.athlete
  const period = value.period
  if (!isRecord(athlete) || typeof athlete.name !== "string") return null
  if (!isRecord(period) || typeof period.from !== "string" || typeof period.to !== "string") return null
  const sections = cleanReportSections(Array.isArray(value.sections) ? value.sections.filter((key): key is string => typeof key === "string") : [])
  const clean: Record<string, unknown> = {}
  for (const key of SNAPSHOT_KEYS) {
    if (value[key] === undefined || value[key] === null) continue
    if ((key === "attendance" || key === "training" || key === "results" || key === "tests" || key === "goals" || key === "wellness" || key === "injuries") && (!sections.includes(key) || !isRecord(value[key]))) continue
    clean[key] = value[key]
  }
  clean.sections = sections
  clean.summary = typeof value.summary === "string" ? value.summary : ""
  clean.coachName = typeof value.coachName === "string" ? value.coachName : ""
  clean.savedOn = typeof value.savedOn === "string" ? value.savedOn : period.to
  clean.club = isRecord(value.club) && typeof value.club.name === "string" ? value.club : null
  return clean as unknown as AthleteReportSnapshot
}

/* ---------- Links ---------------------------------------------------------------------------------- */

export const REPORT_LINK_DAYS = [7, 30, 90] as const
export type ReportLinkDays = (typeof REPORT_LINK_DAYS)[number]
export const REPORT_LINK_DEFAULT_DAYS: ReportLinkDays = 30

export type ReportLinkState = "active" | "expired" | "revoked"

/** Revoked wins over expired: that is what the coach did. */
export function reportLinkState(link: { expiresAt: string; revokedAt: string | null }, now: Date = new Date()): ReportLinkState {
  if (link.revokedAt) return "revoked"
  return new Date(link.expiresAt).getTime() <= now.getTime() ? "expired" : "active"
}

/** A link token: 64 lower case hex characters. */
export function isReportLinkToken(token: string | null | undefined): token is string {
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token)
}

/** Where a link opens. The token rides in the fragment, which browsers do not send to servers or log. */
export function reportLinkPath(token: string): string {
  return `/shared/report#${token}`
}
