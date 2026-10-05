import type { PrRecord } from "@/lib/data/pr/types"
import type { LatestBenchmarkSnapshot } from "@/lib/data/test-week/types"

/** Demo records for mock mode only. Supabase mode never reads this file. */
const MOCK_ATHLETE_ID = "fallback-athlete"
const MOCK_TEST_WEEK_ID = "fallback-test-week"

function mockPr(id: string, event: string, category: string, bestValue: string, previousValue: string, measuredOn: string, sourceRef: string | null): PrRecord {
  return {
    id,
    athleteId: MOCK_ATHLETE_ID,
    event,
    category,
    bestValue,
    previousValue,
    measuredOn,
    sourceType: "test-week",
    sourceRef,
    isLegal: true,
    wind: null,
    note: null,
  }
}

export const mockPrRecords: PrRecord[] = [
  mockPr("fallback-pr-1", "30m", "Sprint", "4.05s", "4.10s", "2026-03-02", `${MOCK_TEST_WEEK_ID}:30m`),
  mockPr("fallback-pr-2", "Flying 30m", "Sprint", "2.89s", "2.95s", "2026-03-02", `${MOCK_TEST_WEEK_ID}:flying-30m`),
  mockPr("fallback-pr-3", "Squat 1RM", "Strength", "185kg", "180kg", "2026-03-02", `${MOCK_TEST_WEEK_ID}:squat`),
  mockPr("fallback-pr-4", "CMJ", "Jumps", "72cm", "70cm", "2025-11-18", "fallback-test-week-autumn:cmj"),
]

export const mockLatestBenchmarks: LatestBenchmarkSnapshot = {
  athleteId: MOCK_ATHLETE_ID,
  testWeekId: MOCK_TEST_WEEK_ID,
  testWeekName: "Spring test week",
  startDate: "2026-03-02",
  endDate: "2026-03-06",
  results: [
    { testDefinitionId: "30m", label: "30m", unit: "time", valueText: "4.05s", valueNumeric: 4.05, submittedAt: "2026-03-02T15:00:00.000Z" },
    { testDefinitionId: "flying-30m", label: "Flying 30m", unit: "time", valueText: "2.89s", valueNumeric: 2.89, submittedAt: "2026-03-02T15:00:00.000Z" },
    { testDefinitionId: "squat", label: "Squat 1RM", unit: "weight", valueText: "185kg", valueNumeric: 185, submittedAt: "2026-03-04T15:00:00.000Z" },
    { testDefinitionId: "cmj", label: "CMJ", unit: "height", valueText: "70cm", valueNumeric: 70, submittedAt: "2026-03-04T15:00:00.000Z" },
  ],
}
