import type { SupabaseClient } from "@supabase/supabase-js"
import {
  achievementFromResults,
  currentBest,
  sortGoals,
  validateGoalInput,
  type AthleteGoal,
  type GoalInput,
} from "@/lib/data/goals/goal-logic"
import { loadMockGoals, saveMockGoals, toMockGoalAthleteId } from "@/lib/data/goals/mock-goals-store"
import { cleanLabel, eventGroupKey, findResultEvent, OTHER_EVENT_KEY, type AthleteResult, type MarkUnit } from "@/lib/data/pr/marks"
import { MOCK_ATHLETE_ID, mockId } from "@/lib/data/pr/mock-results-store"
import { getAthleteResults, getCurrentAthleteIdentity, localToday } from "@/lib/data/pr/results-data"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { MOCK_ROLE_STORAGE_KEY } from "@/lib/mock-auth"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * Goals: a target mark in an event, with an optional date and note.
 *
 * The athlete sets their own. The coaches of the athlete's team and club admins read, add, change
 * and remove them; the database refuses everyone else (see
 * supabase/migrations/20261011110000_athlete_goals_and_history.sql). Whether a goal is achieved is
 * decided by the database from the athlete's results; mock mode applies the same rule in the
 * browser. Progress is never stored: the screens work it out from the results returned here.
 */

export type AthleteGoalsView = {
  athleteId: string
  /** Open goals first, then achieved ones. */
  goals: AthleteGoal[]
  /** Every result of the athlete, newest first. Progress and the event list come from these. */
  results: AthleteResult[]
}

const GOAL_COLUMNS =
  "id, athlete_id, event_key, event_label, event_group, mark_unit, lower_is_better, target_value, start_value, target_date, note, achieved_on, achieved_result_id, achieved_manually, set_by_staff, created_at"

type GoalRow = {
  id: string
  athlete_id: string
  event_key: string
  event_label: string
  event_group: string
  mark_unit: MarkUnit
  lower_is_better: boolean
  target_value: number | string
  start_value: number | string | null
  target_date: string | null
  note: string | null
  achieved_on: string | null
  achieved_result_id: string | null
  achieved_manually: boolean
  set_by_staff: boolean
  created_at: string
}

function mapGoalRow(row: GoalRow): AthleteGoal {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    eventKey: row.event_key,
    eventLabel: row.event_label,
    eventGroup: row.event_group,
    unit: row.mark_unit,
    lowerIsBetter: row.lower_is_better,
    targetValue: Number(row.target_value),
    startValue: row.start_value === null ? null : Number(row.start_value),
    targetDate: row.target_date ? row.target_date.slice(0, 10) : null,
    note: row.note,
    achievedOn: row.achieved_on ? row.achieved_on.slice(0, 10) : null,
    achievedResultId: row.achieved_result_id,
    achievedManually: row.achieved_manually,
    setByStaff: row.set_by_staff,
    createdAt: row.created_at,
  }
}

function isMock() {
  return getBackendMode() !== "supabase"
}

function requireClient(operation: string): Result<SupabaseClient> {
  const client = getBrowserSupabaseClient()
  return client ? ok(client) : err("UNKNOWN", `[${operation}] Supabase client is not configured.`)
}

/** Shown when the database refuses a goal write, in place of the raw row level security text. */
const GOAL_FORBIDDEN = "You cannot change this goal. Only the athlete, the coaches of their team and club admins can."

/** What the goal is measured in and which way is better, from the event list or the athlete's own test. */
function resolveGoalEvent(input: GoalInput): { eventKey: string; label: string; unit: MarkUnit; lowerIsBetter: boolean } | null {
  const event = findResultEvent(input.eventKey)
  if (event && event.kind !== "other" && event.unit) {
    return { eventKey: event.key, label: event.name, unit: event.unit, lowerIsBetter: Boolean(event.lowerIsBetter) }
  }
  const label = cleanLabel(input.eventLabel ?? "")
  if (!label || !input.unit) return null
  return { eventKey: OTHER_EVENT_KEY, label, unit: input.unit, lowerIsBetter: input.lowerIsBetter ?? input.unit === "s" }
}

/* ---------- Mock ---------------------------------------------------------------------------------- */

/** Mock mode: apply the achievement rule the database trigger applies, and keep the store in step. */
function refreshMockGoals(results: AthleteResult[]): AthleteGoal[] {
  const stored = loadMockGoals()
  let changed = false
  const next = stored.map((goal) => {
    const own = results.filter((result) => result.athleteId === goal.athleteId)
    const achievement = achievementFromResults(goal, own)
    if (achievement.achievedOn === goal.achievedOn && achievement.achievedResultId === goal.achievedResultId) return goal
    changed = true
    return { ...goal, ...achievement }
  })
  if (changed) saveMockGoals(next)
  return next
}

function mockActsAsStaff(): boolean {
  if (typeof window === "undefined") return false
  const role = window.localStorage.getItem(MOCK_ROLE_STORAGE_KEY)
  return role === "coach" || role === "club-admin"
}

/* ---------- Reading ------------------------------------------------------------------------------- */

/** The goals and results of one athlete. For staff: an athlete they may manage. */
export async function getAthleteGoals(athleteId: string): Promise<Result<AthleteGoalsView>> {
  if (isMock()) {
    const storeId = toMockGoalAthleteId(athleteId)
    const resultsResult = await getAthleteResults(storeId)
    if (!resultsResult.ok) return resultsResult
    const goals = refreshMockGoals(resultsResult.data).filter((goal) => goal.athleteId === storeId)
    return ok({ athleteId, goals: sortGoals(goals), results: resultsResult.data })
  }

  const clientResult = requireClient("getAthleteGoals")
  if (!clientResult.ok) return clientResult
  const [goalsResponse, resultsResult] = await Promise.all([
    clientResult.data.from("athlete_goals").select(GOAL_COLUMNS).eq("athlete_id", athleteId).order("created_at", { ascending: false }).limit(200),
    getAthleteResults(athleteId),
  ])
  if (goalsResponse.error) return { ok: false, error: mapPostgrestError(goalsResponse.error) }
  if (!resultsResult.ok) return resultsResult
  const goals = ((goalsResponse.data as GoalRow[] | null) ?? []).map(mapGoalRow)
  return ok({ athleteId, goals: sortGoals(goals), results: resultsResult.data })
}

export async function getCurrentAthleteGoals(): Promise<Result<AthleteGoalsView>> {
  if (isMock()) return getAthleteGoals(MOCK_ATHLETE_ID)
  const clientResult = requireClient("getCurrentAthleteGoals")
  if (!clientResult.ok) return clientResult
  const identity = await getCurrentAthleteIdentity(clientResult.data)
  if (!identity.ok) return identity
  return getAthleteGoals(identity.data.athleteId)
}

/* ---------- Writing ------------------------------------------------------------------------------- */

/** Set a goal for an athlete. `results` are the athlete's results (from the view), used to check the target. */
export async function addAthleteGoal(athleteId: string, input: GoalInput, results: AthleteResult[]): Promise<Result<AthleteGoal>> {
  const event = resolveGoalEvent(input)
  if (!event) return err("VALIDATION", "Choose an event.")
  const group = eventGroupKey(event.eventKey, event.label)
  const best = currentBest(results, group, event.lowerIsBetter)
  const invalid = validateGoalInput(input, { lowerIsBetter: event.lowerIsBetter, best: best?.compareValue ?? null, today: localToday(), isNew: true })
  if (invalid) return err("VALIDATION", invalid)

  if (isMock()) {
    const goal: AthleteGoal = {
      id: mockId("goal"),
      athleteId: toMockGoalAthleteId(athleteId),
      eventKey: event.eventKey,
      eventLabel: event.label,
      eventGroup: group,
      unit: event.unit,
      lowerIsBetter: event.lowerIsBetter,
      targetValue: input.targetValue,
      startValue: best?.compareValue ?? null,
      targetDate: input.targetDate,
      note: input.note?.trim() || null,
      achievedOn: null,
      achievedResultId: null,
      achievedManually: false,
      setByStaff: mockActsAsStaff(),
      createdAt: new Date().toISOString(),
    }
    saveMockGoals([goal, ...loadMockGoals()])
    return ok(goal)
  }

  const clientResult = requireClient("addAthleteGoal")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.data
    .from("athlete_goals")
    .insert({
      athlete_id: athleteId,
      event_key: event.eventKey,
      event_label: event.label,
      mark_unit: event.unit,
      lower_is_better: event.lowerIsBetter,
      target_value: input.targetValue,
      target_date: input.targetDate,
      note: input.note?.trim() || null,
    })
    .select(GOAL_COLUMNS)
    .single()
  if (error) {
    const mapped = mapPostgrestError(error)
    return { ok: false, error: mapped.code === "VALIDATION" ? { ...mapped, message: error.message } : mapped }
  }
  return ok(mapGoalRow(data as GoalRow))
}

/** Change the target, date or note of a goal. The event of a goal does not change. */
export async function updateAthleteGoal(goal: AthleteGoal, input: Pick<GoalInput, "targetValue" | "targetDate" | "note">): Promise<Result<AthleteGoal>> {
  const invalid = validateGoalInput({ ...input, eventKey: goal.eventKey }, { lowerIsBetter: goal.lowerIsBetter, best: null, today: localToday(), isNew: false })
  if (invalid) return err("VALIDATION", invalid)

  if (isMock()) {
    let updated: AthleteGoal | null = null
    const resultsResult = await getAthleteResults(goal.athleteId)
    const results = resultsResult.ok ? resultsResult.data : []
    saveMockGoals(
      loadMockGoals().map((existing) => {
        if (existing.id !== goal.id) return existing
        const changed = { ...existing, targetValue: input.targetValue, targetDate: input.targetDate, note: input.note?.trim() || null }
        updated = { ...changed, ...achievementFromResults(changed, results) }
        return updated
      }),
    )
    return updated ? ok(updated) : err("NOT_FOUND", "This goal no longer exists.")
  }

  const clientResult = requireClient("updateAthleteGoal")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.data
    .from("athlete_goals")
    .update({ target_value: input.targetValue, target_date: input.targetDate, note: input.note?.trim() || null })
    .eq("id", goal.id)
    .select(GOAL_COLUMNS)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  const row = ((data as GoalRow[] | null) ?? [])[0]
  return row ? ok(mapGoalRow(row)) : err("FORBIDDEN", GOAL_FORBIDDEN)
}

/**
 * Mark a goal achieved by hand (today), or open it again. Opening it again lets the results
 * decide: if a result already meets the target, the goal stays achieved on that result's day.
 */
export async function setAthleteGoalAchieved(goal: AthleteGoal, achieved: boolean): Promise<Result<AthleteGoal>> {
  if (isMock()) {
    let updated: AthleteGoal | null = null
    const resultsResult = await getAthleteResults(goal.athleteId)
    const results = resultsResult.ok ? resultsResult.data : []
    saveMockGoals(
      loadMockGoals().map((existing) => {
        if (existing.id !== goal.id) return existing
        const changed: AthleteGoal = achieved
          ? { ...existing, achievedManually: true, achievedOn: localToday(), achievedResultId: null }
          : { ...existing, achievedManually: false, achievedOn: null, achievedResultId: null }
        updated = { ...changed, ...achievementFromResults(changed, results) }
        return updated
      }),
    )
    return updated ? ok(updated) : err("NOT_FOUND", "This goal no longer exists.")
  }

  const clientResult = requireClient("setAthleteGoalAchieved")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.data
    .from("athlete_goals")
    .update(achieved ? { achieved_manually: true, achieved_on: localToday() } : { achieved_manually: false })
    .eq("id", goal.id)
    .select(GOAL_COLUMNS)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  const row = ((data as GoalRow[] | null) ?? [])[0]
  return row ? ok(mapGoalRow(row)) : err("FORBIDDEN", GOAL_FORBIDDEN)
}

export async function deleteAthleteGoal(goalId: string): Promise<Result<{ goalId: string }>> {
  if (isMock()) {
    saveMockGoals(loadMockGoals().filter((goal) => goal.id !== goalId))
    return ok({ goalId })
  }
  const clientResult = requireClient("deleteAthleteGoal")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.data.from("athlete_goals").delete().eq("id", goalId).select("id")
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) return err("FORBIDDEN", GOAL_FORBIDDEN)
  return ok({ goalId })
}
