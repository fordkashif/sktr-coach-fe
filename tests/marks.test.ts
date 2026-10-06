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
  applyResultDetail,
  checkSplits,
  defaultSplitEvery,
  describeRound,
  detailKindsFor,
  eventDistance,
  formatAttempt,
  formatHeightLine,
  formatLapChange,
  headlineResult,
  parseAttemptInput,
  parseHeightLine,
  parseHeightSeries,
  parseReactionInput,
  roundSlot,
  seriesText,
  sortRounds,
  splitRows,
  splitsText,
  summariseHeights,
  summariseSeries,
  toLapSplits,
  toRunningSplits,
  type Attempt,
  type AthleteResult,
  type MarkUnit,
  type Timing,
} from "../src/lib/data/pr/marks"
import { relayLegOf, relayLegsText, relayTeamRecords, sameRelaySlot, validateRelayInput } from "../src/lib/data/competition/relay-logic"
import type { RelayEntry, RelayInput } from "../src/lib/data/competition/types"

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

/* ---------- Rounds, splits, attempt series and heights ---------- */

test("a height line is read the way it is written on the sheet", () => {
  assert.deepEqual(parseHeightLine("1.85 XO"), { ok: true, line: { height: 1.85, tries: "XO" } })
  assert.deepEqual(parseHeightLine(" 1,80  o "), { ok: true, line: { height: 1.8, tries: "O" } })
  assert.deepEqual(parseHeightLine("1.90m xxx"), { ok: true, line: { height: 1.9, tries: "XXX" } })
  // 0 for O and P for a pass are what people type on a phone.
  assert.deepEqual(parseHeightLine("4.20 x0"), { ok: true, line: { height: 4.2, tries: "XO" } })
  assert.deepEqual(parseHeightLine("1.95 p"), { ok: true, line: { height: 1.95, tries: "-" } })
  assert.deepEqual(parseHeightLine("1.95 X-"), { ok: true, line: { height: 1.95, tries: "X-" } })
  for (const bad of ["1.85", "XO", "1.85 OX", "1.85 XXXX", "1.85 OO", "1.855 O", "high O"]) {
    assert.equal(parseHeightLine(bad).ok, false, bad)
  }
  assert.equal(formatHeightLine({ height: 1.8, tries: "XO" }), "1.80 XO")
})

test("a whole high jump is read from one line of text", () => {
  const parsed = parseHeightSeries("1.80 O, 1.85 XO, 1.90 XXX")
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.ok && parsed.lines, [
    { height: 1.8, tries: "O" },
    { height: 1.85, tries: "XO" },
    { height: 1.9, tries: "XXX" },
  ])
  // A decimal comma inside a height is not a separator.
  const commas = parseHeightSeries("1,80 O; 1,85 XO")
  assert.deepEqual(commas.ok && commas.lines.map((line) => line.height), [1.8, 1.85])
  assert.equal(parseHeightSeries("1.80 O, nonsense").ok, false)
})

test("the highest cleared height is the mark, with the two tie-break counts", () => {
  const summary = summariseHeights([
    { height: 1.75, tries: "O" },
    { height: 1.8, tries: "XO" },
    { height: 1.85, tries: "XXO" },
    { height: 1.9, tries: "XXX" },
  ])
  assert.equal(summary.best, 1.85)
  assert.equal(summary.clearedOnAttempt, 3)
  assert.equal(summary.failuresAtBest, 2)
  // Failures up to and including the height last cleared: 1 at 1.80 and 2 at 1.85. The three at 1.90 do not count.
  assert.equal(summary.totalFailures, 3)
  assert.equal(summary.out, true)

  // Same height, fewer failures at it: this athlete is ahead on the first tie-break.
  const cleaner = summariseHeights([
    { height: 1.75, tries: "XXO" },
    { height: 1.8, tries: "-" },
    { height: 1.85, tries: "O" },
  ])
  assert.equal(cleaner.best, 1.85)
  assert.equal(cleaner.failuresAtBest, 0)
  assert.equal(cleaner.totalFailures, 2)
  assert.equal(cleaner.out, false)

  assert.equal(summariseHeights([{ height: 1.8, tries: "XXX" }]).best, null)
  // A pass after a failure carries the failure to the next height: X- then XX is three in a row.
  assert.equal(summariseHeights([{ height: 1.8, tries: "X-" }, { height: 1.85, tries: "XX" }]).out, true)
})

test("heights become the result: computed, checked, never typed twice", () => {
  const applied = applyResultDetail(
    { heights: [{ height: 1.8, tries: "o" }, { height: 1.85, tries: "xo" }, { height: 1.9, tries: "XXX" }] },
    { eventKey: "high_jump", unit: "m", windApplies: false, mark: 9.99 },
  )
  assert.ok(applied.ok)
  assert.equal(applied.ok && applied.mark, 1.85)
  assert.equal(applied.ok && applied.series, true)
  assert.deepEqual(applied.ok && applied.detail, { heights: [{ height: 1.8, tries: "O" }, { height: 1.85, tries: "XO" }, { height: 1.9, tries: "XXX" }] })

  const refuse = (heights: Array<{ height: number; tries: string }>) => {
    const result = applyResultDetail({ heights }, { eventKey: "pole_vault", unit: "m", windApplies: false, mark: null })
    return result.ok ? "accepted" : result.message
  }
  assert.match(refuse([{ height: 4, tries: "XXX" }]), /No height was cleared/)
  assert.match(refuse([{ height: 4, tries: "O" }, { height: 3.9, tries: "O" }]), /Heights go up/)
  assert.match(refuse([{ height: 4, tries: "O" }, { height: 4.1, tries: "XXX" }, { height: 4.2, tries: "O" }]), /three failures in a row/)
  assert.match(refuse([{ height: 4, tries: "OX" }]), /O, X and -/)
})

test("an attempt is a distance, a foul or a pass", () => {
  assert.deepEqual(parseAttemptInput("6.42"), { ok: true, attempt: { result: "mark", mark: 6.42 } })
  assert.deepEqual(parseAttemptInput("6,4"), { ok: true, attempt: { result: "mark", mark: 6.4 } })
  assert.deepEqual(parseAttemptInput("x"), { ok: true, attempt: { result: "foul" } })
  assert.deepEqual(parseAttemptInput("-"), { ok: true, attempt: { result: "pass" } })
  assert.deepEqual(parseAttemptInput(" "), { ok: true, attempt: null })
  assert.equal(parseAttemptInput("6.423").ok, false)
  assert.equal(parseAttemptInput("long").ok, false)
  assert.deepEqual(([{ result: "mark", mark: 6.4 }, { result: "foul" }, { result: "pass" }] as Attempt[]).map(formatAttempt), ["6.40", "X", "-"])
})

test("the best attempt is the result; the best wind legal attempt is named when the best was wind assisted", () => {
  const attempts: Attempt[] = [
    { result: "mark", mark: 6.42, wind: 1.1 },
    { result: "foul" },
    { result: "mark", mark: 6.71, wind: 2.9 },
    { result: "pass" },
    { result: "mark", mark: 6.6, wind: 0.4 },
    { result: "mark", mark: 6.55, wind: 2.0 },
  ]
  assert.deepEqual(summariseSeries(attempts), { bestIndex: 2, legalIndex: 4, measured: 4, fouls: 1, passes: 1 })

  const applied = applyResultDetail({ attempts }, { eventKey: "long_jump", unit: "m", windApplies: true, mark: null })
  assert.ok(applied.ok)
  assert.equal(applied.ok && applied.mark, 6.71)
  assert.equal(applied.ok && applied.wind, 2.9)
  assert.deepEqual(applied.ok && applied.legal, { mark: 6.6, wind: 0.4 })

  // A legal best needs no second mark. +2.0 exactly is legal.
  const legalBest = applyResultDetail({ attempts: [{ result: "mark", mark: 6.42, wind: 2.5 }, { result: "mark", mark: 6.71, wind: 2.0 }] }, { eventKey: "long_jump", unit: "m", windApplies: true, mark: null })
  assert.equal(legalBest.ok && legalBest.legal, null)
  assert.equal(legalBest.ok && legalBest.wind, 2)

  // Two equal jumps: the wind legal one is the result, so it counts.
  const tie = summariseSeries([{ result: "mark", mark: 6.5, wind: 2.5 }, { result: "mark", mark: 6.5, wind: 1 }])
  assert.deepEqual([tie.bestIndex, tie.legalIndex], [1, null])
  // Two equal legal jumps: the earlier.
  assert.equal(summariseSeries([{ result: "mark", mark: 6.5, wind: 0.5 }, { result: "mark", mark: 6.5, wind: 1 }]).bestIndex, 0)
  // No reading counts as legal, as for any result.
  assert.equal(summariseSeries([{ result: "mark", mark: 6.5 }, { result: "mark", mark: 6.4, wind: 3 }]).legalIndex, null)
  // Every measured attempt wind assisted: there is no legal mark to name.
  assert.equal(summariseSeries([{ result: "mark", mark: 6.5, wind: 2.4 }, { result: "mark", mark: 6.4, wind: 3 }]).legalIndex, null)
})

test("a series is checked in plain words and wind is kept only where it applies", () => {
  const message = (attempts: Attempt[]) => {
    const result = applyResultDetail({ attempts }, { eventKey: "shot_put", unit: "m", windApplies: false, mark: null })
    return result.ok ? "accepted" : result.message
  }
  assert.match(message([{ result: "foul" }, { result: "pass" }]), /no mark to save/)
  assert.match(message(Array.from({ length: 7 }, () => ({ result: "mark", mark: 12 }) as Attempt)), /six attempts at most/)
  const throwSeries = applyResultDetail({ attempts: [{ result: "mark", mark: 14.2, wind: 1.1 }, { result: "foul" }] }, { eventKey: "shot_put", unit: "m", windApplies: false, mark: null })
  assert.deepEqual(throwSeries.ok && throwSeries.detail, { attempts: [{ result: "mark", mark: 14.2 }, { result: "foul" }] })
  assert.equal(seriesText({ attempts: [{ result: "mark", mark: 6.42, wind: 1.1 }, { result: "foul" }, { result: "pass" }] }), "6.42 (+1.1); X; -")
  assert.equal(seriesText({ heights: [{ height: 1.8, tries: "O" }, { height: 1.85, tries: "XO" }] }), "1.80 O; 1.85 XO")
})

test("detail that does not belong to the event is dropped", () => {
  const sprint = applyResultDetail(
    { attempts: [{ result: "mark", mark: 6.4 }], heights: [{ height: 1.8, tries: "O" }], reaction: 0.1524 },
    { eventKey: "100m", unit: "s", windApplies: true, mark: 11.2 },
  )
  assert.deepEqual(sprint.ok && sprint.detail, { reaction: 0.152 })
  assert.equal(sprint.ok && sprint.series, false)
  assert.equal(sprint.ok && sprint.mark, 11.2)
  const jump = applyResultDetail({ splits: { every: 200, times: [24] }, reaction: 0.15 }, { eventKey: "long_jump", unit: "m", windApplies: true, mark: 6.4 })
  assert.equal(jump.ok && jump.detail, null)
  assert.deepEqual(detailKindsFor("400m", "s"), { splits: true, reaction: true, attempts: false, heights: false })
  assert.deepEqual(detailKindsFor("100m", "s"), { splits: false, reaction: true, attempts: false, heights: false })
  assert.deepEqual(detailKindsFor("1500m", "s"), { splits: true, reaction: false, attempts: false, heights: false })
  assert.deepEqual(detailKindsFor("discus", "m"), { splits: false, reaction: false, attempts: true, heights: false })
  assert.deepEqual(detailKindsFor("pole_vault", "m"), { splits: false, reaction: false, attempts: false, heights: true })
  assert.deepEqual(detailKindsFor("back_squat", "kg"), { splits: false, reaction: false, attempts: false, heights: false })
})

test("splits typed as running times or lap by lap are stored the same way", () => {
  // An 800m in 1:58.20: 400m in 57.90, typed either way.
  assert.deepEqual(toRunningSplits([28.4, 57.9, 88.1], "running"), [28.4, 57.9, 88.1])
  assert.deepEqual(toRunningSplits([28.4, 29.5, 30.2], "lap"), [28.4, 57.9, 88.1])
  assert.deepEqual(toLapSplits([28.4, 57.9, 88.1]), [28.4, 29.5, 30.2])
  assert.deepEqual(toLapSplits(toRunningSplits([61.02, 63.4, 64.11], "lap")), [61.02, 63.4, 64.11])
})

test("a split larger than the final time, or out of order, is refused in plain words", () => {
  assert.equal(checkSplits([24.1], 49.8), null)
  assert.equal(checkSplits([57.9, 121.5], 118.2), "Split 2 (2:01.50) is larger than the final time (1:58.20). A split cannot be larger than the final time.")
  assert.match(checkSplits([30, 25], 60) ?? "", /^Split 2 \(25\.00\) must be later than split 1 \(30\.00\)/)
  assert.equal(checkSplits([0], 60), "Split 1 must be more than 0.")
  const refused = applyResultDetail({ splits: { every: 400, times: [57.9, 121.5] } }, { eventKey: "800m", unit: "s", windApplies: false, mark: 118.2 })
  assert.equal(refused.ok ? "" : refused.message, "A split cannot be larger than the final time.")
  // A last split equal to the final time is the finish, so it is not kept as a split.
  const withFinish = applyResultDetail({ splits: { every: 200, times: [24.1, 49.8] } }, { eventKey: "400m", unit: "s", windApplies: false, mark: 49.8 })
  assert.deepEqual(withFinish.ok && withFinish.detail, { splits: { every: 200, times: [24.1] } })
  assert.equal(splitsText({ splits: { every: 400, times: [57.9, 88.1] } }), "57.90; 1:28.10")
})

test("the splits table shows each lap and how it compares with the one before", () => {
  const rows = splitRows({ every: 400, times: [61.02, 124.42, 188.53] }, 251.9, "1500m")
  assert.deepEqual(rows.map((row) => row.label), ["400m", "800m", "1200m", "Finish"])
  assert.deepEqual(rows.map((row) => row.lap), [61.02, 63.4, 64.11, 63.37])
  // The last 300m of a 1500m is not a full lap, so it is not compared with one.
  assert.deepEqual(rows.map((row) => row.change), [null, 2.38, 0.71, null])
  assert.deepEqual(rows.map((row) => row.finish), [false, false, false, true])

  const quarter = splitRows({ every: 200, times: [24.1] }, 49.8, "400m")
  assert.deepEqual(quarter.map((row) => [row.label, row.time, row.lap, row.change]), [
    ["200m", 24.1, 24.1, null],
    ["Finish", 49.8, 25.7, 1.6],
  ])
  // Without a regular distance the laps are listed but not compared.
  assert.deepEqual(splitRows({ every: null, times: [10, 25] }, 40, "other").map((row) => [row.label, row.change]), [["Split 1", null], ["Split 2", null], ["Finish", null]])
  assert.deepEqual([1.6, -0.31, 0, 61.5].map(formatLapChange), ["+1.60", "-0.31", "0.00", "+1:01.50"])
})

test("events know how far they are and where splits usually fall", () => {
  assert.deepEqual(["100m", "400m_hurdles", "mile", "5k_road", "20km_walk", "4x400m", "3000m_steeplechase", "long_jump", "other"].map(eventDistance), [100, 400, 1609, 5000, 20000, 1600, 3000, null, null])
  assert.deepEqual(["100m", "200m", "400m", "800m", "1500m", "5000m", "marathon"].map(defaultSplitEvery), [null, 100, 200, 400, 400, 1000, 5000])
})

test("a reaction time is seconds with three decimals, under a second", () => {
  assert.deepEqual(parseReactionInput("0.152"), { ok: true, value: 0.152 })
  assert.deepEqual(parseReactionInput(",15"), { ok: true, value: 0.15 })
  assert.deepEqual(parseReactionInput(""), { ok: true, value: null })
  assert.equal(parseReactionInput("1.2").ok, false)
  assert.equal(parseReactionInput("152").ok, false)
  const tooSlow = applyResultDetail({ reaction: 1.2 }, { eventKey: "100m", unit: "s", windApplies: true, mark: 11 })
  assert.equal(tooSlow.ok ? "" : tooSlow.message, "A reaction time is under one second, like 0.152.")
})

test("rounds: an entry is known by its last round, and the best mark across rounds is the best", () => {
  const heat = result("100m", 11.02, "2026-06-13", { round: "heat", heat: 2, lane: 4, qualifier: "Q", wind: 1 })
  const semi = result("100m", 11.2, "2026-06-13", { round: "semi_final", heat: 1, lane: 5, qualifier: "q" })
  const final = result("100m", 11.1, "2026-06-14", { round: "final", lane: 6 })
  assert.deepEqual(sortRounds([final, heat, semi]).map((item) => item.round), ["heat", "semi_final", "final"])
  assert.equal(headlineResult([final, heat, semi])?.id, final.id)
  // Went out in the heats: the heat is what the entry is known by.
  assert.equal(headlineResult([heat])?.id, heat.id)
  assert.equal(headlineResult([]), null)
  // The deciding round is one slot whatever it was called.
  assert.deepEqual([null, "final", "timed_final", "heat", "quarter_final", "semi_final"].map((round) => roundSlot(round as AthleteResult["round"])), ["final", "final", "final", "heat", "quarter_final", "semi_final"])
  assert.equal(describeRound(heat), "Heat 2, lane 4, qualified on place (Q)")
  assert.equal(describeRound(semi), "Semi final 1, lane 5, qualified on time (q)")
  assert.equal(describeRound(final), "Final, lane 6")
  assert.equal(describeRound({ lane: 3 }), "Lane 3")
  assert.equal(describeRound({}), "")
  // Every round is a result, so the faster heat is the personal best.
  assert.equal(selectBests([heat, semi, final], SEASON_2026).personalBest?.id, heat.id)
})

/* ---------- Relays ---------- */

function relay(id: string, value: number | null, date: string, extra: Partial<RelayEntry> = {}): RelayEntry {
  return {
    id,
    competitionId: "c1",
    competitionName: "Spring Open",
    teamId: "t1",
    teamName: "Sprint Group",
    teamLabel: "Sprint Group A",
    eventKey: "4x100m",
    eventLabel: "4x100m relay",
    round: null,
    heat: null,
    lane: null,
    place: null,
    qualifier: null,
    value,
    compareValue: value,
    display: value === null ? null : formatMark(value, "s"),
    timing: value === null ? null : "electronic",
    date,
    environment: "outdoor",
    location: "Spring Open",
    notes: null,
    createdAt: `${date}T12:00:00.000Z`,
    canManage: true,
    legs: [
      { leg: 1, athleteId: "a2", name: "Sarah Chen", split: 11.2 },
      { leg: 2, athleteId: "a1", name: "Marcus Johnson", split: null },
      { leg: 3, athleteId: null, name: "Former member", split: null },
      { leg: 4, athleteId: "a3", name: "David Okafor", split: null },
    ],
    ...extra,
  }
}

function relayInput(extra: Partial<RelayInput> = {}): RelayInput {
  return {
    competitionId: "c1",
    eventKey: "4x100m",
    teamId: "t1",
    legs: [
      { leg: 1, athleteId: "a2", split: 11.2 },
      { leg: 2, athleteId: "a1", split: 10.4 },
      { leg: 3, athleteId: "a10", split: 10.8 },
      { leg: 4, athleteId: "a3", split: 10.5 },
    ],
    value: 42.86,
    ...extra,
  }
}

const MEET = { today: "2026-06-20", startDate: "2026-06-13", endDate: "2026-06-14" }

test("a relay is four different athletes in order, with splits that fit its time", () => {
  assert.equal(validateRelayInput(relayInput(), MEET), null)
  assert.equal(validateRelayInput(relayInput({ eventKey: "100m" }), MEET), "Choose a relay event.")
  assert.equal(validateRelayInput(relayInput({ legs: relayInput().legs.slice(0, 3) }), MEET), "A relay has four legs. Choose an athlete for each.")
  assert.equal(validateRelayInput(relayInput({ legs: relayInput().legs.map((leg) => (leg.leg === 3 ? { ...leg, athleteId: null } : leg)) }), MEET), "Choose an athlete for leg 3.")
  // A leg whose athlete's data was deleted may stay empty when the relay is corrected.
  assert.equal(validateRelayInput(relayInput({ legs: relayInput().legs.map((leg) => (leg.leg === 3 ? { ...leg, athleteId: null } : leg)) }), { ...MEET, emptyLegs: [3] }), null)
  assert.equal(
    validateRelayInput(relayInput({ legs: relayInput().legs.map((leg) => (leg.leg === 4 ? { ...leg, athleteId: "a1" } : leg)) }), MEET),
    "An athlete can run one leg of a relay. Choose four different athletes.",
  )
  assert.equal(
    validateRelayInput(relayInput({ legs: relayInput().legs.map((leg) => (leg.leg === 1 ? { ...leg, split: 44 } : leg)) }), MEET),
    "The split of leg 1 (44.00) is larger than the relay's time (42.86).",
  )
  assert.equal(validateRelayInput(relayInput({ value: 40 }), MEET), "The leg splits add up to 42.90, more than the relay's time (40.00). Check the splits or the time.")
  assert.equal(validateRelayInput(relayInput({ value: 50 }), MEET), "The four leg splits add up to 42.90, but the relay's time is 50.00. Check the splits or the time.")
  // Hand timed splits rarely add up exactly: within a second is fine.
  assert.equal(validateRelayInput(relayInput({ value: 43.4 }), MEET), null)
  // Entered, not run yet: no time, no splits needed.
  assert.equal(validateRelayInput(relayInput({ value: null, legs: relayInput().legs.map((leg) => ({ ...leg, split: null })) }), { ...MEET, today: "2026-06-01" }), null)
  assert.match(validateRelayInput(relayInput(), { ...MEET, today: "2026-06-01" }) ?? "", /has not happened yet/)
  assert.equal(validateRelayInput(relayInput({ date: "2026-06-20" }), MEET), "The date must be a day of the competition.")
})

test("the relay record list is the fastest time of each team in each relay", () => {
  const records = relayTeamRecords(
    [
      relay("r1", 43.4, "2025-06-01"),
      relay("r2", 42.86, "2025-08-01", { teamLabel: "Sprint Group B" }),
      relay("r3", 43.1, "2026-05-01"),
      relay("r4", null, "2026-06-01"),
      relay("r5", 201.5, "2026-05-01", { eventKey: "4x400m", eventLabel: "4x400m relay" }),
      relay("r6", 44, "2026-05-02", { teamId: "t2", teamName: "Distance Group" }),
      relay("r7", 41, "2026-05-03", { teamId: null, teamName: null }),
    ],
    SEASON_2026,
  )
  assert.deepEqual(records.map((record) => [record.eventKey, record.teamName, record.best.id, record.seasonBest?.id ?? null, record.count]), [
    ["4x100m", "Distance Group", "r6", null, 1],
    ["4x100m", "Sprint Group", "r2", "r3", 3],
    ["4x400m", "Sprint Group", "r5", null, 1],
  ])
})

test("a relay names its legs, and an athlete finds their own", () => {
  const entry = relay("r1", 42.86, "2026-06-13")
  assert.equal(relayLegOf(entry, "a1")?.leg, 2)
  assert.equal(relayLegOf(entry, "a9"), null)
  assert.equal(relayLegOf(entry, null), null)
  assert.equal(relayLegsText(entry), "1 Sarah Chen, 2 Marcus Johnson, 3 Former member, 4 David Okafor")
  assert.equal(relayLegsText(entry, true), "1 Sarah Chen (11.20); 2 Marcus Johnson; 3 Former member; 4 David Okafor")
  // One result per team, event and round at a competition; a final and "no round" are the same slot.
  assert.equal(sameRelaySlot(entry, relay("r2", 43, "2026-06-13", { round: "final", teamLabel: " sprint group a " })), true)
  assert.equal(sameRelaySlot(entry, relay("r2", 43, "2026-06-13", { round: "heat" })), false)
  assert.equal(sameRelaySlot(entry, relay("r2", 43, "2026-06-13", { teamLabel: "Sprint Group B" })), false)
  assert.equal(sameRelaySlot(entry, relay("r2", 43, "2026-06-13", { competitionId: "c2" })), false)
})
