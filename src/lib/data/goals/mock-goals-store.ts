import type { AthleteGoal } from "@/lib/data/goals/goal-logic"
import { MOCK_ATHLETE_ID, mockDay } from "@/lib/data/pr/mock-results-store"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Mock mode only: the demo athlete's goals, kept in this browser. Supabase mode never reads this
 * file. Dates are relative to today so the demo always has one goal in progress, one past its
 * date and one achieved.
 */

const STORAGE_KEY = "pacelab:athlete-goals-v1"

/** The demo athlete is "a1" on the coach's demo roster and "fallback-athlete" in the results demo. */
export function toMockGoalAthleteId(athleteId: string): string {
  return athleteId === "a1" ? MOCK_ATHLETE_ID : athleteId
}

function seedGoals(): AthleteGoal[] {
  const at = (offset: number) => new Date(`${mockDay(offset)}T12:00:00`).toISOString()
  const base = { athleteId: MOCK_ATHLETE_ID, achievedOn: null, achievedResultId: null, achievedManually: false }
  return [
    {
      ...base,
      id: "mock-goal-100m",
      eventKey: "100m",
      eventLabel: "100m",
      eventGroup: "k:100m",
      unit: "s",
      lowerIsBetter: true,
      targetValue: 11.1,
      startValue: 11.39,
      targetDate: mockDay(60),
      note: "Under 11.10 before the season ends.",
      setByStaff: false,
      createdAt: at(-200),
    },
    {
      ...base,
      id: "mock-goal-squat",
      eventKey: "other",
      eventLabel: "Squat 1RM",
      eventGroup: "o:squat 1rm",
      unit: "kg",
      lowerIsBetter: false,
      targetValue: 190,
      startValue: 180,
      targetDate: mockDay(-10),
      note: null,
      setByStaff: true,
      createdAt: at(-300),
    },
    {
      ...base,
      id: "mock-goal-long-jump",
      eventKey: "long_jump",
      eventLabel: "Long jump",
      eventGroup: "k:long_jump",
      unit: "m",
      lowerIsBetter: false,
      targetValue: 6.6,
      startValue: 6.42,
      targetDate: null,
      note: null,
      setByStaff: false,
      createdAt: at(-200),
    },
  ]
}

let memoryGoals: AthleteGoal[] | null = null

export function loadMockGoals(): AthleteGoal[] {
  if (typeof window === "undefined") return memoryGoals ?? (memoryGoals = seedGoals())
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(STORAGE_KEY))
    if (raw) {
      const parsed = JSON.parse(raw) as AthleteGoal[]
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    /* fall through to a fresh demo */
  }
  const seeded = seedGoals()
  saveMockGoals(seeded)
  return seeded
}

export function saveMockGoals(goals: AthleteGoal[]): void {
  memoryGoals = goals
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(tenantStorageKey(STORAGE_KEY), JSON.stringify(goals))
  } catch {
    /* storage full or blocked: the demo still works for this page view */
  }
}
