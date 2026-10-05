import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { loadAthleteAdherence } from "@/lib/data/session/adherence-data"
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
  /** The coaches of the athlete's team, lead coach first. Empty when the athlete has no team. */
  coaches: AthleteTeamCoach[]
  /** Private details only the athlete, their own coaches and club admins can read. */
  details: AthletePrivateDetails
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
  const [adherenceResult, wellnessResult, teamContext, coaches, details] = await Promise.all([
    getAthleteAdherencePercent(clientResult.client, athleteId),
    getAthleteLatestWellnessDate(clientResult.client, athleteId),
    getTeamContext(clientResult.client),
    getTeamCoaches(clientResult.client),
    getPrivateDetails(clientResult.client, athleteId),
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
    coaches:
      coaches ??
      // A database without get_current_athlete_team_coaches() yet: names only.
      (teamContext?.coachNames ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name, index) => ({ userId: null, name, isLead: index === 0, email: null })),
    details: details ?? EMPTY_ATHLETE_PRIVATE_DETAILS,
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

/* ---------------------------------------------------------------------------
   Team coaches and coach contact
--------------------------------------------------------------------------- */

export type AthleteTeamCoach = {
  /** Null only when the database could give names and nothing else. */
  userId: string | null
  name: string
  isLead: boolean
  /** Set only when this coach chose to show their email to their athletes. */
  email: string | null
}

/**
 * The coaches of the signed-in athlete's team. Goes through get_current_athlete_team_coaches()
 * because athletes cannot read team_coaches or other profiles. Returns null when the function is
 * not there or fails, so the profile still loads.
 */
async function getTeamCoaches(client: SupabaseClient): Promise<AthleteTeamCoach[] | null> {
  try {
    const { data, error } = await client.rpc("get_current_athlete_team_coaches")
    if (error) return null
    return ((data as Array<{ user_id: string; display_name: string | null; is_primary: boolean | null; contact_email: string | null }> | null) ?? []).map(
      (row) => ({
        userId: row.user_id,
        name: row.display_name?.trim() || "Coach",
        isLead: Boolean(row.is_primary),
        email: row.contact_email?.trim() || null,
      }),
    )
  } catch {
    return null
  }
}

const MOCK_COACH_CONTACT_STORAGE_KEY = "pacelab:coach-contact-visible"
export const MOCK_COACH_EMAIL = "coach@pacelab.local"

function loadMockCoachContactVisible(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(tenantStorageKey(MOCK_COACH_CONTACT_STORAGE_KEY)) === "1"
  } catch {
    return false
  }
}

/** Mock mode: the demo coach, with their email only when the demo coach switched it on. */
export function loadMockAthleteTeamCoaches(): AthleteTeamCoach[] {
  return [{ userId: null, name: MOCK_COACH_NAME, isLead: true, email: loadMockCoachContactVisible() ? MOCK_COACH_EMAIL : null }]
}

/** Whether the signed-in coach shows their email address to the athletes of their teams. Off unless they chose otherwise. */
export async function getCurrentCoachContactVisibility(): Promise<Result<boolean>> {
  if (getBackendMode() !== "supabase") return ok(loadMockCoachContactVisible())

  const clientResult = requireSupabaseClient("getCurrentCoachContactVisibility")
  if (!clientResult.ok) return clientResult

  // Row policy: a coach reads their own row only. No row means off.
  const { data, error } = await clientResult.client.from("coach_contact_settings").select("show_email_to_athletes").maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(Boolean(data?.show_email_to_athletes))
}

export async function setCurrentCoachContactVisibility(showEmail: boolean): Promise<Result<boolean>> {
  if (getBackendMode() !== "supabase") {
    try {
      window.localStorage.setItem(tenantStorageKey(MOCK_COACH_CONTACT_STORAGE_KEY), showEmail ? "1" : "0")
    } catch {
      return err("UNKNOWN", "Could not save on this device. Check that storage is not blocked.")
    }
    return ok(showEmail)
  }

  const clientResult = requireSupabaseClient("setCurrentCoachContactVisibility")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client.rpc("set_current_coach_contact_visibility", { p_show_email: showEmail })
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(showEmail)
}

/* ---------------------------------------------------------------------------
   Private details: preferred name, measurements, emergency and guardian contact,
   medical notes. Readable by the athlete, the coaches of their own team and club
   admins only (athlete_private_details row policies).
--------------------------------------------------------------------------- */

export type AthletePrivateDetails = {
  preferredName: string | null
  pronouns: string | null
  heightCm: number | null
  weightKg: number | null
  emergencyContactName: string | null
  emergencyContactRelationship: string | null
  emergencyContactPhone: string | null
  guardianName: string | null
  guardianPhone: string | null
  guardianEmail: string | null
  medicalNotes: string | null
  bibNumber: string | null
  affiliation: string | null
}

export type AthletePrivateDetailsField = keyof AthletePrivateDetails

export const EMPTY_ATHLETE_PRIVATE_DETAILS: AthletePrivateDetails = {
  preferredName: null,
  pronouns: null,
  heightCm: null,
  weightKg: null,
  emergencyContactName: null,
  emergencyContactRelationship: null,
  emergencyContactPhone: null,
  guardianName: null,
  guardianPhone: null,
  guardianEmail: null,
  medicalNotes: null,
  bibNumber: null,
  affiliation: null,
}

export const ATHLETE_PRIVATE_DETAILS_COLUMNS =
  "athlete_id, preferred_name, pronouns, height_cm, weight_kg, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, guardian_name, guardian_phone, guardian_email, medical_notes, bib_number, affiliation"

export type AthletePrivateDetailsRow = {
  athlete_id: string
  preferred_name: string | null
  pronouns: string | null
  height_cm: number | string | null
  weight_kg: number | string | null
  emergency_contact_name: string | null
  emergency_contact_relationship: string | null
  emergency_contact_phone: string | null
  guardian_name: string | null
  guardian_phone: string | null
  guardian_email: string | null
  medical_notes: string | null
  bib_number: string | null
  affiliation: string | null
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function mapAthletePrivateDetailsRow(row: AthletePrivateDetailsRow): AthletePrivateDetails {
  return {
    preferredName: row.preferred_name,
    pronouns: row.pronouns,
    heightCm: numberOrNull(row.height_cm),
    weightKg: numberOrNull(row.weight_kg),
    emergencyContactName: row.emergency_contact_name,
    emergencyContactRelationship: row.emergency_contact_relationship,
    emergencyContactPhone: row.emergency_contact_phone,
    guardianName: row.guardian_name,
    guardianPhone: row.guardian_phone,
    guardianEmail: row.guardian_email,
    medicalNotes: row.medical_notes,
    bibNumber: row.bib_number,
    affiliation: row.affiliation,
  }
}

/** Null when the table is not there yet or the read fails: the profile still loads without them. */
async function getPrivateDetails(client: SupabaseClient, athleteId: string): Promise<AthletePrivateDetails | null> {
  try {
    const { data, error } = await client.from("athlete_private_details").select(ATHLETE_PRIVATE_DETAILS_COLUMNS).eq("athlete_id", athleteId).maybeSingle()
    if (error) return null
    return data ? mapAthletePrivateDetailsRow(data as AthletePrivateDetailsRow) : EMPTY_ATHLETE_PRIVATE_DETAILS
  } catch {
    return null
  }
}

/** Under 18 on this date of birth. Unknown date of birth counts as an adult. */
export function isMinorDateOfBirth(dateOfBirth: string | null): boolean {
  const age = calculateAgeFromDateOfBirth(dateOfBirth)
  return age !== null && age < 18
}

const PHONE_PATTERN = /^\+?[0-9][0-9 ().-]*$/
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Same rule as contact_phone_is_valid() in the database: 7 to 15 digits, with spaces, brackets, dots or dashes. */
export function isValidContactPhone(value: string) {
  const digits = value.replace(/[^0-9]/g, "").length
  return value.length <= 30 && PHONE_PATTERN.test(value) && digits >= 7 && digits <= 15
}

const DETAIL_TEXT_LIMITS: Array<[AthletePrivateDetailsField, number, string]> = [
  ["preferredName", 60, "Keep your preferred name under 60 characters."],
  ["pronouns", 40, "Keep your pronouns under 40 characters."],
  ["emergencyContactName", 120, "Keep the name under 120 characters."],
  ["emergencyContactRelationship", 60, "Keep the relationship under 60 characters."],
  ["guardianName", 120, "Keep the name under 120 characters."],
  ["medicalNotes", 1000, "Keep your medical notes under 1000 characters."],
  ["bibNumber", 40, "Keep the number under 40 characters."],
  ["affiliation", 120, "Keep the school or club under 120 characters."],
]

/** Trims and checks the private details. Everything is optional; an empty value clears the field. */
export function validateAthletePrivateDetails(
  input: AthletePrivateDetails,
):
  | { ok: true; data: AthletePrivateDetails }
  | { ok: false; fieldErrors: Partial<Record<AthletePrivateDetailsField, string>> } {
  const fieldErrors: Partial<Record<AthletePrivateDetailsField, string>> = {}
  const text = (value: string | null, multiline = false) => {
    const trimmed = (multiline ? value?.trim() : value?.trim().replace(/\s+/g, " ")) ?? ""
    return trimmed || null
  }
  const data: AthletePrivateDetails = {
    preferredName: text(input.preferredName),
    pronouns: text(input.pronouns),
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    emergencyContactName: text(input.emergencyContactName),
    emergencyContactRelationship: text(input.emergencyContactRelationship),
    emergencyContactPhone: text(input.emergencyContactPhone),
    guardianName: text(input.guardianName),
    guardianPhone: text(input.guardianPhone),
    guardianEmail: text(input.guardianEmail)?.toLowerCase() ?? null,
    medicalNotes: text(input.medicalNotes, true),
    bibNumber: text(input.bibNumber),
    affiliation: text(input.affiliation),
  }

  for (const [field, limit, message] of DETAIL_TEXT_LIMITS) {
    const value = data[field]
    if (typeof value === "string" && value.length > limit) fieldErrors[field] = message
  }

  if (data.heightCm !== null) {
    if (!Number.isFinite(data.heightCm) || data.heightCm < 50 || data.heightCm > 260) fieldErrors.heightCm = "Enter your height in centimetres, between 50 and 260."
    else data.heightCm = Math.round(data.heightCm * 10) / 10
  }
  if (data.weightKg !== null) {
    if (!Number.isFinite(data.weightKg) || data.weightKg < 20 || data.weightKg > 300) fieldErrors.weightKg = "Enter your weight in kilograms, between 20 and 300."
    else data.weightKg = Math.round(data.weightKg * 10) / 10
  }

  if (data.emergencyContactPhone && !isValidContactPhone(data.emergencyContactPhone)) {
    fieldErrors.emergencyContactPhone = "Enter a phone number with 7 to 15 digits."
  }
  if (data.emergencyContactPhone && !data.emergencyContactName) fieldErrors.emergencyContactName = "Add the name of the person to call."
  if (data.emergencyContactName && !data.emergencyContactPhone) fieldErrors.emergencyContactPhone = "Add a phone number for this person."

  if (data.guardianPhone && !isValidContactPhone(data.guardianPhone)) fieldErrors.guardianPhone = "Enter a phone number with 7 to 15 digits."
  if (data.guardianEmail && (data.guardianEmail.length > 254 || !EMAIL_PATTERN.test(data.guardianEmail))) {
    fieldErrors.guardianEmail = "Enter an email address like name@example.com."
  }
  if ((data.guardianPhone || data.guardianEmail) && !data.guardianName) fieldErrors.guardianName = "Add your parent or guardian's name."

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }
  return { ok: true, data }
}

/** Saves the athlete's own private details through update_current_athlete_private_details(). */
export async function updateCurrentAthletePrivateDetails(input: AthletePrivateDetails): Promise<Result<AthletePrivateDetails>> {
  const validation = validateAthletePrivateDetails(input)
  if (!validation.ok) {
    return err("VALIDATION", Object.values(validation.fieldErrors)[0] ?? "Check the highlighted fields.", validation.fieldErrors)
  }
  const details = validation.data

  if (getBackendMode() !== "supabase") {
    try {
      window.localStorage.setItem(tenantStorageKey(MOCK_PRIVATE_DETAILS_STORAGE_KEY), JSON.stringify(details))
    } catch {
      return err("UNKNOWN", "Could not save on this device. Check that storage is not blocked.")
    }
    return ok(details)
  }

  const clientResult = requireSupabaseClient("updateCurrentAthletePrivateDetails")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client.rpc("update_current_athlete_private_details", {
    p_preferred_name: details.preferredName,
    p_pronouns: details.pronouns,
    p_height_cm: details.heightCm,
    p_weight_kg: details.weightKg,
    p_emergency_contact_name: details.emergencyContactName,
    p_emergency_contact_relationship: details.emergencyContactRelationship,
    p_emergency_contact_phone: details.emergencyContactPhone,
    p_guardian_name: details.guardianName,
    p_guardian_phone: details.guardianPhone,
    p_guardian_email: details.guardianEmail,
    p_medical_notes: details.medicalNotes,
    p_bib_number: details.bibNumber,
    p_affiliation: details.affiliation,
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(details)
}

const MOCK_PRIVATE_DETAILS_STORAGE_KEY = "pacelab:athlete-private-details"

export function loadMockAthletePrivateDetails(): AthletePrivateDetails {
  if (typeof window === "undefined") return EMPTY_ATHLETE_PRIVATE_DETAILS
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(MOCK_PRIVATE_DETAILS_STORAGE_KEY)) ?? "null") as Partial<AthletePrivateDetails> | null
    return parsed && typeof parsed === "object" ? { ...EMPTY_ATHLETE_PRIVATE_DETAILS, ...parsed } : EMPTY_ATHLETE_PRIVATE_DETAILS
  } catch {
    return EMPTY_ATHLETE_PRIVATE_DETAILS
  }
}

/* ---------------------------------------------------------------------------
   Leaving a team
--------------------------------------------------------------------------- */

/**
 * The athlete takes themselves off their team (leave_current_athlete_team()). Their history is
 * kept, they stop seeing the team's plans and test weeks, and the team's coaches are told.
 */
export async function leaveCurrentAthleteTeam(): Promise<Result<void>> {
  if (getBackendMode() !== "supabase") {
    try {
      window.localStorage.setItem(
        tenantStorageKey(MOCK_JOIN_TEAM_STORAGE_KEY),
        JSON.stringify({ joinedTeamId: null, joinedTeamName: null, joinedGroup: null, joinedAt: null, leftTeam: true }),
      )
    } catch {
      return err("UNKNOWN", "Could not save on this device. Check that storage is not blocked.")
    }
    return ok(undefined)
  }

  const clientResult = requireSupabaseClient("leaveCurrentAthleteTeam")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client.rpc("leave_current_athlete_team")
  if (error) {
    if (error.message.toLowerCase().includes("not on a team")) return err("CONFLICT", "You are not on a team any more.")
    return { ok: false, error: mapPostgrestError(error) }
  }
  return ok(undefined)
}

/** Mock mode: true after the demo athlete left their team and has not joined another one since. */
export function hasMockAthleteLeftTeam(): boolean {
  if (typeof window === "undefined") return false
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(MOCK_JOIN_TEAM_STORAGE_KEY)) ?? "null") as { joinedTeamId?: string | null; leftTeam?: boolean } | null
    return Boolean(parsed?.leftTeam) && !parsed?.joinedTeamId
  } catch {
    return false
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
  // Done over due and not excused, last 28 days. Null when nothing was due. See src/lib/data/session/adherence.ts.
  const result = await loadAthleteAdherence(client, athleteId)
  return result.ok ? ok(result.data.percent) : result
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
