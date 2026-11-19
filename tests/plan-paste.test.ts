import test from "node:test"
import assert from "node:assert/strict"
import { exerciseLine, looksLikeRows, mergePastedBlocks, parseLine, parsePastedSheet, pastedToBlocks, titleFromBlocks } from "../src/lib/data/training-plan/plan-paste"

const WEEK = [
  "November 9-13, 2026",
  "Monday",
  "Exercise\tSets\tReps\t%\tNotes",
  "Back Squat\t1\t6\t50%\t",
  "\t1\t3\t75%\t",
  "\t1\tAMRAP\tLAST WEEK ADJUSTED\t",
  "Bench Press\t3\t5\t80%\t",
  "CORE\t\t\t\t",
  "Suitcase Carry\t3\t30sec\t35lbs/25lbs\tEach Side",
  "",
  "Tuesday",
  "Exercise\tSets\tReps\t%\tNotes",
  "Snatch Complex (2/1)\t3\t3\t80-85%\t2 Pulls + 1 Lift",
  "Sprints\t6\t30m\t\t",
  "Thursday",
  "Exercise\tSets\tReps\t%\tNotes",
  "Hang Cleans\t4\t3\t70-85%\t",
  "  > Countermovement Jump\t\t4\t\t",
  "Friday",
  "Single Leg Iso-Lunge\t3\t25sec\tEach Leg\t",
  "Shoulder Circuit\t2\t10\t-\t",
].join("\n")

test("a week copied from a spreadsheet becomes days, sections and rows", () => {
  const sheet = parsePastedSheet(WEEK)
  assert.deepEqual(sheet.days.map((day) => day.weekday), [1, 2, 4, 5])
  const monday = sheet.days[0]
  assert.deepEqual(monday.blocks.map((block) => block.title), ["Main", "Core"])
  assert.deepEqual(monday.blocks[0].exercises.map((row) => [row.name, row.sets, row.reps, row.load]), [
    ["Back Squat", "1", "6", "50%"],
    ["Back Squat", "1", "3", "75%"],
    ["Back Squat", "1", "AMRAP", "Last week adjusted"],
    ["Bench Press", "3", "5", "80%"],
  ])
  assert.deepEqual(monday.blocks[1].exercises[0], { name: "Suitcase Carry", sets: "3", reps: "30s", load: "35lbs/25lbs", notes: "Each Side" })
  assert.equal(sheet.days[1].blocks[0].exercises[0].notes, "2 Pulls + 1 Lift")
  assert.equal(sheet.days[2].blocks[0].exercises[1].name, "Countermovement Jump")
  const friday = sheet.days[3].blocks[0].exercises
  assert.deepEqual([friday[0].load, friday[0].notes, friday[0].reps], ["", "Each Leg", "25s"])
  assert.equal(friday[1].load, "")
  assert.equal(sheet.exerciseCount, 11)
})

test("rows with no weekday go to one day", () => {
  const sheet = parsePastedSheet("Plank\t3\t45sec\nSide Plank\t3\t30sec")
  assert.equal(sheet.days.length, 1)
  assert.equal(sheet.days[0].weekday, null)
  assert.deepEqual(sheet.days[0].blocks[0].exercises.map((row) => row.reps), ["45s", "30s"])
})

test("plain text lines with sets x reps are read", () => {
  const sheet = parsePastedSheet("Strength:\nBack squat 4 x 3 @ 210lbs\nCalf raises 2 x 15")
  assert.equal(sheet.days[0].blocks[0].title, "Strength")
  assert.deepEqual(sheet.days[0].blocks[0].exercises[0], { name: "Back squat", sets: "4", reps: "3", load: "210lbs", notes: "" })
  assert.equal(sheet.days[0].blocks[0].exercises[1].load, "")
})

test("a header row can put the columns in another order", () => {
  const sheet = parsePastedSheet("Exercise\tLoad\tSets\tReps\nDeadlift\t80%\t2\t5")
  assert.deepEqual(sheet.days[0].blocks[0].exercises[0], { name: "Deadlift", sets: "2", reps: "5", load: "80%", notes: "" })
})

test("one word is not rows, two lines or a tab are", () => {
  assert.equal(looksLikeRows("Back squat"), false)
  assert.equal(looksLikeRows("Back squat\t3"), true)
  assert.equal(looksLikeRows("Back squat\nBench"), true)
})

test("pasted rows join the last section of a day unless they bring their own", () => {
  let id = 0
  const make = (prefix: string) => `${prefix}-${++id}`
  const existing = pastedToBlocks([{ title: "Strength", exercises: [{ name: "Squat", sets: "3", reps: "5", load: "", notes: "" }] }], make)
  const loose = pastedToBlocks(parsePastedSheet("Bench\t3\t5\t80%\tPause").days[0].blocks, make)
  const merged = mergePastedBlocks(existing, loose)
  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0].exercises.map((row) => row.name), ["Squat", "Bench"])
  assert.equal(merged[0].exercises[1].cue, "Pause")
  const own = pastedToBlocks(parsePastedSheet("CORE\nPlank\t3\t45s").days[0].blocks, make)
  assert.equal(mergePastedBlocks(existing, own).length, 2)
  assert.equal(titleFromBlocks(merged), "Squat and bench")
  assert.equal(titleFromBlocks([{ exercises: [{ name: "Back squat" }, { name: "Back squat" }, { name: "Bench press" }, { name: "Deadlift" }, { name: "RDL" }] }]), "Back squat, bench press and deadlift")
})

test("a typed line reads as an exercise or a section, and an exercise reads back as a line", () => {
  assert.deepEqual(parseLine("Med ball slams 3x10 @15lbs"), { exercise: { name: "Med ball slams", sets: "3", reps: "10", load: "15lbs", notes: "" } })
  assert.deepEqual(parseLine("Single leg hop 3x5 (each leg)"), { exercise: { name: "Single leg hop", sets: "3", reps: "5", load: "", notes: "each leg" } })
  assert.deepEqual(parseLine("Snatch complex (2/1) 3x3 @80-85%"), { exercise: { name: "Snatch complex (2/1)", sets: "3", reps: "3", load: "80-85%", notes: "" } })
  assert.deepEqual(parseLine("CORE"), { heading: "Core" })
  assert.deepEqual(parseLine("Plank"), { exercise: { name: "Plank", sets: "", reps: "", load: "", notes: "" } })
  assert.equal(parseLine("   "), null)
  assert.equal(exerciseLine({ name: "Back squat", sets: "3", reps: "5", load: "80%", cue: "Pause" }), "Back squat 3x5 @80% (Pause)")
  assert.equal(exerciseLine({ name: "Sprints", sets: "6", reps: "30m", load: "" }), "Sprints 6x30m")
})

test("short capitals like RDL stay exercises", () => {
  assert.deepEqual(parseLine("RDL"), { exercise: { name: "RDL", sets: "", reps: "", load: "", notes: "" } })
  assert.deepEqual(parseLine("UPPER BODY"), { heading: "Upper body" })
})

test("a title from title-cased names reads as a sentence", () => {
  assert.equal(titleFromBlocks([{ exercises: [{ name: "Back Squat" }, { name: "Bench Press" }, { name: "RDL" }] }]), "Back squat, bench press and RDL")
})
