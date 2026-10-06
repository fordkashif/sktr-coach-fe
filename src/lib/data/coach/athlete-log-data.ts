import { getCurrentAccount } from "@/lib/data/account/account-data"
import { loadMockRoster, mergeMockAthletes, mockSessionIdentity } from "@/lib/data/coach/roster-mock"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { cleanEffort, cleanNote } from "@/lib/data/session/log-assist"
import { getSessionLoggedBy, recordMockLoggedBy, type SessionLoggedBy } from "@/lib/data/session/logged-by-data"
import { loadSessionBody, SESSION_COLUMNS, type SessionRecord } from "@/lib/data/session/session-log-data"
import { loadMockSessionDay, loggedResults, MOCK_ATHLETE_ID, saveMockCompletion, saveMockRowLogs, type MockLoggedSession } from "@/lib/data/session/session-mock"
import type { AthleteSession, LoggableBlock, SessionRowLog } from "@/lib/data/session/types"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * A coach or club admin entering a session FOR an athlete (a young athlete, or after a group
 * session). The sets and the completion are the athlete's own rows, stamped with who typed them
 * (session_row_logs.logged_by_user_id, session_completions.completed_by_user_id), so the athlete
 * sees "Logged by Coach ..." and can still correct them.
 *
 * Supabase: the database decides who may do this (20261012100000): the coaches of the athlete's
 * team and club admins. Mock: the demo athlete (Marcus, a1) shares the store his own log screen
 * reads; other demo athletes get their own store in this browser, on the demo plan of the day.
 */

export type CoachLogAthlete = { id: string; name: string; teamId: string | null; hasLogin: boolean }

export type CoachLogDay = {
  athlete: CoachLogAthlete
  date: string
  /** The session planned for the athlete that day. Null when nothing is planned. */
  session: AthleteSession | null
  /** Set when a staff member has entered (part of) this session already. */
  loggedBy: SessionLoggedBy | null
}

export type CoachCompletionInput = { completionDate: string; rpe: number | null; comment: string | null; durationMinutes?: number | null }

/* Mock mode ------------------------------------------------------------------------------------- */

const MOCK_KEY = "pacelab:coach-entered-sessions:v1"
const STORAGE_BLOCKED = "Could not save in this browser. Storage may be full or blocked."

type MockEntered = { athleteId: string; date: string; title: string; blocks: LoggableBlock[]; logs: SessionRowLog[]; completedOn: string | null; rpe: number | null; comment: string | null; durationMinutes?: number | null }

function readMock(): Record<string, MockEntered> {
  if (typeof window === "undefined") return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(MOCK_KEY)) ?? "{}") as Record<string, MockEntered>
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function mockDateOf(sessionId: string) {
  return sessionId.startsWith("mock:") ? sessionId.slice(5) : ""
}

async function mockAthlete(athleteId: string): Promise<CoachLogAthlete | null> {
  const role = mockSessionIdentity().role
  if (role !== "coach" && role !== "club-admin") return null
  const module = await import("@/lib/mock-data")
  const athlete = mergeMockAthletes(module.mockAthletes, loadMockRoster()).find((item) => item.id === athleteId)
  return athlete ? { id: athlete.id, name: athlete.name, teamId: athlete.teamId, hasLogin: athlete.hasLogin } : null
}

/** The demo plan's session of the day with this athlete's own entries laid over it. */
function mockSessionFor(athleteId: string, date: string): AthleteSession | null {
  const day = loadMockSessionDay(date)
  const planned = day.ok ? day.data.session : null
  if (athleteId === MOCK_ATHLETE_ID) return planned
  const entered = readMock()[`${athleteId}|${date}`]
  if (!planned && !entered) return null
  const blocks = entered?.blocks ?? planned?.blocks ?? []
  return {
    id: `mock:${date}`,
    title: entered?.title ?? planned?.title ?? "Session",
    status: entered?.completedOn ? "completed" : entered && entered.logs.length > 0 ? "in-progress" : "scheduled",
    scheduledFor: date,
    estimatedDurationMinutes: planned?.estimatedDurationMinutes ?? null,
    coachNote: planned?.coachNote ?? null,
    location: planned?.location ?? null,
    completedOn: entered?.completedOn ?? null,
    overallRpe: entered?.rpe ?? null,
    durationMinutes: entered?.durationMinutes ?? null,
    athleteComment: entered?.comment ?? null,
    origin: "plan",
    skipReason: null,
    skipNote: null,
    blocks,
    logs: entered?.logs ?? [],
  }
}

function updateMockEntered(athleteId: string, sessionId: string, change: (entered: MockEntered) => MockEntered): Result<null> {
  const date = mockDateOf(sessionId)
  const session = mockSessionFor(athleteId, date)
  if (!date || !session) return err("NOT_FOUND", "That session no longer exists.")
  try {
    const all = readMock()
    const key = `${athleteId}|${date}`
    const current: MockEntered = all[key] ?? { athleteId, date, title: session.title, blocks: session.blocks, logs: [], completedOn: null, rpe: null, comment: null }
    window.localStorage.setItem(tenantStorageKey(MOCK_KEY), JSON.stringify({ ...all, [key]: change(current) }))
    return ok(null)
  } catch {
    return err("UNKNOWN", STORAGE_BLOCKED)
  }
}

async function stampMock(athleteId: string, sessionId: string) {
  const account = await getCurrentAccount()
  recordMockLoggedBy(athleteId, sessionId, { name: account.ok ? account.data.displayName : null, role: mockSessionIdentity().role })
}

/** Mock mode: what staff entered for a demo athlete other than Marcus, newest first, for the coach's athlete screen. */
export function listMockCoachEnteredSessions(athleteId: string): MockLoggedSession[] {
  if (athleteId === MOCK_ATHLETE_ID) return []
  return Object.values(readMock())
    .filter((entered) => entered.athleteId === athleteId && (entered.completedOn || entered.logs.length > 0))
    .map((entered) => ({
      id: `mock:${entered.date}`,
      date: entered.date,
      title: entered.title,
      status: entered.completedOn ? ("completed" as const) : ("in-progress" as const),
      origin: "plan" as const,
      skipReason: null,
      skipNote: null,
      completedOn: entered.completedOn,
      results: loggedResults(entered.blocks, entered.logs, entered.rpe, entered.comment),
    }))
    .sort((left, right) => right.date.localeCompare(left.date))
}

/* Supabase -------------------------------------------------------------------------------------- */

async function staffClient() {
  const client = getBrowserSupabaseClient()
  if (!client) return err<never>("UNKNOWN", "Supabase client is not configured.")
  const { data } = await client.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) return err<never>("UNAUTHORIZED", "You are signed out. Sign in again to keep logging.")
  return ok({ client, userId })
}

type AthleteRow = { id: string; tenant_id: string; team_id: string | null; user_id: string | null; first_name: string; last_name: string }

/* Reads and writes ---------------------------------------------------------------------------------- */

/** The athlete's planned session of a day, with what is logged so far, for a coach of their team or a club admin. */
export async function loadAthleteSessionForCoach(athleteId: string, date: string): Promise<Result<CoachLogDay>> {
  if (getBackendMode() !== "supabase") {
    const athlete = await mockAthlete(athleteId)
    if (!athlete) return err("NOT_FOUND", "Athlete not found.")
    const session = mockSessionFor(athleteId, date)
    const loggedBy = session ? await getSessionLoggedBy(session.id, athleteId) : null
    return ok({ athlete, date, session, loggedBy: loggedBy?.ok ? loggedBy.data : null })
  }
  try {
    const context = await staffClient()
    if (!context.ok) return context
    const { client } = context.data
    // Row level security answers only for an athlete on one of the caller's teams (any athlete of the club for a club admin).
    const { data: athleteRow, error: athleteError } = await client
      .from("athletes")
      .select("id, tenant_id, team_id, user_id, first_name, last_name")
      .eq("id", athleteId)
      .maybeSingle()
    if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }
    if (!athleteRow) return err("NOT_FOUND", "Athlete not found.")
    const row = athleteRow as AthleteRow
    const athlete: CoachLogAthlete = { id: row.id, name: `${row.first_name} ${row.last_name}`.trim(), teamId: row.team_id, hasLogin: row.user_id !== null }

    const { data: sessionRows, error: sessionError } = await client
      .from("sessions")
      .select(SESSION_COLUMNS)
      .eq("athlete_id", athleteId)
      .eq("scheduled_for", date)
      .order("created_at", { ascending: true })
    if (sessionError) return { ok: false, error: mapPostgrestError(sessionError) }
    const records = (sessionRows as SessionRecord[] | null) ?? []
    // What the coach planned comes first. A session the athlete added themselves is theirs to log.
    const record = records.find((entry) => entry.origin !== "athlete") ?? null
    if (!record) return ok({ athlete, date, session: null, loggedBy: null })

    const body = await loadSessionBody(client, record)
    if (!body.ok) return body
    const loggedBy = await getSessionLoggedBy(record.id)
    return ok({ athlete, date, session: body.data, loggedBy: loggedBy.ok ? loggedBy.data : null })
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** Saves sets for the athlete. Idempotent: one row per (exercise row, set), overwritten on every save. */
export async function saveAthleteRowLogsForCoach(athleteId: string, sessionId: string, logs: SessionRowLog[]): Promise<Result<null>> {
  if (logs.length === 0) return ok(null)
  if (getBackendMode() !== "supabase") {
    const result =
      athleteId === MOCK_ATHLETE_ID
        ? saveMockRowLogs(sessionId, logs)
        : updateMockEntered(athleteId, sessionId, (entered) => {
            const merged = new Map(entered.logs.map((log) => [`${log.rowId}:${log.setIndex}`, log]))
            for (const log of logs) merged.set(`${log.rowId}:${log.setIndex}`, log)
            return { ...entered, logs: [...merged.values()] }
          })
    if (result.ok) await stampMock(athleteId, sessionId)
    return result
  }
  try {
    const context = await staffClient()
    if (!context.ok) return context
    const { client, userId } = context.data
    const { data: session, error: sessionError } = await client.from("sessions").select("tenant_id").eq("id", sessionId).eq("athlete_id", athleteId).maybeSingle()
    if (sessionError) return { ok: false, error: mapPostgrestError(sessionError) }
    if (!session) return err("NOT_FOUND", "That session no longer exists.")
    const { error } = await client.from("session_row_logs").upsert(
      logs.map((log) => ({
        tenant_id: session.tenant_id as string,
        session_id: sessionId,
        session_block_row_id: log.rowId,
        athlete_id: athleteId,
        set_index: log.setIndex,
        completed: log.completed,
        reps: log.reps,
        load_kg: log.loadKg,
        time_seconds: log.timeSeconds,
        distance_m: log.distanceM,
        mark: log.mark,
        rpe: cleanEffort(log.rpe),
        note: cleanNote(log.note ?? ""),
        // The database stamps this with the caller whatever is sent (stamp_session_row_log_author).
        logged_by_user_id: userId,
      })),
      { onConflict: "session_block_row_id,athlete_id,set_index" },
    )
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(null)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** Marks the athlete's session done, with the effort and a comment. Safe to call again to change either. */
export async function saveAthleteCompletionForCoach(athleteId: string, sessionId: string, input: CoachCompletionInput): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") {
    const result =
      athleteId === MOCK_ATHLETE_ID
        ? saveMockCompletion({ sessionId, ...input })
        : updateMockEntered(athleteId, sessionId, (entered) => ({ ...entered, completedOn: entered.completedOn ?? input.completionDate, rpe: input.rpe, comment: input.comment, ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }) }))
    if (result.ok) await stampMock(athleteId, sessionId)
    return result
  }
  try {
    const context = await staffClient()
    if (!context.ok) return context
    const { client, userId } = context.data
    const { data: existing, error: existingError } = await client.from("session_completions").select("id").eq("session_id", sessionId).eq("athlete_id", athleteId).maybeSingle()
    if (existingError) return { ok: false, error: mapPostgrestError(existingError) }
    if (existing) {
      const { error } = await client.from("session_completions").update({ rpe: input.rpe, athlete_comment: input.comment, ...(input.durationMinutes === undefined ? {} : { duration_minutes: input.durationMinutes }) }).eq("id", existing.id as string)
      if (error) return { ok: false, error: mapPostgrestError(error) }
      return ok(null)
    }
    const { data: session, error: sessionError } = await client.from("sessions").select("tenant_id").eq("id", sessionId).eq("athlete_id", athleteId).maybeSingle()
    if (sessionError) return { ok: false, error: mapPostgrestError(sessionError) }
    if (!session) return err("NOT_FOUND", "That session no longer exists.")
    const { error } = await client.from("session_completions").insert({
      tenant_id: session.tenant_id as string,
      session_id: sessionId,
      athlete_id: athleteId,
      completion_date: input.completionDate,
      completed_by_user_id: userId,
      rpe: input.rpe,
      athlete_comment: input.comment,
      ...(input.durationMinutes === undefined ? {} : { duration_minutes: input.durationMinutes }),
    })
    if (error && error.code !== "23505") return { ok: false, error: mapPostgrestError(error) }
    return ok(null)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}
