import { Plus } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { PlansNav } from "@/components/coach/training-plan/plans-nav"
import {
  ActionRow,
  Button,
  Dialog,
  EmptyState,
  Field,
  FilterBar,
  FilterChips,
  FormGrid,
  Input,
  List,
  Notice,
  RowMenu,
  Screen,
  ScreenHeader,
  SearchInput,
  Section,
  Segmented,
  Select,
  SkeletonRows,
  Textarea,
  StatusText,
} from "@/components/sk"
import { listLibraryExercises, saveLibraryExercise, setLibraryExerciseArchived } from "@/lib/data/exercises/exercise-data"
import { cleanReferenceUrl } from "@/lib/data/exercises/loads"
import {
  EXERCISE_CATEGORIES,
  EXERCISE_MEASURES,
  categoryLabel,
  measureLabel,
  validateExerciseInput,
  type ExerciseCategory,
  type ExerciseMeasure,
  type LibraryExercise,
} from "@/lib/data/exercises/types"

type View = "active" | "archived"
type CategoryFilter = "all" | ExerciseCategory
type Draft = { id: string | null; name: string; category: ExerciseCategory; measure: ExerciseMeasure; cue: string; link: string }

const EMPTY_DRAFT: Draft = { id: null, name: "", category: "strength", measure: "reps_load", cue: "", link: "" }

/** The club's saved exercises: search, filter, add, edit, archive and restore. */
export default function CoachExercisesPage() {
  const [exercises, setExercises] = useState<LibraryExercise[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>("active")
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<CategoryFilter>("all")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  // The last change, said in a line above the list (and read out).
  const [changed, setChanged] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await listLibraryExercises()
    setLoading(false)
    if (!result.ok) return setError(`Could not load the exercises: ${result.error.message}`)
    setError(null)
    setExercises(result.data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => ({ active: exercises.filter((exercise) => !exercise.archived).length, archived: exercises.filter((exercise) => exercise.archived).length }), [exercises])
  const inView = useMemo(() => exercises.filter((exercise) => exercise.archived === (view === "archived")), [exercises, view])
  const query = search.trim().toLowerCase()
  const visible = inView.filter(
    (exercise) => (category === "all" || exercise.category === category) && (!query || exercise.name.toLowerCase().includes(query) || (exercise.cue ?? "").toLowerCase().includes(query)),
  )

  const openEdit = (exercise: LibraryExercise) => {
    setFormError(null)
    setDraft({ id: exercise.id, name: exercise.name, category: exercise.category, measure: exercise.measure, cue: exercise.cue ?? "", link: exercise.linkUrl ?? "" })
  }
  const openNew = () => {
    setFormError(null)
    setDraft({ ...EMPTY_DRAFT, name: view === "active" && visible.length === 0 ? search.trim() : "", category: category === "all" ? "strength" : category })
  }

  const save = async () => {
    if (!draft || saving) return
    const input = { name: draft.name, category: draft.category, measure: draft.measure, cue: draft.cue.trim() || null, linkUrl: cleanReferenceUrl(draft.link) }
    const invalid = validateExerciseInput(input, draft.link)
    if (invalid) return setFormError(invalid)
    setSaving(true)
    const result = await saveLibraryExercise(draft.id, input)
    setSaving(false)
    if (!result.ok) return setFormError(result.error.message)
    setExercises((current) => [...current.filter((exercise) => exercise.id !== result.data.id), result.data].sort((left, right) => left.name.localeCompare(right.name)))
    setDraft(null)
    setChanged(draft.id ? `${result.data.name} saved.` : `${result.data.name} added to the library.`)
  }

  const setArchived = async (exercise: LibraryExercise, archived: boolean) => {
    setBusyId(exercise.id)
    const result = await setLibraryExerciseArchived(exercise.id, archived)
    setBusyId(null)
    if (!result.ok) return setError(`${exercise.name} was not ${archived ? "archived" : "restored"}. ${result.error.message}`)
    setError(null)
    setExercises((current) => current.map((candidate) => (candidate.id === result.data.id ? result.data : candidate)))
    setChanged(archived ? `${exercise.name} is archived. Plans that use it keep it, and it is no longer suggested.` : `${exercise.name} is back in the library.`)
  }

  const lede = loading
    ? "Getting the library..."
    : counts.active === 0
      ? "Save the exercises your club uses, with a cue and a video link, and pick them when you build a plan."
      : `${counts.active} saved ${counts.active === 1 ? "exercise" : "exercises"}, shared by every coach in the club.`

  return (
    <Screen>
      <ScreenHeader
        title="Exercises"
        lede={lede}
        actions={
          <Button variant="primary" onClick={openNew}>
            <Plus className="size-5" weight="bold" aria-hidden />
            Add exercise
          </Button>
        }
      />
      <PlansNav />

      {error ? <Notice tone="error">{error}</Notice> : null}

      <Section
        title="Library"
        hint={
          changed ? (
            <span role="status">
              <StatusText tone="green">{changed}</StatusText>
            </span>
          ) : undefined
        }
        action={
          exercises.length > 0 ? (
            <Segmented<View>
              label="Show"
              value={view}
              onChange={setView}
              options={[
                { value: "active", label: `In use ${counts.active}` },
                { value: "archived", label: `Archived ${counts.archived}` },
              ]}
            />
          ) : null
        }
      >
        {loading ? (
          <SkeletonRows rows={6} label="Loading exercises" />
        ) : exercises.length === 0 ? (
          <EmptyState
            title="No exercises yet"
            body="Exercises you save here are suggested while you type in the plan builder."
            action={
              <Button size="sm" onClick={openNew}>
                Add the first exercise
              </Button>
            }
          />
        ) : (
          <>
            <FilterBar
              className="mt-3"
              search={<SearchInput aria-label="Search exercises" placeholder="Search exercises" value={search} onChange={(event) => setSearch(event.target.value)} />}
              activeCount={category === "all" ? 0 : 1}
              onClear={() => setCategory("all")}
            >
              <FilterChips<CategoryFilter>
                label="Category"
                value={category}
                onChange={setCategory}
                options={[
                  { value: "all", label: "All" },
                  ...EXERCISE_CATEGORIES.filter((entry) => inView.some((exercise) => exercise.category === entry.value)).map((entry) => ({ value: entry.value, label: entry.label })),
                ]}
              />
            </FilterBar>

            {visible.length === 0 ? (
              <EmptyState
                title={inView.length === 0 ? (view === "archived" ? "Nothing archived" : "No exercises in use") : "No exercise matches"}
                body={
                  inView.length === 0
                    ? view === "archived"
                      ? "Exercises you archive are kept here and can be restored."
                      : "Every exercise is archived. Restore one or add a new one."
                    : "Try another word or category, or add it as a new exercise."
                }
                action={
                  view === "active" ? (
                    <Button size="sm" onClick={openNew}>
                      {query ? `Add "${search.trim()}"` : "Add exercise"}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <List aria-label={view === "archived" ? "Archived exercises" : "Exercises"} className="mt-2">
                {visible.map((exercise) => (
                  <ActionRow
                    key={exercise.id}
                    data-exercise-id={exercise.id}
                    title={exercise.name}
                    subtitle={[`${categoryLabel(exercise.category)}, ${measureLabel(exercise.measure).toLowerCase()}`, exercise.cue?.replace(/[.\s]+$/, ""), exercise.linkUrl ? "Has a link" : null].filter(Boolean).join(". ")}
                    disabled={busyId === exercise.id}
                    onClick={() => openEdit(exercise)}
                    actions={
                      <RowMenu
                        label={`More for ${exercise.name}`}
                        items={[
                          { label: "Edit", onSelect: () => openEdit(exercise) },
                          ...(exercise.linkUrl ? [{ label: "Open the link", onSelect: () => window.open(exercise.linkUrl ?? "", "_blank", "noopener,noreferrer") }] : []),
                          exercise.archived
                            ? { label: "Restore", onSelect: () => void setArchived(exercise, false), disabled: busyId === exercise.id }
                            : { label: "Archive", onSelect: () => void setArchived(exercise, true), disabled: busyId === exercise.id },
                        ]}
                      />
                    }
                  />
                ))}
              </List>
            )}
          </>
        )}
      </Section>

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => (open ? undefined : setDraft(null))}
        title={draft?.id ? "Edit exercise" : "Add exercise"}
        description="Coaches in your club can pick it in the plan builder. Athletes see the cue with the exercise in their session."
        footer={
          <>
            <Button variant="quiet" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving..." : draft?.id ? "Save exercise" : "Add to library"}
            </Button>
          </>
        }
      >
        {draft ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            {formError ? <Notice tone="error">{formError}</Notice> : null}
            <Field label="Name">
              <Input value={draft.name} maxLength={80} autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Back squat" />
            </Field>
            <FormGrid>
              <Field label="Category">
                <Select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as ExerciseCategory })}>
                  {EXERCISE_CATEGORIES.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Measured in">
                <Select value={draft.measure} onChange={(event) => setDraft({ ...draft, measure: event.target.value as ExerciseMeasure })}>
                  {EXERCISE_MEASURES.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormGrid>
            <Field label="Coaching cue" optional hint="One or two things to think about while doing it.">
              <Textarea value={draft.cue} maxLength={500} rows={3} onChange={(event) => setDraft({ ...draft, cue: event.target.value })} placeholder="Brace before you go down. Knees track over toes." />
            </Field>
            <Field label="Video or reference link" optional hint="A web address that starts with https://. Files cannot be uploaded.">
              <Input type="url" inputMode="url" value={draft.link} maxLength={500} onChange={(event) => setDraft({ ...draft, link: event.target.value })} placeholder="https://" />
            </Field>
            <button type="submit" hidden />
          </form>
        ) : null}
      </Dialog>
    </Screen>
  )
}
