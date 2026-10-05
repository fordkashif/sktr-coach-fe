import type { SupabaseClient } from "@supabase/supabase-js"
import { cleanReferenceUrl, liftKey } from "@/lib/data/exercises/loads"
import type { ExerciseCategory, ExerciseMeasure, LibraryExercise, LibraryExerciseInput, LiftMax, LiftMaxInput } from "@/lib/data/exercises/types"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * The club exercise library and the athletes' best lifts (1RM).
 * One API for both backends. The real backend reads and writes the tables of migration
 * 20261011090000 (exercise_library, athlete_lift_maxes), where row level security decides who may
 * do what: coaches and club admins manage the library of their own club; a best lift is visible to
 * the athlete, the coaches of the athlete's team and club admins. Mock mode keeps the same shape
 * in this browser (mock-exercise-store.ts, loaded only in mock mode).
 */

const isMock = () => getBackendMode() !== "supabase"
const mockStore = () => import("@/lib/data/exercises/mock-exercise-store")

type Context = { client: SupabaseClient; userId: string; tenantId: string }

async function getContext(): Promise<Result<Context>> {
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")
  const { data: profile, error } = await client.from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  return ok({ client, userId, tenantId: profile.tenant_id as string })
}

/* ------------------------------------ Library ------------------------------------ */

const EXERCISE_COLUMNS = "id, name, category, measure, cue, link_url, is_archived, created_by_user_id, updated_at"

type ExerciseRow = {
  id: string
  name: string
  category: ExerciseCategory
  measure: ExerciseMeasure
  cue: string | null
  link_url: string | null
  is_archived: boolean
  created_by_user_id: string | null
  updated_at: string | null
}

function mapExercise(row: ExerciseRow): LibraryExercise {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    measure: row.measure,
    cue: row.cue,
    linkUrl: row.link_url,
    archived: row.is_archived,
    createdByUserId: row.created_by_user_id,
    updatedAt: row.updated_at,
  }
}

const nameTaken = (clash: Pick<LibraryExercise, "name" | "archived">) =>
  clash.archived
    ? `"${clash.name}" is in the library already, archived. Restore it instead of adding it again.`
    : `"${clash.name}" is in the library already.`

/** Every exercise of the club, archived ones included, by name. */
export async function listLibraryExercises(): Promise<Result<LibraryExercise[]>> {
  if (isMock()) return ok((await mockStore()).listMockExercises())
  const context = await getContext()
  if (!context.ok) return context
  const { data, error } = await context.data.client.from("exercise_library").select(EXERCISE_COLUMNS).order("name", { ascending: true }).limit(1000)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(((data as ExerciseRow[] | null) ?? []).map(mapExercise))
}

function cleanInput(input: LibraryExerciseInput): Result<LibraryExerciseInput> {
  const name = input.name.trim()
  if (!name || !liftKey(name)) return err("VALIDATION", "Give the exercise a name.")
  if (name.length > 80) return err("VALIDATION", "Keep the name under 80 characters.")
  const cue = input.cue?.trim() || null
  if (cue && cue.length > 500) return err("VALIDATION", "Keep the coaching cue under 500 characters.")
  const linkUrl = input.linkUrl?.trim() ? cleanReferenceUrl(input.linkUrl) : null
  if (input.linkUrl?.trim() && !linkUrl) return err("VALIDATION", "The link must start with http:// or https:// and have no spaces.")
  return ok({ name, category: input.category, measure: input.measure, cue, linkUrl })
}

/** Adds an exercise (id null) or changes one. A name can only be used once in a club. */
export async function saveLibraryExercise(id: string | null, input: LibraryExerciseInput): Promise<Result<LibraryExercise>> {
  const cleaned = cleanInput(input)
  if (!cleaned.ok) return cleaned
  if (isMock()) {
    const saved = (await mockStore()).saveMockExercise(id, cleaned.data)
    return "conflict" in saved ? err("CONFLICT", nameTaken(saved.conflict)) : ok(saved.exercise)
  }
  const context = await getContext()
  if (!context.ok) return context
  const { client, tenantId, userId } = context.data
  const fields = { name: cleaned.data.name, category: cleaned.data.category, measure: cleaned.data.measure, cue: cleaned.data.cue, link_url: cleaned.data.linkUrl }
  const query = id
    ? client.from("exercise_library").update(fields).eq("id", id).select(EXERCISE_COLUMNS).maybeSingle()
    : client.from("exercise_library").insert({ ...fields, tenant_id: tenantId, created_by_user_id: userId }).select(EXERCISE_COLUMNS).maybeSingle()
  const { data, error } = await query
  if (error) {
    if (error.code === "23505") return err("CONFLICT", `"${cleaned.data.name}" is in the library already. If you cannot see it, look under Archived.`, error)
    return { ok: false, error: mapPostgrestError(error) }
  }
  if (!data) return err("NOT_FOUND", "This exercise could not be saved. It may be gone, or you may not have access.")
  return ok(mapExercise(data as ExerciseRow))
}

export async function setLibraryExerciseArchived(id: string, archived: boolean): Promise<Result<LibraryExercise>> {
  if (isMock()) {
    const saved = (await mockStore()).setMockExerciseArchived(id, archived)
    return saved ? ok(saved) : err("NOT_FOUND", "This exercise no longer exists.")
  }
  const context = await getContext()
  if (!context.ok) return context
  const { data, error } = await context.data.client.from("exercise_library").update({ is_archived: archived }).eq("id", id).select(EXERCISE_COLUMNS).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return err("NOT_FOUND", "This exercise could not be changed. It may be gone, or you may not have access.")
  return ok(mapExercise(data as ExerciseRow))
}

/* ----------------------------------- Best lifts ----------------------------------- */

type MaxRow = { id: string; athlete_id: string; lift_key: string; lift_name: string; value_kg: number | string; measured_on: string | null; source: "coach" | "athlete" }

function mapMax(row: MaxRow): LiftMax {
  return { id: row.id, athleteId: row.athlete_id, liftKey: row.lift_key, liftName: row.lift_name, valueKg: Number(row.value_kg), measuredOn: row.measured_on, source: row.source }
}

const MAX_COLUMNS = "id, athlete_id, lift_key, lift_name, value_kg, measured_on, source"

/**
 * Pure: saved maxes, plus the best kilogram result per lift where no max was saved.
 * The same rule the database uses when it works out a load (athlete_lift_max_kg_unchecked).
 */
export function mergeLiftMaxes(saved: LiftMax[], results: Array<{ athleteId: string; label: string; valueKg: number; date: string | null }>): LiftMax[] {
  const have = new Set(saved.map((max) => `${max.athleteId}:${max.liftKey}`))
  const best = new Map<string, LiftMax>()
  for (const result of results) {
    const key = liftKey(result.label)
    const id = `${result.athleteId}:${key}`
    if (!key || have.has(id)) continue
    const current = best.get(id)
    if (!current || result.valueKg > current.valueKg) {
      best.set(id, { id: null, athleteId: result.athleteId, liftKey: key, liftName: result.label.replace(/\s*\(?\b(1\s*rm|max)\b\)?\s*$/i, "").trim() || result.label, valueKg: result.valueKg, measuredOn: result.date, source: "result" })
    }
  }
  return [...saved, ...best.values()]
}

/** Best lifts of the given athletes (or of everyone the signed-in user may see). */
export async function listLiftMaxes(athleteIds?: string[]): Promise<Result<LiftMax[]>> {
  if (isMock()) return ok((await mockStore()).listMockLiftMaxes(athleteIds))
  if (athleteIds && athleteIds.length === 0) return ok([])
  const context = await getContext()
  if (!context.ok) return context
  const { client } = context.data

  let maxQuery = client.from("athlete_lift_maxes").select(MAX_COLUMNS).limit(5000)
  if (athleteIds) maxQuery = maxQuery.in("athlete_id", athleteIds)
  const { data: maxRows, error: maxError } = await maxQuery
  if (maxError) return { ok: false, error: mapPostgrestError(maxError) }

  let resultQuery = client.from("athlete_results").select("athlete_id, event_label, mark_value, result_date").eq("mark_unit", "kg").limit(5000)
  if (athleteIds) resultQuery = resultQuery.in("athlete_id", athleteIds)
  const { data: resultRows, error: resultError } = await resultQuery
  if (resultError) return { ok: false, error: mapPostgrestError(resultError) }

  return ok(
    mergeLiftMaxes(
      ((maxRows as MaxRow[] | null) ?? []).map(mapMax),
      ((resultRows as Array<{ athlete_id: string; event_label: string; mark_value: number | string; result_date: string | null }> | null) ?? []).map((row) => ({
        athleteId: row.athlete_id,
        label: row.event_label,
        valueKg: Number(row.mark_value),
        date: row.result_date,
      })),
    ),
  )
}

function validateMax(input: LiftMaxInput): string | null {
  if (!liftKey(input.liftName)) return "Name the lift."
  if (input.liftName.trim().length > 80) return "Keep the lift name under 80 characters."
  if (!Number.isFinite(input.valueKg) || input.valueKg <= 0) return "Write the best lift in kilograms, like 120."
  if (input.valueKg > 1000) return "That is more than anyone has lifted. Check the number."
  return null
}

/**
 * Saves (or corrects) an athlete's best lift. One per athlete and lift.
 * The athlete's sessions that are not finished show the new weight straight away.
 */
export async function saveLiftMax(input: LiftMaxInput): Promise<Result<LiftMax>> {
  const invalid = validateMax(input)
  if (invalid) return err("VALIDATION", invalid)
  const valueKg = Math.round(input.valueKg * 100) / 100
  if (isMock()) return ok((await mockStore()).saveMockLiftMax({ ...input, valueKg }))
  const context = await getContext()
  if (!context.ok) return context
  const { client, tenantId } = context.data
  const { data, error } = await client
    .from("athlete_lift_maxes")
    .upsert(
      { tenant_id: tenantId, athlete_id: input.athleteId, lift_name: input.liftName.trim(), value_kg: valueKg, measured_on: input.measuredOn ?? new Date().toISOString().slice(0, 10) },
      { onConflict: "athlete_id,lift_key" },
    )
    .select(MAX_COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return err("FORBIDDEN", "This best lift could not be saved. You may not coach this athlete's team.")
  return ok(mapMax(data as MaxRow))
}

/** Removes a saved best lift. A best from the athlete's results, when there is one, is used again. */
export async function removeLiftMax(athleteId: string, liftName: string): Promise<Result<null>> {
  if (isMock()) {
    ;(await mockStore()).removeMockLiftMax(athleteId, liftName)
    return ok(null)
  }
  const context = await getContext()
  if (!context.ok) return context
  const { error } = await context.data.client.from("athlete_lift_maxes").delete().eq("athlete_id", athleteId).eq("lift_key", liftKey(liftName))
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(null)
}

/** For the signed-in athlete: their own best lifts. The athlete screens can call this as it is. */
export async function listMyLiftMaxes(): Promise<Result<LiftMax[]>> {
  if (isMock()) return ok((await mockStore()).listMockLiftMaxes(["a1"]))
  const context = await getContext()
  if (!context.ok) return context
  const { data: athlete, error } = await context.data.client.from("athletes").select("id").eq("user_id", context.data.userId).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!athlete) return err("NOT_FOUND", "No athlete profile found for current user.")
  return listLiftMaxes([athlete.id as string])
}
