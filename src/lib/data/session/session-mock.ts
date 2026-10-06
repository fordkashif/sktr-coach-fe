import { readStoredMockPlans } from "@/components/coach/training-plan/mock-adapter"
import { loadMockSquads } from "@/lib/data/coach/squads-mock"
import { availabilityCovers, readMockAvailability } from "@/lib/data/athlete/availability-data"
import { err, ok, type Result } from "@/lib/data/result"
import { mockLiftMaxKg } from "@/lib/data/exercises/mock-exercise-store"
import { cleanEffort, effortBySet, exerciseMatchKey, rowNote } from "@/lib/data/session/log-assist"
import {
  formatSetLog,
  isLogEmpty,
  blueprintForAthlete,
  planBlueprints,
  summariseSets,
  targetValues,
  type SessionBlueprint,
} from "@/lib/data/session/session-from-plan"
import type {
  AthleteSession,
  AthleteSessionDay,
  AthleteSessionRef,
  AthleteWeekDay,
  ExtraExerciseInput,
  ExtraSessionInput,
  LastTimeResult,
  LoggableBlock,
  LoggableRow,
  LoggedSessionResults,
  SessionOrigin,
  SessionRowLog,
  SkipReason,
} from "@/lib/data/session/types"
import type { TrainingPlanDetail, TrainingPlanSummary } from "@/lib/data/training-plan/types"
import {
  addDaysIso,
  newSession,
  planEndDate,
  todayIso,
  type ExerciseDraft,
  type PlanDraft,
  type SessionDraft,
} from "@/lib/data/training-plan/plan-builder-model"
import { phaseForWeek } from "@/lib/data/training-plan/plan-phases"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Mock mode sessions. The signed-in mock athlete is Marcus Johnson (a1, Sprint Group).
 * Sessions come from plans a coach published in this browser, and from a rolling demo plan
 * for any day those plans do not cover, so there is always something to log today.
 * The first week of the demo plan comes with a little history (three sessions done, one missed,
 * one skipped) so the history list and the "last time" hint have something to show.
 */

export const MOCK_ATHLETE_ID = "a1"
const MOCK_ATHLETE_TEAM_ID = "t1"
const MOCK_ATHLETE_EVENT_GROUP = "Sprint"
const STORAGE_KEY = "pacelab:athlete-session-logs:v1"

type StoredSession = {
  date: string
  title: string
  blocks: LoggableBlock[]
  logs: SessionRowLog[]
  completedOn: string | null
  rpe: number | null
  comment: string | null
  /** How long it took, in minutes. Missing on sessions finished before this was asked. */
  durationMinutes?: number | null
  /** Set while the session is skipped. */
  skip?: { reason: SkipReason; note: string | null } | null
  /** "athlete" for a session the athlete added themselves. Missing means planned. */
  origin?: SessionOrigin
}

type Store = Record<string, StoredSession>

function readStore(): Store {
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(STORAGE_KEY))
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

function writeStore(store: Store) {
  window.localStorage.setItem(tenantStorageKey(STORAGE_KEY), JSON.stringify(store))
}

function exercise(name: string, sets: string, reps: string, load = ""): ExerciseDraft {
  return { id: `demo-${name}`, name, sets, reps, load }
}

type DemoTemplate = Pick<SessionDraft, "title" | "sessionType" | "location" | "durationMinutes" | "intendedEffort" | "notes" | "blocks">

const DEMO_TEMPLATES: Record<string, DemoTemplate> = {
  acceleration: {
    title: "Acceleration and weights",
    sessionType: "Mixed",
    location: "Track and weight room",
    durationMinutes: "75",
    intendedEffort: "7",
    notes: "Stay crisp on the starts. Keep the lifts fast, never grinding.",
    blocks: [
      { id: "demo-a-1", title: "Warm up", notes: "10 min jog, drills, 3 build ups", exercises: [] },
      {
        id: "demo-a-2",
        title: "Block starts",
        notes: "Full recovery between reps. Quality over times.",
        exercises: [exercise("30m from blocks", "4", "30m")],
      },
      {
        id: "demo-a-3",
        title: "Strength",
        notes: "Rest 2 min between sets.",
        exercises: [exercise("Power clean", "4", "3", "95kg"), exercise("Back squat", "3", "5", "120kg")],
      },
    ],
  },
  tempo: {
    title: "Tempo and mobility",
    sessionType: "Recovery",
    location: "Track",
    durationMinutes: "50",
    intendedEffort: "4",
    notes: "Easy rhythm. You should finish feeling better than you started.",
    blocks: [
      { id: "demo-b-1", title: "Tempo", notes: "Walk back recovery.", exercises: [exercise("200m tempo", "6", "200m", "32s")] },
      { id: "demo-b-2", title: "Mobility", notes: "Hips and ankles, 10 min", exercises: [] },
    ],
  },
  power: {
    title: "Jumps and power",
    sessionType: "Mixed",
    location: "Track and weight room",
    durationMinutes: "70",
    intendedEffort: "7",
    notes: "Sharp contacts. Stop a set early if the bounce goes.",
    blocks: [
      { id: "demo-c-1", title: "Warm up", notes: "10 min jog, drills, 3 build ups", exercises: [] },
      {
        id: "demo-c-2",
        title: "Jumps",
        notes: "",
        exercises: [exercise("Standing long jump", "4", "1"), exercise("Overhead med ball throw", "3", "1")],
      },
      { id: "demo-c-3", title: "Strength", notes: "", exercises: [exercise("Trap bar deadlift", "3", "4", "140kg")] },
    ],
  },
}

const DEMO_PATTERN: Array<[number, keyof typeof DEMO_TEMPLATES]> = [
  [0, "acceleration"],
  [1, "tempo"],
  [3, "power"],
  [4, "acceleration"],
  [5, "tempo"],
]

/** Starts a week ago, so today is always a training day with rest days either side of the week. */
function demoPlan(): Pick<PlanDraft, "startDate" | "weeks" | "sessions"> {
  const startDate = addDaysIso(todayIso(), -7)
  const sessions: SessionDraft[] = []
  for (let week = 1; week <= 4; week += 1) {
    for (const [dayIndex, key] of DEMO_PATTERN) {
      sessions.push({ ...newSession(week, dayIndex, DEMO_TEMPLATES[key]), id: `demo-${week}-${dayIndex}` })
    }
  }
  return { startDate, weeks: 4, sessions }
}

function coachPlansForMockAthlete() {
  try {
    return readStoredMockPlans().filter((plan) => {
      if (plan.status !== "published" || plan.teamId !== MOCK_ATHLETE_TEAM_ID) return false
      if (plan.assign.target === "team") return true
      if (plan.assign.target === "subgroup") return plan.assign.subgroup === MOCK_ATHLETE_EVENT_GROUP
      if (plan.assign.target === "squads") return loadMockSquads(MOCK_ATHLETE_TEAM_ID).some((squad) => plan.assign.squadIds.includes(squad.id) && squad.athleteIds.includes(MOCK_ATHLETE_ID))
      return plan.assign.athleteIds.includes(MOCK_ATHLETE_ID)
    })
  } catch {
    return []
  }
}

type Calendar = {
  byDate: Map<string, SessionBlueprint>
  ranges: Array<{ start: string; end: string }>
  /** Dates whose session comes from the rolling demo plan (not from a plan a coach published here). */
  demoDates: Set<string>
}

function buildCalendar(): Calendar {
  const coachPlans = coachPlansForMockAthlete()
  const ranges = coachPlans.map((plan) => ({ start: plan.startDate, end: planEndDate(plan) }))
  const coveredByCoach = (date: string) => ranges.some((range) => date >= range.start && date <= range.end)
  const byDate = new Map<string, SessionBlueprint>()
  const demoDates = new Set<string>()
  for (const plan of coachPlans) {
    // The demo athlete gets the coach's changes for them and their loads in kilograms (percent of best lift).
    for (const blueprint of planBlueprints(plan)) {
      if (!byDate.has(blueprint.date)) byDate.set(blueprint.date, blueprintForAthlete(blueprint, MOCK_ATHLETE_ID, (lift) => mockLiftMaxKg(MOCK_ATHLETE_ID, lift)))
    }
  }
  const demo = demoPlan()
  for (const blueprint of planBlueprints(demo)) {
    if (!coveredByCoach(blueprint.date) && !byDate.has(blueprint.date)) {
      byDate.set(blueprint.date, blueprint)
      demoDates.add(blueprint.date)
    }
  }
  return { byDate, ranges: [...ranges, { start: demo.startDate, end: planEndDate(demo) }], demoDates }
}

export function mockSessionId(date: string) {
  return `mock:${date}`
}

function isExtraId(sessionId: string) {
  return sessionId.startsWith("extra:")
}

function blueprintBlocks(sessionId: string, blueprint: SessionBlueprint): LoggableBlock[] {
  return blueprint.blocks.map((block) => {
    const blockId = `${sessionId}:b${block.sortOrder}`
    return {
      id: blockId,
      sessionId,
      sortOrder: block.sortOrder,
      blockType: block.blockType,
      name: block.name,
      focus: block.focus,
      coachNote: block.coachNote,
      previousResult: null,
      restLabel: null,
      rows: block.rows.map((row) => ({
        id: `${blockId}:r${row.sortOrder}`,
        sessionBlockId: blockId,
        sortOrder: row.sortOrder,
        label: row.label,
        target: row.target,
        helper: row.helper,
        referenceUrl: row.referenceUrl ?? null,
        kind: row.kind,
        targetSets: row.targetSets,
        targetReps: row.targetReps,
        targetLoad: row.targetLoad,
        percent: row.percent ?? null,
        liftName: row.liftName ?? null,
      })),
    }
  })
}

/* Demo history: what "last week" looks like before the athlete has touched anything. */
const DEMO_HISTORY: Array<{ daysAgo: number; outcome: "done" | "skipped"; rpe?: number; minutes?: number; comment?: string; reason?: SkipReason }> = [
  { daysAgo: 7, outcome: "done", rpe: 7, minutes: 80, comment: "Starts felt sharp." },
  { daysAgo: 6, outcome: "done", rpe: 4, minutes: 50 },
  { daysAgo: 4, outcome: "done", rpe: 6, minutes: 70 },
  { daysAgo: 2, outcome: "skipped", reason: "competing" },
]

function demoLogs(blocks: LoggableBlock[]): SessionRowLog[] {
  return blocks.flatMap((block) =>
    block.rows.flatMap((row) => {
      const target = targetValues(row)
      return Array.from({ length: row.targetSets }, (_, index): SessionRowLog => ({
        rowId: row.id,
        setIndex: index + 1,
        completed: true,
        reps: target.reps ?? null,
        loadKg: target.loadKg ?? null,
        // A believable result where the coach set no number: 30m from blocks, a standing long jump.
        timeSeconds: target.timeSeconds ?? (row.kind === "time" ? Math.round((4.2 + index * 0.03) * 100) / 100 : null),
        distanceM: target.distanceM ?? null,
        mark: target.mark ?? (row.kind === "mark" ? Math.round((2.7 + index * 0.05) * 100) / 100 : null),
        // Lifts were rated set by set, getting harder. The first set carries the exercise note.
        rpe: row.kind === "strength" ? Math.min(10, 7 + Math.floor(index / 2)) : null,
        note: index === 0 && row.label === "Back squat" ? "Last set was slow out of the hole." : null,
      }))
    }),
  )
}

function demoHistory(calendar: Calendar): Store {
  const today = todayIso()
  const seeded: Store = {}
  for (const entry of DEMO_HISTORY) {
    const date = addDaysIso(today, -entry.daysAgo)
    const blueprint = calendar.byDate.get(date)
    if (!blueprint || !calendar.demoDates.has(date)) continue
    const id = mockSessionId(date)
    const blocks = blueprintBlocks(id, blueprint)
    seeded[id] = {
      date,
      title: blueprint.title,
      blocks,
      logs: entry.outcome === "done" ? demoLogs(blocks) : [],
      completedOn: entry.outcome === "done" ? date : null,
      rpe: entry.rpe ?? null,
      comment: entry.comment ?? null,
      durationMinutes: entry.minutes ?? null,
      skip: entry.outcome === "skipped" ? { reason: entry.reason ?? "other", note: null } : null,
    }
  }
  return seeded
}

/** The stored sessions with the demo history underneath. Anything the athlete saved wins. */
function loadStore(calendar: Calendar): Store {
  return { ...demoHistory(calendar), ...readStore() }
}

function storedStatus(stored: StoredSession | undefined): AthleteSession["status"] {
  if (stored?.completedOn) return "completed"
  if (stored?.skip) return "skipped"
  return stored && stored.logs.length > 0 ? "in-progress" : "scheduled"
}

function toSession(blueprint: SessionBlueprint, stored: StoredSession | undefined): AthleteSession {
  const id = mockSessionId(blueprint.date)
  // Once the athlete has logged against a session its shape is kept, even if the plan changes later.
  const blocks = stored && stored.logs.length > 0 ? stored.blocks : blueprintBlocks(id, blueprint)
  return {
    id,
    title: blueprint.title,
    status: storedStatus(stored),
    scheduledFor: blueprint.date,
    estimatedDurationMinutes: blueprint.durationMinutes,
    coachNote: blueprint.coachNote,
    location: blueprint.location,
    completedOn: stored?.completedOn ?? null,
    overallRpe: stored?.rpe ?? null,
    durationMinutes: stored?.durationMinutes ?? null,
    athleteComment: stored?.comment ?? null,
    origin: "plan",
    skipReason: stored?.completedOn ? null : (stored?.skip?.reason ?? null),
    skipNote: stored?.completedOn ? null : (stored?.skip?.note ?? null),
    blocks,
    logs: stored?.logs ?? [],
  }
}

function extraToSession(id: string, stored: StoredSession): AthleteSession {
  return {
    id,
    title: stored.title,
    status: storedStatus({ ...stored, skip: null }),
    scheduledFor: stored.date,
    estimatedDurationMinutes: null,
    coachNote: null,
    location: null,
    completedOn: stored.completedOn,
    overallRpe: stored.rpe,
    durationMinutes: stored.durationMinutes ?? null,
    athleteComment: stored.comment,
    origin: "athlete",
    skipReason: null,
    skipNote: null,
    blocks: stored.blocks,
    logs: stored.logs,
  }
}

function toRef(session: AthleteSession): AthleteSessionRef {
  return {
    id: session.id,
    date: session.scheduledFor,
    title: session.title,
    origin: session.origin,
    status: session.status,
    skipReason: session.skipReason,
    completedOn: session.completedOn,
    rpe: session.overallRpe,
  }
}

function extraSessions(store: Store): AthleteSession[] {
  return Object.entries(store)
    .filter(([id, stored]) => isExtraId(id) && stored?.origin === "athlete")
    .map(([id, stored]) => extraToSession(id, stored))
}

export function weekStartIso(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`)
  const offset = (parsed.getUTCDay() + 6) % 7
  return addDaysIso(date, -offset)
}

/** The planned session of a day, or with `sessionId` one specific session (one the athlete added). */
export function loadMockSessionDay(date: string, sessionId?: string | null): Result<AthleteSessionDay> {
  const calendar = buildCalendar()
  const store = loadStore(calendar)
  const periods = readMockAvailability(MOCK_ATHLETE_ID)
  const excused = (day: string) => periods.some((period) => availabilityCovers(period, day))
  const blueprint = calendar.byDate.get(date)
  const inPlan = (day: string) => calendar.ranges.some((range) => day >= range.start && day <= range.end)
  const weekStart = weekStartIso(date)
  const week: AthleteWeekDay[] = Array.from({ length: 7 }, (_, index) => {
    const day = addDaysIso(weekStart, index)
    const stored = store[mockSessionId(day)]
    return {
      date: day,
      kind: calendar.byDate.has(day) ? "session" : inPlan(day) ? "rest" : "none",
      done: Boolean(stored?.completedOn),
      skipped: !stored?.completedOn && Boolean(stored?.skip) && calendar.byDate.has(day),
      excused: excused(day),
    }
  })
  const nextDate = [...calendar.byDate.keys()].sort().find((day) => day > date)
  const nextBlueprint = nextDate ? calendar.byDate.get(nextDate) : undefined
  const planned = blueprint ? toSession(blueprint, store[mockSessionId(date)]) : null
  const extras = extraSessions(store).filter((session) => session.scheduledFor === date)
  const chosen = sessionId ? (extras.find((session) => session.id === sessionId) ?? (planned?.id === sessionId ? planned : null)) : planned
  if (sessionId && !chosen) return err("NOT_FOUND", "That session no longer exists.")
  return ok({
    date,
    session: chosen,
    inPlan: inPlan(date),
    next: nextBlueprint ? { date: nextBlueprint.date, title: nextBlueprint.title } : null,
    week,
    others: [...(planned ? [planned] : []), ...extras].filter((session) => session.id !== chosen?.id).map(toRef),
    excused: excused(date),
  })
}

function offline() {
  return typeof navigator !== "undefined" && navigator.onLine === false
}

function storedFor(store: Store, sessionId: string): StoredSession | null {
  if (store[sessionId]) return store[sessionId]
  const date = sessionId.startsWith("mock:") ? sessionId.slice(5) : ""
  const blueprint = buildCalendar().byDate.get(date)
  if (!blueprint) return null
  return {
    date,
    title: blueprint.title,
    blocks: blueprintBlocks(sessionId, blueprint),
    logs: [],
    completedOn: null,
    rpe: null,
    comment: null,
  }
}

/** Reads, changes and writes one stored session. Only what the athlete touched is written back. */
function updateStored(sessionId: string, change: (stored: StoredSession) => StoredSession): Result<null> {
  if (offline()) return err("UNKNOWN", "You are offline.")
  try {
    const saved = readStore()
    const stored = storedFor(loadStore(buildCalendar()), sessionId)
    if (!stored) return err("NOT_FOUND", "That session no longer exists.")
    writeStore({ ...saved, [sessionId]: change(stored) })
    return ok(null)
  } catch {
    return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
  }
}

export function saveMockRowLogs(sessionId: string, logs: SessionRowLog[]): Result<null> {
  return updateStored(sessionId, (stored) => {
    const merged = new Map(stored.logs.map((log) => [`${log.rowId}:${log.setIndex}`, log]))
    for (const log of logs) merged.set(`${log.rowId}:${log.setIndex}`, log)
    return { ...stored, logs: [...merged.values()] }
  })
}

export function saveMockCompletion(params: {
  sessionId: string
  completionDate: string
  rpe: number | null
  comment: string | null
  durationMinutes?: number | null
}): Result<null> {
  return updateStored(params.sessionId, (stored) => ({
    ...stored,
    completedOn: stored.completedOn ?? params.completionDate,
    rpe: params.rpe,
    comment: params.comment,
    // Left as it was when the caller does not say (an older queued completion).
    ...(params.durationMinutes === undefined ? {} : { durationMinutes: params.durationMinutes }),
    // Finishing a skipped session means it was done after all.
    skip: null,
  }))
}

export function skipMockSession(sessionId: string, reason: SkipReason, note: string | null): Result<null> {
  if (isExtraId(sessionId)) return err("VALIDATION", "A session you added yourself cannot be skipped. Remove it instead.")
  const existing = storedFor(loadStore(buildCalendar()), sessionId)
  if (existing?.completedOn) return err("VALIDATION", "This session is already logged as done.")
  return updateStored(sessionId, (stored) => ({ ...stored, skip: { reason, note: note?.trim().slice(0, 280) || null } }))
}

export function unskipMockSession(sessionId: string): Result<null> {
  return updateStored(sessionId, (stored) => ({ ...stored, skip: null }))
}

function newId(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** A session the athlete adds themselves: one block of the chosen type, exercises added as they go. */
export function createMockExtraSession(input: ExtraSessionInput): Result<{ sessionId: string }> {
  if (offline()) return err("UNKNOWN", "You are offline.")
  try {
    const sessionId = newId("extra:")
    const block: LoggableBlock = {
      id: `${sessionId}:b0`,
      sessionId,
      sortOrder: 0,
      blockType: input.blockType,
      name: input.title,
      focus: null,
      coachNote: null,
      previousResult: null,
      restLabel: null,
      rows: [],
    }
    writeStore({
      ...readStore(),
      [sessionId]: { date: input.date, title: input.title, blocks: [block], logs: [], completedOn: null, rpe: null, comment: null, origin: "athlete" },
    })
    return ok({ sessionId })
  } catch {
    return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
  }
}

export function extraExerciseTarget(input: ExtraExerciseInput) {
  const noun = input.kind === "time" ? "rep" : input.kind === "mark" ? "attempt" : "set"
  return input.kind === "check" ? "Tick when done" : `${input.sets} ${noun}${input.sets === 1 ? "" : "s"}`
}

export function addMockExtraExercise(sessionId: string, input: ExtraExerciseInput): Result<LoggableRow> {
  if (!isExtraId(sessionId)) return err("FORBIDDEN", "Exercises can only be added to a session you added yourself.")
  let created: LoggableRow | null = null
  const result = updateStored(sessionId, (stored) => {
    const block = stored.blocks[0]
    const sortOrder = block.rows.length
    created = {
      id: newId(`${block.id}:r`),
      sessionBlockId: block.id,
      sortOrder,
      label: input.label,
      target: extraExerciseTarget(input),
      helper: null,
      kind: input.kind,
      targetSets: input.kind === "check" ? 1 : input.sets,
      targetReps: null,
      targetLoad: null,
    }
    return { ...stored, blocks: [{ ...block, rows: [...block.rows, created] }, ...stored.blocks.slice(1)] }
  })
  if (!result.ok) return result
  return created ? ok(created) : err("UNKNOWN", "Could not add the exercise.")
}

export function deleteMockExtraSession(sessionId: string): Result<null> {
  if (!isExtraId(sessionId)) return err("FORBIDDEN", "Only a session you added yourself can be removed.")
  if (offline()) return err("UNKNOWN", "You are offline.")
  const store = readStore()
  delete store[sessionId]
  writeStore(store)
  return ok(null)
}

/** Every session between two days (inclusive): planned ones from the calendar and the ones the athlete added. Newest first. */
export function listMockSessionRefs(from: string, to: string): AthleteSessionRef[] {
  const calendar = buildCalendar()
  const store = loadStore(calendar)
  const planned = [...calendar.byDate.entries()]
    .filter(([date]) => date >= from && date <= to)
    .map(([date, blueprint]) => toRef(toSession(blueprint, store[mockSessionId(date)])))
  const extras = extraSessions(store)
    .filter((session) => session.scheduledFor >= from && session.scheduledFor <= to)
    .map(toRef)
  return [...planned, ...extras].sort((left, right) => right.date.localeCompare(left.date) || left.origin.localeCompare(right.origin))
}

/** For each exercise (keys from exerciseMatchKey): what was logged in the most recent finished session before `before`. */
export function mockLastTime(keys: string[], before: string, excludeSessionId: string | null): Record<string, LastTimeResult> {
  const calendar = buildCalendar()
  const wanted = new Set(keys.map(exerciseMatchKey))
  const finished = Object.entries(loadStore(calendar))
    .filter(([id, stored]) => stored?.completedOn && id !== excludeSessionId && stored.date <= before)
    .sort(([, left], [, right]) => right.date.localeCompare(left.date))
  const found: Record<string, LastTimeResult> = {}
  for (const [, stored] of finished) {
    for (const block of stored.blocks ?? []) {
      for (const row of block.rows) {
        const key = exerciseMatchKey(row.label)
        if (!wanted.has(key) || found[key]) continue
        const logs = stored.logs.filter((log) => log.rowId === row.id && log.completed).sort((left, right) => left.setIndex - right.setIndex)
        const summary = summariseSets(row.kind, logs)
        if (!summary || summary === "Done" || / done$/.test(summary)) continue
        found[key] = {
          date: stored.date,
          summary,
          kind: row.kind,
          sets: logs.map((log) => ({
            setIndex: log.setIndex,
            reps: log.reps,
            loadKg: log.loadKg,
            timeSeconds: log.timeSeconds,
            distanceM: log.distanceM,
            mark: log.mark,
            rpe: cleanEffort(log.rpe),
          })),
          sessionEffort: cleanEffort(stored.rpe),
          note: logs.find((log) => typeof log.note === "string" && log.note.trim() !== "")?.note ?? null,
        }
      }
    }
  }
  return found
}

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** The athlete's plans for the plan screen in mock mode: plans a coach published here, then the demo plan. */
export function mockAthletePlans(): Array<{ summary: TrainingPlanSummary; detail: TrainingPlanDetail }> {
  const today = todayIso()
  const calendar = buildCalendar()
  const demo = demoPlan()
  const sources: Array<{ id: string; name: string; plan: Pick<PlanDraft, "startDate" | "weeks" | "sessions">; emphasis: string[]; weekTypes: Array<string | null>; phaseNames: Array<string | null>; demo: boolean }> = [
    ...coachPlansForMockAthlete().map((plan) => ({
      id: plan.id || `plan-${plan.name}`,
      name: plan.name || "Training plan",
      plan,
      emphasis: Array.from({ length: plan.weeks }, (_, index) => plan.weekFocus?.[String(index + 1)] ?? ""),
      weekTypes: Array.from({ length: plan.weeks }, (_, index) => plan.weekTypes?.[String(index + 1)] ?? null),
      phaseNames: Array.from({ length: plan.weeks }, (_, index) => phaseForWeek(plan.phases, index + 1)?.name ?? null),
      demo: false,
    })),
    {
      id: "demo-plan",
      name: "General performance block",
      plan: demo,
      emphasis: ["Getting back into rhythm", "Speed and strength", "Sharpen up", "Taper"],
      weekTypes: ["build", "build", "hold", "deload"],
      phaseNames: ["Specific prep", "Specific prep", "Specific prep", "Taper"],
      demo: true,
    },
  ]
  return sources.map((source) => {
    const blueprints = planBlueprints(source.plan)
      .map((blueprint) => blueprintForAthlete(blueprint, MOCK_ATHLETE_ID, (lift) => mockLiftMaxKg(MOCK_ATHLETE_ID, lift)))
      .filter((blueprint) => (source.demo ? calendar.demoDates.has(blueprint.date) : true))
    const weeks = Array.from({ length: Math.max(source.plan.weeks, 1) }, (_, index) => {
      const weekNumber = index + 1
      const start = addDaysIso(source.plan.startDate, index * 7)
      const end = addDaysIso(start, 6)
      return {
        id: `${source.id}-week-${weekNumber}`,
        weekNumber,
        emphasis: source.emphasis[index] || null,
        weekType: source.weekTypes[index] ?? null,
        phaseName: source.phaseNames[index] ?? null,
        status: end < today ? ("completed" as const) : start <= today ? ("current" as const) : ("up-next" as const),
        days: blueprints
          .filter((blueprint) => blueprint.week === weekNumber)
          .map((blueprint) => ({
            id: `${source.id}-w${weekNumber}-d${blueprint.dayIndex}`,
            dayIndex: blueprint.dayIndex,
            dayLabel: WEEKDAY_SHORT[(new Date(`${blueprint.date}T00:00:00Z`).getUTCDay() + 6) % 7],
            date: blueprint.date,
            title: blueprint.title,
            sessionType: blueprint.sessionType,
            focus: "",
            status: "scheduled" as const,
            durationMinutes: blueprint.durationMinutes,
            location: blueprint.location,
            coachNote: blueprint.coachNote,
            blockPreview: blueprint.blocks.flatMap((block) =>
              block.rows.length > 0 && !(block.rows.length === 1 && block.rows[0].label === block.name)
                ? block.rows.map((row) => `${row.label} ${row.target}`)
                : [block.name],
            ),
          })),
      }
    })
    return {
      summary: { id: source.id, name: source.name, teamId: MOCK_ATHLETE_TEAM_ID, startDate: source.plan.startDate, weeks: source.plan.weeks, status: "published" as const },
      detail: { planId: source.id, weeks },
    }
  })
}

export function loggedResults(
  blocks: LoggableBlock[],
  logs: SessionRowLog[],
  rpe: number | null,
  comment: string | null,
): LoggedSessionResults | null {
  const exercises = blocks.flatMap((block) =>
    block.rows.flatMap((row) => {
      const logged = logs.filter((log) => log.rowId === row.id && !isLogEmpty(log)).sort((left, right) => left.setIndex - right.setIndex)
      const sets = logged.map((log) => formatSetLog(row.kind, log)).filter(Boolean)
      return sets.length > 0
        ? [{ id: row.id, blockName: block.name, label: row.label, target: row.target, sets, efforts: effortBySet(logged), note: rowNote(row.id, logs) || null }]
        : []
    }),
  )
  if (exercises.length === 0 && rpe === null && !comment) return null
  return { rpe, comment, exercises }
}

export type MockLoggedSession = {
  id: string
  date: string
  title: string
  status: "in-progress" | "completed" | "skipped"
  origin: SessionOrigin
  skipReason: SkipReason | null
  skipNote: string | null
  completedOn: string | null
  results: LoggedSessionResults | null
}

/** What the mock athlete has logged or skipped in this browser, newest first, for the coach athlete screen. */
export function listMockLoggedSessions(athleteId: string): MockLoggedSession[] {
  if (athleteId !== MOCK_ATHLETE_ID || typeof window === "undefined") return []
  return Object.entries(loadStore(buildCalendar()))
    .filter(([, stored]) => stored && (stored.completedOn || stored.skip || (Array.isArray(stored.logs) && stored.logs.length > 0)))
    .map(([id, stored]) => ({
      id,
      date: stored.date,
      title: stored.title,
      status: stored.completedOn ? ("completed" as const) : stored.skip ? ("skipped" as const) : ("in-progress" as const),
      origin: stored.origin === "athlete" ? ("athlete" as const) : ("plan" as const),
      skipReason: stored.completedOn ? null : (stored.skip?.reason ?? null),
      skipNote: stored.completedOn ? null : (stored.skip?.note ?? null),
      completedOn: stored.completedOn,
      results: loggedResults(stored.blocks ?? [], stored.logs ?? [], stored.rpe ?? null, stored.comment ?? null),
    }))
    .sort((left, right) => right.date.localeCompare(left.date))
}


/** The mock athlete's finished sessions with what the load is worked out from, for the load screens. */
export function listMockDoneSessions(athleteId: string): Array<{ id: string; date: string; title: string; effort: number | null; minutes: number | null }> {
  if (athleteId !== MOCK_ATHLETE_ID || typeof window === "undefined") return []
  return Object.entries(loadStore(buildCalendar()))
    .filter(([, stored]) => stored && stored.completedOn)
    .map(([id, stored]) => ({ id, date: stored.completedOn as string, title: stored.title, effort: stored.rpe ?? null, minutes: stored.durationMinutes ?? null }))
}

/** The mock athlete's planned sessions (minutes and intended effort) between two days. */
export function listMockPlannedSessions(athleteId: string, from: string, to: string): Array<{ date: string; minutes: number | null; effort: number | null }> {
  if (athleteId !== MOCK_ATHLETE_ID || typeof window === "undefined") return []
  return [...buildCalendar().byDate.values()]
    .filter((blueprint) => blueprint.date >= from && blueprint.date <= to)
    .map((blueprint) => ({ date: blueprint.date, minutes: blueprint.durationMinutes, effort: blueprint.plannedEffort ?? null }))
}
