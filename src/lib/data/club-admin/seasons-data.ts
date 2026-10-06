import type { SupabaseClient } from "@supabase/supabase-js"
import { loadMockSeasons, saveMockSeasons } from "@/lib/data/club-admin/mock-seasons-store"
import {
  applyRolloverToSeasons,
  seasonBestWindow,
  sortSeasons,
  summarizeRollover,
  validateRolloverDraft,
  validateSeasonDraft,
  type ClubSeason,
  type RolloverPlan,
  type RolloverTeam,
  type SeasonDraft,
  type SeasonStatus,
  type SeasonWindow,
} from "@/lib/data/club-admin/season-logic"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * A club's seasons and the year end rollover.
 *
 * Supabase mode (migration 20261014090000): every member of the club can read club_seasons.
 * Only a club admin changes them, and only through save_club_season, delete_club_season and
 * start_club_season (the rollover, one transaction, nothing deleted).
 * Mock mode keeps the same shapes in the browser, per club.
 */

export type RolloverContext = {
  seasons: ClubSeason[]
  /** Teams that are not archived, with how many athletes are on each. */
  teams: RolloverTeam[]
  /** Published plans in the club. */
  publishedPlans: number
}

export type RolloverOutcome = {
  teamsArchived: number
  athletesUnassigned: number
  plansEnded: number
}

const NOT_READY = "Seasons are not switched on for this workspace yet. Message the SKTR team and they will set it up."
const STORAGE_BLOCKED = "Could not save on this device. Check that storage is not blocked."

function isMock() {
  return getBackendMode() !== "supabase"
}

function client(): SupabaseClient | null {
  return getBrowserSupabaseClient()
}

function isMissing(error: { code?: string }) {
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202"
}

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function newId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `season-${Date.now().toString(36)}`
}

/** Every season of the signed-in member's club, newest first. Empty before the club has one. */
export async function listClubSeasons(): Promise<Result<ClubSeason[]>> {
  if (isMock()) return ok(sortSeasons(loadMockSeasons()))
  const supabase = client()
  if (!supabase) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await supabase.from("club_seasons").select("id, name, start_date, end_date, status").order("start_date", { ascending: false }).limit(200)
  if (error) {
    // The table arrives with migration 20261014090000. Until then there are simply no seasons.
    if (isMissing(error)) return ok([])
    return { ok: false, error: mapPostgrestError(error) }
  }
  const rows = (data as Array<{ id: string; name: string; start_date: string; end_date: string; status: SeasonStatus }> | null) ?? []
  return ok(rows.map((row) => ({ id: row.id, name: row.name, start: row.start_date.slice(0, 10), end: row.end_date.slice(0, 10), status: row.status })))
}

/** Mock mode only: the window season bests are counted in today. The database answers this itself in supabase mode. */
export function mockSeasonBestWindow(todayKey: string): SeasonWindow {
  return seasonBestWindow(loadMockSeasons(), todayKey)
}

/** Adds an upcoming season (no id) or changes the name and dates of an existing one. */
export async function saveClubSeason(seasonId: string | null, draft: SeasonDraft): Promise<Result<{ seasonId: string }>> {
  if (isMock()) {
    const seasons = loadMockSeasons()
    const checked = validateSeasonDraft(draft, seasons, seasonId)
    if (!checked.ok) return err("VALIDATION", Object.values(checked.errors)[0] ?? "Check the season and try again.")
    if (seasonId && !seasons.some((season) => season.id === seasonId)) return err("NOT_FOUND", "This season no longer exists.")
    const id = seasonId ?? newId()
    const next = seasonId
      ? seasons.map((season) => (season.id === seasonId ? { ...season, ...checked.data } : season))
      : [...seasons, { id, ...checked.data, status: "upcoming" as const }]
    try {
      saveMockSeasons(next)
    } catch {
      return err("UNKNOWN", STORAGE_BLOCKED)
    }
    const mockAudit = await import("@/lib/mock-audit")
    mockAudit.logAuditEvent({ actor: "club-admin", action: seasonId ? "season_changed" : "season_added", target: "season", detail: `${checked.data.name}, ${checked.data.start} to ${checked.data.end}` })
    return ok({ seasonId: id })
  }
  const supabase = client()
  if (!supabase) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await supabase.rpc("save_club_season", { p_season_id: seasonId, p_name: draft.name.trim(), p_start_date: draft.start, p_end_date: draft.end })
  if (error) {
    if (isMissing(error)) return err("NOT_FOUND", NOT_READY, error)
    if (error.code === "42501" && /club admin/i.test(error.message)) return err("FORBIDDEN", error.message, error)
    if (error.code === "23P01" || error.code === "P0002") return err(error.code === "P0002" ? "NOT_FOUND" : "VALIDATION", error.message, error)
    return { ok: false, error: mapPostgrestError(error) }
  }
  return ok({ seasonId: String(data) })
}

/** Removes a season that has not started. */
export async function deleteClubSeason(seasonId: string): Promise<Result<null>> {
  if (isMock()) {
    const seasons = loadMockSeasons()
    const season = seasons.find((candidate) => candidate.id === seasonId)
    if (!season) return err("NOT_FOUND", "This season no longer exists.")
    if (season.status !== "upcoming") return err("VALIDATION", "Only a season that has not started can be removed.")
    try {
      saveMockSeasons(seasons.filter((candidate) => candidate.id !== seasonId))
    } catch {
      return err("UNKNOWN", STORAGE_BLOCKED)
    }
    const mockAudit = await import("@/lib/mock-audit")
    mockAudit.logAuditEvent({ actor: "club-admin", action: "season_removed", target: "season", detail: season.name })
    return ok(null)
  }
  const supabase = client()
  if (!supabase) return err("UNKNOWN", "Supabase client is not configured.")
  const { error } = await supabase.rpc("delete_club_season", { p_season_id: seasonId })
  if (error) {
    if (isMissing(error)) return err("NOT_FOUND", NOT_READY, error)
    if (error.code === "42501" && /club admin/i.test(error.message)) return err("FORBIDDEN", error.message, error)
    if (error.code === "P0002") return err("NOT_FOUND", error.message, error)
    return { ok: false, error: mapPostgrestError(error) }
  }
  return ok(null)
}

async function mockPlanAdapter() {
  const { createMockPlanAdapter } = await import("@/components/coach/training-plan/mock-adapter")
  return createMockPlanAdapter({ listTeamId: null, teamIds: null })
}

/** What the rollover steps need: the seasons, the teams that could be archived, and the published plans. */
export async function getRolloverContext(): Promise<Result<RolloverContext>> {
  if (isMock()) {
    const [{ loadClubTeams }, { mockAthletes }, adapter] = await Promise.all([import("@/lib/mock-club-admin"), import("@/lib/mock-data"), mockPlanAdapter()])
    const plans = await adapter.listPlans()
    return ok({
      seasons: sortSeasons(loadMockSeasons()),
      teams: loadClubTeams()
        .filter((team) => team.status !== "archived")
        .map((team) => ({ id: team.id, name: team.name, athleteCount: mockAthletes.filter((athlete) => athlete.teamId === team.id).length })),
      publishedPlans: plans.ok ? plans.data.filter((plan) => plan.status === "published").length : 0,
    })
  }
  const supabase = client()
  if (!supabase) return err("UNKNOWN", "Supabase client is not configured.")
  const [seasons, teams, athletes, plans] = await Promise.all([
    listClubSeasons(),
    supabase.from("teams").select("id, name, status, is_archived").neq("status", "archived").order("name").limit(1000),
    supabase.from("athletes").select("team_id").not("team_id", "is", null).limit(10000),
    supabase.from("training_plans").select("id", { count: "exact", head: true }).eq("status", "published"),
  ])
  if (!seasons.ok) return seasons
  if (teams.error) return { ok: false, error: mapPostgrestError(teams.error) }
  if (athletes.error) return { ok: false, error: mapPostgrestError(athletes.error) }
  if (plans.error) return { ok: false, error: mapPostgrestError(plans.error) }
  const counts = new Map<string, number>()
  for (const row of (athletes.data as Array<{ team_id: string }> | null) ?? []) counts.set(row.team_id, (counts.get(row.team_id) ?? 0) + 1)
  return ok({
    seasons: seasons.data,
    teams: ((teams.data as Array<{ id: string; name: string; is_archived: boolean }> | null) ?? [])
      .filter((team) => !team.is_archived)
      .map((team) => ({ id: team.id, name: team.name, athleteCount: counts.get(team.id) ?? 0 })),
    publishedPlans: plans.count ?? 0,
  })
}

/**
 * The rollover: the current season becomes past, the chosen one current, the chosen teams are
 * archived (their athletes stay in the club with no team) and, if asked, published plans end.
 * All of it or none of it. Nothing is deleted.
 */
export async function startClubSeason(plan: RolloverPlan): Promise<Result<RolloverOutcome>> {
  const archiveTeamIds = Object.entries(plan.teamChoices)
    .filter(([, choice]) => choice === "archive")
    .map(([teamId]) => teamId)

  if (isMock()) {
    const context = await getRolloverContext()
    if (!context.ok) return context
    const season = context.data.seasons.find((candidate) => candidate.id === plan.seasonId)
    if (!season) return err("NOT_FOUND", "This season no longer exists.")
    if (season.status !== "upcoming") return err("VALIDATION", "Only a season that has not started can be started.")
    const checked = validateRolloverDraft(plan.draft, context.data.seasons, plan.seasonId)
    if (!checked.ok) return err("VALIDATION", Object.values(checked.errors)[0] ?? "Check the season and try again.")
    if (archiveTeamIds.some((teamId) => !context.data.teams.some((team) => team.id === teamId))) {
      return err("VALIDATION", "One of the teams to archive is not a team of this club, or is already archived. Reload and try again.")
    }
    const summary = summarizeRollover({ ...plan, draft: checked.data }, context.data.seasons, context.data.teams, context.data.publishedPlans)
    const mockClub = await import("@/lib/mock-club-admin")
    const before = { teams: mockClub.loadClubTeams(), users: mockClub.loadClubUsers(), seasons: loadMockSeasons() }
    try {
      saveMockSeasons(applyRolloverToSeasons(before.seasons, { ...plan, draft: checked.data }))
      mockClub.saveClubTeams(before.teams.map((team) => (archiveTeamIds.includes(team.id) ? { ...team, status: "archived" as const } : team)))
      mockClub.saveClubUsers(before.users.map((user) => (user.role === "athlete" && user.teamId && archiveTeamIds.includes(user.teamId) ? { ...user, teamId: undefined } : user)))
      if (plan.endPlans) {
        const adapter = await mockPlanAdapter()
        const plans = await adapter.listPlans()
        for (const item of plans.ok ? plans.data : []) {
          if (item.status === "published") await adapter.archive(item.id)
        }
      }
    } catch {
      // Put back what was there, so a half done rollover is never left behind.
      try {
        saveMockSeasons(before.seasons)
        mockClub.saveClubTeams(before.teams)
        mockClub.saveClubUsers(before.users)
      } catch {
        // Storage is blocked altogether: nothing was written in the first place.
      }
      return err("UNKNOWN", STORAGE_BLOCKED)
    }
    const mockAudit = await import("@/lib/mock-audit")
    mockAudit.logAuditEvent({
      actor: "club-admin",
      action: "season_started",
      target: "season",
      detail: `${checked.data.name} (${checked.data.start} to ${checked.data.end}) started. Teams archived: ${summary.archivedTeams.length}. Athletes left without a team: ${summary.athletesUnassigned}. Plans ended: ${summary.plansEnded}.`,
    })
    return ok({ teamsArchived: summary.archivedTeams.length, athletesUnassigned: summary.athletesUnassigned, plansEnded: summary.plansEnded })
  }

  const supabase = client()
  if (!supabase) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await supabase.rpc("start_club_season", {
    p_season_id: plan.seasonId,
    p_name: plan.draft.name.trim(),
    p_start_date: plan.draft.start,
    p_end_date: plan.draft.end,
    p_archive_team_ids: archiveTeamIds,
    p_end_plans: plan.endPlans,
  })
  if (error) {
    if (isMissing(error)) return err("NOT_FOUND", NOT_READY, error)
    if (error.code === "42501" && /club admin/i.test(error.message)) return err("FORBIDDEN", error.message, error)
    if (error.code === "23P01") return err("VALIDATION", error.message, error)
    if (error.code === "P0002") return err("NOT_FOUND", error.message, error)
    return { ok: false, error: mapPostgrestError(error) }
  }
  const row = (data ?? {}) as { teams_archived?: number; athletes_unassigned?: number; plans_ended?: number }
  return ok({ teamsArchived: row.teams_archived ?? 0, athletesUnassigned: row.athletes_unassigned ?? 0, plansEnded: row.plans_ended ?? 0 })
}

export { today as seasonsToday }
