export type SessionStatus = "scheduled" | "in-progress" | "completed" | "skipped"
/** "plan": set by the coach. "athlete": logged by the athlete without being planned (never counts towards adherence). */
export type SessionOrigin = "plan" | "athlete"
export type SkipReason = "sick" | "injured" | "travelling" | "competing" | "school_work" | "other"

export const SKIP_REASONS: Array<{ value: SkipReason; label: string }> = [
  { value: "sick", label: "Sick" },
  { value: "injured", label: "Injured" },
  { value: "travelling", label: "Travelling" },
  { value: "competing", label: "Competing" },
  { value: "school_work", label: "School or work" },
  { value: "other", label: "Something else" },
]

export function skipReasonLabel(reason: SkipReason | null | undefined) {
  return SKIP_REASONS.find((entry) => entry.value === reason)?.label ?? "No reason given"
}

/** "Skipped: sick", the one way a skipped session is described to athlete and coach. */
export function skippedLabel(reason: SkipReason | null | undefined) {
  return reason ? `Skipped: ${skipReasonLabel(reason).toLowerCase()}` : "Skipped"
}
export type SessionBlockType = "Strength" | "Run" | "Sprint" | "Jumps" | "Throws"

export type SessionSummary = {
  id: string
  athleteId: string
  title: string
  status: SessionStatus
  scheduledFor: string
  estimatedDurationMinutes: number | null
  coachNote: string | null
  completedAt: string | null
}

export type SessionBlockRow = {
  id: string
  sessionBlockId: string
  sortOrder: number
  label: string
  target: string
  helper: string | null
}

export type SessionBlock = {
  id: string
  sessionId: string
  sortOrder: number
  blockType: SessionBlockType
  name: string
  focus: string | null
  coachNote: string | null
  previousResult: string | null
  restLabel: string | null
  rows: SessionBlockRow[]
}

export type SessionCompletion = {
  id: string
  sessionId: string
  athleteId: string
  completionDate: string
  completedAt: string
}

/** Which inputs a row gets on the athlete log screen. */
export type LogKind = "strength" | "time" | "mark" | "check"

/** One logged set (or rep, run, attempt) of one exercise row. */
export type SessionRowLog = {
  rowId: string
  /** 1-based. */
  setIndex: number
  completed: boolean
  reps: number | null
  loadKg: number | null
  timeSeconds: number | null
  distanceM: number | null
  mark: number | null
  /** How hard this one set was, 1 to 10. Optional so entries saved before it existed still read. */
  rpe?: number | null
  /** The athlete's note for the exercise. Kept on the first set of the row (see rowNote in log-assist.ts). */
  note?: string | null
}

export type LoggableRow = SessionBlockRow & {
  kind: LogKind
  targetSets: number
  targetReps: string | null
  targetLoad: string | null
  /** A link to a video or reference for the exercise, from the coach's library. */
  referenceUrl?: string | null
  /** Set when the load is a percentage of a best lift, so it can be worked out again in the reader's unit (src/lib/units.ts). */
  percent?: number | null
  /** The lift the percentage refers to. */
  liftName?: string | null
}

export type LoggableBlock = Omit<SessionBlock, "rows"> & { rows: LoggableRow[] }

export type AthleteSession = {
  id: string
  title: string
  status: SessionStatus
  /** ISO day, yyyy-mm-dd. */
  scheduledFor: string
  estimatedDurationMinutes: number | null
  coachNote: string | null
  location: string | null
  completedOn: string | null
  overallRpe: number | null
  /** How long the session took, in minutes, as said when finishing. Missing or null when not given. */
  durationMinutes?: number | null
  athleteComment: string | null
  origin: SessionOrigin
  /** Set while status is "skipped". */
  skipReason: SkipReason | null
  skipNote: string | null
  blocks: LoggableBlock[]
  logs: SessionRowLog[]
}

/** A session as a line in a list: the week, the history, "also on this day". */
export type AthleteSessionRef = {
  id: string
  /** ISO day, yyyy-mm-dd. */
  date: string
  title: string
  origin: SessionOrigin
  status: SessionStatus
  skipReason: SkipReason | null
  completedOn: string | null
  rpe: number | null
}

/** What the athlete did the last time they logged an exercise with the same name. */
export type LastTimeSet = Pick<SessionRowLog, "setIndex" | "reps" | "loadKg" | "timeSeconds" | "distanceM" | "mark"> & { rpe: number | null }

export type LastTimeResult = {
  date: string
  /** All sets in a few words, for example "3 x 5 at 120kg". */
  summary: string
  kind: LogKind
  /** The sets as they were logged, in order. Used for the full list and for "Same as last time". */
  sets: LastTimeSet[]
  /** The effort (1 to 10) given to that whole session, when the athlete rated it. */
  sessionEffort: number | null
  /** The note the athlete left on the exercise that day. */
  note: string | null
}

export type ExtraSessionInput = { title: string; blockType: SessionBlockType; date: string }
export type ExtraExerciseInput = { label: string; kind: LogKind; sets: number }

export type AthleteWeekDay = {
  date: string
  /** "session" has work planned, "rest" is inside a plan with nothing planned, "none" has no plan at all. */
  kind: "session" | "rest" | "none"
  done: boolean
  /** The planned session of this day was skipped with a reason. */
  skipped: boolean
  /** The day sits inside a period the athlete is unavailable (injured, sick, away). */
  excused: boolean
}

export type AthleteSessionDay = {
  date: string
  session: AthleteSession | null
  /** True when the athlete has a plan covering this day (so an empty day is a rest day). */
  inPlan: boolean
  /** The next planned session after this day, if any. */
  next: { date: string; title: string } | null
  /** Monday to Sunday of the week holding `date`. */
  week: AthleteWeekDay[]
  /** Other sessions on this day (one the athlete added, or the planned one while an added one is open). */
  others: AthleteSessionRef[]
  /** The athlete is marked unavailable on this day: a planned session here does not count as missed. */
  excused: boolean
}

/** What a coach sees of a logged session. */
export type LoggedSessionResults = {
  rpe: number | null
  comment: string | null
  exercises: Array<{
    id: string
    blockName: string
    label: string
    target: string
    /** One formatted entry per logged set, for example "5 x 100 kg" or "4.12 s". */
    sets: string[]
    /** The effort given to each set in order, for example "7, 8, none". Empty or missing when no set was rated. */
    efforts?: string
    /** The athlete's note on this exercise. */
    note?: string | null
  }>
}
