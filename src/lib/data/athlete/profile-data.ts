import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

type ClientResolution =
  | { ok: true; client: SupabaseClient }
  | { ok: false; error: DataError }

export type CurrentAthleteProfileSnapshot = {
  athleteId: string
  name: string
  email: string
  age: number | null
  primaryEvent: string | null
  eventGroup: string | null
  readiness: "green" | "yellow" | "red" | null
  teamName: string | null
  teamEventGroup: string | null
  adherencePercent: number | null
  lastWellnessDate: string | null
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

export async function getCurrentAthleteProfileSnapshot(): Promise<Result<CurrentAthleteProfileSnapshot>> {
  const clientResult = requireSupabaseClient("getCurrentAthleteProfileSnapshot")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const session = authSession.session
  const userId = session?.user.id
  const userEmail = session?.user.email
  if (!userId || !userEmail) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data, error } = await clientResult.client
    .from("athletes")
    .select("id, first_name, last_name, date_of_birth, primary_event, event_group, readiness, teams(name, event_group)")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return err("NOT_FOUND", "Athlete profile record not found for current user.")

  const athleteId = data.id as string
  const teamRow = Array.isArray(data.teams) ? data.teams[0] : data.teams
  const [adherenceResult, wellnessResult] = await Promise.all([
    getAthleteAdherencePercent(clientResult.client, athleteId),
    getAthleteLatestWellnessDate(clientResult.client, athleteId),
  ])
  if (!adherenceResult.ok) return adherenceResult
  if (!wellnessResult.ok) return wellnessResult

  return ok({
    athleteId,
    name: `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || "Athlete",
    email: userEmail,
    age: calculateAgeFromDateOfBirth(data.date_of_birth as string | null),
    primaryEvent: data.primary_event ?? null,
    eventGroup: data.event_group ?? null,
    readiness: data.readiness ?? null,
    teamName: teamRow?.name ?? null,
    teamEventGroup: teamRow?.event_group ?? null,
    adherencePercent: adherenceResult.data,
    lastWellnessDate: wellnessResult.data,
  })
}

function calculateAgeFromDateOfBirth(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null
  const dob = new Date(`${dateOfBirth}T00:00:00`)
  if (Number.isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDelta = today.getMonth() - dob.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) {
    age -= 1
  }
  return age >= 0 ? age : null
}

async function getAthleteLatestWellnessDate(client: SupabaseClient, athleteId: string): Promise<Result<string | null>> {
  const { data, error } = await client
    .from("wellness_entries")
    .select("entry_date")
    .eq("athlete_id", athleteId)
    .order("entry_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok((data?.entry_date as string | undefined) ?? null)
}

async function getAthleteAdherencePercent(client: SupabaseClient, athleteId: string): Promise<Result<number | null>> {
  const since = new Date()
  since.setDate(since.getDate() - 28)
  const sinceDate = since.toISOString().slice(0, 10)

  const [{ count: sessionsCount, error: sessionsError }, { count: completionsCount, error: completionsError }] = await Promise.all([
    client
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("athlete_id", athleteId)
      .gte("scheduled_for", sinceDate),
    client
      .from("session_completions")
      .select("id", { count: "exact", head: true })
      .eq("athlete_id", athleteId)
      .gte("completion_date", sinceDate),
  ])

  if (sessionsError) return { ok: false, error: mapPostgrestError(sessionsError) }
  if (completionsError) return { ok: false, error: mapPostgrestError(completionsError) }

  const totalSessions = sessionsCount ?? 0
  const totalCompletions = completionsCount ?? 0
  if (totalSessions <= 0) return ok(null)
  return ok(Math.max(0, Math.min(100, Math.round((totalCompletions / totalSessions) * 100))))
}
