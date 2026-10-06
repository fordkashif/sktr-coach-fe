import test from "node:test"
import assert from "node:assert/strict"
import { duplicateAsDraft, duplicatePreviousWeek, planFromBuilderState, setPlanWeeks, toBuilderState, toPublishStructure, type PlanDraft } from "../src/lib/data/training-plan/plan-builder-model"
import {
  assignPhase,
  cleanIntendedEffort,
  cleanTargetLoad,
  clearPhaseRange,
  clipPhases,
  nextPhaseColor,
  phaseForWeek,
  phaseWeeksText,
  plannedSessionLoad,
  plannedWeekLoad,
  removePhase,
  sanitizePhases,
  sanitizeWeekTargets,
  sanitizeWeekTypes,
  updatePhase,
  weekLine,
  weeksTouched,
  type PlanPhase,
} from "../src/lib/data/training-plan/plan-phases"
import { planFromTemplate, sanitizeTemplateStructure, templateStructureFromPlan } from "../src/lib/data/training-plan/plan-templates"

const spans = (phases: PlanPhase[]) => phases.map((phase) => `${phase.name}:${phase.startWeek}-${phase.endWeek}`)

function base(): PlanPhase[] {
  let phases = assignPhase([], { name: "General prep", color: "blue", fromWeek: 1, toWeek: 4 }, 12)
  phases = assignPhase(phases, { name: "Specific prep", color: "green", fromWeek: 5, toWeek: 8 }, 12)
  return assignPhase(phases, { name: "Competition", color: "coral", fromWeek: 9, toWeek: 12 }, 12)
}

function plan(): PlanDraft {
  return {
    id: "p1",
    status: "draft",
    name: "Block",
    teamId: "t1",
    startDate: "2026-01-05",
    weeks: 6,
    notes: "",
    weekFocus: { "1": "Base" },
    phases: [
      { id: "ph1", name: "General prep", color: "blue", startWeek: 1, endWeek: 4 },
      { id: "ph2", name: "Taper", color: "yellow", startWeek: 5, endWeek: 6 },
    ],
    weekTypes: { "1": "build", "4": "deload", "6": "competition" },
    weekTargetLoad: { "1": 1500, "6": 600 },
    sessions: [
      { id: "s1", week: 1, dayIndex: 0, title: "Gym", sessionType: "Gym", location: "", durationMinutes: "60", intendedEffort: "7", notes: "", blocks: [] },
      { id: "s2", week: 1, dayIndex: 2, title: "Track", sessionType: "Track", location: "", durationMinutes: "90", intendedEffort: "5", notes: "", blocks: [] },
      { id: "s3", week: 1, dayIndex: 4, title: "Easy", sessionType: "Recovery", location: "", durationMinutes: "40", notes: "", blocks: [] },
      { id: "s4", week: 6, dayIndex: 5, title: "Race", sessionType: "Track", location: "", durationMinutes: "", intendedEffort: "10", notes: "", blocks: [] },
    ],
    assign: { target: "team", subgroup: null, athleteIds: [], squadIds: [], visibilityStart: "immediate", visibilityDate: null },
  }
}

test("phases cover consecutive weeks and never overlap", () => {
  assert.deepEqual(spans(base()), ["General prep:1-4", "Specific prep:5-8", "Competition:9-12"])
  assert.equal(phaseForWeek(base(), 5)?.name, "Specific prep")
  assert.equal(phaseForWeek(base(), 13), null)
  assert.equal(phaseForWeek(undefined, 1), null)
})

test("assigning over the middle of a phase cuts it in two", () => {
  const phases = assignPhase(base(), { name: "Taper", color: "yellow", fromWeek: 2, toWeek: 3 }, 12)
  assert.deepEqual(spans(phases), ["General prep:1-1", "Taper:2-3", "General prep:4-4", "Specific prep:5-8", "Competition:9-12"])
  assert.equal(new Set(phases.map((phase) => phase.id)).size, phases.length)
})

test("assigning across phases shortens the neighbours and removes what is covered", () => {
  const phases = assignPhase(base(), { name: "Pre-competition", color: "ink", fromWeek: 4, toWeek: 10 }, 12)
  assert.deepEqual(spans(phases), ["General prep:1-3", "Pre-competition:4-10", "Competition:11-12"])
})

test("a range given backwards or past the end is put right", () => {
  assert.deepEqual(spans(assignPhase([], { name: "Taper", color: "blue", fromWeek: 6, toWeek: 4 }, 12)), ["Taper:4-6"])
  assert.deepEqual(spans(assignPhase([], { name: "Taper", color: "blue", fromWeek: 11, toWeek: 20 }, 12)), ["Taper:11-12"])
  assert.deepEqual(spans(assignPhase([], { name: "Taper", color: "blue", fromWeek: 0, toWeek: 2 }, 12)), ["Taper:1-2"])
  assert.deepEqual(assignPhase([], { name: "Taper", color: "blue", fromWeek: 13, toWeek: 14 }, 12), [])
  assert.deepEqual(assignPhase([], { name: "   ", color: "blue", fromWeek: 1, toWeek: 2 }, 12), [])
})

test("the same phase next door is extended, not doubled", () => {
  const start = assignPhase([], { name: "General prep", color: "blue", fromWeek: 1, toWeek: 4 }, 12)
  const extended = assignPhase(start, { name: "general prep", color: "blue", fromWeek: 5, toWeek: 6 }, 12)
  assert.deepEqual(spans(extended), ["General prep:1-6"])
  assert.equal(extended[0].id, start[0].id)
  const bridged = assignPhase(assignPhase(start, { name: "General prep", color: "blue", fromWeek: 7, toWeek: 8 }, 12), { name: "General prep", color: "blue", fromWeek: 5, toWeek: 6 }, 12)
  assert.deepEqual(spans(bridged), ["General prep:1-8"])
  // Another colour is another phase.
  assert.equal(assignPhase(start, { name: "General prep", color: "green", fromWeek: 5, toWeek: 6 }, 12).length, 2)
})

test("free text names are kept, trimmed and capped", () => {
  const [phase] = assignPhase([], { name: "  Altitude   camp  ", color: "green", fromWeek: 1, toWeek: 1 }, 4)
  assert.equal(phase.name, "Altitude camp")
  assert.equal(assignPhase([], { name: "x".repeat(200), color: "green", fromWeek: 1, toWeek: 1 }, 4)[0].name.length, 60)
  assert.equal(phaseWeeksText(phase), "Week 1")
  assert.equal(phaseWeeksText({ startWeek: 2, endWeek: 5 }), "Weeks 2 to 5")
})

test("clearing, removing, renaming and clipping", () => {
  assert.deepEqual(spans(clearPhaseRange(base(), 3, 9)), ["General prep:1-2", "Competition:10-12"])
  const phases = base()
  assert.deepEqual(spans(removePhase(phases, phases[1].id)), ["General prep:1-4", "Competition:9-12"])
  const renamed = updatePhase(phases, phases[0].id, { name: " Base ", color: "ink" })
  assert.deepEqual([renamed[0].name, renamed[0].color, renamed[0].startWeek, renamed[0].endWeek], ["Base", "ink", 1, 4])
  assert.equal(updatePhase(phases, phases[0].id, { name: "  " })[0].name, "General prep")
  assert.deepEqual(spans(clipPhases(base(), 6)), ["General prep:1-4", "Specific prep:5-6"])
  assert.deepEqual(spans(clipPhases(base(), 4)), ["General prep:1-4"])
})

test("a new phase gets a colour not in use yet", () => {
  assert.equal(nextPhaseColor([]), "blue")
  assert.equal(nextPhaseColor(base()), "yellow")
})

test("stored phases are cleaned: damaged dropped, overlaps refused, ends clipped", () => {
  const phases = sanitizePhases(
    [
      { id: "a", name: "General prep", color: "blue", startWeek: 1, endWeek: 4 },
      { id: "b", name: "Overlaps", color: "green", startWeek: 4, endWeek: 6 },
      { id: "a", name: "Same id", color: "purple", startWeek: 5, endWeek: 30 },
      { name: "", startWeek: 7, endWeek: 8 },
      { name: "Backwards", startWeek: 8, endWeek: 7 },
      "junk",
      null,
    ],
    8,
  )
  assert.deepEqual(spans(phases), ["General prep:1-4", "Same id:5-8"])
  assert.equal(phases[1].color, "blue")
  assert.notEqual(phases[1].id, "a")
  assert.deepEqual(sanitizePhases("nope", 8), [])
  assert.deepEqual(sanitizeWeekTypes({ "1": "build", "2": "peak", "9": "hold", x: "hold" }, 8), { "1": "build" })
  assert.deepEqual(sanitizeWeekTargets({ "1": 1500, "2": "900", "3": -5, "4": "lots", "9": 100 }, 8), { "1": 1500, "2": 900 })
})

test("planned load of a session and of a week", () => {
  assert.equal(plannedSessionLoad({ durationMinutes: "60", intendedEffort: "7" }), 420)
  assert.equal(plannedSessionLoad({ durationMinutes: "60" }), null)
  assert.equal(plannedSessionLoad({ durationMinutes: "", intendedEffort: "7" }), null)
  assert.equal(plannedSessionLoad({ durationMinutes: "60", intendedEffort: "11" }), null)
  assert.deepEqual(plannedWeekLoad(plan().sessions, 1), { load: 870, sessions: 3, counted: 2 }) // 60x7 + 90x5
  assert.deepEqual(plannedWeekLoad(plan().sessions, 6), { load: null, sessions: 1, counted: 0 })
  assert.deepEqual(plannedWeekLoad(plan().sessions, 3), { load: null, sessions: 0, counted: 0 })
  assert.equal(cleanIntendedEffort("7"), 7)
  assert.equal(cleanIntendedEffort("0"), null)
  assert.equal(cleanIntendedEffort("7.5"), null)
  assert.equal(cleanIntendedEffort(undefined), null)
  assert.equal(cleanTargetLoad("1500"), 1500)
  assert.equal(cleanTargetLoad(""), null)
  assert.equal(cleanTargetLoad("0"), null)
})

test("the athlete's quiet line", () => {
  assert.equal(weekLine("Specific prep", "deload"), "Specific prep, deload week")
  assert.equal(weekLine(null, "test"), "Test week")
  assert.equal(weekLine("Taper", null), "Taper")
  assert.equal(weekLine(null, null), null)
  assert.equal(weekLine("  ", undefined), null)
})

test("which plan weeks a competition or test week falls on", () => {
  // The plan starts Monday 5 January 2026 and runs 6 weeks (to 15 February).
  assert.deepEqual(weeksTouched("2026-01-05", 6, "2026-01-05", "2026-01-05"), [1])
  assert.deepEqual(weeksTouched("2026-01-05", 6, "2026-01-11", "2026-01-12"), [1, 2])
  assert.deepEqual(weeksTouched("2026-01-05", 6, "2026-02-14", "2026-02-20"), [6])
  assert.deepEqual(weeksTouched("2026-01-05", 6, "2026-01-01", "2026-01-04"), [])
  assert.deepEqual(weeksTouched("2026-01-05", 6, "2026-02-16", "2026-02-17"), [])
  assert.deepEqual(weeksTouched("2026-01-05", 6, "2025-12-20", "2026-03-01"), [1, 2, 3, 4, 5, 6])
  assert.deepEqual(weeksTouched("not a date", 6, "2026-01-05", "2026-01-05"), [])
})

test("a plan without phases stores and loads exactly as before", () => {
  const old: PlanDraft = { ...plan(), phases: undefined, weekTypes: undefined, weekTargetLoad: undefined, sessions: [] }
  const state = toBuilderState(old)
  assert.deepEqual(Object.keys(state).sort(), ["assign", "sessions", "version", "weekFocus"])
  const loaded = planFromBuilderState({ id: "p1", status: "draft", name: "Block", teamId: "t1", startDate: "2026-01-05", weeks: 6, notes: "" }, { version: 1, weekFocus: { "1": "Base" }, sessions: [], assign: {} })
  assert.equal(loaded.phases, undefined)
  assert.equal(loaded.weekTypes, undefined)
  assert.equal(loaded.weekTargetLoad, undefined)
  assert.equal(toPublishStructure(loaded)[0].weekType, null)
  assert.equal(toPublishStructure(loaded)[0].phaseName, null)
})

test("phases, week types, targets and intended effort survive a save and a load", () => {
  const loaded = planFromBuilderState({ id: "p1", status: "draft", name: "Block", teamId: "t1", startDate: "2026-01-05", weeks: 6, notes: "" }, JSON.parse(JSON.stringify(toBuilderState(plan()))))
  assert.deepEqual(loaded.phases, plan().phases)
  assert.deepEqual(loaded.weekTypes, plan().weekTypes)
  assert.deepEqual(loaded.weekTargetLoad, plan().weekTargetLoad)
  assert.deepEqual(loaded.sessions.map((session) => session.intendedEffort), ["7", "5", undefined, "10"])
})

test("what the athlete gets on publish", () => {
  const weeks = toPublishStructure(plan())
  assert.deepEqual(weeks.map((week) => [week.phaseName, week.weekType]), [
    ["General prep", "build"],
    ["General prep", null],
    ["General prep", null],
    ["General prep", "deload"],
    ["Taper", null],
    ["Taper", "competition"],
  ])
})

test("making the plan shorter clips phases and drops what is past the end", () => {
  const shorter = setPlanWeeks(plan(), 5)
  assert.deepEqual(spans(shorter.phases ?? []), ["General prep:1-4", "Taper:5-5"])
  assert.deepEqual(shorter.weekTypes, { "1": "build", "4": "deload" })
  assert.deepEqual(shorter.weekTargetLoad, { "1": 1500 })
  assert.deepEqual(spans(setPlanWeeks(plan(), 3).phases ?? []), ["General prep:1-3"])
})

test("copying still works: last week, the whole plan", () => {
  const copied = duplicatePreviousWeek({ ...plan(), weekTypes: { "1": "build" } }, 2)
  assert.equal(copied.weekTypes?.["2"], "build")
  assert.deepEqual(copied.sessions.filter((session) => session.week === 2).map((session) => session.intendedEffort), ["7", "5", undefined])
  // A week that already has a type keeps it.
  assert.equal(duplicatePreviousWeek({ ...plan(), weekTypes: { "1": "build", "2": "deload" } }, 2).weekTypes?.["2"], "deload")
  const draft = duplicateAsDraft(plan())
  assert.deepEqual(spans(draft.phases ?? []), ["General prep:1-4", "Taper:5-6"])
  assert.deepEqual(draft.weekTypes, plan().weekTypes)
  assert.notEqual(draft.phases, plan().phases)
})

test("phases flow into a template and out again", () => {
  const structure = templateStructureFromPlan(plan())
  assert.deepEqual(spans(structure.phases ?? []), ["General prep:1-4", "Taper:5-6"])
  assert.deepEqual(structure.weekTypes, plan().weekTypes)
  assert.deepEqual(structure.weekTargetLoad, plan().weekTargetLoad)
  assert.deepEqual(structure.sessions.map((session) => session.intendedEffort), ["7", "5", undefined, "10"])
  // Stored as JSON and read back.
  const stored = sanitizeTemplateStructure(JSON.parse(JSON.stringify(structure)), 6)
  assert.deepEqual(stored.phases, structure.phases)
  const draft = planFromTemplate({ name: "Template", weeks: 6, structure: stored }, { teamId: "t2", startDate: "2026-03-02" })
  assert.deepEqual(spans(draft.phases ?? []), ["General prep:1-4", "Taper:5-6"])
  assert.deepEqual(draft.weekTypes, plan().weekTypes)
  assert.deepEqual(draft.weekTargetLoad, plan().weekTargetLoad)
  assert.equal(plannedWeekLoad(draft.sessions, 1).load, 870)
  assert.ok(draft.phases?.every((phase) => !["ph1", "ph2"].includes(phase.id)))
})

test("a template saved before phases existed still starts a plan", () => {
  const draft = planFromTemplate({ name: "Old", weeks: 2, structure: { version: 1, weekFocus: { "1": "Base" }, sessions: [] } }, { teamId: "t1", startDate: "2026-03-02" })
  assert.equal(draft.phases, undefined)
  assert.equal(draft.weekTypes, undefined)
  assert.deepEqual(draft.weekFocus, { "1": "Base" })
})
