import test from "node:test"
import assert from "node:assert/strict"
import {
  applyHandover,
  canAuthorClubContent,
  canStayWithRemainingCoaches,
  coachDisplayLabel,
  coachLeftTeamLine,
  coachTeamPermissions,
  defaultHandoverChoice,
  describeHandover,
  FULL_TEAM_PERMISSIONS,
  HANDOVER_KEEP,
  HANDOVER_STAY,
  normaliseTeamCoachRole,
  remainingCoachNames,
  teamCoachRoleLabel,
  teamsCoachedBy,
  toHandoverAssignments,
  validateHandover,
  type HandoverTeam,
} from "../src/lib/coach-permissions"

const coach = (userId: string, role: "lead" | "coach" | "assistant", active = true) => ({ userId, name: `Coach ${userId}`, role, active })

const sprint: HandoverTeam = { id: "t1", name: "Sprint Group", coaches: [coach("rivera", "lead"), coach("smith", "coach"), coach("asha", "assistant")] }
const jumps: HandoverTeam = { id: "t2", name: "Jumps Group", coaches: [coach("rivera", "lead"), coach("asha", "assistant")] }
const throws: HandoverTeam = { id: "t3", name: "Throws Group", coaches: [coach("smith", "lead"), coach("rivera", "coach")] }
const distance: HandoverTeam = { id: "t4", name: "Distance Group", coaches: [coach("lee", "lead")] }
const teams = [sprint, jumps, throws, distance]

test("lead coach and coach have every right, and the same rights apart from the assistant switches", () => {
  const lead = coachTeamPermissions("lead")
  const plain = coachTeamPermissions("coach")
  for (const key of ["canEditPlans", "canManageRoster", "canManageSquads", "canEditAthleteRecords", "canSeeHealth", "canMessageAthletes", "canPostAnnouncements", "canExportReports"] as const) {
    assert.equal(lead[key], true, `lead ${key}`)
    assert.equal(plain[key], true, `coach ${key}`)
  }
  assert.equal(lead.isAssistant, false)
  assert.equal(lead.canChangeAssistantSettings, true)
  assert.equal(plain.canChangeAssistantSettings, false)
  assert.deepEqual(FULL_TEAM_PERMISSIONS, plain)
})

test("the switches change nothing for a lead or a coach", () => {
  assert.deepEqual(coachTeamPermissions("coach", { assistantsCanMessage: false, assistantsSeeHealth: false }), coachTeamPermissions("coach", { assistantsCanMessage: true, assistantsSeeHealth: true }))
})

test("an assistant with both switches off: sees and records, nothing else", () => {
  const assistant = coachTeamPermissions("assistant")
  assert.equal(assistant.isAssistant, true)
  assert.equal(assistant.canView, true)
  assert.equal(assistant.canTakeAttendance, true)
  assert.equal(assistant.canLogForAthlete, true)
  assert.equal(assistant.canEnterTestResults, true)
  for (const key of ["canEditPlans", "canManageRoster", "canManageSquads", "canEditAthleteRecords", "canSeeHealth", "canMessageAthletes", "canPostAnnouncements", "canExportReports", "canChangeAssistantSettings"] as const) {
    assert.equal(assistant[key], false, `assistant ${key}`)
  }
})

test("each switch opens exactly its own thing for an assistant", () => {
  const health = coachTeamPermissions("assistant", { assistantsCanMessage: false, assistantsSeeHealth: true })
  assert.equal(health.canSeeHealth, true)
  assert.equal(health.canMessageAthletes, false)
  const messaging = coachTeamPermissions("assistant", { assistantsCanMessage: true, assistantsSeeHealth: false })
  assert.equal(messaging.canMessageAthletes, true)
  assert.equal(messaging.canSeeHealth, false)
  for (const permissions of [health, messaging]) {
    assert.equal(permissions.canEditPlans, false)
    assert.equal(permissions.canManageRoster, false)
    assert.equal(permissions.canPostAnnouncements, false)
    assert.equal(permissions.canExportReports, false)
  }
})

test("older data without a role never becomes an assistant by accident", () => {
  assert.equal(normaliseTeamCoachRole(undefined, true), "lead")
  assert.equal(normaliseTeamCoachRole(null, false), "coach")
  assert.equal(normaliseTeamCoachRole("boss", false), "coach")
  assert.equal(normaliseTeamCoachRole("assistant", true), "assistant")
  assert.equal(teamCoachRoleLabel("lead"), "Lead coach")
  assert.equal(teamCoachRoleLabel("assistant"), "Assistant coach")
})

test("club-wide content: not for someone who is an assistant everywhere", () => {
  assert.equal(canAuthorClubContent([]), true)
  assert.equal(canAuthorClubContent(["assistant"]), false)
  assert.equal(canAuthorClubContent(["assistant", "assistant"]), false)
  assert.equal(canAuthorClubContent(["assistant", "coach"]), true)
  assert.equal(canAuthorClubContent(["lead"]), true)
})

test("the teams a coach is on", () => {
  assert.deepEqual(teamsCoachedBy("rivera", teams).map((team) => team.id), ["t1", "t2", "t3"])
  assert.deepEqual(teamsCoachedBy("nobody", teams), [])
})

test("a team can stay with its remaining coaches only when a lead or coach is left", () => {
  assert.equal(canStayWithRemainingCoaches(sprint, "rivera"), true)
  assert.deepEqual(remainingCoachNames(sprint, "rivera"), ["Coach smith"])
  // Only an assistant would be left.
  assert.equal(canStayWithRemainingCoaches(jumps, "rivera"), false)
  assert.equal(canStayWithRemainingCoaches(distance, "lee"), false)
  // A deactivated coach does not count.
  assert.equal(canStayWithRemainingCoaches({ ...sprint, coaches: [coach("rivera", "lead"), coach("smith", "coach", false)] }, "rivera"), false)
})

test("the first suggestion never leaves a team without a lead silently", () => {
  // Rivera leads Sprint: someone has to be picked, even though Smith is there.
  assert.equal(defaultHandoverChoice(sprint, "rivera"), "")
  assert.equal(defaultHandoverChoice(jumps, "rivera"), "")
  // Rivera is a plain coach on Throws, which keeps its lead.
  assert.equal(defaultHandoverChoice(throws, "rivera"), HANDOVER_STAY)
})

test("validation: leaving the club needs an answer for every team", () => {
  const mine = teamsCoachedBy("rivera", teams)
  const candidates = ["smith", "lee", "asha"]
  assert.deepEqual(validateHandover({ leavingUserId: "rivera", teams: mine, choices: { t1: "smith", t2: "lee", t3: HANDOVER_STAY }, then: "remove", candidateIds: candidates }), [])
  const missing = validateHandover({ leavingUserId: "rivera", teams: mine, choices: { t1: "smith", t3: HANDOVER_STAY }, then: "remove", candidateIds: candidates })
  assert.deepEqual(missing.map((problem) => problem.teamId), ["t2"])
  const kept = validateHandover({ leavingUserId: "rivera", teams: mine, choices: { t1: "smith", t2: HANDOVER_KEEP, t3: HANDOVER_STAY }, then: "deactivate", candidateIds: candidates })
  assert.deepEqual(kept.map((problem) => problem.teamId), ["t2"])
})

test("validation: staying needs a coach, a new lead must be another active coach of the club", () => {
  const mine = teamsCoachedBy("rivera", teams)
  const stay = validateHandover({ leavingUserId: "rivera", teams: mine, choices: { t1: HANDOVER_STAY, t2: HANDOVER_STAY, t3: HANDOVER_STAY }, then: "remove", candidateIds: ["smith"] })
  assert.deepEqual(stay.map((problem) => problem.teamId), ["t2"])
  assert.match(stay[0].message, /no coach left/)
  const self = validateHandover({ leavingUserId: "rivera", teams: [sprint], choices: { t1: "rivera" }, then: "none", candidateIds: ["rivera", "smith"] })
  assert.equal(self.length, 1)
  const stranger = validateHandover({ leavingUserId: "rivera", teams: [sprint], choices: { t1: "stranger" }, then: "none", candidateIds: ["smith"] })
  assert.equal(stranger.length, 1)
})

test("validation: a standalone handover may keep some teams, but not all of them", () => {
  const mine = teamsCoachedBy("rivera", teams)
  assert.deepEqual(validateHandover({ leavingUserId: "rivera", teams: mine, choices: { t1: "smith", t2: HANDOVER_KEEP, t3: HANDOVER_KEEP }, then: "none", candidateIds: ["smith"] }), [])
  const nothing = validateHandover({ leavingUserId: "rivera", teams: mine, choices: { t1: HANDOVER_KEEP, t2: HANDOVER_KEEP, t3: HANDOVER_KEEP }, then: "none", candidateIds: ["smith"] })
  assert.equal(nothing.length, 1)
  assert.match(nothing[0].message, /at least one team/)
})

test("the list sent to the database leaves out kept teams and uses null for stay", () => {
  assert.deepEqual(toHandoverAssignments(teamsCoachedBy("rivera", teams), { t1: "smith", t2: HANDOVER_KEEP, t3: HANDOVER_STAY }), [
    { team_id: "t1", new_lead_user_id: "smith" },
    { team_id: "t3", new_lead_user_id: null },
  ])
})

test("applying a handover: the coach comes off, the new lead is the only lead, nobody else moves", () => {
  const after = applyHandover(teams, "rivera", { t1: "smith", t2: "lee", t3: HANDOVER_STAY }, (id) => `Coach ${id}`)
  const byId = Object.fromEntries(after.map((team) => [team.id, team.coaches.map((item) => `${item.userId}:${item.role}`)]))
  assert.deepEqual(byId.t1, ["smith:lead", "asha:assistant"])
  // Lee was not on Jumps: added as lead. The assistant stays an assistant.
  assert.deepEqual(byId.t2, ["lee:lead", "asha:assistant"])
  assert.deepEqual(byId.t3, ["smith:lead"])
  // A team the coach was not on is untouched.
  assert.deepEqual(byId.t4, ["lee:lead"])
  // The input is not changed.
  assert.equal(sprint.coaches.length, 3)
})

test("applying a handover to a team with another lead moves that lead down to coach", () => {
  const twoLeads: HandoverTeam = { id: "x", name: "X", coaches: [coach("rivera", "coach"), coach("old", "lead"), coach("new", "coach")] }
  const [after] = applyHandover([twoLeads], "rivera", { x: "new" }, (id) => id)
  assert.deepEqual(after.coaches.map((item) => `${item.userId}:${item.role}`), ["old:coach", "new:lead"])
})

test("kept teams are not touched", () => {
  const after = applyHandover(teams, "rivera", { t1: HANDOVER_KEEP, t2: "lee" }, (id) => id)
  assert.deepEqual(after[0], sprint)
  assert.equal(after[1].coaches.some((item) => item.userId === "rivera"), false)
  // No choice at all for Throws: untouched as well.
  assert.deepEqual(after[2], throws)
})

test("the handover in words", () => {
  assert.deepEqual(describeHandover(teamsCoachedBy("rivera", teams), { t1: "smith", t2: HANDOVER_KEEP, t3: HANDOVER_STAY }, (id) => `Coach ${id}`), [
    "Sprint Group to Coach smith (lead)",
    "Throws Group stays with its other coaches",
  ])
})

test("the system line names the coach once", () => {
  assert.equal(coachDisplayLabel("Coach Rivera"), "Coach Rivera")
  assert.equal(coachDisplayLabel("  Dana   Whyte "), "Coach Dana Whyte")
  assert.equal(coachDisplayLabel("Coachella Jones"), "Coach Coachella Jones")
  assert.equal(coachDisplayLabel(""), "Your coach")
  assert.equal(coachLeftTeamLine("Coach Rivera"), "Coach Rivera no longer coaches this team")
  assert.equal(coachLeftTeamLine(null), "Your coach no longer coaches this team")
})
