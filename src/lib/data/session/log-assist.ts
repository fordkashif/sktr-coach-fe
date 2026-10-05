import type { LastTimeResult, LastTimeSet, LogKind, LoggableRow, SessionRowLog } from "./types"

/**
 * Pure helpers for the athlete log: matching an exercise to what was done last time,
 * "Same as last time", the note and effort of a row, and the rest a coach prescribed.
 * No imports with side effects, so these run in plain node tests.
 */

export const NOTE_MAX_LENGTH = 500
export const REST_CHOICES_SECONDS = [30, 60, 90, 120, 180]
export const DEFAULT_REST_SECONDS = 60

/**
 * How an exercise is matched between sessions. Rows carry no stable exercise id, so the name is
 * used: case, punctuation and extra spaces do not matter ("Back-Squat " equals "back squat").
 * The SQL twin is public.exercise_match_key().
 */
export function exerciseMatchKey(label: string | null | undefined) {
  return (label ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

type LogMap = Record<string, SessionRowLog>

function key(rowId: string, setIndex: number) {
  return `${rowId}:${setIndex}`
}

function hasNumbers(log: Pick<SessionRowLog, "reps" | "loadKg" | "timeSeconds" | "mark"> | undefined) {
  return Boolean(log && (log.reps !== null || log.loadKg !== null || log.timeSeconds !== null || log.mark !== null))
}

/** The last time result for a row, or null. Only offered when it holds the same kind of numbers. */
export function lastTimeForRow(row: Pick<LoggableRow, "label" | "kind">, byKey: Record<string, LastTimeResult>): LastTimeResult | null {
  if (row.kind === "check") return null
  const found = byKey[exerciseMatchKey(row.label)]
  if (!found || found.sets.length === 0) return null
  return found
}

/** True when last time's numbers can be typed into this row (same inputs). */
export function canRepeatLastTime(row: Pick<LoggableRow, "kind">, last: LastTimeResult | null) {
  if (!last || row.kind === "check" || last.kind !== row.kind) return false
  return last.sets.some(hasNumbers)
}

/**
 * "Same as last time": the entries to save so the row holds last time's numbers.
 * Sets the athlete already ticked today are left alone. Effort and notes are not copied (they are
 * about how today went). `count` is how many sets the row needs to show afterwards.
 */
export function repeatFill(
  row: Pick<LoggableRow, "id" | "kind">,
  last: LastTimeResult | null,
  logs: LogMap,
  shownCount: number,
  maxSets = 20,
): { entries: SessionRowLog[]; count: number } {
  if (!last || !canRepeatLastTime(row, last)) return { entries: [], count: shownCount }
  const source = [...last.sets].filter(hasNumbers).sort((left, right) => left.setIndex - right.setIndex)
  const entries: SessionRowLog[] = []
  let count = shownCount
  source.slice(0, maxSets).forEach((set, index) => {
    const setIndex = index + 1
    const existing = logs[key(row.id, setIndex)]
    if (setIndex > count) count = setIndex
    if (existing?.completed) return
    entries.push({
      rowId: row.id,
      setIndex,
      completed: true,
      reps: row.kind === "strength" ? set.reps : null,
      loadKg: row.kind === "strength" ? set.loadKg : null,
      timeSeconds: row.kind === "time" ? set.timeSeconds : null,
      distanceM: row.kind === "time" ? set.distanceM : null,
      mark: row.kind === "mark" ? set.mark : null,
      rpe: existing?.rpe ?? null,
      note: existing?.note ?? null,
    })
  })
  return { entries, count }
}

/** The note of an exercise: kept on its lowest numbered set that has one. */
export function rowNote(rowId: string, logs: LogMap | SessionRowLog[]): string {
  const all = Array.isArray(logs) ? logs : Object.values(logs)
  const withNote = all.filter((log) => log.rowId === rowId && typeof log.note === "string" && log.note.trim() !== "").sort((left, right) => left.setIndex - right.setIndex)
  return withNote[0]?.note ?? ""
}

export function cleanNote(text: string): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX_LENGTH)
  return trimmed || null
}

export function cleanEffort(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  return rounded >= 1 && rounded <= 10 ? rounded : null
}

/** "8", "7 to 9" or "" for the efforts given to several sets. */
export function effortRange(efforts: Array<number | null | undefined>): string {
  const given = efforts.filter((value): value is number => typeof value === "number")
  if (given.length === 0) return ""
  const low = Math.min(...given)
  const high = Math.max(...given)
  return low === high ? String(low) : `${low} to ${high}`
}

/** "Effort 8, 7, none": one entry per set, in order. Empty when no set has an effort. */
export function effortBySet(sets: Array<{ setIndex: number; rpe?: number | null }>): string {
  if (!sets.some((set) => typeof set.rpe === "number")) return ""
  return [...sets]
    .sort((left, right) => left.setIndex - right.setIndex)
    .map((set) => (typeof set.rpe === "number" ? String(set.rpe) : "none"))
    .join(", ")
}

/** The effort words for the quiet "last time" line: per set efforts win over the session's. */
export function lastTimeEffort(last: Pick<LastTimeResult, "sets" | "sessionEffort">): string {
  const range = effortRange(last.sets.map((set) => set.rpe))
  if (range) return `effort ${range}`
  return last.sessionEffort ? `session effort ${last.sessionEffort}` : ""
}

function trimNumber(value: number) {
  return String(Math.round(value * 1000) / 1000)
}

function clock(value: number) {
  if (value < 60) return `${trimNumber(value)} s`
  const minutes = Math.floor(value / 60)
  const seconds = Math.round((value - minutes * 60) * 100) / 100
  const whole = Math.floor(seconds)
  const fraction = seconds - whole > 0 ? `.${String(Math.round((seconds - whole) * 100)).padStart(2, "0").replace(/0+$/, "")}` : ""
  return `${minutes}:${String(whole).padStart(2, "0")}${fraction}`
}

/** One set of last time in words: "5 x 120 kg", "4.21 s", "2.75 m". */
export function lastTimeSetText(kind: LogKind, set: LastTimeSet): string {
  const parts: string[] = []
  if (set.reps !== null && set.loadKg !== null) parts.push(`${trimNumber(set.reps)} x ${trimNumber(set.loadKg)} kg`)
  else if (set.reps !== null) parts.push(`${trimNumber(set.reps)} reps`)
  else if (set.loadKg !== null) parts.push(`${trimNumber(set.loadKg)} kg`)
  if (set.timeSeconds !== null) parts.push(clock(set.timeSeconds))
  if (set.mark !== null) parts.push(`${trimNumber(set.mark)} m`)
  if (parts.length === 0 && set.distanceM !== null && kind === "time") parts.push(`${trimNumber(set.distanceM)} m`)
  return parts.join(", ") || "Done"
}

/**
 * Seconds of rest a coach wrote down, read from free text: "Rest 90s", "2 min rest",
 * "recovery 1:30", "3' between sets". Null when the text names no rest.
 */
export function parseRestSeconds(text: string | null | undefined): number | null {
  const source = (text ?? "").toLowerCase()
  if (!/\b(rest|recover|recovery|rec|between)\b/.test(source)) return null
  const amount = "(\\d+:\\d{2}|\\d+(?:[.,]\\d+)?)\\s*(seconds|second|secs|sec|s|minutes|minute|mins|min|'|\")?"
  const word = "(?:rest|recovery|recover|rec)"
  const after = new RegExp(`\\b${word}\\b[^\\d]{0,14}${amount}(?![\\d])`).exec(source)
  const before = new RegExp(`${amount}\\s*(?:of\\s+)?(?:${word}\\b|between)`).exec(source)
  const match = after ?? before
  if (!match) return null
  const [value, unit] = [match[1], match[2] ?? ""]
  let seconds: number
  if (value.includes(":")) {
    const [minutes, rest] = value.split(":")
    seconds = Number.parseInt(minutes, 10) * 60 + Number.parseInt(rest, 10)
  } else {
    const parsed = Number.parseFloat(value.replace(",", "."))
    if (!Number.isFinite(parsed)) return null
    const inMinutes = /^(minutes|minute|mins|min|')$/.test(unit) || (unit === "" && parsed <= 10)
    seconds = inMinutes ? parsed * 60 : parsed
  }
  seconds = Math.round(seconds)
  return seconds >= 5 && seconds <= 1800 ? seconds : null
}

/** The rest to offer after a set of this row: what the coach prescribed, else 60 seconds. */
export function restSecondsForRow(texts: Array<string | null | undefined>): { seconds: number; prescribed: boolean } {
  for (const text of texts) {
    const parsed = parseRestSeconds(text)
    if (parsed !== null) return { seconds: parsed, prescribed: true }
  }
  return { seconds: DEFAULT_REST_SECONDS, prescribed: false }
}

/** Which rep a stopwatch time goes into: the first one of the row with no time yet. Null when all have one. */
export function nextOpenTimeSet(rowId: string, logs: LogMap, count: number, maxSets = 20): number | null {
  for (let setIndex = 1; setIndex <= count; setIndex += 1) {
    if ((logs[key(rowId, setIndex)]?.timeSeconds ?? null) === null) return setIndex
  }
  return count < maxSets ? count + 1 : null
}
