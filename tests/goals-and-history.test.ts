import test from "node:test"
import assert from "node:assert/strict"
import {
  achievementFromResults,
  currentBest,
  daysUntil,
  goalProgressPercent,
  goalState,
  meetsTarget,
  remainingToTarget,
  sortGoals,
  validateGoalInput,
} from "../src/lib/data/goals/goal-logic"
import { addDays, groupByWeek, matchesFilter, relativeWeekName, sessionOutcome, summariseLogged, weekStartOf } from "../src/lib/data/history/session-history"
import { buildTestSeries, compareTestResults, lowerIsBetterForTest } from "../src/lib/data/test-week/test-history"
import type { AthleteTestWeekHistoryItem, TestDefinitionUnit } from "../src/lib/data/test-week/types"

let counter = 0
function result(eventGroup: string, compareValue: number, date: string, windLegal = true) {
  counter += 1
  return { id: `r${counter}`, eventGroup, compareValue, windLegal, date, createdAt: `${date}T10:00:${String(counter).padStart(2, "0")}.000Z` }
}

/* ---------- Goals ------------------------------------------------------------------------------- */

test("meetsTarget follows the direction of the event", () => {
  assert.equal(meetsTarget(11.1, 11.1, true), true)
  assert.equal(meetsTarget(11.09, 11.1, true), true)
  assert.equal(meetsTarget(11.11, 11.1, true), false)
  assert.equal(meetsTarget(6.6, 6.6, false), true)
  assert.equal(meetsTarget(6.61, 6.6, false), true)
  assert.equal(meetsTarget(6.59, 6.6, false), false)
  // No floating point surprises at the boundary.
  assert.equal(meetsTarget(0.1 + 0.2, 0.3, true), true)
})

test("currentBest picks the best wind legal mark of the event", () => {
  const results = [result("k:100m", 11.4, "2026-01-01"), result("k:100m", 11.2, "2026-02-01", false), result("k:100m", 11.3, "2026-03-01"), result("k:200m", 10, "2026-03-01")]
  assert.equal(currentBest(results, "k:100m", true)?.compareValue, 11.3)
  assert.equal(currentBest([result("k:long_jump", 6.1, "2026-01-01"), result("k:long_jump", 6.4, "2026-02-01")], "k:long_jump", false)?.compareValue, 6.4)
  assert.equal(currentBest(results, "k:400m", true), null)
})

test("goalProgressPercent for a time (lower is better)", () => {
  assert.equal(goalProgressPercent(11.4, 11.4, 11.0, true), 0)
  assert.equal(goalProgressPercent(11.4, 11.2, 11.0, true), 50)
  assert.equal(goalProgressPercent(11.4, 11.1, 11.0, true), 75)
  assert.equal(goalProgressPercent(11.4, 11.0, 11.0, true), 100)
  assert.equal(goalProgressPercent(11.4, 10.9, 11.0, true), 100)
  // Slower than at the start is not negative progress.
  assert.equal(goalProgressPercent(11.4, 11.6, 11.0, true), 0)
})

test("goalProgressPercent for a distance or weight (higher is better)", () => {
  assert.equal(goalProgressPercent(180, 185, 190, false), 50)
  assert.equal(goalProgressPercent(6.42, 6.63, 6.6, false), 100)
  assert.equal(goalProgressPercent(180, 170, 190, false), 0)
})

test("goalProgressPercent never shows 100 before the target is met, and copes with no marks", () => {
  assert.equal(goalProgressPercent(11.4, 11.001, 11.0, true), 99)
  assert.equal(goalProgressPercent(null, null, 11.0, true), 0)
  assert.equal(goalProgressPercent(null, 11.3, 11.0, true), 0)
  assert.equal(goalProgressPercent(null, 10.9, 11.0, true), 100)
  assert.equal(goalProgressPercent(11.4, null, 11.0, true), 0)
})

test("remainingToTarget is the gap in the right direction and never negative", () => {
  assert.equal(remainingToTarget(11.28, 11.1, true), 0.18)
  assert.equal(remainingToTarget(185, 190, false), 5)
  assert.equal(remainingToTarget(10.9, 11.1, true), 0)
})

const openGoal = { eventGroup: "k:100m", targetValue: 11.1, lowerIsBetter: true, createdAt: "2026-03-01T09:00:00.000Z", achievedManually: false, achievedOn: null, achievedResultId: null }

test("a goal is achieved by the first later legal result that meets it", () => {
  const slow = result("k:100m", 11.2, "2026-04-01")
  const hit = result("k:100m", 11.08, "2026-05-01")
  const later = result("k:100m", 11.0, "2026-06-01")
  assert.deepEqual(achievementFromResults(openGoal, [later, hit, slow]), { achievedOn: "2026-05-01", achievedResultId: hit.id })
  assert.deepEqual(achievementFromResults(openGoal, [slow]), { achievedOn: null, achievedResultId: null })
})

test("results before the goal was set, wind assisted marks and other events do not achieve it", () => {
  assert.equal(achievementFromResults(openGoal, [result("k:100m", 11.0, "2026-02-28")]).achievedOn, null)
  assert.equal(achievementFromResults(openGoal, [result("k:100m", 11.0, "2026-05-01", false)]).achievedOn, null)
  assert.equal(achievementFromResults(openGoal, [result("k:200m", 11.0, "2026-05-01")]).achievedOn, null)
  // The day the goal was set counts.
  assert.equal(achievementFromResults(openGoal, [result("k:100m", 11.1, "2026-03-01")]).achievedOn, "2026-03-01")
})

test("higher is better goals are achieved by a mark at or over the target", () => {
  const goal = { ...openGoal, eventGroup: "k:long_jump", targetValue: 6.6, lowerIsBetter: false }
  assert.equal(achievementFromResults(goal, [result("k:long_jump", 6.59, "2026-04-01")]).achievedOn, null)
  assert.equal(achievementFromResults(goal, [result("k:long_jump", 6.6, "2026-04-02")]).achievedOn, "2026-04-02")
})

test("a goal marked achieved by hand keeps its day whatever the results say", () => {
  const manual = { ...openGoal, achievedManually: true, achievedOn: "2026-04-10", achievedResultId: null }
  assert.deepEqual(achievementFromResults(manual, []), { achievedOn: "2026-04-10", achievedResultId: null })
  assert.deepEqual(achievementFromResults(manual, [result("k:100m", 11.0, "2026-05-01")]), { achievedOn: "2026-04-10", achievedResultId: null })
})

test("goalState: achieved, past the date, on track", () => {
  assert.equal(goalState({ achievedOn: "2026-05-01", targetDate: "2026-04-01" }, "2026-06-01").kind, "achieved")
  assert.equal(goalState({ achievedOn: null, targetDate: "2026-04-01" }, "2026-04-02").kind, "past-date")
  assert.equal(goalState({ achievedOn: null, targetDate: "2026-04-01" }, "2026-04-01").kind, "on-track")
  assert.equal(goalState({ achievedOn: null, targetDate: null }, "2026-04-01").kind, "on-track")
  assert.deepEqual(goalState({ achievedOn: null, targetDate: "2026-04-01" }, "2026-04-02"), { kind: "past-date", tone: "coral", label: "Past the date" })
})

test("daysUntil counts whole days across months", () => {
  assert.equal(daysUntil("2026-03-01", "2026-02-27"), 2)
  assert.equal(daysUntil("2026-03-01", "2026-03-01"), 0)
  assert.equal(daysUntil("2026-03-01", "2026-03-04"), -3)
})

test("sortGoals: open by nearest date, undated last, then achieved newest first", () => {
  const goals = [
    { id: "achieved-old", achievedOn: "2026-01-01", targetDate: null, createdAt: "2025-01-01" },
    { id: "undated", achievedOn: null, targetDate: null, createdAt: "2026-01-01" },
    { id: "late", achievedOn: null, targetDate: "2026-12-01", createdAt: "2026-01-01" },
    { id: "achieved-new", achievedOn: "2026-05-01", targetDate: null, createdAt: "2025-01-01" },
    { id: "soon", achievedOn: null, targetDate: "2026-06-01", createdAt: "2026-01-01" },
  ]
  assert.deepEqual(sortGoals(goals).map((goal) => goal.id), ["soon", "late", "undated", "achieved-new", "achieved-old"])
})

test("validateGoalInput refuses a target already reached and a date in the past", () => {
  const base = { eventKey: "100m", targetValue: 11.1, targetDate: null, note: null }
  const context = { lowerIsBetter: true, best: 11.28, today: "2026-05-01", isNew: true }
  assert.equal(validateGoalInput(base, context), null)
  assert.match(validateGoalInput({ ...base, targetValue: 11.3 }, context) ?? "", /already reached/)
  assert.match(validateGoalInput({ ...base, targetValue: 11.28 }, context) ?? "", /already reached/)
  assert.match(validateGoalInput({ ...base, targetDate: "2026-04-30" }, context) ?? "", /cannot be in the past/)
  assert.equal(validateGoalInput({ ...base, targetDate: "2026-04-30" }, { ...context, isNew: false }), null)
  assert.match(validateGoalInput({ ...base, targetValue: 0 }, context) ?? "", /Enter the mark/)
  assert.match(validateGoalInput({ ...base, eventKey: "" }, context) ?? "", /Choose an event/)
  assert.match(validateGoalInput({ ...base, targetValue: 6.0 }, { ...context, lowerIsBetter: false, best: 6.1 }) ?? "", /already reached/)
  assert.equal(validateGoalInput({ ...base, targetValue: 6.5 }, { ...context, lowerIsBetter: false, best: 6.1 }), null)
})

/* ---------- Session history ------------------------------------------------------------------- */

test("weekStartOf is the Monday, across month and year ends", () => {
  assert.equal(weekStartOf("2026-10-05"), "2026-10-05") // a Monday
  assert.equal(weekStartOf("2026-10-11"), "2026-10-05") // the Sunday of that week
  assert.equal(weekStartOf("2026-10-01"), "2026-09-28")
  assert.equal(weekStartOf("2027-01-01"), "2026-12-28")
  assert.equal(addDays("2026-02-27", 3), "2026-03-02")
})

test("groupByWeek: newest week first, order inside a week kept", () => {
  const items = [{ date: "2026-10-07", id: "wed" }, { date: "2026-10-05", id: "mon" }, { date: "2026-10-04", id: "sun-before" }, { date: "2026-09-22", id: "older" }]
  const weeks = groupByWeek(items)
  assert.deepEqual(weeks.map((week) => [week.weekStart, week.weekEnd]), [["2026-10-05", "2026-10-11"], ["2026-09-28", "2026-10-04"], ["2026-09-21", "2026-09-27"]])
  assert.deepEqual(weeks[0].items.map((item) => item.id), ["wed", "mon"])
  assert.deepEqual(weeks[1].items.map((item) => item.id), ["sun-before"])
  assert.deepEqual(groupByWeek([]), [])
})

test("relativeWeekName names this week and last week only", () => {
  assert.equal(relativeWeekName("2026-10-05", "2026-10-08"), "This week")
  assert.equal(relativeWeekName("2026-09-28", "2026-10-08"), "Last week")
  assert.equal(relativeWeekName("2026-09-21", "2026-10-08"), null)
})

test("sessionOutcome: done, skipped, missed, excused, open", () => {
  const today = "2026-10-08"
  assert.equal(sessionOutcome({ status: "completed", origin: "plan", date: "2026-10-01" }, today, false), "done")
  assert.equal(sessionOutcome({ status: "skipped", origin: "plan", date: "2026-10-01" }, today, false), "skipped")
  assert.equal(sessionOutcome({ status: "scheduled", origin: "plan", date: "2026-10-01" }, today, false), "missed")
  assert.equal(sessionOutcome({ status: "in-progress", origin: "plan", date: "2026-10-01" }, today, false), "missed")
  assert.equal(sessionOutcome({ status: "scheduled", origin: "plan", date: "2026-10-01" }, today, true), "excused")
  // Today's session is not missed yet, and a session the athlete added is never "missed".
  assert.equal(sessionOutcome({ status: "scheduled", origin: "plan", date: today }, today, false), "open")
  assert.equal(sessionOutcome({ status: "in-progress", origin: "athlete", date: "2026-10-01" }, today, false), "open")
  // Done wins over excused.
  assert.equal(sessionOutcome({ status: "completed", origin: "plan", date: "2026-10-01" }, today, true), "done")
})

test("matchesFilter", () => {
  assert.equal(matchesFilter("excused", "all"), true)
  assert.equal(matchesFilter("done", "done"), true)
  assert.equal(matchesFilter("excused", "missed"), false)
  assert.equal(matchesFilter("open", "done"), false)
})

test("summariseLogged says how much and names the first exercises", () => {
  assert.equal(summariseLogged([]), null)
  assert.equal(summariseLogged([{ label: "Back squat", sets: 0 }]), null)
  assert.equal(summariseLogged([{ label: "Back squat", sets: 1 }]), "1 exercise, 1 set: Back squat")
  assert.equal(
    summariseLogged([{ label: "Back squat", sets: 3 }, { label: "Flying 30m", sets: 4 }, { label: "Plank", sets: 0 }, { label: "Bounds", sets: 2 }, { label: "Sled", sets: 2 }]),
    "4 exercises, 11 sets: Back squat, Flying 30m and 2 more",
  )
})

/* ---------- Test week comparison ----------------------------------------------------------------- */

test("compareTestResults knows which way is better", () => {
  assert.deepEqual(compareTestResults("time", 2.89, 2.95), { difference: -0.06, direction: "better" })
  assert.deepEqual(compareTestResults("time", 4.1, 4.05), { difference: 0.05, direction: "worse" })
  assert.deepEqual(compareTestResults("weight", 185, 180), { difference: 5, direction: "better" })
  assert.deepEqual(compareTestResults("height", 70, 72), { difference: -2, direction: "worse" })
  assert.deepEqual(compareTestResults("distance", 6.5, 6.5), { difference: 0, direction: "same" })
  assert.deepEqual(compareTestResults("score", 12, 10), { difference: 2, direction: "better" })
  assert.equal(lowerIsBetterForTest("time"), true)
  assert.equal(lowerIsBetterForTest("height"), false)
})

function week(id: string, start: string, results: Array<[string, TestDefinitionUnit, number | null]>): AthleteTestWeekHistoryItem {
  return {
    testWeekId: id,
    name: `Week ${id}`,
    startDate: start,
    endDate: start,
    status: "closed",
    results: results.map(([name, unit, value]) => ({
      testDefinitionId: `${id}:${name}`,
      name,
      unit,
      valueText: value === null ? "DNF" : String(value),
      valueNumeric: value,
      scheduledDate: start,
      submittedAt: `${start}T10:00:00Z`,
      previousValueText: null,
      change: null,
    })),
  }
}

test("buildTestSeries follows each test across weeks with previous and best ever", () => {
  const weeks = [
    week("c", "2026-09-01", [["Flying 30m", "time", 2.91], ["Squat 1RM", "weight", 190], ["CMJ", "height", null]]),
    week("a", "2025-10-01", [["Flying 30m", "time", 2.95], ["Squat 1RM", "weight", 180], ["CMJ", "height", 72]]),
    week("b", "2026-03-01", [["flying 30m ", "time", 2.89], ["Squat 1RM", "weight", 185]]),
  ]
  const series = buildTestSeries(weeks)
  assert.deepEqual(series.map((item) => item.name), ["Flying 30m", "Squat 1RM", "CMJ"])

  const flying = series[0]
  assert.deepEqual(flying.points.map((point) => point.valueNumeric), [2.95, 2.89, 2.91])
  assert.equal(flying.latest.testWeekId, "c")
  assert.equal(flying.previous?.testWeekId, "b")
  // Lower is better: the best ever is the middle week, and the latest is worse than the one before.
  assert.equal(flying.best?.testWeekId, "b")
  assert.deepEqual(flying.comparison, { difference: 0.02, direction: "worse" })

  const squat = series[1]
  assert.equal(squat.best?.testWeekId, "c")
  assert.deepEqual(squat.comparison, { difference: 5, direction: "better" })

  // A result without a number cannot be compared or be the best.
  const cmj = series[2]
  assert.equal(cmj.latest.valueNumeric, null)
  assert.equal(cmj.comparison, null)
  assert.equal(cmj.best?.testWeekId, "a")
})

test("buildTestSeries keeps tests with the same name and different units apart, and handles one week", () => {
  const series = buildTestSeries([week("a", "2026-01-01", [["Jump", "height", 70], ["Jump", "distance", 2.9]])])
  assert.equal(series.length, 2)
  assert.equal(series[0].previous, null)
  assert.equal(series[0].comparison, null)
  assert.equal(series[0].best?.valueNumeric, 70)
  assert.deepEqual(buildTestSeries([]), [])
})
