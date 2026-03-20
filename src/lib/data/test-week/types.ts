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
}

export type CurrentAthleteTestWeekContext = {
  athleteId: string
  testWeekId: string
  testWeekName: string
  startDate: string
  endDate: string
  tests: ActiveTestDefinition[]
  lastSubmittedAt: string | null
}

export type TestWeekSubmissionResult = {
  athleteId: string
  testWeekId: string
  submittedAt: string
  submittedCount: number
}
