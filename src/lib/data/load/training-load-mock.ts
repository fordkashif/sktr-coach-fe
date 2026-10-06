import { mergeMockAthletes } from "@/lib/data/coach/roster-mock"
import { listMockDoneSessions, listMockPlannedSessions, MOCK_ATHLETE_ID } from "@/lib/data/session/session-mock"
import { addDaysIso } from "@/lib/data/training-plan/plan-builder-model"
import { mockAthletes } from "@/lib/mock-data"
import type { DoneSession, PlannedSession } from "./training-load"

/**
 * Mock mode only: a believable history of finished sessions for every demo athlete, so the load
 * screens have something to draw. Made from the date alone (no random numbers), so a reload shows
 * the same thing. The signed-in demo athlete (a1) also gets the sessions really finished in this
 * browser, which is how "finish a session, see its load" works in mock mode and in the e2e tests.
 */

export type MockLoadSession = DoneSession & { id: string; title: string }

type Profile = "steady" | "ramp" | "drop" | "new" | "above" | "patchy"

/** Mon, Tue, Thu, Fri. getUTCDay(): 0 is Sunday. */
const WEEK_PATTERN: Record<number, { title: string; effort: number; minutes: number }> = {
  1: { title: "Acceleration and weights", effort: 7, minutes: 75 },
  2: { title: "Tempo and mobility", effort: 4, minutes: 50 },
  4: { title: "Jumps and power", effort: 6, minutes: 70 },
  5: { title: "Speed endurance", effort: 7, minutes: 75 },
}

const PROFILES: Record<string, Profile> = { a1: "steady", a2: "ramp", a3: "drop", a10: "new", a4: "above", a5: "patchy", a7: "drop", a9: "ramp" }

function profileOf(athleteId: string): Profile {
  return PROFILES[athleteId] ?? "steady"
}

function weekday(dateIso: string) {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay()
}

/** A slow wave between 0.85 and 1.15, so weeks differ a little. */
function wave(daysAgo: number, shift: number) {
  return 1 + 0.15 * Math.sin((daysAgo + shift * 9) / 11)
}

function generated(athleteId: string, asOf: string): { done: MockLoadSession[]; planned: PlannedSession[] } {
  const profile = profileOf(athleteId)
  const shift = athleteId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 7
  // The demo athlete's last week comes from the session log itself.
  const newest = athleteId === MOCK_ATHLETE_ID ? 8 : 1
  const oldest = profile === "new" ? 16 : 100
  const done: MockLoadSession[] = []
  const planned: PlannedSession[] = []
  let index = 0
  // The plan runs on to the end of this week; what was done stops at `newest`.
  const daysLeftThisWeek = (7 - weekday(asOf)) % 7
  for (let daysAgo = oldest; daysAgo >= -daysLeftThisWeek; daysAgo -= 1) {
    const date = addDaysIso(asOf, -daysAgo)
    const base = WEEK_PATTERN[weekday(date)]
    if (!base) continue
    index += 1
    // The demo athlete's plan for the days around today comes from their real plan (see mockLoadSessions).
    if (athleteId !== MOCK_ATHLETE_ID || daysAgo >= 8) planned.push({ date, minutes: base.minutes, effort: base.effort })
    if (daysAgo < newest) continue
    if (profile === "drop" && daysAgo <= 9) continue
    // One session in nine is missed, a different one per athlete.
    const recent = daysAgo <= 7
    if ((index + shift) % 9 === 0 && !(recent && (profile === "ramp" || profile === "above"))) continue
    const effort = Math.min(10, base.effort + (recent && profile === "ramp" ? 2 : recent && profile === "above" ? 1 : 0))
    const scale = wave(daysAgo, shift) * (recent && profile === "ramp" ? 1.8 : recent && profile === "above" ? 1.35 : 1)
    const minutes = Math.round((base.minutes * scale) / 5) * 5
    done.push({
      id: `mock-load-${athleteId}-${date}`,
      date,
      title: base.title,
      effort,
      // Some athletes do not always say how long it took: those sessions have no load.
      minutes: profile === "patchy" && index % 4 === 0 ? null : minutes,
    })
  }
  return { done, planned }
}

/** Finished and planned sessions of one demo athlete up to `asOf`. */
export function mockLoadSessions(athleteId: string, asOf: string): { done: MockLoadSession[]; planned: PlannedSession[] } {
  const base = generated(athleteId, asOf)
  if (athleteId !== MOCK_ATHLETE_ID) return base
  const from = addDaysIso(asOf, -7)
  const logged = listMockDoneSessions(athleteId)
  const taken = new Set(logged.map((session) => session.date))
  return {
    done: [...base.done.filter((session) => !taken.has(session.date)), ...logged],
    planned: [...base.planned, ...listMockPlannedSessions(athleteId, from, addDaysIso(asOf, 7))],
  }
}

export function mockLoadAthletes(teamId: string | null): Array<{ id: string; name: string; teamId: string }> {
  return mergeMockAthletes(mockAthletes)
    .filter((athlete) => teamId === null || athlete.teamId === teamId)
    .map((athlete) => ({ id: athlete.id, name: athlete.name, teamId: athlete.teamId }))
}
