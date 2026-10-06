import test from "node:test"
import assert from "node:assert/strict"
import { duplicateAsDraft, slotDate, toBuilderState, type PlanDraft } from "../src/lib/data/training-plan/plan-builder-model"
import {
  copyName,
  countAthleteAdjustments,
  filterTemplates,
  formatLastUsed,
  planFromTemplate,
  sanitizeTemplateStructure,
  sessionsPerWeek,
  templateOutline,
  templateStructureFromPlan,
  validateTemplateDetails,
  weekdayOfIso,
  type PlanTemplateSummary,
} from "../src/lib/data/training-plan/plan-templates"

function samplePlan(): PlanDraft {
  return {
    id: "plan-1",
    status: "published",
    name: "Sprint block",
    teamId: "t1",
    startDate: "2026-01-05",
    weeks: 2,
    notes: "Bring spikes",
    weekFocus: { "1": "Base", "2": "Build", "3": "Beyond the end", "x": " " },
    sessions: [
      {
        id: "s1",
        week: 1,
        dayIndex: 0,
        title: "Gym",
        sessionType: "Gym",
        location: "Weights room",
        durationMinutes: "60",
        notes: "Heavy day",
        blocks: [
          {
            id: "b1",
            title: "Strength",
            notes: "Full rest",
            exercises: [
              {
                id: "e1",
                name: "Back squat",
                sets: "4",
                reps: "4",
                load: "80%",
                libraryId: "lib-squat",
                cue: "Brace",
                link: "https://example.com/squat",
                percentOf: "Back squat",
                overrides: [
                  { id: "o1", athleteId: "a3", sets: "", reps: "", load: "70%", note: "Knee" },
                  { id: "o2", athleteId: "a1", sets: "3", reps: "", load: "", note: "" },
                ],
              },
              { id: "e2", name: "Plank", sets: "3", reps: "45s", load: "" },
            ],
          },
        ],
      },
      { id: "s2", week: 2, dayIndex: 3, title: "", sessionType: "Track", location: "", durationMinutes: "", notes: "", blocks: [] },
      { id: "s3", week: 3, dayIndex: 0, title: "Past the end", sessionType: "Track", location: "", durationMinutes: "", notes: "", blocks: [] },
    ],
    assign: { target: "selected", subgroup: "Sprint", athleteIds: ["a1", "a3"], squadIds: [], visibilityStart: "scheduled", visibilityDate: "2026-01-01" },
  }
}

test("a template keeps the structure, library links and percentage loads", () => {
  const structure = templateStructureFromPlan(samplePlan())
  assert.equal(structure.version, 1)
  assert.equal(structure.sessions.length, 2)
  const squat = structure.sessions[0].blocks[0].exercises[0]
  assert.equal(squat.name, "Back squat")
  assert.equal(squat.sets, "4")
  assert.equal(squat.reps, "4")
  assert.equal(squat.load, "80%")
  assert.equal(squat.libraryId, "lib-squat")
  assert.equal(squat.cue, "Brace")
  assert.equal(squat.link, "https://example.com/squat")
  assert.equal(squat.percentOf, "Back squat")
  assert.equal(structure.sessions[0].blocks[0].notes, "Full rest")
  assert.equal(structure.sessions[0].location, "Weights room")
  assert.deepEqual(structure.weekFocus, { "1": "Base", "2": "Build" })
})

test("a template carries nothing that belongs to one squad", () => {
  const plan = samplePlan()
  assert.equal(countAthleteAdjustments(plan), 2)
  const structure = templateStructureFromPlan(plan)
  const text = JSON.stringify(structure)
  for (const word of ["overrides", "athleteId", "a3", "assign", "t1", "2026-01-05", "visibilityDate", "Bring spikes", "plan-1"]) {
    assert.equal(text.includes(word), false, `"${word}" must not be in a template`)
  }
  assert.deepEqual(Object.keys(structure).sort(), ["sessions", "version", "weekFocus"])
  // The plan itself is not changed by saving it as a template.
  assert.equal(plan.sessions[0].blocks[0].exercises[0].overrides?.length, 2)
  assert.equal(plan.assign.athleteIds.length, 2)
})

test("a template shares no ids with the plan it came from", () => {
  const plan = samplePlan()
  const structure = templateStructureFromPlan(plan)
  assert.notEqual(structure.sessions[0].id, "s1")
  assert.notEqual(structure.sessions[0].blocks[0].id, "b1")
  assert.notEqual(structure.sessions[0].blocks[0].exercises[0].id, "e1")
  structure.sessions[0].blocks[0].exercises[0].load = "50%"
  assert.equal(plan.sessions[0].blocks[0].exercises[0].load, "80%")
})

test("stored data that still has squad parts is cleaned when read", () => {
  const dirty = { ...toBuilderState(samplePlan()), extra: "x" }
  const clean = sanitizeTemplateStructure(dirty, 2)
  assert.equal(JSON.stringify(clean).includes("overrides"), false)
  assert.equal("assign" in clean, false)
  assert.equal(clean.sessions.length, 2)
  assert.deepEqual(sanitizeTemplateStructure(null, 3), { version: 1, weekFocus: {}, sessions: [] })
  assert.deepEqual(sanitizeTemplateStructure("nonsense", 3).sessions, [])
})

test("a plan from a template is a dated draft for the chosen team", () => {
  const structure = templateStructureFromPlan(samplePlan())
  const template = { name: "Sprint prep", weeks: 2, structure }
  const plan = planFromTemplate(template, { teamId: "t4", startDate: "2026-11-02" })
  assert.equal(plan.id, null)
  assert.equal(plan.status, "draft")
  assert.equal(plan.name, "Sprint prep")
  assert.equal(plan.teamId, "t4")
  assert.equal(plan.startDate, "2026-11-02")
  assert.equal(plan.weeks, 2)
  assert.deepEqual(plan.assign, { target: "team", subgroup: null, athleteIds: [], squadIds: [], visibilityStart: "immediate", visibilityDate: null })
  // Every session is dated from the new start date: same week and day slot, new calendar date.
  const [first, second] = [...plan.sessions].sort((left, right) => left.week - right.week)
  assert.equal(slotDate(plan, first.week, first.dayIndex), "2026-11-02")
  assert.equal(slotDate(plan, second.week, second.dayIndex), "2026-11-12")
  assert.equal(planFromTemplate(template, { teamId: "t4", startDate: "2026-11-02", name: "  Autumn block " }).name, "Autumn block")
})

test("re-dating crosses months, years and leap days", () => {
  const structure = templateStructureFromPlan({ ...samplePlan(), weeks: 10, sessions: [{ ...samplePlan().sessions[0], week: 10, dayIndex: 6 }, samplePlan().sessions[0]] })
  const plan = planFromTemplate({ name: "Long", weeks: 10, structure }, { teamId: "t1", startDate: "2027-12-27" })
  assert.equal(slotDate(plan, 1, 0), "2027-12-27")
  assert.equal(slotDate(plan, 10, 6), "2028-03-05")
  const leap = planFromTemplate({ name: "Long", weeks: 10, structure }, { teamId: "t1", startDate: "2028-02-23" })
  assert.equal(slotDate(leap, 1, 6), "2028-02-29")
  assert.equal(slotDate(leap, 2, 0), "2028-03-01")
})

test("changing a plan made from a template never changes the template", () => {
  const structure = templateStructureFromPlan(samplePlan())
  const before = JSON.stringify(structure)
  const template = { name: "Sprint prep", weeks: 2, structure }
  const plan = planFromTemplate(template, { teamId: "t1", startDate: "2026-11-02" })
  plan.sessions[0].title = "Changed"
  plan.sessions[0].blocks.push({ id: "new", title: "Added", notes: "", exercises: [] })
  plan.weekFocus["1"] = "Changed focus"
  const squat = plan.sessions.flatMap((session) => session.blocks).flatMap((block) => block.exercises)[0]
  squat.load = "95%"
  squat.overrides = [{ id: "o", athleteId: "a9", sets: "", reps: "", load: "60%", note: "" }]
  assert.equal(JSON.stringify(structure), before)
  // Two plans from one template do not share ids either.
  const again = planFromTemplate(template, { teamId: "t1", startDate: "2026-11-02" })
  const ids = new Set(plan.sessions.map((session) => session.id))
  assert.equal(again.sessions.some((session) => ids.has(session.id)), false)
  assert.equal(again.sessions.find((session) => session.week === 1)?.title, "Gym")
  // A duplicate of the new plan is still a normal draft.
  assert.equal(duplicateAsDraft(plan).status, "draft")
})

test("a template longer than allowed, or with sessions past its end, is trimmed", () => {
  const structure = templateStructureFromPlan(samplePlan())
  const plan = planFromTemplate({ name: "One week", weeks: 1, structure }, { teamId: "t1", startDate: "2026-11-02" })
  assert.equal(plan.weeks, 1)
  assert.equal(plan.sessions.length, 1)
  assert.deepEqual(plan.weekFocus, { "1": "Base" })
  assert.equal(planFromTemplate({ name: "Huge", weeks: 99, structure }, { teamId: "t1", startDate: "2026-11-02" }).weeks, 24)
})

test("sessions a week", () => {
  assert.equal(sessionsPerWeek(16, 4), "4")
  assert.equal(sessionsPerWeek(7, 2), "3.5")
  assert.equal(sessionsPerWeek(10, 3), "3.3")
  assert.equal(sessionsPerWeek(0, 4), "0")
  assert.equal(sessionsPerWeek(4, 0), "0")
})

test("the outline lists every week in day order, with weekdays when the start weekday is known", () => {
  const structure = templateStructureFromPlan(samplePlan())
  const outline = templateOutline(structure, 2, 1)
  assert.equal(outline.length, 2)
  assert.equal(outline[0].focus, "Base")
  assert.equal(outline[0].sessions[0].dayLabel, "Mon")
  assert.equal(outline[0].sessions[0].title, "Gym")
  assert.match(outline[0].sessions[0].lines[0], /^Strength: Full rest \| Back squat 4 x 4 @ 80% \| Plank/)
  assert.equal(outline[1].sessions[0].dayLabel, "Thu")
  assert.equal(outline[1].sessions[0].title, "Track session")
  assert.equal(templateOutline(structure, 2, null)[1].sessions[0].dayLabel, "Day 4")
  assert.equal(templateOutline(structure, 2, 5)[1].sessions[0].dayLabel, "Mon")
  assert.equal(templateOutline({ version: 1, weekFocus: {}, sessions: [] }, 3, null).every((week) => week.sessions.length === 0 && week.focus === null), true)
})

test("weekday of a date", () => {
  assert.equal(weekdayOfIso("2026-01-05"), 1)
  assert.equal(weekdayOfIso("2026-10-11"), 0)
  assert.equal(weekdayOfIso(""), null)
  assert.equal(weekdayOfIso("not a date"), null)
})

test("template details are checked", () => {
  const base = { name: "Sprint prep", description: "", phase: null, eventGroup: null }
  assert.equal(validateTemplateDetails(base), null)
  assert.equal(validateTemplateDetails({ ...base, name: "   " }), "Give the template a name.")
  assert.match(validateTemplateDetails({ ...base, name: "x".repeat(81) }) ?? "", /under 80/)
  assert.match(validateTemplateDetails({ ...base, description: "x".repeat(501) }) ?? "", /under 500/)
  assert.equal(copyName("Sprint prep"), "Sprint prep (copy)")
  assert.equal(copyName("x".repeat(80)).length, 80)
})

function summary(partial: Partial<PlanTemplateSummary>): PlanTemplateSummary {
  return {
    id: "x",
    name: "Template",
    description: "",
    phase: null,
    eventGroup: null,
    weeks: 4,
    sessionCount: 12,
    startWeekday: 1,
    createdByUserId: "u1",
    createdByName: "Dana Brooks",
    archived: false,
    lastUsedAt: null,
    updatedAt: null,
    canManage: false,
    ...partial,
  }
}

test("search and tag filters", () => {
  const list = [
    summary({ id: "a", name: "Sprint general prep", phase: "general-prep", eventGroup: "Sprint", lastUsedAt: "2026-09-01T00:00:00Z" }),
    summary({ id: "b", name: "Throws taper", description: "Before the main meet", phase: "taper", eventGroup: "Throws" }),
    summary({ id: "c", name: "Jumps comp week", phase: "competition", eventGroup: "Jumps", lastUsedAt: "2026-10-01T00:00:00Z", createdByName: "Ada Admin" }),
    summary({ id: "d", name: "Old block", archived: true }),
  ]
  const all = { query: "", phase: "all" as const, eventGroup: "all" as const, archived: false }
  assert.deepEqual(filterTemplates(list, all).map((entry) => entry.id), ["c", "a", "b"])
  assert.deepEqual(filterTemplates(list, { ...all, archived: true }).map((entry) => entry.id), ["d"])
  assert.deepEqual(filterTemplates(list, { ...all, query: "  TAPER " }).map((entry) => entry.id), ["b"])
  assert.deepEqual(filterTemplates(list, { ...all, query: "main meet" }).map((entry) => entry.id), ["b"])
  assert.deepEqual(filterTemplates(list, { ...all, query: "ada" }).map((entry) => entry.id), ["c"])
  assert.deepEqual(filterTemplates(list, { ...all, phase: "general-prep" }).map((entry) => entry.id), ["a"])
  assert.deepEqual(filterTemplates(list, { ...all, eventGroup: "Throws" }).map((entry) => entry.id), ["b"])
  assert.deepEqual(filterTemplates(list, { ...all, phase: "taper", eventGroup: "Sprint" }), [])
})

test("last used in words", () => {
  const now = new Date(2026, 9, 5, 15, 0, 0)
  assert.equal(formatLastUsed(null, now), "Not used yet")
  assert.equal(formatLastUsed("rubbish", now), "Not used yet")
  assert.equal(formatLastUsed(new Date(2026, 9, 5, 8, 0, 0).toISOString(), now), "Used today")
  assert.equal(formatLastUsed(new Date(2026, 9, 4, 23, 0, 0).toISOString(), now), "Used yesterday")
  assert.equal(formatLastUsed(new Date(2026, 9, 2, 8, 0, 0).toISOString(), now), "Used 3 days ago")
  assert.equal(formatLastUsed(new Date(2026, 2, 12, 8, 0, 0).toISOString(), now), "Used 12 Mar 2026")
})
