import test from "node:test"
import assert from "node:assert/strict"
import {
  athleteLoadSummary,
  buildAthleteLoad,
  cleanMinutes,
  daysUntilRatio,
  loadBand,
  loadRatio,
  mondayOf,
  noBandReason,
  sessionLoad,
  sortLoadRows,
  type DoneSession,
  type PlannedSession,
} from "../src/lib/data/load/training-load"

/**
 * The same hand-worked example as the database test of training_load_weeks()
 * (as of Wednesday 30 September 2026). Change one, change the other.
 */
const AS_OF = "2026-09-30"
const A1: DoneSession[] = [
  { date: "2026-08-31", effort: 5, minutes: 60 }, // 300
  { date: "2026-09-02", effort: 6, minutes: 50 }, // 300
  // week of 7 September: nothing
  { date: "2026-09-15", effort: 7, minutes: 60 }, // 420
  { date: "2026-09-17", effort: 6, minutes: null }, // no minutes: no load
  { date: "2026-09-22", effort: 4, minutes: 45 }, // 180
  { date: "2026-09-23", effort: null, minutes: 45 }, // no effort: no load
  { date: "2026-09-25", effort: 8, minutes: 90 }, // 720
  { date: "2026-09-29", effort: 7, minutes: 60 }, // 420
  { date: "2026-09-30", effort: 9, minutes: 40 }, // 360
  { date: "2026-10-01", effort: 5, minutes: 60 }, // after the as-of day: ignored
]
const A1_PLANNED: PlannedSession[] = [
  { date: "2026-09-29", minutes: 60, effort: 6 }, // 360
  { date: "2026-09-30", minutes: 45, effort: null }, // no intended effort: left out
  { date: "2026-10-02", minutes: 50, effort: 8 }, // 400
]
const A2: DoneSession[] = ["2026-08-20", "2026-08-27", "2026-09-03", "2026-09-10", "2026-09-17"].map((date) => ({ date, effort: 5, minutes: 60 }))

function week(load: ReturnType<typeof buildAthleteLoad>, weekStart: string) {
  const found = load.weeks.find((entry) => entry.weekStart === weekStart)
  assert.ok(found, `week ${weekStart} is there`)
  return found
}

test("session load is effort x minutes, and nothing when either is missing", () => {
  assert.equal(sessionLoad(7, 60), 420)
  assert.equal(sessionLoad(10, 1), 10)
  assert.equal(sessionLoad(null, 60), null)
  assert.equal(sessionLoad(7, null), null)
  assert.equal(sessionLoad(7, 0), null)
  assert.equal(sessionLoad(0, 60), null)
  assert.equal(sessionLoad(11, 60), null)
  assert.equal(sessionLoad(undefined, undefined), null)
})

test("minutes typed by a person", () => {
  assert.equal(cleanMinutes("75"), 75)
  assert.equal(cleanMinutes(" 60 "), 60)
  assert.equal(cleanMinutes(""), null)
  assert.equal(cleanMinutes("0"), null)
  assert.equal(cleanMinutes("601"), null)
  assert.equal(cleanMinutes("abc"), null)
  assert.equal(cleanMinutes(600), 600)
})

test("weeks start on Monday", () => {
  assert.equal(mondayOf("2026-09-30"), "2026-09-28")
  assert.equal(mondayOf("2026-09-28"), "2026-09-28")
  assert.equal(mondayOf("2026-10-04"), "2026-09-28")
  assert.equal(mondayOf("2026-10-05"), "2026-10-05")
})

test("twelve weeks, oldest first, ending on the week of the as-of day", () => {
  const load = buildAthleteLoad(A1, A1_PLANNED, AS_OF, 12)
  assert.equal(load.weeks.length, 12)
  assert.equal(load.weeks[11].weekStart, "2026-09-28")
  assert.equal(load.weeks[0].weekStart, "2026-07-13")
  assert.equal(load.firstLoadOn, "2026-08-31")
  assert.equal(buildAthleteLoad(A1, [], AS_OF, 500).weeks.length, 52)
})

test("the running week: weekly, acute, chronic and ratio", () => {
  const now = week(buildAthleteLoad(A1, A1_PLANNED, AS_OF), "2026-09-28")
  assert.equal(now.load, 780) // 420 + 360, the session on 1 October is in the future
  assert.equal(now.sessionsWithLoad, 2)
  assert.equal(now.acute, 1500) // 24 to 30 Sep: 720 + 420 + 360
  assert.equal(now.chronic, 525) // 3 to 30 Sep: 2100, divided by 4
  assert.equal(now.ratio, 2.86) // 1500 / 525 = 2.857
  assert.equal(now.planned, 760) // 60x6 + 50x8, the one with no intended effort left out
  assert.equal(loadBand(now.ratio), "well-above")
})

test("a finished week uses its Sunday", () => {
  const last = week(buildAthleteLoad(A1, A1_PLANNED, AS_OF), "2026-09-21")
  assert.equal(last.load, 900)
  assert.equal(last.sessionsWithLoad, 2)
  assert.equal(last.sessionsWithoutLoad, 1) // the one with no effort
  assert.equal(last.acute, 900)
  assert.equal(last.chronic, 480) // 31 Aug to 27 Sep: 1920 / 4
  assert.equal(last.ratio, 1.88) // first load exactly 28 days back, so the ratio is shown
  assert.equal(last.planned, null)
})

test("the running day counts once a session is finished on it, otherwise the days end yesterday", () => {
  // Monday 28 September, nothing finished yet: the same 7 and 28 days as last week's Sunday.
  const monday = week(buildAthleteLoad(A1, [], "2026-09-28"), "2026-09-28")
  assert.deepEqual([monday.load, monday.acute, monday.chronic, monday.ratio], [0, 900, 480, 1.88])
  // Tuesday 29 September, a session finished that day: 23 to 29 Sep is 720 + 420, 2 to 29 Sep is 2040.
  const tuesday = week(buildAthleteLoad(A1, [], "2026-09-29"), "2026-09-28")
  assert.deepEqual([tuesday.load, tuesday.acute, tuesday.chronic, tuesday.ratio], [420, 1140, 510, 2.24])
  // A finished session with no load still means the day has started.
  const noLoad = week(buildAthleteLoad([...A2, { date: "2026-09-30", effort: 5, minutes: null }], [], AS_OF), "2026-09-28")
  assert.deepEqual([noLoad.acute, noLoad.chronic], [0, 225])
  const waiting = week(buildAthleteLoad(A2, [], "2026-09-24"), "2026-09-21")
  assert.deepEqual([waiting.acute, waiting.chronic, waiting.ratio], [300, 300, 1]) // ends on the 23rd: 17 Sep is still inside
})

test("no ratio before 4 weeks of history, a session with no minutes adds nothing", () => {
  const load = buildAthleteLoad(A1, A1_PLANNED, AS_OF)
  const mid = week(load, "2026-09-14")
  assert.equal(mid.load, 420)
  assert.equal(mid.sessionsWithLoad, 1)
  assert.equal(mid.sessionsWithoutLoad, 1)
  assert.equal(mid.chronic, 255) // 1020 / 4, still worked out
  assert.equal(mid.ratio, null)
})

test("a week with no sessions is a week of zero, not a missing week", () => {
  const load = buildAthleteLoad(A1, A1_PLANNED, AS_OF)
  const empty = week(load, "2026-09-07")
  assert.deepEqual([empty.load, empty.acute, empty.sessionsWithLoad, empty.sessionsWithoutLoad, empty.ratio], [0, 0, 0, 0, null])
  assert.equal(empty.chronic, 150)
  assert.equal(week(load, "2026-08-31").load, 600)
  const before = week(load, "2026-08-24")
  assert.deepEqual([before.load, before.chronic, before.ratio], [0, 0, null])
})

test("two weeks off after steady training: ratio 0, well below usual", () => {
  const load = buildAthleteLoad(A2, [], AS_OF)
  const now = week(load, "2026-09-28")
  assert.deepEqual([now.acute, now.chronic, now.ratio], [0, 225, 0])
  assert.equal(loadBand(now.ratio), "well-below")
  const steady = week(load, "2026-09-14")
  assert.deepEqual([steady.acute, steady.chronic, steady.ratio], [300, 300, 1])
  assert.equal(loadBand(steady.ratio), "usual")
})

test("nothing logged at all", () => {
  const load = buildAthleteLoad([], [], AS_OF)
  assert.equal(load.firstLoadOn, null)
  assert.ok(load.weeks.every((entry) => entry.load === 0 && entry.ratio === null && entry.planned === null))
  assert.equal(noBandReason(load, AS_OF), "No load recorded")
  assert.match(athleteLoadSummary(load, AS_OF), /No load recorded yet/)
})

test("only sessions with no load: still no load, never guessed", () => {
  const load = buildAthleteLoad([{ date: "2026-09-29", effort: 7, minutes: null }], [], AS_OF)
  const now = week(load, "2026-09-28")
  assert.deepEqual([now.load, now.sessionsWithoutLoad, now.ratio], [0, 1, null])
  assert.equal(load.firstLoadOn, null)
})

test("the bands and their edges", () => {
  assert.equal(loadBand(null), null)
  assert.equal(loadBand(0), "well-below")
  assert.equal(loadBand(0.79), "well-below")
  assert.equal(loadBand(0.8), "usual")
  assert.equal(loadBand(1), "usual")
  assert.equal(loadBand(1.3), "usual")
  assert.equal(loadBand(1.31), "above")
  assert.equal(loadBand(1.5), "above")
  assert.equal(loadBand(1.51), "well-above")
})

test("the ratio is rounded to 2 places from whole sums", () => {
  assert.equal(loadRatio(1500, 2100), 2.86)
  assert.equal(loadRatio(900, 1920), 1.88)
  assert.equal(loadRatio(0, 900), 0)
  assert.equal(loadRatio(100, 0), null)
  assert.equal(loadRatio(300, 1200), 1)
  // 13 / 40 = 0.325 exactly: half rounds up, as in the database.
  assert.equal(loadRatio(13, 160), 0.33)
})

test("how long until the ratio shows", () => {
  assert.equal(daysUntilRatio(null, AS_OF), 28)
  assert.equal(daysUntilRatio("2026-09-30", AS_OF), 27)
  assert.equal(daysUntilRatio("2026-09-04", AS_OF), 1)
  assert.equal(daysUntilRatio("2026-09-03", AS_OF), 0)
  assert.equal(daysUntilRatio("2026-01-01", AS_OF), 0)
  const fresh = buildAthleteLoad([{ date: "2026-09-21", effort: 5, minutes: 60 }], [], AS_OF)
  assert.equal(noBandReason(fresh, AS_OF), "Needs 18 more days")
  const stale = buildAthleteLoad([{ date: "2026-07-01", effort: 5, minutes: 60 }], [], AS_OF)
  assert.equal(noBandReason(stale, AS_OF), "No load in 4 weeks")
})

test("the athlete's line is calm in every band", () => {
  const lines = [
    athleteLoadSummary(buildAthleteLoad(A1, [], AS_OF), AS_OF),
    athleteLoadSummary(buildAthleteLoad(A2, [], AS_OF), AS_OF),
    athleteLoadSummary(buildAthleteLoad(A2, [], "2026-09-20"), "2026-09-20"),
    athleteLoadSummary(buildAthleteLoad([{ date: "2026-09-29", effort: 5, minutes: 60 }], [], AS_OF), AS_OF),
  ]
  assert.match(lines[0], /a lot more than your usual week/)
  assert.match(lines[1], /lighter than your usual week/)
  assert.match(lines[2], /in line with your usual week/)
  assert.match(lines[3], /^300 so far this week/)
  const emDash = String.fromCharCode(0x2014)
  for (const line of lines) {
    assert.doesNotMatch(line, /risk|injur|danger|warning|too much/i)
    assert.ok(!line.includes(emDash))
  }
})

test("team table order: well above first, unavailable athletes last and not flagged", () => {
  const rows = sortLoadRows([
    { name: "Usual", band: "usual" as const, unavailable: false },
    { name: "None", band: null, unavailable: false },
    { name: "Injured high", band: "well-above" as const, unavailable: true },
    { name: "Below", band: "well-below" as const, unavailable: false },
    { name: "Above", band: "above" as const, unavailable: false },
    { name: "Zed high", band: "well-above" as const, unavailable: false },
    { name: "Amy high", band: "well-above" as const, unavailable: false },
  ])
  assert.deepEqual(rows.map((row) => row.name), ["Amy high", "Zed high", "Above", "Below", "Usual", "None", "Injured high"])
})
