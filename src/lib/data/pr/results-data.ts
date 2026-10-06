import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import {
  applyResultDetail,
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
  type Qualifier,
  type ResultDetail,
  type ResultEnvironment,
  type ResultRound,
  type Season,
  type Timing,
} from "@/lib/data/pr/marks"
import {
  buildMockResult,
  loadMockResultsState,
  MOCK_ATHLETE_ID,
  MOCK_ATHLETE_USER_ID,
  updateMockResultsState,
  withoutResult,
  withSeriesLegalMark,
} from "@/lib/data/pr/mock-results-store"
import { mockSeasonBestWindow } from "@/lib/data/club-admin/seasons-data"
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
  /** Heat, semi final, final. Null or left out when there was one round. */
  round?: ResultRound | null
  heat?: number | null
  lane?: number | null
  qualifier?: Qualifier | null
  /**
   * Splits, reaction time, an attempt series or heights. With a series (attempts or heights) the
   * mark is worked out from it and `value` and `wind` are ignored.
   */
  detail?: ResultDetail | null
}

export type AthleteRecords = {
  results: AthleteResult[]
  season: Season
  /** One entry per event, with its bests. */
  events: EventHistory[]
  /** Who is looking. A result can be changed by the person who entered it (and by staff). */
  viewerUserId: string | null
}

/** What a saved result means. `legal` is set when the news is about the wind legal attempt of a wind assisted series. */
export type SeriesVerdict = NewResultVerdict & { legal?: AthleteResult }

export type AddedResult = {
  result: AthleteResult
  verdict: SeriesVerdict
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
  "id, athlete_id, event_key, event_label, event_group, mark_unit, lower_is_better, mark_value, compare_value, mark_display, timing, result_date, source, competition_id, competition_entry_id, test_result_id, place, wind, is_wind_legal, environment, is_altitude, location, notes, entered_by_user_id, created_at, round, heat_number, lane, qualifier, detail, derived_from_result_id"

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
  round?: ResultRound | null
  heat_number?: number | null
  lane?: number | null
  qualifier?: Qualifier | null
  detail?: ResultDetail | null
  derived_from_result_id?: string | null
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
    round: row.round ?? null,
    heat: row.heat_number ?? null,
    lane: row.lane ?? null,
    qualifier: row.qualifier ?? null,
    detail: row.detail ?? null,
    derivedFromResultId: row.derived_from_result_id ?? null,
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
  return validateRoundFields(input)
}

/** Heat number, lane and place as typed. A message, or null when fine. */
export function validateRoundFields(input: { heat?: number | null; lane?: number | null; place?: number | null }): string | null {
  const whole = (value: number | null | undefined, max: number) => value === null || value === undefined || (Number.isInteger(value) && value >= 1 && value <= max)
  if (!whole(input.heat, 99)) return "The heat is a whole number, like 2."
  if (!whole(input.lane, 20)) return "The lane is a whole number, like 4."
  if (!whole(input.place, 999)) return "Place must be a whole number from 1 to 999."
  return null
}

/**
 * Works the detail into the input the way the database will: the detail in its canonical form
 * and, with an attempt series or heights, the mark and wind that follow from it.
 */
export function resolveResultDetail<T extends { value: number; wind?: number | null; detail?: ResultDetail | null }>(
  input: T,
  context: { eventKey: string; unit: MarkUnit | null; environment: ResultEnvironment },
): { ok: true; input: T } | { ok: false; message: string } {
  if (!input.detail || !context.unit) return { ok: true, input: { ...input, detail: null } }
  const event = findResultEvent(context.eventKey)
  const applied = applyResultDetail(input.detail, {
    eventKey: context.eventKey,
    unit: context.unit,
    windApplies: Boolean(event?.windApplies) && context.environment === "outdoor",
    mark: input.value > 0 ? input.value : null,
  })
  if (!applied.ok) return applied
  if (!applied.series) return { ok: true, input: { ...input, detail: applied.detail } }
  return { ok: true, input: { ...input, detail: applied.detail, value: applied.mark ?? input.value, wind: applied.wind } }
}

function resolveInput<T extends ResultInput>(input: T): { ok: true; input: T } | { ok: false; message: string } {
  const event = findResultEvent(input.eventKey)
  const unit = event ? (event.kind === "other" ? (input.unit ?? null) : event.unit) : null
  return resolveResultDetail(input, { eventKey: input.eventKey, unit, environment: input.environment ?? "outdoor" })
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
    round: input.round ?? null,
    heat_number: input.heat ?? null,
    lane: input.lane ?? null,
    qualifier: input.qualifier ?? null,
    detail: input.detail ?? null,
  }
}

/* ---------- Season ---------------------------------------------------------------------------- */

/** The season bests are counted in: the club's current season until its last day has passed, otherwise the calendar year. */
export async function getResultsSeason(): Promise<Result<Season>> {
  if (isMock()) return ok(mockSeasonBestWindow(localToday()))
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
  // The legal mark of a series belongs to the series: it is changed there.
  if (result.derivedFromResultId) return false
  return Boolean(viewerUserId) && result.enteredByUserId === viewerUserId && result.source !== "test_week" && result.source !== "imported"
}

/* ---------- Writing ----------------------------------------------------------------------------- */

async function verdictFor(result: AthleteResult): Promise<SeriesVerdict> {
  const [resultsResult, seasonResult] = await Promise.all([getAthleteResults(result.athleteId), getResultsSeason()])
  if (!resultsResult.ok) return { kind: "none", beat: null }
  const season = seasonResult.ok ? seasonResult.data : seasonFor(localToday())
  const sameEvent = resultsResult.data.filter((item) => item.eventGroup === result.eventGroup)
  return verdictForSeries(result, sameEvent.some((item) => item.id === result.id) ? sameEvent : [...sameEvent, result], season)
}

/**
 * What a new result means, given the event's history with it in. A wind assisted series may hold
 * a wind legal attempt that is a best in its own right: then that is what there is to say.
 */
export function verdictForSeries(result: AthleteResult, eventResults: AthleteResult[], season: Season): SeriesVerdict {
  const verdict = verdictForNewResult(result, eventResults, season)
  if (verdict.kind !== "wind-assisted") return verdict
  const legal = eventResults.find((item) => item.derivedFromResultId === result.id)
  if (!legal) return verdict
  const legalVerdict = verdictForNewResult(legal, eventResults, season)
  return legalVerdict.kind === "personal-best" || legalVerdict.kind === "season-best" || legalVerdict.kind === "first" ? { ...legalVerdict, legal } : verdict
}

/**
 * Add a result for an athlete. Staff: any athlete they may manage. The answer says whether it is
 * a personal or season best; the athlete's coaches are told in-app by the database when it beats
 * an earlier best.
 */
export async function addAthleteResult(athleteId: string, rawInput: ResultInput): Promise<Result<AddedResult>> {
  const resolved = resolveInput(rawInput)
  if (!resolved.ok) return err("VALIDATION", resolved.message)
  const input = resolved.input
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
      round: input.round ?? null,
      heat: input.heat ?? null,
      lane: input.lane ?? null,
      qualifier: input.qualifier ?? null,
      detail: input.detail ?? null,
    })
    updateMockResultsState((state) => ({ ...state, results: withSeriesLegalMark([result, ...state.results], result) }))
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
export async function updateAthleteResult(resultId: string, rawInput: ResultInput & { place?: number | null }): Promise<Result<AthleteResult>> {
  const resolved = resolveInput(rawInput)
  if (!resolved.ok) return err("VALIDATION", resolved.message)
  const input = resolved.input
  const invalid = validateResultInput(input)
  if (invalid) return err("VALIDATION", invalid)

  if (isMock()) {
    let updated: AthleteResult | null = null
    updateMockResultsState((state) => {
      const results = state.results.map((existing) => {
        if (existing.id !== resultId || existing.derivedFromResultId) return existing
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
          round: input.round === undefined ? existing.round : input.round,
          heat: input.heat === undefined ? existing.heat : input.heat,
          lane: input.lane === undefined ? existing.lane : input.lane,
          qualifier: input.qualifier === undefined ? existing.qualifier : input.qualifier,
          detail: input.detail === undefined ? existing.detail : input.detail,
        })
        return updated
      })
      return { ...state, results: updated ? withSeriesLegalMark(results, updated) : results }
    })
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
      ...(input.round !== undefined ? { round: input.round } : {}),
      ...(input.heat !== undefined ? { heat_number: input.heat } : {}),
      ...(input.lane !== undefined ? { lane: input.lane } : {}),
      ...(input.qualifier !== undefined ? { qualifier: input.qualifier } : {}),
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
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
    updateMockResultsState((state) => ({ ...state, results: withoutResult(state.results, resultId) }))
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
