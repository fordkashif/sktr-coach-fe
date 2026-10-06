import type { GuardianHealthRule } from "@/lib/guardian/health-visibility"

/** One athlete a parent or guardian follows. */
export type GuardianChild = {
  linkId: string
  athleteId: string
  name: string
  firstName: string
  teamId: string | null
  teamName: string | null
  primaryEvent: string | null
  relationship: string
  healthRule: GuardianHealthRule
  clubName: string | null
}

export type GuardianCoach = {
  name: string
  role: "lead" | "coach" | "assistant"
  /** Only when the coach chose to show their email to athletes. */
  email: string | null
}

export type GuardianDayState = "done" | "skipped" | "missed" | "today" | "planned" | "rest"

export type GuardianPlanDay = {
  /** YYYY-MM-DD */
  date: string
  title: string | null
  focus: string | null
  /** A few lines of what is planned ("4 x 30 m starts"). */
  blocks: string[]
  state: GuardianDayState
  /** Why a session was skipped. Health ("sick", "injured"), so only present when health is visible. */
  skipReason: string | null
}

export type GuardianWeek = {
  from: string
  to: string
  planName: string | null
  days: GuardianPlanDay[]
  done: number
  skipped: number
  planned: number
}

export type GuardianCompetition = {
  id: string
  name: string
  startDate: string
  endDate: string
  place: string | null
  /** The events this athlete is entered in. Empty when not entered (a team or club meet). */
  events: string[]
}

export type GuardianResult = {
  id: string
  eventLabel: string
  /** With its unit: "11.28 s". */
  mark: string
  date: string
  /** "Competition", "Training", "Test week". */
  source: string
  where: string | null
  place: number | null
  wind: string | null
}

export type GuardianRecord = { eventLabel: string; mark: string; date: string }

export type GuardianGoal = {
  id: string
  eventLabel: string
  target: string
  targetDate: string | null
  achievedOn: string | null
}

export type GuardianTestWeek = {
  id: string
  name: string
  startDate: string
  endDate: string
  status: "published" | "closed"
  tests: Array<{ name: string; value: string | null }>
}

export type GuardianResults = {
  upcoming: GuardianCompetition[]
  results: GuardianResult[]
  records: GuardianRecord[]
  goals: GuardianGoal[]
  testWeeks: GuardianTestWeek[]
}

export type GuardianAttendanceRow = {
  date: string
  status: "present" | "late" | "absent" | "excused"
  /** Free text from the coach, so health rules apply to it. */
  reason: string | null
}

export type GuardianAnnouncement = {
  id: string
  body: string
  /** "Sprint Group" or "Whole club". */
  from: string
  createdAt: string
}

export type GuardianCalendarItem = {
  id: string
  kind: "event" | "competition" | "test-week"
  title: string
  startsOn: string
  endsOn: string
  startTime: string | null
  place: string | null
}

export type GuardianHealth = {
  visible: boolean
  rule: GuardianHealthRule
  checkIns: Array<{ date: string; readiness: "green" | "yellow" | "red"; sleepHours: number | null; note: string | null }>
  painReports: Array<{ id: string; areas: string[]; severity: number; startedOn: string; impact: "none" | "modified" | "cannot_train"; open: boolean; note: string | null }>
  availability: Array<{ id: string; kind: "injured" | "sick" | "away"; startsOn: string; endsOn: string | null; note: string | null; current: boolean }>
  medicalNotes: string | null
}

export type GuardianContact = { name: string | null; phone: string | null; email: string | null }

/* ---------- Staff and athlete side ---------------------------------------------------------------- */

export type GuardianLinkRow = { id: string; name: string | null; email: string | null; relationship: string; since: string }

export type GuardianInviteRow = {
  id: string
  name: string | null
  email: string
  relationship: string
  expiresAt: string | null
  expired: boolean
  lastEmailSentAt: string | null
}

export type AthleteGuardians = {
  healthRule: GuardianHealthRule
  /** The guardian contact on the athlete's private details, to prefill the invite. */
  storedGuardian: { name: string | null; email: string | null }
  links: GuardianLinkRow[]
  invites: GuardianInviteRow[]
}

export type ClubGuardianRow = {
  kind: "link" | "invite"
  id: string
  athleteId: string
  athleteName: string
  teamName: string | null
  guardianName: string | null
  email: string | null
  relationship: string
  since: string
  expired: boolean
}

export type MyGuardianSharing = {
  healthRule: GuardianHealthRule
  shareHealth: boolean
  guardians: Array<{ name: string; relationship: string }>
}

export type GuardianInvitePreview = {
  inviteId: string
  email: string
  status: "pending" | "accepted" | "revoked"
  expired: boolean
  clubName: string
  athleteFirstName: string
  inviteeName: string | null
  relationship: string
  hasExistingAccount: boolean
}
