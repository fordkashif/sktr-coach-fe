import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import type { Athlete, EventGroup, Team } from "@/lib/mock-data"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

type ClientResolution =
  | { ok: true; client: SupabaseClient }
  | { ok: false; error: DataError }

type CoachTeamsSnapshot = {
  teams: Team[]
  athletes: Athlete[]
}

const COACH_TEAMS_SNAPSHOT_CACHE_TTL_MS = 30_000

type CoachTeamsSnapshotCacheEntry = {
  data: CoachTeamsSnapshot
  cachedAt: number
}

let coachTeamsSnapshotCache: CoachTeamsSnapshotCacheEntry | null = null
let coachTeamsSnapshotInflight: Promise<Result<CoachTeamsSnapshot>> | null = null

function requireSupabaseClient(operation: string): ClientResolution {
  if (getBackendMode() !== "supabase") {
    return {
      ok: false,
      error: { code: "UNKNOWN", message: `[${operation}] backend mode is not 'supabase'.` },
    }
  }

  const client = getBrowserSupabaseClient()
  if (!client) {
    return {
      ok: false,
      error: { code: "UNKNOWN", message: `[${operation}] Supabase client is not configured.` },
    }
  }

  return { ok: true, client }
}

function toEventGroup(value: string | null | undefined): EventGroup {
  if (value === "Sprint" || value === "Mid" || value === "Distance" || value === "Jumps" || value === "Throws") return value
  return "Sprint"
}

export async function getCoachTeamsSnapshotForCurrentUser(): Promise<Result<CoachTeamsSnapshot>> {
  if (coachTeamsSnapshotCache && Date.now() - coachTeamsSnapshotCache.cachedAt <= COACH_TEAMS_SNAPSHOT_CACHE_TTL_MS) {
    return ok(coachTeamsSnapshotCache.data)
  }

  if (coachTeamsSnapshotInflight) return coachTeamsSnapshotInflight

  const requestPromise = (async (): Promise<Result<CoachTeamsSnapshot>> => {
  const clientResult = requireSupabaseClient("getCoachTeamsSnapshotForCurrentUser")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: profile, error: profileError } = await clientResult.client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()

  if (profileError) return { ok: false, error: mapPostgrestError(profileError) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "coach" && profile.role !== "club-admin") {
    return err("FORBIDDEN", "Only coach or club-admin users can access teams.")
  }

  const tenantId = profile.tenant_id as string
  let scopedTeamIds: string[] | null = null

  if (profile.role === "coach") {
    const membershipResult = await clientResult.client
      .from("team_coaches")
      .select("team_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)

    if (membershipResult.error) return { ok: false, error: mapPostgrestError(membershipResult.error) }
    scopedTeamIds = ((membershipResult.data as Array<{ team_id: string }> | null) ?? []).map((row) => row.team_id)
    if (scopedTeamIds.length === 0) {
      const emptySnapshot = { teams: [], athletes: [] }
      coachTeamsSnapshotCache = { data: emptySnapshot, cachedAt: Date.now() }
      return ok(emptySnapshot)
    }
  }

  const teamsQuery = clientResult.client
    .from("teams")
    .select("id, name, event_group")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .eq("is_archived", false)

  const athletesQuery = clientResult.client
    .from("athletes")
    .select("id, team_id, first_name, last_name, event_group, primary_event, readiness, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)

  if (scopedTeamIds) {
    teamsQuery.in("id", scopedTeamIds)
    athletesQuery.in("team_id", scopedTeamIds)
  }

  const [{ data: teamsRows, error: teamsError }, { data: athleteRows, error: athletesError }] = await Promise.all([
    teamsQuery,
    athletesQuery,
  ])

  if (teamsError) return { ok: false, error: mapPostgrestError(teamsError) }
  if (athletesError) return { ok: false, error: mapPostgrestError(athletesError) }

  const athleteList = ((athleteRows as Array<{
    id: string
    team_id: string | null
    first_name: string
    last_name: string
    event_group: string | null
    primary_event: string | null
    readiness: "green" | "yellow" | "red" | null
  }> | null) ?? [])
    .filter((row) => Boolean(row.team_id))
    .map((row) => ({
      id: row.id,
      name: `${row.first_name} ${row.last_name}`.trim(),
      age: 0,
      eventGroup: toEventGroup(row.event_group),
      primaryEvent: row.primary_event ?? "Unassigned",
      readiness: row.readiness ?? "yellow",
      adherence: 100,
      lastWellness: "-",
      teamId: row.team_id as string,
    }))

  const countByTeam = athleteList.reduce<Record<string, number>>((acc, athlete) => {
    acc[athlete.teamId] = (acc[athlete.teamId] ?? 0) + 1
    return acc
  }, {})

  const teams = ((teamsRows as Array<{ id: string; name: string; event_group: string | null }> | null) ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    eventGroup: toEventGroup(row.event_group),
    athleteCount: countByTeam[row.id] ?? 0,
    disciplines: undefined,
  }))

  const snapshot = {
    teams,
    athletes: athleteList,
  }
  coachTeamsSnapshotCache = { data: snapshot, cachedAt: Date.now() }
  return ok(snapshot)
  })()

  coachTeamsSnapshotInflight = requestPromise
  try {
    return await requestPromise
  } finally {
    coachTeamsSnapshotInflight = null
  }
}

/**
 * Takes an athlete off a team roster. The athlete account and history are kept.
 * Allowed for a club admin, and for a coach assigned to that team.
 */
export async function removeAthleteFromTeamForCurrentCoach(params: {
  athleteId: string
  teamId: string
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("removeAthleteFromTeamForCurrentCoach")
  if (!clientResult.ok) return clientResult

  // The database does this in one checked step. A coach cannot write "no team" on an athlete directly,
  // because athletes without a team belong to club admins.
  const { data: removed, error: rpcError } = await clientResult.client.rpc("remove_athlete_from_team", {
    p_athlete_id: params.athleteId,
    p_team_id: params.teamId,
  })

  if (!rpcError) {
    if (removed !== true) return err("NOT_FOUND", "This athlete is no longer on the team.")
    coachTeamsSnapshotCache = null
    return ok(undefined)
  }

  // Database without the function yet (the migration has not run): fall back to the direct update.
  const functionMissing = rpcError.code === "PGRST202" || rpcError.code === "42883"
  if (!functionMissing) return { ok: false, error: mapPostgrestError(rpcError) }

  const { data, error } = await clientResult.client
    .from("athletes")
    .update({ team_id: null })
    .eq("id", params.athleteId)
    .eq("team_id", params.teamId)
    .select("id")

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) return err("NOT_FOUND", "This athlete is no longer on the team.")

  coachTeamsSnapshotCache = null
  return ok(undefined)
}

export type CoachAssignedTeam = {
  id: string
  name: string
  eventGroup: EventGroup
}

/**
 * The teams the signed-in coach is assigned to (team_coaches joined to teams), by name.
 * Only active, non-archived teams are returned, because those are the teams every coach screen can open.
 * A club admin or any other role gets an empty list: the team switcher is for coaches only.
 */
export async function getAssignedCoachTeamsForCurrentUser(): Promise<Result<CoachAssignedTeam[]>> {
  const clientResult = requireSupabaseClient("getAssignedCoachTeamsForCurrentUser")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: profile, error: profileError } = await clientResult.client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()

  if (profileError) return { ok: false, error: mapPostgrestError(profileError) }
  if (!profile || profile.role !== "coach") return ok([])

  const tenantId = profile.tenant_id as string
  const membershipResult = await clientResult.client
    .from("team_coaches")
    .select("team_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)

  if (membershipResult.error) return { ok: false, error: mapPostgrestError(membershipResult.error) }
  const teamIds = ((membershipResult.data as Array<{ team_id: string }> | null) ?? []).map((row) => row.team_id).filter(Boolean)
  if (teamIds.length === 0) return ok([])

  const { data: teamRows, error: teamsError } = await clientResult.client
    .from("teams")
    .select("id, name, event_group")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .eq("is_archived", false)
    .in("id", teamIds)
    .order("name", { ascending: true })

  if (teamsError) return { ok: false, error: mapPostgrestError(teamsError) }

  return ok(
    ((teamRows as Array<{ id: string; name: string; event_group: string | null }> | null) ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      eventGroup: toEventGroup(row.event_group),
    })),
  )
}
