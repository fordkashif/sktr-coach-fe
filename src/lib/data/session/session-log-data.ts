import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { availabilityCovers, listAthleteAvailability, type AthleteAvailability } from "@/lib/data/athlete/availability-data"
import {
  exerciseKey,
  logKindForBlockType,
  parseSetCount,
  planBlueprints,
  summariseSets,
  type SessionBlueprint,
} from "@/lib/data/session/session-from-plan"
import { cleanEffort, cleanNote, exerciseMatchKey } from "@/lib/data/session/log-assist"
import {
  addMockExtraExercise,
  createMockExtraSession,
  deleteMockExtraSession,
  extraExerciseTarget,
  listMockSessionRefs,
  loadMockSessionDay,
  mockLastTime,
  saveMockCompletion,
  saveMockRowLogs,
  skipMockSession,
  unskipMockSession,
  weekStartIso,
} from "@/lib/data/session/session-mock"
import { insertSessionsFromBlueprints } from "@/lib/data/session/session-plan-sync"
import type {
  AthleteSession,
  AthleteSessionDay,
  AthleteSessionRef,
  AthleteWeekDay,
  ExtraExerciseInput,
  ExtraSessionInput,
  LastTimeResult,
  LastTimeSet,
  LogKind,
  LoggableBlock,
  LoggableRow,
  SessionBlockType,
  SessionOrigin,
  SessionRowLog,
  SessionStatus,
  SkipReason,
} from "@/lib/data/session/types"
import { addDaysIso, planEndDate, planFromBuilderState, todayIso } from "@/lib/data/training-plan/plan-builder-model"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * The athlete side of session logging: load a day, save what was done, finish the session.
 * Works the same in mock mode (localStorage) and against Supabase.
 * Callers that need to survive a bad connection go through session-log-sync.ts, not these directly.
 */

/** Exported for the coach side (logging for an athlete, src/lib/data/coach/athlete-log-data.ts). */
export const SESSION_COLUMNS =
  "id, athlete_id, title, status, scheduled_for, estimated_duration_minutes, coach_note, completed_at, location, plan_id, plan_week_number, plan_day_index, origin, skip_reason, skip_note"

export type SessionRecord = {
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
  origin: SessionOrigin | null
  skip_reason: SkipReason | null
  skip_note: string | null
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
    reference_url: string | null
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

export async function loadSessionBody(
  client: SupabaseClient,
  record: SessionRecord,
): Promise<Result<AthleteSession>> {
  const [blocksResult, logsResult, completionResult] = await Promise.all([
    client
      .from("session_blocks")
      .select(
        "id, session_id, sort_order, block_type, name, focus, coach_note, previous_result, rest_label, session_block_rows(id, session_block_id, sort_order, label, target, helper, log_kind, target_sets, target_reps, target_load, reference_url)",
      )
      .eq("session_id", record.id)
      .order("sort_order", { ascending: true }),
    client
      .from("session_row_logs")
      .select("session_block_row_id, set_index, completed, reps, load_kg, time_seconds, distance_m, mark, rpe, note")
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
        referenceUrl: row.reference_url ?? null,
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
    rpe: cleanEffort(numberOrNull(row.rpe)),
    note: typeof row.note === "string" && row.note ? row.note : null,
  }))

  const completion = completionResult.data as { completion_date: string; rpe: number | null; athlete_comment: string | null } | null
  const completedOn = completion?.completion_date ?? (record.completed_at ? record.completed_at.slice(0, 10) : null)
  return ok({
    id: record.id,
    title: record.title,
    status: completedOn
      ? "completed"
      : record.status === "completed" || record.status === "skipped"
        ? record.status
        : logs.length > 0
          ? "in-progress"
          : record.status,
    scheduledFor: record.scheduled_for,
    estimatedDurationMinutes: record.estimated_duration_minutes,
    coachNote: record.coach_note,
    location: record.location,
    completedOn,
    overallRpe: completion?.rpe ?? null,
    athleteComment: completion?.athlete_comment ?? null,
    origin: record.origin === "athlete" ? "athlete" : "plan",
    skipReason: completedOn ? null : record.skip_reason,
    skipNote: completedOn ? null : record.skip_note,
    blocks,
    logs,
  })
}

function recordRef(record: SessionRecord, rpe: number | null = null): AthleteSessionRef {
  return {
    id: record.id,
    date: record.scheduled_for,
    title: record.title,
    origin: record.origin === "athlete" ? "athlete" : "plan",
    status: record.status,
    skipReason: record.status === "skipped" ? record.skip_reason : null,
    completedOn: record.completed_at ? record.completed_at.slice(0, 10) : null,
    rpe,
  }
}

const isPlanned = (record: SessionRecord) => record.origin !== "athlete"

async function loadSupabaseSessionDay(date: string, sessionId: string | null): Promise<Result<AthleteSessionDay>> {
  const clientResult = supabaseClient("loadAthleteSessionDay")
  if (!clientResult.ok) return clientResult
  const client = clientResult.data
  const contextResult = await athleteContext(client)
  if (!contextResult.ok) return contextResult
  const context = contextResult.data

  const weekStart = weekStartIso(date)
  const weekEnd = addDaysIso(weekStart, 6)

  const [weekResult, nextResult, calendarResult, availabilityResult] = await Promise.all([
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
      .neq("origin", "athlete")
      .order("scheduled_for", { ascending: true })
      .limit(1),
    assignedPlanCalendar(client, context),
    listAthleteAvailability([context.athleteId], { from: weekStart }),
  ])
  if (weekResult.error) return { ok: false, error: mapPostgrestError(weekResult.error) }
  if (nextResult.error) return { ok: false, error: mapPostgrestError(nextResult.error) }
  // The plan calendar only fills gaps. If it cannot be read, existing sessions still load.
  const calendar: PlanCalendar = calendarResult.ok ? calendarResult.data : { planned: [], ranges: [] }
  if (!calendarResult.ok) console.warn("[session] could not read assigned plans", calendarResult.error)

  // Excused days are a nicety on top of the session. If they cannot be read, the session still loads.
  const periods: AthleteAvailability[] = availabilityResult.ok ? availabilityResult.data : []
  if (!availabilityResult.ok) console.warn("[session] could not read availability", availabilityResult.error)
  const excused = (day: string) => periods.some((period) => availabilityCovers(period, day))

  const weekSessions = (weekResult.data as SessionRecord[] | null) ?? []
  // The day's own session is the planned one. A session the athlete added is opened by its id.
  let record = weekSessions.find((session) => session.scheduled_for === date && isPlanned(session)) ?? null

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
      .neq("origin", "athlete")
      .order("created_at", { ascending: true })
      .limit(1)
    if (rereadError) return { ok: false, error: mapPostgrestError(rereadError) }
    record = ((reread as SessionRecord[] | null) ?? [])[0] ?? null
    if (record) weekSessions.push(record)
  }

  const plannedRecord = record
  if (sessionId && record?.id !== sessionId) {
    record = weekSessions.find((entry) => entry.id === sessionId && entry.scheduled_for === date) ?? null
    if (!record) return err("NOT_FOUND", "That session no longer exists.")
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
    const onDay = weekSessions.filter((entry) => entry.scheduled_for === day)
    const stored = onDay.filter(isPlanned)
    const added = onDay.filter((entry) => !isPlanned(entry))
    const planned = day >= today && calendar.planned.some((entry) => entry.blueprint.date === day)
    const statusOf = (entry: SessionRecord) => (session && entry.id === session.id ? session.status : entry.status)
    return {
      date: day,
      kind: stored.length > 0 || planned ? "session" : inPlan(day) ? "rest" : "none",
      done: stored.length > 0 ? stored.every((entry) => statusOf(entry) === "completed") : added.some((entry) => statusOf(entry) === "completed"),
      skipped: stored.length > 0 && stored.some((entry) => statusOf(entry) === "skipped") && !stored.some((entry) => statusOf(entry) === "completed"),
      excused: excused(day),
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
    inPlan: inPlan(date) || weekSessions.some(isPlanned),
    next: candidates[0] ?? null,
    week,
    others: weekSessions
      .filter((entry) => entry.scheduled_for === date && entry.id !== session?.id && (entry.id === plannedRecord?.id || !isPlanned(entry)))
      .map((entry) => recordRef(entry)),
    excused: excused(date),
  })
}

/**
 * The session planned for a day (today by default), with what the athlete has logged so far.
 * With `sessionId` it opens that session of the day instead (one the athlete added themselves).
 */
export async function loadAthleteSessionDay(date: string = todayIso(), sessionId: string | null = null): Promise<Result<AthleteSessionDay>> {
  if (getBackendMode() !== "supabase") return loadMockSessionDay(date, sessionId)
  try {
    return await loadSupabaseSessionDay(date, sessionId)
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
        // Entries queued before these fields existed have neither: they save as null.
        rpe: cleanEffort(log.rpe),
        note: cleanNote(log.note ?? ""),
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

/* Skip, sessions the athlete adds, history, last time --------------------------------------- */

async function withAthlete<T>(operation: string, run: (client: SupabaseClient, context: AthleteContext) => Promise<Result<T>>): Promise<Result<T>> {
  try {
    const clientResult = supabaseClient(operation)
    if (!clientResult.ok) return clientResult
    const contextResult = await athleteContext(clientResult.data)
    if (!contextResult.ok) return contextResult
    return await run(clientResult.data, contextResult.data)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** "Can't do this one": marks a planned session skipped with a reason. It no longer counts as missed. */
export async function skipSession(sessionId: string, reason: SkipReason, note: string | null): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") return skipMockSession(sessionId, reason, note)
  return withAthlete("skipSession", async (client) => {
    const { error } = await client.rpc("skip_my_session", { p_session_id: sessionId, p_reason: reason, p_note: note?.trim() || null })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(null)
  })
}

/** Undo a skip. The session can be logged again. */
export async function unskipSession(sessionId: string): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") return unskipMockSession(sessionId)
  return withAthlete("unskipSession", async (client) => {
    const { error } = await client.rpc("unskip_my_session", { p_session_id: sessionId })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(null)
  })
}

/**
 * A session the athlete did that was not planned. It is stored with origin "athlete": it shows in
 * their history and to their coach as "Added by athlete", and never counts towards plan adherence.
 */
export async function createExtraSession(input: ExtraSessionInput): Promise<Result<{ sessionId: string }>> {
  const title = input.title.trim().slice(0, 120)
  if (!title) return err("VALIDATION", "Give the session a name.")
  if (getBackendMode() !== "supabase") return createMockExtraSession({ ...input, title })
  return withAthlete("createExtraSession", async (client, context) => {
    const { data: created, error } = await client
      .from("sessions")
      .insert({
        tenant_id: context.tenantId,
        athlete_id: context.athleteId,
        title,
        status: "scheduled",
        scheduled_for: input.date,
        origin: "athlete",
        created_by_user_id: context.userId,
      })
      .select("id")
      .single()
    if (error) return { ok: false, error: mapPostgrestError(error) }
    const sessionId = created.id as string
    const { error: blockError } = await client
      .from("session_blocks")
      .insert({ session_id: sessionId, sort_order: 0, block_type: input.blockType, name: title })
    if (blockError) {
      // Do not leave an empty session behind.
      await client.from("sessions").delete().eq("id", sessionId)
      return { ok: false, error: mapPostgrestError(blockError) }
    }
    return ok({ sessionId })
  })
}

/** Adds an exercise to a session the athlete added themselves. */
export async function addExtraExercise(sessionId: string, blockId: string, sortOrder: number, input: ExtraExerciseInput): Promise<Result<LoggableRow>> {
  const label = input.label.trim().slice(0, 120)
  if (!label) return err("VALIDATION", "Give the exercise a name.")
  const sets = input.kind === "check" ? 1 : Math.max(1, Math.min(20, Math.round(input.sets) || 1))
  if (getBackendMode() !== "supabase") return addMockExtraExercise(sessionId, { ...input, label, sets })
  return withAthlete("addExtraExercise", async (client) => {
    const target = extraExerciseTarget({ ...input, sets })
    const { data, error } = await client
      .from("session_block_rows")
      .insert({ session_block_id: blockId, sort_order: sortOrder, label, target, log_kind: input.kind, target_sets: sets })
      .select("id")
      .single()
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok({
      id: data.id as string,
      sessionBlockId: blockId,
      sortOrder,
      label,
      target,
      helper: null,
      kind: input.kind,
      targetSets: sets,
      targetReps: null,
      targetLoad: null,
    })
  })
}

/** Removes a session the athlete added themselves. Planned sessions cannot be removed by the athlete. */
export async function deleteExtraSession(sessionId: string): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") return deleteMockExtraSession(sessionId)
  return withAthlete("deleteExtraSession", async (client) => {
    const { data, error } = await client.from("sessions").delete().eq("id", sessionId).eq("origin", "athlete").select("id")
    if (error) return { ok: false, error: mapPostgrestError(error) }
    if (((data as unknown[] | null) ?? []).length === 0) return err("FORBIDDEN", "Only a session you added yourself can be removed.")
    return ok(null)
  })
}

/**
 * The athlete's sessions between two days (inclusive), newest first, with the effort of finished ones.
 * Used by the plan screen (state of each day) and the history list.
 */
export async function listAthleteSessions(from: string, to: string, limit = 400): Promise<Result<AthleteSessionRef[]>> {
  if (getBackendMode() !== "supabase") return ok(listMockSessionRefs(from, to).slice(0, limit))
  return withAthlete("listAthleteSessions", async (client, context) => {
    const { data, error } = await client
      .from("sessions")
      .select(SESSION_COLUMNS)
      .eq("athlete_id", context.athleteId)
      .gte("scheduled_for", from)
      .lte("scheduled_for", to)
      .order("scheduled_for", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(limit)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    const records = (data as SessionRecord[] | null) ?? []

    const effort = new Map<string, { rpe: number | null; completionDate: string }>()
    const ids = records.map((record) => record.id)
    for (let index = 0; index < ids.length; index += 200) {
      const { data: completions, error: completionError } = await client
        .from("session_completions")
        .select("session_id, rpe, completion_date")
        .in("session_id", ids.slice(index, index + 200))
      if (completionError) return { ok: false, error: mapPostgrestError(completionError) }
      for (const row of (completions as Array<{ session_id: string; rpe: number | null; completion_date: string }> | null) ?? []) {
        effort.set(row.session_id, { rpe: row.rpe, completionDate: row.completion_date })
      }
    }
    return ok(
      records.map((record) => {
        const completion = effort.get(record.id)
        const ref = recordRef(record, completion?.rpe ?? null)
        return completion ? { ...ref, status: "completed" as const, skipReason: null, completedOn: completion.completionDate } : ref
      }),
    )
  })
}

type LastTimeRow = {
  label_key: string
  session_date: string
  session_rpe?: unknown
  log_kind: string | null
  block_type: SessionBlockType | null
  set_index: number
  reps: unknown
  load_kg: unknown
  time_seconds: unknown
  distance_m: unknown
  mark: unknown
  rpe?: unknown
  note?: unknown
}

function lastTimeFromRows(rows: LastTimeRow[]): Record<string, LastTimeResult> {
  const grouped = new Map<string, LastTimeRow[]>()
  for (const row of rows) {
    const key = exerciseMatchKey(row.label_key)
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  const found: Record<string, LastTimeResult> = {}
  for (const [key, group] of grouped) {
    const kind = asLogKind(group[0].log_kind, group[0].block_type ?? "Strength")
    const sets: LastTimeSet[] = group
      .map((row) => ({
        setIndex: Number(row.set_index),
        reps: numberOrNull(row.reps),
        loadKg: numberOrNull(row.load_kg),
        timeSeconds: numberOrNull(row.time_seconds),
        distanceM: numberOrNull(row.distance_m),
        mark: numberOrNull(row.mark),
        rpe: cleanEffort(numberOrNull(row.rpe)),
      }))
      .sort((left, right) => left.setIndex - right.setIndex)
    const summary = summariseSets(
      kind,
      sets.map((set) => ({ ...set, rowId: key, completed: true })),
    )
    // "Done" on its own says nothing worth repeating.
    if (!summary || summary === "Done" || / done$/.test(summary)) continue
    const noted = group.filter((row) => typeof row.note === "string" && row.note.trim() !== "").sort((left, right) => Number(left.set_index) - Number(right.set_index))[0]
    found[key] = {
      date: group[0].session_date,
      summary,
      kind,
      sets,
      sessionEffort: cleanEffort(numberOrNull(group[0].session_rpe)),
      note: noted ? String(noted.note) : null,
    }
  }
  return found
}

/**
 * What the athlete did the last time for each of these exercises, set by set, from their most
 * recent finished session before `before` that has the exercise. One query for the whole screen.
 * Rows have no stable exercise id, so the match is on the name (see exerciseMatchKey).
 * Keys of the result are exerciseMatchKey(label).
 */
export async function loadLastTime(labels: string[], before: string, excludeSessionId: string | null): Promise<Result<Record<string, LastTimeResult>>> {
  const wanted = [...new Set(labels.map(exerciseMatchKey).filter(Boolean))]
  if (wanted.length === 0) return ok({})
  if (getBackendMode() !== "supabase") return ok(mockLastTime(wanted, before, excludeSessionId))
  return withAthlete("loadLastTime", async (client) => {
    const exclude = /^[0-9a-f-]{36}$/i.test(excludeSessionId ?? "") ? excludeSessionId : null
    const { data, error } = await client.rpc("get_my_last_exercise_logs", { p_labels: wanted, p_before: before, p_exclude_session_id: exclude })
    if (!error) return ok(lastTimeFromRows((data as LastTimeRow[] | null) ?? []))
    // A database that does not have the newer function yet: the older one gives the numbers
    // (matched on the plain lower case name), without per set effort or the note.
    if (error.code !== "PGRST202" && error.code !== "42883") return { ok: false, error: mapPostgrestError(error) }
    const older = await client.rpc("get_my_last_exercise_results", {
      p_labels: [...new Set(labels.map(exerciseKey).filter(Boolean))],
      p_before: before,
      p_exclude_session_id: exclude,
    })
    if (older.error) return { ok: false, error: mapPostgrestError(older.error) }
    return ok(lastTimeFromRows((older.data as LastTimeRow[] | null) ?? []))
  })
}
