import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { addDaysIso, todayIso } from "@/lib/data/training-plan/plan-builder-model"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Athlete availability: "I am injured, sick or away from this day until that day".
 * Planned sessions inside a period are excused (they do not count as missed, see adherence.ts).
 *
 * One API for both sides:
 * - the athlete, for themselves: getMyAvailability, setMyAvailability, endMyAvailability
 * - a coach (own teams) or club admin (own club), for an athlete:
 *   listAthleteAvailability, setAthleteAvailability, endAthleteAvailability
 *
 * Writes go through the database functions set_athlete_availability() and end_athlete_availability()
 * (supabase/migrations/20261008090000_session_skip_availability_extra.sql), which check who is
 * asking, write an audit event and tell the other side. Mock mode keeps the same shape in localStorage.
 */

export type AvailabilityKind = "injured" | "sick" | "away"

export type AthleteAvailability = {
  id: string
  athleteId: string
  kind: AvailabilityKind
  /** First day unavailable, yyyy-mm-dd. */
  startsOn: string
  /** Last day unavailable. Null means until further notice. */
  endsOn: string | null
  note: string | null
  /** "athlete", "coach" or "club-admin": who set it. */
  createdByRole: string | null
  /** Set when someone ended it by hand. */
  endedAt: string | null
}

export type AvailabilityInput = {
  kind: AvailabilityKind
  startsOn: string
  endsOn: string | null
  note: string | null
}

export const AVAILABILITY_KINDS: Array<{ value: AvailabilityKind; label: string }> = [
  { value: "injured", label: "Injured" },
  { value: "sick", label: "Sick" },
  { value: "away", label: "Away" },
]

export const AVAILABILITY_CHANGED_EVENT = "pacelab:availability-changed"
/** The signed-in athlete of mock mode (Marcus Johnson, the same id session-mock.ts uses). */
const MOCK_SELF_ATHLETE_ID = "a1"
const MOCK_STORAGE_KEY = "pacelab:athlete-availability:v1"

/** True when `day` falls inside the period. A period cancelled before it began covers nothing. */
export function availabilityCovers(period: Pick<AthleteAvailability, "startsOn" | "endsOn">, day: string) {
  const date = day.slice(0, 10)
  return date >= period.startsOn && (period.endsOn === null || date <= period.endsOn)
}

/** Still running or still to come: not ended by hand and not over yet. */
export function isAvailabilityOpen(period: AthleteAvailability, today: string = todayIso()) {
  return period.endedAt === null && (period.endsOn === null || period.endsOn >= today)
}

/** The period that applies right now, else the next one coming up, else null. */
export function currentAvailability(periods: AthleteAvailability[], today: string = todayIso()): AthleteAvailability | null {
  const open = periods.filter((period) => isAvailabilityOpen(period, today)).sort((left, right) => left.startsOn.localeCompare(right.startsOn))
  return open.find((period) => availabilityCovers(period, today)) ?? open[0] ?? null
}

function shortDay(dateIso: string) {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })
}

/** "injured until further notice", "away until 12 Oct", "sick from 10 Oct to 12 Oct". Lower case, for use in a sentence. */
export function describeAvailability(period: Pick<AthleteAvailability, "kind" | "startsOn" | "endsOn">, today: string = todayIso()) {
  const started = period.startsOn <= today
  if (started) return period.endsOn ? `${period.kind} until ${shortDay(period.endsOn)}` : `${period.kind} until further notice`
  return period.endsOn ? `${period.kind} from ${shortDay(period.startsOn)} to ${shortDay(period.endsOn)}` : `${period.kind} from ${shortDay(period.startsOn)}`
}

function announceChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(AVAILABILITY_CHANGED_EVENT))
}

function validate(input: AvailabilityInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn)) return "Choose the first day."
  if (input.endsOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn)) return "Choose the last day, or leave it empty."
  if (input.endsOn !== null && input.endsOn < input.startsOn) return "The last day cannot be before the first day."
  return null
}

/* Mock mode ------------------------------------------------------------------------------ */

function readMock(): AthleteAvailability[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(MOCK_STORAGE_KEY))
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(parsed) ? (parsed as AthleteAvailability[]) : []
  } catch {
    return []
  }
}

function writeMock(periods: AthleteAvailability[]) {
  window.localStorage.setItem(tenantStorageKey(MOCK_STORAGE_KEY), JSON.stringify(periods))
}

/** Mock mode, read without a promise: session-mock.ts uses it to mark excused days. */
export function readMockAvailability(athleteId: string = MOCK_SELF_ATHLETE_ID): AthleteAvailability[] {
  return readMock().filter((period) => period.athleteId === athleteId)
}

function setMock(athleteId: string, input: AvailabilityInput, role: string): Result<AthleteAvailability> {
  try {
    const dayBefore = addDaysIso(input.startsOn, -1)
    const now = new Date().toISOString()
    // The same rule as the database: an open period the new one overlaps is closed first.
    const periods = readMock().map((period) => {
      const overlaps =
        period.athleteId === athleteId &&
        period.endedAt === null &&
        (period.endsOn === null || period.endsOn >= input.startsOn) &&
        (input.endsOn === null || period.startsOn <= input.endsOn)
      if (!overlaps) return period
      const trimmed = period.endsOn === null || period.endsOn > dayBefore ? dayBefore : period.endsOn
      return { ...period, endedAt: now, endsOn: trimmed < addDaysIso(period.startsOn, -1) ? addDaysIso(period.startsOn, -1) : trimmed }
    })
    const created: AthleteAvailability = {
      id: `availability-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      athleteId,
      kind: input.kind,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      note: input.note?.trim().slice(0, 280) || null,
      createdByRole: role,
      endedAt: null,
    }
    writeMock([...periods, created])
    announceChange()
    return ok(created)
  } catch {
    return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
  }
}

function endMock(id: string, lastDay: string): Result<null> {
  try {
    writeMock(
      readMock().map((period) => {
        if (period.id !== id || period.endedAt !== null) return period
        const capped = period.endsOn !== null && period.endsOn < lastDay ? period.endsOn : lastDay
        const floor = addDaysIso(period.startsOn, -1)
        return { ...period, endedAt: new Date().toISOString(), endsOn: capped < floor ? floor : capped }
      }),
    )
    announceChange()
    return ok(null)
  } catch {
    return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
  }
}

/* Supabase ------------------------------------------------------------------------------- */

const COLUMNS = "id, athlete_id, kind, starts_on, ends_on, note, created_by_role, ended_at"

type Row = {
  id: string
  athlete_id: string
  kind: AvailabilityKind
  starts_on: string
  ends_on: string | null
  note: string | null
  created_by_role: string | null
  ended_at: string | null
}

function mapRow(row: Row): AthleteAvailability {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    kind: row.kind,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    note: row.note,
    createdByRole: row.created_by_role,
    endedAt: row.ended_at,
  }
}

async function setRemote(athleteId: string | null, input: AvailabilityInput): Promise<Result<AthleteAvailability>> {
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const { data: id, error } = await client.rpc("set_athlete_availability", {
      p_kind: input.kind,
      p_starts_on: input.startsOn,
      p_ends_on: input.endsOn,
      p_note: input.note?.trim() || null,
      p_athlete_id: athleteId,
    })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    const { data: row, error: rowError } = await client.from("athlete_availability").select(COLUMNS).eq("id", id as string).maybeSingle()
    if (rowError) return { ok: false, error: mapPostgrestError(rowError) }
    if (!row) return err("NOT_FOUND", "Saved, but the period could not be read back. Reload to see it.")
    announceChange()
    return ok(mapRow(row as Row))
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

async function endRemote(id: string, lastDay: string): Promise<Result<null>> {
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const { error } = await client.rpc("end_athlete_availability", { p_availability_id: id, p_last_day: lastDay })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    announceChange()
    return ok(null)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/* The athlete, for themselves ------------------------------------------------------------ */

/** The signed-in athlete's periods from the last few months on, oldest first. */
export async function getMyAvailability(): Promise<Result<AthleteAvailability[]>> {
  if (getBackendMode() !== "supabase") return ok(readMockAvailability())
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const { data: authSession } = await client.auth.getSession()
    const userId = authSession.session?.user.id
    if (!userId) return err("UNAUTHORIZED", "You are signed out. Sign in again.")
    const { data: athlete, error: athleteError } = await client.from("athletes").select("id").eq("user_id", userId).maybeSingle()
    if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }
    if (!athlete) return ok([])
    return await listAthleteAvailability([athlete.id as string])
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

export async function setMyAvailability(input: AvailabilityInput): Promise<Result<AthleteAvailability>> {
  const problem = validate(input)
  if (problem) return err("VALIDATION", problem)
  if (getBackendMode() !== "supabase") return setMock(MOCK_SELF_ATHLETE_ID, input, "athlete")
  return setRemote(null, input)
}

/** "I'm back". `lastDay` is the last day off; it defaults to yesterday, so today counts again. */
export async function endMyAvailability(id: string, lastDay: string = addDaysIso(todayIso(), -1)): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") return endMock(id, lastDay)
  return endRemote(id, lastDay)
}

/* A coach or club admin, for an athlete ---------------------------------------------------- */

/**
 * Periods of the given athletes that end on or after `from` (default: 90 days ago), oldest first.
 * The database only returns athletes the caller may see (own teams for a coach, the club for a club admin).
 */
export async function listAthleteAvailability(athleteIds: string[], options?: { from?: string }): Promise<Result<AthleteAvailability[]>> {
  if (athleteIds.length === 0) return ok([])
  const from = options?.from ?? addDaysIso(todayIso(), -90)
  if (getBackendMode() !== "supabase") {
    return ok(readMock().filter((period) => athleteIds.includes(period.athleteId) && (period.endsOn === null || period.endsOn >= from)))
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const rows: AthleteAvailability[] = []
    for (let index = 0; index < athleteIds.length; index += 200) {
      const { data, error } = await client
        .from("athlete_availability")
        .select(COLUMNS)
        .in("athlete_id", athleteIds.slice(index, index + 200))
        .or(`ends_on.is.null,ends_on.gte.${from}`)
        .order("starts_on", { ascending: true })
        .limit(2000)
      if (error) return { ok: false, error: mapPostgrestError(error) }
      rows.push(...((data as Row[] | null) ?? []).map(mapRow))
    }
    return ok(rows)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** Marks an athlete unavailable. Refused by the database unless the caller coaches the athlete's team or is the club admin. */
export async function setAthleteAvailability(athleteId: string, input: AvailabilityInput): Promise<Result<AthleteAvailability>> {
  const problem = validate(input)
  if (problem) return err("VALIDATION", problem)
  if (getBackendMode() !== "supabase") return setMock(athleteId, input, "coach")
  return setRemote(athleteId, input)
}

/** Ends an athlete's period. `lastDay` defaults to yesterday. Same people as setAthleteAvailability. */
export async function endAthleteAvailability(id: string, lastDay: string = addDaysIso(todayIso(), -1)): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") return endMock(id, lastDay)
  return endRemote(id, lastDay)
}
