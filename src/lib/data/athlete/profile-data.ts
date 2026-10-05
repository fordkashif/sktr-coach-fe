import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

type ClientResolution =
  | { ok: true; client: SupabaseClient }
  | { ok: false; error: DataError }

export type CurrentAthleteProfileSnapshot = {
  athleteId: string
  name: string
  firstName: string
  lastName: string
  email: string
  dateOfBirth: string | null
  age: number | null
  primaryEvent: string | null
  eventGroup: string | null
  readiness: "green" | "yellow" | "red" | null
  teamId: string | null
  teamName: string | null
  teamEventGroup: string | null
  /** Comma separated coach names for the athlete's team. Null when unknown. */
  coachNames: string | null
  organizationName: string | null
  adherencePercent: number | null
  lastWellnessDate: string | null
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

export async function getCurrentAthleteProfileSnapshot(): Promise<Result<CurrentAthleteProfileSnapshot>> {
  const clientResult = requireSupabaseClient("getCurrentAthleteProfileSnapshot")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const session = authSession.session
  const userId = session?.user.id
  const userEmail = session?.user.email
  if (!userId || !userEmail) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data, error } = await clientResult.client
    .from("athletes")
    .select("id, team_id, first_name, last_name, date_of_birth, primary_event, event_group, readiness, teams(name, event_group)")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return err("NOT_FOUND", "Athlete profile record not found for current user.")

  const athleteId = data.id as string
  const teamRow = Array.isArray(data.teams) ? data.teams[0] : data.teams
  const [adherenceResult, wellnessResult, teamContext] = await Promise.all([
    getAthleteAdherencePercent(clientResult.client, athleteId),
    getAthleteLatestWellnessDate(clientResult.client, athleteId),
    getTeamContext(clientResult.client),
  ])
  if (!adherenceResult.ok) return adherenceResult
  if (!wellnessResult.ok) return wellnessResult

  return ok({
    athleteId,
    name: `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || "Athlete",
    firstName: data.first_name ?? "",
    lastName: data.last_name ?? "",
    email: userEmail,
    dateOfBirth: (data.date_of_birth as string | null) ?? null,
    age: calculateAgeFromDateOfBirth(data.date_of_birth as string | null),
    primaryEvent: data.primary_event ?? null,
    eventGroup: data.event_group ?? null,
    readiness: data.readiness ?? null,
    teamId: (data.team_id as string | null) ?? null,
    teamName: teamRow?.name ?? null,
    teamEventGroup: teamRow?.event_group ?? null,
    coachNames: teamContext?.coachNames ?? null,
    organizationName: teamContext?.organizationName ?? null,
    adherencePercent: adherenceResult.data,
    lastWellnessDate: wellnessResult.data,
  })
}

/**
 * Coach names and club name come from a security definer function because athletes cannot read
 * team_coaches or other users' profiles. It is optional context: if the function is missing or
 * fails, the profile still loads and the coach row simply says it is not available.
 */
async function getTeamContext(
  client: SupabaseClient,
): Promise<{ coachNames: string | null; organizationName: string | null } | null> {
  try {
    const { data, error } = await client.rpc("get_current_athlete_team_context")
    if (error) return null
    const row = (Array.isArray(data) ? data[0] : data) as
      | { coach_names?: string | null; organization_name?: string | null }
      | null
      | undefined
    if (!row) return null
    return {
      coachNames: row.coach_names?.trim() || null,
      organizationName: row.organization_name?.trim() || null,
    }
  } catch {
    return null
  }
}

/** The fields an athlete owns. Team, club, role and readiness are never part of this. */
export type AthleteProfileInput = {
  firstName: string
  lastName: string
  /** ISO date (YYYY-MM-DD) or null. */
  dateOfBirth: string | null
  eventGroup: string | null
  primaryEvent: string | null
}

export type AthleteProfileField = keyof AthleteProfileInput

export const ATHLETE_EVENT_GROUP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "Sprint", label: "Sprints" },
  { value: "Mid", label: "Middle distance" },
  { value: "Distance", label: "Distance" },
  { value: "Jumps", label: "Jumps" },
  { value: "Throws", label: "Throws" },
]

const MAX_TEXT_LENGTH = 60

export function eventGroupLabel(value: string | null | undefined) {
  if (!value) return null
  return ATHLETE_EVENT_GROUP_OPTIONS.find((option) => option.value === value)?.label ?? value
}

function todayIsoDate() {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, "0")
  const day = `${now.getDate()}`.padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

/** Trims and checks the editable fields. Returns the cleaned input or one message per failing field. */
export function validateAthleteProfileInput(
  input: AthleteProfileInput,
):
  | { ok: true; data: AthleteProfileInput }
  | { ok: false; fieldErrors: Partial<Record<AthleteProfileField, string>> } {
  const fieldErrors: Partial<Record<AthleteProfileField, string>> = {}
  const firstName = input.firstName.trim().replace(/\s+/g, " ")
  const lastName = input.lastName.trim().replace(/\s+/g, " ")
  const eventGroup = input.eventGroup?.trim() || null
  const primaryEvent = input.primaryEvent?.trim().replace(/\s+/g, " ") || null
  const dateOfBirth = input.dateOfBirth?.trim() || null

  if (!firstName) fieldErrors.firstName = "Enter your first name."
  else if (firstName.length > MAX_TEXT_LENGTH) fieldErrors.firstName = "Keep your first name under 60 characters."

  if (!lastName) fieldErrors.lastName = "Enter your last name."
  else if (lastName.length > MAX_TEXT_LENGTH) fieldErrors.lastName = "Keep your last name under 60 characters."

  if (eventGroup && eventGroup.length > MAX_TEXT_LENGTH) fieldErrors.eventGroup = "Pick an event group from the list."
  if (primaryEvent && primaryEvent.length > MAX_TEXT_LENGTH) {
    fieldErrors.primaryEvent = "Keep your primary event under 60 characters."
  }

  if (dateOfBirth) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ? new Date(`${dateOfBirth}T00:00:00`) : null
    const roundTrip =
      parsed && !Number.isNaN(parsed.getTime())
        ? `${parsed.getFullYear()}-${`${parsed.getMonth() + 1}`.padStart(2, "0")}-${`${parsed.getDate()}`.padStart(2, "0")}`
        : null
    if (roundTrip !== dateOfBirth) {
      fieldErrors.dateOfBirth = "Enter a real date."
    } else if (dateOfBirth > todayIsoDate()) {
      fieldErrors.dateOfBirth = "Your date of birth cannot be in the future."
    } else if (dateOfBirth < "1900-01-01") {
      fieldErrors.dateOfBirth = "Enter a real date."
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }
  return { ok: true, data: { firstName, lastName, dateOfBirth, eventGroup, primaryEvent } }
}

/**
 * Saves the athlete's own personal details. Goes through the update_current_athlete_profile
 * security definer function, which only touches name, date of birth, event group and primary event
 * on the caller's own row (RLS gives athletes no direct update on athletes or profiles).
 */
export async function updateCurrentAthleteProfile(input: AthleteProfileInput): Promise<Result<AthleteProfileInput>> {
  const validation = validateAthleteProfileInput(input)
  if (!validation.ok) {
    return err("VALIDATION", Object.values(validation.fieldErrors)[0] ?? "Check the highlighted fields.", validation.fieldErrors)
  }

  const clientResult = requireSupabaseClient("updateCurrentAthleteProfile")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  if (!authSession.session?.user.id) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { error } = await clientResult.client.rpc("update_current_athlete_profile", {
    p_first_name: validation.data.firstName,
    p_last_name: validation.data.lastName,
    p_date_of_birth: validation.data.dateOfBirth,
    p_event_group: validation.data.eventGroup,
    p_primary_event: validation.data.primaryEvent,
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(validation.data)
}

/* ---------------------------------------------------------------------------
   Mock mode: the demo athlete, with edits kept in localStorage per tenant.
--------------------------------------------------------------------------- */

const MOCK_PROFILE_STORAGE_KEY = "pacelab:athlete-profile"
const MOCK_JOIN_TEAM_STORAGE_KEY = "pacelab:join-team-state"

export const MOCK_ATHLETE_ID = "a1"
export const MOCK_COACH_NAME = "Andre Campbell"
export const MOCK_ORGANIZATION_NAME = "Elite Track Club"

export function loadMockAthleteProfileEdits(): Partial<AthleteProfileInput> {
  if (typeof window === "undefined") return {}
  try {
    const stored = window.localStorage.getItem(tenantStorageKey(MOCK_PROFILE_STORAGE_KEY))
    if (!stored) return {}
    const parsed = JSON.parse(stored) as Partial<AthleteProfileInput> | null
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export function saveMockAthleteProfile(input: AthleteProfileInput): Result<AthleteProfileInput> {
  const validation = validateAthleteProfileInput(input)
  if (!validation.ok) {
    return err("VALIDATION", Object.values(validation.fieldErrors)[0] ?? "Check the highlighted fields.", validation.fieldErrors)
  }
  try {
    window.localStorage.setItem(tenantStorageKey(MOCK_PROFILE_STORAGE_KEY), JSON.stringify(validation.data))
  } catch {
    return err("UNKNOWN", "Could not save on this device. Check that storage is not blocked.")
  }
  return ok(validation.data)
}

/** Team the mock athlete last joined through the join screen, if any. */
export function loadMockJoinedTeamId(): string | null {
  if (typeof window === "undefined") return null
  try {
    const stored = window.localStorage.getItem(tenantStorageKey(MOCK_JOIN_TEAM_STORAGE_KEY))
    if (!stored) return null
    const parsed = JSON.parse(stored) as { joinedTeamId?: string | null } | null
    return parsed?.joinedTeamId ?? null
  } catch {
    return null
  }
}

export function calculateAgeFromDateOfBirth(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null
  const dob = new Date(`${dateOfBirth}T00:00:00`)
  if (Number.isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDelta = today.getMonth() - dob.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) {
    age -= 1
  }
  return age >= 0 ? age : null
}

async function getAthleteLatestWellnessDate(client: SupabaseClient, athleteId: string): Promise<Result<string | null>> {
  const { data, error } = await client
    .from("wellness_entries")
    .select("entry_date")
    .eq("athlete_id", athleteId)
    .order("entry_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok((data?.entry_date as string | undefined) ?? null)
}

async function getAthleteAdherencePercent(client: SupabaseClient, athleteId: string): Promise<Result<number | null>> {
  const since = new Date()
  since.setDate(since.getDate() - 28)
  const sinceDate = since.toISOString().slice(0, 10)

  const [{ count: sessionsCount, error: sessionsError }, { count: completionsCount, error: completionsError }] = await Promise.all([
    client
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("athlete_id", athleteId)
      .gte("scheduled_for", sinceDate),
    client
      .from("session_completions")
      .select("id", { count: "exact", head: true })
      .eq("athlete_id", athleteId)
      .gte("completion_date", sinceDate),
  ])

  if (sessionsError) return { ok: false, error: mapPostgrestError(sessionsError) }
  if (completionsError) return { ok: false, error: mapPostgrestError(completionsError) }

  const totalSessions = sessionsCount ?? 0
  const totalCompletions = completionsCount ?? 0
  if (totalSessions <= 0) return ok(null)
  return ok(Math.max(0, Math.min(100, Math.round((totalCompletions / totalSessions) * 100))))
}

/** Light lookup of the signed-in athlete's current team, for the join screen. */
export async function getCurrentAthleteTeam(): Promise<Result<{ teamId: string | null; teamName: string | null }>> {
  const clientResult = requireSupabaseClient("getCurrentAthleteTeam")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data, error } = await clientResult.client
    .from("athletes")
    .select("team_id, teams(name)")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  const teamRow = data ? (Array.isArray(data.teams) ? data.teams[0] : data.teams) : null
  return ok({
    teamId: (data?.team_id as string | null | undefined) ?? null,
    teamName: (teamRow as { name?: string } | null)?.name ?? null,
  })
}
