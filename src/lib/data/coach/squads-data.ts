import type { SupabaseClient } from "@supabase/supabase-js"
import { createAssignedPlanSessions } from "@/lib/data/coach/roster-data"
import { loadMockRoster, mergeMockAthletes, mockId } from "@/lib/data/coach/roster-mock"
import { isSquadColor, memberChanges, membersOnTeam, validateSquadInput, type Squad, type SquadInput } from "@/lib/data/coach/squads"
import { loadMockSquads, SQUADS_CHANGED_EVENT, updateMockSquads } from "@/lib/data/coach/squads-mock"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { MOCK_ATHLETE_ID } from "@/lib/data/session/session-mock"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * Squads of a team, for both backends.
 *
 * Real mode: tables team_squads and team_squad_members
 * (supabase/migrations/20261014110000_squads.sql). The database decides who may read and write
 * (the team's coaches and club admins; an athlete reads the names of their own squads), refuses a
 * member from another team, and ends memberships when an athlete leaves the team.
 * Mock mode: squads-mock.ts keeps the same behaviour in the browser.
 */

export { SQUADS_CHANGED_EVENT }

const STORAGE_ERROR = "Could not save in this browser. Storage may be full or blocked."

function isMock() {
  return getBackendMode() !== "supabase"
}

function requireClient(operation: string): { ok: true; client: SupabaseClient } | { ok: false; error: DataError } {
  const client = getBrowserSupabaseClient()
  if (!client) return { ok: false, error: { code: "UNKNOWN", message: `[${operation}] Supabase client is not configured.` } }
  return { ok: true, client }
}

/** The database writes its refusals for the coach ("Only athletes on this team can be in its squads."). Keep them. */
function writeError(error: { code?: string; message: string; details?: string; hint?: string }): DataError {
  if (error.code === "23505") return { code: "CONFLICT", message: "This team already has a squad with that name.", cause: error }
  if (error.code === "23514" && !/violates check constraint/i.test(error.message)) return { code: "VALIDATION", message: error.message, cause: error }
  return mapPostgrestError(error as Parameters<typeof mapPostgrestError>[0])
}

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SQUADS_CHANGED_EVENT))
}

type SquadRow = { id: string; team_id: string; name: string; color: string | null; note: string | null }

function byName(left: Squad, right: Squad) {
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
}

async function readSquads(client: SupabaseClient, teamIds: string[] | null): Promise<Result<Squad[]>> {
  if (teamIds !== null && teamIds.length === 0) return ok([])
  const squadQuery = client.from("team_squads").select("id, team_id, name, color, note").is("archived_at", null)
  const memberQuery = client.from("team_squad_members").select("squad_id, athlete_id")
  const [squadResult, memberResult] = await Promise.all([teamIds ? squadQuery.in("team_id", teamIds) : squadQuery, teamIds ? memberQuery.in("team_id", teamIds) : memberQuery])
  if (squadResult.error) return { ok: false, error: mapPostgrestError(squadResult.error) }
  if (memberResult.error) return { ok: false, error: mapPostgrestError(memberResult.error) }
  const members = new Map<string, string[]>()
  for (const row of (memberResult.data as Array<{ squad_id: string; athlete_id: string }> | null) ?? []) {
    const list = members.get(row.squad_id)
    if (list) list.push(row.athlete_id)
    else members.set(row.squad_id, [row.athlete_id])
  }
  return ok(
    ((squadResult.data as SquadRow[] | null) ?? [])
      .map((row): Squad => ({ id: row.id, teamId: row.team_id, name: row.name, color: isSquadColor(row.color) ? row.color : null, note: row.note, athleteIds: members.get(row.id) ?? [] }))
      .sort(byName),
  )
}

/** The live squads of one team with their members, by name. */
export async function listTeamSquads(teamId: string): Promise<Result<Squad[]>> {
  if (isMock()) return ok(loadMockSquads(teamId).sort(byName))
  const clientResult = requireClient("listTeamSquads")
  if (!clientResult.ok) return clientResult
  return readSquads(clientResult.client, [teamId])
}

/** The live squads of several teams (the plan builder and test weeks work across a coach's teams). Null means every team the caller can see. */
export async function listSquadsForTeams(teamIds: string[] | null): Promise<Result<Squad[]>> {
  if (isMock()) return ok(loadMockSquads().filter((squad) => teamIds === null || teamIds.includes(squad.teamId)).sort(byName))
  const clientResult = requireClient("listSquadsForTeams")
  if (!clientResult.ok) return clientResult
  return readSquads(clientResult.client, teamIds)
}

export async function createSquad(teamId: string, input: SquadInput): Promise<Result<Squad>> {
  if (isMock()) {
    const checked = validateSquadInput(input, loadMockSquads(teamId))
    if (!checked.ok) return err("VALIDATION", checked.message)
    const squad: Squad = { id: mockId("sq"), teamId, ...checked.data, athleteIds: [] }
    try {
      updateMockSquads((squads) => [...squads, squad])
    } catch {
      return err("UNKNOWN", STORAGE_ERROR)
    }
    return ok(squad)
  }
  const checked = validateSquadInput(input, [])
  if (!checked.ok) return err("VALIDATION", checked.message)
  const clientResult = requireClient("createSquad")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client
  // The database takes the club from the team; the row policy needs a value to compare first.
  const { data: team, error: teamError } = await client.from("teams").select("tenant_id").eq("id", teamId).maybeSingle()
  if (teamError) return { ok: false, error: mapPostgrestError(teamError) }
  if (!team) return err("NOT_FOUND", "Team not found.")
  const { data, error } = await client
    .from("team_squads")
    .insert({ tenant_id: team.tenant_id as string, team_id: teamId, name: checked.data.name, color: checked.data.color, note: checked.data.note })
    .select("id, team_id, name, color, note")
    .single()
  if (error) return { ok: false, error: writeError(error) }
  const row = data as SquadRow
  announce()
  return ok({ id: row.id, teamId: row.team_id, name: row.name, color: isSquadColor(row.color) ? row.color : null, note: row.note, athleteIds: [] })
}

/** Renames a squad, or changes its colour or note. */
export async function updateSquad(squad: Pick<Squad, "id" | "teamId">, input: SquadInput): Promise<Result<null>> {
  if (isMock()) {
    const checked = validateSquadInput(
      input,
      loadMockSquads(squad.teamId).filter((item) => item.id !== squad.id),
    )
    if (!checked.ok) return err("VALIDATION", checked.message)
    try {
      updateMockSquads((squads) => squads.map((item) => (item.id === squad.id ? { ...item, ...checked.data } : item)))
    } catch {
      return err("UNKNOWN", STORAGE_ERROR)
    }
    return ok(null)
  }
  const checked = validateSquadInput(input, [])
  if (!checked.ok) return err("VALIDATION", checked.message)
  const clientResult = requireClient("updateSquad")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client
    .from("team_squads")
    .update({ name: checked.data.name, color: checked.data.color, note: checked.data.note })
    .eq("id", squad.id)
    .select("id")
  if (error) return { ok: false, error: writeError(error) }
  if (((data as Array<{ id: string }> | null) ?? []).length === 0) return err("NOT_FOUND", "This squad no longer exists, or you do not coach its team.")
  announce()
  return ok(null)
}

/**
 * Archives a squad. Its athletes leave it, so plans and test weeks sent to it stop reaching them
 * (sessions already started or done stay). The name can be used again.
 */
export async function archiveSquad(squadId: string): Promise<Result<null>> {
  if (isMock()) {
    try {
      updateMockSquads((squads) => squads, squadId)
    } catch {
      return err("UNKNOWN", STORAGE_ERROR)
    }
    return ok(null)
  }
  const clientResult = requireClient("archiveSquad")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.from("team_squads").update({ archived_at: new Date().toISOString() }).eq("id", squadId).select("id")
  if (error) return { ok: false, error: writeError(error) }
  if (((data as Array<{ id: string }> | null) ?? []).length === 0) return err("NOT_FOUND", "This squad no longer exists, or you do not coach its team.")
  announce()
  return ok(null)
}

export type SquadMembersOutcome = {
  added: number
  removed: number
  /** Set when the members were saved but the plan sessions of someone added could not be created. */
  warning: string | null
}

/**
 * Sets who is in a squad. Athletes added get the upcoming sessions of every published plan that is
 * sent to the squad, the same way an athlete who joins a team gets the team's plan. Athletes
 * removed stop getting new sessions from those plans: the database removes the upcoming sessions
 * they have not touched and keeps everything started, done or in the past.
 */
export async function setSquadMembers(squad: Pick<Squad, "id" | "teamId" | "athleteIds">, athleteIds: string[]): Promise<Result<SquadMembersOutcome>> {
  if (isMock()) {
    const onTeam = mergeMockAthletes((await import("@/lib/mock-data")).mockAthletes, loadMockRoster())
      .filter((athlete) => athlete.teamId === squad.teamId)
      .map((athlete) => athlete.id)
    if (athleteIds.some((id) => !onTeam.includes(id))) return err("VALIDATION", "Only athletes on this team can be in its squads.")
    const next = membersOnTeam(athleteIds, onTeam)
    const stored = loadMockSquads(squad.teamId).find((item) => item.id === squad.id)
    if (!stored) return err("NOT_FOUND", "This squad no longer exists.")
    const changes = memberChanges(stored.athleteIds, next)
    try {
      updateMockSquads((squads) => squads.map((item) => (item.id === squad.id ? { ...item, athleteIds: next } : item)))
    } catch {
      return err("UNKNOWN", STORAGE_ERROR)
    }
    return ok({ added: changes.added.length, removed: changes.removed.length, warning: null })
  }

  const clientResult = requireClient("setSquadMembers")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client
  const { data: squadRow, error: squadError } = await client.from("team_squads").select("id, tenant_id, team_id").eq("id", squad.id).is("archived_at", null).maybeSingle()
  if (squadError) return { ok: false, error: mapPostgrestError(squadError) }
  if (!squadRow) return err("NOT_FOUND", "This squad no longer exists, or you do not coach its team.")
  const { data: memberRows, error: memberError } = await client.from("team_squad_members").select("athlete_id").eq("squad_id", squad.id)
  if (memberError) return { ok: false, error: mapPostgrestError(memberError) }
  const changes = memberChanges(
    ((memberRows as Array<{ athlete_id: string }> | null) ?? []).map((row) => row.athlete_id),
    [...new Set(athleteIds)],
  )

  if (changes.removed.length > 0) {
    const { error } = await client.from("team_squad_members").delete().eq("squad_id", squad.id).in("athlete_id", changes.removed)
    if (error) return { ok: false, error: writeError(error) }
  }
  if (changes.added.length > 0) {
    const { error } = await client
      .from("team_squad_members")
      .insert(changes.added.map((athleteId) => ({ squad_id: squad.id, athlete_id: athleteId, tenant_id: squadRow.tenant_id as string, team_id: squadRow.team_id as string })))
    if (error) {
      announce()
      return { ok: false, error: writeError(error) }
    }
  }

  // The membership is saved. Sessions are a second step, as when an athlete joins a team: if it
  // fails the athlete's own app still creates each day when they open it, and publishing the plan
  // again creates them all.
  let failed = 0
  for (const athleteId of changes.added) {
    const sessions = await createAssignedPlanSessions(client, athleteId, { squadId: squad.id })
    if (!sessions.ok) failed += 1
  }
  announce()
  return ok({
    added: changes.added.length,
    removed: changes.removed.length,
    warning: failed > 0 ? "The squad is saved, but the plan sessions of the athletes you added could not be created. Publish the squad's plan again to add them." : null,
  })
}

/** The names of the squads the signed-in athlete is in, by name. Empty when they are in none. */
export async function listMySquadNames(): Promise<Result<string[]>> {
  if (isMock()) {
    const roster = mergeMockAthletes((await import("@/lib/mock-data")).mockAthletes, loadMockRoster())
    const me = roster.find((athlete) => athlete.id === MOCK_ATHLETE_ID)
    if (!me) return ok([])
    return ok(
      loadMockSquads(me.teamId)
        .filter((squad) => squad.athleteIds.includes(MOCK_ATHLETE_ID))
        .sort(byName)
        .map((squad) => squad.name),
    )
  }
  const clientResult = requireClient("listMySquadNames")
  if (!clientResult.ok) return clientResult
  // The row policy only returns the squads the athlete is in.
  const { data, error } = await clientResult.client.from("team_squads").select("name").is("archived_at", null).order("name", { ascending: true })
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(((data as Array<{ name: string }> | null) ?? []).map((row) => row.name))
}
