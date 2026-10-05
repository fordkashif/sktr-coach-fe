export type ExerciseCategory = "sprint" | "strength" | "plyometric" | "throws" | "jumps" | "mobility" | "conditioning" | "other"
/** What a row of this exercise is measured in by default. */
export type ExerciseMeasure = "reps_load" | "time" | "distance"

export const EXERCISE_CATEGORIES: Array<{ value: ExerciseCategory; label: string }> = [
  { value: "sprint", label: "Sprint" },
  { value: "strength", label: "Strength" },
  { value: "plyometric", label: "Plyometric" },
  { value: "throws", label: "Throws" },
  { value: "jumps", label: "Jumps" },
  { value: "mobility", label: "Mobility" },
  { value: "conditioning", label: "Conditioning" },
  { value: "other", label: "Other" },
]

export const EXERCISE_MEASURES: Array<{ value: ExerciseMeasure; label: string }> = [
  { value: "reps_load", label: "Reps and load" },
  { value: "time", label: "Time" },
  { value: "distance", label: "Distance" },
]

export function categoryLabel(category: ExerciseCategory) {
  return EXERCISE_CATEGORIES.find((entry) => entry.value === category)?.label ?? "Other"
}

export function measureLabel(measure: ExerciseMeasure) {
  return EXERCISE_MEASURES.find((entry) => entry.value === measure)?.label ?? "Reps and load"
}

/** One saved exercise of a club, shared by its coaches. */
export type LibraryExercise = {
  id: string
  name: string
  category: ExerciseCategory
  measure: ExerciseMeasure
  cue: string | null
  /** http or https link to a video or a reference page. */
  linkUrl: string | null
  archived: boolean
  createdByUserId: string | null
  updatedAt: string | null
}

export type LibraryExerciseInput = {
  name: string
  category: ExerciseCategory
  measure: ExerciseMeasure
  cue: string | null
  linkUrl: string | null
}

export type LiftMaxSource = "coach" | "athlete" | "result"

/** An athlete's best single lift (1RM) for one lift. */
export type LiftMax = {
  /** Null for a best that comes straight from the results history and was never saved as a max. */
  id: string | null
  athleteId: string
  /** See liftKey(). */
  liftKey: string
  liftName: string
  valueKg: number
  /** ISO day. */
  measuredOn: string | null
  source: LiftMaxSource
}

export type LiftMaxInput = { athleteId: string; liftName: string; valueKg: number; measuredOn?: string | null }

export function validateExerciseInput(input: LibraryExerciseInput, linkAsTyped: string): string | null {
  const name = input.name.trim()
  if (!name) return "Give the exercise a name."
  if (name.length > 80) return "Keep the name under 80 characters."
  if ((input.cue ?? "").length > 500) return "Keep the coaching cue under 500 characters."
  if (linkAsTyped.trim() && !input.linkUrl) return "The link must start with http:// or https:// and have no spaces."
  return null
}
