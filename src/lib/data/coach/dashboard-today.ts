import { availabilityCovers, currentAvailability, listAthleteAvailability, type AthleteAvailability } from "@/lib/data/athlete/availability-data"
import { getCompetitionsForStaff, splitCompetitions } from "@/lib/data/competition/competition-data"
import { ok, type Result } from "@/lib/data/result"
import { skippedLabel, type SkipReason } from "@/lib/data/session/types"
import { getOpenPainReportsForTeam } from "@/lib/data/wellness/pain-report-data"
import type { TeamPainReport } from "@/lib/data/wellness/pain-report-types"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * What the coach dashboard shows about today, on top of the squad snapshot: who is unavailable,
 * who has done today's planned session, open pain reports that affect training and the next
 * competition. Every part is optional: if one cannot be read it comes back empty and the rest of
 * the dashboard still works. Works in mock mode on the demo squad.
 */

export type TodaySessionState = "done" | "not-done" | "excused"

export type TodaySessionRow = {
  athleteId: string
  name: string
  state: TodaySessionState
  /** Why it is excused: "injured", "skipped: sick". Lower case, for use after the name. */
  reason: string | null
}

export type CoachTodaySnapshot = {
  /** The period that applies now (or next) per athlete. Athletes with nothing set are not in it. */
  availability: Record<string, AthleteAvailability>
  /** Null when no session is planned for the team today. */
  todaySession: { title: string; rows: TodaySessionRow[] } | null
  /** Open reports where training is modified or not possible, worst first. */
  painReports: TeamPainReport[]
  nextCompetition: { id: string; name: string; startDate: string; endDate: string; venue: string | null; enteredCount: number } | null
}

const EMPTY: CoachTodaySnapshot = { availability: {}, todaySession: null, painReports: [], nextCompetition: null }

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
}

export async function getCoachTodaySnapshot(params: {
  teamId: string | null
  todayKey: string
  athletes: Array<{ id: string; name: string; adherence?: number | null }>
  /** Mock mode only: the title of the demo plan's session for today, or null on a rest day. */
  mockSessionTitle?: string | null
}): Promise<Result<CoachTodaySnapshot>> {
  const { teamId, todayKey, athletes } = params
  if (athletes.length === 0) return ok(EMPTY)
  const ids = athletes.map((athlete) => athlete.id)

  const [availabilityResult, painResult, competitionResult] = await Promise.all([
    listAthleteAvailability(ids, { from: todayKey }),
    teamId ? getOpenPainReportsForTeam(teamId) : Promise.resolve(ok<TeamPainReport[]>([])),
    getCompetitionsForStaff({ teamId }),
  ])

  const periods = availabilityResult.ok ? availabilityResult.data : []
  const availability: Record<string, AthleteAvailability> = {}
  for (const athleteId of ids) {
    const current = currentAvailability(periods.filter((period) => period.athleteId === athleteId), todayKey)
    if (current) availability[athleteId] = current
  }
  const excusedToday = (athleteId: string) => periods.find((period) => period.athleteId === athleteId && period.endedAt === null && availabilityCovers(period, todayKey)) ?? null

  const painReports = (painResult.ok ? painResult.data : []).filter((report) => report.trainingImpact !== "none" && ids.includes(report.athleteId))

  const upcoming = competitionResult.ok ? splitCompetitions(competitionResult.data, todayKey).upcoming.filter((item) => item.scope !== "athlete") : []
  const next = upcoming[0] ?? null
  const nextCompetition = next
    ? {
        id: next.id,
        name: next.name,
        startDate: next.startDate,
        endDate: next.endDate,
        venue: next.venue ?? next.location,
        enteredCount: new Set(next.entries.filter((entry) => entry.status === "entered").map((entry) => entry.athleteId)).size,
      }
    : null

  let todaySession: CoachTodaySnapshot["todaySession"] = null

  if (getBackendMode() !== "supabase") {
    if (params.mockSessionTitle) {
      todaySession = {
        title: params.mockSessionTitle,
        rows: athletes.map((athlete) => {
          const period = excusedToday(athlete.id)
          if (period) return { athleteId: athlete.id, name: athlete.name, state: "excused", reason: period.kind }
          return { athleteId: athlete.id, name: athlete.name, state: (athlete.adherence ?? 0) >= 90 ? "done" : "not-done", reason: null }
        }),
      }
    }
    return ok({ availability, todaySession, painReports, nextCompetition })
  }

  const client = getBrowserSupabaseClient()
  if (client) {
    try {
      const { data, error } = await client
        .from("sessions")
        .select("id, athlete_id, title, status, origin, skip_reason")
        .in("athlete_id", ids)
        .eq("scheduled_for", todayKey)
        .limit(2000)
      if (error) throw error
      type Row = { id: string; athlete_id: string; title: string; status: string; origin: string | null; skip_reason: SkipReason | null }
      // Only what the coach planned. A session an athlete added for themselves is not "today's session".
      const planned = ((data as Row[] | null) ?? []).filter((row) => (row.origin ?? "plan") === "plan")
      if (planned.length > 0) {
        const completions = await client.from("session_completions").select("session_id").in("session_id", planned.map((row) => row.id)).limit(2000)
        const completed = new Set(((completions.data as Array<{ session_id: string }> | null) ?? []).map((row) => row.session_id))
        const nameOf = new Map(athletes.map((athlete) => [athlete.id, athlete.name]))
        const byAthlete = new Map<string, TodaySessionRow>()
        for (const row of planned) {
          const done = row.status === "completed" || completed.has(row.id)
          const period = excusedToday(row.athlete_id)
          const next: TodaySessionRow = done
            ? { athleteId: row.athlete_id, name: nameOf.get(row.athlete_id) ?? "Athlete", state: "done", reason: null }
            : row.status === "skipped"
              ? { athleteId: row.athlete_id, name: nameOf.get(row.athlete_id) ?? "Athlete", state: "excused", reason: skippedLabel(row.skip_reason).toLowerCase() }
              : period
                ? { athleteId: row.athlete_id, name: nameOf.get(row.athlete_id) ?? "Athlete", state: "excused", reason: period.kind }
                : { athleteId: row.athlete_id, name: nameOf.get(row.athlete_id) ?? "Athlete", state: "not-done", reason: null }
          // An athlete with two planned sessions today counts as done only when none is left open.
          const existing = byAthlete.get(row.athlete_id)
          if (!existing || next.state === "not-done" || (existing.state === "done" && next.state === "excused")) byAthlete.set(row.athlete_id, next)
        }
        todaySession = {
          title: mostCommon(planned.map((row) => row.title)) ?? "Today's session",
          rows: [...byAthlete.values()].sort((left, right) => left.name.localeCompare(right.name)),
        }
      }
    } catch (cause) {
      console.warn("[coach] could not read today's sessions", cause)
    }
  }

  return ok({ availability, todaySession, painReports, nextCompetition })
}
