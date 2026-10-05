import type { TestDefinitionUnit } from "@/lib/data/test-week/types"

/**
 * One test result as it is typed, by the athlete or by a coach on their behalf.
 * The rules are the ones the athlete's form has always used: a plain number above 0 with up to
 * three decimals, in the unit fixed by the test. Pure, so the unit tests and both screens share it.
 */

export const TEST_UNIT_META: Record<TestDefinitionUnit, { suffix: string; long: string }> = {
  time: { suffix: "s", long: "seconds" },
  distance: { suffix: "m", long: "metres" },
  weight: { suffix: "kg", long: "kilograms" },
  height: { suffix: "cm", long: "centimetres" },
  score: { suffix: "pts", long: "points" },
}

/** value_numeric is numeric(10, 3): keep entries inside what the column can hold. */
export const MAX_TEST_RESULT_VALUE = 100000

export type CheckedEntry = { ok: true; numeric: number; valueText: string } | { ok: false; message: string }

/**
 * Checks what was typed for a test. A unit typed or pasted after the number ("4.05s", "185 kg") is
 * accepted when it is the test's own unit. `valueText` is what is stored and shown: "4.05s", "72cm", "5400".
 */
export function checkTestResultEntry(raw: string, unit: TestDefinitionUnit): CheckedEntry {
  const suffix = TEST_UNIT_META[unit].suffix
  let normalized = raw.trim().toLowerCase().replace(",", ".")
  if (normalized.endsWith(suffix)) normalized = normalized.slice(0, -suffix.length).trim()
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) return { ok: false, message: `Numbers only, in ${TEST_UNIT_META[unit].long}.` }
  const numeric = Number.parseFloat(normalized)
  if (!(numeric > 0)) return { ok: false, message: "Must be more than 0." }
  if (numeric >= MAX_TEST_RESULT_VALUE) return { ok: false, message: "That number is too large." }
  return { ok: true, numeric, valueText: `${numeric}${suffix === "pts" ? "" : suffix}` }
}

/** The number to put back in a field for a saved result ("4.05s" becomes "4.05"). */
export function entryTextFor(saved: { value: string; numeric: number | null } | null | undefined): string {
  if (!saved) return ""
  if (saved.numeric !== null && Number.isFinite(saved.numeric)) return String(saved.numeric)
  const parsed = Number.parseFloat(saved.value.replace(",", ".").replace(/[^\d.-]/g, ""))
  return Number.isFinite(parsed) ? String(parsed) : ""
}

/**
 * Text copied from a spreadsheet, as rows of cells. One column pasted into a grid is one cell per
 * row; a block is tab separated. Trailing empty rows (the newline a spreadsheet adds) are dropped.
 */
export function parsePastedCells(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, "\n").split("\n")
  while (rows.length > 0 && rows[rows.length - 1].trim() === "") rows.pop()
  return rows.map((row) => row.split("\t").map((cell) => cell.trim()))
}

export type TestWeekCsvInput = {
  weekName: string
  teamName: string
  startDate: string
  endDate: string
  status: string
  tests: Array<{ id: string; name: string; unit: TestDefinitionUnit; dayIndex: number }>
  athletes: Array<{
    name: string
    primaryEvent: string | null
    submittedAt: string | null
    results: Record<string, { value: string; numeric: number | null; enteredBy?: string | null }>
  }>
}

/** Rows for the results export: a short header block, then one row per athlete and one column per test. */
export function testWeekResultsCsvRows(input: TestWeekCsvInput): string[][] {
  const multiDay = new Set(input.tests.map((test) => test.dayIndex)).size > 1
  const header = [
    "Athlete",
    "Primary event",
    ...input.tests.map((test) => `${test.name} (${TEST_UNIT_META[test.unit].suffix})${multiDay ? `, day ${test.dayIndex + 1}` : ""}`),
    "Last entered",
    "Entered by coach",
  ]
  return [
    ["Test week", input.weekName],
    ["Team", input.teamName],
    ["Dates", `${input.startDate} to ${input.endDate}`],
    ["Status", input.status],
    [],
    header,
    ...input.athletes.map((athlete) => {
      const byCoach = input.tests.filter((test) => {
        const role = athlete.results[test.id]?.enteredBy
        return role === "coach" || role === "club-admin"
      })
      return [
        athlete.name,
        athlete.primaryEvent ?? "",
        ...input.tests.map((test) => {
          const result = athlete.results[test.id]
          if (!result) return ""
          return result.numeric !== null && Number.isFinite(result.numeric) ? String(result.numeric) : result.value
        }),
        athlete.submittedAt ? athlete.submittedAt.slice(0, 10) : "",
        byCoach.length === 0 ? "" : byCoach.length === input.tests.filter((test) => athlete.results[test.id]).length ? "All" : byCoach.map((test) => test.name).join("; "),
      ]
    }),
  ]
}
