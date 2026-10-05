/**
 * Plan adherence, the one definition used everywhere (coach dashboard, coach athlete screen,
 * club admin dashboard and reports, the athlete's own profile):
 *
 *   sessions completed / sessions that were due and not excused
 *
 * - Due: set by the coach (origin "plan") and scheduled inside the window, up to today.
 * - Excused, so removed from the count: skipped with a reason, or scheduled inside a period the
 *   athlete was marked unavailable (injured, sick, away). A session that was done anyway still counts.
 * - Sessions the athlete added themselves are in neither number.
 * - Nothing due means there is no figure (null). It is never shown as 100%.
 *
 * Pure and free of imports, so the unit tests and every data module can use it.
 */

export type AdherenceSession = {
  id: string
  athleteId: string
  /** ISO day, yyyy-mm-dd. */
  scheduledFor: string
  status: string
  /** Missing or null counts as "plan" (rows from before the column existed). */
  origin?: string | null
}

export type AdherencePeriod = {
  athleteId: string
  startsOn: string
  /** Last day unavailable. Null means until further notice. */
  endsOn: string | null
}

export type AdherenceCount = { due: number; done: number; excused: number }

export const NO_SESSIONS_DUE = "No sessions due"

export function isInsidePeriod(day: string, athleteId: string, periods: AdherencePeriod[]) {
  const date = day.slice(0, 10)
  return periods.some(
    (period) => period.athleteId === athleteId && date >= period.startsOn.slice(0, 10) && (period.endsOn === null || date <= period.endsOn.slice(0, 10)),
  )
}

/**
 * Counts per athlete. `completedSessionIds` holds sessions with a completion row; a session whose
 * status is "completed" counts as done as well.
 */
export function adherenceCounts(
  sessions: AdherenceSession[],
  completedSessionIds: ReadonlySet<string>,
  periods: AdherencePeriod[],
  window: { from: string; to: string },
): Map<string, AdherenceCount> {
  const counts = new Map<string, AdherenceCount>()
  for (const session of sessions) {
    if ((session.origin ?? "plan") !== "plan") continue
    const day = session.scheduledFor.slice(0, 10)
    if (day < window.from || day > window.to) continue
    const count = counts.get(session.athleteId) ?? { due: 0, done: 0, excused: 0 }
    counts.set(session.athleteId, count)
    const done = session.status === "completed" || completedSessionIds.has(session.id)
    if (done) {
      count.due += 1
      count.done += 1
    } else if (session.status === "skipped" || isInsidePeriod(day, session.athleteId, periods)) {
      count.excused += 1
    } else {
      count.due += 1
    }
  }
  return counts
}

/** Whole percent, or null when nothing was due. */
export function adherencePercent(count: Pick<AdherenceCount, "due" | "done"> | undefined | null): number | null {
  if (!count || count.due <= 0) return null
  return Math.min(100, Math.round((count.done / count.due) * 100))
}

export function sumAdherence(counts: Iterable<AdherenceCount | undefined>): AdherenceCount {
  const total: AdherenceCount = { due: 0, done: 0, excused: 0 }
  for (const count of counts) {
    if (!count) continue
    total.due += count.due
    total.done += count.done
    total.excused += count.excused
  }
  return total
}

/** The mean of the athletes who have a figure, or null when none of them has one. */
export function averageAdherence(values: Array<number | null | undefined>): number | null {
  const known = values.filter((value): value is number => typeof value === "number")
  return known.length > 0 ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length) : null
}

/** "86%" or "No sessions due". */
export function adherenceText(value: number | null | undefined) {
  return typeof value === "number" ? `${value}%` : NO_SESSIONS_DUE
}
