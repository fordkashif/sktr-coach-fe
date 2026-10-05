import { readStoredMockPlans } from "@/components/coach/training-plan/mock-adapter"
import { err, ok, type Result } from "@/lib/data/result"
import { formatSetLog, isLogEmpty, planBlueprints, type SessionBlueprint } from "@/lib/data/session/session-from-plan"
import type {
  AthleteSession,
  AthleteSessionDay,
  AthleteWeekDay,
  LoggableBlock,
  LoggedSessionResults,
  SessionRowLog,
} from "@/lib/data/session/types"
import {
  addDaysIso,
  newSession,
  planEndDate,
  todayIso,
  type ExerciseDraft,
  type PlanDraft,
  type SessionDraft,
} from "@/lib/data/training-plan/plan-builder-model"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Mock mode sessions. The signed-in mock athlete is Marcus Johnson (a1, Sprint Group).
 * Sessions come from plans a coach published in this browser, and from a rolling demo plan
 * for any day those plans do not cover, so there is always something to log today.
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

type DemoTemplate = Pick<SessionDraft, "title" | "sessionType" | "location" | "durationMinutes" | "notes" | "blocks">

const DEMO_TEMPLATES: Record<string, DemoTemplate> = {
  acceleration: {
    title: "Acceleration and weights",
    sessionType: "Mixed",
    location: "Track and weight room",
    durationMinutes: "75",
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
        notes: "",
        exercises: [exercise("Power clean", "4", "3", "95kg"), exercise("Back squat", "3", "5", "120kg")],
      },
    ],
  },
  tempo: {
    title: "Tempo and mobility",
    sessionType: "Recovery",
    location: "Track",
    durationMinutes: "50",
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
      return plan.assign.athleteIds.includes(MOCK_ATHLETE_ID)
    })
  } catch {
    return []
  }
}

type Calendar = {
  byDate: Map<string, SessionBlueprint>
  ranges: Array<{ start: string; end: string }>
}

function buildCalendar(): Calendar {
  const coachPlans = coachPlansForMockAthlete()
  const ranges = coachPlans.map((plan) => ({ start: plan.startDate, end: planEndDate(plan) }))
  const coveredByCoach = (date: string) => ranges.some((range) => date >= range.start && date <= range.end)
  const byDate = new Map<string, SessionBlueprint>()
  for (const plan of coachPlans) {
    for (const blueprint of planBlueprints(plan)) if (!byDate.has(blueprint.date)) byDate.set(blueprint.date, blueprint)
  }
  const demo = demoPlan()
  for (const blueprint of planBlueprints(demo)) {
    if (!coveredByCoach(blueprint.date) && !byDate.has(blueprint.date)) byDate.set(blueprint.date, blueprint)
  }
  return { byDate, ranges: [...ranges, { start: demo.startDate, end: planEndDate(demo) }] }
}

export function mockSessionId(date: string) {
  return `mock:${date}`
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
        kind: row.kind,
        targetSets: row.targetSets,
        targetReps: row.targetReps,
        targetLoad: row.targetLoad,
      })),
    }
  })
}

function toSession(blueprint: SessionBlueprint, stored: StoredSession | undefined): AthleteSession {
  const id = mockSessionId(blueprint.date)
  // Once the athlete has logged against a session its shape is kept, even if the plan changes later.
  const blocks = stored && stored.logs.length > 0 ? stored.blocks : blueprintBlocks(id, blueprint)
  return {
    id,
    title: blueprint.title,
    status: stored?.completedOn ? "completed" : stored && stored.logs.length > 0 ? "in-progress" : "scheduled",
    scheduledFor: blueprint.date,
    estimatedDurationMinutes: blueprint.durationMinutes,
    coachNote: blueprint.coachNote,
    location: blueprint.location,
    completedOn: stored?.completedOn ?? null,
    overallRpe: stored?.rpe ?? null,
    athleteComment: stored?.comment ?? null,
    blocks,
    logs: stored?.logs ?? [],
  }
}

export function weekStartIso(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`)
  const offset = (parsed.getUTCDay() + 6) % 7
  return addDaysIso(date, -offset)
}

export function loadMockSessionDay(date: string): Result<AthleteSessionDay> {
  const calendar = buildCalendar()
  const store = readStore()
  const blueprint = calendar.byDate.get(date)
  const inPlan = (day: string) => calendar.ranges.some((range) => day >= range.start && day <= range.end)
  const weekStart = weekStartIso(date)
  const week: AthleteWeekDay[] = Array.from({ length: 7 }, (_, index) => {
    const day = addDaysIso(weekStart, index)
    return {
      date: day,
      kind: calendar.byDate.has(day) ? "session" : inPlan(day) ? "rest" : "none",
      done: Boolean(store[mockSessionId(day)]?.completedOn),
    }
  })
  const nextDate = [...calendar.byDate.keys()].sort().find((day) => day > date)
  const nextBlueprint = nextDate ? calendar.byDate.get(nextDate) : undefined
  return ok({
    date,
    session: blueprint ? toSession(blueprint, store[mockSessionId(date)]) : null,
    inPlan: inPlan(date),
    next: nextBlueprint ? { date: nextBlueprint.date, title: nextBlueprint.title } : null,
    week,
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

export function saveMockRowLogs(sessionId: string, logs: SessionRowLog[]): Result<null> {
  if (offline()) return err("UNKNOWN", "You are offline.")
  try {
    const store = readStore()
    const stored = storedFor(store, sessionId)
    if (!stored) return err("NOT_FOUND", "That session no longer exists.")
    const merged = new Map(stored.logs.map((log) => [`${log.rowId}:${log.setIndex}`, log]))
    for (const log of logs) merged.set(`${log.rowId}:${log.setIndex}`, log)
    writeStore({ ...store, [sessionId]: { ...stored, logs: [...merged.values()] } })
    return ok(null)
  } catch {
    return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
  }
}

export function saveMockCompletion(params: {
  sessionId: string
  completionDate: string
  rpe: number | null
  comment: string | null
}): Result<null> {
  if (offline()) return err("UNKNOWN", "You are offline.")
  try {
    const store = readStore()
    const stored = storedFor(store, params.sessionId)
    if (!stored) return err("NOT_FOUND", "That session no longer exists.")
    writeStore({
      ...store,
      [params.sessionId]: {
        ...stored,
        completedOn: stored.completedOn ?? params.completionDate,
        rpe: params.rpe,
        comment: params.comment,
      },
    })
    return ok(null)
  } catch {
    return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
  }
}

export function loggedResults(
  blocks: LoggableBlock[],
  logs: SessionRowLog[],
  rpe: number | null,
  comment: string | null,
): LoggedSessionResults | null {
  const exercises = blocks.flatMap((block) =>
    block.rows.flatMap((row) => {
      const sets = logs
        .filter((log) => log.rowId === row.id && !isLogEmpty(log))
        .sort((left, right) => left.setIndex - right.setIndex)
        .map((log) => formatSetLog(row.kind, log))
        .filter(Boolean)
      return sets.length > 0 ? [{ id: row.id, blockName: block.name, label: row.label, target: row.target, sets }] : []
    }),
  )
  if (exercises.length === 0 && rpe === null && !comment) return null
  return { rpe, comment, exercises }
}

export type MockLoggedSession = {
  id: string
  date: string
  title: string
  status: "in-progress" | "completed"
  completedOn: string | null
  results: LoggedSessionResults | null
}

/** What the mock athlete has logged in this browser, newest first, for the coach athlete screen. */
export function listMockLoggedSessions(athleteId: string): MockLoggedSession[] {
  if (athleteId !== MOCK_ATHLETE_ID || typeof window === "undefined") return []
  return Object.entries(readStore())
    .filter(([, stored]) => stored && (stored.completedOn || (Array.isArray(stored.logs) && stored.logs.length > 0)))
    .map(([id, stored]) => ({
      id,
      date: stored.date,
      title: stored.title,
      status: stored.completedOn ? ("completed" as const) : ("in-progress" as const),
      completedOn: stored.completedOn,
      results: loggedResults(stored.blocks ?? [], stored.logs ?? [], stored.rpe ?? null, stored.comment ?? null),
    }))
    .sort((left, right) => right.date.localeCompare(left.date))
}
