import test from "node:test"
import assert from "node:assert/strict"
import { createEmptyPlan, newSession, reachesLaterJoiners, validateForPublish, type PlanDraft } from "../src/lib/data/training-plan/plan-builder-model"

function planFor(target: PlanDraft["assign"]["target"], extra: Partial<PlanDraft["assign"]> = {}): PlanDraft {
  const plan = createEmptyPlan("team-1")
  plan.name = "Strength and power block"
  plan.startDate = "2026-10-12"
  plan.sessions = [newSession(1, 0, { title: "Squat, bench and deadlift" })]
  plan.assign = { ...plan.assign, target, ...extra }
  return plan
}

test("a whole-team plan can be published before anyone is on the team", () => {
  assert.equal(validateForPublish(planFor("team"), 0), null)
  assert.equal(reachesLaterJoiners(planFor("team")), true)
})

test("an empty squad can still be published to, as before", () => {
  assert.equal(validateForPublish(planFor("squads", { squadIds: ["squad-1"] }), 0), null)
})

test("an event group or picked athletes with nobody in them is still blocked", () => {
  assert.match(validateForPublish(planFor("subgroup", { subgroup: "Throws" }), 0) ?? "", /Nobody would receive this plan/)
  assert.equal(reachesLaterJoiners(planFor("subgroup", { subgroup: "Throws" })), false)
  assert.equal(reachesLaterJoiners(planFor("selected", { athleteIds: ["a1"] })), false)
})

test("the other publish checks still apply to an empty team", () => {
  const noSessions = planFor("team")
  noSessions.sessions = []
  assert.equal(validateForPublish(noSessions, 0), "Add at least one session before publishing.")
  const noTeam = planFor("team")
  noTeam.teamId = ""
  assert.equal(validateForPublish(noTeam, 0), "Choose a team for this plan.")
})
