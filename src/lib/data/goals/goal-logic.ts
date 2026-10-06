/**
 * Goals: a target mark in an event. Pure rules, shared by the screens, the mock store and the
 * unit tests. The database applies the same rules in
 * supabase/migrations/20261011110000_athlete_goals_and_history.sql (athlete_goals_normalise).
 * Keep the two in step.
 *
 * No runtime imports: this file is compiled on its own for the unit tests.
 */
import type { AthleteResult, MarkUnit } from "@/lib/data/pr/marks"

export type AthleteGoal = {
  id: string
  athleteId: string
  eventKey: string
  eventLabel: string
  /** The same grouping as a result's eventGroup: "k:100m" or "o:flying 30m". */
  eventGroup: string
  unit: MarkUnit
  lowerIsBetter: boolean
  /** The mark to reach, in the event's unit (seconds, metres, kilograms, points). */
  targetValue: number
  /** The athlete's best when the goal was set. Null when they had no mark. */
  startValue: number | null
  /** YYYY-MM-DD, or null for no date. */
  targetDate: string | null
  note: string | null
  /** The day it was reached. Null while it is open. */
  achievedOn: string | null
  /** The result that met the target. Null when marked achieved by hand. */
  achievedResultId: string | null
  achievedManually: boolean
  /** True when a coach or club admin set it for the athlete. */
  setByStaff: boolean
  createdAt: string
}

type RankedResult = Pick<AthleteResult, "id" | "eventGroup" | "compareValue" | "windLegal" | "date" | "createdAt">

/** True when `value` is at least as good as `target`. */
export function meetsTarget(value: number, target: number, lowerIsBetter: boolean): boolean {
  const diff = Math.round((value - target) * 1000) / 1000
  return lowerIsBetter ? diff <= 0 : diff >= 0
}

/** The best wind legal mark of one event group, or null. */
export function currentBest<T extends RankedResult>(results: T[], eventGroup: string, lowerIsBetter: boolean): T | null {
  let best: T | null = null
  for (const result of results) {
    if (result.eventGroup !== eventGroup || !result.windLegal) continue
    if (best === null || (lowerIsBetter ? result.compareValue < best.compareValue : result.compareValue > best.compareValue)) best = result
  }
  return best
}

/**
 * How far along the way from the starting mark to the target the current best is, 0 to 100.
 * No mark yet is 0. A best that meets the target is 100. With no starting mark, any mark short
 * of the target is 0 (there is nothing to measure the distance from).
 */
export function goalProgressPercent(start: number | null, current: number | null, target: number, lowerIsBetter: boolean): number {
  if (current === null) return 0
  if (meetsTarget(current, target, lowerIsBetter)) return 100
  if (start === null) return 0
  const span = lowerIsBetter ? start - target : target - start
  if (span <= 0) return 0
  const done = lowerIsBetter ? start - current : current - start
  return Math.max(0, Math.min(99, Math.floor((done / span) * 100)))
}

/** How much is left between the current best and the target, never negative. */
export function remainingToTarget(current: number, target: number, lowerIsBetter: boolean): number {
  const left = lowerIsBetter ? current - target : target - current
  return Math.max(0, Math.round(left * 1000) / 1000)
}

/**
 * Whether results achieve a goal: the first wind legal result of the goal's event, dated on or
 * after the day the goal was set, that meets the target. A goal marked by hand keeps its state.
 */
export function achievementFromResults(
  goal: Pick<AthleteGoal, "eventGroup" | "targetValue" | "lowerIsBetter" | "createdAt" | "achievedManually" | "achievedOn" | "achievedResultId">,
  results: RankedResult[],
): { achievedOn: string | null; achievedResultId: string | null } {
  if (goal.achievedManually) return { achievedOn: goal.achievedOn, achievedResultId: null }
  // The goal's day is stored in UTC and a result's date is the athlete's local day, so an evening
  // result in Jamaica can be dated the day "before" the goal. One day of slack, as in the database.
  const sinceDay = new Date(`${goal.createdAt.slice(0, 10)}T00:00:00Z`)
  sinceDay.setUTCDate(sinceDay.getUTCDate() - 1)
  const since = sinceDay.toISOString().slice(0, 10)
  const hit = results
    .filter((result) => result.eventGroup === goal.eventGroup && result.windLegal && result.date >= since && meetsTarget(result.compareValue, goal.targetValue, goal.lowerIsBetter))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))[0]
  return hit ? { achievedOn: hit.date, achievedResultId: hit.id } : { achievedOn: null, achievedResultId: null }
}

export type GoalStateKind = "achieved" | "past-date" | "on-track"
export type GoalState = { kind: GoalStateKind; tone: "green" | "coral" | "blue"; label: string }

/** The state shown as a dot plus text. `today` is YYYY-MM-DD. */
export function goalState(goal: Pick<AthleteGoal, "achievedOn" | "targetDate">, today: string): GoalState {
  if (goal.achievedOn) return { kind: "achieved", tone: "green", label: "Achieved" }
  if (goal.targetDate && today > goal.targetDate) return { kind: "past-date", tone: "coral", label: "Past the date" }
  return { kind: "on-track", tone: "blue", label: "On track" }
}

/** Whole days from `today` to the target date. Negative when the date has passed. */
export function daysUntil(targetDate: string, today: string): number {
  const parse = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
  return Math.round((parse(targetDate) - parse(today)) / 86_400_000)
}

/** Open goals first (the nearest date first, undated last), then achieved ones, newest first. */
export function sortGoals<T extends Pick<AthleteGoal, "achievedOn" | "targetDate" | "createdAt">>(goals: T[]): T[] {
  return [...goals].sort((a, b) => {
    if (Boolean(a.achievedOn) !== Boolean(b.achievedOn)) return a.achievedOn ? 1 : -1
    if (a.achievedOn && b.achievedOn) return b.achievedOn.localeCompare(a.achievedOn)
    if (a.targetDate !== b.targetDate) return (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999")
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export type GoalInput = {
  eventKey: string
  /** Needed when eventKey is "other": the name and unit of the athlete's own test. */
  eventLabel?: string | null
  unit?: MarkUnit | null
  lowerIsBetter?: boolean | null
  targetValue: number
  targetDate: string | null
  note: string | null
}

/** A message when the input cannot be saved, otherwise null. `best` is the current best of that event. */
export function validateGoalInput(
  input: GoalInput,
  context: { lowerIsBetter: boolean; best: number | null; today: string; isNew: boolean },
): string | null {
  if (!input.eventKey) return "Choose an event."
  if (!(input.targetValue > 0) || input.targetValue >= 1_000_000) return "Enter the mark you are aiming for."
  if (input.targetDate !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) return "Choose a date, or leave it empty."
    if (context.isNew && input.targetDate < context.today) return "The date to reach it by cannot be in the past."
  }
  if ((input.note ?? "").length > 500) return "Keep the note to 500 characters."
  if (context.isNew && context.best !== null && meetsTarget(context.best, input.targetValue, context.lowerIsBetter)) {
    return "This mark is already reached. Set a target beyond the current best."
  }
  return null
}
