import test from "node:test"
import assert from "node:assert/strict"
import {
  buildAthleteReportSnapshot,
  cleanReportSections,
  DEFAULT_REPORT_SECTIONS,
  HEALTH_SECTIONS,
  includesHealth,
  isReportLinkToken,
  nextReportRange,
  readAthleteReportSnapshot,
  reportLinkPath,
  reportLinkState,
  reportRangeDays,
  reportRangeFor,
  reportRangeProblem,
  reportRangeText,
  reportWeeks,
  reportWeekStart,
  withReportSummary,
  type AthleteReportSource,
} from "../src/lib/data/reports/athlete-report"
import type { AthleteResult } from "../src/lib/data/pr/marks"

const TODAY = "2026-10-05"

function result(id: string, date: string, value: number, extra: Partial<AthleteResult> = {}): AthleteResult {
  return {
    id,
    athleteId: "a1",
    eventKey: "100m",
    eventLabel: "100m",
    eventGroup: "k:100m",
    unit: "s",
    lowerIsBetter: true,
    value,
    compareValue: value,
    display: value.toFixed(2),
    timing: null,
    date,
    source: "competition",
    competitionId: null,
    competitionEntryId: null,
    testResultId: null,
    place: null,
    wind: null,
    windLegal: true,
    environment: "outdoor",
    altitude: false,
    location: "City Meet",
    notes: "a note typed on the result",
    enteredByUserId: null,
    createdAt: `${date}T12:00:00Z`,
    ...extra,
  }
}

function source(): AthleteReportSource {
  return {
    club: { name: "Elite Track Club", shortName: "ETC", color: "#2152ff", logoUrl: null },
    athlete: { id: "a1", name: "Maya Chen", teamName: "Sprints", primaryEvent: "100m" },
    coachName: "Coach Rivera",
    sessions: [
      { id: "s1", isoDate: "2026-09-08", status: "completed", origin: "plan", durationMinutes: 60 },
      { id: "s2", isoDate: "2026-09-10", status: "scheduled", origin: "plan", durationMinutes: 45 },
      { id: "s3", isoDate: "2026-09-15", status: "skipped", origin: "plan", durationMinutes: 45 },
      { id: "s4", isoDate: "2026-09-22", status: "scheduled", origin: "plan", durationMinutes: 45 },
      { id: "s5", isoDate: "2026-09-23", status: "completed", origin: "athlete", durationMinutes: null },
      { id: "s6", isoDate: "2026-08-01", status: "completed", origin: "plan", durationMinutes: 60 },
    ],
    attendance: [
      { date: "2026-09-08", status: "present" },
      { date: "2026-09-10", status: "late" },
      { date: "2026-09-15", status: "absent" },
      { date: "2026-09-22", status: "excused" },
      { date: "2026-08-01", status: "absent" },
    ],
    availability: [{ kind: "injured", startsOn: "2026-09-21", endsOn: "2026-09-25" }],
    results: [result("r1", "2026-05-01", 11.5), result("r2", "2026-09-12", 11.3), result("r3", "2026-09-26", 11.4), result("r0", "2025-06-01", 11.2)],
    season: { start: "2026-01-01", end: "2026-12-31" },
    tests: [
      { name: "30m", value: "4.05s", previousValue: "4.10s", change: "up", submittedAt: "2026-09-20T10:00:00Z" },
      { name: "30m", value: "4.08s", previousValue: "4.10s", change: "up", submittedAt: "2026-09-12T10:00:00Z" },
      { name: "CMJ", value: "70cm", previousValue: null, change: null, submittedAt: "2026-03-01T10:00:00Z" },
    ],
    goals: [
      { id: "g1", athleteId: "a1", eventKey: "100m", eventLabel: "100m", eventGroup: "k:100m", unit: "s", lowerIsBetter: true, targetValue: 11.0, startValue: 11.5, targetDate: "2026-12-01", note: "private goal note", achievedOn: null, achievedResultId: null, achievedManually: false, setByStaff: true, createdAt: "2026-05-02T00:00:00Z" },
      { id: "g2", athleteId: "a1", eventKey: "200m", eventLabel: "200m", eventGroup: "k:200m", unit: "s", lowerIsBetter: true, targetValue: 23, startValue: null, targetDate: null, note: null, achievedOn: "2026-02-01", achievedResultId: null, achievedManually: true, setByStaff: false, createdAt: "2026-01-02T00:00:00Z" },
    ],
    wellness: [
      { date: "2026-09-09", readinessScore: 80, sleep: 8 },
      { date: "2026-09-10", readinessScore: 60, sleep: 7 },
      { date: "2026-07-01", readinessScore: 10, sleep: 4 },
    ],
    painReports: [
      { bodyAreas: ["left_hamstring"], severity: 3, startedOn: "2026-09-20", trainingImpact: "modified", note: "tight after starts", status: "open", resolvedAt: null, createdAt: "2026-09-21T08:00:00Z" },
      { bodyAreas: ["right_knee"], severity: 2, startedOn: "2026-06-01", trainingImpact: "none", note: null, status: "resolved", resolvedAt: "2026-06-10T08:00:00Z", createdAt: "2026-06-01T08:00:00Z" },
    ],
  }
}

const RANGE = { from: "2026-09-08", to: "2026-10-05" }

test("period maths: last 4 and 12 weeks include today", () => {
  assert.deepEqual(reportRangeFor("4w", TODAY), RANGE)
  assert.equal(reportRangeDays(reportRangeFor("4w", TODAY)), 28)
  assert.deepEqual(reportRangeFor("12w", TODAY), { from: "2026-07-14", to: TODAY })
  assert.equal(reportRangeDays(reportRangeFor("12w", TODAY)), 84)
})

test("period maths: this season runs from the season start to today, or to its end when that has passed", () => {
  assert.deepEqual(reportRangeFor("season", TODAY, { start: "2026-09-01", end: "2027-08-31" }), { from: "2026-09-01", to: TODAY })
  assert.deepEqual(reportRangeFor("season", TODAY, { start: "2025-09-01", end: "2026-08-31" }), { from: "2025-09-01", to: "2026-08-31" })
  // No season, or one that has not started: the calendar year so far.
  assert.deepEqual(reportRangeFor("season", TODAY, null), { from: "2026-01-01", to: TODAY })
  assert.deepEqual(reportRangeFor("season", TODAY, { start: "2026-11-01", end: "2027-08-31" }), { from: "2026-01-01", to: TODAY })
})

test("period maths: the next period has the same length and never passes today", () => {
  assert.deepEqual(nextReportRange({ from: "2026-08-01", to: "2026-08-28" }, TODAY), { from: "2026-08-29", to: "2026-09-25" })
  assert.deepEqual(nextReportRange({ from: "2026-08-25", to: "2026-09-21" }, TODAY), { from: "2026-09-22", to: TODAY })
  // The old period ended today: the same length ending today.
  assert.deepEqual(nextReportRange(RANGE, TODAY), RANGE)
})

test("period maths: problems with a custom range", () => {
  assert.equal(reportRangeProblem(RANGE, TODAY), null)
  assert.match(reportRangeProblem({ from: "2026-10-05", to: "2026-09-01" }, TODAY) ?? "", /after the last day/)
  assert.match(reportRangeProblem({ from: "2026-11-01", to: "2026-11-05" }, TODAY) ?? "", /not started/)
  assert.match(reportRangeProblem({ from: "2020-01-01", to: "2026-01-01" }, TODAY) ?? "", /two years/)
  assert.match(reportRangeProblem({ from: "", to: "2026-01-01" }, TODAY) ?? "", /Choose/)
})

test("period maths: weeks start on Monday and cover the range", () => {
  assert.equal(reportWeekStart("2026-10-05"), "2026-10-05")
  assert.equal(reportWeekStart("2026-10-04"), "2026-09-28")
  assert.deepEqual(reportWeeks(RANGE), ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"])
  assert.match(reportRangeText(RANGE), /^8 Sept? to 5 Oct 2026$/)
  assert.match(reportRangeText({ from: "2025-12-20", to: "2026-01-05" }), /2025 to 5 Jan 2026$/)
})

test("sections: health is off by default, the summary is always in, unknown keys are dropped", () => {
  assert.equal(includesHealth(DEFAULT_REPORT_SECTIONS), false)
  for (const key of HEALTH_SECTIONS) assert.equal(DEFAULT_REPORT_SECTIONS.includes(key), false)
  assert.deepEqual(cleanReportSections(["goals", "coachNotes", "notes", "attendance", "goals"]), ["summary", "attendance", "goals"])
  assert.deepEqual(cleanReportSections(null), ["summary"])
  assert.equal(includesHealth(cleanReportSections(["injuries"])), true)
})

test("snapshot: only the ticked sections are in it", () => {
  const snapshot = buildAthleteReportSnapshot(source(), { range: RANGE, sections: ["attendance", "results"], summary: "  Good block.  ", today: TODAY })
  assert.deepEqual(snapshot.sections, ["summary", "attendance", "results"])
  assert.equal(snapshot.summary, "Good block.")
  assert.ok(snapshot.attendance && snapshot.results)
  for (const key of ["training", "tests", "goals", "wellness", "injuries"]) assert.equal(key in snapshot, false, key)
  assert.equal(snapshot.athlete.name, "Maya Chen")
  assert.equal(snapshot.coachName, "Coach Rivera")
  assert.equal(snapshot.savedOn, TODAY)
})

test("snapshot: the default sections never carry health data, and no section carries notes", () => {
  const text = JSON.stringify(buildAthleteReportSnapshot(source(), { range: RANGE, sections: DEFAULT_REPORT_SECTIONS, summary: "", today: TODAY }))
  assert.equal(text.includes("wellness"), false)
  assert.equal(text.includes("injuries"), false)
  assert.equal(text.includes("hamstring"), false)
  assert.equal(text.includes("tight after starts"), false)
  // Free text typed elsewhere stays out: goal notes, notes on a result.
  assert.equal(text.includes("private goal note"), false)
  assert.equal(text.includes("a note typed on the result"), false)
  // "Injured" as a reason for excused sessions is health information too.
  assert.equal(/injured/i.test(text), false)
  assert.equal(/coachNote|coach_note/.test(text), false)
})

test("snapshot: adherence and attendance use the app's rules inside the period", () => {
  const { attendance } = buildAthleteReportSnapshot(source(), { range: RANGE, sections: ["attendance"], summary: "", today: TODAY })
  // s1 done, s2 missed, s3 skipped (excused), s4 inside the injured period (excused), s5 added by the athlete, s6 outside.
  assert.deepEqual(attendance?.adherence, { due: 2, done: 1, excused: 2, percent: 50 })
  assert.deepEqual(attendance?.marks, { attended: 2, counted: 3, percent: 67, present: 1, late: 1, absent: 1, excused: 1 })
})

test("snapshot: training by week", () => {
  const { training } = buildAthleteReportSnapshot(source(), { range: RANGE, sections: ["training"], summary: "", today: TODAY })
  assert.equal(training?.done, 2)
  assert.equal(training?.planned, 4)
  assert.equal(training?.minutes, 60)
  assert.deepEqual(training?.weeks.map((week) => [week.weekStart, week.planned, week.done]), [
    ["2026-09-07", 2, 1],
    ["2026-09-14", 1, 0],
    ["2026-09-21", 1, 1],
    ["2026-09-28", 0, 0],
    ["2026-10-05", 0, 0],
  ])
})

test("snapshot: results in the period with what they were on the day and the bests", () => {
  const { results } = buildAthleteReportSnapshot(source(), { range: RANGE, sections: ["results"], summary: "", today: TODAY })
  assert.equal(results?.rows.length, 2)
  assert.deepEqual(results?.rows.map((row) => [row.date, row.mark, row.standing, row.seasonBest, row.personalBest]), [
    ["2026-09-26", "11.40s", null, "11.30s", "11.20s"],
    ["2026-09-12", "11.30s", "season-best", "11.30s", "11.20s"],
  ])
  assert.equal(results?.more, 0)
})

test("snapshot: tests show the newest result of each test in the period with the change", () => {
  const { tests } = buildAthleteReportSnapshot(source(), { range: RANGE, sections: ["tests"], summary: "", today: TODAY })
  assert.deepEqual(tests?.rows, [{ name: "30m", value: "4.05s", previous: "4.10s", change: "better", changeText: "Better", date: "2026-09-20" }])
})

test("snapshot: tests fall back to test week marks in the results", () => {
  const data = source()
  data.tests = []
  data.results = [
    result("t1", "2026-03-01", 4.1, { eventKey: "other", eventLabel: "30m", eventGroup: "o:30m", source: "test_week" }),
    result("t2", "2026-09-20", 4.02, { eventKey: "other", eventLabel: "30m", eventGroup: "o:30m", source: "test_week" }),
  ]
  const { tests } = buildAthleteReportSnapshot(data, { range: RANGE, sections: ["tests"], summary: "", today: TODAY })
  assert.equal(tests?.rows.length, 1)
  assert.equal(tests?.rows[0].previous, "4.10s")
  assert.equal(tests?.rows[0].change, "better")
  assert.match(tests?.rows[0].changeText ?? "", /0\.08s faster/)
})

test("snapshot: goals show open goals and those reached in the period", () => {
  const { goals } = buildAthleteReportSnapshot(source(), { range: RANGE, sections: ["goals"], summary: "", today: TODAY })
  // g2 was reached before the period.
  assert.equal(goals?.rows.length, 1)
  assert.deepEqual(goals?.rows[0], { event: "100m", target: "11.00s", targetDate: "2026-12-01", current: "11.20s", percent: 60, state: "on-track", stateLabel: "On track" })
})

test("snapshot: health sections appear only when ticked, and only for the period", () => {
  const snapshot = buildAthleteReportSnapshot(source(), { range: RANGE, sections: ["wellness", "injuries"], summary: "", today: TODAY })
  assert.deepEqual(snapshot.wellness, { checkIns: 2, averageReadiness: 70, averageSleep: 7.5, points: [{ date: "2026-09-09", score: 80 }, { date: "2026-09-10", score: 60 }] })
  assert.equal(snapshot.injuries?.reports.length, 1)
  assert.match(snapshot.injuries?.reports[0].areas ?? "", /^left hamstring$/i)
  assert.equal(snapshot.injuries?.reports[0].resolved, false)
  assert.deepEqual(snapshot.injuries?.timeOut, [{ kind: "Injured", from: "2026-09-21", to: "2026-09-25" }])
  const onlyWellness = buildAthleteReportSnapshot(source(), { range: RANGE, sections: ["wellness"], summary: "", today: TODAY })
  assert.equal("injuries" in onlyWellness, false)
})

test("snapshot: changing the summary changes nothing else", () => {
  const snapshot = buildAthleteReportSnapshot(source(), { range: RANGE, sections: DEFAULT_REPORT_SECTIONS, summary: "One", today: TODAY })
  const next = withReportSummary(snapshot, " Two ")
  assert.equal(next.summary, "Two")
  assert.deepEqual({ ...next, summary: "" }, { ...snapshot, summary: "" })
})

test("reading a stored snapshot drops what does not belong", () => {
  const snapshot = buildAthleteReportSnapshot(source(), { range: RANGE, sections: ["attendance"], summary: "Hi", today: TODAY })
  const read = readAthleteReportSnapshot({ ...snapshot, coachNotes: [{ body: "secret" }], wellness: { checkIns: 3 }, extra: 1 })
  assert.ok(read)
  assert.equal(JSON.stringify(read).includes("secret"), false)
  assert.equal("wellness" in (read as object), false)
  assert.equal("extra" in (read as object), false)
  assert.deepEqual(read?.attendance, snapshot.attendance)
  assert.equal(readAthleteReportSnapshot(null), null)
  assert.equal(readAthleteReportSnapshot({ version: 2 }), null)
  assert.equal(readAthleteReportSnapshot({ version: 1, athlete: {}, period: {} }), null)
})

test("links: state, token shape and address", () => {
  const now = new Date("2026-10-05T12:00:00Z")
  assert.equal(reportLinkState({ expiresAt: "2026-11-04T12:00:00Z", revokedAt: null }, now), "active")
  assert.equal(reportLinkState({ expiresAt: "2026-10-05T11:59:00Z", revokedAt: null }, now), "expired")
  assert.equal(reportLinkState({ expiresAt: "2026-11-04T12:00:00Z", revokedAt: "2026-10-01T00:00:00Z" }, now), "revoked")
  assert.equal(isReportLinkToken("ab".repeat(32)), true)
  assert.equal(isReportLinkToken("AB".repeat(32)), false)
  assert.equal(isReportLinkToken("ab".repeat(31)), false)
  assert.equal(isReportLinkToken(null), false)
  assert.equal(reportLinkPath("ab".repeat(32)), `/shared/report#${"ab".repeat(32)}`)
})
