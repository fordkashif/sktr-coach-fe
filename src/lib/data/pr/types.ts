export type PrRecord = {
  id: string
  athleteId: string
  event: string
  category: string
  bestValue: string
  previousValue: string | null
  measuredOn: string
  sourceType: "manual" | "test-week" | "import"
  sourceRef: string | null
  isLegal: boolean
  wind: string | null
  note: string | null
}

export type {
  AthleteResult,
  EventBests,
  EventHistory,
  MarkUnit,
  NewResultVerdict,
  ResultEnvironment,
  ResultEvent,
  ResultSource,
  Season,
  Timing,
} from "@/lib/data/pr/marks"
