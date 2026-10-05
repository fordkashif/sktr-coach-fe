export type SessionStatus = "scheduled" | "in-progress" | "completed"
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
}

export type LoggableRow = SessionBlockRow & {
  kind: LogKind
  targetSets: number
  targetReps: string | null
  targetLoad: string | null
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
  athleteComment: string | null
  blocks: LoggableBlock[]
  logs: SessionRowLog[]
}

export type AthleteWeekDay = {
  date: string
  /** "session" has work planned, "rest" is inside a plan with nothing planned, "none" has no plan at all. */
  kind: "session" | "rest" | "none"
  done: boolean
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
  }>
}
