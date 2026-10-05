import { useEffect, useId, useState } from "react"
import {
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  CloudArrowUp,
  CloudCheck,
  CloudSlash,
  Plus,
  WarningCircle,
} from "@phosphor-icons/react"
import { formatSeconds, formatSetLog, isLogEmpty, parseSeconds, targetValues } from "@/lib/data/session/session-from-plan"
import type { SyncState } from "@/lib/data/session/session-log-sync"
import type { AthleteWeekDay, LoggableBlock, LoggableRow, SessionRowLog } from "@/lib/data/session/types"
import { addDaysIso } from "@/lib/data/training-plan/plan-builder-model"
import { cn } from "@/lib/utils"
import { setKey, type LogField } from "./use-session-log"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function parseDay(dateIso: string) {
  return new Date(`${dateIso}T00:00:00Z`)
}

export function formatLongDay(dateIso: string) {
  return parseDay(dateIso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
}

export function WeekStrip({
  week,
  selected,
  today,
  onSelect,
}: {
  week: AthleteWeekDay[]
  selected: string
  today: string
  onSelect: (date: string) => void
}) {
  const first = week[0]?.date ?? selected
  const last = week[6]?.date ?? selected
  const holdsToday = today >= first && today <= last
  const range = `${parseDay(first).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })} to ${parseDay(last).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })}`

  return (
    <nav aria-label="Choose a day" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-sk-mute">{holdsToday ? "This week" : range}</p>
        <div className="flex items-center gap-1">
          {selected !== today ? (
            <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm h-11" onClick={() => onSelect(today)}>
              Today
            </button>
          ) : null}
          <button type="button" className="sk-btn sk-btn-ghost size-11 px-0" aria-label="Previous week" onClick={() => onSelect(addDaysIso(selected, -7))}>
            <CaretLeft className="size-5" weight="bold" />
          </button>
          <button type="button" className="sk-btn sk-btn-ghost size-11 px-0" aria-label="Next week" onClick={() => onSelect(addDaysIso(selected, 7))}>
            <CaretRight className="size-5" weight="bold" />
          </button>
        </div>
      </div>
      <ol className="grid grid-cols-7 gap-1.5">
        {week.map((entry, index) => {
          const active = entry.date === selected
          const isToday = entry.date === today
          const state = entry.done ? "done" : entry.kind === "session" ? "planned" : "rest"
          return (
            <li key={entry.date}>
              <button
                type="button"
                aria-current={active ? "date" : undefined}
                aria-label={`${formatLongDay(entry.date)}${isToday ? ", today" : ""}, ${
                  state === "done" ? "session done" : state === "planned" ? "session planned" : "no session"
                }`}
                onClick={() => onSelect(entry.date)}
                className={cn(
                  "flex h-[68px] w-full flex-col items-center justify-center gap-0.5 rounded-[14px] border text-sk-ink transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue",
                  active ? "border-sk-blue bg-sk-blue text-white" : "border-sk-line bg-white hover:border-sk-ink",
                )}
              >
                <span className={cn("text-xs font-semibold", active ? "text-white/85" : isToday ? "text-sk-blue" : "text-sk-mute")}>
                  {WEEKDAYS[index]}
                </span>
                <span className="text-lg font-extrabold leading-none tabular-nums">{parseDay(entry.date).getUTCDate()}</span>
                <span className="flex h-3 items-center" aria-hidden>
                  {state === "done" ? (
                    <Check className={cn("size-3", active ? "text-white" : "text-sk-green")} weight="bold" />
                  ) : state === "planned" ? (
                    <span className={cn("size-1.5 rounded-full", active ? "bg-white" : "bg-sk-blue")} />
                  ) : null}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function SyncStatus({ sync, onRetry, className }: { sync: SyncState; onRetry: () => void; className?: string }) {
  return (
    <div role="status" aria-live="polite" data-sync={sync.status} className={cn("flex min-w-0 items-center gap-1.5 text-sm font-bold", className)}>
      {sync.status === "saved" ? (
        <>
          <CloudCheck className="size-5 shrink-0 text-sk-green" weight="fill" aria-hidden />
          <span className="text-[#07673f]">Saved</span>
        </>
      ) : sync.status === "saving" ? (
        <>
          <CloudArrowUp className="size-5 shrink-0 text-sk-mute" weight="bold" aria-hidden />
          <span className="text-sk-ink-2">Saving</span>
        </>
      ) : sync.status === "retrying" ? (
        <>
          <CloudSlash className="size-5 shrink-0 text-[#b32a0c]" weight="bold" aria-hidden />
          <span className="text-[#b32a0c]">Not saved yet, retrying</span>
        </>
      ) : (
        <>
          <WarningCircle className="size-5 shrink-0 text-[#b32a0c]" weight="fill" aria-hidden />
          <span className="truncate text-[#b32a0c]">Could not save</span>
          <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm ml-1" onClick={onRetry}>
            Try again
          </button>
        </>
      )}
    </div>
  )
}

function formatPlain(value: number) {
  return String(Math.round(value * 1000) / 1000)
}

function parsePlain(text: string): number | null {
  const cleaned = text.trim().replace(",", ".")
  if (!cleaned) return null
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** Accepts seconds ("7.12") or minutes and seconds ("1:05.3"). */
function parseTime(text: string): number | null {
  const cleaned = text.trim().replace(",", ".")
  if (!cleaned) return null
  if (cleaned.includes(":")) return parseSeconds(cleaned)
  return parsePlain(cleaned)
}

function formatTime(value: number) {
  return value < 60 ? formatPlain(value) : formatSeconds(value)
}

/**
 * Big numeric field. Keeps what is being typed locally (so "102." is not rewritten mid entry)
 * and reports a number on every change, which is what triggers the autosave.
 */
function NumberField({
  label,
  unit,
  value,
  time = false,
  onChange,
}: {
  label: string
  unit?: string
  value: number | null
  time?: boolean
  onChange: (value: number | null) => void
}) {
  const id = useId()
  const format = time ? formatTime : formatPlain
  const [text, setText] = useState(value === null ? "" : format(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(value === null ? "" : (time ? formatTime : formatPlain)(value))
  }, [focused, time, value])

  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        placeholder="0"
        value={text}
        onFocus={(event) => {
          setFocused(true)
          event.currentTarget.select()
        }}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          const next = event.target.value.replace(time ? /[^0-9.,:]/g : /[^0-9.,]/g, "").slice(0, 9)
          setText(next)
          onChange(time ? parseTime(next) : parsePlain(next))
        }}
        className={cn(
          "h-14 w-full rounded-[14px] border border-[#d5d9e3] bg-white px-2 text-center text-xl font-extrabold tabular-nums text-sk-ink placeholder:font-semibold placeholder:text-[#c3c8d3] focus:border-sk-blue focus:outline-none focus:ring-2 focus:ring-sk-blue/20",
          unit && "px-11",
        )}
      />
      {unit ? (
        <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm font-semibold text-sk-mute" aria-hidden>
          {unit}
        </span>
      ) : null}
    </div>
  )
}

function TickButton({ done, label, onClick }: { done: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={done}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex size-14 shrink-0 items-center justify-center rounded-[14px] border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue",
        done ? "border-sk-green bg-sk-green text-white" : "border-[#cdd2de] bg-white text-[#b6bcc9] hover:border-sk-ink hover:text-sk-ink",
      )}
    >
      <Check className="size-7" weight="bold" aria-hidden />
    </button>
  )
}

const SET_NOUN: Record<LoggableRow["kind"], string> = { strength: "Set", time: "Rep", mark: "Attempt", check: "Set" }

export function ExerciseRow({
  row,
  logs,
  count,
  canAddSet,
  onToggle,
  onValue,
  onFill,
  onAddSet,
  hideLabel = false,
}: {
  row: LoggableRow
  logs: Record<string, SessionRowLog>
  count: number
  canAddSet: boolean
  onToggle: (setIndex: number) => void
  onValue: (setIndex: number, field: LogField, value: number | null) => void
  onFill: () => void
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

  return (
    <li data-exercise={row.label} className="border-b border-sk-line py-4 first:pt-1 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {hideLabel ? (
            <p className="text-base leading-snug text-sk-ink">{row.target}</p>
          ) : (
            <>
              <h3 className="text-lg font-bold leading-tight tracking-[-0.01em] text-sk-ink">{row.label}</h3>
              <p className="mt-0.5 text-[0.95rem] text-sk-ink-2">{row.target}</p>
            </>
          )}
          {row.helper ? <p className="mt-0.5 text-sm text-sk-mute">{row.helper}</p> : null}
        </div>
        {single ? (
          <TickButton done={allDone} label={`${row.label}, ${allDone ? "done" : "mark as done"}`} onClick={() => onToggle(1)} />
        ) : allDone ? (
          <CheckCircle className="size-7 shrink-0 text-sk-green" weight="fill" aria-label="All done" />
        ) : (
          <span className="shrink-0 text-sm font-bold tabular-nums text-sk-mute">
            {doneCount}/{count}
          </span>
        )}
      </div>

      {single ? null : (
        <>
          {row.kind === "strength" ? (
            <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-sk-mute" aria-hidden>
              <span className="w-7 shrink-0" />
              <span className="flex-1 text-center">Reps</span>
              <span className="flex-1 text-center">Load, kg</span>
              <span className="w-14 shrink-0 text-center">Done</span>
            </div>
          ) : null}
          <ol className={cn("space-y-2", row.kind === "strength" ? "mt-1.5" : "mt-3")}>
            {sets.map((setIndex) => {
              const log = logs[setKey(row.id, setIndex)]
              const done = Boolean(log?.completed)
              return (
                <li key={setIndex} className="flex items-center gap-2">
                  <span className="w-7 shrink-0 text-center text-base font-extrabold tabular-nums text-sk-mute" aria-hidden>
                    {setIndex}
                  </span>
                  {row.kind === "strength" ? (
                    <>
                      <NumberField
                        label={`${row.label}, set ${setIndex}, reps`}
                        value={log?.reps ?? null}
                        onChange={(value) => onValue(setIndex, "reps", value)}
                      />
                      <NumberField
                        label={`${row.label}, set ${setIndex}, load in kilograms`}
                        value={log?.loadKg ?? null}
                        onChange={(value) => onValue(setIndex, "loadKg", value)}
                      />
                    </>
                  ) : row.kind === "time" ? (
                    <NumberField
                      label={`${row.label}, rep ${setIndex}, time in seconds`}
                      unit="sec"
                      time
                      value={log?.timeSeconds ?? null}
                      onChange={(value) => onValue(setIndex, "timeSeconds", value)}
                    />
                  ) : row.kind === "mark" ? (
                    <NumberField
                      label={`${row.label}, attempt ${setIndex}, mark in metres`}
                      unit="m"
                      value={log?.mark ?? null}
                      onChange={(value) => onValue(setIndex, "mark", value)}
                    />
                  ) : (
                    <span className="flex-1 text-base font-semibold text-sk-ink-2">
                      {noun} {setIndex}
                    </span>
                  )}
                  <TickButton
                    done={done}
                    label={`${row.label}, ${noun.toLowerCase()} ${setIndex}, ${done ? "done" : "mark as done"}`}
                    onClick={() => onToggle(setIndex)}
                  />
                </li>
              )
            })}
          </ol>
          <div className="mt-2 flex flex-wrap items-center gap-1 pl-7">
            {!allDone && row.kind !== "check" ? (
              <button type="button" className="sk-btn sk-btn-quiet h-11 px-4 text-sm" onClick={onFill}>
                <Check className="size-4" weight="bold" aria-hidden />
                {hasTarget ? "Same as target" : "Tick all"}
              </button>
            ) : null}
            {canAddSet ? (
              <button type="button" className="sk-btn sk-btn-ghost h-11 text-sm" onClick={onAddSet}>
                <Plus className="size-4" weight="bold" aria-hidden />
                Add {noun.toLowerCase()}
              </button>
            ) : null}
          </div>
        </>
      )}
    </li>
  )
}

/** Read-only list of what was logged, grouped by block. */
export function LoggedSummary({ blocks, logs }: { blocks: LoggableBlock[]; logs: Record<string, SessionRowLog> }) {
  const all = Object.values(logs)
  return (
    <div className="space-y-5">
      {blocks.map((block) => (
        <div key={block.id}>
          {block.rows.length === 1 && block.rows[0].label === block.name ? null : <h3 className="sk-h3">{block.name}</h3>}
          <ul className="mt-1">
            {block.rows.map((row) => {
              const sets = all
                .filter((log) => log.rowId === row.id && !isLogEmpty(log))
                .sort((left, right) => left.setIndex - right.setIndex)
                .map((log) => formatSetLog(row.kind, log))
                .filter(Boolean)
              const onlyDone = sets.length > 0 && sets.every((entry) => entry === "Done")
              return (
                <li key={row.id} data-logged={row.label} className="sk-row items-start">
                  <div className="min-w-0">
                    <p className="font-semibold text-sk-ink">{row.label}</p>
                    <p className="text-sm text-sk-mute">Target: {row.target}</p>
                  </div>
                  <p className={cn("max-w-[55%] shrink-0 text-right text-[0.95rem] font-bold tabular-nums", sets.length > 0 ? "text-sk-ink" : "font-semibold text-sk-mute")}>
                    {sets.length === 0 ? "Not logged" : onlyDone ? (sets.length > 1 ? `${sets.length} done` : "Done") : sets.join(", ")}
                  </p>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
