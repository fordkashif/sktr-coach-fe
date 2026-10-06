import type { SupabaseClient } from "@supabase/supabase-js"
import { kickNotificationEmails } from "@/lib/data/notifications-data"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { inferBlockType, planBlueprints, type SessionBlueprint } from "@/lib/data/session/session-from-plan"
import { removeUnstartedPlanSessions, syncPlanSessions } from "@/lib/data/session/session-plan-sync"
import { planFromBuilderState, todayIso } from "@/lib/data/training-plan/plan-builder-model"
import type { PublishPlanStructure, TrainingPlanDay, TrainingPlanDetail, TrainingPlanSummary } from "@/lib/data/training-plan/types"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

type ClientResolution =
  | { ok: true; client: SupabaseClient }
  | { ok: false; error: DataError }

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

function isUuid(value: string | null | undefined): value is string {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

type CoachContext = {
  userId: string
  tenantId: string
  role: "coach" | "club-admin"
}

async function getCurrentCoachContext(client: SupabaseClient): Promise<Result<CoachContext>> {
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: profile, error } = await client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "coach" && profile.role !== "club-admin") {
    return err("FORBIDDEN", "Only coach or club-admin users can publish training plans.")
  }

  return ok({
    userId,
    tenantId: profile.tenant_id as string,
    role: profile.role as "coach" | "club-admin",
  })
}

async function getCurrentAthleteContext(client: SupabaseClient): Promise<Result<{ athleteId: string; teamId: string | null }>> {
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: athlete, error: athleteError } = await client
    .from("athletes")
    .select("id, team_id")
    .eq("user_id", userId)
    .maybeSingle()

  if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }
  if (!athlete) return err("NOT_FOUND", "No athlete profile found for current user.")

  return ok({ athleteId: athlete.id, teamId: athlete.team_id })
}

export type PublishTrainingPlanInput = {
  /** Existing plan to publish or update. Omit to create a new plan. */
  planId?: string | null
  /** Coach builder model, stored on the plan so it can be reopened and edited. */
  builderState?: Record<string, unknown> | null
  name: string
  startDate: string
  weeks: number
  notes?: string | null
  teamId: string | null
  visibilityStart: "immediate" | "scheduled"
  visibilityDate: string | null
  assignTarget: "team" | "squads" | "subgroup" | "selected"
  assignSubgroup: string | null
  selectedAthleteIds: string[]
  /** For "squads": squads of the plan's team. Their members now, and anyone added later, get the plan. */
  squadIds?: string[]
  structure: PublishPlanStructure
}

export type PublishTrainingPlanOutput = {
  planId: string
  assignedCount: number
}

export type SaveTrainingPlanDraftInput = {
  /** Existing draft to overwrite. Omit to create a new draft. */
  planId?: string | null
  name: string
  startDate: string
  weeks: number
  notes?: string | null
  teamId: string | null
  builderState: Record<string, unknown>
}

export type TrainingPlanAssignmentRow = {
  id: string
  planId: string
  scope: "team" | "athlete" | "squad"
  teamId: string | null
  athleteId: string | null
  squadId: string | null
  visibilityStart: "immediate" | "scheduled"
  visibilityDate: string | null
}

export type CoachTrainingPlanListItem = TrainingPlanSummary & {
  updatedAt: string | null
  assignments: TrainingPlanAssignmentRow[]
}

export type TrainingPlanBuilderRecord = {
  plan: TrainingPlanSummary & { notes: string | null; updatedAt: string | null }
  /** Null for plans published before the builder stored its model. */
  builderState: Record<string, unknown> | null
  assignments: TrainingPlanAssignmentRow[]
  /** Published structure, used to rebuild the editor when builderState is null. */
  detail: TrainingPlanDetail | null
}

type AssignmentDbRow = {
  id: string
  plan_id: string
  scope: "team" | "athlete" | "squad"
  team_id: string | null
  athlete_id: string | null
  squad_id: string | null
  visibility_start: "immediate" | "scheduled"
  visibility_date: string | null
}

const ASSIGNMENT_COLUMNS = "id, plan_id, scope, team_id, athlete_id, squad_id, visibility_start, visibility_date"

function mapAssignmentRow(row: AssignmentDbRow): TrainingPlanAssignmentRow {
  return {
    id: row.id,
    planId: row.plan_id,
    scope: row.scope,
    teamId: row.team_id,
    athleteId: row.athlete_id,
    squadId: row.squad_id ?? null,
    visibilityStart: row.visibility_start,
    visibilityDate: row.visibility_date,
  }
}

async function resolveAthleteAssignmentIds(
  client: SupabaseClient,
  input: PublishTrainingPlanInput,
): Promise<Result<string[]>> {
  if (input.assignTarget === "squads") {
    if (!isUuid(input.teamId)) return err("VALIDATION", "A valid team must be selected before publishing.")
    const squadIds = [...new Set(input.squadIds ?? [])].filter((id) => isUuid(id))
    if (squadIds.length === 0) return err("VALIDATION", "Pick at least one squad before publishing.")
    const { data: squads, error: squadError } = await client.from("team_squads").select("id").in("id", squadIds).eq("team_id", input.teamId).is("archived_at", null)
    if (squadError) return { ok: false, error: mapPostgrestError(squadError) }
    if (((squads as Array<{ id: string }> | null) ?? []).length !== squadIds.length) {
      return err("VALIDATION", "One of the squads no longer exists on this team. Check who the plan is for and publish again.")
    }
    // The members right now. Anyone added later gets their sessions when they are added.
    const { data, error } = await client.from("team_squad_members").select("athlete_id").in("squad_id", squadIds)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok([...new Set(((data as Array<{ athlete_id: string }> | null) ?? []).map((row) => row.athlete_id))])
  }

  if (input.assignTarget === "team" || input.assignTarget === "subgroup") {
    if (!isUuid(input.teamId)) {
      return err("VALIDATION", "A valid team must be selected before publishing.")
    }

    let query = client
      .from("athletes")
      .select("id")
      .eq("team_id", input.teamId)

    if (input.assignTarget === "subgroup" && input.assignSubgroup) {
      query = query.eq("event_group", input.assignSubgroup)
    }

    const { data, error } = await query
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(((data as Array<{ id: string }> | null) ?? []).map((row) => row.id))
  }

  const deduped = [...new Set(input.selectedAthleteIds)].filter((id) => isUuid(id))
  if (deduped.length === 0) return err("VALIDATION", "Select at least one valid athlete before publishing.")

  let query = client.from("athletes").select("id").in("id", deduped)
  if (isUuid(input.teamId)) {
    query = query.eq("team_id", input.teamId)
  }

  const { data, error } = await query
  if (error) return { ok: false, error: mapPostgrestError(error) }

  const resolvedIds = ((data as Array<{ id: string }> | null) ?? []).map((row) => row.id)
  if (resolvedIds.length === 0) {
    return err("VALIDATION", "No valid athletes were found for selected assignment scope.")
  }

  return ok(resolvedIds)
}

/**
 * Replaces the athlete-facing structure (weeks, days, blocks) of a plan.
 * Deleting the weeks cascades to days and blocks.
 */
async function replaceTrainingPlanStructure(
  client: SupabaseClient,
  planId: string,
  structure: PublishTrainingPlanInput["structure"],
): Promise<Result<null>> {
  const { error: clearError } = await client.from("training_plan_weeks").delete().eq("plan_id", planId)
  if (clearError) return { ok: false, error: mapPostgrestError(clearError) }

  const { data: storedWeeks, error: weekInsertError } = await client
    .from("training_plan_weeks")
    .insert(
      structure.map((week) => ({
        plan_id: planId,
        week_number: week.weekNumber,
        emphasis: week.emphasis,
        week_type: week.weekType ?? null,
        phase_name: week.phaseName ?? null,
        status: week.status,
      })),
    )
    .select("id, week_number")
  if (weekInsertError) return { ok: false, error: mapPostgrestError(weekInsertError) }

  const weekIdByNumber = new Map(
    ((storedWeeks as Array<{ id: string; week_number: number }> | null) ?? []).map((row) => [row.week_number, row.id]),
  )

  const dayInserts = structure.flatMap((week) =>
    week.days.map((day) => ({
      plan_week_id: weekIdByNumber.get(week.weekNumber) ?? "",
      day_index: day.dayIndex,
      day_label: day.dayLabel,
      date: day.date,
      title: day.title,
      session_type: day.sessionType,
      focus: day.focus,
      status: day.status,
      duration_minutes: day.durationMinutes,
      location: day.location,
      coach_note: day.coachNote,
      is_training_day: day.isTrainingDay,
    })),
  )
  if (dayInserts.some((day) => !isUuid(day.plan_week_id))) {
    return err("UNKNOWN", "Failed to map plan weeks while saving the day structure.")
  }
  if (dayInserts.length === 0) return ok(null)

  const { data: storedDays, error: dayInsertError } = await client
    .from("training_plan_days")
    .insert(dayInserts)
    .select("id, plan_week_id, day_index")
  if (dayInsertError) return { ok: false, error: mapPostgrestError(dayInsertError) }

  const dayIdByWeekAndIndex = new Map(
    ((storedDays as Array<{ id: string; plan_week_id: string; day_index: number }> | null) ?? []).map((row) => [
      `${row.plan_week_id}:${row.day_index}`,
      row.id,
    ]),
  )

  const blockInserts = structure.flatMap((week) =>
    week.days.flatMap((day) => {
      const weekId = weekIdByNumber.get(week.weekNumber)
      const dayId = weekId ? dayIdByWeekAndIndex.get(`${weekId}:${day.dayIndex}`) : undefined
      if (!dayId) return []
      return day.blockPreview.map((preview, index) => ({
        plan_day_id: dayId,
        sort_order: index,
        preview_text: preview,
      }))
    }),
  )
  if (blockInserts.length > 0) {
    const { error: blockInsertError } = await client.from("training_plan_blocks").insert(blockInserts)
    if (blockInsertError) return { ok: false, error: mapPostgrestError(blockInsertError) }
  }

  return ok(null)
}

/**
 * Makes the assignment rows of a plan match the requested target.
 * Rows that are still wanted are kept (so athletes are not notified twice),
 * rows that are no longer wanted are removed, and only new rows are inserted.
 * Inserting an immediate assignment is what queues the athlete notification.
 */
async function syncTrainingPlanAssignments(
  client: SupabaseClient,
  context: CoachContext,
  planId: string,
  input: PublishTrainingPlanInput,
  athleteAssignmentIds: string[],
): Promise<Result<null>> {
  const visibilityDate = input.visibilityStart === "scheduled" ? input.visibilityDate : null
  type Desired = { key: string; scope: "team" | "athlete" | "squad"; team_id: string | null; athlete_id: string | null; squad_id: string | null }
  const desired: Desired[] =
    input.assignTarget === "team"
      ? [{ key: `team:${input.teamId}`, scope: "team", team_id: input.teamId, athlete_id: null, squad_id: null }]
      : input.assignTarget === "squads"
        ? // One row per squad, not per member: the row is what makes the plan follow the squad.
          [...new Set(input.squadIds ?? [])].map((squadId) => ({ key: `squad:${squadId}`, scope: "squad" as const, team_id: null, athlete_id: null, squad_id: squadId }))
        : athleteAssignmentIds.map((athleteId) => ({ key: `athlete:${athleteId}`, scope: "athlete" as const, team_id: null, athlete_id: athleteId, squad_id: null }))

  const { data: existingRows, error: existingError } = await client
    .from("training_plan_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("plan_id", planId)
    .eq("tenant_id", context.tenantId)
  if (existingError) return { ok: false, error: mapPostgrestError(existingError) }

  const existing = ((existingRows as AssignmentDbRow[] | null) ?? []).map((row) => ({
    id: row.id,
    key: row.scope === "team" ? `team:${row.team_id}` : row.scope === "squad" ? `squad:${row.squad_id}` : `athlete:${row.athlete_id}`,
  }))
  const desiredKeys = new Set(desired.map((row) => row.key))
  const existingKeys = new Set(existing.map((row) => row.key))
  const removeIds = existing.filter((row) => !desiredKeys.has(row.key)).map((row) => row.id)
  const keepIds = existing.filter((row) => desiredKeys.has(row.key)).map((row) => row.id)
  const inserts = desired
    .filter((row) => !existingKeys.has(row.key))
    .map((row) => ({
      tenant_id: context.tenantId,
      plan_id: planId,
      scope: row.scope,
      team_id: row.team_id,
      athlete_id: row.athlete_id,
      squad_id: row.squad_id,
      visibility_start: input.visibilityStart,
      visibility_date: visibilityDate,
      created_by_user_id: context.userId,
    }))

  if (removeIds.length > 0) {
    const { error } = await client.from("training_plan_assignments").delete().in("id", removeIds)
    if (error) return { ok: false, error: mapPostgrestError(error) }
  }
  if (keepIds.length > 0) {
    const { error } = await client
      .from("training_plan_assignments")
      .update({ visibility_start: input.visibilityStart, visibility_date: visibilityDate })
      .in("id", keepIds)
    if (error) return { ok: false, error: mapPostgrestError(error) }
  }
  if (inserts.length > 0) {
    const { error } = await client.from("training_plan_assignments").insert(inserts)
    if (error) return { ok: false, error: mapPostgrestError(error) }
  }

  return ok(null)
}

/**
 * The sessions athletes will log against. Built from the builder model when the plan has one
 * (blocks with exercises, sets, reps and load), otherwise from the day structure alone.
 */
function blueprintsForPublish(input: PublishTrainingPlanInput): SessionBlueprint[] {
  if (input.builderState) {
    const draft = planFromBuilderState(
      {
        id: input.planId ?? null,
        status: "published",
        name: input.name,
        teamId: input.teamId ?? "",
        startDate: input.startDate,
        weeks: input.weeks,
        notes: input.notes ?? "",
      },
      input.builderState,
    )
    if (draft.sessions.length > 0) return planBlueprints(draft)
  }
  return input.structure.flatMap((week) =>
    week.days
      .filter((day) => day.isTrainingDay)
      .map((day) => ({
        week: week.weekNumber,
        dayIndex: day.dayIndex,
        date: day.date,
        title: day.title,
        sessionType: day.sessionType,
        durationMinutes: day.durationMinutes,
        location: day.location,
        coachNote: day.coachNote,
        blocks: day.blockPreview.map((preview, index) => {
          const split = preview.indexOf(": ")
          const name = (split > 0 ? preview.slice(0, split) : preview).trim() || `Block ${index + 1}`
          return {
            sortOrder: index,
            blockType: inferBlockType(name, day.sessionType),
            name,
            focus: null,
            coachNote: null,
            rows: [
              {
                sortOrder: 0,
                label: name,
                target: split > 0 ? preview.slice(split + 2) : "As coached",
                helper: null,
                kind: "check" as const,
                targetSets: 1,
                targetReps: null,
                targetLoad: null,
              },
            ],
          }
        }),
      })),
  )
}

/**
 * Publishes a new plan, publishes an existing draft, or updates a plan that is already published.
 *
 * There is no client-side transaction, so the writes are ordered to fail safe:
 * 1. the plan row is written while it is still a draft (or left published on an update),
 * 2. the week/day/block structure is replaced,
 * 3. the status flips to published,
 * 4. assignments are synced, which is the step that makes the plan reach athletes and notifies them,
 * 5. the sessions athletes log against are created for every assigned athlete, from today on.
 *    Sessions an athlete already started or finished, and past sessions, are never touched.
 * A failure before step 3 leaves a draft that can be published again. Every step is safe to retry.
 */
export async function publishTrainingPlanForCurrentCoach(
  input: PublishTrainingPlanInput,
): Promise<Result<PublishTrainingPlanOutput>> {
  const clientResult = requireSupabaseClient("publishTrainingPlanForCurrentCoach")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client

  const contextResult = await getCurrentCoachContext(client)
  if (!contextResult.ok) return contextResult
  const context = contextResult.data

  if (!input.name.trim()) return err("VALIDATION", "Give the plan a name before publishing.")
  if (input.structure.length === 0) return err("VALIDATION", "Training plan must include at least one week.")
  if (input.planId && !isUuid(input.planId)) return err("VALIDATION", "This plan has an invalid id.")

  const athleteAssignmentsResult = await resolveAthleteAssignmentIds(client, input)
  if (!athleteAssignmentsResult.ok) return athleteAssignmentsResult
  const athleteAssignmentIds = athleteAssignmentsResult.data

  const planFields: Record<string, unknown> = {
    team_id: isUuid(input.teamId) ? input.teamId : null,
    name: input.name.trim(),
    start_date: input.startDate,
    weeks: input.weeks,
    notes: input.notes ?? null,
  }
  if (input.builderState !== undefined) planFields.builder_state = input.builderState

  let planId: string
  let alreadyPublished = false

  if (input.planId) {
    const { data: existingPlan, error: existingError } = await client
      .from("training_plans")
      .select("id, status")
      .eq("id", input.planId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle()
    if (existingError) return { ok: false, error: mapPostgrestError(existingError) }
    if (!existingPlan) return err("NOT_FOUND", "This plan no longer exists. Reload your plans and try again.")
    if (existingPlan.status === "archived") {
      return err("VALIDATION", "Archived plans cannot be changed. Duplicate it as a new draft instead.")
    }
    alreadyPublished = existingPlan.status === "published"
    planId = existingPlan.id as string

    const { data: updatedRows, error: updateError } = await client
      .from("training_plans")
      .update(planFields)
      .eq("id", planId)
      .eq("tenant_id", context.tenantId)
      .select("id")
    if (updateError) return { ok: false, error: mapPostgrestError(updateError) }
    if (((updatedRows as Array<{ id: string }> | null) ?? []).length === 0) {
      return err("FORBIDDEN", "You do not have permission to change this plan.")
    }
  } else {
    const { data: insertedPlan, error: planError } = await client
      .from("training_plans")
      .insert({
        ...planFields,
        tenant_id: context.tenantId,
        status: "draft",
        created_by_user_id: context.userId,
      })
      .select("id")
      .single()
    if (planError) return { ok: false, error: mapPostgrestError(planError) }
    planId = insertedPlan.id as string
  }

  const structureResult = await replaceTrainingPlanStructure(client, planId, input.structure)
  if (!structureResult.ok) return structureResult

  if (!alreadyPublished) {
    const { error: statusError } = await client
      .from("training_plans")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", planId)
      .eq("tenant_id", context.tenantId)
    if (statusError) return { ok: false, error: mapPostgrestError(statusError) }
  }

  const assignmentResult = await syncTrainingPlanAssignments(client, context, planId, input, athleteAssignmentIds)
  if (!assignmentResult.ok) return assignmentResult

  const today = todayIso()
  const visibleFrom = input.visibilityStart === "scheduled" && input.visibilityDate ? input.visibilityDate : today
  const sessionsResult = await syncPlanSessions(client, {
    tenantId: context.tenantId,
    userId: context.userId,
    planId,
    athleteIds: athleteAssignmentIds,
    blueprints: blueprintsForPublish(input),
    fromDate: visibleFrom > today ? visibleFrom : today,
  })
  if (!sessionsResult.ok) {
    return err(
      sessionsResult.error.code,
      `The plan is published, but the sessions athletes log against could not be created (${sessionsResult.error.message}). Publish again to retry.`,
      sessionsResult.error.cause,
    )
  }

  // Sends the emails this just queued without waiting for the scheduler (and where there is no scheduler).
  kickNotificationEmails()
  return ok({ planId, assignedCount: athleteAssignmentIds.length })
}

/**
 * Creates or overwrites a draft. A draft is a single row (the builder model lives in builder_state),
 * so the save is one atomic write. Drafts get no structure rows and no assignments,
 * which means athletes cannot reach them and no notification is queued.
 */
export async function saveTrainingPlanDraftForCurrentCoach(
  input: SaveTrainingPlanDraftInput,
): Promise<Result<{ planId: string }>> {
  const clientResult = requireSupabaseClient("saveTrainingPlanDraftForCurrentCoach")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client

  const contextResult = await getCurrentCoachContext(client)
  if (!contextResult.ok) return contextResult
  const context = contextResult.data

  if (!input.name.trim()) return err("VALIDATION", "Give the plan a name before saving.")
  if (!input.startDate) return err("VALIDATION", "Pick a start date before saving.")
  if (!Number.isInteger(input.weeks) || input.weeks <= 0) return err("VALIDATION", "Weeks must be a positive number.")

  const fields = {
    team_id: isUuid(input.teamId) ? input.teamId : null,
    name: input.name.trim(),
    start_date: input.startDate,
    weeks: input.weeks,
    notes: input.notes ?? null,
    builder_state: input.builderState,
  }

  if (input.planId) {
    if (!isUuid(input.planId)) return err("VALIDATION", "This plan has an invalid id.")
    const { data: updatedRows, error } = await client
      .from("training_plans")
      .update(fields)
      .eq("id", input.planId)
      .eq("tenant_id", context.tenantId)
      .eq("status", "draft")
      .select("id")
    if (error) return { ok: false, error: mapPostgrestError(error) }
    if (((updatedRows as Array<{ id: string }> | null) ?? []).length === 0) {
      return err("CONFLICT", "This plan is no longer a draft, so it was not saved. Reload your plans and try again.")
    }
    return ok({ planId: input.planId })
  }

  const { data: insertedPlan, error: insertError } = await client
    .from("training_plans")
    .insert({
      ...fields,
      tenant_id: context.tenantId,
      status: "draft",
      created_by_user_id: context.userId,
    })
    .select("id")
    .single()
  if (insertError) return { ok: false, error: mapPostgrestError(insertError) }
  return ok({ planId: insertedPlan.id as string })
}

/** Plans for the coach list (drafts, published and archived) with their assignment rows. */
export async function listCoachTrainingPlansForCurrentUser(params?: {
  scopeTeamId?: string | null
}): Promise<Result<CoachTrainingPlanListItem[]>> {
  const clientResult = requireSupabaseClient("listCoachTrainingPlansForCurrentUser")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client

  const contextResult = await getCurrentCoachContext(client)
  if (!contextResult.ok) return contextResult

  let query = client
    .from("training_plans")
    .select("id, name, team_id, start_date, weeks, status, updated_at")
    .eq("tenant_id", contextResult.data.tenantId)
    .order("start_date", { ascending: false })
    .limit(100)
  if (params?.scopeTeamId) query = query.eq("team_id", params.scopeTeamId)

  const { data, error } = await query
  if (error) return { ok: false, error: mapPostgrestError(error) }

  const rows =
    (data as Array<{
      id: string
      name: string
      team_id: string | null
      start_date: string
      weeks: number
      status: TrainingPlanSummary["status"]
      updated_at: string | null
    }> | null) ?? []

  let assignmentRows: AssignmentDbRow[] = []
  if (rows.length > 0) {
    const { data: assignments, error: assignmentsError } = await client
      .from("training_plan_assignments")
      .select(ASSIGNMENT_COLUMNS)
      .eq("tenant_id", contextResult.data.tenantId)
      .in(
        "plan_id",
        rows.map((row) => row.id),
      )
    if (assignmentsError) return { ok: false, error: mapPostgrestError(assignmentsError) }
    assignmentRows = (assignments as AssignmentDbRow[] | null) ?? []
  }

  return ok(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      teamId: row.team_id,
      startDate: row.start_date,
      weeks: row.weeks,
      status: row.status,
      updatedAt: row.updated_at,
      assignments: assignmentRows.filter((assignment) => assignment.plan_id === row.id).map(mapAssignmentRow),
    })),
  )
}

/** Everything the builder needs to reopen one plan. */
export async function getTrainingPlanForBuilder(planId: string): Promise<Result<TrainingPlanBuilderRecord>> {
  const clientResult = requireSupabaseClient("getTrainingPlanForBuilder")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client

  const contextResult = await getCurrentCoachContext(client)
  if (!contextResult.ok) return contextResult

  const { data: plan, error: planError } = await client
    .from("training_plans")
    .select("id, name, team_id, start_date, weeks, status, notes, updated_at, builder_state")
    .eq("id", planId)
    .eq("tenant_id", contextResult.data.tenantId)
    .maybeSingle()
  if (planError) return { ok: false, error: mapPostgrestError(planError) }
  if (!plan) return err("NOT_FOUND", "This plan no longer exists.")

  const { data: assignments, error: assignmentsError } = await client
    .from("training_plan_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("plan_id", planId)
    .eq("tenant_id", contextResult.data.tenantId)
  if (assignmentsError) return { ok: false, error: mapPostgrestError(assignmentsError) }

  const builderState =
    plan.builder_state && typeof plan.builder_state === "object" && !Array.isArray(plan.builder_state)
      ? (plan.builder_state as Record<string, unknown>)
      : null

  let detail: TrainingPlanDetail | null = null
  if (!builderState) {
    const detailResult = await getTrainingPlanDetail(planId)
    if (!detailResult.ok) return detailResult
    detail = detailResult.data
  }

  return ok({
    plan: {
      id: plan.id as string,
      name: plan.name as string,
      teamId: (plan.team_id as string | null) ?? null,
      startDate: plan.start_date as string,
      weeks: plan.weeks as number,
      status: plan.status as TrainingPlanSummary["status"],
      notes: (plan.notes as string | null) ?? null,
      updatedAt: (plan.updated_at as string | null) ?? null,
    },
    builderState,
    assignments: ((assignments as AssignmentDbRow[] | null) ?? []).map(mapAssignmentRow),
    detail,
  })
}

export async function getCoachTrainingPlansForCurrentUser(params?: {
  scopeTeamId?: string | null
}): Promise<Result<TrainingPlanSummary[]>> {
  const clientResult = requireSupabaseClient("getCoachTrainingPlansForCurrentUser")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentCoachContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const query = clientResult.client
    .from("training_plans")
    .select("id, name, team_id, start_date, weeks, status")
    .eq("tenant_id", contextResult.data.tenantId)
    .neq("status", "archived")
    .order("start_date", { ascending: false })
    .limit(100)

  if (params?.scopeTeamId) {
    query.eq("team_id", params.scopeTeamId)
  }

  const { data, error } = await query
  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
      id: string
      name: string
      team_id: string | null
      start_date: string
      weeks: number
      status: TrainingPlanSummary["status"]
    }> | null) ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      teamId: row.team_id,
      startDate: row.start_date,
      weeks: row.weeks,
      status: row.status,
    })),
  )
}

export async function archiveTrainingPlanForCurrentCoach(planId: string): Promise<Result<{ planId: string }>> {
  const clientResult = requireSupabaseClient("archiveTrainingPlanForCurrentCoach")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentCoachContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { data, error } = await clientResult.client
    .from("training_plans")
    .update({ status: "archived" })
    .eq("id", planId)
    .eq("tenant_id", contextResult.data.tenantId)
    .select("id")

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (((data as Array<{ id: string }> | null) ?? []).length === 0) {
    return err("NOT_FOUND", "This plan could not be archived. It may have been removed, or you may not have access.")
  }
  // Upcoming sessions nobody has started go with the plan. Anything logged stays as history.
  const cleanup = await removeUnstartedPlanSessions(clientResult.client, planId, todayIso())
  if (!cleanup.ok) console.warn("[training-plan] archived, but upcoming sessions could not be removed", cleanup.error)
  return ok({ planId })
}

export async function deleteTrainingPlanForCurrentCoach(planId: string): Promise<Result<{ planId: string }>> {
  const clientResult = requireSupabaseClient("deleteTrainingPlanForCurrentCoach")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentCoachContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  // Must run before the delete: afterwards the sessions no longer point at the plan.
  if (isUuid(planId)) {
    const cleanup = await removeUnstartedPlanSessions(clientResult.client, planId, todayIso())
    if (!cleanup.ok) return cleanup
  }

  const { data, error } = await clientResult.client
    .from("training_plans")
    .delete()
    .eq("id", planId)
    .eq("tenant_id", contextResult.data.tenantId)
    .select("id")

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (((data as Array<{ id: string }> | null) ?? []).length === 0) {
    return err("NOT_FOUND", "This plan could not be deleted. It may already be gone, or you may not have access.")
  }
  return ok({ planId })
}

export async function getAssignedTrainingPlansForCurrentAthlete(): Promise<Result<TrainingPlanSummary[]>> {
  const clientResult = requireSupabaseClient("getAssignedTrainingPlansForCurrentAthlete")
  if (!clientResult.ok) return clientResult

  const athleteContext = await getCurrentAthleteContext(clientResult.client)
  if (!athleteContext.ok) return athleteContext

  const { data: assignments, error: assignmentsError } = await clientResult.client
    .from("training_plan_assignments")
    .select("plan_id, scope, team_id, athlete_id")
    // Squad rows: the database only returns the ones of squads this athlete is in.
    .or(`athlete_id.eq.${athleteContext.data.athleteId},team_id.eq.${athleteContext.data.teamId ?? "00000000-0000-0000-0000-000000000000"},scope.eq.squad`)

  if (assignmentsError) return { ok: false, error: mapPostgrestError(assignmentsError) }

  const planIds = [...new Set(((assignments as Array<{ plan_id: string }> | null) ?? []).map((row) => row.plan_id))]
  if (planIds.length === 0) return ok([])

  const { data: plans, error: plansError } = await clientResult.client
    .from("training_plans")
    .select("id, name, team_id, start_date, weeks, status")
    .in("id", planIds)
    // Athletes can only read published plans assigned to them or their team (migration 20261006150000).
    .eq("status", "published")
    .order("start_date", { ascending: false })

  if (plansError) return { ok: false, error: mapPostgrestError(plansError) }

  return ok(
    ((plans as Array<{
      id: string
      name: string
      team_id: string | null
      start_date: string
      weeks: number
      status: TrainingPlanSummary["status"]
    }> | null) ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      teamId: row.team_id,
      startDate: row.start_date,
      weeks: row.weeks,
      status: row.status,
    })),
  )
}

type WeekRow = {
  id: string
  week_number: number
  emphasis: string | null
  week_type?: string | null
  phase_name?: string | null
  status: "completed" | "current" | "up-next"
}

type DayRow = {
  id: string
  plan_week_id: string
  day_index: number
  day_label: string
  date: string
  title: string
  session_type: TrainingPlanDay["sessionType"]
  focus: string
  status: TrainingPlanDay["status"]
  duration_minutes: number | null
  location: string | null
  coach_note: string | null
}

type BlockRow = {
  id: string
  plan_day_id: string
  sort_order: number
  preview_text: string
}

export async function getTrainingPlanDetail(planId: string): Promise<Result<TrainingPlanDetail | null>> {
  const clientResult = requireSupabaseClient("getTrainingPlanDetail")
  if (!clientResult.ok) return clientResult

  const { data: weeks, error: weeksError } = await clientResult.client
    .from("training_plan_weeks")
    .select("id, week_number, emphasis, week_type, phase_name, status")
    .eq("plan_id", planId)
    .order("week_number", { ascending: true })

  if (weeksError) return { ok: false, error: mapPostgrestError(weeksError) }
  const normalizedWeeks = (weeks as WeekRow[] | null) ?? []
  if (normalizedWeeks.length === 0) return ok(null)

  const weekIds = normalizedWeeks.map((week) => week.id)
  const { data: days, error: daysError } = await clientResult.client
    .from("training_plan_days")
    .select("id, plan_week_id, day_index, day_label, date, title, session_type, focus, status, duration_minutes, location, coach_note")
    .in("plan_week_id", weekIds)
    .order("day_index", { ascending: true })

  if (daysError) return { ok: false, error: mapPostgrestError(daysError) }
  const normalizedDays = (days as DayRow[] | null) ?? []
  const dayIds = normalizedDays.map((day) => day.id)

  let normalizedBlocks: BlockRow[] = []
  if (dayIds.length > 0) {
    const { data: blocks, error: blocksError } = await clientResult.client
      .from("training_plan_blocks")
      .select("id, plan_day_id, sort_order, preview_text")
      .in("plan_day_id", dayIds)
      .order("sort_order", { ascending: true })

    if (blocksError) return { ok: false, error: mapPostgrestError(blocksError) }
    normalizedBlocks = (blocks as BlockRow[] | null) ?? []
  }

  return ok({
    planId,
    weeks: normalizedWeeks.map((week) => ({
      id: week.id,
      weekNumber: week.week_number,
      emphasis: week.emphasis,
      weekType: week.week_type ?? null,
      phaseName: week.phase_name ?? null,
      status: week.status,
      days: normalizedDays
        .filter((day) => day.plan_week_id === week.id)
        .map((day) => ({
          id: day.id,
          dayIndex: day.day_index,
          dayLabel: day.day_label,
          date: day.date,
          title: day.title,
          sessionType: day.session_type,
          focus: day.focus,
          status: day.status,
          durationMinutes: day.duration_minutes,
          location: day.location,
          coachNote: day.coach_note,
          blockPreview: normalizedBlocks
            .filter((block) => block.plan_day_id === day.id)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((block) => block.preview_text),
        })),
    })),
  })
}

/** One week of a team's plan, as the coach dashboard lists it. */
export type TeamPlanWeek = {
  planId: string
  planName: string
  weekNumber: number
  totalWeeks: number
  emphasis: string | null
  days: Array<{ id: string; dayLabel: string; date: string; title: string; summary: string | null }>
}

type PlanWeekSource = {
  weekNumber: number
  emphasis?: string | null
  status: "completed" | "current" | "up-next"
  days: Array<{ id: string; dayLabel: string; date: string; title: string; focus?: string | null; blockPreview: string[] }>
}

/**
 * Picks the week of a plan that contains `todayKey` (YYYY-MM-DD). With `allowStatusFallback` (demo data
 * whose dates are fixed in the past) the week marked "current" is used when no date matches.
 */
export function pickTeamPlanWeek(
  plan: { id: string; name: string; weeks: number },
  weeks: PlanWeekSource[],
  todayKey: string,
  allowStatusFallback = false,
): TeamPlanWeek | null {
  const containsToday = (week: PlanWeekSource) => {
    const keys = week.days.map((day) => day.date.slice(0, 10)).sort()
    if (keys.length === 0) return false
    const start = new Date(`${keys[0]}T00:00:00`)
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    const today = new Date(`${todayKey}T00:00:00`)
    return start <= today && today <= end
  }
  const week = weeks.find(containsToday) ?? (allowStatusFallback ? weeks.find((candidate) => candidate.status === "current") : undefined)
  if (!week) return null
  return {
    planId: plan.id,
    planName: plan.name,
    weekNumber: week.weekNumber,
    totalWeeks: plan.weeks,
    emphasis: week.emphasis ?? null,
    days: [...week.days]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((day) => ({
        id: day.id,
        dayLabel: day.dayLabel,
        date: day.date.slice(0, 10),
        title: day.title,
        summary: day.blockPreview.length > 0 ? day.blockPreview.join(", ") : day.focus || null,
      })),
  }
}

/** The published plan week a team is in today, or null when no published plan covers today. */
export async function getCurrentPlanWeekForCoachTeam(params: { scopeTeamId?: string | null; todayKey: string }): Promise<Result<TeamPlanWeek | null>> {
  const plansResult = await getCoachTrainingPlansForCurrentUser({ scopeTeamId: params.scopeTeamId })
  if (!plansResult.ok) return plansResult

  const plan = plansResult.data.find((candidate) => {
    if (candidate.status !== "published") return false
    const end = new Date(`${candidate.startDate.slice(0, 10)}T00:00:00`)
    end.setDate(end.getDate() + candidate.weeks * 7 - 1)
    const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`
    return candidate.startDate.slice(0, 10) <= params.todayKey && params.todayKey <= endKey
  })
  if (!plan) return ok(null)

  const detailResult = await getTrainingPlanDetail(plan.id)
  if (!detailResult.ok) return detailResult
  return ok(pickTeamPlanWeek(plan, detailResult.data?.weeks ?? [], params.todayKey))
}

/** One published plan of a team: the days it has a session on, and how it is assigned. */
export type TeamPublishedPlanDays = {
  id: string
  name: string
  dates: string[]
  assignments: TrainingPlanAssignmentRow[]
}

/**
 * The published plans of one team with their session days, for the publish step's check that an
 * athlete is not surprised by two sessions on one day (a team plan and a squad plan).
 */
export async function listPublishedPlanDaysForTeam(teamId: string): Promise<Result<TeamPublishedPlanDays[]>> {
  const clientResult = requireSupabaseClient("listPublishedPlanDaysForTeam")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client
  if (!isUuid(teamId)) return ok([])

  const { data: plans, error: plansError } = await client
    .from("training_plans")
    .select("id, name, team_id, start_date, weeks, notes, builder_state")
    .eq("team_id", teamId)
    .eq("status", "published")
  if (plansError) return { ok: false, error: mapPostgrestError(plansError) }
  const rows =
    (plans as Array<{ id: string; name: string; team_id: string | null; start_date: string; weeks: number; notes: string | null; builder_state: unknown }> | null) ?? []
  if (rows.length === 0) return ok([])

  const { data: assignments, error: assignmentsError } = await client
    .from("training_plan_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .in(
      "plan_id",
      rows.map((row) => row.id),
    )
  if (assignmentsError) return { ok: false, error: mapPostgrestError(assignmentsError) }
  const assignmentRows = ((assignments as AssignmentDbRow[] | null) ?? []).map(mapAssignmentRow)

  return ok(
    rows.map((row) => {
      const draft = planFromBuilderState(
        { id: row.id, status: "published", name: row.name, teamId: row.team_id ?? "", startDate: row.start_date, weeks: row.weeks, notes: row.notes ?? "" },
        row.builder_state,
      )
      return {
        id: row.id,
        name: row.name,
        dates: planBlueprints(draft).map((blueprint) => blueprint.date),
        assignments: assignmentRows.filter((assignment) => assignment.planId === row.id),
      }
    }),
  )
}
