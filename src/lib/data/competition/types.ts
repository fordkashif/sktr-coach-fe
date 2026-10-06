import type { AthleteResult, Qualifier, ResultDetail, ResultEnvironment, ResultRound, Timing } from "@/lib/data/pr/marks"

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
  /** The result the entry is known by: its last round. Null until one is recorded. */
  result: AthleteResult | null
  /** Every round recorded for the entry, in running order (heat, quarter final, semi final, final). */
  rounds?: AthleteResult[]
  /** Only filled for staff, who see more than one athlete. */
  athleteName?: string
  /** Staff only: the team the athlete is on now. */
  athleteTeamId?: string | null
}

export type CompetitionWithEntries = Competition & {
  entries: CompetitionEntryWithResult[]
  /** The viewer may edit or delete the competition itself. */
  canManage: boolean
  /** Staff only, for a meet an athlete added for themselves: who that is. */
  ownerName?: string | null
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
  /** Heat, semi final, final. Leave out to keep what the result has; null for "one round". */
  round?: ResultRound | null
  heat?: number | null
  lane?: number | null
  qualifier?: Qualifier | null
  /** Splits, reaction time, attempt series or heights. With a series the mark is worked out from it. */
  detail?: ResultDetail | null
}

/* ---------- Relays ------------------------------------------------------------------------------ */

export type RelayLeg = {
  /** 1 to 4, in running order. */
  leg: number
  /** Null when the athlete's data was deleted. */
  athleteId: string | null
  /** "Former member" for a leg with no athlete. */
  name: string
  /** The time of this leg in seconds, when someone took it. */
  split: number | null
}

/** A relay team at a competition: who runs which leg and, once it is run, the time. */
export type RelayEntry = {
  id: string
  /** Null when the competition was deleted and the time was kept for the team's records. */
  competitionId: string | null
  competitionName: string | null
  teamId: string | null
  teamName: string | null
  /** What the relay team is called on the day: "Sprint Group A". */
  teamLabel: string
  eventKey: string
  eventLabel: string
  round: ResultRound | null
  heat: number | null
  lane: number | null
  place: number | null
  qualifier: Qualifier | null
  /** Seconds. Null until the relay is run. */
  value: number | null
  compareValue: number | null
  /** "43.12", "3:21.50". */
  display: string | null
  timing: Timing | null
  /** YYYY-MM-DD */
  date: string
  environment: ResultEnvironment
  location: string | null
  notes: string | null
  createdAt: string
  legs: RelayLeg[]
  /** The viewer may change or delete it (a coach of the relay's team, a club admin). */
  canManage: boolean
}

export type RelayInput = {
  /** Leave out to add a relay. */
  id?: string | null
  competitionId: string
  eventKey: string
  teamId: string
  teamLabel?: string | null
  legs: Array<{ leg: number; athleteId: string | null; split?: number | null }>
  /** Seconds. Null or left out: the team is entered and has not run yet. */
  value?: number | null
  timing?: Timing | null
  round?: ResultRound | null
  heat?: number | null
  lane?: number | null
  place?: number | null
  qualifier?: Qualifier | null
  date?: string | null
  notes?: string | null
}
