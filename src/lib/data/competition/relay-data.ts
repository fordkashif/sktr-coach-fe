import type { SupabaseClient } from "@supabase/supabase-js"
import type { Competition, RelayEntry, RelayInput, RelayLeg } from "@/lib/data/competition/types"
import { RELAY_EVENTS, sameRelaySlot, validateRelayInput } from "@/lib/data/competition/relay-logic"
import { compareValueFor, findResultEvent, formatMark, type Qualifier, type ResultEnvironment, type ResultRound, type Timing } from "@/lib/data/pr/marks"
import { loadMockResultsState, MOCK_ROSTER_SELF_ID, mockId, updateMockResultsState } from "@/lib/data/pr/mock-results-store"
import { getCurrentAthleteIdentity, localToday } from "@/lib/data/pr/results-data"
import { isAccessPausedError } from "@/lib/access-paused"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * Relays: a relay team at a competition, its four legs and, once it is run, the time.
 *
 * A relay is not a row of an athlete's results history, so it never becomes anyone's individual
 * record. Each of the four athletes sees the relays they ran in (with the names of that relay's
 * legs and nobody else's); the staff of the team see and, as lead coach, coach or club admin,
 * enter them. The database decides who sees and writes what
 * (20261016100000_result_detail_splits_attempts_relays_rounds.sql: get_relay_entries(),
 * save_relay_entry()). Every function works in mock mode too, on the demo kept in the browser.
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

type RelayRow = {
  id: string
  competition_id: string | null
  competition_name: string | null
  team_id: string | null
  team_name: string | null
  team_label: string
  event_key: string
  event_label: string
  round: ResultRound | null
  heat_number: number | null
  lane: number | null
  place: number | null
  qualifier: Qualifier | null
  mark_value: number | string | null
  compare_value: number | string | null
  mark_display: string | null
  timing: Timing | null
  result_date: string
  environment: ResultEnvironment
  location: string | null
  notes: string | null
  created_at: string
  can_manage: boolean
  legs: Array<{ leg: number; athlete_id: string | null; name: string; split: number | string | null }>
}

function mapRelayRow(row: RelayRow): RelayEntry {
  return {
    id: row.id,
    competitionId: row.competition_id,
    competitionName: row.competition_name,
    teamId: row.team_id,
    teamName: row.team_name,
    teamLabel: row.team_label,
    eventKey: row.event_key,
    eventLabel: row.event_label,
    round: row.round,
    heat: row.heat_number,
    lane: row.lane,
    place: row.place,
    qualifier: row.qualifier,
    value: row.mark_value === null ? null : Number(row.mark_value),
    compareValue: row.compare_value === null ? null : Number(row.compare_value),
    display: row.mark_display,
    timing: row.timing,
    date: row.result_date.slice(0, 10),
    environment: row.environment,
    location: row.location,
    notes: row.notes,
    createdAt: row.created_at,
    canManage: Boolean(row.can_manage),
    legs: (row.legs ?? [])
      .map((leg): RelayLeg => ({ leg: leg.leg, athleteId: leg.athlete_id, name: leg.name, split: leg.split === null ? null : Number(leg.split) }))
      .sort((a, b) => a.leg - b.leg),
  }
}

function newestFirst(relays: RelayEntry[]): RelayEntry[] {
  return [...relays].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

async function readRelays(client: SupabaseClient, params: { competitionId?: string | null; athleteId?: string | null }): Promise<Result<RelayEntry[]>> {
  const { data, error } = await client.rpc("get_relay_entries", { p_competition_id: params.competitionId ?? null, p_athlete_id: params.athleteId ?? null })
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(((data as RelayRow[] | null) ?? []).map(mapRelayRow))
}

/* ---------- Mock mode ---------------------------------------------------------------------------- */

async function mockNames(): Promise<{ athletes: Map<string, { name: string; teamId: string }>; teams: Map<string, string> }> {
  const { mockAthletes, mockTeams } = await import("@/lib/mock-data")
  return {
    athletes: new Map(mockAthletes.map((athlete) => [athlete.id, { name: athlete.name, teamId: athlete.teamId }])),
    teams: new Map(mockTeams.map((team) => [team.id, team.name])),
  }
}

/** The stored demo relays with today's names of the athletes, teams and competitions. */
async function mockRelays(canManage: boolean): Promise<RelayEntry[]> {
  const state = loadMockResultsState()
  const names = await mockNames()
  return newestFirst(
    state.relays.map((relay) => ({
      ...relay,
      competitionName: state.competitions.find((competition) => competition.id === relay.competitionId)?.name ?? relay.competitionName,
      teamName: relay.teamId ? (names.teams.get(relay.teamId) ?? relay.teamName) : relay.teamName,
      canManage,
      legs: relay.legs.map((leg) => ({ ...leg, name: leg.athleteId ? (names.athletes.get(leg.athleteId)?.name ?? leg.name) : "Former member" })),
    })),
  )
}

/* ---------- Reading ------------------------------------------------------------------------------- */

/**
 * The relays a coach or club admin can see: those of the teams they are on and those an athlete of
 * their teams ran in. Pass a competition id for one meet, a team id for one team's relays.
 */
export async function getRelaysForStaff(params?: { competitionId?: string | null; teamId?: string | null }): Promise<Result<RelayEntry[]>> {
  const keep = (relays: RelayEntry[]) =>
    relays.filter((relay) => (!params?.competitionId || relay.competitionId === params.competitionId) && (!params?.teamId || relay.teamId === params.teamId))
  if (isMock()) return ok(keep(await mockRelays(true)))
  const clientResult = requireSupabaseClient("getRelaysForStaff")
  if (!clientResult.ok) return clientResult
  const result = await readRelays(clientResult.client, { competitionId: params?.competitionId })
  return result.ok ? ok(keep(result.data)) : result
}

export type AthleteRelays = {
  /** The relays the athlete ran a leg of, newest first. */
  relays: RelayEntry[]
  /** The athlete's own id, to find their leg. */
  athleteId: string | null
}

/** The relays the signed-in athlete ran in, with the names of the other legs of those relays only. */
export async function getRelaysForCurrentAthlete(params?: { competitionId?: string | null }): Promise<Result<AthleteRelays>> {
  if (isMock()) {
    const mine = (await mockRelays(false)).filter(
      (relay) => relay.legs.some((leg) => leg.athleteId === MOCK_ROSTER_SELF_ID) && (!params?.competitionId || relay.competitionId === params.competitionId),
    )
    return ok({ relays: mine, athleteId: MOCK_ROSTER_SELF_ID })
  }
  const clientResult = requireSupabaseClient("getRelaysForCurrentAthlete")
  if (!clientResult.ok) return clientResult
  const identity = await getCurrentAthleteIdentity(clientResult.client)
  if (!identity.ok) return identity
  const result = await readRelays(clientResult.client, { competitionId: params?.competitionId, athleteId: identity.data.athleteId })
  if (!result.ok) return result
  return ok({ relays: result.data, athleteId: identity.data.athleteId })
}

/** The relays one athlete ran in. For staff looking at an athlete they manage. */
export async function getRelaysForAthlete(athleteId: string): Promise<Result<RelayEntry[]>> {
  if (isMock()) return ok((await mockRelays(true)).filter((relay) => relay.legs.some((leg) => leg.athleteId === athleteId)))
  const clientResult = requireSupabaseClient("getRelaysForAthlete")
  if (!clientResult.ok) return clientResult
  return readRelays(clientResult.client, { athleteId })
}

/* ---------- Writing -------------------------------------------------------------------------------- */

const SLOT_TAKEN_MESSAGE = "This relay team already has a result for that round. Change that one instead of adding another."

/**
 * Add a relay team to a competition, or change one: its four legs in running order, optional leg
 * splits and, once it is run, the time. Lead coaches, coaches and club admins only.
 */
export async function saveRelayEntry(
  input: RelayInput,
  competition: Pick<Competition, "id" | "name" | "startDate" | "endDate" | "environment">,
): Promise<Result<RelayEntry>> {
  const existingLegs = input.id && isMock() ? (loadMockResultsState().relays.find((relay) => relay.id === input.id)?.legs ?? []) : []
  // A leg may stay empty only when it already is (the athlete's data was deleted). The database checks the same.
  const emptyLegs = input.id ? (isMock() ? existingLegs.filter((leg) => !leg.athleteId).map((leg) => leg.leg) : input.legs.filter((leg) => !leg.athleteId).map((leg) => leg.leg)) : []
  const invalid = validateRelayInput(input, { today: localToday(), startDate: competition.startDate, endDate: competition.endDate, emptyLegs })
  if (invalid) return err("VALIDATION", invalid)

  const event = findResultEvent(input.eventKey)
  const value = input.value ?? null
  const timing: Timing | null = value === null ? null : (input.timing ?? "electronic")
  const date = input.date || competition.startDate

  if (isMock()) {
    const names = await mockNames()
    const state = loadMockResultsState()
    const before = input.id ? (state.relays.find((relay) => relay.id === input.id) ?? null) : null
    if (input.id && !before) return err("NOT_FOUND", "This relay no longer exists.")
    const teamName = names.teams.get(input.teamId) ?? "Team"
    const relay: RelayEntry = {
      id: before?.id ?? mockId("relay"),
      competitionId: before ? before.competitionId : competition.id,
      competitionName: competition.name,
      teamId: input.teamId,
      teamName,
      teamLabel: (input.teamLabel ?? "").replace(/\s+/g, " ").trim() || teamName,
      eventKey: input.eventKey,
      eventLabel: event?.name ?? "Relay",
      round: input.round ?? null,
      heat: input.heat ?? null,
      lane: input.lane ?? null,
      place: value === null ? null : (input.place ?? null),
      qualifier: value === null ? null : (input.qualifier ?? null),
      value: value === null ? null : Math.round(value * 100) / 100,
      compareValue: value === null ? null : compareValueFor(value, timing, event),
      display: value === null ? null : formatMark(value, "s", timing),
      timing,
      date,
      environment: competition.environment,
      location: competition.name,
      notes: input.notes?.trim() || null,
      createdAt: before?.createdAt ?? new Date().toISOString(),
      canManage: true,
      legs: [...input.legs]
        .sort((a, b) => a.leg - b.leg)
        .map((leg) => ({
          leg: leg.leg,
          athleteId: leg.athleteId,
          name: leg.athleteId ? (names.athletes.get(leg.athleteId)?.name ?? "Unnamed athlete") : "Former member",
          split: leg.split === null || leg.split === undefined ? null : Math.round(leg.split * 100) / 100,
        })),
    }
    if (state.relays.some((other) => other.id !== relay.id && sameRelaySlot(other, relay))) return err("CONFLICT", SLOT_TAKEN_MESSAGE)
    updateMockResultsState((current) => ({
      ...current,
      relays: before ? current.relays.map((item) => (item.id === relay.id ? relay : item)) : [relay, ...current.relays],
    }))
    return ok(relay)
  }

  const clientResult = requireSupabaseClient("saveRelayEntry")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("save_relay_entry", {
    p_relay: {
      id: input.id ?? null,
      competition_id: competition.id,
      event_key: input.eventKey,
      team_id: input.teamId,
      team_label: input.teamLabel?.trim() || null,
      legs: input.legs.map((leg) => ({ leg: leg.leg, athlete_id: leg.athleteId, split: leg.split ?? null })),
      mark: value,
      timing,
      round: input.round ?? null,
      heat_number: input.heat ?? null,
      lane: input.lane ?? null,
      place: value === null ? null : (input.place ?? null),
      qualifier: value === null ? null : (input.qualifier ?? null),
      result_date: date,
      notes: input.notes?.trim() || null,
    },
  })
  if (error) {
    const mapped = mapPostgrestError(error)
    if (mapped.code === "CONFLICT") return { ok: false, error: { ...mapped, message: SLOT_TAKEN_MESSAGE } }
    // save_relay_entry words its own refusals for the person ("You can only name athletes you coach in a relay."): pass them on.
    return { ok: false, error: isAccessPausedError(error) ? mapped : { ...mapped, message: error.message || mapped.message } }
  }
  const saved = await readRelays(clientResult.client, { competitionId: competition.id })
  if (!saved.ok) return saved
  const relay = saved.data.find((item) => item.id === (data as string))
  return relay ? ok(relay) : err("NOT_FOUND", "The relay was saved but could not be read back. Reload to see it.")
}

/** Delete a relay team and its legs. A coach of the relay's team or a club admin. */
export async function deleteRelayEntry(relayId: string): Promise<Result<{ relayId: string }>> {
  if (isMock()) {
    updateMockResultsState((state) => ({ ...state, relays: state.relays.filter((relay) => relay.id !== relayId) }))
    return ok({ relayId })
  }
  const clientResult = requireSupabaseClient("deleteRelayEntry")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.from("relay_entries").delete().eq("id", relayId).select("id")
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) return err("FORBIDDEN", "You cannot delete this relay. A coach of its team or a club admin can.")
  return ok({ relayId })
}

export { RELAY_EVENTS }
