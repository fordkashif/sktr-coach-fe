import { availabilityCovers, currentAvailability, listAthleteAvailability, type AthleteAvailability } from "@/lib/data/athlete/availability-data"
import type { Squad } from "@/lib/data/coach/squads"
import { listSquadsForTeams } from "@/lib/data/coach/squads-data"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { addDaysIso, todayIso } from "@/lib/data/training-plan/plan-builder-model"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { buildAthleteLoad, sessionLoad, type AthleteLoad, type LoadWeek } from "./training-load"

/**
 * Training load for the screens. One API for both backends.
 * Real backend: training_load_weeks() and training_load_sessions() (migration 20261015100000) do
 * the sums and decide who may read: the athlete, the coaches of their team, club admins. One call
 * returns a whole team. Mock mode: the same sums in training-load.ts over the demo sessions.
 */

const isMock = () => getBackendMode() !== "supabase"
const mock = () => import("./training-load-mock")

/** The running week and the 8 full weeks before it (the spark line). */
export const TEAM_LOAD_WEEKS = 9
export const ATHLETE_LOAD_WEEKS = 12

export type TeamLoadRow = {
  athleteId: string
  name: string
  teamId: string | null
  load: AthleteLoad
  /** Set while the athlete is injured, sick or away today. */
  availability: AthleteAvailability | null
}

export type TeamLoad = {
  asOf: string
  rows: TeamLoadRow[]
  /** The live squads of the team or teams shown. Empty when there are none (or they could not be read). */
  squads: Squad[]
}

export type LoadSessionRow = {
  id: string
  date: string
  title: string
  effort: number | null
  minutes: number | null
  /** Null: no load recorded. */
  load: number | null
}

export type AthleteLoadDetail = {
  asOf: string
  load: AthleteLoad
  /** Finished sessions of the last 7 days, newest first. */
  sessions: LoadSessionRow[]
}

type WeekRow = {
  athlete_id: string
  week_start: string
  week_load: number
  sessions_with_load: number
  sessions_without_load: number
  planned_load: number | null
  acute_load: number
  chronic_load: number | string
  load_ratio: number | string | null
  first_load_on: string | null
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** Rows of training_load_weeks() grouped per athlete, weeks oldest first. */
export function loadsFromRows(rows: WeekRow[]): Map<string, AthleteLoad> {
  const byAthlete = new Map<string, AthleteLoad>()
  for (const row of [...rows].sort((left, right) => left.week_start.localeCompare(right.week_start))) {
    const week: LoadWeek = {
      weekStart: row.week_start,
      load: Number(row.week_load) || 0,
      sessionsWithLoad: Number(row.sessions_with_load) || 0,
      sessionsWithoutLoad: Number(row.sessions_without_load) || 0,
      planned: numberOrNull(row.planned_load),
      acute: Number(row.acute_load) || 0,
      chronic: Number(row.chronic_load) || 0,
      ratio: numberOrNull(row.load_ratio),
    }
    const existing = byAthlete.get(row.athlete_id)
    if (existing) existing.weeks.push(week)
    else byAthlete.set(row.athlete_id, { weeks: [week], firstLoadOn: row.first_load_on })
  }
  return byAthlete
}

async function readWeeks(params: { teamId: string | null; athleteId: string | null; asOf: string; weeks: number }): Promise<Result<Map<string, AthleteLoad>>> {
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const { data, error } = await client.rpc("training_load_weeks", { p_team_id: params.teamId, p_athlete_id: params.athleteId, p_as_of: params.asOf, p_weeks: params.weeks })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(loadsFromRows((data as WeekRow[] | null) ?? []))
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** The period that covers today. One that only starts later does not count. */
function unavailableNow(periods: AthleteAvailability[], today: string): AthleteAvailability | null {
  const period = currentAvailability(periods, today)
  return period && availabilityCovers(period, today) ? period : null
}

/** Every athlete of a team (null: every athlete the caller may see) with their weekly load. One query for the loads. */
export async function getTeamLoad(params: { teamId: string | null; weeks?: number }): Promise<Result<TeamLoad>> {
  const asOf = todayIso()
  const weeks = params.weeks ?? TEAM_LOAD_WEEKS
  let athletes: Array<{ id: string; name: string; teamId: string | null }>
  let loads: Map<string, AthleteLoad>

  if (isMock()) {
    const { mockLoadAthletes, mockLoadSessions } = await mock()
    athletes = mockLoadAthletes(params.teamId)
    loads = new Map(
      athletes.map((athlete) => {
        const sessions = mockLoadSessions(athlete.id, asOf)
        return [athlete.id, buildAthleteLoad(sessions.done, sessions.planned, asOf, weeks)]
      }),
    )
  } else {
    const result = await readWeeks({ teamId: params.teamId, athleteId: null, asOf, weeks })
    if (!result.ok) return result
    loads = result.data
    const client = getBrowserSupabaseClient()
    if (!client) return err("UNKNOWN", "Supabase client is not configured.")
    const ids = [...loads.keys()]
    athletes = []
    for (let index = 0; index < ids.length; index += 200) {
      const { data, error } = await client.from("athletes").select("id, first_name, last_name, team_id").in("id", ids.slice(index, index + 200))
      if (error) return { ok: false, error: mapPostgrestError(error) }
      for (const row of (data as Array<{ id: string; first_name: string | null; last_name: string | null; team_id: string | null }> | null) ?? []) {
        athletes.push({ id: row.id, name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Athlete", teamId: row.team_id })
      }
    }
  }

  const ids = athletes.map((athlete) => athlete.id)
  const teamIds = params.teamId ? [params.teamId] : [...new Set(athletes.flatMap((athlete) => (athlete.teamId ? [athlete.teamId] : [])))]
  // Availability and squads are extras: the table still shows without them.
  const [periods, squads] = await Promise.all([listAthleteAvailability(ids, { from: asOf }), teamIds.length > 0 ? listSquadsForTeams(teamIds) : Promise.resolve(ok<Squad[]>([]))])
  const byAthlete = new Map<string, AthleteAvailability[]>()
  for (const period of periods.ok ? periods.data : []) byAthlete.set(period.athleteId, [...(byAthlete.get(period.athleteId) ?? []), period])

  return ok({
    asOf,
    rows: athletes.flatMap((athlete) => {
      const load = loads.get(athlete.id)
      return load ? [{ athleteId: athlete.id, name: athlete.name, teamId: athlete.teamId, load, availability: unavailableNow(byAthlete.get(athlete.id) ?? [], asOf) }] : []
    }),
    squads: squads.ok ? squads.data : [],
  })
}

/** One athlete for their coach: 12 weeks and the sessions of the last 7 days. */
export async function getAthleteLoad(athleteId: string, weeks: number = ATHLETE_LOAD_WEEKS): Promise<Result<AthleteLoadDetail>> {
  const asOf = todayIso()
  const from = addDaysIso(asOf, -6)
  if (isMock()) {
    const { mockLoadSessions } = await mock()
    const sessions = mockLoadSessions(athleteId, asOf)
    return ok({
      asOf,
      load: buildAthleteLoad(sessions.done, sessions.planned, asOf, weeks),
      sessions: sessions.done
        .filter((session) => session.date >= from && session.date <= asOf)
        .sort((left, right) => right.date.localeCompare(left.date))
        .map((session) => ({ id: session.id, date: session.date, title: session.title, effort: session.effort, minutes: session.minutes, load: sessionLoad(session.effort, session.minutes) })),
    })
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const [weeksResult, sessionsResult] = await Promise.all([
      readWeeks({ teamId: null, athleteId, asOf, weeks }),
      client.rpc("training_load_sessions", { p_athlete_id: athleteId, p_from: from, p_to: asOf }),
    ])
    if (!weeksResult.ok) return weeksResult
    if (sessionsResult.error) return { ok: false, error: mapPostgrestError(sessionsResult.error) }
    const load = weeksResult.data.get(athleteId)
    if (!load) return err("NOT_FOUND", "This athlete's load could not be read. You may no longer coach their team.")
    type SessionRow = { session_id: string; completed_on: string; title: string | null; effort: number | null; duration_minutes: number | null; session_load: number | null }
    return ok({
      asOf,
      load,
      sessions: ((sessionsResult.data as SessionRow[] | null) ?? []).map((row) => ({
        id: row.session_id,
        date: row.completed_on,
        title: row.title || "Session",
        effort: row.effort,
        minutes: row.duration_minutes,
        load: row.session_load,
      })),
    })
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** The signed-in athlete's own load. */
export async function getMyLoad(weeks: number = ATHLETE_LOAD_WEEKS): Promise<Result<{ asOf: string; load: AthleteLoad }>> {
  const asOf = todayIso()
  if (isMock()) {
    const { mockLoadSessions } = await mock()
    const { MOCK_ATHLETE_ID } = await import("@/lib/data/session/session-mock")
    const sessions = mockLoadSessions(MOCK_ATHLETE_ID, asOf)
    return ok({ asOf, load: buildAthleteLoad(sessions.done, sessions.planned, asOf, weeks) })
  }
  // No team and no athlete: the function returns the caller's own athlete record only.
  const result = await readWeeks({ teamId: null, athleteId: null, asOf, weeks })
  if (!result.ok) return result
  const load = [...result.data.values()][0]
  return ok({ asOf, load: load ?? buildAthleteLoad([], [], asOf, weeks) })
}
