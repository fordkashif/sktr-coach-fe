import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { logKindForBlockType, parseSetCount, planBlueprints, type SessionBlueprint } from "@/lib/data/session/session-from-plan"
import { loadMockSessionDay, saveMockCompletion, saveMockRowLogs, weekStartIso } from "@/lib/data/session/session-mock"
import { insertSessionsFromBlueprints } from "@/lib/data/session/session-plan-sync"
import type {
  AthleteSession,
  AthleteSessionDay,
  AthleteWeekDay,
  LogKind,
  LoggableBlock,
  SessionBlockType,
  SessionRowLog,
  SessionStatus,
} from "@/lib/data/session/types"
import { addDaysIso, planEndDate, planFromBuilderState, todayIso } from "@/lib/data/training-plan/plan-builder-model"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * The athlete side of session logging: load a day, save what was done, finish the session.
 * Works the same in mock mode (localStorage) and against Supabase.
 * Callers that need to survive a bad connection go through session-log-sync.ts, not these directly.
 */

const SESSION_COLUMNS =
  "id, athlete_id, title, status, scheduled_for, estimated_duration_minutes, coach_note, completed_at, location, plan_id, plan_week_number, plan_day_index"

type SessionRecord = {
  id: string
  athlete_id: string
  title: string
  status: SessionStatus
  scheduled_for: string
  estimated_duration_minutes: number | null
  coach_note: string | null
  completed_at: string | null
  location: string | null
  plan_id: string | null
  plan_week_number: number | null
  plan_day_index: number | null
}

type AthleteContext = { userId: string; athleteId: string; teamId: string | null; tenantId: string }

function supabaseClient(operation: string): Result<SupabaseClient> {
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", `[${operation}] Supabase client is not configured.`)
  return ok(client)
}

let cachedContext: AthleteContext | null = null

async function athleteContext(client: SupabaseClient): Promise<Result<AthleteContext>> {
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "You are signed out. Sign in again to keep logging.")
  if (cachedContext?.userId === userId) return ok(cachedContext)

  const { data: athlete, error } = await client
    .from("athletes")
    .select("id, team_id, tenant_id")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!athlete) return err("NOT_FOUND", "No athlete profile found for your account.")

  cachedContext = {
    userId,
    athleteId: athlete.id as string,
    teamId: (athlete.team_id as string | null) ?? null,
    tenantId: athlete.tenant_id as string,
  }
  return ok(cachedContext)
}

type PlannedDay = { planId: string; blueprint: SessionBlueprint }
type PlanCalendar = { planned: PlannedDay[]; ranges: Array<{ start: string; end: string }> }

/** Published plans assigned to the athlete (directly or through their team) that are visible by now. */
async function assignedPlanCalendar(client: SupabaseClient, context: AthleteContext): Promise<Result<PlanCalendar>> {
  const filter = context.teamId
    ? `athlete_id.eq.${context.athleteId},team_id.eq.${context.teamId}`
    : `athlete_id.eq.${context.athleteId}`
  const { data: assignments, error: assignmentsError } = await client
    .from("training_plan_assignments")
    .select("plan_id, visibility_start, visibility_date")
    .or(filter)
  if (assignmentsError) return { ok: false, error: mapPostgrestError(assignmentsError) }

  const today = todayIso()
  const planIds = [
    ...new Set(
      ((assignments as Array<{ plan_id: string; visibility_start: string; visibility_date: string | null }> | null) ?? [])
        .filter((row) => row.visibility_start !== "scheduled" || !row.visibility_date || row.visibility_date <= today)
        .map((row) => row.plan_id),
    ),
  ]
  if (planIds.length === 0) return ok({ planned: [], ranges: [] })

  const { data: plans, error: plansError } = await client
    .from("training_plans")
    .select("id, name, team_id, start_date, weeks, notes, builder_state")
    .in("id", planIds)
    .eq("status", "published")
  if (plansError) return { ok: false, error: mapPostgrestError(plansError) }

  const planned: PlannedDay[] = []
  const ranges: PlanCalendar["ranges"] = []
  for (const row of (plans as Array<{
    id: string
    name: string
    team_id: string | null
    start_date: string
    weeks: number
    notes: string | null
    builder_state: unknown
  }> | null) ?? []) {
    const draft = planFromBuilderState(
      {
        id: row.id,
        status: "published",
        name: row.name,
        teamId: row.team_id ?? "",
        startDate: row.start_date,
        weeks: row.weeks,
        notes: row.notes ?? "",
      },
      row.builder_state,
    )
    ranges.push({ start: draft.startDate, end: planEndDate(draft) })
    for (const blueprint of planBlueprints(draft)) planned.push({ planId: row.id, blueprint })
  }
  planned.sort((left, right) => left.blueprint.date.localeCompare(right.blueprint.date))
  return ok({ planned, ranges })
}

type BlockRecord = {
  id: string
  session_id: string
  sort_order: number
  block_type: SessionBlockType
  name: string
  focus: string | null
  coach_note: string | null
  previous_result: string | null
  rest_label: string | null
  session_block_rows: Array<{
    id: string
    session_block_id: string
    sort_order: number
    label: string
    target: string
    helper: string | null
    log_kind: string | null
    target_sets: number | null
    target_reps: string | null
    target_load: string | null
  }> | null
}

function asLogKind(value: string | null, blockType: SessionBlockType): LogKind {
  return value === "strength" || value === "time" || value === "mark" || value === "check" ? value : logKindForBlockType(blockType)
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function loadSessionBody(
  client: SupabaseClient,
  record: SessionRecord,
): Promise<Result<AthleteSession>> {
  const [blocksResult, logsResult, completionResult] = await Promise.all([
    client
      .from("session_blocks")
      .select(
        "id, session_id, sort_order, block_type, name, focus, coach_note, previous_result, rest_label, session_block_rows(id, session_block_id, sort_order, label, target, helper, log_kind, target_sets, target_reps, target_load)",
      )
      .eq("session_id", record.id)
      .order("sort_order", { ascending: true }),
    client
      .from("session_row_logs")
      .select("session_block_row_id, set_index, completed, reps, load_kg, time_seconds, distance_m, mark")
      .eq("session_id", record.id),
    client
      .from("session_completions")
      .select("completion_date, rpe, athlete_comment")
      .eq("session_id", record.id)
      .eq("athlete_id", record.athlete_id)
      .maybeSingle(),
  ])
  if (blocksResult.error) return { ok: false, error: mapPostgrestError(blocksResult.error) }
  if (logsResult.error) return { ok: false, error: mapPostgrestError(logsResult.error) }
  if (completionResult.error) return { ok: false, error: mapPostgrestError(completionResult.error) }

  const blocks: LoggableBlock[] = ((blocksResult.data as BlockRecord[] | null) ?? []).map((block) => ({
    id: block.id,
    sessionId: block.session_id,
    sortOrder: block.sort_order,
    blockType: block.block_type,
    name: block.name,
    focus: block.focus,
    coachNote: block.coach_note,
    previousResult: block.previous_result,
    restLabel: block.rest_label,
    rows: [...(block.session_block_rows ?? [])]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((row) => ({
        id: row.id,
        sessionBlockId: row.session_block_id,
        sortOrder: row.sort_order,
        label: row.label,
        target: row.target,
        helper: row.helper,
        kind: asLogKind(row.log_kind, block.block_type),
        targetSets: parseSetCount(row.target_sets),
        targetReps: row.target_reps,
        targetLoad: row.target_load,
      })),
  }))

  const logs: SessionRowLog[] = ((logsResult.data as Array<Record<string, unknown>> | null) ?? []).map((row) => ({
    rowId: row.session_block_row_id as string,
    setIndex: Number(row.set_index),
    completed: row.completed !== false,
    reps: numberOrNull(row.reps),
    loadKg: numberOrNull(row.load_kg),
    timeSeconds: numberOrNull(row.time_seconds),
    distanceM: numberOrNull(row.distance_m),
    mark: numberOrNull(row.mark),
  }))

  const completion = completionResult.data as { completion_date: string; rpe: number | null; athlete_comment: string | null } | null
  const completedOn = completion?.completion_date ?? (record.completed_at ? record.completed_at.slice(0, 10) : null)
  return ok({
    id: record.id,
    title: record.title,
    status: completedOn ? "completed" : record.status === "completed" ? "completed" : logs.length > 0 ? "in-progress" : record.status,
    scheduledFor: record.scheduled_for,
    estimatedDurationMinutes: record.estimated_duration_minutes,
    coachNote: record.coach_note,
    location: record.location,
    completedOn,
    overallRpe: completion?.rpe ?? null,
    athleteComment: completion?.athlete_comment ?? null,
    blocks,
    logs,
  })
}

async function loadSupabaseSessionDay(date: string): Promise<Result<AthleteSessionDay>> {
  const clientResult = supabaseClient("loadAthleteSessionDay")
  if (!clientResult.ok) return clientResult
  const client = clientResult.data
  const contextResult = await athleteContext(client)
  if (!contextResult.ok) return contextResult
  const context = contextResult.data

  const weekStart = weekStartIso(date)
  const weekEnd = addDaysIso(weekStart, 6)

  const [weekResult, nextResult, calendarResult] = await Promise.all([
    client
      .from("sessions")
      .select(SESSION_COLUMNS)
      .eq("athlete_id", context.athleteId)
      .gte("scheduled_for", weekStart)
      .lte("scheduled_for", weekEnd)
      .order("scheduled_for", { ascending: true })
      .order("created_at", { ascending: true }),
    client
      .from("sessions")
      .select("title, scheduled_for")
      .eq("athlete_id", context.athleteId)
      .gt("scheduled_for", date)
      .order("scheduled_for", { ascending: true })
      .limit(1),
    assignedPlanCalendar(client, context),
  ])
  if (weekResult.error) return { ok: false, error: mapPostgrestError(weekResult.error) }
  if (nextResult.error) return { ok: false, error: mapPostgrestError(nextResult.error) }
  // The plan calendar only fills gaps. If it cannot be read, existing sessions still load.
  const calendar: PlanCalendar = calendarResult.ok ? calendarResult.data : { planned: [], ranges: [] }
  if (!calendarResult.ok) console.warn("[session] could not read assigned plans", calendarResult.error)

  const weekSessions = (weekResult.data as SessionRecord[] | null) ?? []
  let record = weekSessions.find((session) => session.scheduled_for === date) ?? null

  // The coach creates sessions on publish. An athlete who joined later creates the missing day here.
  // Only from today on: opening an old day must not create a session that then counts as missed.
  const today = todayIso()
  const plannedToday = date >= today ? calendar.planned.find((entry) => entry.blueprint.date === date) : undefined
  if (!record && plannedToday) {
    const created = await insertSessionsFromBlueprints(client, [
      {
        tenantId: context.tenantId,
        athleteId: context.athleteId,
        planId: plannedToday.planId,
        createdByUserId: context.userId,
        blueprint: plannedToday.blueprint,
      },
    ])
    if (!created.ok && created.error.code !== "CONFLICT") {
      console.warn("[session] could not create the planned session for this day", created.error)
    }
    const { data: reread, error: rereadError } = await client
      .from("sessions")
      .select(SESSION_COLUMNS)
      .eq("athlete_id", context.athleteId)
      .eq("scheduled_for", date)
      .order("created_at", { ascending: true })
      .limit(1)
    if (rereadError) return { ok: false, error: mapPostgrestError(rereadError) }
    record = ((reread as SessionRecord[] | null) ?? [])[0] ?? null
    if (record) weekSessions.push(record)
  }

  let session: AthleteSession | null = null
  if (record) {
    const bodyResult = await loadSessionBody(client, record)
    if (!bodyResult.ok) return bodyResult
    session = bodyResult.data
  }

  const inPlan = (day: string) => calendar.ranges.some((range) => day >= range.start && day <= range.end)
  const week: AthleteWeekDay[] = Array.from({ length: 7 }, (_, index) => {
    const day = addDaysIso(weekStart, index)
    const stored = weekSessions.filter((entry) => entry.scheduled_for === day)
    const planned = day >= today && calendar.planned.some((entry) => entry.blueprint.date === day)
    return {
      date: day,
      kind: stored.length > 0 || planned ? "session" : inPlan(day) ? "rest" : "none",
      done:
        day === date && session
          ? session.status === "completed"
          : stored.length > 0 && stored.every((entry) => entry.status === "completed"),
    }
  })

  const nextStored = ((nextResult.data as Array<{ title: string; scheduled_for: string }> | null) ?? [])[0]
  const nextPlanned = calendar.planned.find((entry) => entry.blueprint.date > date)
  const candidates = [
    nextStored ? { date: nextStored.scheduled_for, title: nextStored.title } : null,
    nextPlanned ? { date: nextPlanned.blueprint.date, title: nextPlanned.blueprint.title } : null,
  ].filter((entry): entry is { date: string; title: string } => entry !== null)
  candidates.sort((left, right) => left.date.localeCompare(right.date))

  return ok({
    date,
    session,
    inPlan: inPlan(date) || weekSessions.length > 0,
    next: candidates[0] ?? null,
    week,
  })
}

/** The session planned for a day (today by default), with what the athlete has logged so far. */
export async function loadAthleteSessionDay(date: string = todayIso()): Promise<Result<AthleteSessionDay>> {
  if (getBackendMode() !== "supabase") return loadMockSessionDay(date)
  try {
    return await loadSupabaseSessionDay(date)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** Idempotent: one row per (exercise row, set), overwritten on every save. */
export async function saveSessionRowLogs(sessionId: string, logs: SessionRowLog[]): Promise<Result<null>> {
  if (logs.length === 0) return ok(null)
  if (getBackendMode() !== "supabase") return saveMockRowLogs(sessionId, logs)
  try {
    const clientResult = supabaseClient("saveSessionRowLogs")
    if (!clientResult.ok) return clientResult
    const contextResult = await athleteContext(clientResult.data)
    if (!contextResult.ok) return contextResult
    const context = contextResult.data

    const { error } = await clientResult.data.from("session_row_logs").upsert(
      logs.map((log) => ({
        tenant_id: context.tenantId,
        session_id: sessionId,
        session_block_row_id: log.rowId,
        athlete_id: context.athleteId,
        set_index: log.setIndex,
        completed: log.completed,
        reps: log.reps,
        load_kg: log.loadKg,
        time_seconds: log.timeSeconds,
        distance_m: log.distanceM,
        mark: log.mark,
        logged_by_user_id: context.userId,
      })),
      { onConflict: "session_block_row_id,athlete_id,set_index" },
    )
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(null)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** Marks the session done with the overall effort and comment. Safe to call again to change either. */
export async function saveSessionCompletion(params: {
  sessionId: string
  completionDate: string
  rpe: number | null
  comment: string | null
}): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") return saveMockCompletion(params)
  try {
    const clientResult = supabaseClient("saveSessionCompletion")
    if (!clientResult.ok) return clientResult
    const client = clientResult.data
    const contextResult = await athleteContext(client)
    if (!contextResult.ok) return contextResult
    const context = contextResult.data

    // Not an upsert: the day the session was first finished is kept when the athlete edits it later.
    const { data: existing, error: existingError } = await client
      .from("session_completions")
      .select("id")
      .eq("session_id", params.sessionId)
      .eq("athlete_id", context.athleteId)
      .maybeSingle()
    if (existingError) return { ok: false, error: mapPostgrestError(existingError) }

    if (existing) {
      const { error } = await client
        .from("session_completions")
        .update({ rpe: params.rpe, athlete_comment: params.comment })
        .eq("id", existing.id as string)
      if (error) return { ok: false, error: mapPostgrestError(error) }
      return ok(null)
    }

    const { error } = await client.from("session_completions").insert({
      tenant_id: context.tenantId,
      session_id: params.sessionId,
      athlete_id: context.athleteId,
      completion_date: params.completionDate,
      completed_by_user_id: context.userId,
      rpe: params.rpe,
      athlete_comment: params.comment,
    })
    // Two tabs finishing at once: the other one won, which is fine.
    if (error && error.code !== "23505") return { ok: false, error: mapPostgrestError(error) }
    return ok(null)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}
