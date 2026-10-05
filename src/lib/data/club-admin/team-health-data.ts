import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * Club-wide team health for the club admin dashboard.
 * Every figure is derived from real rows. Where there is nothing to derive from
 * (no check-ins, no scheduled sessions) the value is null so the UI can say so
 * instead of showing a made-up number.
 */

export const TEAM_HEALTH_WINDOW_DAYS = 28

export type ClubAdminTeamHealthRow = {
  id: string
  name: string
  eventGroup: string | null
  status: "draft" | "active" | "archived"
  leadCoachName: string | null
  hasLeadCoach: boolean
  coachCount: number
  athleteCount: number
  ready: number
  watch: number
  review: number
  /** Athletes with no check-in in the window and no stored readiness. */
  noCheckIn: number
  /** Percentage of scheduled sessions completed in the window, or null when none were scheduled. */
  adherence: number | null
  scheduledSessions: number
}

export type ClubAdminTeamHealthSnapshot = {
  teams: ClubAdminTeamHealthRow[]
  athleteCount: number
  unassignedAthleteCount: number
  windowDays: number
}

type Readiness = "green" | "yellow" | "red"

export async function getClubAdminTeamHealthSnapshot(): Promise<Result<ClubAdminTeamHealthSnapshot>> {
  if (getBackendMode() !== "supabase") {
    return err("UNKNOWN", "[getClubAdminTeamHealthSnapshot] backend mode is not 'supabase'.")
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "[getClubAdminTeamHealthSnapshot] Supabase client is not configured.")

  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()
  if (profileError) return { ok: false, error: mapPostgrestError(profileError) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "club-admin") return err("FORBIDDEN", "Only club-admin users can perform this operation.")
  const tenantId = profile.tenant_id as string

  const since = new Date()
  since.setDate(since.getDate() - TEAM_HEALTH_WINDOW_DAYS)
  const sinceIso = since.toISOString().slice(0, 10)
  const todayIso = new Date().toISOString().slice(0, 10)

  const [teamsResult, coachesResult, athletesResult, wellnessResult, sessionsResult, completionsResult] = await Promise.all([
    client.from("teams").select("id, name, event_group, status, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: true }),
    client.from("team_coaches").select("team_id, user_id, is_primary, created_at").eq("tenant_id", tenantId),
    client.from("athletes").select("id, team_id, readiness, is_active").eq("tenant_id", tenantId),
    client
      .from("wellness_entries")
      .select("athlete_id, entry_date, readiness_score")
      .eq("tenant_id", tenantId)
      .gte("entry_date", sinceIso)
      .order("entry_date", { ascending: true }),
    client
      .from("sessions")
      .select("id, athlete_id")
      .eq("tenant_id", tenantId)
      .gte("scheduled_for", sinceIso)
      .lte("scheduled_for", todayIso),
    client.from("session_completions").select("session_id, athlete_id").eq("tenant_id", tenantId).gte("completion_date", sinceIso),
  ])

  if (teamsResult.error) return { ok: false, error: mapPostgrestError(teamsResult.error) }
  if (coachesResult.error) return { ok: false, error: mapPostgrestError(coachesResult.error) }
  if (athletesResult.error) return { ok: false, error: mapPostgrestError(athletesResult.error) }
  if (wellnessResult.error) return { ok: false, error: mapPostgrestError(wellnessResult.error) }
  if (sessionsResult.error) return { ok: false, error: mapPostgrestError(sessionsResult.error) }
  if (completionsResult.error) return { ok: false, error: mapPostgrestError(completionsResult.error) }

  const coachRows =
    (coachesResult.data as Array<{ team_id: string; user_id: string; is_primary: boolean; created_at: string }> | null) ?? []
  const leadByTeam = new Map<string, { userId: string; createdAt: string }>()
  const coachCountByTeam = new Map<string, number>()
  for (const row of coachRows) {
    coachCountByTeam.set(row.team_id, (coachCountByTeam.get(row.team_id) ?? 0) + 1)
    if (!row.is_primary) continue
    const existing = leadByTeam.get(row.team_id)
    if (!existing || row.created_at < existing.createdAt) {
      leadByTeam.set(row.team_id, { userId: row.user_id, createdAt: row.created_at })
    }
  }

  const leadUserIds = Array.from(new Set(Array.from(leadByTeam.values()).map((row) => row.userId)))
  const leadNames = new Map<string, string | null>()
  if (leadUserIds.length > 0) {
    const namesResult = await client.from("profiles").select("user_id, display_name").eq("tenant_id", tenantId).in("user_id", leadUserIds)
    if (namesResult.error) return { ok: false, error: mapPostgrestError(namesResult.error) }
    for (const row of (namesResult.data as Array<{ user_id: string; display_name: string | null }> | null) ?? []) {
      leadNames.set(row.user_id, row.display_name)
    }
  }

  const athletes = (
    (athletesResult.data as Array<{ id: string; team_id: string | null; readiness: Readiness | null; is_active: boolean }> | null) ?? []
  ).filter((row) => row.is_active)

  // Rows arrive oldest first, so the last write per athlete is their latest check-in.
  const latestScore = new Map<string, number>()
  for (const row of (wellnessResult.data as Array<{ athlete_id: string; readiness_score: number }> | null) ?? []) {
    latestScore.set(row.athlete_id, row.readiness_score)
  }

  const sessionsByAthlete = new Map<string, Set<string>>()
  for (const row of (sessionsResult.data as Array<{ id: string; athlete_id: string }> | null) ?? []) {
    const current = sessionsByAthlete.get(row.athlete_id) ?? new Set<string>()
    current.add(row.id)
    sessionsByAthlete.set(row.athlete_id, current)
  }
  const completedByAthlete = new Map<string, number>()
  for (const row of (completionsResult.data as Array<{ session_id: string; athlete_id: string }> | null) ?? []) {
    if (!sessionsByAthlete.get(row.athlete_id)?.has(row.session_id)) continue
    completedByAthlete.set(row.athlete_id, (completedByAthlete.get(row.athlete_id) ?? 0) + 1)
  }

  const teamRows =
    (teamsResult.data as Array<{ id: string; name: string; event_group: string | null; status: ClubAdminTeamHealthRow["status"] }> | null) ?? []

  const teams: ClubAdminTeamHealthRow[] = teamRows
    .filter((team) => team.status !== "archived")
    .map((team) => {
      const roster = athletes.filter((athlete) => athlete.team_id === team.id)
      let ready = 0
      let watch = 0
      let review = 0
      let noCheckIn = 0
      let scheduled = 0
      let completed = 0
      for (const athlete of roster) {
        const score = latestScore.get(athlete.id)
        const readiness: Readiness | null =
          score !== undefined ? (score >= 75 ? "green" : score >= 55 ? "yellow" : "red") : athlete.readiness
        if (readiness === "green") ready += 1
        else if (readiness === "yellow") watch += 1
        else if (readiness === "red") review += 1
        else noCheckIn += 1
        scheduled += sessionsByAthlete.get(athlete.id)?.size ?? 0
        completed += completedByAthlete.get(athlete.id) ?? 0
      }
      const lead = leadByTeam.get(team.id)
      return {
        id: team.id,
        name: team.name,
        eventGroup: team.event_group,
        status: team.status,
        leadCoachName: lead ? (leadNames.get(lead.userId) ?? null) : null,
        hasLeadCoach: Boolean(lead),
        coachCount: coachCountByTeam.get(team.id) ?? 0,
        athleteCount: roster.length,
        ready,
        watch,
        review,
        noCheckIn,
        adherence: scheduled > 0 ? Math.min(100, Math.round((completed / scheduled) * 100)) : null,
        scheduledSessions: scheduled,
      }
    })

  const liveTeamIds = new Set(teams.map((team) => team.id))
  return ok({
    teams,
    athleteCount: athletes.length,
    unassignedAthleteCount: athletes.filter((athlete) => !athlete.team_id || !liveTeamIds.has(athlete.team_id)).length,
    windowDays: TEAM_HEALTH_WINDOW_DAYS,
  })
}
