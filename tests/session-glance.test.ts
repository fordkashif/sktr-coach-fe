import test from "node:test"
import assert from "node:assert/strict"
import { blockNameFromPreview, exerciseCount, joinBlockNames } from "../src/lib/data/training-plan/session-glance"

test("a block preview gives its name", () => {
  assert.equal(blockNameFromPreview("Strength: Hang snatch 5 x 3 @ 55lbs | Back squat 1 x 6 @ 100lbs"), "Strength")
  assert.equal(blockNameFromPreview("Warm up"), "Warm up")
})

test("block names read as a short phrase", () => {
  assert.equal(joinBlockNames(["Strength"]), "Strength")
  assert.equal(joinBlockNames(["Strength", "Core"]), "Strength and Core")
  assert.equal(joinBlockNames(["Strength", "Core", "Sprints"]), "Strength, Core and Sprints")
  assert.equal(joinBlockNames(["Power", "Upper body", "Jumps", "Core", "Sprints"]), "Power, Upper body, Jumps and 2 more")
  assert.equal(joinBlockNames(["Core", "Core", " "]), "Core")
  assert.equal(joinBlockNames([]), "")
})

test("exercise counts", () => {
  assert.equal(exerciseCount(1), "1 exercise")
  assert.equal(exerciseCount(13), "13 exercises")
})
