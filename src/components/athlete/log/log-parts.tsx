import { useEffect, useState } from "react"
import {
  Button,
  Choices,
  DayPicker,
  Dialog,
  Field,
  Input,
  List,
  ListRow,
  Meter,
  Notice,
  NumberInput,
  Select,
  SetGroup,
  SetRow,
  StatusText,
  TickButton,
  WeekPager,
  type DayPickerDay,
} from "@/components/sk"
import type { Result } from "@/lib/data/result"
import { formatSetLog, isLogEmpty, MAX_SETS, targetValues } from "@/lib/data/session/session-from-plan"
import type { SyncState } from "@/lib/data/session/session-log-sync"
import {
  SKIP_REASONS,
  type AthleteWeekDay,
  type ExtraExerciseInput,
  type LastTimeResult,
  type LogKind,
  type LoggableBlock,
  type LoggableRow,
  type SessionRowLog,
  type SkipReason,
} from "@/lib/data/session/types"
import { addDaysIso } from "@/lib/data/training-plan/plan-builder-model"
import { repeatTarget, setKey, type LogField } from "./use-session-log"

function parseDay(dateIso: string) {
  return new Date(`${dateIso}T00:00:00Z`)
}

export function formatLongDay(dateIso: string) {
  return parseDay(dateIso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
}

export function formatShortDay(dateIso: string) {
  return parseDay(dateIso).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })
}

/** The state of one day as the day picker and the lists show it. */
export function dayState(entry: AthleteWeekDay, today: string): DayPickerDay["state"] {
  if (entry.done) return "done"
  if (entry.kind !== "session") return entry.date === today ? "today" : "rest"
  if (entry.skipped) return "skipped"
  if (entry.date === today) return "today"
  if (entry.date < today) return entry.excused ? "skipped" : "missed"
  return "planned"
}

const DAY_STATE_WORDS: Record<DayPickerDay["state"], string> = {
  done: "session done",
  today: "today",
  planned: "session planned",
  skipped: "session skipped or excused",
  missed: "session not logged",
  rest: "no session",
}

/** Pick a day: the week with previous and next, and seven days to tap. */
export function DayNav({ week, selected, today, onSelect }: { week: AthleteWeekDay[]; selected: string; today: string; onSelect: (date: string) => void }) {
  const first = week[0]?.date ?? selected
  const last = week[6]?.date ?? selected
  const holdsToday = today >= first && today <= last
  const range = `${formatShortDay(first)} to ${formatShortDay(last)}`
  const days: DayPickerDay[] = week.map((entry) => {
    const state = dayState(entry, today)
    const isToday = entry.date === today
    return {
      key: entry.date,
      letter: parseDay(entry.date).toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" }),
      number: parseDay(entry.date).getUTCDate(),
      state,
      isToday,
      label: `${formatLongDay(entry.date)}${isToday && state !== "today" ? ", today" : ""}, ${entry.kind === "session" && state === "today" ? "today, session planned" : DAY_STATE_WORDS[state]}`,
    }
  })
  return (
    <nav aria-label="Choose a day" className="flex flex-col gap-3">
      <WeekPager
        title={holdsToday ? "This week" : range}
        subtitle={holdsToday ? range : undefined}
        onPrevious={() => onSelect(addDaysIso(selected, -7))}
        onNext={() => onSelect(addDaysIso(selected, 7))}
        action={
          selected !== today ? (
            <Button variant="quiet" size="sm" onClick={() => onSelect(today)}>
              Today
            </Button>
          ) : null
        }
      />
      <DayPicker days={days} selected={selected} onSelect={onSelect} />
    </nav>
  )
}

/** Saved, saving, not saved yet (retrying on its own), or refused with a way to try again. */
export function SyncStatus({ sync, onRetry, className }: { sync: SyncState; onRetry: () => void; className?: string }) {
  return (
    <div role="status" aria-live="polite" data-sync={sync.status} className={className}>
      {sync.status === "saved" ? (
        <StatusText tone="green">Saved</StatusText>
      ) : sync.status === "saving" ? (
        <StatusText tone="neutral">Saving</StatusText>
      ) : sync.status === "retrying" ? (
        <StatusText tone="amber">Not sent yet, retrying</StatusText>
      ) : (
        <span className="flex items-center gap-2">
          <StatusText tone="coral">Could not save</StatusText>
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </span>
      )}
    </div>
  )
}

/** "3 of 12 done" with a thin bar, for the sticky bar while logging. */
export function LogProgress({ done, total }: { done: number; total: number }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-sm font-bold text-sk-ink">
        <span className="tabular-nums">
          {done} of {total}
        </span>{" "}
        done
      </p>
      <Meter value={total > 0 ? (done / total) * 100 : 0} tone="green" className="mt-1.5" label="Sets done" />
    </div>
  )
}

const SET_NOUN: Record<LoggableRow["kind"], string> = { strength: "Set", time: "Rep", mark: "Attempt", check: "Set" }

function trim(value: number | null | undefined) {
  return value === null || value === undefined ? undefined : String(Math.round(value * 1000) / 1000)
}

/** One exercise of the session being logged: its sets, "Same as target", "Repeat set", "Add set". */
export function ExerciseLog({
  row,
  logs,
  count,
  lastTime,
  onToggle,
  onValue,
  onFill,
  onRepeat,
  onAddSet,
  hideLabel = false,
}: {
  row: LoggableRow
  logs: Record<string, SessionRowLog>
  count: number
  lastTime: LastTimeResult | null
  onToggle: (setIndex: number) => void
  onValue: (setIndex: number, field: LogField, value: number | null) => void
  onFill: () => void
  onRepeat: () => void
  onAddSet: () => void
  /** The block title already says it (a block with a single item and no exercises). */
  hideLabel?: boolean
}) {
  const sets = Array.from({ length: count }, (_, index) => index + 1)
  const doneCount = sets.filter((setIndex) => logs[setKey(row.id, setIndex)]?.completed).length
  const allDone = doneCount === count
  const noun = SET_NOUN[row.kind]
  const single = row.kind === "check" && count === 1
  const target = targetValues(row)
  const hasTarget = row.kind === "strength" ? target.reps != null || target.loadKg != null : row.kind === "time" ? target.timeSeconds != null : target.mark != null
  const repeat = allDone ? null : repeatTarget(row, logs, count)
  const canAddSet = row.kind !== "check" && count < MAX_SETS
  const hint = [row.helper, lastTime ? `Last time: ${lastTime.summary} (${formatShortDay(lastTime.date)})` : null].filter(Boolean).join(". ") || undefined

  if (single) {
    return (
      <SetGroup
        data-exercise={row.label}
        title={hideLabel ? undefined : row.label}
        target={row.target}
        hint={hint}
        trailing={<TickButton done={allDone} label={`${row.label}, ${allDone ? "done" : "mark as done"}`} onClick={() => onToggle(1)} />}
      />
    )
  }

  return (
    <SetGroup
      data-exercise={row.label}
      title={hideLabel ? undefined : row.label}
      target={row.target}
      hint={hint}
      status={allDone ? <StatusText tone="green">Done</StatusText> : `${doneCount} of ${count}`}
      columns={row.kind === "strength" ? ["Reps", "kg"] : undefined}
      actions={
        <>
          {!allDone && row.kind !== "check" ? (
            <Button variant="quiet" size="sm" onClick={onFill}>
              {hasTarget ? "Same as target" : "Tick all"}
            </Button>
          ) : null}
          {repeat ? (
            <Button variant="quiet" size="sm" onClick={onRepeat}>
              Repeat {noun.toLowerCase()} {repeat.from}
            </Button>
          ) : null}
          {canAddSet ? (
            <Button variant="quiet" size="sm" onClick={onAddSet}>
              Add {noun.toLowerCase()}
            </Button>
          ) : null}
        </>
      }
    >
      {sets.map((setIndex) => {
        const log = logs[setKey(row.id, setIndex)]
        const done = Boolean(log?.completed)
        return (
          <SetRow
            key={setIndex}
            index={setIndex}
            tick={<TickButton done={done} label={`${row.label}, ${noun.toLowerCase()} ${setIndex}, ${done ? "done" : "mark as done"}`} onClick={() => onToggle(setIndex)} />}
          >
            {row.kind === "strength" ? (
              <>
                <NumberInput
                  label={`${row.label}, set ${setIndex}, reps`}
                  value={log?.reps ?? null}
                  placeholder={trim(target.reps) ?? "0"}
                  onChange={(value) => onValue(setIndex, "reps", value)}
                />
                <NumberInput
                  label={`${row.label}, set ${setIndex}, load in kilograms`}
                  value={log?.loadKg ?? null}
                  placeholder={trim(target.loadKg) ?? "0"}
                  onChange={(value) => onValue(setIndex, "loadKg", value)}
                />
              </>
            ) : row.kind === "time" ? (
              <NumberInput
                label={`${row.label}, rep ${setIndex}, time in seconds`}
                unit="sec"
                mode="time"
                value={log?.timeSeconds ?? null}
                placeholder={trim(target.timeSeconds) ?? "0"}
                onChange={(value) => onValue(setIndex, "timeSeconds", value)}
              />
            ) : row.kind === "mark" ? (
              <NumberInput
                label={`${row.label}, attempt ${setIndex}, mark in metres`}
                unit="m"
                value={log?.mark ?? null}
                placeholder={trim(target.mark) ?? "0"}
                onChange={(value) => onValue(setIndex, "mark", value)}
              />
            ) : (
              <span className="flex-1 text-base font-semibold text-sk-ink-2">
                {noun} {setIndex}
              </span>
            )}
          </SetRow>
        )
      })}
    </SetGroup>
  )
}

/** Read-only rows of what was logged: exercise, result, target. */
export function LoggedSummary({ blocks, logs }: { blocks: LoggableBlock[]; logs: Record<string, SessionRowLog> }) {
  const all = Object.values(logs)
  return (
    <List>
      {blocks.flatMap((block) =>
        block.rows.map((row) => {
          const sets = all
            .filter((log) => log.rowId === row.id && !isLogEmpty(log))
            .sort((left, right) => left.setIndex - right.setIndex)
            .map((log) => formatSetLog(row.kind, log))
            .filter(Boolean)
          const onlyDone = sets.length > 0 && sets.every((entry) => entry === "Done")
          const result = sets.length === 0 ? "Not logged" : onlyDone ? (sets.length > 1 ? `${sets.length} done` : "Done") : sets.join(", ")
          const showBlock = block.name !== row.label && blocks.length > 1
          return (
            <ListRow key={row.id} data-logged={row.label}>
              <span className="sk-list-title">{row.label}</span>
              <span className={sets.length > 0 ? "block text-[0.9375rem] font-semibold leading-snug text-sk-ink tabular-nums" : "sk-list-sub"}>{result}</span>
              <span className="sk-list-sub">
                {showBlock ? `${block.name}. ` : ""}Target: {row.target}
              </span>
            </ListRow>
          )
        }),
      )}
    </List>
  )
}

/** "Can't do this one": pick a reason, add a short note when it is something else. */
export function SkipDialog({
  open,
  onOpenChange,
  sessionTitle,
  onSkip,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionTitle: string
  onSkip: (reason: SkipReason, note: string | null) => Promise<Result<null>>
}) {
  const [reason, setReason] = useState<SkipReason | null>(null)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setReason(null)
    setNote("")
    setError(null)
  }, [open])

  const save = async () => {
    if (!reason) {
      setError("Choose a reason.")
      return
    }
    if (reason === "other" && !note.trim()) {
      setError("Add a few words so your coach knows why.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await onSkip(reason, note.trim() || null)
    setSaving(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Can't do this one"
      description={`${sessionTitle} will be marked as skipped. It will not count as missed, and your coach sees the reason. You can undo this and log it later.`}
      footer={
        <>
          <Button variant="quiet" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving..." : "Skip this session"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Choices label="Why are you skipping it" hideLabel columns={2} options={SKIP_REASONS} value={reason} onChange={setReason} />
        <Field label={reason === "other" ? "What happened" : "Note for your coach"} optional={reason !== "other"}>
          <Input value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} placeholder="A few words" />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
    </Dialog>
  )
}

const EXERCISE_KINDS: Array<{ value: LogKind; label: string; detail: string }> = [
  { value: "strength", label: "Reps and load", detail: "Lifts" },
  { value: "time", label: "Time", detail: "Runs, sprints" },
  { value: "mark", label: "Distance or height", detail: "Jumps, throws" },
  { value: "check", label: "Just tick it off", detail: "Warm up, drills" },
]

/** Add an exercise to a session the athlete added themselves. */
export function AddExerciseDialog({
  open,
  onOpenChange,
  defaultKind,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultKind: LogKind
  onAdd: (input: ExtraExerciseInput) => Promise<Result<LoggableRow>>
}) {
  const [label, setLabel] = useState("")
  const [kind, setKind] = useState<LogKind>(defaultKind)
  const [sets, setSets] = useState("3")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLabel("")
    setError(null)
  }, [open])

  const save = async () => {
    if (!label.trim()) {
      setError("Give the exercise a name.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await onAdd({ label: label.trim(), kind, sets: Number.parseInt(sets, 10) || 1 })
    setSaving(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onOpenChange(false)
  }

  const noun = kind === "time" ? "Reps" : kind === "mark" ? "Attempts" : "Sets"
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add an exercise"
      footer={
        <>
          <Button variant="quiet" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Adding..." : "Add exercise"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Exercise" error={error ?? undefined}>
          <Input value={label} maxLength={120} autoFocus onChange={(event) => setLabel(event.target.value)} placeholder="Back squat, 200m, long jump" />
        </Field>
        <Choices label="What you record" columns={2} options={EXERCISE_KINDS} value={kind} onChange={setKind} />
        {kind !== "check" ? (
          <Field label={noun} hint="You can add more while you log.">
            <Select value={sets} onChange={(event) => setSets(event.target.value)}>
              {Array.from({ length: 10 }, (_, index) => String(index + 1)).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
    </Dialog>
  )
}
