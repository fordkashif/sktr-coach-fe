import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { resolveEventByName, RESULT_EVENTS } from "@/lib/data/pr/marks"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * The people a coach or club admin picks from: the athletes of a team (to enter in a meet, to
 * message) and, for a club admin, the club's teams. The database only returns what the caller may
 * see: a coach gets the athletes of the teams they are assigned to, a club admin the whole club.
 */

export type StaffAthlete = {
  id: string
  name: string
  teamId: string | null
  /** What the athlete's profile says ("100m", "Long Jump"). Null when not set. */
  primaryEvent: string | null
  /** The athlete's account. Null for an athlete a coach manages who has no login. */
  userId: string | null
  hasLogin: boolean
}

export type StaffTeam = { id: string; name: string }

/** Mock mode: one demo athlete has no login, so "No login" can be seen. */
const MOCK_NO_LOGIN_ATHLETE_ID = "a10"
export const MOCK_SELF_ATHLETE_USER_ID = "mock-athlete-user"

export function mockAthleteUserId(athleteId: string): string | null {
  if (athleteId === MOCK_NO_LOGIN_ATHLETE_ID) return null
  return athleteId === "a1" ? MOCK_SELF_ATHLETE_USER_ID : `mock-user-${athleteId}`
}

/** Active athletes, by name. Pass a team id to keep one team. */
export async function getStaffAthletes(params?: { teamId?: string | null }): Promise<Result<StaffAthlete[]>> {
  if (getBackendMode() !== "supabase") {
    const { mockAthletes } = await import("@/lib/mock-data")
    return ok(
      mockAthletes
        .filter((athlete) => !params?.teamId || athlete.teamId === params.teamId)
        .map((athlete) => ({
          id: athlete.id,
          name: athlete.name,
          teamId: athlete.teamId,
          primaryEvent: athlete.primaryEvent,
          userId: mockAthleteUserId(athlete.id),
          hasLogin: mockAthleteUserId(athlete.id) !== null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
  }

  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const query = client.from("athletes").select("id, team_id, first_name, last_name, primary_event, user_id").eq("is_active", true).limit(2000)
  if (params?.teamId) query.eq("team_id", params.teamId)
  const { data, error } = await query
  if (error) return { ok: false, error: mapPostgrestError(error) }
  type Row = { id: string; team_id: string | null; first_name: string | null; last_name: string | null; primary_event: string | null; user_id: string | null }
  return ok(
    ((data as Row[] | null) ?? [])
      .map((row) => ({
        id: row.id,
        name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Unnamed athlete",
        teamId: row.team_id,
        primaryEvent: row.primary_event?.trim() || null,
        userId: row.user_id,
        hasLogin: Boolean(row.user_id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )
}

/** The club's active teams, by name. For a club admin choosing who a meet or an announcement is for. */
export async function getStaffTeams(): Promise<Result<StaffTeam[]>> {
  if (getBackendMode() !== "supabase") {
    const { mockTeams } = await import("@/lib/mock-data")
    return ok(mockTeams.map((team) => ({ id: team.id, name: team.name })))
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.from("teams").select("id, name").eq("is_archived", false).order("name").limit(500)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(((data as StaffTeam[] | null) ?? []).map((row) => ({ id: row.id, name: row.name })))
}

/**
 * The event on the list that an athlete's "primary event" text means ("100m Hurdles" is the
 * 100m hurdles, "Long Jump" the long jump). Null when it is not on the list, so nothing is guessed.
 */
export function primaryEventKey(primaryEvent: string | null | undefined): string | null {
  const text = (primaryEvent ?? "").trim()
  if (!text) return null
  for (const unit of ["s", "m", "pts", "kg"] as const) {
    const resolved = resolveEventByName(text, unit)
    if (resolved.eventKey !== "other") return resolved.eventKey
  }
  const lower = text.toLowerCase()
  return RESULT_EVENTS.find((event) => event.kind !== "other" && event.name.toLowerCase() === lower)?.key ?? null
}
