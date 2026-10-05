/**
 * Session history: what each past session turned out to be, the filter, and the grouping by week.
 * Pure, with no runtime imports, so the unit tests can compile it on its own.
 */
import type { AthleteSessionRef } from "@/lib/data/session/types"

/** "open" is a session that is not over yet: today's, or one the athlete added and has not finished. */
export type SessionOutcome = "done" | "skipped" | "missed" | "excused" | "open"
export type HistoryFilter = "all" | "done" | "skipped" | "missed"

export type SessionHistoryEntry = AthleteSessionRef & {
  /** A few words on what was logged ("3 exercises, 11 sets: Back squat, Flying 30m and 1 more"). Null when nothing was. */
  summary: string | null
}

/**
 * What a session came to. A planned session whose day has passed without being done or skipped is
 * missed, unless the athlete was marked unavailable that day (excused).
 */
export function sessionOutcome(session: Pick<AthleteSessionRef, "status" | "origin" | "date">, today: string, excused: boolean): SessionOutcome {
  if (session.status === "completed") return "done"
  if (session.status === "skipped") return "skipped"
  if (session.origin === "athlete" || session.date >= today) return "open"
  return excused ? "excused" : "missed"
}

export function matchesFilter(outcome: SessionOutcome, filter: HistoryFilter): boolean {
  return filter === "all" || outcome === filter
}

function parseDay(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
}

function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(day: string, days: number): string {
  return toDay(parseDay(day) + days * 86_400_000)
}

/** The Monday of the week a day falls in, YYYY-MM-DD. */
export function weekStartOf(day: string): string {
  const weekday = (new Date(parseDay(day)).getUTCDay() + 6) % 7
  return addDays(day, -weekday)
}

export type HistoryWeek<T> = { weekStart: string; weekEnd: string; items: T[] }

/** Groups by Monday to Sunday week, newest week first, keeping the order of items inside a week. */
export function groupByWeek<T extends { date: string }>(items: T[]): Array<HistoryWeek<T>> {
  const weeks = new Map<string, T[]>()
  for (const item of items) {
    const key = weekStartOf(item.date)
    const list = weeks.get(key)
    if (list) list.push(item)
    else weeks.set(key, [item])
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([weekStart, list]) => ({ weekStart, weekEnd: addDays(weekStart, 6), items: list }))
}

/** "This week", "Last week", or null for an older week (the screen then writes its dates). */
export function relativeWeekName(weekStart: string, today: string): "This week" | "Last week" | null {
  const current = weekStartOf(today)
  if (weekStart === current) return "This week"
  if (weekStart === addDays(current, -7)) return "Last week"
  return null
}

/** A few words on what was logged, from each exercise and its number of logged sets. */
export function summariseLogged(exercises: Array<{ label: string; sets: number }>, maxNames = 2): string | null {
  const logged = exercises.filter((exercise) => exercise.sets > 0 && exercise.label.trim())
  if (logged.length === 0) return null
  const sets = logged.reduce((total, exercise) => total + exercise.sets, 0)
  const names = logged.slice(0, maxNames).map((exercise) => exercise.label.trim())
  const more = logged.length - names.length
  const counts = `${logged.length} ${logged.length === 1 ? "exercise" : "exercises"}, ${sets} ${sets === 1 ? "set" : "sets"}`
  return `${counts}: ${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}`
}
