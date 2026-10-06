import { getMyAvailability, listAthleteAvailability, availabilityCovers } from "@/lib/data/athlete/availability-data"
import { getCompetitionsForCurrentAthlete, getCompetitionsForStaff } from "@/lib/data/competition/competition-data"
import type { CompetitionWithEntries } from "@/lib/data/competition/types"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { listAthleteSessions } from "@/lib/data/session/session-log-data"
import { mockAthletePlans } from "@/lib/data/session/session-mock"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { listClubEvents } from "./club-events-data"
import { MOCK_ATHLETE_TEAM_ID, mockPlannedDays, mockTeamAthletes, mockTeamList, mockTestWeeks } from "./mock-calendar-store"
import {
  athleteSessionItems,
  clubEventItem,
  sessionCountItems,
  teamSessionItems,
  unavailableItems,
  type CalendarItem,
  type ClubEvent,
  type PlannedDay,
} from "./model"

/**
 * Everything dated, read for one of the three calendars. Each loader returns a flat list of
 * CalendarItem for a range of days (the month grid's range), plus the club events on their own so a
 * screen can open one to edit it.
 *
 * Nothing new is stored for sessions, test weeks, competitions or availability: they are read from
 * where they already live, under the row policies that already protect them (a coach gets their
 * own teams, an athlete their own rows). Only club events are the calendar's own (club-events-data.ts).
 */

export type CalendarRange = { from: string; to: string }
export type CalendarTeam = { id: string; name: string }
export type CalendarData = { items: CalendarItem[]; events: ClubEvent[]; teams: CalendarTeam[]; warnings: string[] }

const isMock = () => getBackendMode() !== "supabase"
const inRange = (startsOn: string, endsOn: string, range: CalendarRange) => endsOn >= range.from && startsOn <= range.to

type TestWeekLite = { id: string; name: string; teamId: string | null; startDate: string; endDate: string; status: string; linkable: boolean }

/* ---------- Shared reads ---------------------------------------------------------------------- */

type PlanRow = {
  id: string
  team_id: string | null
  training_plan_weeks: Array<{ training_plan_days: Array<{ date: string; title: string; is_training_day: boolean | null }> | null }> | null
}

/** Days of published plans. `teamIds` null means every team the caller may read (a club admin's whole club). */
async function readPlannedDays(teamIds: string[] | null, range: CalendarRange, teamNames: Map<string, string>): Promise<Result<PlannedDay[]>> {
  if (isMock()) {
    const ids = teamIds ?? mockTeamList().map((team) => team.id)
    return ok(mockPlannedDays(ids).filter((day) => day.date >= range.from && day.date <= range.to))
  }
  if (teamIds && teamIds.length === 0) return ok([])
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  let query = client
    .from("training_plans")
    .select("id, team_id, training_plan_weeks(training_plan_days(date, title, is_training_day))")
    .eq("status", "published")
    .not("team_id", "is", null)
    .order("start_date", { ascending: false })
    .limit(200)
  if (teamIds) query = query.in("team_id", teamIds)
  const { data, error } = await query
  if (error) return { ok: false, error: mapPostgrestError(error) }
  const days: PlannedDay[] = []
  for (const plan of (data as PlanRow[] | null) ?? []) {
    for (const week of plan.training_plan_weeks ?? []) {
      for (const day of week.training_plan_days ?? []) {
        const date = String(day.date).slice(0, 10)
        if (day.is_training_day === false || date < range.from || date > range.to) continue
        days.push({ date, title: day.title, planId: plan.id, teamId: plan.team_id, teamName: plan.team_id ? (teamNames.get(plan.team_id) ?? null) : null })
      }
    }
  }
  return ok(days)
}

async function readTestWeeks(teamIds: string[] | null, range: CalendarRange, options: { includeDrafts: boolean }): Promise<Result<TestWeekLite[]>> {
  const keep = (week: TestWeekLite) => inRange(week.startDate, week.endDate, range) && (options.includeDrafts || week.status !== "draft") && (teamIds === null || (week.teamId !== null && teamIds.includes(week.teamId)))
  if (isMock()) {
    return ok(mockTestWeeks().map((week) => ({ id: week.id, name: week.name, teamId: week.teamId, startDate: week.startDate, endDate: week.endDate, status: week.status, linkable: week.inCoachList })).filter(keep))
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client
    .from("test_weeks")
    .select("id, name, team_id, start_date, end_date, status")
    .eq("is_archived", false)
    .gte("end_date", range.from)
    .lte("start_date", range.to)
    .order("start_date", { ascending: true })
    .limit(300)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(
    ((data as Array<{ id: string; name: string; team_id: string | null; start_date: string; end_date: string; status: string }> | null) ?? [])
      .map((row) => ({ id: row.id, name: row.name, teamId: row.team_id, startDate: row.start_date, endDate: row.end_date, status: row.status, linkable: true }))
      .filter(keep),
  )
}

function placeOf(competition: Pick<CompetitionWithEntries, "venue" | "location">) {
  return [competition.venue, competition.location].map((part) => part?.trim()).filter(Boolean).join(", ") || null
}

function enteredCount(competition: CompetitionWithEntries) {
  return new Set(competition.entries.filter((entry) => entry.status === "entered").map((entry) => entry.athleteId)).size
}

function testWeekItem(week: TestWeekLite, options: { to: string; teamName?: string | null }): CalendarItem {
  return {
    key: `test-week:${week.id}`,
    kind: "test-week",
    title: week.name,
    startsOn: week.startDate,
    endsOn: week.endDate,
    detail: ["Test week", week.status === "draft" ? "draft" : week.status === "closed" ? "closed" : null, options.teamName ?? null].filter(Boolean).join(", "),
    to: options.to,
    teamId: week.teamId,
    teamName: options.teamName ?? null,
    sourceId: week.id,
  }
}

function staffCompetitionItem(competition: CompetitionWithEntries, teamNames: Map<string, string>): CalendarItem {
  const count = enteredCount(competition)
  const who = competition.scope === "club" ? "Whole club" : competition.scope === "team" ? (competition.teamId ? (teamNames.get(competition.teamId) ?? null) : null) : competition.ownerName ? `Added by ${competition.ownerName}` : "Added by an athlete"
  return {
    key: `competition:${competition.id}`,
    kind: "competition",
    title: competition.name,
    startsOn: competition.startDate,
    endsOn: competition.endDate,
    place: placeOf(competition),
    detail: [who, count > 0 ? `${count} ${count === 1 ? "athlete" : "athletes"} entered` : "No entries yet"].filter(Boolean).join(", "),
    to: `/coach/competitions/${competition.id}`,
    teamId: competition.teamId,
    sourceId: competition.id,
  }
}

/* ---------- Team calendar (coach) --------------------------------------------------------------- */

/** One team's calendar for its coach: planned sessions, test weeks, competitions, club events and who is unavailable. */
export async function loadTeamCalendar(input: { team: CalendarTeam; range: CalendarRange }): Promise<Result<CalendarData>> {
  const { team, range } = input
  const teamNames = new Map([[team.id, team.name]])
  const warnings: string[] = []

  const [planned, weeks, competitions, events, roster] = await Promise.all([
    readPlannedDays([team.id], range, teamNames),
    readTestWeeks([team.id], range, { includeDrafts: true }),
    getCompetitionsForStaff({ teamId: team.id }),
    listClubEvents(range, { role: "coach", teamIds: [team.id] }),
    readTeamAthletes(team.id),
  ])
  if (!planned.ok) return planned
  if (!weeks.ok) warnings.push(`Test weeks could not be loaded: ${weeks.error.message}`)
  if (!competitions.ok) warnings.push(`Competitions could not be loaded: ${competitions.error.message}`)
  if (!events.ok) warnings.push(`Club events could not be loaded: ${events.error.message}`)

  const items: CalendarItem[] = teamSessionItems(planned.data.map((day) => ({ ...day, to: day.planId ? `/coach/training-plan?plan=${encodeURIComponent(day.planId)}` : "/coach/training-plan" })))
  if (weeks.ok) items.push(...weeks.data.map((week) => testWeekItem(week, { to: week.linkable ? `/coach/test-week?week=${encodeURIComponent(week.id)}` : "/coach/test-week" })))
  if (competitions.ok) items.push(...competitions.data.filter((competition) => inRange(competition.startDate, competition.endDate, range)).map((competition) => staffCompetitionItem(competition, teamNames)))
  // Whole club events and this team's events. An event of another team the coach also coaches belongs on that team's calendar.
  const teamEvents = events.ok ? events.data.filter((event) => event.audience === "club" || event.teamIds.includes(team.id)) : []
  items.push(...teamEvents.map((event) => clubEventItem(event)))

  if (roster.ok && roster.data.length > 0) {
    const periods = await listAthleteAvailability(roster.data.map((athlete) => athlete.id), { from: range.from })
    if (periods.ok) {
      items.push(
        ...unavailableItems(
          roster.data,
          // A period that was cancelled before it began ends the day before it starts: it covers nothing.
          periods.data.filter((period) => period.endsOn === null || period.endsOn >= period.startsOn),
          range,
          { teamId: team.id, to: (day) => `/coach/teams/${team.id}/attendance?date=${day}` },
        ),
      )
    } else warnings.push(`Availability could not be loaded: ${periods.error.message}`)
  } else if (!roster.ok) warnings.push(`The roster could not be loaded: ${roster.error.message}`)

  return ok({ items, events: teamEvents, teams: [team], warnings })
}

async function readTeamAthletes(teamId: string): Promise<Result<Array<{ id: string; name: string }>>> {
  if (isMock()) return ok(mockTeamAthletes(teamId))
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.from("athletes").select("id, first_name, last_name").eq("team_id", teamId).eq("is_active", true).limit(500)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(((data as Array<{ id: string; first_name: string; last_name: string }> | null) ?? []).map((row) => ({ id: row.id, name: `${row.first_name} ${row.last_name}`.trim() })))
}

/* ---------- Club calendar (club admin) ------------------------------------------------------------ */

export async function listCalendarTeams(): Promise<Result<CalendarTeam[]>> {
  if (isMock()) return ok(mockTeamList())
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.from("teams").select("id, name, is_archived").order("name", { ascending: true }).limit(300)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(((data as Array<{ id: string; name: string; is_archived: boolean | null }> | null) ?? []).filter((team) => !team.is_archived).map((team) => ({ id: team.id, name: team.name })))
}

/** Every team together: test weeks, competitions, club events and a number of sessions per day and team. */
export async function loadClubCalendar(input: { range: CalendarRange }): Promise<Result<CalendarData>> {
  const { range } = input
  const teams = await listCalendarTeams()
  if (!teams.ok) return teams
  const teamNames = new Map(teams.data.map((team) => [team.id, team.name]))
  const warnings: string[] = []

  const [planned, weeks, competitions, events] = await Promise.all([
    readPlannedDays(null, range, teamNames),
    readTestWeeks(null, range, { includeDrafts: true }),
    getCompetitionsForStaff(),
    listClubEvents(range, { role: "club-admin", teamIds: [] }),
  ])
  if (!planned.ok) warnings.push(`Sessions could not be loaded: ${planned.error.message}`)
  if (!weeks.ok) warnings.push(`Test weeks could not be loaded: ${weeks.error.message}`)
  if (!competitions.ok) warnings.push(`Competitions could not be loaded: ${competitions.error.message}`)
  if (!events.ok) warnings.push(`Club events could not be loaded: ${events.error.message}`)

  const items: CalendarItem[] = []
  if (planned.ok) items.push(...sessionCountItems(planned.data.map((day) => ({ ...day, teamName: day.teamId ? (teamNames.get(day.teamId) ?? day.teamName ?? "Team") : "Team" }))))
  if (weeks.ok) items.push(...weeks.data.map((week) => testWeekItem(week, { to: week.linkable ? `/coach/test-week?week=${encodeURIComponent(week.id)}` : "/coach/test-week", teamName: week.teamId ? (teamNames.get(week.teamId) ?? null) : null })))
  if (competitions.ok) {
    items.push(
      ...competitions.data
        // A meet an athlete added for themselves is theirs and their coach's, not a club date.
        .filter((competition) => competition.scope !== "athlete" && inRange(competition.startDate, competition.endDate, range))
        .map((competition) => staffCompetitionItem(competition, teamNames)),
    )
  }
  const names = Object.fromEntries(teamNames)
  if (events.ok) items.push(...events.data.map((event) => clubEventItem(event, names)))
  return ok({ items, events: events.ok ? events.data : [], teams: teams.data, warnings })
}

/** Narrows the club calendar to one team: its own things, plus whatever is for the whole club. */
export function filterClubCalendar(items: CalendarItem[], teamId: string | null): CalendarItem[] {
  if (!teamId) return items
  return items.filter((item) => {
    if (item.kind === "event") return item.event?.audience === "club" || Boolean(item.event?.teamIds.includes(teamId))
    if (item.kind === "competition") return !item.teamId || item.teamId === teamId
    return item.teamId === teamId
  })
}

/* ---------- Athlete calendar ---------------------------------------------------------------------- */

async function readAthletePlannedDays(range: CalendarRange): Promise<Result<PlannedDay[]>> {
  if (isMock()) {
    return ok(
      mockAthletePlans()
        .flatMap((plan) => plan.detail.weeks.flatMap((week) => week.days.map((day) => ({ date: day.date.slice(0, 10), title: day.title, planId: plan.summary.id }))))
        .filter((day) => day.date >= range.from && day.date <= range.to),
    )
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  // Row policies return only published plans assigned to the athlete or their team (migration 20261006150000).
  const { data, error } = await client
    .from("training_plans")
    .select("id, team_id, training_plan_weeks(training_plan_days(date, title, is_training_day))")
    .eq("status", "published")
    .order("start_date", { ascending: false })
    .limit(50)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  const days: PlannedDay[] = []
  for (const plan of (data as PlanRow[] | null) ?? []) {
    for (const week of plan.training_plan_weeks ?? []) {
      for (const day of week.training_plan_days ?? []) {
        const date = String(day.date).slice(0, 10)
        if (day.is_training_day === false || date < range.from || date > range.to) continue
        days.push({ date, title: day.title, planId: plan.id })
      }
    }
  }
  return ok(days)
}

/** The athlete's own calendar: their sessions with what happened to each, test weeks, the competitions they are in and club events. */
export async function loadAthleteCalendar(input: { range: CalendarRange; today: string }): Promise<Result<CalendarData>> {
  const { range, today } = input
  const warnings: string[] = []
  const [planned, refs, availability, weeks, competitions, events] = await Promise.all([
    readAthletePlannedDays(range),
    listAthleteSessions(range.from, range.to, 600),
    getMyAvailability(),
    readTestWeeks(isMock() ? [MOCK_ATHLETE_TEAM_ID] : null, range, { includeDrafts: false }),
    getCompetitionsForCurrentAthlete(),
    listClubEvents(range, { role: "athlete", teamIds: [MOCK_ATHLETE_TEAM_ID] }),
  ])
  if (!refs.ok) return refs
  if (!planned.ok) warnings.push(`Your plan could not be loaded: ${planned.error.message}`)
  if (!weeks.ok) warnings.push(`Test weeks could not be loaded: ${weeks.error.message}`)
  if (!competitions.ok) warnings.push(`Competitions could not be loaded: ${competitions.error.message}`)
  if (!events.ok) warnings.push(`Club events could not be loaded: ${events.error.message}`)

  const periods = availability.ok ? availability.data : []
  const items: CalendarItem[] = athleteSessionItems({
    planned: planned.ok ? planned.data : [],
    refs: refs.data,
    excusedOn: (day) => periods.some((period) => availabilityCovers(period, day)),
    today,
    to: (day, own) => (own ? `/athlete/log?${new URLSearchParams({ ...(day !== today ? { date: day } : {}), session: own.id }).toString()}` : `/athlete/training-plan?day=${day}`),
  })
  if (weeks.ok) items.push(...weeks.data.map((week) => testWeekItem(week, { to: "/athlete/test-week" })))
  if (competitions.ok) {
    items.push(
      ...competitions.data
        .filter((competition) => inRange(competition.startDate, competition.endDate, range))
        // Only the meets the athlete is in: entered, or added by them for themselves.
        .filter((competition) => competition.canManage || competition.entries.some((entry) => entry.status === "entered"))
        .map((competition): CalendarItem => {
          const entered = competition.entries.filter((entry) => entry.status === "entered").map((entry) => entry.eventLabel)
          return {
            key: `competition:${competition.id}`,
            kind: "competition",
            title: competition.name,
            startsOn: competition.startDate,
            endsOn: competition.endDate,
            place: placeOf(competition),
            detail: entered.length > 0 ? entered.join(", ") : "No events entered yet",
            to: `/athlete/competitions/${competition.id}`,
            sourceId: competition.id,
          }
        }),
    )
  }
  if (events.ok) items.push(...events.data.map((event) => clubEventItem(event)))
  return ok({ items, events: events.ok ? events.data : [], teams: [], warnings })
}
