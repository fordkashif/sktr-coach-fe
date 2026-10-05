import test from "node:test"
import assert from "node:assert/strict"
import { csvFileName, toCsv } from "../src/lib/csv"
import { checkTestResultEntry, entryTextFor, parsePastedCells, testWeekResultsCsvRows } from "../src/lib/data/test-week/result-entry"

test("a typed result is a plain number above 0 in the test's unit", () => {
  assert.deepEqual(checkTestResultEntry("4.05", "time"), { ok: true, numeric: 4.05, valueText: "4.05s" })
  assert.deepEqual(checkTestResultEntry(" 185 ", "weight"), { ok: true, numeric: 185, valueText: "185kg" })
  assert.deepEqual(checkTestResultEntry("7,42", "distance"), { ok: true, numeric: 7.42, valueText: "7.42m" })
  assert.deepEqual(checkTestResultEntry("5400", "score"), { ok: true, numeric: 5400, valueText: "5400" })
  // The unit may be typed or pasted along with the number.
  assert.deepEqual(checkTestResultEntry("72cm", "height"), { ok: true, numeric: 72, valueText: "72cm" })
  assert.deepEqual(checkTestResultEntry("4.10 S", "time"), { ok: true, numeric: 4.1, valueText: "4.1s" })
})

test("anything else is refused with a reason", () => {
  for (const bad of ["", "abc", "4.2x", "1:05.3", "-3", "4.0005", "12kg"]) {
    assert.equal(checkTestResultEntry(bad, "time").ok, false, bad)
  }
  assert.equal(checkTestResultEntry("0", "time").ok, false)
  assert.equal(checkTestResultEntry("100000", "weight").ok, false)
  assert.equal(checkTestResultEntry("99999.999", "weight").ok, true)
})

test("a saved result goes back into a field as its number", () => {
  assert.equal(entryTextFor({ value: "4.05s", numeric: 4.05 }), "4.05")
  assert.equal(entryTextFor({ value: "185kg", numeric: null }), "185")
  assert.equal(entryTextFor(null), "")
})

test("pasted spreadsheet cells become rows and columns", () => {
  assert.deepEqual(parsePastedCells("4.05\n4.22\r\n4.10\n"), [["4.05"], ["4.22"], ["4.10"]])
  assert.deepEqual(parsePastedCells("4.05\t185\n\t120"), [["4.05", "185"], ["", "120"]])
  assert.deepEqual(parsePastedCells(""), [])
})

test("the results export has a header block, one column per test and marks coach entries", () => {
  const rows = testWeekResultsCsvRows({
    weekName: "January Speed Testing",
    teamName: "Sprint Group",
    startDate: "2026-01-12",
    endDate: "2026-01-16",
    status: "Closed",
    tests: [
      { id: "t1", name: "30m", unit: "time", dayIndex: 0 },
      { id: "t2", name: "Squat 1RM", unit: "weight", dayIndex: 1 },
    ],
    athletes: [
      { name: "Marcus Johnson", primaryEvent: "100m", submittedAt: "2026-01-15T09:15:00Z", results: { t1: { value: "4.05s", numeric: 4.05, enteredBy: "athlete" }, t2: { value: "185kg", numeric: 185, enteredBy: "coach" } } },
      { name: "Ben Managed", primaryEvent: null, submittedAt: "2026-01-16T10:00:00Z", results: { t1: { value: "4.31s", numeric: null, enteredBy: "coach" } } },
      { name: "Nobody Yet", primaryEvent: "200m", submittedAt: null, results: {} },
    ],
  })
  assert.deepEqual(rows[0], ["Test week", "January Speed Testing"])
  assert.deepEqual(rows[5], ["Athlete", "Primary event", "30m (s), day 1", "Squat 1RM (kg), day 2", "Last entered", "Entered by coach"])
  assert.deepEqual(rows[6], ["Marcus Johnson", "100m", "4.05", "185", "2026-01-15", "Squat 1RM"])
  assert.deepEqual(rows[7], ["Ben Managed", "", "4.31s", "", "2026-01-16", "All"])
  assert.deepEqual(rows[8], ["Nobody Yet", "200m", "", "", "", ""])
})

test("csv cells are quoted and a typed formula is defused, numbers are not", () => {
  assert.equal(toCsv([["a", 'say "hi"', null, 3]]), '"a","say ""hi""","","3"')
  assert.equal(toCsv([["=SUM(A1)", "-0.4", "+1.2", "@x"]]), "\"'=SUM(A1)\",\"-0.4\",\"+1.2\",\"'@x\"")
})

test("export file names carry the team, the report and the dates", () => {
  assert.equal(csvFileName("Sprint Group", "adherence", "2026-09-08", "to", "2026-10-05"), "sprint-group-adherence-2026-09-08-to-2026-10-05.csv")
  assert.equal(csvFileName("January Speed Testing!", "results"), "january-speed-testing-results.csv")
  assert.equal(csvFileName(null, ""), "export.csv")
})
