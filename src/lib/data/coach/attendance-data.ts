import { listAthleteAvailability, type AthleteAvailability } from "@/lib/data/athlete/availability-data"
import { listMockCoachEnteredSessions } from "@/lib/data/coach/athlete-log-data"
import {
  attendanceInWindow,
  attendanceRate,
  cleanAttendanceReason,
  isAttendanceStatus,
  unavailableOn,
  type AttendanceRate,
  type AttendanceRecord,
  type AttendanceStatus,
} from "@/lib/data/coach/attendance"
import { loadMockRoster, mergeMockAthletes, mockSessionIdentity } from "@/lib/data/coach/roster-mock"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { loadMockSessionDay } from "@/lib/data/session/session-mock"
import type { SessionStatus, SkipReason } from "@/lib/data/session/types"
import { addDaysIso, todayIso } from "@/lib/data/training-plan/plan-builder-model"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Attendance (public.athlete_attendance, 20261012100000): one mark per team, athlete and day.
 * Coaches of the team and club admins take it; the athlete reads their own and writes nothing.
 * The rules (rate, default for an unavailable athlete) live in attendance.ts.
 * Mock mode keeps the marks in this browser.
 */

export const ATTENDANCE_CHANGED_EVENT = "pacelab:attendance-changed"
/** The window every attendance rate in the app is worked out over. */
export const ATTENDANCE_WINDOW_DAYS = 28

export type AttendanceDayRow = {
  athleteId: string
  name: string
  hasLogin: boolean
  /** The period that makes them unavailable on this day (injured, sick, away), or null. */
  period: AthleteAvailability | null
  /** The saved mark. Null until the coach takes it. */
  record: AttendanceRecord | null
  /** Their planned session of this day, when there is one. */
  session: { id: string; status: SessionStatus; skipReason: SkipReason | null } | null
}

export type TeamAttendanceDay = {
  team: { id: string; name: string }
  date: string
  /** The planned session most of the team has that day. Null on a day with nothing planned. */
  sessionTitle: string | null
  rows: AttendanceDayRow[]
}

export type AttendanceMarkInput = {
  teamId: string
  athleteId: string
  date: string
  status: AttendanceStatus
  reason: string | null
  sessionId: string | null
}

function validDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ATTENDANCE_CHANGED_EVENT))
}

export function attendanceWindow(today: string = todayIso()) {
  return { from: addDaysIso(today, -(ATTENDANCE_WINDOW_DAYS - 1)), to: today }
}

/* Mock mode ------------------------------------------------------------------------------------- */

const MOCK_KEY = "pacelab:attendance:v1"
/** The signed-in athlete of mock mode (the same id session-mock.ts uses). */
const MOCK_SELF_ATHLETE_ID = "a1"
const STORAGE_BLOCKED = "Could not save in this browser. Storage may be full or blocked."

function readMock(): AttendanceRecord[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(MOCK_KEY)) ?? "[]") as unknown
    return Array.isArray(parsed) ? (parsed as AttendanceRecord[]).filter((record) => record && isAttendanceStatus(record.status)) : []
  } catch {
    return []
  }
}

function mockIsStaff() {
  const role = mockSessionIdentity().role
  return role === "coach" || role === "club-admin"
}

function mockSessionOf(athleteId: string, date: string): AttendanceDayRow["session"] {
  const day = loadMockSessionDay(date)
  if (!day.ok || !day.data.session) return null
  const id = day.data.session.id
  if (athleteId === MOCK_SELF_ATHLETE_ID) return { id, status: day.data.session.status, skipReason: day.data.session.skipReason }
  const entered = listMockCoachEnteredSessions(athleteId).find((session) => session.date === date)
  return { id, status: entered?.status ?? "scheduled", skipReason: null }
}

async function mockTeamDay(teamId: string, date: string): Promise<Result<TeamAttendanceDay>> {
  if (!mockIsStaff()) return err("FORBIDDEN", "Only coaches and club admins can take attendance.")
  const module = await import("@/lib/mock-data")
  const team = module.mockTeams.find((item) => item.id === teamId)
  if (!team) return err("NOT_FOUND", "Team not found.")
  const athletes = mergeMockAthletes(module.mockAthletes, loadMockRoster()).filter((athlete) => athlete.teamId === teamId)
  const availability = await listAthleteAvailability(athletes.map((athlete) => athlete.id), { from: date })
  const periods = availability.ok ? availability.data : []
  const records = readMock().filter((record) => record.teamId === teamId && record.date === date)
  const planned = loadMockSessionDay(date)
  return ok({
    team: { id: team.id, name: team.name },
    date,
    sessionTitle: planned.ok ? (planned.data.session?.title ?? null) : null,
    rows: athletes
      .map((athlete) => ({
        athleteId: athlete.id,
        name: athlete.name,
        hasLogin: athlete.hasLogin,
        period: unavailableOn(periods.filter((period) => period.athleteId === athlete.id), date),
        record: records.find((record) => record.athleteId === athlete.id) ?? null,
        session: mockSessionOf(athlete.id, date),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  })
}

/* Supabase -------------------------------------------------------------------------------------- */

const COLUMNS = "id, team_id, athlete_id, attendance_date, session_id, status, reason"

type Row = { id: string; team_id: string; athlete_id: string; attendance_date: string; session_id: string | null; status: string; reason: string | null }

function fromRow(row: Row): AttendanceRecord {
  return {
    id: row.id,
    teamId: row.team_id,
    athleteId: row.athlete_id,
    date: row.attendance_date,
    sessionId: row.session_id,
    status: isAttendanceStatus(row.status) ? row.status : "present",
    reason: row.reason,
  }
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
}

/* Staff ----------------------------------------------------------------------------------------- */

/** The roster of a team for one day: who is unavailable, who has a session, and the marks taken so far. */
export async function getTeamAttendanceDay(teamId: string, date: string): Promise<Result<TeamAttendanceDay>> {
  if (!validDay(date)) return err("VALIDATION", "Choose a day.")
  if (getBackendMode() !== "supabase") return mockTeamDay(teamId, date)
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const [teamResult, athleteResult] = await Promise.all([
      client.from("teams").select("id, name").eq("id", teamId).maybeSingle(),
      client.from("athletes").select("id, user_id, first_name, last_name").eq("team_id", teamId).eq("is_active", true).order("first_name", { ascending: true }),
    ])
    if (teamResult.error) return { ok: false, error: mapPostgrestError(teamResult.error) }
    if (!teamResult.data) return err("NOT_FOUND", "Team not found.")
    if (athleteResult.error) return { ok: false, error: mapPostgrestError(athleteResult.error) }
    const athletes = (athleteResult.data as Array<{ id: string; user_id: string | null; first_name: string; last_name: string }> | null) ?? []
    const team = { id: teamResult.data.id as string, name: teamResult.data.name as string }
    if (athletes.length === 0) return ok({ team, date, sessionTitle: null, rows: [] })
    const ids = athletes.map((athlete) => athlete.id)

    const [recordResult, sessionResult, availabilityResult] = await Promise.all([
      client.from("athlete_attendance").select(COLUMNS).eq("team_id", teamId).eq("attendance_date", date).limit(1000),
      client.from("sessions").select("id, athlete_id, title, status, origin, skip_reason").in("athlete_id", ids).eq("scheduled_for", date).limit(2000),
      listAthleteAvailability(ids, { from: date }),
    ])
    if (recordResult.error) return { ok: false, error: mapPostgrestError(recordResult.error) }
    if (sessionResult.error) return { ok: false, error: mapPostgrestError(sessionResult.error) }
    // Without the periods nobody shows as unavailable; the marks can still be taken.
    const periods = availabilityResult.ok ? availabilityResult.data : []
    const records = ((recordResult.data as Row[] | null) ?? []).map(fromRow)
    type SessionRow = { id: string; athlete_id: string; title: string; status: SessionStatus; origin: string | null; skip_reason: SkipReason | null }
    const planned = ((sessionResult.data as SessionRow[] | null) ?? []).filter((row) => (row.origin ?? "plan") === "plan")

    return ok({
      team,
      date,
      sessionTitle: mostCommon(planned.map((row) => row.title)),
      rows: athletes
        .map((athlete) => {
          const session = planned.find((row) => row.athlete_id === athlete.id) ?? null
          return {
            athleteId: athlete.id,
            name: `${athlete.first_name} ${athlete.last_name}`.trim(),
            hasLogin: athlete.user_id !== null,
            period: unavailableOn(periods.filter((period) => period.athleteId === athlete.id), date),
            record: records.find((record) => record.athleteId === athlete.id) ?? null,
            session: session ? { id: session.id, status: session.status, skipReason: session.skip_reason } : null,
          }
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    })
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** Takes or changes one mark. One row per team, athlete and day: saving again overwrites it. */
export async function saveAttendanceMark(input: AttendanceMarkInput): Promise<Result<AttendanceRecord>> {
  if (!validDay(input.date)) return err("VALIDATION", "Choose a day.")
  if (input.date > todayIso()) return err("VALIDATION", "Attendance cannot be taken for a day that has not come yet.")
  const reason = cleanAttendanceReason(input.reason)
  if (getBackendMode() !== "supabase") {
    if (!mockIsStaff()) return err("FORBIDDEN", "Only coaches and club admins can take attendance.")
    const all = readMock()
    const existing = all.find((record) => record.teamId === input.teamId && record.athleteId === input.athleteId && record.date === input.date)
    const next: AttendanceRecord = {
      id: existing?.id ?? `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      teamId: input.teamId,
      athleteId: input.athleteId,
      date: input.date,
      sessionId: input.sessionId,
      status: input.status,
      reason,
    }
    try {
      window.localStorage.setItem(tenantStorageKey(MOCK_KEY), JSON.stringify([...all.filter((record) => record !== existing), next]))
    } catch {
      return err("UNKNOWN", STORAGE_BLOCKED)
    }
    announce()
    return ok(next)
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const { data: team, error: teamError } = await client.from("teams").select("tenant_id").eq("id", input.teamId).maybeSingle()
    if (teamError) return { ok: false, error: mapPostgrestError(teamError) }
    if (!team) return err("NOT_FOUND", "Team not found.")
    const { data, error } = await client
      .from("athlete_attendance")
      .upsert(
        {
          tenant_id: team.tenant_id as string,
          team_id: input.teamId,
          athlete_id: input.athleteId,
          attendance_date: input.date,
          session_id: input.sessionId,
          status: input.status,
          reason,
        },
        { onConflict: "tenant_id,team_id,athlete_id,attendance_date" },
      )
      .select(COLUMNS)
      .single()
    if (error) {
      // Raised by athlete_attendance_normalise with a sentence written for the coach.
      if (error.code === "23514" && !/violates check constraint/i.test(error.message)) return err("VALIDATION", error.message, error)
      return { ok: false, error: mapPostgrestError(error) }
    }
    announce()
    return ok(fromRow(data as Row))
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** Removes a mark taken by mistake: the athlete is back to "not marked" for that day. */
export async function clearAttendanceMark(teamId: string, athleteId: string, date: string): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") {
    if (!mockIsStaff()) return err("FORBIDDEN", "Only coaches and club admins can take attendance.")
    try {
      window.localStorage.setItem(
        tenantStorageKey(MOCK_KEY),
        JSON.stringify(readMock().filter((record) => !(record.teamId === teamId && record.athleteId === athleteId && record.date === date))),
      )
    } catch {
      return err("UNKNOWN", STORAGE_BLOCKED)
    }
    announce()
    return ok(null)
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const { error } = await client.from("athlete_attendance").delete().eq("team_id", teamId).eq("athlete_id", athleteId).eq("attendance_date", date)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    announce()
    return ok(null)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** One athlete's marks, newest first, for the coach's athlete screen. */
export async function listAthleteAttendance(athleteId: string, options?: { from?: string; limit?: number }): Promise<Result<AttendanceRecord[]>> {
  const from = options?.from ?? addDaysIso(todayIso(), -120)
  const limit = options?.limit ?? 200
  if (getBackendMode() !== "supabase") {
    if (!mockIsStaff()) return err("FORBIDDEN", "Only coaches and club admins can see this.")
    return ok(
      readMock()
        .filter((record) => record.athleteId === athleteId && record.date >= from)
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, limit),
    )
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const { data, error } = await client
      .from("athlete_attendance")
      .select(COLUMNS)
      .eq("athlete_id", athleteId)
      .gte("attendance_date", from)
      .order("attendance_date", { ascending: false })
      .limit(limit)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(((data as Row[] | null) ?? []).map(fromRow))
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** The attendance rate of every athlete marked on this team over the last four weeks, by athlete id. */
export async function getTeamAttendanceRates(teamId: string, today: string = todayIso()): Promise<Result<Record<string, AttendanceRate>>> {
  const window = attendanceWindow(today)
  let records: AttendanceRecord[]
  if (getBackendMode() !== "supabase") {
    records = mockIsStaff() ? readMock().filter((record) => record.teamId === teamId) : []
  } else {
    const client = getBrowserSupabaseClient()
    if (!client) return err("UNKNOWN", "Supabase client is not configured.")
    try {
      const { data, error } = await client
        .from("athlete_attendance")
        .select(COLUMNS)
        .eq("team_id", teamId)
        .gte("attendance_date", window.from)
        .lte("attendance_date", window.to)
        .limit(5000)
      if (error) return { ok: false, error: mapPostgrestError(error) }
      records = ((data as Row[] | null) ?? []).map(fromRow)
    } catch (cause) {
      return err("UNKNOWN", "Could not reach the server.", cause)
    }
  }
  const byAthlete = new Map<string, AttendanceRecord[]>()
  for (const record of attendanceInWindow(records, window.from, window.to)) byAthlete.set(record.athleteId, [...(byAthlete.get(record.athleteId) ?? []), record])
  return ok(Object.fromEntries([...byAthlete.entries()].map(([athleteId, list]) => [athleteId, attendanceRate(list)])))
}

/* The athlete ------------------------------------------------------------------------------------- */

/** The signed-in athlete's own marks between two days, newest first. Read only: athletes cannot write attendance. */
export async function getMyAttendance(from: string, to: string): Promise<Result<AttendanceRecord[]>> {
  if (getBackendMode() !== "supabase") {
    return ok(
      readMock()
        .filter((record) => record.athleteId === MOCK_SELF_ATHLETE_ID && record.date >= from && record.date <= to)
        .sort((left, right) => right.date.localeCompare(left.date)),
    )
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const { data: authSession } = await client.auth.getSession()
    const userId = authSession.session?.user.id
    if (!userId) return err("UNAUTHORIZED", "You are signed out.")
    const { data: athlete, error: athleteError } = await client.from("athletes").select("id").eq("user_id", userId).maybeSingle()
    if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }
    if (!athlete) return ok([])
    const { data, error } = await client
      .from("athlete_attendance")
      .select(COLUMNS)
      .eq("athlete_id", athlete.id as string)
      .gte("attendance_date", from)
      .lte("attendance_date", to)
      .order("attendance_date", { ascending: false })
      .limit(400)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(((data as Row[] | null) ?? []).map(fromRow))
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}
