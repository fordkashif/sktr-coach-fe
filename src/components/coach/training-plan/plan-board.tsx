import { Plus } from "@phosphor-icons/react"
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react"
import { RowMenu } from "@/components/sk"
import { liftKey } from "@/lib/data/exercises/loads"
import {
  SESSION_TYPES,
  formatDayMonth,
  getSession,
  newBlock,
  newExercise,
  newSession,
  putSession,
  slotDate,
  weekdayLabel,
  type BlockDraft,
  type ExerciseDraft,
  type PlanDraft,
  type SessionDraft,
  type SessionType,
} from "@/lib/data/training-plan/plan-builder-model"
import { exerciseLine, looksLikeRows, parseLine, titleFromBlocks, type PastedExercise } from "@/lib/data/training-plan/plan-paste"
import { loadFieldForViewer, loadFieldToStored } from "@/lib/units"
import { useUnits } from "@/lib/units-store"
import { cn } from "@/lib/utils"
import { pasteIntoDay, withAutoTitle } from "./plan-sheet"
import { plural } from "./ui"
import type { ExerciseTools } from "./use-exercise-tools"

function dayOfMonth(dateIso: string) {
  return Number(dateIso.slice(8, 10)) || 0
}

function volumeText(exercise: Pick<ExerciseDraft, "sets" | "reps">) {
  const sets = exercise.sets.trim()
  const reps = exercise.reps.trim()
  if (sets && reps) return `${sets} x ${reps}`
  return reps || (sets ? `${sets} sets` : "")
}

/** What a typed line shows before Enter: the name, sets x reps and load it was read as. */
function previewChips(text: string): string[] {
  const line = parseLine(text)
  if (!line) return []
  if ("heading" in line) return [`Section: ${line.heading}`]
  const row = line.exercise
  return [row.name, volumeText(row), row.load, row.notes].filter(Boolean)
}

/**
 * One day of the week on the board: its name, its type, its rows, and a line at the foot to type
 * the next one ("Back squat 3x5 @80%") or to paste rows from a spreadsheet.
 */
export function BoardDay({
  plan,
  week,
  dayIndex,
  tools,
  focusLine,
  canCopyNext,
  onFocusDone,
  onStarted,
  onChange,
  onOpenTable,
  onOpenDetails,
  onCopyNext,
  onRemove,
  onNotice,
}: {
  plan: PlanDraft
  week: number
  dayIndex: number
  tools: ExerciseTools
  /** True once, right after the session was started: the cursor goes to the typing line. */
  focusLine: boolean
  canCopyNext: boolean
  onFocusDone: () => void
  /** A session was started here: the cursor should go to its typing line. */
  onStarted: () => void
  onChange: (updater: (plan: PlanDraft) => PlanDraft) => void
  onOpenTable: () => void
  onOpenDetails: () => void
  onCopyNext: () => void
  onRemove: () => void
  onNotice: (message: string) => void
}) {
  const units = useUnits()
  const session = getSession(plan, week, dayIndex)
  const date = slotDate(plan, week, dayIndex)
  const dayName = `${weekdayLabel(date)} ${formatDayMonth(date)}`
  const [line, setLine] = useState("")
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const lineRef = useRef<HTMLInputElement | null>(null)
  const libraryByKey = new Map(tools.library.map((entry) => [liftKey(entry.name), entry]))

  useEffect(() => {
    if (!focusLine || !lineRef.current) return
    lineRef.current.focus()
    onFocusDone()
  }, [focusLine, onFocusDone, session])

  const updateBlocks = (updater: (blocks: BlockDraft[]) => BlockDraft[]) =>
    onChange((current) => {
      const existing = getSession(current, week, dayIndex)
      return existing ? putSession(current, withAutoTitle(existing, updater(existing.blocks))) : current
    })
  const updateSession = (patch: Partial<SessionDraft>) =>
    onChange((current) => {
      const existing = getSession(current, week, dayIndex)
      return existing ? putSession(current, { ...existing, ...patch }) : current
    })

  /** A typed row, linked to the club library when its name is a library exercise. */
  const rowFrom = (typed: PastedExercise, base?: ExerciseDraft): ExerciseDraft => {
    const entry = libraryByKey.get(liftKey(typed.name))
    const sameName = base && liftKey(base.name) === liftKey(typed.name)
    return {
      ...(base ?? newExercise()),
      name: typed.name,
      sets: typed.sets,
      reps: typed.reps,
      load: loadFieldToStored(typed.load, units.weight),
      cue: typed.notes || (entry && !sameName ? (entry.cue ?? "") : ""),
      ...(entry ? { libraryId: entry.id, link: entry.linkUrl ?? base?.link ?? "" } : sameName ? {} : { libraryId: null, link: "" }),
    }
  }

  const commitLine = () => {
    const parsed = parseLine(line)
    if (!parsed) return
    setLine("")
    if ("heading" in parsed) return updateBlocks((blocks) => [...blocks, newBlock(parsed.heading)])
    const row = rowFrom(parsed.exercise)
    updateBlocks((blocks) => {
      if (blocks.length === 0) return [{ ...newBlock("Main"), exercises: [row] }]
      const last = blocks[blocks.length - 1]
      return [...blocks.slice(0, -1), { ...last, exercises: [...last.exercises, row] }]
    })
  }

  const pasteRows = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text/plain")
    if (!looksLikeRows(text)) return
    event.preventDefault()
    const result = pasteIntoDay(plan, week, dayIndex, text)
    if (result.count === 0) return
    onChange((current) => pasteIntoDay(current, week, dayIndex, text).plan)
    onNotice(`Pasted ${plural(result.count, "row")} into ${dayName}.`)
  }

  const saveEdit = () => {
    if (!editing) return
    const { id, text } = editing
    setEditing(null)
    const parsed = parseLine(text)
    updateBlocks((blocks) =>
      blocks.map((block) => ({
        ...block,
        exercises: parsed && "exercise" in parsed
          ? block.exercises.map((exercise) => (exercise.id === id ? rowFrom(parsed.exercise, exercise) : exercise))
          : // An emptied line removes the row.
            parsed
            ? block.exercises
            : block.exercises.filter((exercise) => exercise.id !== id),
      })),
    )
  }

  const onEditKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      saveEdit()
    } else if (event.key === "Escape") {
      event.preventDefault()
      setEditing(null)
    }
  }

  if (!session) {
    return (
      <li data-board-day={dayIndex} data-has-session="false" className="sk-board-col sk-board-rest">
        <div className="flex items-center gap-2.5">
          <span className="sk-board-badge" aria-hidden>
            <span>{weekdayLabel(date).toUpperCase()}</span>
            <strong>{dayOfMonth(date)}</strong>
          </span>
          <span className="font-bold text-sk-mute">Rest</span>
        </div>
        <button
          type="button"
          className="sk-board-add"
          aria-label={`${dayName}: rest day. Add a session`}
          onClick={() => {
            onChange((current) => (getSession(current, week, dayIndex) ? current : putSession(current, newSession(week, dayIndex, { sessionType: "Gym" }))))
            onStarted()
          }}
        >
          <Plus className="size-4" weight="bold" aria-hidden />
          Add session
        </button>
      </li>
    )
  }

  const rows = session.blocks.reduce((sum, block) => sum + block.exercises.filter((exercise) => exercise.name.trim()).length, 0)
  const chips = previewChips(line)

  return (
    <li data-board-day={dayIndex} data-has-session="true" className="sk-board-col">
      <div className="flex items-start gap-2.5">
        <span className="sk-board-badge" data-on aria-hidden>
          <span>{weekdayLabel(date).toUpperCase()}</span>
          <strong>{dayOfMonth(date)}</strong>
        </span>
        <div className="min-w-0 flex-1">
          <textarea
            data-session-title
            data-day-title={dayIndex}
            rows={Math.min(4, Math.max(1, Math.ceil((session.title || titleFromBlocks(session.blocks)).length / 17)))}
            className="sk-board-title"
            aria-label={`${dayName} session title`}
            placeholder={titleFromBlocks(session.blocks) || "New session"}
            value={session.title}
            onChange={(event) => updateSession({ title: event.target.value })}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              lineRef.current?.focus()
            }}
          />
          <p className="px-1 text-xs font-semibold text-sk-mute">{plural(rows, "exercise")}</p>
        </div>
        <RowMenu
          label={`More for ${dayName}`}
          className="-mr-1 shrink-0"
          items={[
            { label: "Open as a table", onSelect: onOpenTable, opensOverlay: true },
            { label: "Session details", onSelect: onOpenDetails, opensOverlay: true },
            { label: "Copy to next day", onSelect: onCopyNext, disabled: !canCopyNext },
            { label: "Remove session", onSelect: onRemove, danger: true },
          ]}
        />
      </div>

      <div className="sk-board-types" role="radiogroup" aria-label={`${dayName} session type`}>
        {SESSION_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={session.sessionType === type}
            className="sk-board-type"
            onClick={() => updateSession({ sessionType: type as SessionType })}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="sk-board-card">
        {session.blocks.map((block, blockIndex) => (
          <div key={block.id} data-block-id={block.id}>
            {block.title !== "Main" || blockIndex > 0 ? (
              <input
                className="sk-board-heading"
                aria-label={`${dayName} section ${blockIndex + 1} name`}
                placeholder="Section"
                value={block.title}
                onChange={(event) => updateBlocks((blocks) => blocks.map((candidate) => (candidate.id === block.id ? { ...candidate, title: event.target.value } : candidate)))}
              />
            ) : null}
            <ul aria-label={block.title || `Section ${blockIndex + 1}`}>
              {block.exercises.map((exercise) =>
                editing?.id === exercise.id ? (
                  <li key={exercise.id} data-board-row={exercise.id}>
                    <input
                      autoFocus
                      className="sk-board-line"
                      aria-label={`Change ${exercise.name.trim() || "this row"}`}
                      value={editing.text}
                      onChange={(event) => setEditing({ id: exercise.id, text: event.target.value })}
                      onKeyDown={onEditKey}
                      onBlur={saveEdit}
                    />
                  </li>
                ) : (
                  <li key={exercise.id} data-board-row={exercise.id}>
                    <button
                      type="button"
                      className="sk-board-row"
                      aria-label={`${exerciseLine({ ...exercise, load: loadFieldForViewer(exercise.load, units.weight) }) || "Empty row"}. Change`}
                      onClick={() => setEditing({ id: exercise.id, text: exerciseLine({ ...exercise, load: loadFieldForViewer(exercise.load, units.weight) }) })}
                    >
                      <span className="sk-board-row-name">{exercise.name.trim() || "Untitled"}</span>
                      <span className="sk-board-row-vol">{volumeText(exercise)}</span>
                      {exercise.load.trim() ? <span className="sk-board-row-load">{loadFieldForViewer(exercise.load, units.weight)}</span> : null}
                      {exercise.cue?.trim() ? <span className="sk-board-row-note">{exercise.cue.trim()}</span> : null}
                    </button>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
        <input
          ref={lineRef}
          data-board-line={dayIndex}
          className={cn("sk-board-line", session.blocks.length > 0 && "mt-2")}
          aria-label={`Add to ${dayName}`}
          placeholder={rows > 0 ? "Next exercise" : "Back squat 3x5 @80%"}
          autoComplete="off"
          enterKeyHint="done"
          value={line}
          onChange={(event) => setLine(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            commitLine()
          }}
          onPaste={pasteRows}
          onFocus={(event) => event.currentTarget.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" })}
        />
        {chips.length > 0 ? (
          <span className="mt-1.5 flex flex-wrap gap-1" aria-hidden>
            {chips.map((chip, index) => (
              <span key={`${index}:${chip}`} className="sk-board-chip">
                {chip}
              </span>
            ))}
          </span>
        ) : null}
      </div>
    </li>
  )
}
