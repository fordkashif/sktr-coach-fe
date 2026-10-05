import test from "node:test"
import assert from "node:assert/strict"
import {
  canRepeatLastTime,
  cleanEffort,
  cleanNote,
  effortBySet,
  exerciseMatchKey,
  lastTimeEffort,
  lastTimeForRow,
  lastTimeSetText,
  nextOpenTimeSet,
  parseRestSeconds,
  repeatFill,
  restSecondsForRow,
  rowNote,
} from "../src/lib/data/session/log-assist"
import {
  extendRest,
  formatCountdown,
  formatStopwatch,
  newStopwatch,
  restIsOver,
  restProgress,
  restRemainingMs,
  reviveClock,
  startRest,
  startStopwatch,
  stopStopwatch,
  stopwatchElapsedMs,
  stopwatchSeconds,
} from "../src/lib/data/session/log-clock"
import type { LastTimeResult, SessionRowLog } from "../src/lib/data/session/types"

const set = (setIndex: number, reps: number | null, loadKg: number | null, rpe: number | null = null) => ({ setIndex, reps, loadKg, timeSeconds: null, distanceM: null, mark: null, rpe })
const squatLast: LastTimeResult = {
  date: "2026-09-28",
  summary: "3 x 5 at 120kg",
  kind: "strength",
  sets: [set(1, 5, 120, 7), set(2, 5, 120, 7), set(3, 5, 120, 8)],
  sessionEffort: 7,
  note: "Slow last set.",
}
const log = (rowId: string, setIndex: number, patch: Partial<SessionRowLog> = {}): SessionRowLog => ({
  rowId,
  setIndex,
  completed: false,
  reps: null,
  loadKg: null,
  timeSeconds: null,
  distanceM: null,
  mark: null,
  ...patch,
})
const map = (logs: SessionRowLog[]) => Object.fromEntries(logs.map((entry) => [`${entry.rowId}:${entry.setIndex}`, entry]))

test("an exercise is matched on its name, ignoring case, punctuation and spacing", () => {
  assert.equal(exerciseMatchKey("  Back-Squat "), "back squat")
  assert.equal(exerciseMatchKey("BACK   SQUAT."), "back squat")
  assert.equal(exerciseMatchKey("30m from blocks"), "30m from blocks")
  assert.notEqual(exerciseMatchKey("Front squat"), exerciseMatchKey("Back squat"))
  assert.equal(exerciseMatchKey(null), "")
})

test("last time is found for a row by its name, and never for a tick only row", () => {
  const byKey = { "back squat": squatLast }
  assert.equal(lastTimeForRow({ label: "Back Squat", kind: "strength" }, byKey), squatLast)
  assert.equal(lastTimeForRow({ label: "Power clean", kind: "strength" }, byKey), null)
  assert.equal(lastTimeForRow({ label: "Back squat", kind: "check" }, byKey), null)
})

test("last time can only be repeated into the same kind of inputs", () => {
  assert.equal(canRepeatLastTime({ kind: "strength" }, squatLast), true)
  assert.equal(canRepeatLastTime({ kind: "time" }, squatLast), false)
  assert.equal(canRepeatLastTime({ kind: "strength" }, null), false)
})

test("same as last time fills every open set with last time's numbers and ticks it", () => {
  const fill = repeatFill({ id: "r1", kind: "strength" }, squatLast, {}, 3)
  assert.equal(fill.count, 3)
  assert.deepEqual(
    fill.entries.map((entry) => [entry.setIndex, entry.reps, entry.loadKg, entry.completed]),
    [
      [1, 5, 120, true],
      [2, 5, 120, true],
      [3, 5, 120, true],
    ],
  )
  // Today's effort is the athlete's to give: last time's is not copied.
  assert.ok(fill.entries.every((entry) => entry.rpe === null && entry.note === null))
})

test("same as last time leaves a set ticked today alone and keeps effort and note already given", () => {
  const logs = map([log("r1", 1, { completed: true, reps: 4, loadKg: 125 }), log("r1", 2, { rpe: 9, note: "felt heavy" })])
  const fill = repeatFill({ id: "r1", kind: "strength" }, squatLast, logs, 3)
  assert.deepEqual(
    fill.entries.map((entry) => entry.setIndex),
    [2, 3],
  )
  assert.equal(fill.entries[0].rpe, 9)
  assert.equal(fill.entries[0].note, "felt heavy")
})

test("same as last time adds sets when last time had more, up to the limit", () => {
  const long: LastTimeResult = { ...squatLast, sets: [1, 2, 3, 4, 5].map((index) => set(index, 3, 100)) }
  assert.equal(repeatFill({ id: "r1", kind: "strength" }, long, {}, 3).count, 5)
  const capped = repeatFill({ id: "r1", kind: "strength" }, long, {}, 3, 4)
  assert.equal(capped.count, 4)
  assert.equal(capped.entries.length, 4)
})

test("same as last time does nothing for another kind of row or with no history", () => {
  assert.deepEqual(repeatFill({ id: "r1", kind: "time" }, squatLast, {}, 4), { entries: [], count: 4 })
  assert.deepEqual(repeatFill({ id: "r1", kind: "strength" }, null, {}, 3), { entries: [], count: 3 })
})

test("a timed row repeats times and distance, not reps", () => {
  const last: LastTimeResult = {
    date: "2026-09-28",
    summary: "4.2 s, 4.23 s",
    kind: "time",
    sets: [
      { setIndex: 1, reps: null, loadKg: null, timeSeconds: 4.2, distanceM: 30, mark: null, rpe: null },
      { setIndex: 2, reps: null, loadKg: null, timeSeconds: 4.23, distanceM: 30, mark: null, rpe: null },
    ],
    sessionEffort: null,
    note: null,
  }
  const fill = repeatFill({ id: "r2", kind: "time" }, last, {}, 4)
  assert.deepEqual(
    fill.entries.map((entry) => [entry.timeSeconds, entry.distanceM, entry.reps]),
    [
      [4.2, 30, null],
      [4.23, 30, null],
    ],
  )
  assert.equal(fill.count, 4)
})

test("the note of an exercise is read from its lowest set that has one", () => {
  const logs = [log("r1", 2, { note: "second" }), log("r1", 1, { note: "" }), log("r2", 1, { note: "other row" }), log("r1", 3, { note: "third" })]
  assert.equal(rowNote("r1", logs), "second")
  assert.equal(rowNote("r1", map(logs)), "second")
  assert.equal(rowNote("r9", logs), "")
})

test("notes and efforts are cleaned before they are saved", () => {
  assert.equal(cleanNote("  left   knee \n sore "), "left knee sore")
  assert.equal(cleanNote("   "), null)
  assert.equal(cleanNote("x".repeat(600))?.length, 500)
  assert.equal(cleanEffort(8), 8)
  assert.equal(cleanEffort(7.6), 8)
  assert.equal(cleanEffort(0), null)
  assert.equal(cleanEffort(11), null)
  assert.equal(cleanEffort(undefined), null)
})

test("effort is described per set and as a range", () => {
  assert.equal(effortBySet([{ setIndex: 2, rpe: 8 }, { setIndex: 1, rpe: 7 }, { setIndex: 3 }]), "7, 8, none")
  assert.equal(effortBySet([{ setIndex: 1 }, { setIndex: 2, rpe: null }]), "")
  assert.equal(lastTimeEffort(squatLast), "effort 7 to 8")
  assert.equal(lastTimeEffort({ sets: [set(1, 5, 100)], sessionEffort: 6 }), "session effort 6")
  assert.equal(lastTimeEffort({ sets: [set(1, 5, 100)], sessionEffort: null }), "")
})

test("one set of last time reads the way it was logged", () => {
  assert.equal(lastTimeSetText("strength", set(1, 5, 122.5)), "5 x 122.5 kg")
  assert.equal(lastTimeSetText("time", { setIndex: 1, reps: null, loadKg: null, timeSeconds: 65.3, distanceM: 400, mark: null, rpe: null }), "1:05.3")
  assert.equal(lastTimeSetText("mark", { setIndex: 1, reps: null, loadKg: null, timeSeconds: null, distanceM: null, mark: 6.42, rpe: null }), "6.42 m")
})

test("the prescribed rest is read from what the coach wrote", () => {
  assert.equal(parseRestSeconds("Rest 90s"), 90)
  assert.equal(parseRestSeconds("Rest 2 min between sets."), 120)
  assert.equal(parseRestSeconds("3 min rest"), 180)
  assert.equal(parseRestSeconds("recovery 1:30"), 90)
  assert.equal(parseRestSeconds("45 sec recovery"), 45)
  assert.equal(parseRestSeconds("Rest: 3"), 180)
  assert.equal(parseRestSeconds("Walk back recovery."), null)
  assert.equal(parseRestSeconds("4 x 30m between cones"), null)
  assert.equal(parseRestSeconds("3 x 5 at 120kg"), null)
  assert.equal(parseRestSeconds("Full recovery between reps. Quality over times."), null)
  assert.equal(parseRestSeconds(null), null)
})

test("rest falls back to 60 seconds when the coach set none", () => {
  assert.deepEqual(restSecondsForRow([null, "3 x 5 at 120kg", "Rest 2 min between sets."]), { seconds: 120, prescribed: true })
  assert.deepEqual(restSecondsForRow([null, "As coached"]), { seconds: 60, prescribed: false })
})

test("a stopwatch time goes into the first rep with no time", () => {
  const logs = map([log("r1", 1, { timeSeconds: 4.2 }), log("r1", 3, { timeSeconds: 4.3 })])
  assert.equal(nextOpenTimeSet("r1", logs, 4), 2)
  const full = map([1, 2].map((index) => log("r1", index, { timeSeconds: 4 })))
  assert.equal(nextOpenTimeSet("r1", full, 2), 3)
  assert.equal(nextOpenTimeSet("r1", full, 2, 2), null)
})

test("the rest countdown is worked out from the clock, so a long gap between repaints loses nothing", () => {
  const start = 1_000_000
  const rest = startRest(start, 90, "Back squat")
  assert.equal(rest.endsAt, start + 90_000)
  assert.equal(formatCountdown(restRemainingMs(rest, start)), "1:30")
  assert.equal(formatCountdown(restRemainingMs(rest, start + 400)), "1:30")
  assert.equal(formatCountdown(restRemainingMs(rest, start + 1_000)), "1:29")
  // The screen was locked for 75 seconds: no ticks happened, the reading is still right.
  assert.equal(formatCountdown(restRemainingMs(rest, start + 75_000)), "0:15")
  assert.equal(restIsOver(rest, start + 89_999), false)
  assert.equal(restIsOver(rest, start + 90_000), true)
  assert.equal(formatCountdown(restRemainingMs(rest, start + 200_000)), "0:00")
  assert.equal(restProgress(rest, start + 45_000), 50)
  assert.equal(restProgress(rest, start + 500_000), 100)
})

test("adding time to a rest moves its end and lets it cue again", () => {
  const rest = { ...startRest(0, 60), cued: true }
  const longer = extendRest(rest, 30)
  assert.equal(longer.endsAt, 90_000)
  assert.equal(longer.durationMs, 90_000)
  assert.equal(longer.cued, false)
})

test("the stopwatch keeps time across stops and across a gap with no repaints", () => {
  let watch = newStopwatch("r1")
  assert.equal(stopwatchElapsedMs(watch, 5_000), 0)
  watch = startStopwatch(watch, 10_000)
  assert.equal(stopwatchElapsedMs(watch, 14_210), 4_210)
  // Starting again while running does not restart it.
  assert.equal(startStopwatch(watch, 12_000), watch)
  watch = stopStopwatch(watch, 14_210)
  assert.equal(stopwatchElapsedMs(watch, 99_000), 4_210)
  watch = startStopwatch(watch, 100_000)
  assert.equal(stopwatchElapsedMs(watch, 160_000), 64_210)
  assert.equal(stopwatchSeconds(4_218), 4.22)
  assert.equal(stopwatchSeconds(64_210), 64.21)
  assert.equal(formatStopwatch(4_218), "0:04.21")
  assert.equal(formatStopwatch(125_100), "2:05.10")
})

test("a clock read back from the phone is checked before it is used", () => {
  const rest = startRest(1_000, 60, "Squat")
  assert.deepEqual(reviveClock(JSON.parse(JSON.stringify(rest))), rest)
  const watch = startStopwatch(newStopwatch("r1"), 500)
  assert.deepEqual(reviveClock(JSON.parse(JSON.stringify(watch))), watch)
  assert.deepEqual(reviveClock({ mode: "rest", endsAt: "soon" }), { mode: "idle" })
  assert.deepEqual(reviveClock(null), { mode: "idle" })
  assert.deepEqual(reviveClock("nonsense"), { mode: "idle" })
})
