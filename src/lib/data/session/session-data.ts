import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import type { SessionBlock, SessionCompletion, SessionSummary } from "@/lib/data/session/types"
import type { SupabaseClient } from "@supabase/supabase-js"

type ClientResolution =
  | { ok: true; client: SupabaseClient }
  | { ok: false; error: DataError }

export type CurrentAthleteLatestSessionDetail = {
  athleteId: string
  athleteFirstName: string
  session: SessionSummary
  blocks: SessionBlock[]
}

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

function mapSessionSummaryRow(row: {
  id: string
  athlete_id: string
  title: string
  status: SessionSummary["status"]
  scheduled_for: string
  estimated_duration_minutes: number | null
  coach_note: string | null
  completed_at: string | null
}): SessionSummary {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    title: row.title,
    status: row.status,
    scheduledFor: row.scheduled_for,
    estimatedDurationMinutes: row.estimated_duration_minutes,
    coachNote: row.coach_note,
    completedAt: row.completed_at,
  }
}

export async function getLatestSessionForAthlete(athleteId: string): Promise<Result<SessionSummary | null>> {
  const clientResult = requireSupabaseClient("getLatestSessionForAthlete")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client
    .from("sessions")
    .select("id, athlete_id, title, status, scheduled_for, estimated_duration_minutes, coach_note, completed_at")
    .eq("athlete_id", athleteId)
    .order("scheduled_for", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return ok(null)
  return ok(mapSessionSummaryRow(data))
}

type SessionBlockRowRecord = {
  id: string
  session_id: string
  sort_order: number
  block_type: SessionBlock["blockType"]
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
  }> | null
}

export async function getSessionBlocksWithRows(sessionId: string): Promise<Result<SessionBlock[]>> {
  const clientResult = requireSupabaseClient("getSessionBlocksWithRows")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client
    .from("session_blocks")
    .select(
      "id, session_id, sort_order, block_type, name, focus, coach_note, previous_result, rest_label, session_block_rows(id, session_block_id, sort_order, label, target, helper)",
    )
    .eq("session_id", sessionId)
    .order("sort_order", { ascending: true })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  const blocks = ((data as SessionBlockRowRecord[] | null) ?? []).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    sortOrder: row.sort_order,
    blockType: row.block_type,
    name: row.name,
    focus: row.focus,
    coachNote: row.coach_note,
    previousResult: row.previous_result,
    restLabel: row.rest_label,
    rows: [...(row.session_block_rows ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((entry) => ({
        id: entry.id,
        sessionBlockId: entry.session_block_id,
        sortOrder: entry.sort_order,
        label: entry.label,
        target: entry.target,
        helper: entry.helper,
      })),
  }))

  return ok(blocks)
}

export async function getWeeklySessionCompletions(
  athleteId: string,
  startDate: string,
  endDate: string,
): Promise<Result<SessionCompletion[]>> {
  const clientResult = requireSupabaseClient("getWeeklySessionCompletions")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client
    .from("session_completions")
    .select("id, session_id, athlete_id, completion_date, completed_at")
    .eq("athlete_id", athleteId)
    .gte("completion_date", startDate)
    .lte("completion_date", endDate)
    .order("completion_date", { ascending: true })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
      id: string
      session_id: string
      athlete_id: string
      completion_date: string
      completed_at: string
    }> | null) ?? []).map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      athleteId: row.athlete_id,
      completionDate: row.completion_date,
      completedAt: row.completed_at,
    })),
  )
}

export async function completeSession(params: {
  sessionId: string
  athleteId: string
  completionDate: string
}): Promise<Result<SessionCompletion>> {
  const clientResult = requireSupabaseClient("completeSession")
  if (!clientResult.ok) return clientResult

  const { data: completion, error: completionError } = await clientResult.client
    .from("session_completions")
    .upsert(
      {
        session_id: params.sessionId,
        athlete_id: params.athleteId,
        completion_date: params.completionDate,
      },
      { onConflict: "session_id,athlete_id" },
    )
    .select("id, session_id, athlete_id, completion_date, completed_at")
    .single()

  if (completionError) return { ok: false, error: mapPostgrestError(completionError) }

  const { error: sessionUpdateError } = await clientResult.client
    .from("sessions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", params.sessionId)
    .eq("athlete_id", params.athleteId)

  if (sessionUpdateError) return { ok: false, error: mapPostgrestError(sessionUpdateError) }

  return ok({
    id: completion.id,
    sessionId: completion.session_id,
    athleteId: completion.athlete_id,
    completionDate: completion.completion_date,
    completedAt: completion.completed_at,
  })
}

export async function completeLatestSessionForCurrentAthlete(completionDate: string): Promise<Result<SessionCompletion>> {
  const clientResult = requireSupabaseClient("completeLatestSessionForCurrentAthlete")
  if (!clientResult.ok) return clientResult

  const athleteIdResult = await getCurrentAthleteId(clientResult.client)
  if (!athleteIdResult.ok) return athleteIdResult

  const latestSession = await getLatestSessionForAthlete(athleteIdResult.data)
  if (!latestSession.ok) return latestSession
  if (!latestSession.data) return err("NOT_FOUND", "No session found for current athlete.")

  return completeSession({
    sessionId: latestSession.data.id,
    athleteId: athleteIdResult.data,
    completionDate,
  })
}

async function getCurrentAthleteId(client: SupabaseClient): Promise<Result<string>> {
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: athlete, error: athleteError } = await client
    .from("athletes")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle()

  if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }
  if (!athlete) return err("NOT_FOUND", "No athlete profile found for current user.")

  return ok(athlete.id)
}

async function getCurrentAthleteContext(client: SupabaseClient): Promise<
  Result<{ athleteId: string; athleteFirstName: string }>
> {
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: athlete, error: athleteError } = await client
    .from("athletes")
    .select("id, first_name")
    .eq("user_id", userId)
    .maybeSingle()

  if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }
  if (!athlete) return err("NOT_FOUND", "No athlete profile found for current user.")

  return ok({
    athleteId: athlete.id,
    athleteFirstName: athlete.first_name ?? "Athlete",
  })
}

export async function getCurrentAthleteWeeklySessionCompletions(
  startDate: string,
  endDate: string,
): Promise<Result<SessionCompletion[]>> {
  const clientResult = requireSupabaseClient("getCurrentAthleteWeeklySessionCompletions")
  if (!clientResult.ok) return clientResult

  const athleteIdResult = await getCurrentAthleteId(clientResult.client)
  if (!athleteIdResult.ok) return athleteIdResult

  return getWeeklySessionCompletions(athleteIdResult.data, startDate, endDate)
}

export async function getLatestSessionDetailForCurrentAthlete(): Promise<Result<CurrentAthleteLatestSessionDetail | null>> {
  const clientResult = requireSupabaseClient("getLatestSessionDetailForCurrentAthlete")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentAthleteContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const latestSessionResult = await getLatestSessionForAthlete(contextResult.data.athleteId)
  if (!latestSessionResult.ok) return latestSessionResult
  if (!latestSessionResult.data) return ok(null)

  const blocksResult = await getSessionBlocksWithRows(latestSessionResult.data.id)
  if (!blocksResult.ok) return blocksResult

  return ok({
    athleteId: contextResult.data.athleteId,
    athleteFirstName: contextResult.data.athleteFirstName,
    session: latestSessionResult.data,
    blocks: blocksResult.data,
  })
}
