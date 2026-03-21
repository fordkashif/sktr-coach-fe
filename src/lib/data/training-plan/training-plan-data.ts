import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import type { TrainingPlanDay, TrainingPlanDetail, TrainingPlanSummary } from "@/lib/data/training-plan/types"
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
  name: string
  startDate: string
  weeks: number
  notes?: string | null
  teamId: string | null
  visibilityStart: "immediate" | "scheduled"
  visibilityDate: string | null
  assignTarget: "team" | "subgroup" | "selected"
  assignSubgroup: string | null
  selectedAthleteIds: string[]
  structure: Array<{
    weekNumber: number
    emphasis: string | null
    status: "completed" | "current" | "up-next"
    days: Array<{
      dayIndex: number
      dayLabel: string
      date: string
      title: string
      sessionType: "Track" | "Gym" | "Recovery" | "Technical" | "Mixed"
      focus: string
      status: "completed" | "scheduled" | "up-next"
      durationMinutes: number | null
      location: string | null
      coachNote: string | null
      isTrainingDay: boolean
      blockPreview: string[]
    }>
  }>
}

export type PublishTrainingPlanOutput = {
  planId: string
  assignedCount: number
}

async function resolveAthleteAssignmentIds(
  client: SupabaseClient,
  input: PublishTrainingPlanInput,
): Promise<Result<string[]>> {
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

export async function publishTrainingPlanForCurrentCoach(
  input: PublishTrainingPlanInput,
): Promise<Result<PublishTrainingPlanOutput>> {
  const clientResult = requireSupabaseClient("publishTrainingPlanForCurrentCoach")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentCoachContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const athleteAssignmentsResult = await resolveAthleteAssignmentIds(clientResult.client, input)
  if (!athleteAssignmentsResult.ok) return athleteAssignmentsResult
  const athleteAssignmentIds = athleteAssignmentsResult.data

  const { data: insertedPlan, error: planError } = await clientResult.client
    .from("training_plans")
    .insert({
      tenant_id: contextResult.data.tenantId,
      team_id: isUuid(input.teamId) ? input.teamId : null,
      name: input.name,
      start_date: input.startDate,
      weeks: input.weeks,
      status: "published",
      notes: input.notes ?? null,
      created_by_user_id: contextResult.data.userId,
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (planError) return { ok: false, error: mapPostgrestError(planError) }
  const planId = insertedPlan.id as string

  const weekInserts = input.structure.map((week) => ({
    plan_id: planId,
    week_number: week.weekNumber,
    emphasis: week.emphasis,
    status: week.status,
  }))
  if (weekInserts.length === 0) return err("VALIDATION", "Training plan must include at least one week.")

  const { error: weekInsertError } = await clientResult.client.from("training_plan_weeks").insert(weekInserts)
  if (weekInsertError) return { ok: false, error: mapPostgrestError(weekInsertError) }

  const { data: storedWeeks, error: weekFetchError } = await clientResult.client
    .from("training_plan_weeks")
    .select("id, week_number")
    .eq("plan_id", planId)

  if (weekFetchError) return { ok: false, error: mapPostgrestError(weekFetchError) }
  const weekIdByNumber = new Map(
    (((storedWeeks as Array<{ id: string; week_number: number }> | null) ?? [])).map((row) => [row.week_number, row.id]),
  )

  const dayInserts = input.structure.flatMap((week) =>
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
    return err("UNKNOWN", "Failed to map plan weeks while publishing day structure.")
  }
  if (dayInserts.length > 0) {
    const { error: dayInsertError } = await clientResult.client.from("training_plan_days").insert(dayInserts)
    if (dayInsertError) return { ok: false, error: mapPostgrestError(dayInsertError) }
  }

  const planWeekIds = [...weekIdByNumber.values()]
  let dayIdByWeekAndIndex = new Map<string, string>()
  if (planWeekIds.length > 0) {
    const { data: storedDays, error: dayFetchError } = await clientResult.client
      .from("training_plan_days")
      .select("id, plan_week_id, day_index")
      .in("plan_week_id", planWeekIds)

    if (dayFetchError) return { ok: false, error: mapPostgrestError(dayFetchError) }

    dayIdByWeekAndIndex = new Map(
      (((storedDays as Array<{ id: string; plan_week_id: string; day_index: number }> | null) ?? [])).map((row) => [
        `${row.plan_week_id}:${row.day_index}`,
        row.id,
      ]),
    )
  }

  const blockInserts = input.structure.flatMap((week) =>
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
    const { error: blockInsertError } = await clientResult.client.from("training_plan_blocks").insert(blockInserts)
    if (blockInsertError) return { ok: false, error: mapPostgrestError(blockInsertError) }
  }

  const assignmentInserts =
    input.assignTarget === "team"
      ? [
          {
            tenant_id: contextResult.data.tenantId,
            plan_id: planId,
            scope: "team" as const,
            team_id: input.teamId,
            athlete_id: null,
            visibility_start: input.visibilityStart,
            visibility_date: input.visibilityStart === "scheduled" ? input.visibilityDate : null,
            created_by_user_id: contextResult.data.userId,
          },
        ]
      : athleteAssignmentIds.map((athleteId) => ({
          tenant_id: contextResult.data.tenantId,
          plan_id: planId,
          scope: "athlete" as const,
          team_id: null,
          athlete_id: athleteId,
          visibility_start: input.visibilityStart,
          visibility_date: input.visibilityStart === "scheduled" ? input.visibilityDate : null,
          created_by_user_id: contextResult.data.userId,
        }))

  if (assignmentInserts.length > 0) {
    const { error: assignmentError } = await clientResult.client.from("training_plan_assignments").insert(assignmentInserts)
    if (assignmentError) return { ok: false, error: mapPostgrestError(assignmentError) }
  }

  return ok({
    planId,
    assignedCount: input.assignTarget === "team" ? athleteAssignmentIds.length : assignmentInserts.length,
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

export async function getAssignedTrainingPlansForCurrentAthlete(): Promise<Result<TrainingPlanSummary[]>> {
  const clientResult = requireSupabaseClient("getAssignedTrainingPlansForCurrentAthlete")
  if (!clientResult.ok) return clientResult

  const athleteContext = await getCurrentAthleteContext(clientResult.client)
  if (!athleteContext.ok) return athleteContext

  const { data: assignments, error: assignmentsError } = await clientResult.client
    .from("training_plan_assignments")
    .select("plan_id, scope, team_id, athlete_id")
    .or(`athlete_id.eq.${athleteContext.data.athleteId},team_id.eq.${athleteContext.data.teamId ?? "00000000-0000-0000-0000-000000000000"}`)

  if (assignmentsError) return { ok: false, error: mapPostgrestError(assignmentsError) }

  const planIds = [...new Set(((assignments as Array<{ plan_id: string }> | null) ?? []).map((row) => row.plan_id))]
  if (planIds.length === 0) return ok([])

  const { data: plans, error: plansError } = await clientResult.client
    .from("training_plans")
    .select("id, name, team_id, start_date, weeks, status")
    .in("id", planIds)
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
    .select("id, week_number, emphasis, status")
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
