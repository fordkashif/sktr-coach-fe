import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  Competition,
  CompetitionEntry,
  CompetitionEntryInput,
  CompetitionEntryStatus,
  CompetitionEntryWithResult,
  CompetitionInput,
  CompetitionLevel,
  CompetitionResultInput,
  CompetitionScope,
  CompetitionWithEntries,
  RelayEntry,
} from "@/lib/data/competition/types"
import { relayLegsText } from "@/lib/data/competition/relay-logic"
import { kickNotificationEmails } from "@/lib/data/notifications-data"
import {
  cleanLabel,
  eventGroupKey,
  findResultEvent,
  formatMarkWithUnit,
  formatReaction,
  formatWind,
  headlineResult,
  OTHER_EVENT_KEY,
  roundLabel,
  roundSlot,
  seasonFor,
  selectBests,
  seriesText,
  sortRounds,
  splitsText,
  type AthleteResult,
  type MarkUnit,
  type ResultEnvironment,
} from "@/lib/data/pr/marks"
import {
  buildMockResult,
  loadMockResultsState,
  MOCK_ATHLETE_ID,
  MOCK_ATHLETE_USER_ID,
  MOCK_COACH_USER_ID,
  mockId,
  updateMockResultsState,
  withSeriesLegalMark,
} from "@/lib/data/pr/mock-results-store"
import {
  getAthleteResults,
  getCurrentAthleteIdentity,
  getCurrentUserId,
  getResultsSeason,
  localToday,
  mapResultRow,
  resolveResultDetail,
  RESULT_COLUMNS,
  validateRoundFields,
  verdictForSeries,
  type ResultRow,
  type SeriesVerdict,
} from "@/lib/data/pr/results-data"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * Competitions: the season calendar of meets, who is entered in what, and the result of each entry.
 *
 * Athlete screens use the "CurrentAthlete" functions. The "Staff" functions are for the coach and
 * club admin screens: a coach works with the teams they are assigned to, a club admin with the
 * whole club. The database enforces both (20261008100000_results_history_and_competitions.sql).
 * A result of an entry is a row of the results history (see results-data.ts), so it counts for
 * personal and season bests like any other mark.
 */

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

const COMPETITION_COLUMNS =
  "id, scope, team_id, owner_athlete_id, name, start_date, end_date, venue, location, level, environment, notes, created_by_user_id"
const ENTRY_COLUMNS = "id, competition_id, athlete_id, event_key, event_label, event_group, notes, status, entered_by_user_id, created_at"

type CompetitionRow = {
  id: string
  scope: CompetitionScope
  team_id: string | null
  owner_athlete_id: string | null
  name: string
  start_date: string
  end_date: string
  venue: string | null
  location: string | null
  level: CompetitionLevel | null
  environment: ResultEnvironment
  notes: string | null
  created_by_user_id: string | null
}

type EntryRow = {
  id: string
  competition_id: string
  athlete_id: string
  event_key: string
  event_label: string
  event_group: string
  notes: string | null
  status: CompetitionEntryStatus
  entered_by_user_id: string | null
  created_at: string
}

function mapCompetition(row: CompetitionRow): Competition {
  return {
    id: row.id,
    scope: row.scope,
    teamId: row.team_id,
    ownerAthleteId: row.owner_athlete_id,
    name: row.name,
    startDate: row.start_date.slice(0, 10),
    endDate: row.end_date.slice(0, 10),
    venue: row.venue,
    location: row.location,
    level: row.level,
    environment: row.environment,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
  }
}

function mapEntry(row: EntryRow): CompetitionEntry {
  return {
    id: row.id,
    competitionId: row.competition_id,
    athleteId: row.athlete_id,
    eventKey: row.event_key,
    eventLabel: row.event_label,
    eventGroup: row.event_group,
    notes: row.notes,
    status: row.status,
    enteredByUserId: row.entered_by_user_id,
    createdAt: row.created_at,
  }
}

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

/** What the person typed for a competition. Returns a message, or null when fine. */
export function validateCompetitionInput(input: CompetitionInput): string | null {
  if (!input.name.trim()) return "Give the competition a name."
  if (input.name.trim().length > 160) return "Keep the name to 160 characters."
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return "Choose the date."
  const end = input.endDate || input.startDate
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return "Choose the last day."
  if (end < input.startDate) return "The last day cannot be before the first day."
  const days = Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${input.startDate}T00:00:00`).getTime()) / 86_400_000)
  if (days > 30) return "A competition can run for 31 days at most."
  return null
}

function competitionPayload(input: CompetitionInput) {
  return {
    name: input.name.trim(),
    start_date: input.startDate,
    end_date: input.endDate || input.startDate,
    venue: input.venue?.trim() || null,
    location: input.location?.trim() || null,
    level: input.level ?? null,
    environment: input.environment,
    notes: input.notes?.trim() || null,
  }
}

function sortEntries<T extends CompetitionEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.eventLabel.localeCompare(b.eventLabel))
}

/** Results by the entry they belong to. An entry can hold one per round. */
function groupByEntry(results: AthleteResult[]): Map<string, AthleteResult[]> {
  const byEntry = new Map<string, AthleteResult[]>()
  for (const result of results) {
    if (!result.competitionEntryId) continue
    byEntry.set(result.competitionEntryId, [...(byEntry.get(result.competitionEntryId) ?? []), result])
  }
  return byEntry
}

/** An entry with its rounds in running order and the result it is known by (its last round). */
function withRounds<T extends CompetitionEntry>(entry: T, results: AthleteResult[] | undefined): T & { result: AthleteResult | null; rounds: AthleteResult[] } {
  const rounds = sortRounds(results ?? [])
  return { ...entry, rounds, result: headlineResult(rounds) }
}

const ROUND_TAKEN_MESSAGE = "This entry already has a result for that round. Change that one instead of adding another."

/** Upcoming first (soonest at the top), then past (most recent at the top). */
export function splitCompetitions<T extends Competition>(competitions: T[], onDay = today()): { upcoming: T[]; past: T[] } {
  const upcoming = competitions.filter((item) => item.endDate >= onDay).sort((a, b) => a.startDate.localeCompare(b.startDate))
  const past = competitions.filter((item) => item.endDate < onDay).sort((a, b) => b.startDate.localeCompare(a.startDate))
  return { upcoming, past }
}

/* ---------- Mock mode ---------------------------------------------------------------------------- */

function mockAssemble(athleteId: string | null): CompetitionWithEntries[] {
  const state = loadMockResultsState()
  const byEntry = groupByEntry(state.results)
  return state.competitions.map((competition) => ({
    ...competition,
    canManage: competition.scope === "athlete" && competition.ownerAthleteId === MOCK_ATHLETE_ID,
    entries: sortEntries(
      state.entries
        .filter((entry) => entry.competitionId === competition.id && (athleteId === null || entry.athleteId === athleteId))
        .map((entry) => withRounds(entry, byEntry.get(entry.id))),
    ),
  }))
}

/* ---------- Reading: athlete ---------------------------------------------------------------------- */

async function readForAthlete(client: SupabaseClient, athleteId: string, userId: string, competitionId?: string): Promise<Result<CompetitionWithEntries[]>> {
  const competitionQuery = client.from("competitions").select(COMPETITION_COLUMNS).order("start_date", { ascending: false }).limit(300)
  const entryQuery = client.from("competition_entries").select(ENTRY_COLUMNS).eq("athlete_id", athleteId).limit(1000)
  const resultQuery = client.from("athlete_results").select(RESULT_COLUMNS).eq("athlete_id", athleteId).not("competition_id", "is", null).limit(1000)
  if (competitionId) {
    competitionQuery.eq("id", competitionId)
    entryQuery.eq("competition_id", competitionId)
    resultQuery.eq("competition_id", competitionId)
  }
  const [competitions, entries, results] = await Promise.all([competitionQuery, entryQuery, resultQuery])
  if (competitions.error) return { ok: false, error: mapPostgrestError(competitions.error) }
  if (entries.error) return { ok: false, error: mapPostgrestError(entries.error) }
  if (results.error) return { ok: false, error: mapPostgrestError(results.error) }

  const resultsByEntry = groupByEntry(((results.data as ResultRow[] | null) ?? []).map(mapResultRow))
  const entryRows = ((entries.data as EntryRow[] | null) ?? []).map(mapEntry)

  return ok(
    ((competitions.data as CompetitionRow[] | null) ?? []).map((row) => {
      const competition = mapCompetition(row)
      return {
        ...competition,
        canManage: competition.scope === "athlete" && competition.ownerAthleteId === athleteId && Boolean(userId),
        entries: sortEntries(entryRows.filter((entry) => entry.competitionId === competition.id)).map((entry) => withRounds(entry, resultsByEntry.get(entry.id))),
      }
    }),
  )
}

/** Every competition the athlete can see (their team's, club wide, their own, any they are entered in), with their own entries and results. */
export async function getCompetitionsForCurrentAthlete(): Promise<Result<CompetitionWithEntries[]>> {
  if (isMock()) return ok(mockAssemble(MOCK_ATHLETE_ID))
  const clientResult = requireSupabaseClient("getCompetitionsForCurrentAthlete")
  if (!clientResult.ok) return clientResult
  const identity = await getCurrentAthleteIdentity(clientResult.client)
  if (!identity.ok) return identity
  return readForAthlete(clientResult.client, identity.data.athleteId, identity.data.userId)
}

export async function getCompetitionForCurrentAthlete(competitionId: string): Promise<Result<CompetitionWithEntries | null>> {
  if (isMock()) return ok(mockAssemble(MOCK_ATHLETE_ID).find((item) => item.id === competitionId) ?? null)
  const clientResult = requireSupabaseClient("getCompetitionForCurrentAthlete")
  if (!clientResult.ok) return clientResult
  const identity = await getCurrentAthleteIdentity(clientResult.client)
  if (!identity.ok) return identity
  const result = await readForAthlete(clientResult.client, identity.data.athleteId, identity.data.userId, competitionId)
  if (!result.ok) return result
  return ok(result.data[0] ?? null)
}

/** The next competition the athlete is entered in (not scratched from everything). Null when there is none. */
export async function getNextCompetitionForCurrentAthlete(): Promise<Result<CompetitionWithEntries | null>> {
  const all = await getCompetitionsForCurrentAthlete()
  if (!all.ok) return all
  const { upcoming } = splitCompetitions(all.data)
  return ok(upcoming.find((item) => item.entries.some((entry) => entry.status === "entered")) ?? null)
}

/* ---------- Writing: athlete ------------------------------------------------------------------------ */

/** An athlete adds a competition for themselves (an open meet they entered on their own). */
export async function createCompetitionForCurrentAthlete(input: CompetitionInput): Promise<Result<Competition>> {
  const invalid = validateCompetitionInput(input)
  if (invalid) return err("VALIDATION", invalid)

  if (isMock()) {
    const payload = competitionPayload(input)
    const competition: Competition = {
      id: mockId("comp"),
      scope: "athlete",
      teamId: null,
      ownerAthleteId: MOCK_ATHLETE_ID,
      name: payload.name,
      startDate: payload.start_date,
      endDate: payload.end_date,
      venue: payload.venue,
      location: payload.location,
      level: payload.level,
      environment: payload.environment,
      notes: payload.notes,
      createdByUserId: MOCK_ATHLETE_USER_ID,
    }
    updateMockResultsState((state) => ({ ...state, competitions: [...state.competitions, competition] }))
    return ok(competition)
  }

  const clientResult = requireSupabaseClient("createCompetitionForCurrentAthlete")
  if (!clientResult.ok) return clientResult
  const identity = await getCurrentAthleteIdentity(clientResult.client)
  if (!identity.ok) return identity
  const { data: athlete, error: athleteError } = await clientResult.client.from("athletes").select("tenant_id").eq("id", identity.data.athleteId).single()
  if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }

  const { data, error } = await clientResult.client
    .from("competitions")
    .insert({ ...competitionPayload(input), tenant_id: athlete.tenant_id as string, scope: "athlete", owner_athlete_id: identity.data.athleteId })
    .select(COMPETITION_COLUMNS)
    .single()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(mapCompetition(data as CompetitionRow))
}

/** Change a competition. Athletes: only one they added themselves. Staff: one they may manage. */
export async function updateCompetition(competitionId: string, input: CompetitionInput): Promise<Result<Competition>> {
  const invalid = validateCompetitionInput(input)
  if (invalid) return err("VALIDATION", invalid)

  if (isMock()) {
    const payload = competitionPayload(input)
    let updated: Competition | null = null
    updateMockResultsState((state) => ({
      ...state,
      competitions: state.competitions.map((item) => {
        if (item.id !== competitionId) return item
        updated = {
          ...item,
          name: payload.name,
          startDate: payload.start_date,
          endDate: payload.end_date,
          venue: payload.venue,
          location: payload.location,
          level: payload.level,
          environment: payload.environment,
          notes: payload.notes,
        }
        return updated
      }),
    }))
    return updated ? ok(updated) : err("NOT_FOUND", "This competition no longer exists.")
  }

  const clientResult = requireSupabaseClient("updateCompetition")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.from("competitions").update(competitionPayload(input)).eq("id", competitionId).select(COMPETITION_COLUMNS)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  const row = ((data as CompetitionRow[] | null) ?? [])[0]
  if (!row) return err("FORBIDDEN", "You cannot change this competition.")
  return ok(mapCompetition(row))
}

/** Delete a competition and its entries. Results already recorded stay in the athlete's history. */
export async function deleteCompetition(competitionId: string): Promise<Result<{ competitionId: string }>> {
  if (isMock()) {
    updateMockResultsState((state) => ({
      ...state,
      competitions: state.competitions.filter((item) => item.id !== competitionId),
      entries: state.entries.filter((entry) => entry.competitionId !== competitionId),
      results: state.results.map((result) => (result.competitionId === competitionId ? { ...result, competitionId: null, competitionEntryId: null } : result)),
      // A relay that was run stays for the team's record list; a team that never ran goes with the meet.
      relays: state.relays.filter((relay) => relay.competitionId !== competitionId || relay.value !== null).map((relay) => (relay.competitionId === competitionId ? { ...relay, competitionId: null } : relay)),
    }))
    return ok({ competitionId })
  }
  const clientResult = requireSupabaseClient("deleteCompetition")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.from("competitions").delete().eq("id", competitionId).select("id")
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) return err("FORBIDDEN", "You cannot delete this competition.")
  return ok({ competitionId })
}

function validateEntryInput(input: CompetitionEntryInput): string | null {
  const event = findResultEvent(input.eventKey)
  if (!event) return "Choose an event."
  if (event.kind === "other" && !cleanLabel(input.eventLabel ?? "")) return "Name the event."
  if ((input.notes ?? "").length > 500) return "Keep the note to 500 characters."
  return null
}

function entryPayload(competitionId: string, athleteId: string, input: CompetitionEntryInput) {
  const event = findResultEvent(input.eventKey)
  const other = !event || event.kind === "other"
  return {
    competition_id: competitionId,
    athlete_id: athleteId,
    event_key: other ? OTHER_EVENT_KEY : event.key,
    event_label: other ? cleanLabel(input.eventLabel ?? "") : event.name,
    notes: input.notes?.trim() || null,
  }
}

const DUPLICATE_ENTRY_MESSAGE = "You are already entered in that event at this competition."

function mockAddEntry(competitionId: string, athleteId: string, input: CompetitionEntryInput, enteredBy: string): Result<CompetitionEntry> {
  const payload = entryPayload(competitionId, athleteId, input)
  const group = eventGroupKey(payload.event_key, payload.event_label)
  const state = loadMockResultsState()
  if (!state.competitions.some((item) => item.id === competitionId)) return err("NOT_FOUND", "This competition no longer exists.")
  if (state.entries.some((entry) => entry.competitionId === competitionId && entry.athleteId === athleteId && entry.eventGroup === group)) {
    return err("CONFLICT", DUPLICATE_ENTRY_MESSAGE)
  }
  const entry: CompetitionEntry = {
    id: mockId("entry"),
    competitionId,
    athleteId,
    eventKey: payload.event_key,
    eventLabel: payload.event_label,
    eventGroup: group,
    notes: payload.notes,
    status: "entered",
    enteredByUserId: enteredBy,
    createdAt: new Date().toISOString(),
  }
  updateMockResultsState((current) => ({ ...current, entries: [...current.entries, entry] }))
  return ok(entry)
}

/** An athlete enters themselves in an event at a competition they can see. */
export async function addEntryForCurrentAthlete(competitionId: string, input: CompetitionEntryInput): Promise<Result<CompetitionEntry>> {
  const invalid = validateEntryInput(input)
  if (invalid) return err("VALIDATION", invalid)
  if (isMock()) return mockAddEntry(competitionId, MOCK_ATHLETE_ID, input, MOCK_ATHLETE_USER_ID)

  const clientResult = requireSupabaseClient("addEntryForCurrentAthlete")
  if (!clientResult.ok) return clientResult
  const identity = await getCurrentAthleteIdentity(clientResult.client)
  if (!identity.ok) return identity
  const { data, error } = await clientResult.client
    .from("competition_entries")
    .insert(entryPayload(competitionId, identity.data.athleteId, input))
    .select(ENTRY_COLUMNS)
    .single()
  if (error) {
    const mapped = mapPostgrestError(error)
    return { ok: false, error: mapped.code === "CONFLICT" ? { ...mapped, message: DUPLICATE_ENTRY_MESSAGE } : mapped }
  }
  return ok(mapEntry(data as EntryRow))
}

/** Scratch from an event (or undo it), or change the heat and lane note. */
export async function updateCompetitionEntry(entryId: string, patch: { status?: CompetitionEntryStatus; notes?: string | null }): Promise<Result<CompetitionEntry>> {
  if (isMock()) {
    let updated: CompetitionEntry | null = null
    updateMockResultsState((state) => ({
      ...state,
      entries: state.entries.map((entry) => {
        if (entry.id !== entryId) return entry
        updated = { ...entry, status: patch.status ?? entry.status, notes: patch.notes === undefined ? entry.notes : patch.notes?.trim() || null }
        return updated
      }),
    }))
    return updated ? ok(updated) : err("NOT_FOUND", "This entry no longer exists.")
  }
  const clientResult = requireSupabaseClient("updateCompetitionEntry")
  if (!clientResult.ok) return clientResult
  const changes: Record<string, unknown> = {}
  if (patch.status) changes.status = patch.status
  if (patch.notes !== undefined) changes.notes = patch.notes?.trim() || null
  const { data, error } = await clientResult.client.from("competition_entries").update(changes).eq("id", entryId).select(ENTRY_COLUMNS)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  const row = ((data as EntryRow[] | null) ?? [])[0]
  if (!row) return err("FORBIDDEN", "You cannot change this entry.")
  return ok(mapEntry(row))
}

/** Remove an entry. An athlete can remove the entries they made; one made by a coach can be scratched instead. */
export async function removeCompetitionEntry(entryId: string): Promise<Result<{ entryId: string }>> {
  if (isMock()) {
    updateMockResultsState((state) => ({
      ...state,
      entries: state.entries.filter((entry) => entry.id !== entryId),
      results: state.results.map((result) => (result.competitionEntryId === entryId ? { ...result, competitionEntryId: null } : result)),
    }))
    return ok({ entryId })
  }
  const clientResult = requireSupabaseClient("removeCompetitionEntry")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.from("competition_entries").delete().eq("id", entryId).select("id")
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) {
    return err("FORBIDDEN", "Your coach made this entry, so you cannot remove it. Scratch from the event instead.")
  }
  return ok({ entryId })
}

/**
 * Record (or correct) a result of an entry: the mark, with wind and place where they apply, the
 * round it was (an entry can hold a heat, a quarter final, a semi final and a final) and its
 * detail (splits, an attempt series, heights). `entry.result` is the result being corrected; pass
 * the entry with `result: null` to add another round. With a series the mark is worked out from
 * the attempts. Every round joins the athlete's history, so the best one counts for their bests.
 */
export async function saveCompetitionEntryResult(
  entry: CompetitionEntryWithResult,
  competition: Competition,
  rawInput: CompetitionResultInput,
  /** Mock mode only: the demo user who typed it (the coach, on the staff screens). */
  mockEnteredBy: string = MOCK_ATHLETE_USER_ID,
): Promise<Result<AthleteResult>> {
  const event = findResultEvent(entry.eventKey)
  const other = !event || event.kind === "other"
  if (other && !rawInput.unit && !entry.result) return err("VALIDATION", "Choose what the mark is measured in.")
  const unit: MarkUnit | null = other ? (rawInput.unit ?? entry.result?.unit ?? null) : event.unit

  // Detail left out (the results grid types marks only): the result keeps the detail it has.
  const resolved = resolveResultDetail(
    { ...rawInput, detail: rawInput.detail === undefined ? (entry.result?.detail ?? null) : rawInput.detail },
    { eventKey: entry.eventKey, unit, environment: competition.environment },
  )
  if (!resolved.ok) return err("VALIDATION", resolved.message)
  const input = resolved.input

  if (!(input.value > 0)) return err("VALIDATION", "Enter the mark.")
  const roundProblem = validateRoundFields(input)
  if (roundProblem) return err("VALIDATION", roundProblem)
  const date = input.date || competition.startDate
  if (date < competition.startDate || date > competition.endDate) return err("VALIDATION", "The date must be a day of the competition.")
  if (date > today()) return err("VALIDATION", "This competition has not happened yet.")

  const round = rawInput.round === undefined ? (entry.result?.round ?? null) : rawInput.round
  const heat = rawInput.heat === undefined ? (entry.result?.heat ?? null) : rawInput.heat
  const lane = rawInput.lane === undefined ? (entry.result?.lane ?? null) : rawInput.lane
  const qualifier = rawInput.qualifier === undefined ? (entry.result?.qualifier ?? null) : rawInput.qualifier
  if ((entry.rounds ?? []).some((item) => item.id !== entry.result?.id && roundSlot(item.round) === roundSlot(round))) {
    return err("CONFLICT", ROUND_TAKEN_MESSAGE)
  }

  if (isMock()) {
    const state = loadMockResultsState()
    if (state.results.some((item) => item.competitionEntryId === entry.id && item.id !== entry.result?.id && roundSlot(item.round) === roundSlot(round))) {
      return err("CONFLICT", ROUND_TAKEN_MESSAGE)
    }
    const result = buildMockResult({
      id: entry.result?.id,
      athleteId: entry.athleteId,
      eventKey: entry.eventKey,
      label: entry.eventLabel,
      unit: input.unit ?? entry.result?.unit,
      value: input.value,
      day: 0,
      date,
      source: "competition",
      wind: input.wind ?? null,
      timing: input.timing ?? null,
      environment: competition.environment,
      place: input.place ?? null,
      location: competition.name,
      notes: input.notes?.trim() || null,
      competitionId: competition.id,
      competitionEntryId: entry.id,
      enteredBy: entry.result?.enteredByUserId ?? mockEnteredBy,
      createdAt: entry.result?.createdAt ?? new Date().toISOString(),
      round,
      heat,
      lane,
      qualifier,
      detail: input.detail ?? null,
    })
    updateMockResultsState((current) => ({
      ...current,
      results: withSeriesLegalMark(entry.result ? current.results.map((item) => (item.id === result.id ? result : item)) : [result, ...current.results], result),
    }))
    return ok(result)
  }

  const clientResult = requireSupabaseClient("saveCompetitionEntryResult")
  if (!clientResult.ok) return clientResult
  const fields = {
    mark_value: input.value,
    timing: input.timing ?? null,
    wind: input.wind ?? null,
    place: input.place ?? null,
    result_date: date,
    notes: input.notes?.trim() || null,
    ...(rawInput.round !== undefined || !entry.result ? { round } : {}),
    ...(rawInput.heat !== undefined || !entry.result ? { heat_number: heat } : {}),
    ...(rawInput.lane !== undefined || !entry.result ? { lane } : {}),
    ...(rawInput.qualifier !== undefined || !entry.result ? { qualifier } : {}),
    ...(rawInput.detail !== undefined || !entry.result ? { detail: input.detail ?? null } : {}),
  }
  const roundConflict = (error: Parameters<typeof mapPostgrestError>[0]) => {
    const mapped = mapPostgrestError(error)
    return { ok: false as const, error: mapped.code === "CONFLICT" ? { ...mapped, message: ROUND_TAKEN_MESSAGE } : mapped }
  }

  if (entry.result) {
    const { data, error } = await clientResult.client.from("athlete_results").update(fields).eq("id", entry.result.id).select(RESULT_COLUMNS)
    if (error) return roundConflict(error)
    const row = ((data as ResultRow[] | null) ?? [])[0]
    if (!row) return err("FORBIDDEN", "You cannot change this result. Only the person who entered it, or a coach, can.")
    return ok(mapResultRow(row))
  }

  const { data, error } = await clientResult.client
    .from("athlete_results")
    .insert({
      ...fields,
      athlete_id: entry.athleteId,
      event_key: entry.eventKey,
      event_label: entry.eventLabel,
      mark_unit: unit,
      source: "competition",
      competition_id: competition.id,
      competition_entry_id: entry.id,
    })
    .select(RESULT_COLUMNS)
    .single()
  if (error) return roundConflict(error)
  return ok(mapResultRow(data as ResultRow))
}

/* ---------- Staff (coach and club admin) --------------------------------------------------------------- */

export type StaffCompetitionInput = CompetitionInput & {
  /** "team": a team the coach is assigned to (a club admin: any team). "club": club admins only. */
  scope: "team" | "club"
  teamId?: string | null
}

async function staffTenantId(client: SupabaseClient): Promise<Result<string>> {
  const userId = await getCurrentUserId(client)
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")
  const { data, error } = await client.from("profiles").select("tenant_id, role").eq("user_id", userId).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || (data.role !== "coach" && data.role !== "club-admin")) return err("FORBIDDEN", "Only a coach or club admin can do this.")
  return ok(data.tenant_id as string)
}

/**
 * Mock mode: the demo athlete is "fallback-athlete" in the results demo and "a1" (Marcus Johnson)
 * on the coach's demo roster. The staff functions speak roster ids; these two convert.
 */
const MOCK_ROSTER_SELF_ID = "a1"
function toMockStoreAthleteId(rosterId: string) {
  return rosterId === MOCK_ROSTER_SELF_ID ? MOCK_ATHLETE_ID : rosterId
}
function toMockRosterAthleteId(storeId: string) {
  return storeId === MOCK_ATHLETE_ID ? MOCK_ROSTER_SELF_ID : storeId
}

/** Keeps what belongs on one team's calendar: its own meets, club wide ones and the meets its athletes added. */
function onTeamCalendar(competition: Competition, ownerTeamId: string | null | undefined, teamId: string | null | undefined) {
  if (!teamId) return true
  if (competition.scope === "club") return true
  if (competition.scope === "team") return competition.teamId === teamId
  return ownerTeamId === teamId
}

async function mockStaffCompetitions(teamId: string | null | undefined): Promise<CompetitionWithEntries[]> {
  const { mockAthletes } = await import("@/lib/mock-data")
  const byId = new Map(mockAthletes.map((athlete) => [athlete.id, athlete]))
  return mockAssemble(null)
    .map((competition) => {
      const owner = competition.ownerAthleteId ? byId.get(toMockRosterAthleteId(competition.ownerAthleteId)) : null
      return {
        ...competition,
        canManage: competition.scope !== "athlete",
        ownerName: owner?.name ?? null,
        ownerTeamId: owner?.teamId ?? null,
        entries: competition.entries
          .map((entry) => {
            const athlete = byId.get(toMockRosterAthleteId(entry.athleteId))
            return { ...entry, athleteId: toMockRosterAthleteId(entry.athleteId), athleteName: athlete?.name ?? "Unnamed athlete", athleteTeamId: athlete?.teamId ?? null }
          })
          .filter((entry) => !teamId || entry.athleteTeamId === teamId),
      }
    })
    .filter((competition) => onTeamCalendar(competition, competition.ownerTeamId, teamId))
    .map((competition): CompetitionWithEntries => ({ ...competition, entries: sortEntries(competition.entries) }))
}

/**
 * Competitions a coach or club admin can see, with every entry (and result) of the athletes they manage.
 * Pass a team id for that team's calendar: its own meets, the club wide ones and the meets its
 * athletes added for themselves, with the entries of that team's athletes. Pass a competition id for one.
 */
export async function getCompetitionsForStaff(params?: { teamId?: string | null; competitionId?: string }): Promise<Result<CompetitionWithEntries[]>> {
  if (isMock()) {
    const all = await mockStaffCompetitions(params?.teamId)
    return ok(params?.competitionId ? all.filter((item) => item.id === params.competitionId) : all)
  }
  const clientResult = requireSupabaseClient("getCompetitionsForStaff")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client

  const competitionQuery = client.from("competitions").select(COMPETITION_COLUMNS).order("start_date", { ascending: false }).limit(300)
  if (params?.competitionId) competitionQuery.eq("id", params.competitionId)
  // An athlete's own meet has no team of its own, so the team is checked below, on its owner.
  else if (params?.teamId) competitionQuery.or(`team_id.eq.${params.teamId},scope.eq.club,scope.eq.athlete`)
  const { data: competitionRows, error: competitionError } = await competitionQuery
  if (competitionError) return { ok: false, error: mapPostgrestError(competitionError) }
  const allCompetitions = ((competitionRows as CompetitionRow[] | null) ?? []).map(mapCompetition)
  if (allCompetitions.length === 0) return ok([])

  // Who added the athletes' own meets, and which team they are on.
  const ownerIds = [...new Set(allCompetitions.map((item) => item.ownerAthleteId).filter((id): id is string => Boolean(id)))]
  const owners = new Map<string, { name: string; teamId: string | null }>()
  if (ownerIds.length > 0) {
    const { data: ownerRows, error: ownerError } = await client.from("athletes").select("id, team_id, first_name, last_name").in("id", ownerIds)
    if (ownerError) return { ok: false, error: mapPostgrestError(ownerError) }
    for (const row of (ownerRows as Array<{ id: string; team_id: string | null; first_name: string | null; last_name: string | null }> | null) ?? []) {
      owners.set(row.id, { name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "An athlete", teamId: row.team_id })
    }
  }
  const competitions = allCompetitions.filter((item) => onTeamCalendar(item, item.ownerAthleteId ? owners.get(item.ownerAthleteId)?.teamId : null, params?.teamId))
  if (competitions.length === 0) return ok([])

  const ids = competitions.map((item) => item.id)
  const [entries, results] = await Promise.all([
    client.from("competition_entries").select(`${ENTRY_COLUMNS}, athletes(first_name, last_name, team_id)`).in("competition_id", ids).limit(5000),
    client.from("athlete_results").select(RESULT_COLUMNS).in("competition_id", ids).limit(5000),
  ])
  if (entries.error) return { ok: false, error: mapPostgrestError(entries.error) }
  if (results.error) return { ok: false, error: mapPostgrestError(results.error) }

  const resultsByEntry = groupByEntry(((results.data as ResultRow[] | null) ?? []).map(mapResultRow))
  type EmbeddedAthlete = { first_name: string | null; last_name: string | null; team_id: string | null }
  type StaffEntryRow = EntryRow & { athletes: EmbeddedAthlete | EmbeddedAthlete[] | null }
  const entryRows = ((entries.data as unknown as StaffEntryRow[] | null) ?? [])
    .map((row) => {
      const athlete = Array.isArray(row.athletes) ? (row.athletes[0] ?? null) : row.athletes
      return {
        ...withRounds(mapEntry(row), resultsByEntry.get(row.id)),
        athleteName: [athlete?.first_name, athlete?.last_name].filter(Boolean).join(" ").trim() || "Unnamed athlete",
        athleteTeamId: athlete?.team_id ?? null,
      }
    })
    .filter((entry) => !params?.teamId || entry.athleteTeamId === params.teamId)

  return ok(
    competitions.map((competition) => ({
      ...competition,
      // The database decides in the end; an athlete's own competition is never managed by staff.
      canManage: competition.scope !== "athlete",
      ownerName: competition.ownerAthleteId ? (owners.get(competition.ownerAthleteId)?.name ?? null) : null,
      entries: sortEntries(entryRows.filter((entry) => entry.competitionId === competition.id)),
    })),
  )
}

/** One competition with the entries the viewer manages (pass a team id to keep one team's athletes). */
export async function getCompetitionForStaff(competitionId: string, params?: { teamId?: string | null }): Promise<Result<CompetitionWithEntries | null>> {
  const result = await getCompetitionsForStaff({ competitionId, teamId: params?.teamId })
  if (!result.ok) return result
  return ok(result.data[0] ?? null)
}

/** A coach creates a competition for one of their teams; a club admin for a team or for the whole club. */
export async function createCompetitionForStaff(input: StaffCompetitionInput): Promise<Result<Competition>> {
  const invalid = validateCompetitionInput(input)
  if (invalid) return err("VALIDATION", invalid)
  if (input.scope === "team" && !input.teamId) return err("VALIDATION", "Choose a team for this competition.")

  if (isMock()) {
    const payload = competitionPayload(input)
    const competition: Competition = {
      id: mockId("comp"),
      scope: input.scope,
      teamId: input.scope === "team" ? (input.teamId ?? null) : null,
      ownerAthleteId: null,
      name: payload.name,
      startDate: payload.start_date,
      endDate: payload.end_date,
      venue: payload.venue,
      location: payload.location,
      level: payload.level,
      environment: payload.environment,
      notes: payload.notes,
      createdByUserId: MOCK_COACH_USER_ID,
    }
    updateMockResultsState((state) => ({ ...state, competitions: [...state.competitions, competition] }))
    return ok(competition)
  }

  const clientResult = requireSupabaseClient("createCompetitionForStaff")
  if (!clientResult.ok) return clientResult
  const tenant = await staffTenantId(clientResult.client)
  if (!tenant.ok) return tenant
  const { data, error } = await clientResult.client
    .from("competitions")
    .insert({ ...competitionPayload(input), tenant_id: tenant.data, scope: input.scope, team_id: input.scope === "team" ? input.teamId : null })
    .select(COMPETITION_COLUMNS)
    .single()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(mapCompetition(data as CompetitionRow))
}

/**
 * Enter athletes in events of a competition, in one go. Each athlete entered by someone else is
 * told in-app and by email (one notification per athlete, naming their events).
 */
export async function enterAthletesInCompetition(
  competitionId: string,
  entries: Array<CompetitionEntryInput & { athleteId: string }>,
): Promise<Result<CompetitionEntry[]>> {
  if (entries.length === 0) return err("VALIDATION", "Choose at least one athlete and event.")
  for (const entry of entries) {
    const invalid = validateEntryInput(entry)
    if (invalid) return err("VALIDATION", invalid)
  }

  if (isMock()) {
    const added: CompetitionEntry[] = []
    for (const entry of entries) {
      const result = mockAddEntry(competitionId, toMockStoreAthleteId(entry.athleteId), entry, MOCK_COACH_USER_ID)
      if (!result.ok) {
        return result.error.code === "CONFLICT" ? err("CONFLICT", "One of these athletes is already entered in that event.") : result
      }
      added.push({ ...result.data, athleteId: entry.athleteId })
    }
    return ok(added)
  }

  const clientResult = requireSupabaseClient("enterAthletesInCompetition")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client
    .from("competition_entries")
    .insert(entries.map((entry) => entryPayload(competitionId, entry.athleteId, entry)))
    .select(ENTRY_COLUMNS)
  if (error) {
    const mapped = mapPostgrestError(error)
    return { ok: false, error: mapped.code === "CONFLICT" ? { ...mapped, message: "One of these athletes is already entered in that event." } : mapped }
  }
  // Sends the emails this just queued without waiting for the scheduler.
  kickNotificationEmails()
  return ok(((data as EntryRow[] | null) ?? []).map(mapEntry))
}

export type SavedStaffResult = {
  result: AthleteResult
  /** What the mark is for the athlete: a personal best, a season best, wind assisted, or neither. */
  verdict: SeriesVerdict
}

/**
 * A coach or club admin records (or corrects) the result of an entry, and is told what it means
 * for the athlete: the answer says whether the mark is now their personal or season best.
 */
export async function saveCompetitionEntryResultForStaff(
  entry: CompetitionEntryWithResult,
  competition: Competition,
  input: CompetitionResultInput,
): Promise<Result<SavedStaffResult>> {
  const stored = isMock() ? { ...entry, athleteId: toMockStoreAthleteId(entry.athleteId) } : entry
  const saved = await saveCompetitionEntryResult(stored, competition, input, MOCK_COACH_USER_ID)
  if (!saved.ok) return saved
  const [history, season] = await Promise.all([getAthleteResults(saved.data.athleteId), getResultsSeason()])
  if (!history.ok) return ok({ result: saved.data, verdict: { kind: "none", beat: null } })
  const sameEvent = history.data.filter((item) => item.eventGroup === saved.data.eventGroup)
  const withSaved = sameEvent.some((item) => item.id === saved.data.id) ? sameEvent : [...sameEvent, saved.data]
  return ok({ result: saved.data, verdict: verdictForSeries(saved.data, withSaved, season.ok ? season.data : seasonFor(localToday())) })
}

export type EntryStanding = "personal-best" | "season-best" | null

/**
 * For every entry of a competition that has a result: is one of its rounds the athlete's personal
 * best or season best right now? One read for the whole meet. Keyed by entry id and, for meets
 * with rounds, by the id of each result too.
 */
export async function getEntryStandings(competition: CompetitionWithEntries): Promise<Result<Record<string, EntryStanding>>> {
  const withResult = competition.entries.filter((entry) => entry.result)
  if (withResult.length === 0) return ok({})
  const seasonResult = await getResultsSeason()
  const season = seasonResult.ok ? seasonResult.data : seasonFor(localToday())

  let history: AthleteResult[]
  if (isMock()) {
    history = loadMockResultsState().results
  } else {
    const clientResult = requireSupabaseClient("getEntryStandings")
    if (!clientResult.ok) return clientResult
    const athleteIds = [...new Set(withResult.map((entry) => entry.athleteId))]
    const groups = [...new Set(withResult.map((entry) => entry.eventGroup))]
    const { data, error } = await clientResult.client.from("athlete_results").select(RESULT_COLUMNS).in("athlete_id", athleteIds).in("event_group", groups).limit(10000)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    history = ((data as ResultRow[] | null) ?? []).map(mapResultRow)
  }

  const standings: Record<string, EntryStanding> = {}
  for (const entry of withResult) {
    const headline = entry.result as AthleteResult
    const bests = selectBests(
      history.filter((item) => item.athleteId === headline.athleteId && item.eventGroup === headline.eventGroup),
      season,
    )
    const rounds = entry.rounds?.length ? entry.rounds : [headline]
    let best: EntryStanding = null
    for (const result of rounds) {
      const standing: EntryStanding = bests.personalBest?.id === result.id ? "personal-best" : bests.seasonBest?.id === result.id ? "season-best" : null
      standings[result.id] = standing
      if (standing === "personal-best" || (standing === "season-best" && best === null)) best = standing
    }
    standings[entry.id] = best
  }
  return ok(standings)
}

/**
 * The rows of a meet's results sheet: a header, then one line per result (an entry with a heat
 * and a final has two lines), then the relay teams. For a CSV file. The first ten columns are the
 * ones the file has always had; rounds, splits, attempts and relay legs come after them.
 */
export function competitionResultsRows(competition: CompetitionWithEntries, standings: Record<string, EntryStanding> = {}, relays: RelayEntry[] = []): string[][] {
  const header = ["Athlete", "Event", "Status", "Mark", "Wind", "Wind legal", "Place", "Best", "Date", "Note", "Round", "Heat", "Lane", "Qualifier", "Reaction", "Splits", "Attempts or heights", "Relay legs"]
  const bestText = (standing: EntryStanding | undefined) => (standing === "personal-best" ? "Personal best" : standing === "season-best" ? "Season best" : "")
  const lines = [...competition.entries]
    .sort((a, b) => a.eventLabel.localeCompare(b.eventLabel) || (a.result?.place ?? 999) - (b.result?.place ?? 999) || (a.athleteName ?? "").localeCompare(b.athleteName ?? ""))
    .flatMap((entry) => {
      const rounds: Array<AthleteResult | null> = entry.rounds?.length ? entry.rounds : [entry.result]
      return rounds.map((result) => [
        entry.athleteName ?? "",
        entry.eventLabel,
        entry.status === "scratched" ? "Scratched" : result ? "Competed" : "Entered",
        result ? formatMarkWithUnit(result.display, result.unit) : "",
        result && result.wind !== null ? formatWind(result.wind) : "",
        result ? (result.windLegal ? "Yes" : "No") : "",
        result?.place ? String(result.place) : "",
        result ? bestText(result.id in standings ? standings[result.id] : standings[entry.id]) : "",
        result?.date ?? "",
        entry.notes ?? "",
        result ? roundLabel(result.round) : "",
        result?.heat ? String(result.heat) : "",
        result?.lane ? String(result.lane) : "",
        result?.qualifier ?? "",
        result?.detail?.reaction !== undefined ? formatReaction(result.detail.reaction) : "",
        result ? splitsText(result.detail) : "",
        result ? seriesText(result.detail) : "",
        "",
      ])
    })
  const relayLines = [...relays]
    .sort((a, b) => a.eventLabel.localeCompare(b.eventLabel) || a.teamLabel.localeCompare(b.teamLabel) || (a.place ?? 999) - (b.place ?? 999))
    .map((relay) => [
      `${relay.teamLabel} (relay team)`,
      relay.eventLabel,
      relay.value !== null ? "Competed" : "Entered",
      relay.display ? formatMarkWithUnit(relay.display, "s") : "",
      "",
      "",
      relay.place ? String(relay.place) : "",
      "",
      relay.date,
      relay.notes ?? "",
      roundLabel(relay.round),
      relay.heat ? String(relay.heat) : "",
      relay.lane ? String(relay.lane) : "",
      relay.qualifier ?? "",
      "",
      "",
      "",
      relayLegsText(relay, true),
    ])
  return [header, ...lines, ...relayLines]
}
