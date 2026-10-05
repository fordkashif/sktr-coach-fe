import type { EventGroup } from "@/lib/mock-data"
import type { PublishPlanStructure, TrainingPlanDetail } from "@/lib/data/training-plan/types"

/**
 * The coach plan builder model. One plain draft object that both the mock and the
 * Supabase storage adapters read and write. Everything here is pure so it can be tested
 * without a browser or a database.
 */

export type SessionType = "Track" | "Gym" | "Recovery" | "Technical" | "Mixed"
export type PlanStatus = "draft" | "published" | "archived"
export type AssignTarget = "team" | "subgroup" | "selected"

/** A change to one exercise row for one athlete ("except David: 70%"). Empty fields keep the row's own value. */
export type ExerciseOverrideDraft = {
  id: string
  athleteId: string
  sets: string
  reps: string
  /** A weight ("100kg") or a percentage ("70%"). */
  load: string
  /** A swap or a word for this athlete ("Goblet squat instead"). */
  note: string
}

export type ExerciseDraft = {
  id: string
  name: string
  sets: string
  reps: string
  /** A weight ("100kg"), a percentage of the athlete's best lift ("80%") or free text. */
  load: string
  /** The club library exercise this row was picked from. Missing on a row typed by hand. */
  libraryId?: string | null
  /** Coaching cue and reference link, copied from the library when the row was picked. */
  cue?: string
  link?: string
  /** For a percentage load: the lift it is a percentage of. Empty means this exercise itself. */
  percentOf?: string
  overrides?: ExerciseOverrideDraft[]
}

export type BlockDraft = {
  id: string
  title: string
  notes: string
  exercises: ExerciseDraft[]
}

export type SessionDraft = {
  id: string
  /** 1-based week number. */
  week: number
  /** 0 to 6, days after the first day of that week. */
  dayIndex: number
  title: string
  sessionType: SessionType
  location: string
  durationMinutes: string
  notes: string
  blocks: BlockDraft[]
}

export type PlanAssignDraft = {
  target: AssignTarget
  subgroup: EventGroup | null
  athleteIds: string[]
  visibilityStart: "immediate" | "scheduled"
  visibilityDate: string | null
}

export type PlanDraft = {
  /** Null until the plan has been saved once. */
  id: string | null
  status: PlanStatus
  name: string
  teamId: string
  startDate: string
  weeks: number
  notes: string
  /** Optional focus line per week, keyed by week number. */
  weekFocus: Record<string, string>
  /** Only days with a session are stored. Any other day is a rest day. */
  sessions: SessionDraft[]
  assign: PlanAssignDraft
}

/** What is persisted in training_plans.builder_state. */
export type PlanBuilderState = {
  version: 1
  weekFocus: Record<string, string>
  sessions: SessionDraft[]
  assign: PlanAssignDraft
}

export const SESSION_TYPES: SessionType[] = ["Track", "Gym", "Recovery", "Technical", "Mixed"]
export const EVENT_GROUPS: Array<{ value: EventGroup; label: string }> = [
  { value: "Sprint", label: "Sprints" },
  { value: "Mid", label: "Middle distance" },
  { value: "Distance", label: "Distance" },
  { value: "Jumps", label: "Jumps" },
  { value: "Throws", label: "Throws" },
]
export const MAX_WEEKS = 24

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export const QUICK_BLOCKS: Record<EventGroup, string[]> = {
  Sprint: ["Warm up", "Sprint", "Speed endurance", "Strength", "Power", "Mobility"],
  Mid: ["Warm up", "Tempo", "Intervals", "Strength", "Mobility", "Physio"],
  Distance: ["Warm up", "Tempo", "Intervals", "Hills", "Strength", "Mobility"],
  Jumps: ["Warm up", "Approach work", "Takeoff", "Plyos", "Strength", "Mobility"],
  Throws: ["Warm up", "Technical drills", "Full throws", "Strength", "Power", "Mobility"],
}

const TEMPLATE_LIBRARY: Record<EventGroup, Array<{ title: string; type: SessionType; blocks: string[] }>> = {
  Sprint: [
    { title: "Acceleration and weights", type: "Track", blocks: ["Warm up", "Sprint", "Strength"] },
    { title: "Tempo and mobility", type: "Recovery", blocks: ["Tempo", "Mobility"] },
    { title: "Speed endurance", type: "Track", blocks: ["Warm up", "Speed endurance", "Power"] },
  ],
  Mid: [
    { title: "Threshold intervals", type: "Track", blocks: ["Warm up", "Intervals", "Tempo"] },
    { title: "Technique and gym", type: "Mixed", blocks: ["Technique", "Strength"] },
    { title: "Race pace session", type: "Track", blocks: ["Warm up", "Speed endurance", "Mobility"] },
  ],
  Distance: [
    { title: "Long run and core", type: "Track", blocks: ["Tempo", "Accessories"] },
    { title: "VO2 intervals", type: "Track", blocks: ["Warm up", "Intervals", "Mobility"] },
    { title: "Hills and mobility", type: "Track", blocks: ["Warm up", "Hills", "Mobility"] },
  ],
  Jumps: [
    { title: "Approach and plyos", type: "Technical", blocks: ["Warm up", "Approach work", "Plyos"] },
    { title: "Takeoff mechanics", type: "Technical", blocks: ["Warm up", "Takeoff", "Technique"] },
    { title: "Power and strength", type: "Gym", blocks: ["Power", "Strength"] },
  ],
  Throws: [
    { title: "Technical drills and med ball", type: "Technical", blocks: ["Warm up", "Technical drills", "Med ball"] },
    { title: "Full throws and strength", type: "Mixed", blocks: ["Warm up", "Full throws", "Strength"] },
    { title: "Special strength", type: "Gym", blocks: ["Special strength", "Power"] },
  ],
}

const TRAINING_DAY_PATTERNS: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
}

export function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function todayIso() {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, "0")
  const day = `${now.getDate()}`.padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

function parseIso(dateIso: string) {
  const parsed = new Date(`${dateIso}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function addDaysIso(dateIso: string, days: number) {
  const date = parseIso(dateIso)
  if (!date) return dateIso
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Calendar date of a day slot in the plan. */
export function slotDate(plan: Pick<PlanDraft, "startDate">, week: number, dayIndex: number) {
  return addDaysIso(plan.startDate, (week - 1) * 7 + dayIndex)
}

export function weekdayLabel(dateIso: string) {
  const date = parseIso(dateIso)
  return date ? WEEKDAYS[date.getUTCDay()] : ""
}

export function formatDayMonth(dateIso: string) {
  const date = parseIso(dateIso)
  if (!date) return dateIso
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
}

export function formatDateRange(startIso: string, endIso: string) {
  return `${formatDayMonth(startIso)} to ${formatDayMonth(endIso)}`
}

export function planEndDate(plan: Pick<PlanDraft, "startDate" | "weeks">) {
  return addDaysIso(plan.startDate, Math.max(plan.weeks, 1) * 7 - 1)
}

export function defaultAssign(): PlanAssignDraft {
  return { target: "team", subgroup: null, athleteIds: [], visibilityStart: "immediate", visibilityDate: null }
}

export function createEmptyPlan(teamId: string): PlanDraft {
  return {
    id: null,
    status: "draft",
    name: "",
    teamId,
    startDate: todayIso(),
    weeks: 4,
    notes: "",
    weekFocus: {},
    sessions: [],
    assign: defaultAssign(),
  }
}

export function newExercise(): ExerciseDraft {
  return { id: makeId("ex"), name: "", sets: "", reps: "", load: "" }
}

export function newBlock(title = ""): BlockDraft {
  return { id: makeId("block"), title, notes: "", exercises: [] }
}

export function newSession(week: number, dayIndex: number, partial?: Partial<SessionDraft>): SessionDraft {
  return {
    id: makeId("session"),
    week,
    dayIndex,
    title: "",
    sessionType: "Track",
    location: "",
    durationMinutes: "",
    notes: "",
    blocks: [],
    ...partial,
  }
}

/** Deep copy of a session into another slot, with fresh ids. */
export function cloneSessionTo(session: SessionDraft, week: number, dayIndex: number): SessionDraft {
  return {
    ...session,
    id: makeId("session"),
    week,
    dayIndex,
    blocks: session.blocks.map((block) => ({
      ...block,
      id: makeId("block"),
      exercises: block.exercises.map((exercise) => ({ ...exercise, id: makeId("ex") })),
    })),
  }
}

export function getSession(plan: PlanDraft, week: number, dayIndex: number) {
  return plan.sessions.find((session) => session.week === week && session.dayIndex === dayIndex) ?? null
}

export function weekSessions(plan: PlanDraft, week: number) {
  return plan.sessions.filter((session) => session.week === week).sort((left, right) => left.dayIndex - right.dayIndex)
}

function withoutSlots(plan: PlanDraft, slots: Array<{ week: number; dayIndex: number }>) {
  const keys = new Set(slots.map((slot) => `${slot.week}:${slot.dayIndex}`))
  return plan.sessions.filter((session) => !keys.has(`${session.week}:${session.dayIndex}`))
}

export function putSession(plan: PlanDraft, session: SessionDraft): PlanDraft {
  return { ...plan, sessions: [...withoutSlots(plan, [session]), session] }
}

export function removeSession(plan: PlanDraft, week: number, dayIndex: number): PlanDraft {
  return { ...plan, sessions: withoutSlots(plan, [{ week, dayIndex }]) }
}

/** The slot the day after the given one, or null on the last day of the plan. */
export function nextSlot(plan: PlanDraft, week: number, dayIndex: number) {
  if (dayIndex < 6) return { week, dayIndex: dayIndex + 1 }
  if (week < plan.weeks) return { week: week + 1, dayIndex: 0 }
  return null
}

/** Copies a day's session onto the next day, replacing whatever was there. */
export function copySessionToNextDay(plan: PlanDraft, week: number, dayIndex: number): PlanDraft {
  const source = getSession(plan, week, dayIndex)
  const target = nextSlot(plan, week, dayIndex)
  if (!source || !target) return plan
  return putSession(plan, cloneSessionTo(source, target.week, target.dayIndex))
}

/** Replaces every session in a week with a copy of the week before it. */
export function duplicatePreviousWeek(plan: PlanDraft, week: number): PlanDraft {
  if (week <= 1 || week > plan.weeks) return plan
  const copies = weekSessions(plan, week - 1).map((session) => cloneSessionTo(session, week, session.dayIndex))
  const previousFocus = plan.weekFocus[String(week - 1)]
  return {
    ...plan,
    sessions: [...plan.sessions.filter((session) => session.week !== week), ...copies],
    weekFocus:
      previousFocus && !plan.weekFocus[String(week)] ? { ...plan.weekFocus, [String(week)]: previousFocus } : plan.weekFocus,
  }
}

/**
 * A/B pattern: takes the session on day A and the session on day B and alternates them
 * (A, B, A, B) across the chosen days of the week. If day B is null or empty, B starts as
 * a copy of A's set-up with no blocks so the coach can fill it in.
 */
export function applyABPattern(
  plan: PlanDraft,
  week: number,
  aDayIndex: number,
  bDayIndex: number | null,
  targetDayIndexes: number[],
): PlanDraft {
  const sourceA = getSession(plan, week, aDayIndex)
  if (!sourceA) return plan
  const existingB = bDayIndex === null ? null : getSession(plan, week, bDayIndex)
  const sessionA: SessionDraft = { ...sourceA, title: sourceA.title.trim() || "Session A" }
  const sessionB: SessionDraft = existingB
    ? { ...existingB, title: existingB.title.trim() || "Session B" }
    : newSession(week, bDayIndex ?? aDayIndex, {
        title: "Session B",
        sessionType: sourceA.sessionType,
        location: sourceA.location,
        durationMinutes: sourceA.durationMinutes,
      })

  const targets = [...new Set(targetDayIndexes)].filter((index) => index >= 0 && index <= 6).sort((a, b) => a - b)
  if (targets.length === 0) return plan
  const filled = targets.map((dayIndex, position) => cloneSessionTo(position % 2 === 0 ? sessionA : sessionB, week, dayIndex))
  return {
    ...plan,
    sessions: [...withoutSlots(plan, targets.map((dayIndex) => ({ week, dayIndex }))), ...filled],
  }
}

/** Changes the plan length. Sessions past the new end are dropped. */
export function setPlanWeeks(plan: PlanDraft, weeks: number): PlanDraft {
  const next = Math.max(1, Math.min(MAX_WEEKS, Math.round(weeks) || 1))
  const weekFocus = Object.fromEntries(Object.entries(plan.weekFocus).filter(([week]) => Number(week) <= next))
  return { ...plan, weeks: next, weekFocus, sessions: plan.sessions.filter((session) => session.week <= next) }
}

export function sessionsBeyondWeek(plan: PlanDraft, weeks: number) {
  return plan.sessions.filter((session) => session.week > weeks).length
}

/** Skeleton generator: fills every week with a rotating set of sessions for the event group. */
export function createSkeletonSessions(weeks: number, eventGroup: EventGroup, daysPerWeek: number): SessionDraft[] {
  const templates = TEMPLATE_LIBRARY[eventGroup]
  const pattern = TRAINING_DAY_PATTERNS[Math.max(1, Math.min(7, daysPerWeek))] ?? TRAINING_DAY_PATTERNS[5]
  const sessions: SessionDraft[] = []
  for (let week = 1; week <= weeks; week += 1) {
    pattern.forEach((dayIndex, position) => {
      const template = templates[(position + week - 1) % templates.length]
      sessions.push(
        newSession(week, dayIndex, {
          title: template.title,
          sessionType: template.type,
          blocks: template.blocks.map((title) => newBlock(title)),
        }),
      )
    })
  }
  return sessions
}

/** A fresh, unsaved draft copy of any plan. */
export function duplicateAsDraft(plan: PlanDraft): PlanDraft {
  return {
    ...plan,
    id: null,
    status: "draft",
    name: plan.name ? `${plan.name} (copy)` : "",
    weekFocus: { ...plan.weekFocus },
    sessions: plan.sessions.map((session) => cloneSessionTo(session, session.week, session.dayIndex)),
    assign: { ...plan.assign, athleteIds: [...plan.assign.athleteIds] },
  }
}

export function summarizeExercise(exercise: ExerciseDraft) {
  const volume = exercise.sets && exercise.reps ? `${exercise.sets} x ${exercise.reps}` : exercise.reps || exercise.sets
  return [exercise.name.trim(), volume, exercise.load ? `@ ${exercise.load}` : ""].filter(Boolean).join(" ")
}

export function summarizeBlock(block: BlockDraft) {
  const title = block.title.trim() || "Block"
  const parts = [block.notes.trim(), ...block.exercises.map(summarizeExercise).filter(Boolean)].filter(Boolean)
  return parts.length > 0 ? `${title}: ${parts.join(" | ")}` : title
}

export function sessionDisplayTitle(session: SessionDraft, dateIso: string) {
  return session.title.trim() || `${weekdayLabel(dateIso)} session`
}

/** Returns a message when the plan cannot be saved at all, otherwise null. */
export function validateBasics(plan: PlanDraft): string | null {
  if (!plan.name.trim()) return "Give the plan a name."
  if (!parseIso(plan.startDate)) return "Pick a start date."
  if (!Number.isInteger(plan.weeks) || plan.weeks < 1) return "A plan needs at least one week."
  return null
}

/** Returns a message when the plan is not ready to publish, otherwise null. */
export function validateForPublish(plan: PlanDraft, assignedCount: number): string | null {
  const basics = validateBasics(plan)
  if (basics) return basics
  if (!plan.teamId) return "Choose a team for this plan."
  if (plan.sessions.length === 0) return "Add at least one session before publishing."
  if (plan.assign.target === "subgroup" && !plan.assign.subgroup) return "Choose an event group to assign."
  if (plan.assign.target === "selected" && plan.assign.athleteIds.length === 0) return "Pick at least one athlete."
  if (plan.assign.visibilityStart === "scheduled" && !plan.assign.visibilityDate) return "Pick the date athletes should first see the plan."
  if (assignedCount === 0) return "Nobody would receive this plan. Check who it is assigned to."
  return null
}

/** Athlete-facing structure written to the weeks, days and blocks tables on publish. */
export function toPublishStructure(plan: PlanDraft): PublishPlanStructure {
  return Array.from({ length: plan.weeks }, (_, index) => index + 1).map((weekNumber) => ({
    weekNumber,
    emphasis: plan.weekFocus[String(weekNumber)]?.trim() || null,
    status: weekNumber === 1 ? ("current" as const) : ("up-next" as const),
    days: weekSessions(plan, weekNumber).map((session) => {
      const date = slotDate(plan, weekNumber, session.dayIndex)
      const title = sessionDisplayTitle(session, date)
      const blockTitles = session.blocks.map((block) => block.title.trim()).filter(Boolean)
      const duration = Number.parseInt(session.durationMinutes, 10)
      const blockPreview = session.blocks.map(summarizeBlock)
      return {
        dayIndex: session.dayIndex,
        dayLabel: weekdayLabel(date),
        date,
        title,
        sessionType: session.sessionType,
        focus: blockTitles.length > 0 ? blockTitles.slice(0, 2).join(" + ") : title,
        status: session.blocks.length > 0 ? ("scheduled" as const) : ("up-next" as const),
        durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : null,
        location: session.location.trim() || null,
        coachNote: session.notes.trim() || null,
        isTrainingDay: true,
        blockPreview: blockPreview.length > 0 ? blockPreview : [title],
      }
    }),
  }))
}

export function toBuilderState(plan: PlanDraft): PlanBuilderState {
  return { version: 1, weekFocus: plan.weekFocus, sessions: plan.sessions, assign: plan.assign }
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Library link, cue, reference lift and per athlete changes of an exercise row. Only what is filled in is kept. */
function sanitizeExerciseExtras(exercise: Record<string, unknown>): Partial<ExerciseDraft> {
  const extras: Partial<ExerciseDraft> = {}
  if (typeof exercise.libraryId === "string" && exercise.libraryId) extras.libraryId = exercise.libraryId
  if (typeof exercise.cue === "string" && exercise.cue) extras.cue = exercise.cue.slice(0, 500)
  if (typeof exercise.link === "string" && /^https?:\/\/\S+$/i.test(exercise.link)) extras.link = exercise.link.slice(0, 500)
  if (typeof exercise.percentOf === "string" && exercise.percentOf) extras.percentOf = exercise.percentOf.slice(0, 80)
  if (Array.isArray(exercise.overrides)) {
    const seen = new Set<string>()
    const overrides = exercise.overrides.flatMap((value) => {
      const raw = asRecord(value)
      const athleteId = raw ? asString(raw.athleteId) : ""
      // One change per athlete. A row with no athlete yet is kept so the coach can finish it.
      if (!raw || (athleteId && seen.has(athleteId))) return []
      if (athleteId) seen.add(athleteId)
      return [
        {
          id: asString(raw.id) || makeId("ovr"),
          athleteId,
          sets: asString(raw.sets),
          reps: asString(raw.reps),
          load: asString(raw.load),
          note: asString(raw.note).slice(0, 200),
        },
      ]
    })
    if (overrides.length > 0) extras.overrides = overrides
  }
  return extras
}

function sanitizeSession(value: unknown, maxWeeks: number): SessionDraft | null {
  const raw = asRecord(value)
  if (!raw) return null
  const week = Number(raw.week)
  const dayIndex = Number(raw.dayIndex)
  if (!Number.isInteger(week) || week < 1 || week > maxWeeks) return null
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) return null
  const sessionType = SESSION_TYPES.includes(raw.sessionType as SessionType) ? (raw.sessionType as SessionType) : "Track"
  const blocks = Array.isArray(raw.blocks) ? raw.blocks : []
  return {
    id: asString(raw.id) || makeId("session"),
    week,
    dayIndex,
    title: asString(raw.title),
    sessionType,
    location: asString(raw.location),
    durationMinutes: asString(raw.durationMinutes),
    notes: asString(raw.notes),
    blocks: blocks.flatMap((blockValue) => {
      const block = asRecord(blockValue)
      if (!block) return []
      const exercises = Array.isArray(block.exercises) ? block.exercises : []
      return [
        {
          id: asString(block.id) || makeId("block"),
          title: asString(block.title),
          notes: asString(block.notes),
          exercises: exercises.flatMap((exerciseValue) => {
            const exercise = asRecord(exerciseValue)
            if (!exercise) return []
            return [
              {
                id: asString(exercise.id) || makeId("ex"),
                name: asString(exercise.name),
                sets: asString(exercise.sets),
                reps: asString(exercise.reps),
                load: asString(exercise.load),
                ...sanitizeExerciseExtras(exercise),
              },
            ]
          }),
        },
      ]
    }),
  }
}

function sanitizeAssign(value: unknown): PlanAssignDraft {
  const raw = asRecord(value)
  if (!raw) return defaultAssign()
  const target: AssignTarget = raw.target === "subgroup" || raw.target === "selected" ? raw.target : "team"
  const subgroup = EVENT_GROUPS.some((group) => group.value === raw.subgroup) ? (raw.subgroup as EventGroup) : null
  return {
    target,
    subgroup,
    athleteIds: Array.isArray(raw.athleteIds) ? raw.athleteIds.filter((id): id is string => typeof id === "string") : [],
    visibilityStart: raw.visibilityStart === "scheduled" ? "scheduled" : "immediate",
    visibilityDate: typeof raw.visibilityDate === "string" && raw.visibilityDate ? raw.visibilityDate : null,
  }
}

type PlanHeader = Pick<PlanDraft, "id" | "status" | "name" | "teamId" | "startDate" | "weeks" | "notes">

/** Rebuilds a draft from stored builder state. Unknown or damaged values are dropped, never thrown on. */
export function planFromBuilderState(header: PlanHeader, state: unknown): PlanDraft {
  const raw = asRecord(state) ?? {}
  const seen = new Set<string>()
  const sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).flatMap((value) => {
    const session = sanitizeSession(value, header.weeks)
    if (!session) return []
    const key = `${session.week}:${session.dayIndex}`
    if (seen.has(key)) return []
    seen.add(key)
    return [session]
  })
  const focus = asRecord(raw.weekFocus) ?? {}
  return {
    ...header,
    weekFocus: Object.fromEntries(
      Object.entries(focus).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0),
    ),
    sessions,
    assign: sanitizeAssign(raw.assign),
  }
}

/** Rebuilds a draft from the published structure, for plans saved before builder state existed. */
export function planFromPublishedDetail(header: PlanHeader, detail: TrainingPlanDetail | null): PlanDraft {
  const weekFocus: Record<string, string> = {}
  const sessions: SessionDraft[] = []
  for (const week of detail?.weeks ?? []) {
    if (week.weekNumber < 1 || week.weekNumber > header.weeks) continue
    if (week.emphasis) weekFocus[String(week.weekNumber)] = week.emphasis
    for (const day of week.days) {
      if (day.dayIndex < 0 || day.dayIndex > 6) continue
      sessions.push(
        newSession(week.weekNumber, day.dayIndex, {
          title: day.title,
          sessionType: day.sessionType,
          location: day.location ?? "",
          durationMinutes: day.durationMinutes ? String(day.durationMinutes) : "",
          notes: day.coachNote ?? "",
          blocks: day.blockPreview.map((preview) => {
            const split = preview.indexOf(": ")
            return split > 0
              ? { ...newBlock(preview.slice(0, split)), notes: preview.slice(split + 2) }
              : newBlock(preview)
          }),
        }),
      )
    }
  }
  return { ...header, weekFocus, sessions, assign: defaultAssign() }
}
