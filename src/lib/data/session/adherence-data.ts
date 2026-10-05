import type { SupabaseClient } from "@supabase/supabase-js"
import { listAthleteAvailability } from "@/lib/data/athlete/availability-data"
import { mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { adherenceCounts, adherencePercent, type AdherenceCount, type AdherenceSession } from "@/lib/data/session/adherence"

export const ADHERENCE_WINDOW_DAYS = 28

/**
 * One athlete's plan adherence over the last `days` days, by the shared rule in adherence.ts.
 * `percent` is null when no sessions were due.
 */
export async function loadAthleteAdherence(
  client: SupabaseClient,
  athleteId: string,
  days: number = ADHERENCE_WINDOW_DAYS,
): Promise<Result<AdherenceCount & { percent: number | null }>> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const from = since.toISOString().slice(0, 10)
  const to = new Date().toISOString().slice(0, 10)

  const [sessionsResult, completionsResult, availabilityResult] = await Promise.all([
    client.from("sessions").select("id, athlete_id, scheduled_for, status, origin").eq("athlete_id", athleteId).gte("scheduled_for", from).lte("scheduled_for", to),
    client.from("session_completions").select("session_id").eq("athlete_id", athleteId).gte("completion_date", from),
    listAthleteAvailability([athleteId], { from }),
  ])
  if (sessionsResult.error) return { ok: false, error: mapPostgrestError(sessionsResult.error) }
  if (completionsResult.error) return { ok: false, error: mapPostgrestError(completionsResult.error) }
  // Excused days make the figure kinder. If they cannot be read the figure is still shown.
  if (!availabilityResult.ok) console.warn("[adherence] could not read availability", availabilityResult.error)

  const sessions = ((sessionsResult.data as Array<{ id: string; athlete_id: string; scheduled_for: string; status: string; origin: string | null }> | null) ?? []).map(
    (row): AdherenceSession => ({ id: row.id, athleteId: row.athlete_id, scheduledFor: row.scheduled_for, status: row.status, origin: row.origin }),
  )
  const completed = new Set(((completionsResult.data as Array<{ session_id: string }> | null) ?? []).map((row) => row.session_id))
  const count = adherenceCounts(sessions, completed, availabilityResult.ok ? availabilityResult.data : [], { from, to }).get(athleteId) ?? { due: 0, done: 0, excused: 0 }
  return ok({ ...count, percent: adherencePercent(count) })
}
