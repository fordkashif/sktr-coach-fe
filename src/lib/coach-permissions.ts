/**
 * What a coach may do on one team, worked out from their role on the team and the team's two
 * assistant switches. Pure logic: the screens use it to hide what is not allowed, and the database
 * enforces the same rules (migration 20261015090000, see the role matrix in the RLS document).
 *
 * Lead coach and coach have the same rights. An assistant coach can see the roster, training,
 * results and attendance, take attendance, log a session for an athlete and enter test results.
 */

export type TeamCoachRole = "lead" | "coach" | "assistant"

export type TeamAssistantSettings = {
  /** Assistants of this team may exchange direct messages with its athletes. */
  assistantsCanMessage: boolean
  /** Assistants of this team may see wellness detail, pain and injury reports, medical notes and private coach notes. */
  assistantsSeeHealth: boolean
}

export const DEFAULT_ASSISTANT_SETTINGS: TeamAssistantSettings = { assistantsCanMessage: false, assistantsSeeHealth: false }

export type CoachTeamPermissions = {
  role: TeamCoachRole
  isAssistant: boolean
  /** Roster, training, results and attendance. Every role. */
  canView: true
  canTakeAttendance: true
  canLogForAthlete: true
  canEnterTestResults: true
  /** Create, edit, publish or archive plans, test weeks, templates and library exercises. */
  canEditPlans: boolean
  /** Invite, add, move or remove athletes. */
  canManageRoster: boolean
  canManageSquads: boolean
  /** Add or change results, goals, lift maxes, competitions and availability. */
  canEditAthleteRecords: boolean
  /** Wellness detail, pain and injury reports, medical notes, private coach notes. */
  canSeeHealth: boolean
  canMessageAthletes: boolean
  canPostAnnouncements: boolean
  canExportReports: boolean
  /** The two assistant switches: the lead coach (and club admins, who do not come through here). */
  canChangeAssistantSettings: boolean
}

export function isTeamCoachRole(value: unknown): value is TeamCoachRole {
  return value === "lead" || value === "coach" || value === "assistant"
}

/** A stored role, or the role older data implies: the lead flag, otherwise coach. Never assistant by accident. */
export function normaliseTeamCoachRole(role: unknown, isPrimary?: boolean | null): TeamCoachRole {
  if (isTeamCoachRole(role)) return role
  return isPrimary ? "lead" : "coach"
}

export function teamCoachRoleLabel(role: TeamCoachRole): string {
  if (role === "lead") return "Lead coach"
  if (role === "assistant") return "Assistant coach"
  return "Coach"
}

export function coachTeamPermissions(role: TeamCoachRole, settings: TeamAssistantSettings = DEFAULT_ASSISTANT_SETTINGS): CoachTeamPermissions {
  const full = role !== "assistant"
  return {
    role,
    isAssistant: !full,
    canView: true,
    canTakeAttendance: true,
    canLogForAthlete: true,
    canEnterTestResults: true,
    canEditPlans: full,
    canManageRoster: full,
    canManageSquads: full,
    canEditAthleteRecords: full,
    canSeeHealth: full || settings.assistantsSeeHealth,
    canMessageAthletes: full || settings.assistantsCanMessage,
    canPostAnnouncements: full,
    canExportReports: full,
    canChangeAssistantSettings: role === "lead",
  }
}

/** Club admins, and anyone who is not limited by a team role, get everything. */
export const FULL_TEAM_PERMISSIONS: CoachTeamPermissions = coachTeamPermissions("coach")

/**
 * May this person write club-wide coaching content (library exercises, templates)? Yes unless every
 * team they are on has them as an assistant. A coach with no team yet keeps the right, as before.
 */
export function canAuthorClubContent(roles: TeamCoachRole[]): boolean {
  return roles.length === 0 || roles.some((role) => role !== "assistant")
}

/* ---------- Handover --------------------------------------------------------------------------------- */

export type HandoverCoach = { userId: string; name: string; role: TeamCoachRole; active: boolean }

export type HandoverTeam = {
  id: string
  name: string
  /** Everyone on the team, the leaving coach included. */
  coaches: HandoverCoach[]
}

/** What happens to one team: a new lead by user id, "stay" (its remaining coaches carry on) or "keep" (not handed over). */
export type HandoverChoice = string | "stay" | "keep"
export const HANDOVER_STAY = "stay"
export const HANDOVER_KEEP = "keep"

export type HandoverThen = "none" | "deactivate" | "remove"

/** The teams a coach is on, ready for the handover step. */
export function teamsCoachedBy(userId: string, teams: HandoverTeam[]): HandoverTeam[] {
  return teams.filter((team) => team.coaches.some((coach) => coach.userId === userId))
}

/** Can this team simply stay with its remaining coaches? Only when an active lead or coach is left. */
export function canStayWithRemainingCoaches(team: HandoverTeam, leavingUserId: string): boolean {
  return team.coaches.some((coach) => coach.userId !== leavingUserId && coach.active && coach.role !== "assistant")
}

/** The names of the coaches who carry on when a team stays as it is. */
export function remainingCoachNames(team: HandoverTeam, leavingUserId: string): string[] {
  return team.coaches.filter((coach) => coach.userId !== leavingUserId && coach.active && coach.role !== "assistant").map((coach) => coach.name)
}

/**
 * The first suggestion for a team: the lead it already has if that is someone else, otherwise
 * "stay" when another coach is left, otherwise nothing (the admin has to pick).
 */
export function defaultHandoverChoice(team: HandoverTeam, leavingUserId: string): HandoverChoice | "" {
  const leaving = team.coaches.find((coach) => coach.userId === leavingUserId)
  if (leaving && leaving.role !== "lead" && canStayWithRemainingCoaches(team, leavingUserId)) return HANDOVER_STAY
  const otherLead = team.coaches.find((coach) => coach.userId !== leavingUserId && coach.active && coach.role === "lead")
  if (otherLead) return HANDOVER_STAY
  return ""
}

export type HandoverProblem = { teamId: string; message: string }

/**
 * Checks the choices before anything is sent. When the coach is leaving the club (deactivate or
 * remove) every team needs an answer and "keep" is not one.
 */
export function validateHandover(params: {
  leavingUserId: string
  teams: HandoverTeam[]
  choices: Record<string, HandoverChoice | "">
  then: HandoverThen
  /** Active coaches and club admins of the club who may take a team over. */
  candidateIds: string[]
}): HandoverProblem[] {
  const problems: HandoverProblem[] = []
  for (const team of params.teams) {
    const choice = params.choices[team.id] ?? ""
    if (choice === "") {
      problems.push({ teamId: team.id, message: `Choose what happens to ${team.name}.` })
    } else if (choice === HANDOVER_KEEP) {
      if (params.then !== "none") problems.push({ teamId: team.id, message: `${team.name} needs a new lead or has to stay with its other coaches.` })
    } else if (choice === HANDOVER_STAY) {
      if (!canStayWithRemainingCoaches(team, params.leavingUserId)) problems.push({ teamId: team.id, message: `${team.name} would have no coach left. Pick who takes over as lead.` })
    } else if (choice === params.leavingUserId || !params.candidateIds.includes(choice)) {
      problems.push({ teamId: team.id, message: `Pick another active coach of the club to take over ${team.name}.` })
    }
  }
  if (params.then === "none" && params.teams.length > 0 && params.teams.every((team) => params.choices[team.id] === HANDOVER_KEEP)) {
    problems.push({ teamId: params.teams[0].id, message: "Choose at least one team to hand over." })
  }
  return problems
}

/** The list the database function takes. Teams left as "keep" are not part of the handover. */
export function toHandoverAssignments(teams: HandoverTeam[], choices: Record<string, HandoverChoice | "">): Array<{ team_id: string; new_lead_user_id: string | null }> {
  return teams.flatMap((team) => {
    const choice = choices[team.id]
    if (!choice || choice === HANDOVER_KEEP) return []
    return [{ team_id: team.id, new_lead_user_id: choice === HANDOVER_STAY ? null : choice }]
  })
}

/**
 * The same handover applied to a plain list of teams (the demo store, and the tests). The leaving
 * coach comes off every team handed over. A new lead replaces the old one, who stays on as coach.
 */
export function applyHandover(teams: HandoverTeam[], leavingUserId: string, choices: Record<string, HandoverChoice | "">, nameOf: (userId: string) => string): HandoverTeam[] {
  return teams.map((team) => {
    const choice = choices[team.id]
    if (!choice || choice === HANDOVER_KEEP || !team.coaches.some((coach) => coach.userId === leavingUserId)) return team
    let coaches = team.coaches.filter((coach) => coach.userId !== leavingUserId)
    if (choice !== HANDOVER_STAY) {
      coaches = coaches.map((coach) => (coach.role === "lead" && coach.userId !== choice ? { ...coach, role: "coach" as const } : coach))
      coaches = coaches.some((coach) => coach.userId === choice)
        ? coaches.map((coach) => (coach.userId === choice ? { ...coach, role: "lead" as const } : coach))
        : [{ userId: choice, name: nameOf(choice), role: "lead" as const, active: true }, ...coaches]
    }
    return { ...team, coaches }
  })
}

/** One line per team for the confirmation and the audit entry: "Sprint Group to Coach Smith (lead)". */
export function describeHandover(teams: HandoverTeam[], choices: Record<string, HandoverChoice | "">, nameOf: (userId: string) => string): string[] {
  return teams.flatMap((team) => {
    const choice = choices[team.id]
    if (!choice || choice === HANDOVER_KEEP) return []
    return [choice === HANDOVER_STAY ? `${team.name} stays with its other coaches` : `${team.name} to ${nameOf(choice)} (lead)`]
  })
}

/** "Coach Rivera" stays "Coach Rivera"; "Dana Whyte" becomes "Coach Dana Whyte". Matches the database. */
export function coachDisplayLabel(name: string | null | undefined): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim()
  if (!clean) return "Your coach"
  return /^coach\b/i.test(clean) ? clean : `Coach ${clean}`
}

/** The system line written into a closed conversation. */
export function coachLeftTeamLine(name: string | null | undefined): string {
  return `${coachDisplayLabel(name)} no longer coaches this team`
}
