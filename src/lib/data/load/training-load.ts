import { addDaysIso } from "../training-plan/plan-builder-model"

/**
 * Training load, worked out the session RPE way: load of a session = effort (1 to 10) x minutes.
 * Everything here is pure. Mock mode uses it directly; the real backend does the same sums in
 * training_load_weeks() (migration 20261015100000) and the unit and database tests check both
 * against the same hand-worked examples.
 *
 * Weeks run Monday to Sunday. For a week, "acute" is the 7 days ending on the week's last day,
 * "chronic" is the 28 days ending on that same day divided by 4 (the rolling weekly average), and
 * the ratio is acute / chronic. For the week still running the 7 and 28 days end on the as-of day
 * once a session was finished on it, and on the day before until then: a morning before training
 * would otherwise always look like a light week.
 */

/** Below this the last 7 days are well below the usual week. */
export const RATIO_USUAL_FROM = 0.8
/** Up to and including this the last 7 days are in the usual range. */
export const RATIO_USUAL_TO = 1.3
/** Above this the last 7 days are well above the usual week. */
export const RATIO_WELL_ABOVE = 1.5
/** The ratio is shown once the first session with a load is this many days old. */
export const RATIO_MIN_HISTORY_DAYS = 28

export type LoadBand = "well-below" | "usual" | "above" | "well-above"

/** A finished session. Effort or minutes may be missing: then it has no load. */
export type DoneSession = { date: string; effort: number | null; minutes: number | null }
/** A session from the plan. Counts towards planned load only with both numbers. */
export type PlannedSession = { date: string; minutes: number | null; effort: number | null }

export type LoadWeek = {
  /** The Monday, yyyy-mm-dd. */
  weekStart: string
  load: number
  sessionsWithLoad: number
  /** Finished sessions with no effort or no minutes. Shown as "no load recorded", never guessed. */
  sessionsWithoutLoad: number
  /** Null when no planned session of the week has both minutes and an intended effort. */
  planned: number | null
  acute: number
  chronic: number
  /** Null until there are 4 weeks of history, and when the chronic load is 0. */
  ratio: number | null
}

export type AthleteLoad = {
  /** Oldest first. The last one is the week holding the as-of day. */
  weeks: LoadWeek[]
  /** The day of the first session with a load, ever. */
  firstLoadOn: string | null
}

function validEffort(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 10
}

function validMinutes(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
}

/** Effort x minutes, or null when either is missing. */
export function sessionLoad(effort: number | null | undefined, minutes: number | null | undefined): number | null {
  return validEffort(effort) && validMinutes(minutes) ? Math.round(effort) * Math.round(minutes) : null
}

/** The Monday of the week holding the day. */
export function mondayOf(dateIso: string): string {
  const parsed = new Date(`${dateIso}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return dateIso
  return addDaysIso(dateIso, -((parsed.getUTCDay() + 6) % 7))
}

/** Minutes typed by a person: a whole number from 1 to 600, otherwise null. */
export function cleanMinutes(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  if (!Number.isFinite(number)) return null
  const rounded = Math.round(number)
  return rounded >= 1 && rounded <= 600 ? rounded : null
}

/** Acute / chronic to 2 places, from whole sums so both backends round the same way. */
export function loadRatio(acute: number, sum28: number): number | null {
  if (sum28 <= 0) return null
  return Math.round((acute * 400) / sum28) / 100
}

/**
 * The weeks up to and including the one holding `asOf`. Sessions after `asOf` are ignored.
 * A week with no sessions is a week of zero load, not a missing week.
 */
export function buildAthleteLoad(done: DoneSession[], planned: PlannedSession[], asOf: string, weekCount = 12): AthleteLoad {
  const count = Math.max(1, Math.min(52, Math.round(weekCount) || 12))
  const thisWeek = mondayOf(asOf)
  const past = done.filter((session) => session.date <= asOf)
  const loads = past.flatMap((session) => {
    const load = sessionLoad(session.effort, session.minutes)
    return load === null ? [] : [{ date: session.date, load }]
  })
  const firstLoadOn = loads.reduce<string | null>((first, entry) => (first === null || entry.date < first ? entry.date : first), null)
  const sumBetween = (from: string, to: string) => loads.reduce((sum, entry) => (entry.date >= from && entry.date <= to ? sum + entry.load : sum), 0)

  const weeks: LoadWeek[] = []
  for (let back = count - 1; back >= 0; back -= 1) {
    const weekStart = addDaysIso(thisWeek, -7 * back)
    const weekEnd = addDaysIso(weekStart, 6)
    // The running week: today counts once something was finished today, otherwise the days end yesterday.
    const refDay = weekEnd < asOf ? weekEnd : past.some((session) => session.date === asOf) ? asOf : addDaysIso(asOf, -1)
    const inWeek = past.filter((session) => session.date >= weekStart && session.date <= weekEnd)
    const sessionsWithLoad = inWeek.filter((session) => sessionLoad(session.effort, session.minutes) !== null).length
    const plannedLoads = planned
      .filter((session) => session.date >= weekStart && session.date <= weekEnd)
      .flatMap((session) => {
        const load = sessionLoad(session.effort, session.minutes)
        return load === null ? [] : [load]
      })
    const acute = sumBetween(addDaysIso(refDay, -6), refDay)
    const sum28 = sumBetween(addDaysIso(refDay, -27), refDay)
    const enoughHistory = firstLoadOn !== null && firstLoadOn <= addDaysIso(refDay, -(RATIO_MIN_HISTORY_DAYS - 1))
    weeks.push({
      weekStart,
      load: sumBetween(weekStart, weekEnd),
      sessionsWithLoad,
      sessionsWithoutLoad: inWeek.length - sessionsWithLoad,
      planned: plannedLoads.length > 0 ? plannedLoads.reduce((sum, load) => sum + load, 0) : null,
      acute,
      chronic: sum28 / 4,
      ratio: enoughHistory ? loadRatio(acute, sum28) : null,
    })
  }
  return { weeks, firstLoadOn }
}

export function loadBand(ratio: number | null): LoadBand | null {
  if (ratio === null) return null
  if (ratio < RATIO_USUAL_FROM) return "well-below"
  if (ratio <= RATIO_USUAL_TO) return "usual"
  if (ratio <= RATIO_WELL_ABOVE) return "above"
  return "well-above"
}

export const LOAD_BAND_LABEL: Record<LoadBand, string> = {
  "well-below": "Well below usual",
  usual: "In the usual range",
  above: "Above usual",
  "well-above": "Well above usual",
}

/** The dot beside the band on coach screens. */
export const LOAD_BAND_TONE: Record<LoadBand, "green" | "amber" | "coral" | "neutral"> = {
  "well-below": "neutral",
  usual: "green",
  above: "amber",
  "well-above": "coral",
}

export function currentWeek(load: AthleteLoad): LoadWeek | null {
  return load.weeks[load.weeks.length - 1] ?? null
}

export function previousWeek(load: AthleteLoad): LoadWeek | null {
  return load.weeks[load.weeks.length - 2] ?? null
}

/** How many more days of history the ratio needs. 0 when it can be shown. */
export function daysUntilRatio(firstLoadOn: string | null, asOf: string): number {
  if (!firstLoadOn) return RATIO_MIN_HISTORY_DAYS
  const days = Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${firstLoadOn}T00:00:00Z`)) / 86_400_000) + 1
  return Math.max(0, RATIO_MIN_HISTORY_DAYS - days)
}

/** Why there is no band, in a few words for a table cell. */
export function noBandReason(load: AthleteLoad, asOf: string): string {
  if (!load.firstLoadOn) return "No load recorded"
  const left = daysUntilRatio(load.firstLoadOn, asOf)
  if (left > 0) return `Needs ${left} more ${left === 1 ? "day" : "days"}`
  return "No load in 4 weeks"
}

export function formatLoad(value: number): string {
  return Math.round(value).toLocaleString("en-GB")
}

/** One calm line for the athlete about their own load. No warnings: that is a talk with the coach. */
export function athleteLoadSummary(load: AthleteLoad, asOf: string): string {
  const week = currentWeek(load)
  if (!load.firstLoadOn || !week) return "No load recorded yet. Finish a session with how hard it was and how long it took, and it shows up here."
  const band = loadBand(week.ratio)
  if (band === null) {
    const left = daysUntilRatio(load.firstLoadOn, asOf)
    if (left > 0) return `${formatLoad(week.load)} so far this week. After 4 weeks of logged sessions this will also say how that compares with your usual week.`
    return `${formatLoad(week.load)} so far this week. Nothing with a load was logged in the 4 weeks before, so there is no usual week to compare with yet.`
  }
  if (band === "well-below") return "Your last 7 days were a good deal lighter than your usual week."
  if (band === "usual") return "Your last 7 days were in line with your usual week."
  if (band === "above") return "Your last 7 days were a bit more than your usual week."
  return "Your last 7 days were a lot more than your usual week."
}

export type LoadRowState = { band: LoadBand | null; unavailable: boolean; name: string }

/**
 * Team table order: well above usual first, then above, well below, usual, then athletes with no
 * ratio yet. An athlete who is injured, sick or away is marked and goes to the end: a high or low
 * ratio is expected for them, so it is not flagged.
 */
export function loadRowRank(row: Pick<LoadRowState, "band" | "unavailable">): number {
  if (row.unavailable) return 5
  if (row.band === "well-above") return 0
  if (row.band === "above") return 1
  if (row.band === "well-below") return 2
  if (row.band === "usual") return 3
  return 4
}

export function sortLoadRows<T extends LoadRowState>(rows: T[]): T[] {
  return [...rows].sort((left, right) => loadRowRank(left) - loadRowRank(right) || left.name.localeCompare(right.name))
}

/** "28 Sep": a week on a chart axis. */
export function weekLabel(weekStart: string): string {
  const parsed = new Date(`${weekStart}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return weekStart
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
}
