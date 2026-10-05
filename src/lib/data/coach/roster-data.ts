import type { SupabaseClient } from "@supabase/supabase-js"
import { currentAvailability, listAthleteAvailability, type AthleteAvailability } from "@/lib/data/athlete/availability-data"
import { loadMockRoster, mergeMockAthletes, mockAthleteLimit, mockId, updateMockRoster, type MockManagedAthlete } from "@/lib/data/coach/roster-mock"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { adherenceCounts, adherencePercent, type AdherenceSession } from "@/lib/data/session/adherence"
import { planBlueprints } from "@/lib/data/session/session-from-plan"
import { insertSessionsFromBlueprints, slotKey, type SessionSeed } from "@/lib/data/session/session-plan-sync"
import { planFromBuilderState, todayIso } from "@/lib/data/training-plan/plan-builder-model"
import type { Athlete, EventGroup, Team } from "@/lib/mock-data"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * The coach's roster of one team, and everything a coach or club admin does to it:
 * athletes without a login, moving an athlete to another team, taking one off the team.
 *
 * Every write goes through a database function that checks who is asking
 * (supabase/migrations/20261009090000_roster_bulk_join_codes_managed_athletes.sql).
 * Mock mode keeps the same behaviour in the browser (roster-mock.ts).
 */

export const EVENT_GROUPS: EventGroup[] = ["Sprint", "Mid", "Distance", "Jumps", "Throws"]

export type RosterAthlete = Athlete & {
  /** False for an athlete without a login: staff enter everything for them. */
  hasLogin: boolean
  dateOfBirth: string | null
  /** The period they are unavailable now, or the next one coming up. Null when available. */
  availability: AthleteAvailability | null
  /** Day of their last finished session (yyyy-mm-dd), within the last four weeks. */
  lastSessionOn: string | null
}

export type TeamRoster = {
  team: Team
  athletes: RosterAthlete[]
}

export type RosterCapacity = {
  /** Athletes the package allows. Null means no limit. */
  athleteLimit: number | null
  athletesUsed: number
  pendingInvites: number
  /** Null when there is no limit. */
  seatsLeft: number | null
}

export type ManagedAthleteInput = {
  firstName: string
  lastName: string
  dateOfBirth: string | null
  eventGroup: EventGroup | null
  primaryEvent: string | null
  guardianName: string | null
  guardianPhone: string | null
  guardianEmail: string | null
}

export type ManagedAthleteField = "firstName" | "lastName" | "dateOfBirth" | "guardianPhone" | "guardianEmail"

type ClientResolution = { ok: true; client: SupabaseClient } | { ok: false; error: DataError }

function isMock() {
  return getBackendMode() !== "supabase"
}

function requireClient(operation: string): ClientResolution {
  const client = getBrowserSupabaseClient()
  if (!client) return { ok: false, error: { code: "UNKNOWN", message: `[${operation}] Supabase client is not configured.` } }
  return { ok: true, client }
}

function toEventGroup(value: string | null | undefined): EventGroup {
  return EVENT_GROUPS.includes(value as EventGroup) ? (value as EventGroup) : "Sprint"
}

/** Database functions raise with a sentence written for the coach. Keep it; only hide the raw RLS text. */
function functionError(error: { code?: string; message: string; details?: string; hint?: string }): DataError {
  const mapped = mapPostgrestError(error as Parameters<typeof mapPostgrestError>[0])
  if (error.code === "42501" && error.hint !== "access_paused" && !/row-level security|permission denied/i.test(error.message)) {
    return { code: "FORBIDDEN", message: error.message, cause: error }
  }
  return mapped
}

const PHONE_PATTERN = /^\+?[0-9 ().-]{6,24}$/
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Checks the "athlete without a login" form. Returns the cleaned values or one message per field. */
export function validateManagedAthlete(
  input: ManagedAthleteInput,
): { ok: true; data: ManagedAthleteInput } | { ok: false; fieldErrors: Partial<Record<ManagedAthleteField, string>> } {
  const text = (value: string | null) => {
    const trimmed = (value ?? "").replace(/\s+/g, " ").trim()
    return trimmed || null
  }
  const data: ManagedAthleteInput = {
    firstName: text(input.firstName) ?? "",
    lastName: text(input.lastName) ?? "",
    dateOfBirth: input.dateOfBirth || null,
    eventGroup: input.eventGroup,
    primaryEvent: text(input.primaryEvent),
    guardianName: text(input.guardianName),
    guardianPhone: text(input.guardianPhone),
    guardianEmail: text(input.guardianEmail)?.toLowerCase() ?? null,
  }
  const fieldErrors: Partial<Record<ManagedAthleteField, string>> = {}
  if (!data.firstName) fieldErrors.firstName = "Enter their first name."
  if (!data.lastName) fieldErrors.lastName = "Enter their last name."
  if (data.dateOfBirth && (!/^\d{4}-\d{2}-\d{2}$/.test(data.dateOfBirth) || data.dateOfBirth > todayIso() || data.dateOfBirth < "1900-01-01")) {
    fieldErrors.dateOfBirth = "Enter a date of birth in the past."
  }
  if (data.guardianPhone && !PHONE_PATTERN.test(data.guardianPhone)) fieldErrors.guardianPhone = "Use digits, spaces, + or -."
  if (data.guardianEmail && !EMAIL_PATTERN.test(data.guardianEmail)) fieldErrors.guardianEmail = "Enter a valid email address."
  return Object.keys(fieldErrors).length > 0 ? { ok: false, fieldErrors } : { ok: true, data }
}

/* ---------- Reading the roster ------------------------------------------------------------------ */

async function mockTeamRoster(teamId: string): Promise<Result<TeamRoster>> {
  const module = await import("@/lib/mock-data")
  const team = module.mockTeams.find((item) => item.id === teamId)
  if (!team) return err("NOT_FOUND", "Team not found.")
  const today = todayIso()
  const availabilityResult = await listAthleteAvailability(mergeMockAthletes(module.mockAthletes).map((athlete) => athlete.id))
  const periods = availabilityResult.ok ? availabilityResult.data : []
  const athletes = mergeMockAthletes(module.mockAthletes)
    .filter((athlete) => athlete.teamId === teamId)
    .map((athlete): RosterAthlete => {
      const lastLog = module.mockLogs.find((log) => log.athleteId === athlete.id)
      const lastDay = lastLog ? new Date(lastLog.date) : null
      return {
        id: athlete.id,
        name: athlete.name,
        age: athlete.age,
        eventGroup: athlete.eventGroup,
        primaryEvent: athlete.primaryEvent,
        readiness: athlete.readiness,
        adherence: athlete.adherence,
        lastWellness: athlete.lastWellness,
        teamId: athlete.teamId,
        hasLogin: athlete.hasLogin,
        dateOfBirth: athlete.dateOfBirth,
        availability: currentAvailability(
          periods.filter((period) => period.athleteId === athlete.id),
          today,
        ),
        lastSessionOn: lastDay && !Number.isNaN(lastDay.getTime()) ? `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}` : null,
      }
    })
  return ok({ team: { ...team, athleteCount: athletes.length }, athletes })
}

/**
 * One team's roster with what the table shows: readiness, availability, adherence over the last four
 * weeks and the last finished session. The database only answers for a team the caller coaches (or
 * any team of the club for a club admin); anything else comes back as "Team not found".
 */
export async function getTeamRoster(teamId: string): Promise<Result<TeamRoster>> {
  if (isMock()) return mockTeamRoster(teamId)
  const clientResult = requireClient("getTeamRoster")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client

  const [teamResult, athleteResult] = await Promise.all([
    client.from("teams").select("id, name, event_group").eq("id", teamId).eq("status", "active").eq("is_archived", false).maybeSingle(),
    client
      .from("athletes")
      .select("id, team_id, user_id, first_name, last_name, date_of_birth, event_group, primary_event, readiness")
      .eq("team_id", teamId)
      .eq("is_active", true)
      .order("first_name", { ascending: true }),
  ])
  if (teamResult.error) return { ok: false, error: mapPostgrestError(teamResult.error) }
  if (!teamResult.data) return err("NOT_FOUND", "Team not found.")
  if (athleteResult.error) return { ok: false, error: mapPostgrestError(athleteResult.error) }

  const rows =
    (athleteResult.data as Array<{
      id: string
      team_id: string
      user_id: string | null
      first_name: string
      last_name: string
      date_of_birth: string | null
      event_group: string | null
      primary_event: string | null
      readiness: "green" | "yellow" | "red" | null
    }> | null) ?? []
  const team: Team = {
    id: teamResult.data.id as string,
    name: teamResult.data.name as string,
    eventGroup: toEventGroup(teamResult.data.event_group as string | null),
    athleteCount: rows.length,
  }
  if (rows.length === 0) return ok({ team, athletes: [] })

  const athleteIds = rows.map((row) => row.id)
  const today = todayIso()
  const since = new Date()
  since.setDate(since.getDate() - 28)
  const sinceIso = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`

  const [wellnessResult, sessionResult, completionResult, availabilityResult] = await Promise.all([
    client
      .from("wellness_entries")
      .select("athlete_id, entry_date, readiness_score")
      .in("athlete_id", athleteIds)
      .gte("entry_date", sinceIso)
      .order("entry_date", { ascending: false }),
    client.from("sessions").select("id, athlete_id, scheduled_for, status, origin").in("athlete_id", athleteIds).gte("scheduled_for", sinceIso).lte("scheduled_for", today),
    client
      .from("session_completions")
      .select("session_id, athlete_id, completion_date")
      .in("athlete_id", athleteIds)
      .gte("completion_date", sinceIso)
      .order("completion_date", { ascending: false }),
    listAthleteAvailability(athleteIds, { from: sinceIso }),
  ])
  if (wellnessResult.error) return { ok: false, error: mapPostgrestError(wellnessResult.error) }
  if (sessionResult.error) return { ok: false, error: mapPostgrestError(sessionResult.error) }
  if (completionResult.error) return { ok: false, error: mapPostgrestError(completionResult.error) }
  // Without the periods the figures are still right, only less forgiving, and nobody shows as unavailable.
  const periods = availabilityResult.ok ? availabilityResult.data : []

  const latestWellness = new Map<string, { date: string; score: number }>()
  for (const row of (wellnessResult.data as Array<{ athlete_id: string; entry_date: string; readiness_score: number }> | null) ?? []) {
    if (!latestWellness.has(row.athlete_id)) latestWellness.set(row.athlete_id, { date: row.entry_date, score: row.readiness_score })
  }
  const completions = (completionResult.data as Array<{ session_id: string; athlete_id: string; completion_date: string }> | null) ?? []
  const lastSession = new Map<string, string>()
  for (const row of completions) if (!lastSession.has(row.athlete_id)) lastSession.set(row.athlete_id, row.completion_date)
  const counts = adherenceCounts(
    ((sessionResult.data as Array<{ id: string; athlete_id: string; scheduled_for: string; status: string; origin: string | null }> | null) ?? []).map(
      (row): AdherenceSession => ({ id: row.id, athleteId: row.athlete_id, scheduledFor: row.scheduled_for, status: row.status, origin: row.origin }),
    ),
    new Set(completions.map((row) => row.session_id)),
    periods,
    { from: sinceIso, to: today },
  )

  const athletes = rows.map((row): RosterAthlete => {
    const wellness = latestWellness.get(row.id)
    return {
      id: row.id,
      name: `${row.first_name} ${row.last_name}`.trim(),
      age: 0,
      eventGroup: toEventGroup(row.event_group),
      primaryEvent: row.primary_event ?? "No event yet",
      readiness: wellness ? (wellness.score >= 75 ? "green" : wellness.score >= 55 ? "yellow" : "red") : (row.readiness ?? "yellow"),
      adherence: adherencePercent(counts.get(row.id)),
      lastWellness: wellness ? wellness.date : "-",
      teamId: row.team_id,
      hasLogin: row.user_id !== null,
      dateOfBirth: row.date_of_birth,
      availability: currentAvailability(
        periods.filter((period) => period.athleteId === row.id),
        today,
      ),
      lastSessionOn: lastSession.get(row.id) ?? null,
    }
  })
  return ok({ team, athletes })
}

/** Athlete seats of the club: the package limit, how many are taken and how many invites are waiting. */
export async function getRosterCapacity(): Promise<Result<RosterCapacity>> {
  if (isMock()) {
    const module = await import("@/lib/mock-data")
    const state = loadMockRoster()
    const used = mergeMockAthletes(module.mockAthletes, state).length
    const pending = state.invites.filter((invite) => invite.status === "pending" && !invite.athleteId).length
    const limit = mockAthleteLimit()
    return ok({ athleteLimit: limit, athletesUsed: used, pendingInvites: pending, seatsLeft: Math.max(limit - used - pending, 0) })
  }
  const clientResult = requireClient("getRosterCapacity")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("get_roster_capacity")
  if (error) return { ok: false, error: functionError(error) }
  const row = ((data as Array<{ athlete_limit: number | null; athletes_used: number; pending_invites: number; seats_left: number | null }> | null) ?? [])[0]
  if (!row) return err("FORBIDDEN", "Only coaches and club admins can see the club's athlete seats.")
  return ok({ athleteLimit: row.athlete_limit, athletesUsed: row.athletes_used, pendingInvites: row.pending_invites, seatsLeft: row.seats_left })
}

/* ---------- Athletes without a login ------------------------------------------------------------ */

/** Adds an athlete who has no login to a team. The coach enters results, availability and sessions for them. */
export async function createManagedAthlete(teamId: string, input: ManagedAthleteInput): Promise<Result<{ athleteId: string }>> {
  const checked = validateManagedAthlete(input)
  if (!checked.ok) return err("VALIDATION", Object.values(checked.fieldErrors)[0] ?? "Check the form.")
  const data = checked.data

  if (isMock()) {
    const capacity = await getRosterCapacity()
    if (capacity.ok && capacity.data.athleteLimit !== null && capacity.data.athletesUsed >= capacity.data.athleteLimit) {
      return err("VALIDATION", `Your club has reached the athlete limit of its package (${capacity.data.athleteLimit}). Ask a club admin to upgrade before adding more athletes.`)
    }
    const athlete: MockManagedAthlete = { id: mockId("m"), ...data, teamId, hasLogin: false, active: true }
    try {
      updateMockRoster((state) => ({ ...state, added: [...state.added, athlete] }))
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    return ok({ athleteId: athlete.id })
  }

  const clientResult = requireClient("createManagedAthlete")
  if (!clientResult.ok) return clientResult
  const { data: athleteId, error } = await clientResult.client.rpc("create_managed_athlete", {
    p_team_id: teamId,
    p_first_name: data.firstName,
    p_last_name: data.lastName,
    p_date_of_birth: data.dateOfBirth,
    p_event_group: data.eventGroup,
    p_primary_event: data.primaryEvent,
    p_guardian_name: data.guardianName,
    p_guardian_phone: data.guardianPhone,
    p_guardian_email: data.guardianEmail,
  })
  if (error) return { ok: false, error: functionError(error) }
  return ok({ athleteId: athleteId as string })
}

/** Changes the details of an athlete without a login. Refused once they have their own login. */
export async function updateManagedAthlete(athleteId: string, input: ManagedAthleteInput): Promise<Result<null>> {
  const checked = validateManagedAthlete(input)
  if (!checked.ok) return err("VALIDATION", Object.values(checked.fieldErrors)[0] ?? "Check the form.")
  const data = checked.data

  if (isMock()) {
    try {
      updateMockRoster((state) => ({ ...state, added: state.added.map((athlete) => (athlete.id === athleteId ? { ...athlete, ...data } : athlete)) }))
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    return ok(null)
  }

  const clientResult = requireClient("updateManagedAthlete")
  if (!clientResult.ok) return clientResult
  const { error } = await clientResult.client.rpc("update_managed_athlete", {
    p_athlete_id: athleteId,
    p_first_name: data.firstName,
    p_last_name: data.lastName,
    p_date_of_birth: data.dateOfBirth,
    p_event_group: data.eventGroup,
    p_primary_event: data.primaryEvent,
    p_guardian_name: data.guardianName,
    p_guardian_phone: data.guardianPhone,
    p_guardian_email: data.guardianEmail,
  })
  if (error) return { ok: false, error: functionError(error) }
  return ok(null)
}

/** Removes an athlete without a login from the club. Their sessions and results are kept, the seat is freed. */
export async function removeManagedAthlete(athleteId: string): Promise<Result<null>> {
  if (isMock()) {
    try {
      updateMockRoster((state) => ({
        ...state,
        added: state.added.map((athlete) => (athlete.id === athleteId ? { ...athlete, active: false, teamId: null } : athlete)),
        invites: state.invites.map((invite) => (invite.athleteId === athleteId && invite.status === "pending" ? { ...invite, status: "revoked" } : invite)),
      }))
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    return ok(null)
  }
  const clientResult = requireClient("removeManagedAthlete")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("remove_managed_athlete", { p_athlete_id: athleteId })
  if (error) return { ok: false, error: functionError(error) }
  if (data !== true) return err("NOT_FOUND", "This athlete is no longer on your roster.")
  return ok(null)
}

/** Details of an athlete without a login, for the edit form. Null when the athlete is not one. */
export async function getManagedAthlete(athleteId: string): Promise<Result<(ManagedAthleteInput & { teamId: string | null }) | null>> {
  if (isMock()) {
    const athlete = loadMockRoster().added.find((item) => item.id === athleteId && !item.hasLogin)
    if (!athlete) return ok(null)
    return ok({
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      dateOfBirth: athlete.dateOfBirth,
      eventGroup: athlete.eventGroup,
      primaryEvent: athlete.primaryEvent,
      guardianName: athlete.guardianName,
      guardianPhone: athlete.guardianPhone,
      guardianEmail: athlete.guardianEmail,
      teamId: athlete.teamId,
    })
  }
  const clientResult = requireClient("getManagedAthlete")
  if (!clientResult.ok) return clientResult
  const [athleteResult, detailsResult] = await Promise.all([
    clientResult.client.from("athletes").select("id, team_id, user_id, first_name, last_name, date_of_birth, event_group, primary_event").eq("id", athleteId).maybeSingle(),
    clientResult.client.from("athlete_private_details").select("guardian_name, guardian_phone, guardian_email").eq("athlete_id", athleteId).maybeSingle(),
  ])
  if (athleteResult.error) return { ok: false, error: mapPostgrestError(athleteResult.error) }
  const row = athleteResult.data
  if (!row || row.user_id !== null) return ok(null)
  const details = detailsResult.error ? null : detailsResult.data
  return ok({
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    dateOfBirth: (row.date_of_birth as string | null) ?? null,
    eventGroup: EVENT_GROUPS.includes(row.event_group as EventGroup) ? (row.event_group as EventGroup) : null,
    primaryEvent: (row.primary_event as string | null) ?? null,
    guardianName: (details?.guardian_name as string | null | undefined) ?? null,
    guardianPhone: (details?.guardian_phone as string | null | undefined) ?? null,
    guardianEmail: (details?.guardian_email as string | null | undefined) ?? null,
    teamId: (row.team_id as string | null) ?? null,
  })
}

/* ---------- Moving and removing ------------------------------------------------------------------ */

/**
 * Sessions of the new team's published plans, from today on, for an athlete who just joined it.
 * The same blueprints the plan builder writes when a plan is published. A day that already has a
 * session for the athlete is left alone, so running this twice changes nothing.
 */
async function createTeamPlanSessions(client: SupabaseClient, athleteId: string, teamId: string): Promise<Result<{ created: number }>> {
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id ?? null
  const today = todayIso()

  const { data: assignments, error: assignmentError } = await client
    .from("training_plan_assignments")
    .select("plan_id, visibility_start, visibility_date")
    .eq("scope", "team")
    .eq("team_id", teamId)
  if (assignmentError) return { ok: false, error: mapPostgrestError(assignmentError) }
  const visibleFrom = new Map<string, string>()
  for (const row of (assignments as Array<{ plan_id: string; visibility_start: string; visibility_date: string | null }> | null) ?? []) {
    const from = row.visibility_start === "scheduled" && row.visibility_date && row.visibility_date > today ? row.visibility_date : today
    const known = visibleFrom.get(row.plan_id)
    if (!known || from < known) visibleFrom.set(row.plan_id, from)
  }
  if (visibleFrom.size === 0) return ok({ created: 0 })

  const { data: plans, error: planError } = await client
    .from("training_plans")
    .select("id, tenant_id, name, team_id, start_date, weeks, notes, builder_state")
    .in("id", [...visibleFrom.keys()])
    .eq("status", "published")
  if (planError) return { ok: false, error: mapPostgrestError(planError) }
  const planRows =
    (plans as Array<{ id: string; tenant_id: string; name: string; team_id: string | null; start_date: string; weeks: number; notes: string | null; builder_state: unknown }> | null) ?? []
  if (planRows.length === 0) return ok({ created: 0 })

  const { data: existing, error: existingError } = await client
    .from("sessions")
    .select("plan_id, plan_week_number, plan_day_index")
    .eq("athlete_id", athleteId)
    .in(
      "plan_id",
      planRows.map((plan) => plan.id),
    )
  if (existingError) return { ok: false, error: mapPostgrestError(existingError) }
  const taken = new Set(
    ((existing as Array<{ plan_id: string; plan_week_number: number | null; plan_day_index: number | null }> | null) ?? []).map(
      (row) => `${row.plan_id}:${slotKey(athleteId, row.plan_week_number, row.plan_day_index)}`,
    ),
  )

  const seeds: SessionSeed[] = planRows.flatMap((plan) => {
    const draft = planFromBuilderState(
      { id: plan.id, status: "published", name: plan.name, teamId: plan.team_id ?? "", startDate: plan.start_date, weeks: plan.weeks, notes: plan.notes ?? "" },
      plan.builder_state,
    )
    const from = visibleFrom.get(plan.id) ?? today
    return planBlueprints(draft)
      .filter((blueprint) => blueprint.date >= from)
      .filter((blueprint) => !taken.has(`${plan.id}:${slotKey(athleteId, blueprint.week, blueprint.dayIndex)}`))
      .map((blueprint) => ({ tenantId: plan.tenant_id, athleteId, planId: plan.id, createdByUserId: userId, blueprint }))
  })
  if (seeds.length === 0) return ok({ created: 0 })
  return insertSessionsFromBlueprints(client, seeds)
}

export type MoveAthleteOutcome = {
  fromTeamId: string | null
  toTeamId: string
  /** Untouched upcoming sessions of the old team's plan that were removed. */
  removedSessions: number
  /** Sessions of the new team's published plan that were created. */
  createdSessions: number
  /** Set when the move worked but the new plan's sessions could not be created. */
  warning: string | null
}

/**
 * Moves an athlete to another team. A club admin can move any athlete of the club; a coach only
 * between two teams they coach. History stays with the athlete. Upcoming sessions the athlete has
 * not touched are swapped from the old team's plan to the new team's.
 */
export async function moveAthleteToTeam(athleteId: string, toTeamId: string): Promise<Result<MoveAthleteOutcome>> {
  if (isMock()) {
    const module = await import("@/lib/mock-data")
    const state = loadMockRoster()
    const athlete = mergeMockAthletes(module.mockAthletes, state).find((item) => item.id === athleteId)
    if (!athlete) return err("NOT_FOUND", "Athlete not found.")
    if (athlete.teamId === toTeamId) return err("VALIDATION", "The athlete is already on that team.")
    if (!module.mockTeams.some((team) => team.id === toTeamId)) return err("NOT_FOUND", "Team not found.")
    try {
      updateMockRoster((current) =>
        athlete.managed
          ? { ...current, added: current.added.map((item) => (item.id === athleteId ? { ...item, teamId: toTeamId } : item)) }
          : { ...current, teamOverride: { ...current.teamOverride, [athleteId]: toTeamId } },
      )
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    return ok({ fromTeamId: athlete.teamId, toTeamId, removedSessions: 0, createdSessions: 0, warning: null })
  }

  const clientResult = requireClient("moveAthleteToTeam")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("move_athlete_to_team", { p_athlete_id: athleteId, p_to_team_id: toTeamId })
  if (error) return { ok: false, error: functionError(error) }
  const row = ((data as Array<{ from_team_id: string | null; to_team_id: string; removed_sessions: number }> | null) ?? [])[0]
  if (!row) return err("UNKNOWN", "The move did not report back. Reload to see where the athlete is.")

  // The move is done. The new plan's sessions are a second step: if it fails the athlete's own app
  // still creates each day when they open it, and publishing the plan again creates them all.
  const sessions = await createTeamPlanSessions(clientResult.client, athleteId, toTeamId)
  return ok({
    fromTeamId: row.from_team_id,
    toTeamId: row.to_team_id,
    removedSessions: row.removed_sessions,
    createdSessions: sessions.ok ? sessions.data.created : 0,
    warning: sessions.ok ? null : "The athlete moved, but the new team's plan sessions could not be created. Publish that plan again to add them.",
  })
}

/** Takes an athlete off a team. They keep their account and history. */
export async function removeAthleteFromRoster(athleteId: string, teamId: string): Promise<Result<null>> {
  if (isMock()) {
    try {
      updateMockRoster((state) =>
        state.added.some((athlete) => athlete.id === athleteId)
          ? { ...state, added: state.added.map((athlete) => (athlete.id === athleteId ? { ...athlete, teamId: null } : athlete)) }
          : { ...state, teamOverride: { ...state.teamOverride, [athleteId]: null } },
      )
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    return ok(null)
  }
  const clientResult = requireClient("removeAthleteFromRoster")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("remove_athlete_from_team", { p_athlete_id: athleteId, p_team_id: teamId })
  if (error) return { ok: false, error: functionError(error) }
  if (data !== true) return err("NOT_FOUND", "This athlete is no longer on the team.")
  return ok(null)
}

/** Teams an athlete can be moved to by the signed-in person: every other active team they may manage. */
export async function getMoveTargets(currentTeamId: string | null, coachTeamIds: string[] | null): Promise<Result<Array<{ id: string; name: string }>>> {
  if (isMock()) {
    const module = await import("@/lib/mock-data")
    return ok(
      module.mockTeams
        .filter((team) => team.id !== currentTeamId && (coachTeamIds === null || coachTeamIds.includes(team.id)))
        .map((team) => ({ id: team.id, name: team.name })),
    )
  }
  const clientResult = requireClient("getMoveTargets")
  if (!clientResult.ok) return clientResult
  const query = clientResult.client.from("teams").select("id, name").eq("status", "active").eq("is_archived", false).order("name", { ascending: true })
  if (coachTeamIds !== null) {
    if (coachTeamIds.length === 0) return ok([])
    query.in("id", coachTeamIds)
  }
  const { data, error } = await query
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(((data as Array<{ id: string; name: string }> | null) ?? []).filter((team) => team.id !== currentTeamId))
}
