/**
 * Global search over the demo data (mock mode). It reads the same demo stores the screens read and
 * applies the same rules as the database function: a coach only gets the teams they are on, an
 * athlete only their own things, a guardian only the children linked to them. No health data,
 * notes, message text or guardian contact details are read here either.
 */
import { readStoredMockPlans } from "@/components/coach/training-plan/mock-adapter"
import { mockTestWeeks, readMockEvents } from "@/lib/data/calendar/mock-calendar-store"
import { loadMockSeasons } from "@/lib/data/club-admin/mock-seasons-store"
import { mergeMockAthletes } from "@/lib/data/coach/roster-mock"
import { loadMockSquads } from "@/lib/data/coach/squads-mock"
import { getCompetitionsForCurrentAthlete, getCompetitionsForStaff } from "@/lib/data/competition/competition-data"
import { listMockExercises } from "@/lib/data/exercises/mock-exercise-store"
import { getCurrentAthleteGoals } from "@/lib/data/goals/goals-data"
import { listClubGuardians } from "@/lib/data/guardian/guardian-admin-data"
import { getGuardianChildren, getGuardianResults } from "@/lib/data/guardian/guardian-data"
import { getCurrentAthleteRecords } from "@/lib/data/pr/results-data"
import { listAthleteSessions } from "@/lib/data/session/session-log-data"
import { loadMockAthleteTeamCoaches } from "@/lib/data/athlete/profile-data"
import { listMockTemplates } from "@/lib/data/training-plan/mock-plan-template-store"
import { loadClubTeams, loadClubUsers, loadCoachInvites } from "@/lib/mock-club-admin"
import { mockAthletes, mockTeams, mockTrainingPlans } from "@/lib/mock-data"
import { loadMockPlatformAdminRequests } from "@/lib/mock-platform-admin"
import { rankCandidates, type SearchCandidate, type SearchHit, type SearchRole } from "@/lib/search/model"

export type MockSearchContext = {
  /** The teams the demo coach is on. Ignored for other roles. */
  coachTeamIds: string[]
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

function dayText(iso: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "")
  if (!match) return null
  const month = MONTHS[Number(match[2]) - 1]
  return month ? `${Number(match[3])} ${month.slice(0, 3)} ${match[1]}` : null
}

/** Every way a day can be typed: "2026-03-12", "12 March 2026", "12 Mar 2026". */
function dayWords(iso: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return []
  const month = MONTHS[Number(match[2]) - 1] ?? ""
  return [iso.slice(0, 10), `${Number(match[3])} ${month} ${match[1]}`, `${Number(match[3])} ${month.slice(0, 3)} ${match[1]}`]
}

function join(...parts: Array<string | null | undefined | false>): string | null {
  const text = parts.filter((part): part is string => Boolean(part)).join(", ")
  return text || null
}

/** One source failing (a store that will not parse) must not empty the whole search. */
async function safe(read: () => SearchCandidate[] | Promise<SearchCandidate[]>): Promise<SearchCandidate[]> {
  try {
    return await read()
  } catch {
    return []
  }
}

function isoDayOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

const teamName = (teamId: string | null | undefined) => mockTeams.find((team) => team.id === teamId)?.name ?? null

async function coachCandidates(context: MockSearchContext): Promise<SearchCandidate[]> {
  const teamIds = new Set(context.coachTeamIds)
  const parts = await Promise.all([
    safe(() => {
      const squads = loadMockSquads()
      return mergeMockAthletes(mockAthletes)
        .filter((athlete) => teamIds.has(athlete.teamId))
        .map((athlete) => ({
          kind: "athlete" as const,
          id: athlete.id,
          title: athlete.name,
          subtitle: join(teamName(athlete.teamId), ...squads.filter((squad) => squad.athleteIds.includes(athlete.id)).map((squad) => squad.name)),
        }))
    }),
    safe(() => mockTeams.filter((team) => teamIds.has(team.id)).map((team) => ({ kind: "team" as const, id: team.id, title: team.name, subtitle: team.eventGroup }))),
    safe(() => {
      const stored = readStoredMockPlans().map((plan) => ({ id: plan.id, name: plan.name, teamId: plan.teamId, startDate: plan.startDate, status: plan.status as string }))
      const canned = mockTrainingPlans.filter((plan) => !stored.some((item) => item.id === plan.id)).map((plan) => ({ id: plan.id, name: plan.name, teamId: plan.teamId, startDate: plan.startDate, status: "published" }))
      return [...stored, ...canned]
        .filter((plan) => plan.name && teamIds.has(plan.teamId))
        .map((plan) => ({ kind: "plan" as const, id: plan.id, title: plan.name, subtitle: join(teamName(plan.teamId), plan.status, dayText(plan.startDate)), sortDate: plan.startDate || null }))
    }),
    safe(() =>
      listMockTemplates()
        .filter((template) => !template.archived)
        .map((template) => ({ kind: "template" as const, id: template.id, title: template.name, subtitle: `${template.weeks} ${template.weeks === 1 ? "week" : "weeks"}`, sortDate: template.updatedAt?.slice(0, 10) ?? null })),
    ),
    safe(() => listMockExercises().filter((exercise) => !exercise.archived).map((exercise) => ({ kind: "exercise" as const, id: exercise.id, title: exercise.name, subtitle: exercise.category.charAt(0).toUpperCase() + exercise.category.slice(1) }))),
    safe(() =>
      mockTestWeeks()
        .filter((week) => week.inCoachList && teamIds.has(week.teamId))
        .map((week) => ({ kind: "test_week" as const, id: week.id, title: week.name, subtitle: join(teamName(week.teamId), week.status, dayText(week.startDate)), sortDate: week.startDate })),
    ),
    safe(async () => {
      const seen = new Set<string>()
      const out: SearchCandidate[] = []
      for (const teamId of teamIds) {
        const result = await getCompetitionsForStaff({ teamId })
        if (!result.ok) continue
        for (const competition of result.data) {
          if (seen.has(competition.id)) continue
          seen.add(competition.id)
          out.push({ kind: "competition", id: competition.id, title: competition.name, subtitle: join(dayText(competition.startDate), competition.venue ?? competition.location), extra: competition.venue ? [competition.venue] : [], sortDate: competition.startDate })
        }
      }
      return out
    }),
  ])
  return parts.flat()
}

async function clubAdminCandidates(): Promise<SearchCandidate[]> {
  const clubTeams = (() => {
    try {
      return loadClubTeams()
    } catch {
      return []
    }
  })()
  const clubTeamName = (teamId: string | null | undefined) => clubTeams.find((team) => team.id === teamId)?.name ?? teamName(teamId)
  const parts = await Promise.all([
    safe(() =>
      loadClubUsers()
        .filter((user) => user.role !== "athlete")
        .map((user) => ({ kind: "staff" as const, id: user.id, title: user.name, subtitle: join(user.role === "club-admin" ? "Club admin" : "Coach", user.status === "disabled" && "access off") })),
    ),
    safe(() => mergeMockAthletes(mockAthletes).map((athlete) => ({ kind: "athlete" as const, id: athlete.id, title: athlete.name, subtitle: join("Athlete", clubTeamName(athlete.teamId)) }))),
    safe(async () => {
      const result = await listClubGuardians()
      if (!result.ok) return []
      // Linked guardians by name only. Their email and pending guardian invites are contact details and stay out.
      const byName = new Map<string, { id: string; children: string[] }>()
      for (const row of result.data) {
        if (row.kind !== "link" || !row.guardianName) continue
        const entry = byName.get(row.guardianName) ?? { id: row.id, children: [] }
        entry.children.push(row.athleteName)
        byName.set(row.guardianName, entry)
      }
      return [...byName.entries()].map(([name, entry]) => ({ kind: "guardian" as const, id: entry.id, title: name, subtitle: `Guardian of ${entry.children.join(", ")}` }))
    }),
    safe(() => clubTeams.map((team) => ({ kind: "team" as const, id: team.id, title: team.name, subtitle: join(team.eventGroup, team.status !== "active" && team.status) }))),
    safe(() =>
      loadCoachInvites().map((invite) => ({
        kind: "invite" as const,
        id: invite.id,
        title: invite.email.toLowerCase(),
        subtitle: join(invite.role === "club-admin" ? "Club admin invite" : "Coach invite", invite.status),
        sortDate: invite.createdAt?.slice(0, 10) ?? null,
      })),
    ),
    safe(() => loadMockSeasons().map((season) => ({ kind: "season" as const, id: season.id, title: season.name, subtitle: join(season.status, `${dayText(season.start)} to ${dayText(season.end)}`), sortDate: season.start }))),
    safe(() => readMockEvents().map((event) => ({ kind: "club_event" as const, id: event.id, title: event.title, subtitle: join(dayText(event.startsOn), event.place), extra: event.place ? [event.place] : [], sortDate: event.startsOn }))),
  ])
  return parts.flat()
}

async function athleteCandidates(): Promise<SearchCandidate[]> {
  const parts = await Promise.all([
    safe(async () => {
      const result = await listAthleteSessions(isoDayOffset(-365), isoDayOffset(120))
      if (!result.ok) return []
      return result.data.map((session) => ({
        kind: "session" as const,
        id: session.id,
        title: session.title,
        subtitle: join(dayText(session.date), session.status),
        extra: dayWords(session.date),
        params: { date: session.date },
        sortDate: session.date,
      }))
    }),
    safe(async () => {
      const result = await getCurrentAthleteRecords()
      if (!result.ok) return []
      return result.data.events.map((event) => ({
        kind: "record" as const,
        id: event.group,
        title: event.label,
        subtitle: `Results, ${event.results.length} ${event.results.length === 1 ? "mark" : "marks"}`,
        params: { eventGroup: event.group },
        sortDate: event.results[0]?.date ?? null,
      }))
    }),
    safe(async () => {
      const result = await getCompetitionsForCurrentAthlete()
      if (!result.ok) return []
      return result.data.map((competition) => ({ kind: "competition" as const, id: competition.id, title: competition.name, subtitle: join(dayText(competition.startDate), competition.venue ?? competition.location), extra: competition.venue ? [competition.venue] : [], sortDate: competition.startDate }))
    }),
    safe(async () => {
      const result = await getCurrentAthleteGoals()
      if (!result.ok) return []
      return result.data.goals.map((goal) => ({ kind: "goal" as const, id: goal.id, title: goal.eventLabel, subtitle: join(goal.achievedOn ? "Goal reached" : "Goal", goal.targetDate ? `by ${dayText(goal.targetDate)}` : null), sortDate: goal.targetDate ?? null }))
    }),
    safe(() =>
      loadMockAthleteTeamCoaches().map((coach, index) => ({
        kind: "coach" as const,
        id: coach.userId ?? `coach-${index}`,
        title: coach.name,
        subtitle: coach.isLead ? "Lead coach" : "Coach",
        params: { coachUserId: coach.userId, canMessage: Boolean(coach.userId) },
      })),
    ),
  ])
  return parts.flat()
}

async function guardianCandidates(): Promise<SearchCandidate[]> {
  const children = await getGuardianChildren()
  if (!children.ok) return []
  const out: SearchCandidate[] = children.data.map((child) => ({ kind: "child", id: child.athleteId, title: child.name, subtitle: child.teamName }))
  const seen = new Set<string>()
  for (const child of children.data) {
    const results = await getGuardianResults(child)
    if (!results.ok) continue
    for (const competition of results.data.upcoming) {
      if (seen.has(competition.id)) continue
      seen.add(competition.id)
      out.push({ kind: "competition", id: competition.id, title: competition.name, subtitle: join(dayText(competition.startDate), competition.place), extra: competition.place ? [competition.place] : [], sortDate: competition.startDate })
    }
  }
  return out
}

async function platformAdminCandidates(): Promise<SearchCandidate[]> {
  return safe(() => [
    ...loadMockPlatformAdminRequests().map((request) => {
      const isClub = Boolean(request.provisionedTenantId) || request.status === "approved"
      return {
        kind: isClub ? ("club" as const) : ("request" as const),
        id: request.id,
        title: request.organizationName,
        subtitle: join(request.requestorEmail.toLowerCase(), (isClub ? request.lifecycleStatus : request.status).replace(/_/g, " ")),
        extra: [request.requestorEmail],
        sortDate: request.createdAt?.slice(0, 10) ?? null,
      }
    }),
    { kind: "platform_admin" as const, id: "mock-platform-admin", title: "Platform Admin", subtitle: "platformadmin@pacelab.local", extra: ["platformadmin@pacelab.local"] },
  ])
}

export async function searchMock(role: SearchRole, query: string, context: MockSearchContext): Promise<SearchHit[]> {
  const candidates =
    role === "coach"
      ? await coachCandidates(context)
      : role === "club-admin"
        ? await clubAdminCandidates()
        : role === "athlete"
          ? await athleteCandidates()
          : role === "guardian"
            ? await guardianCandidates()
            : await platformAdminCandidates()
  return rankCandidates(role, candidates, query)
}
