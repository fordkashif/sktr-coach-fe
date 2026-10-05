import { liftKey } from "@/lib/data/exercises/loads"
import type { LibraryExercise, LibraryExerciseInput, LiftMax, LiftMaxInput } from "@/lib/data/exercises/types"
import { mockTestWeekResults } from "@/lib/mock-data"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Mock mode: the club exercise library and the athletes' best lifts, kept in this browser per club.
 * Starts from a small demo library, and from the squat results of the demo test week as best lifts
 * (the same way the real backend falls back to kilogram results when no max was saved).
 */

const STORAGE_KEY = "pacelab:exercise-library:v1"

type StoredState = { exercises: LibraryExercise[]; maxes: LiftMax[]; removedMaxKeys: string[] }

function seedExercise(id: string, name: string, category: LibraryExercise["category"], measure: LibraryExercise["measure"], cue: string | null = null, linkUrl: string | null = null): LibraryExercise {
  return { id: `seed-ex-${id}`, name, category, measure, cue, linkUrl, archived: false, createdByUserId: "mock-coach-user", updatedAt: null }
}

const SEED_EXERCISES: LibraryExercise[] = [
  seedExercise("back-squat", "Back squat", "strength", "reps_load", "Brace before you go down. Knees track over toes.", "https://www.youtube.com/watch?v=ultWZbUMPL8"),
  seedExercise("power-clean", "Power clean", "strength", "reps_load", "Fast elbows. Catch tall."),
  seedExercise("bench-press", "Bench press", "strength", "reps_load"),
  seedExercise("rdl", "Romanian deadlift", "strength", "reps_load", "Hips back, soft knees, flat back."),
  seedExercise("hip-thrust", "Hip thrust", "strength", "reps_load"),
  seedExercise("block-starts", "Block starts", "sprint", "time", "Push the track away. Stay low for the first six steps."),
  seedExercise("flying-30", "Flying 30m", "sprint", "time"),
  seedExercise("tempo-200", "Tempo 200m", "conditioning", "time"),
  seedExercise("bounds", "Alternate leg bounds", "plyometric", "distance", "Long and tall. Flat foot contact."),
  seedExercise("box-jump", "Box jump", "plyometric", "reps_load"),
  seedExercise("med-ball", "Overhead back med ball throw", "throws", "distance"),
  seedExercise("standing-lj", "Standing long jump", "jumps", "distance"),
  seedExercise("hurdle-mobility", "Hurdle mobility walkovers", "mobility", "reps_load"),
  seedExercise("old-leg-press", "Leg press", "strength", "reps_load"),
].map((exercise) => (exercise.id === "seed-ex-old-leg-press" ? { ...exercise, archived: true } : exercise))

function parseKg(text: string | undefined) {
  const value = Number.parseFloat((text ?? "").replace(",", "."))
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Best lifts that come from results, not from a saved max. */
function resultMaxes(): LiftMax[] {
  return mockTestWeekResults.flatMap((row) => {
    const valueKg = parseKg(row.squat1RM?.value)
    if (valueKg === null) return []
    return [{ id: null, athleteId: row.athleteId, liftKey: liftKey("Back squat"), liftName: "Back squat", valueKg, measuredOn: "2026-03-04", source: "result" as const }]
  })
}

function readState(): StoredState {
  const empty: StoredState = { exercises: SEED_EXERCISES, maxes: [], removedMaxKeys: [] }
  if (typeof window === "undefined") return empty
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(STORAGE_KEY))
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<StoredState>
    return {
      exercises: Array.isArray(parsed.exercises) ? parsed.exercises : SEED_EXERCISES,
      maxes: Array.isArray(parsed.maxes) ? parsed.maxes : [],
      removedMaxKeys: Array.isArray(parsed.removedMaxKeys) ? parsed.removedMaxKeys : [],
    }
  } catch {
    return empty
  }
}

function writeState(state: StoredState) {
  window.localStorage.setItem(tenantStorageKey(STORAGE_KEY), JSON.stringify(state))
}

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function listMockExercises(): LibraryExercise[] {
  return [...readState().exercises].sort((left, right) => left.name.localeCompare(right.name))
}

/** Returns a message when the name is already taken (archived exercises count), otherwise saves. */
export function saveMockExercise(id: string | null, input: LibraryExerciseInput): { exercise: LibraryExercise } | { conflict: LibraryExercise } {
  const state = readState()
  const key = liftKey(input.name)
  const clash = state.exercises.find((exercise) => liftKey(exercise.name) === key && exercise.id !== id)
  if (clash) return { conflict: clash }
  const existing = id ? state.exercises.find((exercise) => exercise.id === id) : null
  const exercise: LibraryExercise = {
    id: existing?.id ?? newId("ex"),
    name: input.name.trim(),
    category: input.category,
    measure: input.measure,
    cue: input.cue?.trim() || null,
    linkUrl: input.linkUrl,
    archived: existing?.archived ?? false,
    createdByUserId: existing?.createdByUserId ?? "mock-coach-user",
    updatedAt: new Date().toISOString(),
  }
  writeState({ ...state, exercises: [exercise, ...state.exercises.filter((candidate) => candidate.id !== exercise.id)] })
  return { exercise }
}

export function setMockExerciseArchived(id: string, archived: boolean): LibraryExercise | null {
  const state = readState()
  const existing = state.exercises.find((exercise) => exercise.id === id)
  if (!existing) return null
  const exercise = { ...existing, archived, updatedAt: new Date().toISOString() }
  writeState({ ...state, exercises: state.exercises.map((candidate) => (candidate.id === id ? exercise : candidate)) })
  return exercise
}

const maxKey = (athleteId: string, key: string) => `${athleteId}:${key}`

/** Saved maxes first, then bests from results for lifts with no saved max. */
export function listMockLiftMaxes(athleteIds?: string[]): LiftMax[] {
  const state = readState()
  const saved = new Set(state.maxes.map((max) => maxKey(max.athleteId, max.liftKey)))
  const removed = new Set(state.removedMaxKeys)
  const fromResults = resultMaxes().filter((max) => !saved.has(maxKey(max.athleteId, max.liftKey)) && !removed.has(maxKey(max.athleteId, max.liftKey)))
  const all = [...state.maxes, ...fromResults]
  return athleteIds ? all.filter((max) => athleteIds.includes(max.athleteId)) : all
}

export function mockLiftMaxKg(athleteId: string, liftName: string): number | null {
  const key = liftKey(liftName)
  return listMockLiftMaxes([athleteId]).find((max) => max.liftKey === key)?.valueKg ?? null
}

export function saveMockLiftMax(input: LiftMaxInput, source: "coach" | "athlete" = "coach"): LiftMax {
  const state = readState()
  const key = liftKey(input.liftName)
  const max: LiftMax = {
    id: state.maxes.find((candidate) => candidate.athleteId === input.athleteId && candidate.liftKey === key)?.id ?? newId("max"),
    athleteId: input.athleteId,
    liftKey: key,
    liftName: input.liftName.trim(),
    valueKg: input.valueKg,
    measuredOn: input.measuredOn ?? new Date().toISOString().slice(0, 10),
    source,
  }
  writeState({
    ...state,
    maxes: [max, ...state.maxes.filter((candidate) => !(candidate.athleteId === input.athleteId && candidate.liftKey === key))],
    removedMaxKeys: state.removedMaxKeys.filter((entry) => entry !== maxKey(input.athleteId, key)),
  })
  return max
}

/** Removes a saved max. The best from results (when there is one) shows again. */
export function removeMockLiftMax(athleteId: string, liftName: string) {
  const state = readState()
  const key = liftKey(liftName)
  writeState({ ...state, maxes: state.maxes.filter((candidate) => !(candidate.athleteId === athleteId && candidate.liftKey === key)) })
}
