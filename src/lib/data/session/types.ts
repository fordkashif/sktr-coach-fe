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
