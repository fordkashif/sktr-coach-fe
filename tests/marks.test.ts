import test from "node:test"
import assert from "node:assert/strict"
import {
  compareValueFor,
  describeDifference,
  eventGroupKey,
  findResultEvent,
  formatMark,
  formatMarkWithUnit,
  formatWind,
  groupResultsByEvent,
  isWindLegal,
  parseMarkInput,
  parseWindInput,
  resolveEventByName,
  seasonFor,
  selectBests,
  standingsOverTime,
  verdictForNewResult,
  type AthleteResult,
  type MarkUnit,
  type Timing,
} from "../src/lib/data/pr/marks"

let counter = 0
function result(eventKey: string, value: number, date: string, extra: Partial<AthleteResult> = {}): AthleteResult {
  const event = findResultEvent(eventKey)
  const unit: MarkUnit = extra.unit ?? event?.unit ?? "s"
  const timing: Timing | null = extra.timing ?? null
  const wind = extra.wind ?? null
  counter += 1
  return {
    id: `r${counter}`,
    athleteId: "a1",
    eventKey,
    eventLabel: event?.name ?? "Other",
    eventGroup: eventGroupKey(eventKey, extra.eventLabel ?? event?.name ?? "Other"),
    unit,
    lowerIsBetter: event?.lowerIsBetter ?? unit === "s",
    value,
    compareValue: compareValueFor(value, timing, event),
    display: formatMark(value, unit, timing),
    timing,
    date,
    source: "manual",
    competitionId: null,
    competitionEntryId: null,
    testResultId: null,
    place: null,
    wind,
    windLegal: isWindLegal(wind),
    environment: "outdoor",
    altitude: false,
    location: null,
    notes: null,
    enteredByUserId: null,
    createdAt: `2026-01-01T00:00:${String(counter).padStart(2, "0")}.000Z`,
    ...extra,
  }
}

const SEASON_2026 = { start: "2026-01-01", end: "2026-12-31" }

test("times: seconds, minutes and hours are read", () => {
  assert.deepEqual(parseMarkInput("10.84", "s"), { ok: true, value: 10.84 })
  assert.deepEqual(parseMarkInput("10,84", "s"), { ok: true, value: 10.84 })
  assert.deepEqual(parseMarkInput(" 1:52.30 ", "s"), { ok: true, value: 112.3 })
  assert.deepEqual(parseMarkInput("2:45:30", "s"), { ok: true, value: 9930 })
  assert.deepEqual(parseMarkInput("59.9", "s"), { ok: true, value: 59.9 })
})

test("times: bad shapes are refused with a reason", () => {
  for (const bad of ["", "abc", "10.845", "1:5.30", "1:75.00", "1::20", "-10.2", "0", "2:61:00", "10.84s"]) {
    const parsed = parseMarkInput(bad, "s")
    assert.equal(parsed.ok, false, `"${bad}" should be refused`)
  }
  const thousandths = parseMarkInput("10.845", "s")
  assert.equal(thousandths.ok === false && thousandths.message.includes("hundredths"), true)
})

test("distances, weights, heights and points", () => {
  assert.deepEqual(parseMarkInput("7.42", "m"), { ok: true, value: 7.42 })
  assert.deepEqual(parseMarkInput("7,4", "m"), { ok: true, value: 7.4 })
  assert.equal(parseMarkInput("7.425", "m").ok, false)
  assert.deepEqual(parseMarkInput("182.5", "kg"), { ok: true, value: 182.5 })
  assert.deepEqual(parseMarkInput("72", "cm"), { ok: true, value: 72 })
  assert.deepEqual(parseMarkInput("5420", "pts"), { ok: true, value: 5420 })
  assert.equal(parseMarkInput("5420.5", "pts").ok, false)
  assert.equal(parseMarkInput("0", "m").ok, false)
})

test("marks are written the way a results sheet writes them", () => {
  assert.equal(formatMark(10.84, "s"), "10.84")
  assert.equal(formatMark(10.8, "s"), "10.80")
  assert.equal(formatMark(10.6, "s", "hand"), "10.6h")
  assert.equal(formatMark(112.3, "s"), "1:52.30")
  assert.equal(formatMark(65.05, "s"), "1:05.05")
  assert.equal(formatMark(9930, "s"), "2:45:30")
  assert.equal(formatMark(7.4, "m"), "7.40")
  assert.equal(formatMark(185, "kg"), "185")
  assert.equal(formatMark(182.5, "kg"), "182.5")
  assert.equal(formatMark(5420, "pts"), "5420")
  assert.equal(formatMarkWithUnit("10.84", "s"), "10.84s")
  assert.equal(formatMarkWithUnit("1:52.30", "s"), "1:52.30")
  assert.equal(formatMarkWithUnit("7.42", "m"), "7.42m")
  assert.equal(formatMarkWithUnit("5420", "pts"), "5420 pts")
})

test("wind: sign, one decimal, legal up to +2.0", () => {
  assert.deepEqual(parseWindInput("+1.2"), { ok: true, value: 1.2 })
  assert.deepEqual(parseWindInput("-0.4"), { ok: true, value: -0.4 })
  assert.deepEqual(parseWindInput("2"), { ok: true, value: 2 })
  assert.deepEqual(parseWindInput(""), { ok: true, value: null })
  assert.equal(parseWindInput("1.25").ok, false)
  assert.equal(parseWindInput("12.0").ok, false)
  assert.equal(parseWindInput("windy").ok, false)
  assert.equal(formatWind(1.2), "+1.2")
  assert.equal(formatWind(-0.3), "-0.3")
  assert.equal(formatWind(0), "0.0")
  assert.equal(formatWind(null), "")
  assert.equal(isWindLegal(2.0), true)
  assert.equal(isWindLegal(2.1), false)
  assert.equal(isWindLegal(-3.5), true)
  assert.equal(isWindLegal(null), true)
})

test("the event list knows direction, units and where wind applies", () => {
  const windEvents = ["100m", "200m", "100m_hurdles", "110m_hurdles", "long_jump", "triple_jump"]
  for (const key of windEvents) assert.equal(findResultEvent(key)?.windApplies, true, key)
  for (const key of ["400m", "800m", "high_jump", "shot_put", "60m", "decathlon"]) assert.equal(findResultEvent(key)?.windApplies, false, key)
  assert.equal(findResultEvent("100m")?.lowerIsBetter, true)
  assert.equal(findResultEvent("long_jump")?.lowerIsBetter, false)
  assert.equal(findResultEvent("long_jump")?.unit, "m")
  assert.equal(findResultEvent("heptathlon")?.unit, "pts")
  assert.equal(findResultEvent("back_squat")?.unit, "kg")
  assert.equal(findResultEvent("nope"), null)
})

test("test names land on listed events only when the unit fits", () => {
  assert.equal(resolveEventByName("100 m", "s").eventKey, "100m")
  assert.equal(resolveEventByName("Long Jump", "m").eventKey, "long_jump")
  assert.deepEqual(resolveEventByName("High jump", "cm"), { eventKey: "high_jump", label: "High jump", unit: "m", lowerIsBetter: false, factor: 0.01 })
  assert.equal(resolveEventByName("100m", "kg").eventKey, "other")
  const other = resolveEventByName("  Flying   30m ", "s")
  assert.deepEqual(other, { eventKey: "other", label: "Flying 30m", unit: "s", lowerIsBetter: true, factor: 1 })
  assert.equal(eventGroupKey("other", " Flying  30M "), "o:flying 30m")
  assert.equal(eventGroupKey("100m", "anything"), "k:100m")
})

test("timed event: the lowest legal time is the personal best", () => {
  const history = [
    result("100m", 11.42, "2026-04-10", { wind: 1.2 }),
    result("100m", 11.3, "2026-05-02", { wind: 2.6 }),
    result("100m", 11.36, "2026-06-01", { wind: 0.4 }),
    result("100m", 11.1, "2025-07-20"),
  ]
  const bests = selectBests(history, SEASON_2026)
  assert.equal(bests.personalBest?.value, 11.1)
  assert.equal(bests.seasonBest?.value, 11.36)
  // 11.30 with +2.6 is slower than the personal best, so it is not worth showing apart.
  assert.equal(bests.windAssistedBest, null)
})

test("a wind assisted mark better than the personal best is shown apart and never becomes the best", () => {
  const history = [result("100m", 11.42, "2026-04-10", { wind: 1.2 }), result("100m", 11.3, "2026-05-02", { wind: 2.6 })]
  const bests = selectBests(history, SEASON_2026)
  assert.equal(bests.personalBest?.value, 11.42)
  assert.equal(bests.seasonBest?.value, 11.42)
  assert.equal(bests.windAssistedBest?.value, 11.3)
})

test("field event: the furthest legal mark is the personal best", () => {
  const history = [
    result("long_jump", 6.8, "2025-08-01", { wind: 1.1 }),
    result("long_jump", 6.95, "2026-05-01", { wind: 0.5 }),
    result("long_jump", 7.1, "2026-05-01", { wind: 3.1 }),
    result("long_jump", 6.6, "2026-06-01", { wind: 0 }),
  ]
  const bests = selectBests(history, SEASON_2026)
  assert.equal(bests.personalBest?.value, 6.95)
  assert.equal(bests.seasonBest?.value, 6.95)
  assert.equal(bests.windAssistedBest?.value, 7.1)
})

test("season boundaries: the club season when today is inside it, otherwise the calendar year", () => {
  assert.deepEqual(seasonFor("2026-10-05"), { start: "2026-01-01", end: "2026-12-31" })
  assert.deepEqual(seasonFor("2026-10-05", { start: "2026-09-01", end: "2027-08-31" }), { start: "2026-09-01", end: "2027-08-31" })
  assert.deepEqual(seasonFor("2026-10-05", { start: "2025-01-15", end: "2025-12-15" }), { start: "2026-01-01", end: "2026-12-31" })

  const history = [result("400m", 49.8, "2026-08-31"), result("400m", 50.4, "2026-09-01"), result("400m", 50.1, "2027-08-31"), result("400m", 49.0, "2027-09-01")]
  const bests = selectBests(history, { start: "2026-09-01", end: "2027-08-31" })
  assert.equal(bests.seasonBest?.value, 50.1)
  assert.equal(bests.personalBest?.value, 49.0)
  assert.equal(selectBests(history, { start: "2030-01-01", end: "2030-12-31" }).seasonBest, null)
})

test("hand times are ranked with the adjustment and written with an h", () => {
  const hand = result("100m", 10.9, "2026-05-01", { timing: "hand" })
  const electronic = result("100m", 11.1, "2026-05-02")
  assert.equal(hand.compareValue, 11.14)
  assert.equal(hand.display, "10.9h")
  assert.equal(selectBests([hand, electronic], SEASON_2026).personalBest?.id, electronic.id)
  assert.equal(compareValueFor(49.8, "hand", findResultEvent("400m")), 49.94)
  assert.equal(compareValueFor(120.5, "hand", findResultEvent("800m")), 120.5)
})

test("equal marks: the one set first keeps the record", () => {
  const first = result("high_jump", 1.85, "2026-03-01")
  const second = result("high_jump", 1.85, "2026-06-01")
  assert.equal(selectBests([second, first], SEASON_2026).personalBest?.id, first.id)
})

test("what a new result means", () => {
  const old = result("100m", 11.42, "2026-04-10")
  const pb = result("100m", 11.3, "2026-06-10")
  assert.deepEqual(verdictForNewResult(pb, [old, pb], SEASON_2026), { kind: "personal-best", beat: old })

  const lastYear = result("100m", 11.0, "2025-06-10")
  const seasonMark = result("100m", 11.2, "2026-07-10")
  assert.equal(verdictForNewResult(seasonMark, [old, pb, lastYear, seasonMark], SEASON_2026).kind, "season-best")

  const first = result("200m", 23.1, "2026-05-01")
  assert.equal(verdictForNewResult(first, [first], SEASON_2026).kind, "first")

  const windy = result("100m", 10.9, "2026-07-11", { wind: 3.4 })
  assert.equal(verdictForNewResult(windy, [old, pb, windy], SEASON_2026).kind, "wind-assisted")

  const slower = result("100m", 11.6, "2026-07-12")
  assert.equal(verdictForNewResult(slower, [old, pb, slower], SEASON_2026).kind, "none")
})

test("standing of each mark on the day it was set", () => {
  const a = result("100m", 11.5, "2025-05-01")
  const b = result("100m", 11.3, "2025-07-01")
  const c = result("100m", 11.4, "2026-04-01")
  const d = result("100m", 11.2, "2026-05-01", { wind: 2.4 })
  const e = result("100m", 11.45, "2026-06-01")
  const standings = standingsOverTime([e, d, c, b, a])
  assert.equal(standings.get(a.id), "personal-best")
  assert.equal(standings.get(b.id), "personal-best")
  assert.equal(standings.get(c.id), "season-best")
  assert.equal(standings.get(d.id), "wind-assisted")
  assert.equal(standings.get(e.id), null)
})

test("differences are worded for the event", () => {
  assert.deepEqual(describeDifference(result("100m", 11.3, "2026-06-10"), result("100m", 11.42, "2026-04-10")), { text: "0.12s faster", improved: true })
  assert.deepEqual(describeDifference(result("long_jump", 6.95, "2026-06-10"), result("long_jump", 6.8, "2026-04-10")), { text: "0.15m further", improved: true })
  assert.deepEqual(describeDifference(result("high_jump", 1.8, "2026-06-10"), result("high_jump", 1.85, "2026-04-10")), { text: "0.05m lower", improved: false })
  assert.deepEqual(describeDifference(result("back_squat", 185, "2026-06-10"), result("back_squat", 180, "2026-04-10")), { text: "5kg more", improved: true })
  assert.equal(describeDifference(result("100m", 11.3, "2026-06-10"), result("100m", 11.3, "2026-04-10")), null)
})

test("history is grouped per event in event list order", () => {
  const groups = groupResultsByEvent(
    [
      result("back_squat", 180, "2026-02-01"),
      result("long_jump", 6.8, "2026-03-01"),
      result("100m", 11.4, "2026-04-01"),
      result("100m", 11.3, "2026-05-01"),
      result("other", 4.05, "2026-03-02", { eventLabel: "30m", unit: "s" }),
    ],
    SEASON_2026,
  )
  assert.deepEqual(groups.map((group) => group.label), ["100m", "Long jump", "Back squat", "30m"])
  assert.deepEqual(groups.map((group) => group.category), ["Sprints", "Jumps", "Strength", "Tests"])
  assert.equal(groups[0].results[0].value, 11.3)
  assert.equal(groups[0].bests.personalBest?.value, 11.3)
})
