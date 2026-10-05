import type { AthleteResult, ResultEnvironment } from "@/lib/data/pr/marks"

/** team: one team's meet. club: the whole club. athlete: a meet an athlete added for themselves. */
export type CompetitionScope = "team" | "club" | "athlete"

export type CompetitionLevel = "development" | "school" | "club" | "open" | "regional" | "national" | "international"

export const COMPETITION_LEVELS: Array<{ value: CompetitionLevel; label: string }> = [
  { value: "development", label: "Development" },
  { value: "school", label: "School" },
  { value: "club", label: "Club" },
  { value: "open", label: "Open" },
  { value: "regional", label: "Regional" },
  { value: "national", label: "National" },
  { value: "international", label: "International" },
]

export type Competition = {
  id: string
  scope: CompetitionScope
  teamId: string | null
  ownerAthleteId: string | null
  name: string
  /** YYYY-MM-DD */
  startDate: string
  endDate: string
  venue: string | null
  location: string | null
  level: CompetitionLevel | null
  environment: ResultEnvironment
  notes: string | null
  createdByUserId: string | null
}

export type CompetitionEntryStatus = "entered" | "scratched"

export type CompetitionEntry = {
  id: string
  competitionId: string
  athleteId: string
  eventKey: string
  eventLabel: string
  eventGroup: string
  /** Heat, lane, flight, call time. */
  notes: string | null
  status: CompetitionEntryStatus
  enteredByUserId: string | null
  createdAt: string
}

export type CompetitionEntryWithResult = CompetitionEntry & {
  result: AthleteResult | null
  /** Only filled for staff, who see more than one athlete. */
  athleteName?: string
}

export type CompetitionWithEntries = Competition & {
  entries: CompetitionEntryWithResult[]
  /** The viewer may edit or delete the competition itself. */
  canManage: boolean
}

export type CompetitionInput = {
  name: string
  startDate: string
  endDate?: string | null
  venue?: string | null
  location?: string | null
  level?: CompetitionLevel | null
  environment: ResultEnvironment
  notes?: string | null
}

export type CompetitionEntryInput = {
  eventKey: string
  /** Required when eventKey is "other". */
  eventLabel?: string | null
  notes?: string | null
}

export type CompetitionResultInput = {
  value: number
  timing?: "electronic" | "hand" | null
  wind?: number | null
  place?: number | null
  /** Defaults to the first day of the competition. */
  date?: string | null
  notes?: string | null
  /** Needed for an "other" event, where the entry does not say what the mark is measured in. */
  unit?: "s" | "m" | "cm" | "kg" | "pts"
}
