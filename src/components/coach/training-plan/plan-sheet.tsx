import { Plus, X } from "@phosphor-icons/react"
import { useMemo, useState, type ClipboardEvent } from "react"
import { Button, Dialog, Field, FormGrid, Input, Notice, RowMenu, Select, Textarea } from "@/components/sk"
import {
  QUICK_BLOCKS,
  SESSION_TYPES,
  formatDayMonth,
  getSession,
  makeId,
  newBlock,
  newExercise,
  newSession,
  putSession,
  slotDate,
  weekdayLabel,
  type BlockDraft,
  type PlanDraft,
  type SessionDraft,
  type SessionType,
} from "@/lib/data/training-plan/plan-builder-model"
import { looksLikeRows, mergePastedBlocks, parsePastedSheet, pastedToBlocks, tidyHeading, titleFromBlocks, type PastedSheet } from "@/lib/data/training-plan/plan-paste"
import type { EventGroup } from "@/lib/mock-data"
import { ExerciseRows } from "./exercise-rows"
import type { AthleteOption } from "./storage"
import { plural } from "./ui"
import type { ExerciseTools } from "./use-exercise-tools"

const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6]

/** Where the cursor goes once the screen has caught up with a change. */
export type SheetFocus = null | { kind: "title"; dayIndex: number } | { kind: "exercise"; exerciseId: string } | { kind: "section"; blockId: string }

function dayOfMonth(dateIso: string) {
  return Number(dateIso.slice(8, 10)) || 0
}

/** Pasted rows look like gym work when they carry loads: such a day starts as a gym session. */
export function typeForBlocks(blocks: BlockDraft[]): SessionType {
  return blocks.some((block) => block.exercises.some((exercise) => /\d\s*(%|kg|lb)/i.test(exercise.load))) ? "Gym" : "Track"
}

/** Blocks for rows pasted from a spreadsheet, with fresh ids. */
export function blocksFromPaste(blocks: PastedSheet["days"][number]["blocks"]): BlockDraft[] {
  return pastedToBlocks(blocks, makeId) as BlockDraft[]
}

/**
 * Rows from a spreadsheet put into one day: after a row, or at the end. A rest day becomes a session.
 * Returns the plan and how many rows went in.
 */
export function pasteIntoDay(current: PlanDraft, week: number, dayIndex: number, text: string, afterExerciseId?: string): { plan: PlanDraft; count: number } {
  const sheet = parsePastedSheet(text)
  const pasted = sheet.days.flatMap((day) => day.blocks)
  if (pasted.length === 0) return { plan: current, count: 0 }
  const blocks = blocksFromPaste(pasted)
  const existing = getSession(current, week, dayIndex)
  if (!existing) return { plan: putSession(current, newSession(week, dayIndex, { title: titleFromBlocks(blocks), sessionType: typeForBlocks(blocks), blocks })), count: sheet.exerciseCount }
  let next = mergePastedBlocks(existing.blocks, blocks)
  if (afterExerciseId) {
    // Pasted on a row: loose rows go in right after it, sections after its section.
    const blockIndex = existing.blocks.findIndex((block) => block.exercises.some((exercise) => exercise.id === afterExerciseId))
    if (blockIndex >= 0) {
      const target = existing.blocks[blockIndex]
      const rowIndex = target.exercises.findIndex((exercise) => exercise.id === afterExerciseId)
      const [first, ...rest] = blocks
      const loose = first?.title === "Main" ? first.exercises : []
      const sections = first?.title === "Main" ? rest : blocks
      // An empty row the rows were pasted on is replaced by them.
      const keepRow = Boolean(target.exercises[rowIndex]?.name.trim())
      const exercises = [...target.exercises.slice(0, keepRow ? rowIndex + 1 : rowIndex), ...loose, ...target.exercises.slice(rowIndex + 1)]
      next = [...existing.blocks.slice(0, blockIndex), { ...target, exercises }, ...sections, ...existing.blocks.slice(blockIndex + 1)]
    }
  }
  return { plan: putSession(current, withAutoTitle(existing, next)), count: sheet.exerciseCount }
}

/** A session with new blocks. Its name follows its first exercises until the coach names it. */
export function withAutoTitle(session: SessionDraft, blocks: BlockDraft[]): SessionDraft {
  const auto = !session.title.trim() || session.title === titleFromBlocks(session.blocks)
  return { ...session, blocks, title: auto ? titleFromBlocks(blocks) : session.title }
}

/**
 * One day of the week as a sheet: the session's name and type on top, then its sections
 * (a heading row each) with their exercises in a table you type straight into, like a spreadsheet.
 */
export function DaySheet({
  plan,
  week,
  dayIndex,
  eventGroup,
  athletes,
  tools,
  canCopyNext,
  onChange,
  onFocus,
  onOpenSettings,
  onCopyNext,
  onRemove,
  onNotice,
}: {
  plan: PlanDraft
  week: number
  dayIndex: number
  eventGroup: EventGroup
  athletes: AthleteOption[]
  tools: ExerciseTools
  canCopyNext: boolean
  onChange: (updater: (plan: PlanDraft) => PlanDraft) => void
  onFocus: (target: SheetFocus) => void
  onOpenSettings: () => void
  onCopyNext: () => void
  onRemove: () => void
  onNotice: (message: string) => void
}) {
  const session = getSession(plan, week, dayIndex)
  const date = slotDate(plan, week, dayIndex)
  const dayName = `${weekdayLabel(date)} ${formatDayMonth(date)}`

  const updateSession = (updater: (current: SessionDraft) => SessionDraft) =>
    onChange((current) => {
      const existing = getSession(current, week, dayIndex)
      return existing ? putSession(current, updater(existing)) : current
    })
  const updateBlock = (blockId: string, updater: (block: BlockDraft) => BlockDraft) =>
    updateSession((current) => ({ ...current, blocks: current.blocks.map((block) => (block.id === blockId ? updater(block) : block)) }))

  const startSession = () => {
    onChange((current) => (getSession(current, week, dayIndex) ? current : putSession(current, newSession(week, dayIndex))))
    onFocus({ kind: "title", dayIndex })
  }

  /** Rows from a spreadsheet: into this day, after a row or at the end. */
  const pasteRows = (text: string, afterExerciseId?: string) => {
    const count = parsePastedSheet(text).exerciseCount
    onChange((current) => pasteIntoDay(current, week, dayIndex, text, afterExerciseId).plan)
    if (count > 0) onNotice(`Pasted ${plural(count, "row")} into ${dayName}.`)
  }

  /** "CORE" typed on a row: that row becomes the heading of a new section, with the rows under it. */
  const makeSection = (blockId: string, exerciseId: string, title: string) => {
    const section = newBlock(tidyHeading(title))
    const first = newExercise()
    onFocus({ kind: "exercise", exerciseId: first.id })
    updateSession((current) => {
      const blockIndex = current.blocks.findIndex((block) => block.id === blockId)
      if (blockIndex < 0) return current
      const target = current.blocks[blockIndex]
      const rowIndex = target.exercises.findIndex((exercise) => exercise.id === exerciseId)
      const moved = { ...section, exercises: [first, ...target.exercises.slice(rowIndex + 1)] }
      return { ...current, blocks: [...current.blocks.slice(0, blockIndex), { ...target, exercises: target.exercises.slice(0, rowIndex) }, moved, ...current.blocks.slice(blockIndex + 1)] }
    })
  }

  const addSection = (title = "") => {
    const block = newBlock(title)
    const first = newExercise()
    block.exercises = [first]
    updateSession((current) => ({ ...current, blocks: [...current.blocks, block] }))
    onFocus(title ? { kind: "exercise", exerciseId: first.id } : { kind: "section", blockId: block.id })
  }

  /** The "type an exercise" line under the table: the first letter starts a new row in the last section. */
  const startRow = (name: string) => {
    const exercise = { ...newExercise(), name }
    updateSession((current) => {
      if (current.blocks.length === 0) return { ...current, blocks: [{ ...newBlock("Main"), exercises: [exercise] }] }
      const last = current.blocks[current.blocks.length - 1]
      return { ...current, blocks: [...current.blocks.slice(0, -1), { ...last, exercises: [...last.exercises, exercise] }] }
    })
    onFocus({ kind: "exercise", exerciseId: exercise.id })
  }

  if (!session) {
    return (
      <li data-sheet-day={dayIndex} data-has-session="false" className="sk-sheet-rest">
        <span className="sk-sheet-rest-day">
          {weekdayLabel(date)} {dayOfMonth(date)}
        </span>
        <span className="font-semibold text-sk-mute">Rest</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <PasteHere label={`Paste rows into ${dayName}`} onPaste={(text) => pasteRows(text)} />
          <Button size="sm" onClick={startSession} aria-label={`${dayName}: rest day. Add a session`}>
            <Plus className="size-4" weight="bold" aria-hidden />
            Add session
          </Button>
        </span>
      </li>
    )
  }

  const exerciseCount = session.blocks.reduce((sum, block) => sum + block.exercises.filter((exercise) => exercise.name.trim()).length, 0)
  const facts = [session.durationMinutes ? `${session.durationMinutes} min` : null, session.location.trim() || null].filter(Boolean).join(", ")

  return (
    <li data-sheet-day={dayIndex} data-has-session="true" className="sk-sheet-day">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="sk-sheet-badge" aria-hidden>
          <span>{weekdayLabel(date).toUpperCase()}</span>
          <strong>{dayOfMonth(date)}</strong>
        </span>
        <input
          data-session-title
          data-day-title={dayIndex}
          className="sk-sheet-title"
          aria-label={`${dayName} session title`}
          placeholder="Name this session"
          enterKeyHint="next"
          value={session.title}
          onChange={(event) => updateSession((current) => ({ ...current, title: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            event.currentTarget.closest("[data-sheet-day]")?.querySelector<HTMLInputElement>("[data-sheet-new-row]")?.focus()
          }}
        />
        <select
          className="sk-sheet-type"
          aria-label={`${dayName} session type`}
          value={session.sessionType}
          onChange={(event) => updateSession((current) => ({ ...current, sessionType: event.target.value as SessionType }))}
        >
          {SESSION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <span className="text-sm font-semibold text-sk-mute">
          {plural(exerciseCount, "exercise")}
          {facts ? `, ${facts}` : ""}
        </span>
        <RowMenu
          label={`More for ${dayName}`}
          className="ml-auto bg-white"
          items={[
            { label: "Session details", onSelect: onOpenSettings, opensOverlay: true },
            { label: "Copy to next day", onSelect: onCopyNext, disabled: !canCopyNext },
            { label: "Remove session", onSelect: onRemove, danger: true },
          ]}
        />
      </div>
      {session.notes.trim() ? <p className="mt-2 text-sm text-sk-ink-2">{session.notes.trim()}</p> : null}

      <div className="sk-sheet-table">
        {session.blocks.length > 0 ? (
          <ol className="flex flex-col" aria-label={`${dayName} sections`}>
            {session.blocks.map((block, blockIndex) => (
              <li key={block.id} data-block data-block-id={block.id} className="sk-sheet-section">
                <div className="sk-sheet-heading">
                  <input
                    data-block-field="name"
                    aria-label={`Block ${blockIndex + 1} name`}
                    placeholder="Section"
                    enterKeyHint="next"
                    value={block.title}
                    onChange={(event) => updateBlock(block.id, (current) => ({ ...current, title: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return
                      event.preventDefault()
                      event.currentTarget.closest("[data-block]")?.querySelector<HTMLInputElement>('[data-cell="0:0"]')?.focus()
                    }}
                  />
                  <input
                    data-block-field="details"
                    className="sk-sheet-heading-note"
                    aria-label={`Block ${blockIndex + 1} details`}
                    placeholder="Details"
                    value={block.notes}
                    onChange={(event) => updateBlock(block.id, (current) => ({ ...current, notes: event.target.value }))}
                  />
                  <button
                    type="button"
                    className="sk-icon-btn size-9"
                    aria-label={`Remove section ${block.title.trim() || blockIndex + 1} from ${dayName}`}
                    onClick={() => updateSession((current) => ({ ...current, blocks: current.blocks.filter((candidate) => candidate.id !== block.id) }))}
                  >
                    <X className="size-4" weight="bold" aria-hidden />
                  </button>
                </div>
                <ExerciseRows
                  blockIndex={blockIndex}
                  blockTitle={block.title}
                  exercises={block.exercises}
                  athletes={athletes}
                  tools={tools}
                  showAdd={false}
                  onChange={(updater) => updateBlock(block.id, (current) => ({ ...current, exercises: updater(current.exercises) }))}
                  onPasteRows={(text, afterId) => pasteRows(text, afterId)}
                  onMakeSection={(exerciseId, title) => makeSection(block.id, exerciseId, title)}
                />
              </li>
            ))}
          </ol>
        ) : null}

        <NewRowInput dayName={dayName} onStart={startRow} onPasteRows={(text) => pasteRows(text)} />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-1" role="group" aria-label={`Add a section to ${dayName}`}>
        {QUICK_BLOCKS[eventGroup].map((title) => (
          <Button key={title} variant="quiet" size="sm" onClick={() => addSection(title)}>
            <Plus className="size-4" weight="bold" aria-hidden />
            {title}
          </Button>
        ))}
        <Button variant="quiet" size="sm" onClick={() => addSection()}>
          <Plus className="size-4" weight="bold" aria-hidden />
          Section
        </Button>
      </div>
    </li>
  )
}

/** The empty line at the foot of a day: type to start a row, or paste rows from a spreadsheet. */
function NewRowInput({ dayName, onStart, onPasteRows }: { dayName: string; onStart: (name: string) => void; onPasteRows: (text: string) => void }) {
  return (
    <input
      data-sheet-new-row
      className="sk-sheet-new-row"
      aria-label={`Add an exercise to ${dayName}`}
      placeholder="Type an exercise, or paste rows from Excel"
      autoComplete="off"
      value=""
      onChange={(event) => {
        if (event.target.value.trim()) onStart(event.target.value)
      }}
      onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
        const text = event.clipboardData.getData("text/plain")
        if (!looksLikeRows(text)) return
        event.preventDefault()
        onPasteRows(text)
      }}
    />
  )
}

/** On a rest day: a box to paste rows into, which makes the session. */
function PasteHere({ label, onPaste }: { label: string; onPaste: (text: string) => void }) {
  return (
    <input
      className="sk-sheet-paste-here"
      aria-label={label}
      placeholder="Paste rows"
      value=""
      onChange={() => undefined}
      onPaste={(event) => {
        const text = event.clipboardData.getData("text/plain")
        if (!text.trim()) return
        event.preventDefault()
        onPaste(text)
      }}
    />
  )
}

/** The rest of a session: minutes, effort, place and a note, kept off the sheet. */
export function SessionDetailsDialog({ session, dayName, onClose, onChange }: { session: SessionDraft; dayName: string; onClose: () => void; onChange: (patch: Partial<SessionDraft>) => void }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`${dayName} details`}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <FormGrid>
        <Field label="Minutes">
          <Input inputMode="numeric" value={session.durationMinutes} onChange={(event) => onChange({ durationMinutes: event.target.value.replace(/[^0-9]/g, "").slice(0, 3) })} placeholder="75" />
        </Field>
        <Field label="Intended effort" optional>
          <Select value={session.intendedEffort ?? ""} onChange={(event) => onChange({ intendedEffort: event.target.value })}>
            <option value="">Not set</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((effort) => (
              <option key={effort} value={effort}>
                {effort} out of 10
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Location" className="sm:col-span-2">
          <Input value={session.location} onChange={(event) => onChange({ location: event.target.value })} placeholder="Track, gym, throws field" />
        </Field>
        <Field label="Coach note" className="sm:col-span-2">
          <Textarea rows={3} value={session.notes} onChange={(event) => onChange({ notes: event.target.value })} placeholder="What athletes should know before they start" />
        </Field>
      </FormGrid>
    </Dialog>
  )
}

/** Which day of a week each pasted day lands on: by its weekday, or in turn from `looseDay`. */
export function placePastedDays(plan: PlanDraft, week: number, sheet: PastedSheet, looseDay = 0) {
  const slots = DAY_INDEXES.map((index) => {
    const date = slotDate(plan, week, index)
    return { index, date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), name: `${weekdayLabel(date)} ${formatDayMonth(date)}` }
  })
  const placed = sheet.days.map((day, order) => {
    const slot = day.weekday === null ? slots[(looseDay + order) % 7] : slots.find((candidate) => candidate.weekday === day.weekday)!
    return { slot, day, count: day.blocks.reduce((sum, block) => sum + block.exercises.length, 0) }
  })
  return { slots, placed }
}

/** The sessions a pasted week makes, one per placed day. */
export function sessionsFromPlaced(plan: PlanDraft, week: number, placed: ReturnType<typeof placePastedDays>["placed"]): SessionDraft[] {
  return placed.map(({ slot, day }) => {
    const blocks = blocksFromPaste(day.blocks)
    const existing = getSession(plan, week, slot.index)
    return newSession(week, slot.index, {
      title: titleFromBlocks(blocks),
      sessionType: typeForBlocks(blocks),
      location: existing?.location ?? "",
      durationMinutes: existing?.durationMinutes ?? "",
      blocks,
    })
  })
}

/**
 * Paste a whole week from a spreadsheet: the rows under "Monday", "Tuesday" and so on go to those
 * days. Rows with no weekday go to the day chosen here.
 */
export function PasteWeekDialog({ plan, week, onClose, onApply }: { plan: PlanDraft; week: number; onClose: () => void; onApply: (sessions: SessionDraft[]) => void }) {
  const [text, setText] = useState("")
  const [looseDay, setLooseDay] = useState(0)
  const sheet = useMemo(() => parsePastedSheet(text), [text])

  const { slots, placed } = placePastedDays(plan, week, sheet, looseDay)
  const replaced = placed.filter((entry) => getSession(plan, week, entry.slot.index))
  const hasLoose = sheet.days.some((day) => day.weekday === null)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`Paste into week ${week}`}
      className="sm:max-w-2xl"
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={placed.length === 0}
            onClick={() => onApply(sessionsFromPlaced(plan, week, placed))}
          >
            {placed.length === 0 ? "Fill the week" : `Fill ${plural(placed.length, "day")}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Textarea
          autoFocus
          rows={8}
          aria-label="Rows from your spreadsheet"
          placeholder={"Copy the week in Excel and paste it here.\nMonday\nBack squat\t3\t5\t80%"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="font-mono text-sm"
        />
        {hasLoose ? (
          <Field label="Rows with no day go on">
            <Select value={looseDay} onChange={(event) => setLooseDay(Number(event.target.value))}>
              {slots.map((slot) => (
                <option key={slot.index} value={slot.index}>
                  {slot.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {placed.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="What will be filled">
            {placed.map(({ slot, count, day }) => (
              <li key={slot.index} className="sk-paste-day">
                <strong>{slot.name}</strong>
                <span>
                  {plural(count, "exercise")}, {plural(day.blocks.length, "section")}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {replaced.length > 0 ? (
          <Notice tone="warning">
            {replaced.map((entry) => weekdayLabel(entry.slot.date)).join(", ")} already {replaced.length === 1 ? "has a session" : "have sessions"}. Filling replaces {replaced.length === 1 ? "it" : "them"}.
          </Notice>
        ) : null}
      </div>
    </Dialog>
  )
}
