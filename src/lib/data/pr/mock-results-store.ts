import type { Competition, CompetitionEntry } from "@/lib/data/competition/types"
import {
  compareValueFor,
  eventGroupKey,
  findResultEvent,
  formatMark,
  isWindLegal,
  type AthleteResult,
  type MarkUnit,
  type ResultSource,
  type Timing,
} from "@/lib/data/pr/marks"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Mock mode only: the demo athlete's results, competitions and entries, kept in this browser.
 * Supabase mode never reads this file. Dates are built relative to today so the demo always has
 * an upcoming meet and a current season.
 */

export const MOCK_ATHLETE_ID = "fallback-athlete"
export const MOCK_ATHLETE_USER_ID = "mock-athlete-user"
export const MOCK_COACH_USER_ID = "mock-coach-user"

const STORAGE_KEY = "pacelab:athlete-results-v1"

export type MockTestWeek = { id: string; name: string; startDate: string; endDate: string; status: "published" | "closed" }

export type MockResultsState = {
  results: AthleteResult[]
  competitions: Competition[]
  entries: CompetitionEntry[]
  testWeeks: MockTestWeek[]
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function mockDay(offsetDays: number): string {
  const now = new Date()
  return dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays))
}

export function mockId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
  return `${prefix}-${random}`
}

type ResultSeed = {
  id?: string
  eventKey: string
  label?: string
  unit?: MarkUnit
  value: number
  day: number
  source: ResultSource
  wind?: number | null
  timing?: Timing | null
  place?: number | null
  location?: string | null
  competitionId?: string | null
  competitionEntryId?: string | null
  testResultId?: string | null
  enteredBy?: string | null
  notes?: string | null
  environment?: "outdoor" | "indoor"
}

/** Builds a stored result the way the database trigger would: label, unit, direction and display from the event. */
export function buildMockResult(seed: ResultSeed & { date?: string; athleteId?: string; altitude?: boolean; createdAt?: string }): AthleteResult {
  const event = findResultEvent(seed.eventKey)
  const listed = event && event.kind !== "other" ? event : null
  const unit: MarkUnit = listed?.unit ?? seed.unit ?? "s"
  const label = listed?.name ?? (seed.label ?? "Other").replace(/\s+/g, " ").trim()
  const timing = unit === "s" ? (seed.timing ?? null) : null
  const environment = seed.environment ?? "outdoor"
  const wind = listed?.windApplies && environment === "outdoor" && seed.wind !== undefined ? seed.wind : null
  const date = seed.date ?? mockDay(seed.day)
  return {
    id: seed.id ?? mockId("result"),
    athleteId: seed.athleteId ?? MOCK_ATHLETE_ID,
    eventKey: listed?.key ?? "other",
    eventLabel: label,
    eventGroup: eventGroupKey(listed?.key ?? "other", label),
    unit,
    lowerIsBetter: listed?.lowerIsBetter ?? unit === "s",
    value: seed.value,
    compareValue: compareValueFor(seed.value, timing, listed),
    display: formatMark(seed.value, unit, timing),
    timing,
    date,
    source: seed.source,
    competitionId: seed.competitionId ?? null,
    competitionEntryId: seed.competitionEntryId ?? null,
    testResultId: seed.testResultId ?? null,
    place: seed.competitionId ? (seed.place ?? null) : null,
    wind,
    windLegal: isWindLegal(wind),
    environment,
    altitude: Boolean(seed.altitude),
    location: seed.location ?? null,
    notes: seed.notes ?? null,
    enteredByUserId: seed.enteredBy === undefined ? MOCK_ATHLETE_USER_ID : seed.enteredBy,
    createdAt: seed.createdAt ?? new Date(`${date}T12:00:00`).toISOString(),
  }
}

function competition(id: string, name: string, startOffset: number, extra: Partial<Competition> = {}): Competition {
  return {
    id,
    scope: "team",
    teamId: "t1",
    ownerAthleteId: null,
    name,
    startDate: mockDay(startOffset),
    endDate: mockDay(startOffset),
    venue: null,
    location: null,
    level: null,
    environment: "outdoor",
    notes: null,
    createdByUserId: MOCK_COACH_USER_ID,
    ...extra,
  }
}

function entry(id: string, competitionId: string, eventKey: string, extra: Partial<CompetitionEntry> = {}): CompetitionEntry {
  const event = findResultEvent(eventKey)
  const label = event?.name ?? "Other"
  return {
    id,
    competitionId,
    athleteId: MOCK_ATHLETE_ID,
    eventKey,
    eventLabel: label,
    eventGroup: eventGroupKey(eventKey, label),
    notes: null,
    status: "entered",
    enteredByUserId: MOCK_COACH_USER_ID,
    createdAt: new Date().toISOString(),
    ...extra,
  }
}

function seedState(): MockResultsState {
  const competitions: Competition[] = [
    competition("mock-comp-classic", "City Sprint Classic", 12, { venue: "Riverside Track", location: "Kingston", level: "open" }),
    competition("mock-comp-champs", "Club Championships", 40, { scope: "club", teamId: null, venue: "National Stadium", location: "Kingston", level: "club", endDate: mockDay(41) }),
    competition("mock-comp-relays", "Autumn Open", -30, { venue: "Riverside Track", location: "Kingston", level: "open" }),
    competition("mock-comp-summer", "Summer Open", -86, { venue: "National Stadium", location: "Kingston", level: "open" }),
    competition("mock-comp-early", "Early Season Meet", -163, { venue: "University Track", location: "Mona", level: "development" }),
  ]

  const entries: CompetitionEntry[] = [
    entry("mock-entry-classic-100", "mock-comp-classic", "100m", { notes: "Heats from 10:30" }),
    entry("mock-entry-classic-200", "mock-comp-classic", "200m"),
    entry("mock-entry-relays-100", "mock-comp-relays", "100m"),
    entry("mock-entry-relays-200", "mock-comp-relays", "200m"),
    entry("mock-entry-summer-100", "mock-comp-summer", "100m"),
    entry("mock-entry-summer-200", "mock-comp-summer", "200m"),
    entry("mock-entry-summer-lj", "mock-comp-summer", "long_jump"),
    entry("mock-entry-early-100", "mock-comp-early", "100m"),
    entry("mock-entry-early-200", "mock-comp-early", "200m"),
  ]

  const testWeeks: MockTestWeek[] = [
    { id: "fallback-test-week-autumn", name: "Autumn test week", startDate: mockDay(-322), endDate: mockDay(-320), status: "closed" },
    { id: "fallback-test-week", name: "Spring test week", startDate: mockDay(-217), endDate: mockDay(-215), status: "closed" },
  ]

  const meet = (competitionId: string, entryId: string, name: string) => ({ source: "competition" as const, competitionId, competitionEntryId: entryId, location: name })
  const test = (weekId: string, name: string) => ({ source: "test_week" as const, testResultId: `${weekId}:${name}`, location: weekId === "fallback-test-week" ? "Spring test week" : "Autumn test week" })

  const seeds: ResultSeed[] = [
    // 100m: two seasons, one wind assisted mark faster than the personal best.
    { eventKey: "100m", value: 11.62, day: -520, wind: 0.8, source: "manual", location: "Schools Championships" },
    { eventKey: "100m", value: 11.48, day: -480, wind: 1.5, source: "manual", location: "Spring Open" },
    { eventKey: "100m", value: 11.39, day: -440, wind: 0.3, source: "manual", location: "National Juniors" },
    { eventKey: "100m", value: 11.45, day: -205, wind: -0.6, source: "manual", location: "Season Opener" },
    { eventKey: "100m", value: 11.31, day: -163, wind: 1.1, place: 3, ...meet("mock-comp-early", "mock-entry-early-100", "Early Season Meet") },
    { eventKey: "100m", value: 11.21, day: -121, wind: 2.6, source: "manual", location: "Twilight Meet" },
    { eventKey: "100m", value: 11.28, day: -86, wind: 0.9, place: 2, ...meet("mock-comp-summer", "mock-entry-summer-100", "Summer Open") },
    { eventKey: "100m", value: 11.35, day: -30, wind: -1.2, place: 4, ...meet("mock-comp-relays", "mock-entry-relays-100", "Autumn Open") },
    // 200m
    { eventKey: "200m", value: 23.4, day: -470, wind: 0.2, source: "manual", location: "Spring Open" },
    { eventKey: "200m", value: 23.12, day: -163, wind: 1.8, place: 2, ...meet("mock-comp-early", "mock-entry-early-200", "Early Season Meet") },
    { eventKey: "200m", value: 22.96, day: -86, wind: 0.4, place: 1, ...meet("mock-comp-summer", "mock-entry-summer-200", "Summer Open") },
    // Long jump
    { eventKey: "long_jump", value: 6.42, day: -450, wind: 0.9, source: "manual", location: "National Juniors" },
    { eventKey: "long_jump", value: 6.58, day: -150, wind: 1.4, source: "training", location: "Riverside Track" },
    { eventKey: "long_jump", value: 6.71, day: -86, wind: 2.9, place: 4, ...meet("mock-comp-summer", "mock-entry-summer-lj", "Summer Open") },
    { eventKey: "long_jump", value: 6.63, day: -60, wind: 0, source: "training", location: "Riverside Track" },
    // Test weeks
    { eventKey: "other", label: "30m", unit: "s", value: 4.1, day: -322, ...test("fallback-test-week-autumn", "30m") },
    { eventKey: "other", label: "Flying 30m", unit: "s", value: 2.95, day: -322, ...test("fallback-test-week-autumn", "Flying 30m") },
    { eventKey: "other", label: "Squat 1RM", unit: "kg", value: 180, day: -321, ...test("fallback-test-week-autumn", "Squat 1RM") },
    { eventKey: "other", label: "CMJ", unit: "cm", value: 72, day: -320, ...test("fallback-test-week-autumn", "CMJ") },
    { eventKey: "other", label: "30m", unit: "s", value: 4.05, day: -217, ...test("fallback-test-week", "30m") },
    { eventKey: "other", label: "Flying 30m", unit: "s", value: 2.89, day: -217, ...test("fallback-test-week", "Flying 30m") },
    { eventKey: "other", label: "150m", unit: "s", value: 16.8, day: -216, ...test("fallback-test-week", "150m") },
    { eventKey: "other", label: "Squat 1RM", unit: "kg", value: 185, day: -216, ...test("fallback-test-week", "Squat 1RM") },
    { eventKey: "other", label: "CMJ", unit: "cm", value: 70, day: -215, ...test("fallback-test-week", "CMJ") },
  ]

  const results = seeds.map((seed, index) =>
    buildMockResult({
      ...seed,
      id: `mock-result-${index + 1}`,
      // Everything in the demo was entered by the athlete, so manual and competition marks can be corrected.
      enteredBy: MOCK_ATHLETE_USER_ID,
    }),
  )

  return { results, competitions, entries, testWeeks }
}

let memoryState: MockResultsState | null = null

export function loadMockResultsState(): MockResultsState {
  if (typeof window === "undefined") return memoryState ?? (memoryState = seedState())
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(STORAGE_KEY))
    if (raw) {
      const parsed = JSON.parse(raw) as MockResultsState
      if (parsed && Array.isArray(parsed.results) && Array.isArray(parsed.competitions) && Array.isArray(parsed.entries)) {
        return { ...parsed, testWeeks: parsed.testWeeks ?? [] }
      }
    }
  } catch {
    /* fall through to a fresh demo */
  }
  const seeded = seedState()
  saveMockResultsState(seeded)
  return seeded
}

export function saveMockResultsState(state: MockResultsState): void {
  memoryState = state
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(tenantStorageKey(STORAGE_KEY), JSON.stringify(state))
  } catch {
    /* storage full or blocked: the demo still works for this page view */
  }
}

/** Applies a change to the stored demo and returns the new state. */
export function updateMockResultsState(change: (state: MockResultsState) => MockResultsState): MockResultsState {
  const next = change(loadMockResultsState())
  saveMockResultsState(next)
  return next
}
