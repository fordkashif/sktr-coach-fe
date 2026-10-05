/**
 * Test week history: each test followed across the athlete's test weeks. Pure, with no runtime
 * imports, so the unit tests can compile it on its own.
 */
import type { AthleteTestWeekHistoryItem, TestDefinitionUnit } from "@/lib/data/test-week/types"

/** Only a time gets better by going down. Distance, height, weight and score go up. */
export function lowerIsBetterForTest(unit: TestDefinitionUnit): boolean {
  return unit === "time"
}

export type TestComparison = {
  /** current minus previous, in the test's unit. */
  difference: number
  direction: "better" | "worse" | "same"
}

/** A result against the one before it, taking the direction of the test into account. */
export function compareTestResults(unit: TestDefinitionUnit, current: number, previous: number): TestComparison {
  const difference = Math.round((current - previous) * 1000) / 1000
  if (difference === 0) return { difference: 0, direction: "same" }
  const better = lowerIsBetterForTest(unit) ? difference < 0 : difference > 0
  return { difference, direction: better ? "better" : "worse" }
}

export type TestSeriesPoint = {
  testWeekId: string
  weekName: string
  /** The day the test was scheduled, YYYY-MM-DD. */
  date: string
  valueText: string
  valueNumeric: number | null
}

export type TestSeries = {
  /** Tests are matched across weeks by name and unit. */
  key: string
  name: string
  unit: TestDefinitionUnit
  lowerIsBetter: boolean
  /** Oldest first. */
  points: TestSeriesPoint[]
  latest: TestSeriesPoint
  /** The time before the latest. */
  previous: TestSeriesPoint | null
  /** The best result with a number. The earliest one when two are equal. */
  best: TestSeriesPoint | null
  /** Latest against previous. Null when either has no number or there is no previous. */
  comparison: TestComparison | null
}

export function testSeriesKey(name: string, unit: TestDefinitionUnit): string {
  return `${name.trim().toLowerCase()}|${unit}`
}

/** One series per test, in the order tests first appear in the newest week. Weeks may come in any order. */
export function buildTestSeries(weeks: AthleteTestWeekHistoryItem[]): TestSeries[] {
  const newestFirst = [...weeks].sort((a, b) => b.startDate.localeCompare(a.startDate))
  const byKey = new Map<string, { name: string; unit: TestDefinitionUnit; points: TestSeriesPoint[] }>()
  for (const week of newestFirst) {
    for (const result of week.results) {
      const key = testSeriesKey(result.name, result.unit)
      const entry = byKey.get(key) ?? { name: result.name, unit: result.unit, points: [] }
      // One point per test week: keep the first seen (a week does not hold the same test twice).
      if (!entry.points.some((point) => point.testWeekId === week.testWeekId)) {
        entry.points.push({ testWeekId: week.testWeekId, weekName: week.name, date: result.scheduledDate || week.startDate, valueText: result.valueText, valueNumeric: result.valueNumeric })
      }
      byKey.set(key, entry)
    }
  }
  return [...byKey.entries()].map(([key, entry]) => {
    const lowerIsBetter = lowerIsBetterForTest(entry.unit)
    const points = [...entry.points].sort((a, b) => a.date.localeCompare(b.date))
    const latest = points[points.length - 1]
    const previous = points.length > 1 ? points[points.length - 2] : null
    let best: TestSeriesPoint | null = null
    for (const point of points) {
      if (point.valueNumeric === null) continue
      if (best === null || best.valueNumeric === null || (lowerIsBetter ? point.valueNumeric < best.valueNumeric : point.valueNumeric > best.valueNumeric)) best = point
    }
    const comparison = previous && latest.valueNumeric !== null && previous.valueNumeric !== null ? compareTestResults(entry.unit, latest.valueNumeric, previous.valueNumeric) : null
    return { key, name: entry.name, unit: entry.unit, lowerIsBetter, points, latest, previous, best, comparison }
  })
}
