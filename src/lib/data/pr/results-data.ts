import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import {
  cleanLabel,
  findResultEvent,
  groupResultsByEvent,
  OTHER_EVENT_KEY,
  seasonFor,
  verdictForNewResult,
  type AthleteResult,
  type EventHistory,
  type MarkUnit,
  type NewResultVerdict,
  type ResultEnvironment,
  type Season,
  type Timing,
} from "@/lib/data/pr/marks"
import {
  buildMockResult,
  loadMockResultsState,
  MOCK_ATHLETE_ID,
  MOCK_ATHLETE_USER_ID,
  updateMockResultsState,
} from "@/lib/data/pr/mock-results-store"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * Results history: every mark an athlete has, and the bests derived from it.
 *
 * Athlete screens use the "CurrentAthlete" functions. A coach or club admin screen uses the ones
 * that take an athlete id: the database lets a coach read and write the athletes of the teams
 * they are assigned to, and a club admin the whole club (see
 * supabase/migrations/20261008100000_results_history_and_competitions.sql).
 *
 * Every function works in mock mode too, on a demo history kept in the browser.
 */

export type ResultInput = {
  eventKey: string
  /** The event's name when eventKey is "other" ("Flying 30m"). */
  eventLabel?: string | null
  /** What an "other" event is measured in. Ignored for listed events. */
  unit?: MarkUnit | null
  /** The mark in the event's unit: seconds, metres, kilograms, points (centimetres for an "other" height). */
  value: number
  timing?: Timing | null
  /** YYYY-MM-DD */
  date: string
  source?: "manual" | "training"
  /** Metres per second with its sign. Kept only for events where wind applies, outdoors. */
  wind?: number | null
  environment?: ResultEnvironment
  altitude?: boolean
  /** Where it was set. */
  location?: string | null
  notes?: string | null
}

export type AthleteRecords = {
  results: AthleteResult[]
  season: Season
  /** One entry per event, with its bests. */
  events: EventHistory[]
  /** Who is looking. A result can be changed by the person who entered it (and by staff). */
  viewerUserId: string | null
}

export type AddedResult = {
  result: AthleteResult
  verdict: NewResultVerdict
}

type ClientResolution = { ok: true; client: SupabaseClient } | { ok: false; error: DataError }

function isMock() {
  return getBackendMode() !== "supabase"
}

function requireSupabaseClient(operation: string): ClientResolution {
  const client = getBrowserSupabaseClient()
  if (!client) {
    return { ok: false, error: { code: "UNKNOWN", message: `[${operation}] Supabase client is not configured.` } }
  }
  return { ok: true, client }
}

export function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

export const RESULT_COLUMNS =
  "id, athlete_id, event_key, event_label, event_group, mark_unit, lower_is_better, mark_value, compare_value, mark_display, timing, result_date, source, competition_id, competition_entry_id, test_result_id, place, wind, is_wind_legal, environment, is_altitude, location, notes, entered_by_user_id, created_at"

export type ResultRow = {
  id: string
  athlete_id: string
  event_key: string
  event_label: string
  event_group: string
  mark_unit: MarkUnit
  lower_is_better: boolean
  mark_value: number | string
  compare_value: number | string
  mark_display: string
  timing: Timing | null
  result_date: string
  source: AthleteResult["source"]
  competition_id: string | null
  competition_entry_id: string | null
  test_result_id: string | null
  place: number | null
  wind: number | string | null
  is_wind_legal: boolean
  environment: ResultEnvironment
  is_altitude: boolean
  location: string | null
  notes: string | null
  entered_by_user_id: string | null
  created_at: string
}

export function mapResultRow(row: ResultRow): AthleteResult {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    eventKey: row.event_key,
    eventLabel: row.event_label,
    eventGroup: row.event_group,
    unit: row.mark_unit,
    lowerIsBetter: row.lower_is_better,
    value: Number(row.mark_value),
    compareValue: Number(row.compare_value),
    display: row.mark_display,
    timing: row.timing,
    date: row.result_date.slice(0, 10),
    source: row.source,
    competitionId: row.competition_id,
    competitionEntryId: row.competition_entry_id,
    testResultId: row.test_result_id,
    place: row.place,
    wind: row.wind === null ? null : Number(row.wind),
    windLegal: row.is_wind_legal,
    environment: row.environment,
    altitude: row.is_altitude,
    location: row.location,
    notes: row.notes,
    enteredByUserId: row.entered_by_user_id,
    createdAt: row.created_at,
  }
}

export async function getCurrentUserId(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getSession()
  return data.session?.user.id ?? null
}

export async function getCurrentAthleteIdentity(client: SupabaseClient): Promise<Result<{ athleteId: string; userId: string }>> {
  const userId = await getCurrentUserId(client)
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")
  const { data, error } = await client.from("athletes").select("id").eq("user_id", userId).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return err("NOT_FOUND", "No athlete profile found for current user.")
  return ok({ athleteId: data.id as string, userId })
}

/** What the person typed, checked the same way the database checks it. Returns a message, or null when fine. */
export function validateResultInput(input: ResultInput): string | null {
  const event = findResultEvent(input.eventKey)
  if (!event) return "Choose an event."
  if (event.kind === "other") {
    if (!cleanLabel(input.eventLabel ?? "")) return "Name the event."
    if (!input.unit) return "Choose what the mark is measured in."
  }
  if (!(input.value > 0) || input.value >= 1_000_000) return "Enter the mark."
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Choose the date."
  if (input.date > localToday()) return "A result cannot be dated in the future."
  if (input.wind !== null && input.wind !== undefined && (input.wind < -9.9 || input.wind > 9.9)) {
    return "Wind must be between -9.9 and +9.9."
  }
  if ((input.location ?? "").length > 160) return "Keep where it was to 160 characters."
  if ((input.notes ?? "").length > 1000) return "Keep the note to 1000 characters."
  return null
}

function toInsertPayload(athleteId: string, input: ResultInput) {
  const event = findResultEvent(input.eventKey)
  const other = !event || event.kind === "other"
  return {
    athlete_id: athleteId,
    event_key: other ? OTHER_EVENT_KEY : event.key,
    event_label: other ? cleanLabel(input.eventLabel ?? "") : event.name,
    mark_unit: other ? input.unit : event.unit,
    mark_value: input.value,
    timing: input.timing ?? null,
    result_date: input.date,
    source: input.source ?? "manual",
    wind: input.wind ?? null,
    environment: input.environment ?? "outdoor",
    is_altitude: Boolean(input.altitude),
    location: input.location?.trim() || null,
    notes: input.notes?.trim() || null,
  }
}

/* ---------- Season ---------------------------------------------------------------------------- */

/** The season bests are counted in: the club's season when today is inside it, otherwise the calendar year. */
export async function getResultsSeason(): Promise<Result<Season>> {
  if (isMock()) return ok(seasonFor(localToday()))
  const clientResult = requireSupabaseClient("getResultsSeason")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("get_current_results_season")
  if (error) return { ok: false, error: mapPostgrestError(error) }
  const row = ((data as Array<{ season_start: string; season_end: string }> | null) ?? [])[0]
  if (!row) return ok(seasonFor(localToday()))
  return ok({ start: row.season_start.slice(0, 10), end: row.season_end.slice(0, 10) })
}

/* ---------- Reading ----------------------------------------------------------------------------- */

async function readResults(client: SupabaseClient, athleteId: string): Promise<Result<AthleteResult[]>> {
  const { data, error } = await client
    .from("athlete_results")
    .select(RESULT_COLUMNS)
    .eq("athlete_id", athleteId)
    .order("result_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2000)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(((data as ResultRow[] | null) ?? []).map(mapResultRow))
}

/** Every result of one athlete, newest first. For staff: an athlete they may manage. */
export async function getAthleteResults(athleteId: string): Promise<Result<AthleteResult[]>> {
  if (isMock()) {
    return ok(
      loadMockResultsState()
        .results.filter((result) => result.athleteId === athleteId)
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    )
  }
  const clientResult = requireSupabaseClient("getAthleteResults")
  if (!clientResult.ok) return clientResult
  return readResults(clientResult.client, athleteId)
}

/** Results, season and per event bests of one athlete. For staff: an athlete they may manage. */
export async function getAthleteRecords(athleteId: string): Promise<Result<AthleteRecords>> {
  const [resultsResult, seasonResult] = await Promise.all([getAthleteResults(athleteId), getResultsSeason()])
  if (!resultsResult.ok) return resultsResult
  const season = seasonResult.ok ? seasonResult.data : seasonFor(localToday())
  let viewerUserId: string | null = MOCK_ATHLETE_USER_ID
  if (!isMock()) {
    const client = getBrowserSupabaseClient()
    viewerUserId = client ? await getCurrentUserId(client) : null
  }
  return ok({ results: resultsResult.data, season, events: groupResultsByEvent(resultsResult.data, season), viewerUserId })
}

export async function getCurrentAthleteRecords(): Promise<Result<AthleteRecords>> {
  if (isMock()) return getAthleteRecords(MOCK_ATHLETE_ID)
  const clientResult = requireSupabaseClient("getCurrentAthleteRecords")
  if (!clientResult.ok) return clientResult
  const identity = await getCurrentAthleteIdentity(clientResult.client)
  if (!identity.ok) return identity
  return getAthleteRecords(identity.data.athleteId)
}

/** True when the viewer entered this result by hand, so they may change or delete it. */
export function canViewerEditResult(result: AthleteResult, viewerUserId: string | null): boolean {
  return Boolean(viewerUserId) && result.enteredByUserId === viewerUserId && result.source !== "test_week" && result.source !== "imported"
}

/* ---------- Writing ----------------------------------------------------------------------------- */

async function verdictFor(result: AthleteResult): Promise<NewResultVerdict> {
  const [resultsResult, seasonResult] = await Promise.all([getAthleteResults(result.athleteId), getResultsSeason()])
  if (!resultsResult.ok) return { kind: "none", beat: null }
  const season = seasonResult.ok ? seasonResult.data : seasonFor(localToday())
  const sameEvent = resultsResult.data.filter((item) => item.eventGroup === result.eventGroup)
  return verdictForNewResult(result, sameEvent.some((item) => item.id === result.id) ? sameEvent : [...sameEvent, result], season)
}

/**
 * Add a result for an athlete. Staff: any athlete they may manage. The answer says whether it is
 * a personal or season best; the athlete's coaches are told in-app by the database when it beats
 * an earlier best.
 */
export async function addAthleteResult(athleteId: string, input: ResultInput): Promise<Result<AddedResult>> {
  const invalid = validateResultInput(input)
  if (invalid) return err("VALIDATION", invalid)

  if (isMock()) {
    const event = findResultEvent(input.eventKey)
    const result = buildMockResult({
      athleteId,
      eventKey: input.eventKey,
      label: input.eventLabel ?? undefined,
      unit: input.unit ?? undefined,
      value: input.value,
      day: 0,
      date: input.date,
      source: input.source ?? "manual",
      wind: event?.windApplies ? (input.wind ?? null) : null,
      timing: input.timing ?? null,
      environment: input.environment ?? "outdoor",
      altitude: input.altitude,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
      enteredBy: MOCK_ATHLETE_USER_ID,
      createdAt: new Date().toISOString(),
    })
    updateMockResultsState((state) => ({ ...state, results: [result, ...state.results] }))
    return ok({ result, verdict: await verdictFor(result) })
  }

  const clientResult = requireSupabaseClient("addAthleteResult")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client
    .from("athlete_results")
    .insert(toInsertPayload(athleteId, input))
    .select(RESULT_COLUMNS)
    .single()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  const result = mapResultRow(data as ResultRow)
  return ok({ result, verdict: await verdictFor(result) })
}

export async function addResultForCurrentAthlete(input: ResultInput): Promise<Result<AddedResult>> {
  if (isMock()) return addAthleteResult(MOCK_ATHLETE_ID, input)
  const clientResult = requireSupabaseClient("addResultForCurrentAthlete")
  if (!clientResult.ok) return clientResult
  const identity = await getCurrentAthleteIdentity(clientResult.client)
  if (!identity.ok) return identity
  return addAthleteResult(identity.data.athleteId, input)
}

/**
 * Change a result. The athlete may change results they entered; staff may correct any result of an
 * athlete they manage except test week results (those are corrected in the test week).
 * A competition result keeps its competition; only the mark, wind, place, date and notes change.
 */
export async function updateAthleteResult(resultId: string, input: ResultInput & { place?: number | null }): Promise<Result<AthleteResult>> {
  const invalid = validateResultInput(input)
  if (invalid) return err("VALIDATION", invalid)

  if (isMock()) {
    let updated: AthleteResult | null = null
    updateMockResultsState((state) => ({
      ...state,
      results: state.results.map((existing) => {
        if (existing.id !== resultId) return existing
        const linked = Boolean(existing.competitionEntryId)
        updated = buildMockResult({
          id: existing.id,
          athleteId: existing.athleteId,
          eventKey: linked ? existing.eventKey : input.eventKey,
          label: linked ? existing.eventLabel : (input.eventLabel ?? undefined),
          unit: linked ? existing.unit : (input.unit ?? undefined),
          value: input.value,
          day: 0,
          date: input.date,
          source: existing.source,
          wind: input.wind ?? null,
          timing: input.timing ?? null,
          environment: existing.competitionId ? existing.environment : (input.environment ?? "outdoor"),
          altitude: input.altitude,
          location: input.location?.trim() || existing.location,
          notes: input.notes?.trim() || null,
          competitionId: existing.competitionId,
          competitionEntryId: existing.competitionEntryId,
          testResultId: existing.testResultId,
          place: input.place ?? existing.place,
          enteredBy: existing.enteredByUserId,
          createdAt: existing.createdAt,
        })
        return updated
      }),
    }))
    return updated ? ok(updated) : err("NOT_FOUND", "This result no longer exists.")
  }

  const clientResult = requireSupabaseClient("updateAthleteResult")
  if (!clientResult.ok) return clientResult
  const payload = toInsertPayload("", input)
  const { data, error } = await clientResult.client
    .from("athlete_results")
    .update({
      event_key: payload.event_key,
      event_label: payload.event_label,
      mark_unit: payload.mark_unit,
      mark_value: payload.mark_value,
      timing: payload.timing,
      result_date: payload.result_date,
      wind: payload.wind,
      environment: payload.environment,
      is_altitude: payload.is_altitude,
      location: payload.location,
      notes: payload.notes,
      ...(input.place !== undefined ? { place: input.place } : {}),
    })
    .eq("id", resultId)
    .select(RESULT_COLUMNS)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  const row = ((data as ResultRow[] | null) ?? [])[0]
  if (!row) return err("FORBIDDEN", "You cannot change this result. Only the person who entered it, or a coach, can.")
  return ok(mapResultRow(row))
}

export async function deleteAthleteResult(resultId: string): Promise<Result<{ resultId: string }>> {
  if (isMock()) {
    updateMockResultsState((state) => ({ ...state, results: state.results.filter((result) => result.id !== resultId) }))
    return ok({ resultId })
  }
  const clientResult = requireSupabaseClient("deleteAthleteResult")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.from("athlete_results").delete().eq("id", resultId).select("id")
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) {
    return err("FORBIDDEN", "You cannot delete this result. Only the person who entered it, or a coach, can.")
  }
  return ok({ resultId })
}
