// Mock mode only: where the calendar finds dated things when there is no database.
// Club events and the feed switch are kept in this browser, per club. Plans, test weeks and the
// roster are read from the same demo data and browser storage the other mock screens use.

import { readStoredMockPlans } from "@/components/coach/training-plan/mock-adapter"
import { mockAthletePlans } from "@/lib/data/session/session-mock"
import { planBlueprints } from "@/lib/data/session/session-from-plan"
import { addDaysIso, todayIso } from "@/lib/data/training-plan/plan-builder-model"
import { mockAthletes, mockTeams } from "@/lib/mock-data"
import { tenantStorageKey } from "@/lib/tenant-storage"
import type { ClubEvent, PlannedDay } from "./model"

const EVENTS_KEY = "pacelab:club-events:v1"
const FEED_KEY = "pacelab:calendar-feed:v1"
/** The key the mock test week screen saves under (src/components/coach/test-week-page-client.tsx). */
const TEST_WEEKS_KEY = "pacelab:test-weeks-v2"

export const MOCK_ATHLETE_TEAM_ID = "t1"
export const MOCK_CALENDAR_ATHLETE_ID = "a1"

/* ---------- Club events ---------- */

function seedEvents(): ClubEvent[] {
  const today = todayIso()
  return [
    { id: "mock-event-parents", title: "Parents' meeting", startsOn: addDaysIso(today, 3), endsOn: addDaysIso(today, 3), startTime: "18:00", endTime: "19:30", place: "Club house", note: "Season plan, kit orders and travel to meets.", audience: "club", teamIds: [], createdByRole: "club-admin" },
    { id: "mock-event-track", title: "Track closed for resurfacing", startsOn: addDaysIso(today, 6), endsOn: addDaysIso(today, 6), startTime: null, endTime: null, place: null, note: null, audience: "club", teamIds: [], createdByRole: "club-admin" },
    { id: "mock-event-camp", title: "Sprint camp", startsOn: addDaysIso(today, 10), endsOn: addDaysIso(today, 12), startTime: null, endTime: null, place: "Mandeville", note: "Bus leaves the club at 7:00 am.", audience: "teams", teamIds: ["t1"], createdByRole: "coach" },
    { id: "mock-event-throws", title: "Throws clinic", startsOn: addDaysIso(today, 8), endsOn: addDaysIso(today, 8), startTime: "09:00", endTime: "12:00", place: "Throws field", note: null, audience: "teams", teamIds: ["t4"], createdByRole: "club-admin" },
  ]
}

export function readMockEvents(): ClubEvent[] {
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(EVENTS_KEY))
    if (!raw) return seedEvents()
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as ClubEvent[]) : seedEvents()
  } catch {
    return seedEvents()
  }
}

export function writeMockEvents(events: ClubEvent[]) {
  window.localStorage.setItem(tenantStorageKey(EVENTS_KEY), JSON.stringify(events))
}

/* ---------- Feed switch ---------- */

export type MockFeedState = { on: boolean; madeAt: string | null }

export function readMockFeed(): MockFeedState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(FEED_KEY)) ?? "null") as Partial<MockFeedState> | null
    return parsed?.on ? { on: true, madeAt: typeof parsed.madeAt === "string" ? parsed.madeAt : null } : { on: false, madeAt: null }
  } catch {
    return { on: false, madeAt: null }
  }
}

export function writeMockFeed(state: MockFeedState) {
  window.localStorage.setItem(tenantStorageKey(FEED_KEY), JSON.stringify(state))
}

/* ---------- Things the other mock screens own ---------- */

export function mockTeamList(): Array<{ id: string; name: string }> {
  return mockTeams.map((team) => ({ id: team.id, name: team.name }))
}

export function mockTeamAthletes(teamId: string): Array<{ id: string; name: string }> {
  return mockAthletes.filter((athlete) => athlete.teamId === teamId).map((athlete) => ({ id: athlete.id, name: athlete.name }))
}

/** Planned sessions of the given teams: plans a coach published in this browser, and the demo block of the demo athlete's team. */
export function mockPlannedDays(teamIds: string[]): PlannedDay[] {
  const names = new Map(mockTeams.map((team) => [team.id, team.name]))
  const days: PlannedDay[] = []
  let stored: ReturnType<typeof readStoredMockPlans> = []
  try {
    stored = readStoredMockPlans()
  } catch {
    stored = []
  }
  for (const plan of stored) {
    if (plan.status !== "published" || !teamIds.includes(plan.teamId)) continue
    for (const blueprint of planBlueprints(plan)) {
      days.push({ date: blueprint.date, title: blueprint.title, planId: plan.id, teamId: plan.teamId, teamName: names.get(plan.teamId) ?? null })
    }
  }
  if (teamIds.includes(MOCK_ATHLETE_TEAM_ID)) {
    const demo = mockAthletePlans().find((plan) => plan.summary.id === "demo-plan")
    for (const week of demo?.detail.weeks ?? []) {
      for (const day of week.days) {
        days.push({ date: day.date.slice(0, 10), title: day.title, planId: null, teamId: MOCK_ATHLETE_TEAM_ID, teamName: names.get(MOCK_ATHLETE_TEAM_ID) ?? null })
      }
    }
  }
  return days
}

export type MockTestWeek = { id: string; name: string; teamId: string; startDate: string; endDate: string; status: "draft" | "published" | "closed"; inCoachList: boolean }

/** Test weeks: the ones saved by the mock test week screen, and the demo week the mock athlete is in right now. */
export function mockTestWeeks(): MockTestWeek[] {
  const weeks: MockTestWeek[] = []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(TEST_WEEKS_KEY)) ?? "[]") as unknown
    if (Array.isArray(parsed)) {
      for (const row of parsed as Array<Record<string, unknown>>) {
        if (!row || typeof row.id !== "string" || typeof row.startDate !== "string" || typeof row.endDate !== "string" || row.isArchived === true) continue
        weeks.push({
          id: row.id,
          name: typeof row.name === "string" ? row.name : "Test week",
          teamId: typeof row.teamId === "string" ? row.teamId : "",
          startDate: row.startDate,
          endDate: row.endDate,
          status: row.status === "draft" || row.status === "closed" ? row.status : "published",
          inCoachList: true,
        })
      }
    }
  } catch {
    // Nothing saved, or storage is blocked: the demo week below is still shown.
  }
  const today = todayIso()
  // The same dates as the athlete's mock test week screen (it starts yesterday and runs three days).
  weeks.push({ id: "fallback-week", name: "Speed and power testing", teamId: MOCK_ATHLETE_TEAM_ID, startDate: addDaysIso(today, -1), endDate: addDaysIso(today, 1), status: "published", inCoachList: false })
  return weeks
}
