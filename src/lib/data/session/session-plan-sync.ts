import type { SupabaseClient } from "@supabase/supabase-js"
import { mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { rowForAthlete, type SessionBlueprint } from "@/lib/data/session/session-from-plan"

/**
 * Writes sessions an athlete can log against, built from a published plan.
 *
 * Who runs this:
 * - the coach, when a plan is published or re-published (every assigned athlete, every planned day
 *   from today on), so adherence counts planned days whether or not the athlete ever opens them;
 * - the athlete, for a single day, when a published plan has a session for them but the row is
 *   missing (they joined the team after the plan went out).
 *
 * A session is identified by (athlete, plan, week, day). That slot is unique in the database,
 * so running this twice never duplicates a session.
 */

export type SessionSeed = {
  tenantId: string
  athleteId: string
  planId: string
  createdByUserId: string | null
  blueprint: SessionBlueprint
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CHUNK = 200
const PAGE = 1000

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

export function slotKey(athleteId: string, week: number | null, dayIndex: number | null) {
  return `${athleteId}:${week}:${dayIndex}`
}

export async function insertSessionsFromBlueprints(client: SupabaseClient, seeds: SessionSeed[]): Promise<Result<{ created: number }>> {
  let created = 0
  for (const batch of chunks(seeds, 100)) {
    const { data: sessionRows, error: sessionError } = await client
      .from("sessions")
      .insert(
        batch.map((seed) => ({
          tenant_id: seed.tenantId,
          athlete_id: seed.athleteId,
          title: seed.blueprint.title,
          status: "scheduled",
          scheduled_for: seed.blueprint.date,
          estimated_duration_minutes: seed.blueprint.durationMinutes,
          planned_effort: seed.blueprint.plannedEffort ?? null,
          coach_note: seed.blueprint.coachNote,
          created_by_user_id: seed.createdByUserId,
          plan_id: seed.planId,
          plan_week_number: seed.blueprint.week,
          plan_day_index: seed.blueprint.dayIndex,
          session_type: seed.blueprint.sessionType,
          location: seed.blueprint.location,
        })),
      )
      .select("id, athlete_id, plan_week_number, plan_day_index")
    if (sessionError) return { ok: false, error: mapPostgrestError(sessionError) }

    const sessionIdBySlot = new Map(
      ((sessionRows as Array<{ id: string; athlete_id: string; plan_week_number: number; plan_day_index: number }> | null) ?? []).map(
        (row) => [slotKey(row.athlete_id, row.plan_week_number, row.plan_day_index), row.id],
      ),
    )
    created += sessionIdBySlot.size

    const blockInserts = batch.flatMap((seed) => {
      const sessionId = sessionIdBySlot.get(slotKey(seed.athleteId, seed.blueprint.week, seed.blueprint.dayIndex))
      if (!sessionId) return []
      return seed.blueprint.blocks.map((block) => ({
        row: {
          session_id: sessionId,
          sort_order: block.sortOrder,
          block_type: block.blockType,
          name: block.name,
          focus: block.focus,
          coach_note: block.coachNote,
        },
        // Each athlete gets the coach's changes for them ("except David: 70%").
        block: { ...block, rows: block.rows.map((row) => rowForAthlete(row, seed.athleteId)) },
      }))
    })

    for (const blockBatch of chunks(blockInserts)) {
      const { data: blockRows, error: blockError } = await client
        .from("session_blocks")
        .insert(blockBatch.map((entry) => entry.row))
        .select("id, session_id, sort_order")
      if (blockError) return { ok: false, error: mapPostgrestError(blockError) }

      const blockIdByKey = new Map(
        ((blockRows as Array<{ id: string; session_id: string; sort_order: number }> | null) ?? []).map((row) => [
          `${row.session_id}:${row.sort_order}`,
          row.id,
        ]),
      )
      const rowInserts = blockBatch.flatMap((entry) => {
        const blockId = blockIdByKey.get(`${entry.row.session_id}:${entry.row.sort_order}`)
        if (!blockId) return []
        return entry.block.rows.map((row) => ({
          session_block_id: blockId,
          sort_order: row.sortOrder,
          label: row.label,
          target: row.target,
          helper: row.helper,
          log_kind: row.kind,
          target_sets: row.targetSets,
          target_reps: row.targetReps,
          target_load: row.targetLoad,
          // A percentage of a best lift: the database turns it into kilograms for this athlete
          // (resolve_session_row_load, migration 20261011090000) and keeps it up to date.
          percent_1rm: row.percent ?? null,
          lift_name: row.percent != null ? (row.liftName ?? null) : null,
          target_volume: row.volume ?? null,
          cue: row.helper,
          reference_url: row.referenceUrl ?? null,
          exercise_id: UUID.test(row.exerciseId ?? "") ? row.exerciseId : null,
        }))
      })
      for (const rowBatch of chunks(rowInserts, 500)) {
        const { error: rowError } = await client.from("session_block_rows").insert(rowBatch)
        if (rowError) return { ok: false, error: mapPostgrestError(rowError) }
      }
    }
  }
  return ok({ created })
}

type ExistingPlanSession = {
  id: string
  athlete_id: string
  plan_week_number: number | null
  plan_day_index: number | null
  status: "scheduled" | "in-progress" | "completed"
  scheduled_for: string
}

async function listPlanSessions(client: SupabaseClient, planId: string): Promise<Result<ExistingPlanSession[]>> {
  const rows: ExistingPlanSession[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("sessions")
      .select("id, athlete_id, plan_week_number, plan_day_index, status, scheduled_for")
      .eq("plan_id", planId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    const page = (data as ExistingPlanSession[] | null) ?? []
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return ok(rows)
}

/**
 * Sessions the athlete has not touched and that are not in the past. Only these are ever replaced or removed.
 * The database flips status to in-progress on the first logged set and to completed on completion,
 * and completions are checked as well in case a session was completed without logging anything.
 */
async function splitReplaceable(
  client: SupabaseClient,
  sessions: ExistingPlanSession[],
  fromDate: string,
): Promise<Result<{ replaceable: ExistingPlanSession[]; kept: ExistingPlanSession[] }>> {
  const candidates = sessions.filter((session) => session.status === "scheduled" && session.scheduled_for >= fromDate)
  const completed = new Set<string>()
  for (const batch of chunks(candidates.map((session) => session.id))) {
    const { data, error } = await client.from("session_completions").select("session_id").in("session_id", batch)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    for (const row of (data as Array<{ session_id: string }> | null) ?? []) completed.add(row.session_id)
  }
  const replaceableIds = new Set(candidates.filter((session) => !completed.has(session.id)).map((session) => session.id))
  return ok({
    replaceable: sessions.filter((session) => replaceableIds.has(session.id)),
    kept: sessions.filter((session) => !replaceableIds.has(session.id)),
  })
}

async function deleteSessions(client: SupabaseClient, ids: string[]): Promise<Result<null>> {
  for (const batch of chunks(ids)) {
    // The status filter is a last guard: a session the athlete started in the meantime is left alone.
    const { error } = await client.from("sessions").delete().in("id", batch).eq("status", "scheduled")
    if (error) return { ok: false, error: mapPostgrestError(error) }
  }
  return ok(null)
}

/**
 * Makes the sessions of a plan match the plan, from `fromDate` on.
 * Untouched upcoming sessions are replaced. Anything the athlete started, finished, or that is
 * already in the past stays exactly as it is, so history and logged results are never lost.
 */
export async function syncPlanSessions(
  client: SupabaseClient,
  params: {
    tenantId: string
    userId: string
    planId: string
    athleteIds: string[]
    blueprints: SessionBlueprint[]
    fromDate: string
  },
): Promise<Result<{ created: number; removed: number; kept: number }>> {
  const existingResult = await listPlanSessions(client, params.planId)
  if (!existingResult.ok) return existingResult
  const splitResult = await splitReplaceable(client, existingResult.data, params.fromDate)
  if (!splitResult.ok) return splitResult
  const { replaceable, kept } = splitResult.data

  const deleteResult = await deleteSessions(
    client,
    replaceable.map((session) => session.id),
  )
  if (!deleteResult.ok) return deleteResult

  const keptSlots = new Set(kept.map((session) => slotKey(session.athlete_id, session.plan_week_number, session.plan_day_index)))
  const seeds: SessionSeed[] = params.athleteIds.flatMap((athleteId) =>
    params.blueprints
      .filter((blueprint) => blueprint.date >= params.fromDate)
      .filter((blueprint) => !keptSlots.has(slotKey(athleteId, blueprint.week, blueprint.dayIndex)))
      .map((blueprint) => ({
        tenantId: params.tenantId,
        athleteId,
        planId: params.planId,
        createdByUserId: params.userId,
        blueprint,
      })),
  )
  const insertResult = await insertSessionsFromBlueprints(client, seeds)
  if (!insertResult.ok) return insertResult
  return ok({ created: insertResult.data.created, removed: replaceable.length, kept: kept.length })
}

/** Removes the untouched upcoming sessions of a plan that is being archived or deleted. */
export async function removeUnstartedPlanSessions(client: SupabaseClient, planId: string, fromDate: string): Promise<Result<{ removed: number }>> {
  const existingResult = await listPlanSessions(client, planId)
  if (!existingResult.ok) return existingResult
  const splitResult = await splitReplaceable(client, existingResult.data, fromDate)
  if (!splitResult.ok) return splitResult
  const deleteResult = await deleteSessions(
    client,
    splitResult.data.replaceable.map((session) => session.id),
  )
  if (!deleteResult.ok) return deleteResult
  return ok({ removed: splitResult.data.replaceable.length })
}
