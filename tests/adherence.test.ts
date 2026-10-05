import test from "node:test"
import assert from "node:assert/strict"
import { adherenceCounts, adherencePercent, adherenceText, averageAdherence, type AdherenceSession } from "../src/lib/data/session/adherence"

const window = { from: "2026-09-08", to: "2026-10-05" }
const session = (id: string, scheduledFor: string, status = "scheduled", origin: string | null = "plan", athleteId = "a1"): AdherenceSession => ({
  id,
  athleteId,
  scheduledFor,
  status,
  origin,
})

test("adherence is done over due, counting only planned sessions up to today", () => {
  const counts = adherenceCounts(
    [session("s1", "2026-09-25", "completed"), session("s2", "2026-09-27"), session("s3", "2026-10-05"), session("future", "2026-10-07"), session("old", "2026-08-01", "completed")],
    new Set(),
    [],
    window,
  )
  assert.deepEqual(counts.get("a1"), { due: 3, done: 1, excused: 0 })
  assert.equal(adherencePercent(counts.get("a1")), 33)
})

test("a skipped session and a session inside an unavailable period are excused", () => {
  const counts = adherenceCounts(
    [session("s1", "2026-09-25", "completed"), session("s2", "2026-09-27"), session("s3", "2026-09-29", "skipped"), session("s4", "2026-10-02"), session("s5", "2026-10-05")],
    new Set(),
    [{ athleteId: "a1", startsOn: "2026-10-01", endsOn: null }],
    window,
  )
  assert.deepEqual(counts.get("a1"), { due: 2, done: 1, excused: 3 })
  assert.equal(adherencePercent(counts.get("a1")), 50)
})

test("a session done while unavailable still counts, and a completion row counts as done", () => {
  const counts = adherenceCounts([session("s1", "2026-10-02"), session("s2", "2026-10-03")], new Set(["s1"]), [{ athleteId: "a1", startsOn: "2026-10-01", endsOn: "2026-10-04" }], window)
  assert.deepEqual(counts.get("a1"), { due: 1, done: 1, excused: 1 })
})

test("sessions the athlete added are in neither number", () => {
  const counts = adherenceCounts([session("s1", "2026-10-01"), session("x1", "2026-10-02", "completed", "athlete")], new Set(["x1"]), [], window)
  assert.deepEqual(counts.get("a1"), { due: 1, done: 0, excused: 0 })
})

test("nothing due is null and reads as text, never 100%", () => {
  const counts = adherenceCounts([session("s1", "2026-10-01", "skipped")], new Set(), [], window)
  assert.equal(adherencePercent(counts.get("a1")), null)
  assert.equal(adherencePercent(undefined), null)
  assert.equal(adherenceText(null), "No sessions due")
  assert.equal(adherenceText(80), "80%")
  assert.equal(averageAdherence([null, 80, 60]), 70)
  assert.equal(averageAdherence([null, null]), null)
})

test("a period of another athlete, or one cancelled before it began, excuses nothing", () => {
  const counts = adherenceCounts(
    [session("s1", "2026-10-02")],
    new Set(),
    [
      { athleteId: "a2", startsOn: "2026-10-01", endsOn: null },
      { athleteId: "a1", startsOn: "2026-10-02", endsOn: "2026-10-01" },
    ],
    window,
  )
  assert.deepEqual(counts.get("a1"), { due: 1, done: 0, excused: 0 })
})
