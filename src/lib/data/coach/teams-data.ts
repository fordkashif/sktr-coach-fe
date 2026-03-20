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
  const [{ data: teamsRows, error: teamsError }, { data: athleteRows, error: athletesError }] = await Promise.all([
    clientResult.client
      .from("teams")
      .select("id, name, event_group")
      .eq("tenant_id", tenantId)
      .eq("is_archived", false),
    clientResult.client
      .from("athletes")
      .select("id, team_id, first_name, last_name, event_group, primary_event, readiness, is_active")
      .eq("tenant_id", tenantId)
      .eq("is_active", true),
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

  return ok({
    teams,
    athletes: athleteList,
  })
}
