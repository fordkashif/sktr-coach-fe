export type TestDefinitionUnit = "time" | "distance" | "weight" | "height" | "score"

export type TestBenchmarkResult = {
  testDefinitionId: string
  label: string
  unit: TestDefinitionUnit
  valueText: string
  valueNumeric: number | null
  submittedAt: string
}

export type LatestBenchmarkSnapshot = {
  athleteId: string
  testWeekId: string
  testWeekName: string
  startDate: string
  endDate: string
  results: TestBenchmarkResult[]
}

export type ActiveTestDefinition = {
  id: string
  name: string
  unit: TestDefinitionUnit
  isRequired: boolean
  scheduledDate: string
  dayIndex: number
}

export type CurrentAthleteTestWeekContext = {
  athleteId: string
  testWeekId: string
  testWeekName: string
  startDate: string
  endDate: string
  /** Athletes only ever get published (open) or closed (read only) weeks. Drafts and archived weeks are never returned. */
  status: "published" | "closed"
  tests: ActiveTestDefinition[]
  lastSubmittedAt: string | null
  /** This athlete's saved results for this week, keyed by test definition id. */
  results: Record<string, { valueText: string; valueNumeric: number | null; submittedAt: string }>
  /** Most recent result from an earlier test week for a test with the same name, keyed by this week's test definition id. */
  previous: Record<string, { valueText: string; submittedAt: string }>
}

export type TestWeekSubmissionResult = {
  athleteId: string
  testWeekId: string
  submittedAt: string
  submittedCount: number
  /** Tests where this submission became the athlete's personal best. */
  newPersonalBests: string[]
  /** The same tests with the new mark and the mark it replaced (null for a first result). */
  personalBests: Array<{ testName: string; mark: string; previous: string | null }>
  /** Set when results saved but a personal best record could not be updated. */
  prWarning: string | null
}

/** One past (or still open) test week with the athlete's own results. */
export type AthleteTestWeekHistoryItem = {
  testWeekId: string
  name: string
  startDate: string
  endDate: string
  status: "published" | "closed"
  results: Array<{
    testDefinitionId: string
    name: string
    unit: TestDefinitionUnit
    valueText: string
    valueNumeric: number | null
    scheduledDate: string
    submittedAt: string
    /** The result for a test of the same name in the test week before this one. */
    previousValueText: string | null
    /** Movement against that result. Null when there is none or the marks are equal. */
    change: { text: string; improved: boolean } | null
  }>
}
