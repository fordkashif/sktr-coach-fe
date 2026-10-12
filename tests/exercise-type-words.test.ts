import test from "node:test"
import assert from "node:assert/strict"
import { inferBlockType, inferLogKind } from "../src/lib/data/session/session-from-plan"

const row = (name: string, reps = "", load = "") => ({ name, reps, load })

test("core exercises are not mistaken for running (crunches has 'run' inside it)", () => {
  assert.equal(inferLogKind("Core", row("Pike crunches", "10")), "check")
  assert.equal(inferLogKind("Core", row("Reverse crunches", "10")), "check")
  assert.equal(inferLogKind("Mobility", row("Butterfly stretch")), "check")
  assert.equal(inferLogKind("Warm up", row("Brace and breathe")), "check")
})

test("gym lifts are lifts even with no load typed", () => {
  for (const name of ["Speed bench", "Pause bench", "Lat pulldowns", "Bent over rows", "Leg curls", "Pull ups", "Hip thrust", "Jerk", "Hang snatch", "RDLs"]) {
    assert.equal(inferLogKind("Upper body", row(name, "8")), "strength", name)
  }
})

test("running, jumps and throws are still recognised", () => {
  assert.equal(inferLogKind("Sprints", row("Sprints", "20m")), "time")
  assert.equal(inferLogKind("Speed", row("Flying 30s", "30m")), "time")
  assert.equal(inferLogKind("Track", row("Tempo runs", "200m")), "time")
  assert.equal(inferLogKind("Track", row("Hill sprints", "6")), "time")
  assert.equal(inferLogKind("Acceleration", row("Block starts", "4")), "time")
  assert.equal(inferLogKind("Plyos", row("Hurdle jumps", "5")), "mark")
  assert.equal(inferLogKind("Throws", row("Discus throws", "6")), "mark")
  assert.equal(inferLogKind("Strength", row("Back squat", "5", "100kg")), "strength")
})

test("rows is a lift, throws is not", () => {
  assert.equal(inferLogKind("Strength", row("Bent over rows", "8")), "strength")
  assert.equal(inferLogKind("Throws", row("Shot put throws", "6")), "mark")
})

test("block types keep working for track blocks", () => {
  assert.equal(inferBlockType("Sprint", "Track"), "Sprint")
  assert.equal(inferBlockType("Acceleration", "Track"), "Sprint")
  assert.equal(inferBlockType("Tempo", "Track"), "Run")
  assert.equal(inferBlockType("Core", "Gym"), "Strength")
})
