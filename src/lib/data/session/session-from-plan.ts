import type { LogKind, LoggableRow, SessionBlockType, SessionRowLog } from "@/lib/data/session/types"
import {
  sessionDisplayTitle,
  slotDate,
  type BlockDraft,
  type ExerciseDraft,
  type PlanDraft,
  type SessionDraft,
} from "@/lib/data/training-plan/plan-builder-model"

/**
 * Turns a coach plan session into the session an athlete logs against.
 * Pure, so the publish step, the athlete's on-demand creation and mock mode all build the same thing.
 */

export type RowBlueprint = {
  sortOrder: number
  label: string
  target: string
  helper: string | null
  kind: LogKind
  targetSets: number
  targetReps: string | null
  targetLoad: string | null
}

export type BlockBlueprint = {
  sortOrder: number
  blockType: SessionBlockType
  name: string
  focus: string | null
  coachNote: string | null
  rows: RowBlueprint[]
}

export type SessionBlueprint = {
  week: number
  dayIndex: number
  date: string
  title: string
  sessionType: SessionDraft["sessionType"]
  durationMinutes: number | null
  location: string | null
  coachNote: string | null
  blocks: BlockBlueprint[]
}

export const MAX_SETS = 20

const TIME_WORDS = /sprint|speed|accel|start|tempo|interval|hill|run|fly|relay|hurdle|race|stride|\b\d+\s?m\b/i
const JUMP_WORDS = /jump|bound|plyo|approach|takeoff|take off|hop|vault/i
const THROW_WORDS = /throw|shot|discus|javelin|hammer|med ball|medicine ball/i
const STRENGTH_WORDS = /strength|power|gym|lift|squat|clean|press|deadlift|weights|accessor/i
const CHECK_WORDS = /warm|cool|mobility|physio|recovery|stretch|activation|core|drill|technique/i

export function inferBlockType(title: string, sessionType: SessionDraft["sessionType"]): SessionBlockType {
  if (THROW_WORDS.test(title)) return "Throws"
  if (JUMP_WORDS.test(title)) return "Jumps"
  if (STRENGTH_WORDS.test(title)) return "Strength"
  if (/sprint|speed|accel|start|fly|hurdle/i.test(title)) return "Sprint"
  if (TIME_WORDS.test(title)) return "Run"
  return sessionType === "Gym" ? "Strength" : "Run"
}

export function inferLogKind(blockTitle: string, exercise: Pick<ExerciseDraft, "name" | "reps" | "load"> | null): LogKind {
  const text = `${exercise?.name ?? ""} ${blockTitle}`
  const name = exercise?.name ?? ""
  if (exercise) {
    if (parseLoadKg(exercise.load) !== null) return "strength"
    if (parseSeconds(exercise.load) !== null || parseSeconds(exercise.reps) !== null) return "time"
    // The exercise name says more than the block it sits in.
    if (THROW_WORDS.test(name) || JUMP_WORDS.test(name)) return "mark"
    if (STRENGTH_WORDS.test(name)) return "strength"
    if (TIME_WORDS.test(name) || parseMeters(exercise.reps) !== null) return "time"
  }
  if (CHECK_WORDS.test(blockTitle) && !STRENGTH_WORDS.test(name)) return "check"
  if (!exercise) return "check"
  if (THROW_WORDS.test(text) || JUMP_WORDS.test(text)) return "mark"
  if (STRENGTH_WORDS.test(text)) return "strength"
  if (TIME_WORDS.test(text)) return "time"
  return "strength"
}

/** Fallback for sessions created before rows stored their own kind. */
export function logKindForBlockType(blockType: SessionBlockType): LogKind {
  if (blockType === "Strength") return "strength"
  if (blockType === "Jumps" || blockType === "Throws") return "mark"
  return "time"
}

export function parseSetCount(value: string | number | null | undefined): number {
  const match = /\d+/.exec(String(value ?? ""))
  const count = match ? Number.parseInt(match[0], 10) : 1
  return Math.max(1, Math.min(MAX_SETS, Number.isFinite(count) ? count : 1))
}

function firstNumber(value: string | null | undefined): number | null {
  const match = /\d+(?:[.,]\d+)?/.exec(value ?? "")
  if (!match) return null
  const parsed = Number.parseFloat(match[0].replace(",", "."))
  return Number.isFinite(parsed) ? parsed : null
}

/** "100kg", "100 kg" or a bare "100" count as a load. "80%", "BW" and "7.2s" do not. */
export function parseLoadKg(value: string | null | undefined): number | null {
  const text = (value ?? "").trim()
  if (!text) return null
  if (/%|bw|body/i.test(text)) return null
  if (/\d\s*(s|sec|secs|m|min)\b/i.test(text)) return null
  if (/kg|kilo|lb/i.test(text) || /^\d+(?:[.,]\d+)?$/.test(text)) return firstNumber(text)
  return null
}

export function parseSeconds(value: string | null | undefined): number | null {
  const text = (value ?? "").trim()
  const clock = /(\d+):(\d{1,2}(?:[.,]\d+)?)/.exec(text)
  if (clock) return Number.parseInt(clock[1], 10) * 60 + Number.parseFloat(clock[2].replace(",", "."))
  const seconds = /(\d+(?:[.,]\d+)?)\s*(s|sec|secs|seconds)\b/i.exec(text)
  return seconds ? Number.parseFloat(seconds[1].replace(",", ".")) : null
}

export function parseMeters(value: string | null | undefined): number | null {
  const match = /(\d+(?:[.,]\d+)?)\s*(m|metres|meters)\b/i.exec((value ?? "").trim())
  return match ? Number.parseFloat(match[1].replace(",", ".")) : null
}

export function parseReps(value: string | null | undefined): number | null {
  const text = (value ?? "").trim()
  if (!text || parseMeters(text) !== null || parseSeconds(text) !== null) return null
  return firstNumber(text)
}

/** What "same as target" fills in for one set. Only values the coach actually wrote down. */
export function targetValues(row: Pick<LoggableRow, "kind" | "targetReps" | "targetLoad" | "target">) {
  const reps = row.targetReps ?? ""
  const load = row.targetLoad ?? ""
  if (row.kind === "strength") return { reps: parseReps(reps), loadKg: parseLoadKg(load) }
  if (row.kind === "time") {
    return {
      timeSeconds: parseSeconds(load) ?? parseSeconds(reps),
      distanceM: parseMeters(reps) ?? parseMeters(row.target),
    }
  }
  if (row.kind === "mark") return { mark: parseMeters(load) }
  return {}
}

function exerciseTarget(exercise: ExerciseDraft) {
  const sets = exercise.sets.trim()
  const reps = exercise.reps.trim()
  const volume = sets && reps ? `${sets} x ${reps}` : reps || (sets ? `${sets} sets` : "")
  const load = exercise.load.trim()
  return [volume, load ? `at ${load}` : ""].filter(Boolean).join(" ") || "As coached"
}

function blockRows(block: BlockDraft, title: string): RowBlueprint[] {
  const named = block.exercises.filter((exercise) => exercise.name.trim() || exercise.sets.trim() || exercise.reps.trim())
  if (named.length === 0) {
    return [
      {
        sortOrder: 0,
        label: title,
        target: block.notes.trim() || "As coached",
        helper: null,
        kind: "check",
        targetSets: 1,
        targetReps: null,
        targetLoad: null,
      },
    ]
  }
  return named.map((exercise, index) => ({
    sortOrder: index,
    label: exercise.name.trim() || `${title} ${index + 1}`,
    target: exerciseTarget(exercise),
    helper: null,
    kind: inferLogKind(title, exercise),
    targetSets: parseSetCount(exercise.sets),
    targetReps: exercise.reps.trim() || null,
    targetLoad: exercise.load.trim() || null,
  }))
}

export function sessionBlueprint(plan: Pick<PlanDraft, "startDate">, session: SessionDraft): SessionBlueprint {
  const date = slotDate(plan, session.week, session.dayIndex)
  const title = sessionDisplayTitle(session, date)
  const duration = Number.parseInt(session.durationMinutes, 10)
  const blocks = session.blocks.length > 0 ? session.blocks : [{ id: "session", title, notes: session.notes, exercises: [] }]
  return {
    week: session.week,
    dayIndex: session.dayIndex,
    date,
    title,
    sessionType: session.sessionType,
    durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : null,
    location: session.location.trim() || null,
    coachNote: session.notes.trim() || null,
    blocks: blocks.map((block, index) => {
      const name = block.title.trim() || `Block ${index + 1}`
      const hasExercises = block.exercises.some((exercise) => exercise.name.trim() || exercise.sets.trim() || exercise.reps.trim())
      return {
        sortOrder: index,
        blockType: inferBlockType(name, session.sessionType),
        name,
        focus: null,
        // With exercises the block note is coaching context. Without them it is the target of the single row.
        coachNote: hasExercises ? block.notes.trim() || null : null,
        rows: blockRows(block, name),
      }
    }),
  }
}

export function planBlueprints(plan: Pick<PlanDraft, "startDate" | "sessions">): SessionBlueprint[] {
  return plan.sessions
    .map((session) => sessionBlueprint(plan, session))
    .sort((left, right) => left.date.localeCompare(right.date))
}

function trimNumber(value: number) {
  return String(Math.round(value * 1000) / 1000)
}

export function formatSeconds(value: number) {
  if (value < 60) return `${trimNumber(value)} s`
  const minutes = Math.floor(value / 60)
  const seconds = Math.round((value - minutes * 60) * 100) / 100
  const whole = Math.floor(seconds)
  const fraction = seconds - whole > 0 ? String(Math.round((seconds - whole) * 100)).padStart(2, "0").replace(/0+$/, "") : ""
  return `${minutes}:${String(whole).padStart(2, "0")}${fraction ? `.${fraction}` : ""}`
}

/** One logged set as a coach or athlete reads it. Empty string when nothing was recorded. */
export function formatSetLog(kind: LogKind, log: SessionRowLog): string {
  const parts: string[] = []
  if (log.reps !== null && log.loadKg !== null) parts.push(`${trimNumber(log.reps)} x ${trimNumber(log.loadKg)} kg`)
  else if (log.reps !== null) parts.push(`${trimNumber(log.reps)} reps`)
  else if (log.loadKg !== null) parts.push(`${trimNumber(log.loadKg)} kg`)
  if (log.timeSeconds !== null) parts.push(formatSeconds(log.timeSeconds))
  if (log.mark !== null) parts.push(`${trimNumber(log.mark)} m`)
  if (parts.length === 0 && log.distanceM !== null && kind === "time") parts.push(`${trimNumber(log.distanceM)} m`)
  if (parts.length > 0) return parts.join(", ")
  return log.completed ? "Done" : ""
}

export function isLogEmpty(log: SessionRowLog) {
  return !log.completed && log.reps === null && log.loadKg === null && log.timeSeconds === null && log.mark === null
}

/**
 * Several sets of one exercise in a few words, for "Last time: 3 x 5 at 120kg".
 * Equal strength sets collapse to "sets x reps at load"; everything else is listed set by set.
 */
export function summariseSets(kind: LogKind, logs: SessionRowLog[]): string {
  const sets = logs.filter((log) => !isLogEmpty(log)).sort((left, right) => left.setIndex - right.setIndex)
  if (sets.length === 0) return ""
  const strength = sets.filter((log) => log.reps !== null || log.loadKg !== null)
  if (strength.length === sets.length) {
    const one = (log: SessionRowLog) =>
      log.reps !== null && log.loadKg !== null ? `${trimNumber(log.reps)} at ${trimNumber(log.loadKg)}kg` : log.reps !== null ? `${trimNumber(log.reps)} reps` : `${trimNumber(log.loadKg ?? 0)}kg`
    const same = sets.every((log) => log.reps === sets[0].reps && log.loadKg === sets[0].loadKg)
    if (same && sets[0].reps !== null) {
      return sets[0].loadKg !== null ? `${sets.length} x ${trimNumber(sets[0].reps)} at ${trimNumber(sets[0].loadKg)}kg` : `${sets.length} x ${trimNumber(sets[0].reps)}`
    }
    return sets.map(one).join(", ")
  }
  const parts = sets.map((log) => formatSetLog(kind, log)).filter(Boolean)
  if (parts.every((part) => part === "Done")) return parts.length > 1 ? `${parts.length} done` : "Done"
  return parts.join(", ")
}

/** How exercise names are matched between sessions: case and outer spaces do not matter. */
export function exerciseKey(label: string) {
  return label.trim().toLowerCase()
}
