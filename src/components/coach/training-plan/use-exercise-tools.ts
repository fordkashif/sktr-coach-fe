import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { listLibraryExercises, listLiftMaxes, saveLibraryExercise } from "@/lib/data/exercises/exercise-data"
import { liftKey } from "@/lib/data/exercises/loads"
import type { LibraryExercise, LibraryExerciseInput, LiftMax } from "@/lib/data/exercises/types"

/**
 * What the plan builder needs from the club library and the athletes' best lifts.
 * Loaded once, and again when the coach comes back to this tab (they may have added a best lift
 * or an exercise in another tab). A failure is quiet: the builder works without suggestions.
 */
export function useExerciseTools(athleteIds: string[]) {
  const [library, setLibrary] = useState<LibraryExercise[]>([])
  const [maxes, setMaxes] = useState<LiftMax[]>([])
  const idsKey = [...athleteIds].sort().join(",")
  const run = useRef(0)

  const load = useCallback(async () => {
    const current = ++run.current
    const ids = idsKey ? idsKey.split(",") : []
    const [libraryResult, maxResult] = await Promise.all([listLibraryExercises(), listLiftMaxes(ids)])
    if (current !== run.current) return
    if (libraryResult.ok) setLibrary(libraryResult.data)
    if (maxResult.ok) setMaxes(maxResult.data)
  }, [idsKey])

  useEffect(() => {
    void load()
    const onFocus = () => void load()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [load])

  const maxByKey = useMemo(() => new Map(maxes.map((max) => [`${max.athleteId}:${max.liftKey}`, max.valueKg])), [maxes])
  const maxFor = useCallback((athleteId: string, liftName: string) => maxByKey.get(`${athleteId}:${liftKey(liftName)}`) ?? null, [maxByKey])

  const addToLibrary = useCallback(async (input: LibraryExerciseInput) => {
    const result = await saveLibraryExercise(null, input)
    if (result.ok) setLibrary((current) => [...current.filter((exercise) => exercise.id !== result.data.id), result.data].sort((left, right) => left.name.localeCompare(right.name)))
    return result
  }, [])

  const active = useMemo(() => library.filter((exercise) => !exercise.archived), [library])
  return { library: active, maxFor, addToLibrary }
}

export type ExerciseTools = ReturnType<typeof useExerciseTools>
