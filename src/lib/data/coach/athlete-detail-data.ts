import { availabilityCovers, listAthleteAvailability } from "@/lib/data/athlete/availability-data"
import { EMPTY_ATHLETE_PRIVATE_DETAILS, loadMockAthletePrivateDetails, MOCK_ATHLETE_ID } from "@/lib/data/athlete/profile-data"
import {
  getCoachAthleteDetailForCurrentUser,
  updateCoachSessionNoteForCurrentUser,
  type CoachAthleteDetail,
  type CoachAthleteSessionRow,
  type CoachAthleteWellnessRow,
} from "@/lib/data/coach/dashboard-data"
import { listMockCoachEnteredSessions } from "@/lib/data/coach/athlete-log-data"
import { loadMockRoster, mergeMockAthletes, mockSessionIdentity } from "@/lib/data/coach/roster-mock"
import { mockStaffEnteredSessionIds } from "@/lib/data/session/logged-by-data"
import { err, ok, type Result } from "@/lib/data/result"
import { listMockLoggedSessions } from "@/lib/data/session/session-mock"
import { getOpenPainReportsForAthlete } from "@/lib/data/wellness/pain-report-data"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Everything the coach's athlete screen shows, in both backend modes.
 * Supabase: getCoachAthleteDetailForCurrentUser (the database decides whether the caller may see
 * this athlete: a coach of their team or a club admin). Mock: the demo data, with what was changed
 * in this browser applied (roster-mock.ts, availability, logged sessions, pain reports).
 */

const MOCK_NOTES_KEY = "pacelab:coach-session-notes:v1"

function readMockNotes(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(MOCK_NOTES_KEY)) ?? "{}") as Record<string, string>
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function isoDay(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`
}

/** Demo only: stands in for "no team" so an unassigned athlete still resolves. No demo team has this id. */
const NO_TEAM = "no-team"

async function mockDetail(athleteId: string): Promise<Result<CoachAthleteDetail>> {
  const module = await import("@/lib/mock-data")
  const stored = loadMockRoster()
  // An athlete who is on no team is still an athlete of the club: a club admin can open them, as on
  // the real backend. Coaches only reach athletes on a team.
  const state =
    mockSessionIdentity().role === "club-admin"
      ? {
          ...stored,
          teamOverride: Object.fromEntries(Object.entries(stored.teamOverride).map(([id, teamId]) => [id, teamId ?? NO_TEAM])),
          added: stored.added.map((item) => (item.active && !item.teamId ? { ...item, teamId: NO_TEAM } : item)),
        }
      : stored
  const athlete = mergeMockAthletes(module.mockAthletes, state).find((item) => item.id === athleteId)
  if (!athlete) return err("NOT_FOUND", "Athlete not found.")
  const team = module.mockTeams.find((item) => item.id === athlete.teamId)

  const [availabilityResult, painResult] = await Promise.all([listAthleteAvailability([athleteId]), getOpenPainReportsForAthlete(athleteId)])
  const availability = availabilityResult.ok ? availabilityResult.data : []
  const openPainReports = painResult.ok ? painResult.data : []

  // The demo has a week of scored readiness per athlete and a few full check-ins. Show both as check-ins.
  const fullByDate = new Map(module.mockWellness.filter((entry) => entry.athleteId === athleteId).map((entry) => [entry.date, entry]))
  const trend = module.mockTrendSeries[athleteId] ?? []
  const wellness: CoachAthleteWellnessRow[] = trend
    .map((point, index): CoachAthleteWellnessRow => {
      const full = fullByDate.get(point.date)
      return {
        id: full?.id ?? `trend-${athleteId}-${index}`,
        athleteId,
        date: point.date,
        sleep: full?.sleep ?? 7.5,
        soreness: full?.soreness ?? Math.max(1, Math.min(5, Math.round(point.fatigue / 20))),
        fatigue: full?.fatigue ?? Math.max(1, Math.min(5, Math.round(point.fatigue / 20))),
        mood: full?.mood ?? 4,
        stress: full?.stress ?? 2,
        notes: full?.notes,
        readiness: point.readiness >= 75 ? "green" : point.readiness >= 55 ? "yellow" : "red",
        readinessScore: point.readiness,
        trainingLoad: point.trainingLoad,
      }
    })
    .reverse()
  for (const full of fullByDate.values()) {
    if (!wellness.some((row) => row.date === full.date)) {
      wellness.push({ ...full, readinessScore: full.readiness === "green" ? 84 : full.readiness === "yellow" ? 64 : 42, trainingLoad: 0 })
    }
  }
  wellness.sort((left, right) => right.date.localeCompare(left.date))

  const notes = readMockNotes()
  const staffEntered = mockStaffEnteredSessionIds(athleteId)
  const sessions: CoachAthleteSessionRow[] = [
    // Marcus logs for himself in this browser; for the other demo athletes this is what staff entered for them.
    ...[...listMockLoggedSessions(athleteId), ...listMockCoachEnteredSessions(athleteId)].map(
      (logged): CoachAthleteSessionRow => ({
        id: logged.id,
        athleteId,
        type: "Strength",
        title: logged.title,
        date: logged.date,
        details: "",
        isoDate: logged.date,
        status: logged.status,
        origin: logged.origin,
        skipReason: logged.skipReason,
        skipNote: logged.skipNote,
        excused: logged.status !== "completed" && availability.some((period) => availabilityCovers(period, logged.date)),
        coachNote: notes[logged.id] ?? null,
        completedOn: logged.completedOn,
        durationMinutes: null,
        results: logged.results,
        enteredByStaff: staffEntered.has(logged.id),
      }),
    ),
    ...module.mockLogs
      .filter((log) => log.athleteId === athleteId)
      .map((log): CoachAthleteSessionRow => {
        const day = isoDay(log.date) ?? log.date
        return {
          ...log,
          isoDate: day,
          status: "completed",
          origin: "plan",
          skipReason: null,
          skipNote: null,
          excused: false,
          coachNote: notes[log.id] ?? null,
          completedOn: day,
          durationMinutes: null,
          results: null,
        }
      }),
  ]

  const managed = athlete.managed
  const privateDetails = managed
    ? managed.guardianName || managed.guardianPhone || managed.guardianEmail
      ? { ...EMPTY_ATHLETE_PRIVATE_DETAILS, guardianName: managed.guardianName, guardianPhone: managed.guardianPhone, guardianEmail: managed.guardianEmail }
      : null
    : athleteId === MOCK_ATHLETE_ID
      ? loadMockAthletePrivateDetails()
      : null

  return ok({
    athlete: {
      id: athlete.id,
      name: athlete.name,
      teamId: athlete.teamId,
      teamName: team?.name ?? null,
      eventGroup: athlete.eventGroup,
      primaryEvent: athlete.primaryEvent,
      hasLogin: athlete.hasLogin,
      readiness: athlete.hasLogin || wellness.length > 0 ? athlete.readiness : null,
    },
    dateOfBirth: athlete.dateOfBirth,
    readinessFlag: athlete.readiness,
    wellness,
    availability,
    sessions,
    prs: [],
    tests: [],
    openPainReports,
    openPainReportCount: openPainReports.length,
    hasPainAffectingTraining: openPainReports.some((report) => report.trainingImpact !== "none"),
    privateDetails,
  })
}

export async function loadCoachAthleteDetail(athleteId: string): Promise<Result<CoachAthleteDetail>> {
  if (getBackendMode() !== "supabase") return mockDetail(athleteId)
  // No team scope is passed: the athlete in the address decides, and the database only answers for
  // an athlete on one of the caller's teams.
  return getCoachAthleteDetailForCurrentUser(athleteId)
}

/** Saves the coach note on one of the athlete's sessions. The athlete sees it when they open that session. */
export async function saveCoachSessionNote(athleteId: string, sessionId: string, note: string): Promise<Result<{ coachNote: string | null }>> {
  if (getBackendMode() !== "supabase") {
    const coachNote = note.trim() ? note.trim().slice(0, 1000) : null
    try {
      const notes = readMockNotes()
      if (coachNote) notes[sessionId] = coachNote
      else delete notes[sessionId]
      window.localStorage.setItem(tenantStorageKey(MOCK_NOTES_KEY), JSON.stringify(notes))
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    return ok({ coachNote })
  }
  return updateCoachSessionNoteForCurrentUser(athleteId, sessionId, note)
}
