import { Plus, X } from "@phosphor-icons/react"
import { useEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react"
import { RowMenu, StatusText, SuggestInput } from "@/components/sk"
import { cleanReferenceUrl, liftKey, mergeOverride, parsePercent } from "@/lib/data/exercises/loads"
import { categoryLabel, type ExerciseCategory, type ExerciseMeasure, type LibraryExercise } from "@/lib/data/exercises/types"
import { inferLogKind } from "@/lib/data/session/session-from-plan"
import { makeId, newExercise, type ExerciseDraft, type ExerciseOverrideDraft } from "@/lib/data/training-plan/plan-builder-model"
import { cn } from "@/lib/utils"
import type { AthleteOption } from "./storage"
import { plural } from "./ui"
import type { ExerciseTools } from "./use-exercise-tools"
import { useUnits } from "@/lib/units-store"
import { describePercentLoadFor, loadFieldForViewer, loadFieldToStored } from "@/lib/units"

const FIELDS = ["name", "sets", "reps", "load"] as const
type FieldKey = (typeof FIELDS)[number]
const HEADERS: Record<FieldKey, string> = { name: "Exercise", sets: "Sets", reps: "Reps", load: "Load" }
const PLACEHOLDERS: Record<Exclude<FieldKey, "load">, string> = { name: "Exercise", sets: "Sets", reps: "Reps" }

// Name, sets, reps, load, the "more" menu, remove. On a phone the name takes a line of its own.
const GRID =
  "grid items-center gap-x-2 gap-y-1.5 grid-cols-[repeat(3,minmax(0,1fr))_2.75rem_2.75rem] sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_6rem_2.75rem_2.75rem]"
const ICON_BUTTON =
  "inline-flex size-11 cursor-pointer items-center justify-center rounded-[12px] text-sk-mute transition-colors hover:bg-sk-soft hover:text-sk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"

/**
 * The load box of a row. The coach types and reads loads in their own unit; what is kept in the plan
 * is metric ("225" typed by a coach on pounds is kept as "102.06 kg"). A percentage, "BW" or a time
 * is kept as typed. On kilograms this is a plain input.
 */
function LoadInput({ value, onValueChange, placeholder, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onValueChange: (stored: string) => void }) {
  const units = useUnits()
  // What is being typed, so "22" is not rewritten to "22 lb" half way to "225".
  const [typing, setTyping] = useState<string | null>(null)
  if (units.weight === "kg") return <input {...rest} placeholder={placeholder} value={value} onChange={(event) => onValueChange(event.target.value)} />
  return (
    <input
      {...rest}
      placeholder={placeholder}
      value={typing ?? loadFieldForViewer(value, units.weight)}
      onFocus={() => setTyping(loadFieldForViewer(value, units.weight))}
      onChange={(event) => {
        setTyping(event.target.value)
        onValueChange(loadFieldToStored(event.target.value, units.weight))
      }}
      onBlur={() => setTyping(null)}
    />
  )
}

/** What a row typed by hand is saved to the library as. The coach can change it under Exercises. */
function guessLibraryFields(blockTitle: string, exercise: ExerciseDraft): { category: ExerciseCategory; measure: ExerciseMeasure } {
  const text = `${exercise.name} ${blockTitle}`.toLowerCase()
  const kind = parsePercent(exercise.load) !== null ? "strength" : inferLogKind(blockTitle, exercise)
  if (/mobility|stretch|warm|activation|physio/.test(text)) return { category: "mobility", measure: "reps_load" }
  if (/plyo|bound|hop|box jump|depth/.test(text)) return { category: "plyometric", measure: kind === "mark" ? "distance" : "reps_load" }
  if (/throw|shot|discus|javelin|hammer|med ball/.test(text)) return { category: "throws", measure: "distance" }
  if (/jump|approach|takeoff|vault/.test(text)) return { category: "jumps", measure: "distance" }
  if (kind === "strength") return { category: "strength", measure: "reps_load" }
  if (/tempo|interval|hill|run\b/.test(text)) return { category: "conditioning", measure: "time" }
  if (kind === "time") return { category: "sprint", measure: "time" }
  return { category: "other", measure: "reps_load" }
}

/**
 * The exercises of one block: a table you type straight into (name, sets, reps, load), built for
 * the keyboard like the kit's EditableRows (Tab across, Enter down and on to a new row, Backspace
 * in an empty row removes it), plus what a plan row can carry:
 * - the name suggests exercises from the club library; picking one links the row to it,
 * - a load written as a percentage ("80%") is a percentage of each athlete's best lift,
 * - "Adjust for an athlete" lists changes for single athletes under the row.
 */
export function ExerciseRows({
  blockIndex,
  blockTitle,
  exercises,
  athletes,
  tools,
  onChange,
  className,
}: {
  blockIndex: number
  blockTitle: string
  exercises: ExerciseDraft[]
  /** The athletes of the plan's team. */
  athletes: AthleteOption[]
  tools: ExerciseTools
  onChange: (updater: (exercises: ExerciseDraft[]) => ExerciseDraft[]) => void
  className?: string
}) {
  const units = useUnits()
  const root = useRef<HTMLDivElement | null>(null)
  const focusNewRow = useRef(false)
  const focusOverride = useRef<string | null>(null)
  // What "Save to library" last did, said under the row it was used on.
  const [libraryNote, setLibraryNote] = useState<{ exerciseId: string; ok: boolean; text: string } | null>(null)

  const focusCell = (rowIndex: number, columnIndex: number) => {
    root.current?.querySelector<HTMLInputElement>(`[data-cell="${rowIndex}:${columnIndex}"]`)?.focus()
  }

  useEffect(() => {
    if (!focusNewRow.current) return
    focusNewRow.current = false
    focusCell(exercises.length - 1, 0)
  }, [exercises.length])

  useEffect(() => {
    if (!focusOverride.current) return
    const node = root.current?.querySelector<HTMLSelectElement>(`[data-override-id="${focusOverride.current}"] select`)
    focusOverride.current = null
    node?.focus()
  })

  const patch = (exerciseId: string, change: Partial<ExerciseDraft>) =>
    onChange((current) => current.map((exercise) => (exercise.id === exerciseId ? { ...exercise, ...change } : exercise)))
  const remove = (exerciseId: string) => onChange((current) => current.filter((exercise) => exercise.id !== exerciseId))
  const add = () => {
    focusNewRow.current = true
    onChange((current) => [...current, newExercise()])
  }

  const libraryByKey = new Map(tools.library.map((exercise) => [liftKey(exercise.name), exercise]))
  const linkFields = (entry: LibraryExercise): Partial<ExerciseDraft> => ({ libraryId: entry.id, cue: entry.cue ?? "", link: entry.linkUrl ?? "" })
  const options = tools.library.map((exercise) => ({ id: exercise.id, label: exercise.name, detail: categoryLabel(exercise.category) }))

  const setName = (exercise: ExerciseDraft, name: string) => {
    // Renaming a row to something else cuts its tie to the library exercise.
    const linked = exercise.libraryId ? tools.library.find((entry) => entry.id === exercise.libraryId) : null
    const stillLinked = !exercise.libraryId || (linked ? liftKey(linked.name) === liftKey(name) : true)
    patch(exercise.id, stillLinked ? { name } : { name, libraryId: null, cue: "", link: "" })
  }

  const saveToLibrary = async (exercise: ExerciseDraft) => {
    const name = exercise.name.trim()
    const result = await tools.addToLibrary({ name, ...guessLibraryFields(blockTitle, exercise), cue: null, linkUrl: null })
    if (!result.ok) return setLibraryNote({ exerciseId: exercise.id, ok: false, text: `Not saved to the library. ${result.error.message}` })
    patch(exercise.id, linkFields(result.data))
    setLibraryNote({ exerciseId: exercise.id, ok: true, text: `${result.data.name} is in the library. Add a coaching cue or a link under Exercises.` })
  }

  const addOverride = (exercise: ExerciseDraft) => {
    const override: ExerciseOverrideDraft = { id: makeId("ovr"), athleteId: "", sets: "", reps: "", load: "", note: "" }
    focusOverride.current = override.id
    patch(exercise.id, { overrides: [...(exercise.overrides ?? []), override] })
  }
  const patchOverride = (exercise: ExerciseDraft, overrideId: string, change: Partial<ExerciseOverrideDraft>) =>
    patch(exercise.id, { overrides: (exercise.overrides ?? []).map((override) => (override.id === overrideId ? { ...override, ...change } : override)) })

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) => {
    const exercise = exercises[rowIndex]
    const values = FIELDS.map((key) => exercise[key])
    if (event.key === "Enter") {
      event.preventDefault()
      if (rowIndex < exercises.length - 1) return focusCell(rowIndex + 1, columnIndex)
      if (values.some((value) => value.trim())) add()
      return
    }
    if (event.key === "Backspace" && columnIndex === 0 && values.every((value) => !value)) {
      event.preventDefault()
      remove(exercise.id)
      window.requestAnimationFrame(() => focusCell(Math.max(0, rowIndex - 1), 0))
    }
  }

  return (
    <div ref={root} className={cn("flex flex-col gap-1.5", className)}>
      {exercises.length > 0 ? (
        <div className={cn(GRID, "hidden text-sm font-semibold text-sk-mute sm:grid")} aria-hidden>
          {FIELDS.map((key) => (
            <span key={key} className={key === "name" ? "pl-0.5" : "pl-2.5"}>
              {HEADERS[key]}
            </span>
          ))}
        </div>
      ) : null}

      {exercises.map((exercise, rowIndex) => {
        const label = `Block ${blockIndex + 1} exercise ${rowIndex + 1}`
        const percent = parsePercent(exercise.load)
        const liftName = exercise.percentOf?.trim() || exercise.name.trim()
        const overrides = exercise.overrides ?? []
        const link = cleanReferenceUrl(exercise.link)
        const known = percent !== null && liftName ? athletes.filter((athlete) => tools.maxFor(athlete.id, liftName) !== null) : []
        const missing = percent !== null && liftName ? athletes.filter((athlete) => tools.maxFor(athlete.id, liftName) === null) : []
        const note = libraryNote?.exerciseId === exercise.id ? libraryNote : null
        const hasDetails = percent !== null || Boolean(exercise.cue) || Boolean(link) || overrides.length > 0 || note !== null

        return (
          <div key={exercise.id} data-exercise-row className="border-b border-sk-line pb-2.5 last:border-b-0 sm:border-b-0 sm:pb-0">
            <div className={GRID}>
              {FIELDS.map((key, columnIndex) =>
                key === "name" ? (
                  <div key={key} className="col-span-full sm:col-span-1">
                    <SuggestInput
                      data-cell={`${rowIndex}:0`}
                      aria-label={`${label} name`}
                      placeholder={PLACEHOLDERS.name}
                      listLabel="Exercises in the library"
                      enterKeyHint={rowIndex === exercises.length - 1 ? "done" : "next"}
                      value={exercise.name}
                      options={options}
                      onValueChange={(name) => setName(exercise, name)}
                      onPick={(option) => {
                        const entry = tools.library.find((candidate) => candidate.id === option.id)
                        if (entry) patch(exercise.id, { name: entry.name, ...linkFields(entry) })
                      }}
                      onBlur={() => {
                        // A name typed in full is the library exercise all the same.
                        const entry = libraryByKey.get(liftKey(exercise.name))
                        if (entry && exercise.libraryId !== entry.id) patch(exercise.id, linkFields(entry))
                      }}
                      onKeyDown={(event) => onKeyDown(event, rowIndex, 0)}
                    />
                  </div>
                ) : key === "load" ? (
                  <LoadInput
                    key={key}
                    data-cell={`${rowIndex}:${columnIndex}`}
                    className="sk-field px-2.5"
                    aria-label={`${label} ${key}`}
                    placeholder={`${units.weightLabel} or %`}
                    autoComplete="off"
                    enterKeyHint={rowIndex === exercises.length - 1 ? "done" : "next"}
                    value={exercise.load}
                    onValueChange={(load) => patch(exercise.id, { load })}
                    onKeyDown={(event) => onKeyDown(event, rowIndex, columnIndex)}
                  />
                ) : (
                  <input
                    key={key}
                    data-cell={`${rowIndex}:${columnIndex}`}
                    className="sk-field px-2.5"
                    aria-label={`${label} ${key}`}
                    placeholder={PLACEHOLDERS[key]}
                    autoComplete="off"
                    enterKeyHint={rowIndex === exercises.length - 1 ? "done" : "next"}
                    value={exercise[key]}
                    onChange={(event) => patch(exercise.id, { [key]: event.target.value })}
                    onKeyDown={(event) => onKeyDown(event, rowIndex, columnIndex)}
                  />
                ),
              )}
              <RowMenu
                label={`More for ${label.toLowerCase()}`}
                className="size-11"
                items={[
                  { label: "Adjust for an athlete", onSelect: () => addOverride(exercise), disabled: athletes.length === 0 || overrides.length >= athletes.length },
                  ...(exercise.libraryId ? [] : [{ label: "Save to library", onSelect: () => void saveToLibrary(exercise), disabled: !exercise.name.trim() }]),
                ]}
              />
              <button type="button" className={ICON_BUTTON} aria-label={`Remove ${label.toLowerCase()}`} onClick={() => remove(exercise.id)}>
                <X className="size-4" weight="bold" aria-hidden />
              </button>
            </div>

            {hasDetails ? (
              <div className="mt-1.5 flex flex-col gap-2 pb-2 sm:pr-[5.75rem]" data-exercise-details>
                {note ? (
                  <p role="status" className="text-sm">
                    <StatusText tone={note.ok ? "green" : "coral"}>{note.text}</StatusText>
                  </p>
                ) : null}

                {exercise.cue || link ? (
                  <p className="sk-list-sub">
                    {exercise.cue ? `Cue for athletes: ${exercise.cue} ` : null}
                    {link ? (
                      <a className="sk-link" href={link} target="_blank" rel="noreferrer noopener">
                        Open the reference link
                      </a>
                    ) : null}
                  </p>
                ) : null}

                {percent !== null ? (
                  <div className="flex flex-col gap-1.5">
                    <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-sk-mute">
                      <span>Percent of each athlete's best</span>
                      <input
                        className="sk-field h-10 min-w-0 flex-1 sm:max-w-56"
                        aria-label={`${label} percent of which lift`}
                        placeholder={exercise.name.trim() || "Lift, for example Back squat"}
                        autoComplete="off"
                        maxLength={80}
                        value={exercise.percentOf ?? ""}
                        onChange={(event) => patch(exercise.id, { percentOf: event.target.value })}
                      />
                    </label>
                    {!liftName ? (
                      <p className="sk-list-sub">Name the exercise, or the lift the percentage is taken from.</p>
                    ) : athletes.length > 0 ? (
                      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-sk-mute">
                        <StatusText tone={missing.length === 0 ? "green" : "amber"}>
                          Best {liftName} saved for {known.length} of {plural(athletes.length, "athlete")}
                        </StatusText>
                        {missing.length > 0 ? (
                          <span>
                            Missing: {missing.slice(0, 3).map((athlete) => athlete.name).join(", ")}
                            {missing.length > 3 ? ` and ${missing.length - 3} more` : ""}. They see the percentage only.{" "}
                            <a className="sk-link" href={`/coach/training-plan/maxes?lift=${encodeURIComponent(liftName)}`} target="_blank" rel="noreferrer">
                              Add best lifts
                            </a>
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {overrides.length > 0 ? (
                  <ul className="flex flex-col gap-2" aria-label={`Changes for single athletes, ${label.toLowerCase()}`}>
                    {overrides.map((override) => {
                      const athlete = athletes.find((candidate) => candidate.id === override.athleteId) ?? null
                      const taken = new Set(overrides.filter((other) => other.id !== override.id).map((other) => other.athleteId))
                      const own = mergeOverride(exercise, override)
                      const ownPercent = parsePercent(own.load)
                      const volume = own.sets.trim() && own.reps.trim() ? `${own.sets.trim()} x ${own.reps.trim()}` : own.reps.trim() || (own.sets.trim() ? `${own.sets.trim()} sets` : "")
                      // Said in the coach's own unit: a percentage to the nearest 2.5 kg or 5 lb.
                      const gets =
                        ownPercent !== null
                          ? [volume, describePercentLoadFor(ownPercent, athlete && liftName ? tools.maxFor(athlete.id, liftName) : null, units.weight)].filter(Boolean).join(" at ")
                          : [volume, own.load.trim() ? `at ${loadFieldForViewer(own.load.trim(), units.weight)}` : ""].filter(Boolean).join(" ")
                      const who = athlete?.name ?? "this athlete"
                      return (
                        <li key={override.id} data-override-id={override.id} className="flex flex-col gap-1.5 border-l-2 border-sk-line pl-3">
                          <div className={GRID}>
                            <select
                              className="sk-field col-span-full sm:col-span-1"
                              aria-label={`${label} change for which athlete`}
                              value={override.athleteId}
                              onChange={(event) => patchOverride(exercise, override.id, { athleteId: event.target.value })}
                            >
                              <option value="">Choose an athlete</option>
                              {athletes
                                .filter((candidate) => !taken.has(candidate.id))
                                .map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    {candidate.name}
                                  </option>
                                ))}
                            </select>
                            {(["sets", "reps", "load"] as const).map((key) =>
                              key === "load" ? (
                                <LoadInput
                                  key={key}
                                  className="sk-field px-2.5"
                                  aria-label={`${label} ${key} for ${who}`}
                                  placeholder={exercise.load ? loadFieldForViewer(exercise.load, units.weight) : `${units.weightLabel} or %`}
                                  autoComplete="off"
                                  value={override.load}
                                  onValueChange={(load) => patchOverride(exercise, override.id, { load })}
                                />
                              ) : (
                                <input
                                  key={key}
                                  className="sk-field px-2.5"
                                  aria-label={`${label} ${key} for ${who}`}
                                  // Empty means the same as the row, so the row's own value shows through.
                                  placeholder={exercise[key] || PLACEHOLDERS[key]}
                                  autoComplete="off"
                                  value={override[key]}
                                  onChange={(event) => patchOverride(exercise, override.id, { [key]: event.target.value })}
                                />
                              ),
                            )}
                            <span aria-hidden />
                            <button
                              type="button"
                              className={ICON_BUTTON}
                              aria-label={`Remove the change for ${who}`}
                              onClick={() => patch(exercise.id, { overrides: overrides.filter((other) => other.id !== override.id) })}
                            >
                              <X className="size-4" weight="bold" aria-hidden />
                            </button>
                          </div>
                          <input
                            className="sk-field sm:mr-[5.75rem] sm:w-auto"
                            aria-label={`${label} note for ${who}`}
                            placeholder="Note for this athlete, for example a swap (optional)"
                            autoComplete="off"
                            maxLength={200}
                            value={override.note}
                            onChange={(event) => patchOverride(exercise, override.id, { note: event.target.value })}
                          />
                          <p className="sk-list-sub" data-override-summary>
                            {athlete ? `${athlete.name} gets ${gets || "the same as everyone else"}${override.note.trim() ? `. ${override.note.trim()}` : ""}` : "Everyone else keeps the row above."}
                          </p>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}

      <button type="button" data-add-row className="sk-btn sk-btn-text sk-btn-sm -ml-2.5 self-start" onClick={add}>
        <Plus className="size-4" weight="bold" aria-hidden />
        Add exercise
      </button>
    </div>
  )
}
