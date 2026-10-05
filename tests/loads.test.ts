import test from "node:test"
import assert from "node:assert/strict"
import {
  cleanReferenceUrl,
  describePercentLoad,
  isEmptyOverride,
  liftKey,
  mergeOverride,
  overrideFor,
  parsePercent,
  percentOfMaxKg,
  resolvePercentTarget,
  roundToStep,
  summarizeOverride,
} from "../src/lib/data/exercises/loads"

test("a load is a percentage only when it is written with a percent sign", () => {
  assert.equal(parsePercent("80%"), 80)
  assert.equal(parsePercent(" 82,5 % "), 82.5)
  assert.equal(parsePercent("@ 70%"), 70)
  assert.equal(parsePercent("80% 1RM"), 80)
  assert.equal(parsePercent("80"), null)
  assert.equal(parsePercent("80kg"), null)
  assert.equal(parsePercent("BW"), null)
  assert.equal(parsePercent(""), null)
  assert.equal(parsePercent(null), null)
  assert.equal(parsePercent("0%"), null)
  assert.equal(parsePercent("250%"), null)
})

test("loads round to the nearest 2.5 kg", () => {
  assert.equal(roundToStep(120), 120)
  assert.equal(roundToStep(121.2), 120)
  assert.equal(roundToStep(121.25), 122.5)
  assert.equal(roundToStep(121.6), 122.5)
  assert.equal(roundToStep(123.74), 122.5)
  assert.equal(roundToStep(123.75), 125)
  assert.equal(roundToStep(1), 0)
  assert.equal(roundToStep(1.3), 2.5)
})

test("a percentage of a best lift becomes kilograms, or nothing without a best", () => {
  assert.equal(percentOfMaxKg(80, 150), 120)
  assert.equal(percentOfMaxKg(80, 152), 122.5)
  assert.equal(percentOfMaxKg(80, 151), 120)
  assert.equal(percentOfMaxKg(72.5, 100), 72.5)
  assert.equal(percentOfMaxKg(105, 100), 105)
  assert.equal(percentOfMaxKg(80, null), null)
  assert.equal(percentOfMaxKg(80, 0), null)
  assert.equal(percentOfMaxKg(null, 150), null)
  assert.equal(describePercentLoad(80, 150), "80%, 120 kg")
  assert.equal(describePercentLoad(82.5, 152), "82.5%, 125 kg")
  assert.equal(describePercentLoad(80, null), "80%")
})

test("the athlete reads the percentage and the weight, or the percentage and a hint", () => {
  assert.deepEqual(resolvePercentTarget({ volume: "4 x 4", percent: 80, maxKg: 150, liftName: "Back squat" }), {
    target: "4 x 4 at 80%, 120 kg",
    targetLoad: "120 kg",
    hint: null,
    loadKg: 120,
  })
  const unknown = resolvePercentTarget({ volume: "4 x 4", percent: 80, maxKg: null, liftName: "Back squat" })
  assert.equal(unknown.target, "4 x 4 at 80%")
  assert.equal(unknown.targetLoad, "80%")
  assert.equal(unknown.loadKg, null)
  assert.match(unknown.hint ?? "", /No best Back squat saved yet/)
  assert.equal(resolvePercentTarget({ volume: "", percent: 60, maxKg: 200, liftName: "Back squat" }).target, "60%, 120 kg")
  assert.equal(resolvePercentTarget({ volume: null, percent: 77, maxKg: 110, liftName: null }).targetLoad, "85 kg")
})

test("lift names match whatever the case, the spacing or the 1RM wording", () => {
  assert.equal(liftKey("  Back  Squat (1RM) "), "back squat")
  assert.equal(liftKey("Back squat"), "back squat")
  assert.equal(liftKey("Squat 1 rep max"), "squat")
  assert.equal(liftKey("Squat 1RM"), "squat")
  assert.equal(liftKey("Bench-press max"), "bench press")
  assert.equal(liftKey("Maximal clean"), "maximal clean")
  assert.equal(liftKey(null), "")
})

test("a change for one athlete only replaces what the coach filled in", () => {
  const row = { sets: "4", reps: "4", load: "80%", name: "Back squat" }
  assert.deepEqual(mergeOverride(row, { sets: "", reps: "", load: "70%" }), { sets: "4", reps: "4", load: "70%", name: "Back squat" })
  assert.deepEqual(mergeOverride(row, { sets: "3", reps: " 5 ", load: " " }), { sets: "3", reps: "5", load: "80%", name: "Back squat" })
  assert.equal(mergeOverride(row, null), row)

  const overrides = [
    { athleteId: "a3", sets: "", reps: "", load: "70%", note: "" },
    { athleteId: "a2", sets: "", reps: "", load: "", note: "Goblet squat instead" },
  ]
  assert.equal(overrideFor(overrides, "a3")?.load, "70%")
  assert.equal(overrideFor(overrides, "a1"), null)
  assert.equal(overrideFor(undefined, "a1"), null)
  assert.equal(isEmptyOverride({ sets: " ", reps: "", load: "", note: "" }), true)
  assert.equal(isEmptyOverride(overrides[1]), false)
  assert.equal(summarizeOverride(overrides[0]), "70%")
  assert.equal(summarizeOverride({ sets: "3", reps: "5", load: "100kg", note: "sore knee" }), "3 x 5, 100kg, sore knee")

  // The athlete's own percentage is worked out from their own best lift.
  const david = mergeOverride(row, overrideFor(overrides, "a3"))
  assert.equal(resolvePercentTarget({ volume: "4 x 4", percent: parsePercent(david.load) ?? 0, maxKg: 175, liftName: "Back squat" }).target, "4 x 4 at 70%, 122.5 kg")
})

test("only http and https links are kept", () => {
  assert.equal(cleanReferenceUrl(" https://example.com/squat?v=1 "), "https://example.com/squat?v=1")
  assert.equal(cleanReferenceUrl("http://example.com"), "http://example.com")
  assert.equal(cleanReferenceUrl("javascript:alert(1)"), null)
  assert.equal(cleanReferenceUrl("ftp://example.com/file"), null)
  assert.equal(cleanReferenceUrl("example.com/squat"), null)
  assert.equal(cleanReferenceUrl("https://exa mple.com"), null)
  assert.equal(cleanReferenceUrl("https://localhost"), null)
  assert.equal(cleanReferenceUrl(""), null)
  assert.equal(cleanReferenceUrl(null), null)
})
