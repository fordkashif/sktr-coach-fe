import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import type {
  WellnessEntry,
  WellnessReadiness,
  WellnessSubmissionInput,
  WellnessTrendPoint,
} from "@/lib/data/wellness/types"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

type ClientResolution =
  | { ok: true; client: SupabaseClient }
  | { ok: false; error: DataError }

type AthleteContext = {
  athleteId: string
  tenantId: string
  userId: string
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

async function getCurrentAthleteContext(client: SupabaseClient): Promise<Result<AthleteContext>> {
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: athlete, error } = await client
    .from("athletes")
    .select("id, tenant_id")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!athlete) return err("NOT_FOUND", "No athlete profile found for current user.")

  return ok({
    athleteId: athlete.id,
    tenantId: athlete.tenant_id,
    userId,
  })
}

/** Today's date in the athlete's own timezone (a UTC date would roll over in the evening in Jamaica). */
export function localWellnessDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export const WELLNESS_SLEEP_MAX_HOURS = 16
export const WELLNESS_NOTE_MAX_LENGTH = 500

/** Mirrors the wellness_entries check constraints so bad input is caught before the round trip. */
export function validateWellnessInput(input: WellnessSubmissionInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) return "The check-in date is not valid."
  if (!Number.isFinite(input.sleepHours) || input.sleepHours < 0 || input.sleepHours > WELLNESS_SLEEP_MAX_HOURS) {
    return `Sleep must be between 0 and ${WELLNESS_SLEEP_MAX_HOURS} hours.`
  }
  const scales: Array<[string, number]> = [
    ["Soreness", input.soreness],
    ["Fatigue", input.fatigue],
    ["Mood", input.mood],
    ["Stress", input.stress],
  ]
  for (const [label, value] of scales) {
    if (!Number.isInteger(value) || value < 1 || value > 5) return `${label} needs an answer from 1 to 5.`
  }
  if (input.notes && input.notes.length > WELLNESS_NOTE_MAX_LENGTH) {
    return `Keep the note under ${WELLNESS_NOTE_MAX_LENGTH} characters.`
  }
  return null
}

/** The readiness numbers stored with an entry. Shared by supabase and mock mode so both score the same way. */
export function scoreWellnessInput(input: WellnessSubmissionInput): {
  readiness: WellnessReadiness
  readinessScore: number
  trainingLoad: number
} {
  const readiness = readinessFromInputs(input)
  return {
    readiness,
    readinessScore: readinessScoreFromInputs(input, readiness),
    trainingLoad: trainingLoadFromInputs(input),
  }
}

function readinessFromInputs(input: WellnessSubmissionInput): WellnessReadiness {
  const loadScore = (input.soreness + input.fatigue + input.stress) / 3
  if (loadScore <= 2.5 && input.sleepHours >= 7 && input.mood >= 3) return "green"
  if (loadScore <= 3.5 && input.sleepHours >= 6) return "yellow"
  return "red"
}

function readinessScoreFromInputs(input: WellnessSubmissionInput, readiness: WellnessReadiness): number {
  const sleepContribution = Math.max(0, Math.min(1, input.sleepHours / 9)) * 30
  const moodContribution = (input.mood / 5) * 20
  const sorenessPenalty = ((5 - input.soreness) / 4) * 15
  const fatiguePenalty = ((5 - input.fatigue) / 4) * 20
  const stressPenalty = ((5 - input.stress) / 4) * 15
  const baseScore = Math.round(sleepContribution + moodContribution + sorenessPenalty + fatiguePenalty + stressPenalty)

  if (readiness === "green") return Math.max(baseScore, 70)
  if (readiness === "yellow") return Math.min(Math.max(baseScore, 45), 79)
  return Math.min(baseScore, 55)
}

function trainingLoadFromInputs(input: WellnessSubmissionInput): number {
  const load = Math.round(((input.soreness + input.fatigue + input.stress) / 15) * 100)
  return Math.max(0, Math.min(100, load))
}

type WellnessRow = {
  id: string
  athlete_id: string
  entry_date: string
  sleep_hours: number
  soreness: number
  fatigue: number
  mood: number
  stress: number
  training_load: number
  readiness: WellnessReadiness
  readiness_score: number
  notes: string | null
  created_at: string
}

function mapWellnessRow(row: WellnessRow): WellnessEntry {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    entryDate: row.entry_date,
    sleepHours: row.sleep_hours,
    soreness: row.soreness,
    fatigue: row.fatigue,
    mood: row.mood,
    stress: row.stress,
    trainingLoad: row.training_load,
    readiness: row.readiness,
    readinessScore: row.readiness_score,
    notes: row.notes,
    createdAt: row.created_at,
  }
}

export async function submitCurrentAthleteWellnessEntry(input: WellnessSubmissionInput): Promise<Result<WellnessEntry>> {
  const clientResult = requireSupabaseClient("submitCurrentAthleteWellnessEntry")
  if (!clientResult.ok) return clientResult

  const validationError = validateWellnessInput(input)
  if (validationError) return err("VALIDATION", validationError)

  const athleteContext = await getCurrentAthleteContext(clientResult.client)
  if (!athleteContext.ok) return athleteContext

  const readiness = readinessFromInputs(input)
  const trainingLoad = trainingLoadFromInputs(input)
  const readinessScore = readinessScoreFromInputs(input, readiness)

  const payload = {
    tenant_id: athleteContext.data.tenantId,
    athlete_id: athleteContext.data.athleteId,
    entry_date: input.entryDate,
    sleep_hours: input.sleepHours,
    soreness: input.soreness,
    fatigue: input.fatigue,
    mood: input.mood,
    stress: input.stress,
    training_load: trainingLoad,
    readiness,
    readiness_score: readinessScore,
    notes: input.notes,
    submitted_by_user_id: athleteContext.data.userId,
  }

  const { data, error } = await clientResult.client
    .from("wellness_entries")
    .upsert(payload, { onConflict: "athlete_id,entry_date" })
    .select("id, athlete_id, entry_date, sleep_hours, soreness, fatigue, mood, stress, training_load, readiness, readiness_score, notes, created_at")
    .single()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(mapWellnessRow(data))
}

export async function getCurrentAthleteWellnessEntries(limit = 28): Promise<Result<WellnessEntry[]>> {
  const clientResult = requireSupabaseClient("getCurrentAthleteWellnessEntries")
  if (!clientResult.ok) return clientResult

  const athleteContext = await getCurrentAthleteContext(clientResult.client)
  if (!athleteContext.ok) return athleteContext

  const { data, error } = await clientResult.client
    .from("wellness_entries")
    .select("id, athlete_id, entry_date, sleep_hours, soreness, fatigue, mood, stress, training_load, readiness, readiness_score, notes, created_at")
    .eq("athlete_id", athleteContext.data.athleteId)
    // Newest first so the limit keeps the most recent entries, then flipped back to oldest first for callers.
    .order("entry_date", { ascending: false })
    .limit(limit)

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(((data as WellnessRow[] | null) ?? []).map(mapWellnessRow).reverse())
}

export async function getCurrentAthleteWellnessTrend(limit = 28): Promise<Result<WellnessTrendPoint[]>> {
  const entriesResult = await getCurrentAthleteWellnessEntries(limit)
  if (!entriesResult.ok) return entriesResult

  return ok(
    entriesResult.data.map((entry) => ({
      date: entry.entryDate,
      readiness: entry.readinessScore,
      fatigue: Math.max(0, Math.min(100, Math.round((entry.fatigue / 5) * 100))),
      trainingLoad: entry.trainingLoad,
    })),
  )
}

/* ---------------------------------------------------------------------------
   Mock mode: the demo athlete's check-ins, kept in localStorage per tenant.
--------------------------------------------------------------------------- */

const MOCK_WELLNESS_STORAGE_KEY = "pacelab:wellness-entries"
/** How far back the wellness screens look, in days. */
export const WELLNESS_HISTORY_DAYS = 90

/** Oldest first, the same order getCurrentAthleteWellnessEntries() returns. */
export function loadMockWellnessEntries(): WellnessEntry[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(MOCK_WELLNESS_STORAGE_KEY)) ?? "[]") as WellnessEntry[]
    return Array.isArray(parsed) ? [...parsed].sort((a, b) => a.entryDate.localeCompare(b.entryDate)) : []
  } catch {
    return []
  }
}

/** Saves (or replaces) the demo athlete's check-in for a day, scored the same way as the real one. */
export function saveMockWellnessEntry(input: WellnessSubmissionInput): Result<WellnessEntry> {
  const validationError = validateWellnessInput(input)
  if (validationError) return err("VALIDATION", validationError)

  const entry: WellnessEntry = {
    id: `mock-${input.entryDate}`,
    athleteId: "mock-athlete",
    createdAt: new Date().toISOString(),
    ...input,
    ...scoreWellnessInput(input),
  }
  try {
    const next = [...loadMockWellnessEntries().filter((item) => item.entryDate !== input.entryDate), entry]
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
      .slice(-WELLNESS_HISTORY_DAYS)
    window.localStorage.setItem(tenantStorageKey(MOCK_WELLNESS_STORAGE_KEY), JSON.stringify(next))
  } catch {
    return err("UNKNOWN", "Could not save this check-in on this device.")
  }
  return ok(entry)
}

/** The signed-in athlete's check-ins, oldest first, in either mode. */
export async function loadCurrentAthleteWellnessEntries(limit = WELLNESS_HISTORY_DAYS): Promise<Result<WellnessEntry[]>> {
  if (getBackendMode() !== "supabase") return ok(loadMockWellnessEntries().slice(-limit))
  return getCurrentAthleteWellnessEntries(limit)
}

/** Saves today's (or a given day's) check-in in either mode. */
export async function saveCurrentAthleteWellnessEntry(input: WellnessSubmissionInput): Promise<Result<WellnessEntry>> {
  if (getBackendMode() !== "supabase") return saveMockWellnessEntry(input)
  return submitCurrentAthleteWellnessEntry(input)
}
