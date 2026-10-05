import type { SupabaseClient } from "@supabase/supabase-js"
import { currentAvailability, listAthleteAvailability } from "@/lib/data/athlete/availability-data"
import { getCompetitionsForStaff } from "@/lib/data/competition/competition-data"
import {
  getCoachReports,
  isValidReportRange,
  type AdherenceReportRow,
  type RecordsReportRow,
  type ReportMark,
  type ReportRange,
  type WellnessReportRow,
} from "@/lib/data/coach/reports-data"
import { formatMark, formatWind, type MarkUnit } from "@/lib/data/pr/marks"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { adherenceCounts, adherencePercent, type AdherenceCount, type AdherenceSession } from "@/lib/data/session/adherence"
import { todayIso } from "@/lib/data/training-plan/plan-builder-model"
import type { EventGroup, Readiness } from "@/lib/mock-data"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * The club admin's reports for one period: the coach reports (adherence, wellness, records) across
 * every team, with each row's team, plus a row per team and the club's competition results.
 * Everything is read for the period asked for. The club is read by its id and paged 1,000 rows at a
 * time, so a large club is not cut off by the API row limit or by a long list of athlete ids.
 * Mock mode builds the same shapes from the demo squad.
 */

export type ClubReportTeam = { id: string; name: string; eventGroup: string | null; leadCoach: string | null }
export type ClubAdherenceRow = AdherenceReportRow & { teamId: string | null }
export type ClubWellnessRow = WellnessReportRow & { teamId: string | null }
export type ClubRecordsRow = RecordsReportRow & { teamId: string | null }
export type ClubCompetitionRow = {
  key: string
  competitionId: string
  competitionName: string
  /** The day the mark was set. */
  date: string
  athleteId: string
  athleteName: string
  teamId: string | null
  eventLabel: string
  display: string
  unit: MarkUnit
  /** "+1.2", or empty when there was no reading. */
  wind: string
  windLegal: boolean
  place: number | null
}

export type ClubReports = {
  range: ReportRange
  /** Teams that are not archived. */
  teams: ClubReportTeam[]
  athleteCount: number
  adherence: ClubAdherenceRow[]
  wellness: ClubWellnessRow[]
  records: ClubRecordsRow[]
  competitions: ClubCompetitionRow[]
  /** False when the club has more history in the period than could be counted here. */
  complete: boolean
  /** Set when everything else loaded but competition results could not be read. */
  competitionsError: string | null
}

const PAGE_SIZE = 1000
const MAX_PAGES = 20

type PageResult = { data: unknown; error: Parameters<typeof mapPostgrestError>[0] | null }

async function fetchAll<T>(buildPage: (from: number, to: number) => PromiseLike<PageResult>): Promise<Result<{ rows: T[]; complete: boolean }>> {
  const rows: T[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    const batch = (data as T[] | null) ?? []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return ok({ rows, complete: true })
  }
  return ok({ rows, complete: false })
}

function toEventGroup(value: string | null | undefined): EventGroup {
  return value === "Mid" || value === "Distance" || value === "Jumps" || value === "Throws" ? value : "Sprint"
}

function readinessFromScore(score: number): Readiness {
  return score >= 75 ? "green" : score >= 55 ? "yellow" : "red"
}

/** Results set at a meet inside the period, across the club. A failed read leaves the report empty and says so. */
async function competitionRows(range: ReportRange): Promise<{ rows: ClubCompetitionRow[]; error: string | null }> {
  const result = await getCompetitionsForStaff()
  if (!result.ok) return { rows: [], error: result.error.message }
  const rows: ClubCompetitionRow[] = []
  for (const competition of result.data) {
    for (const entry of competition.entries) {
      const mark = entry.result
      if (!mark || mark.date < range.from || mark.date > range.to) continue
      rows.push({
        key: entry.id,
        competitionId: competition.id,
        competitionName: competition.name,
        date: mark.date,
        athleteId: entry.athleteId,
        athleteName: entry.athleteName ?? "Unnamed athlete",
        teamId: entry.athleteTeamId ?? null,
        eventLabel: entry.eventLabel,
        display: mark.display,
        unit: mark.unit,
        wind: formatWind(mark.wind),
        windLegal: mark.windLegal,
        place: mark.place,
      })
    }
  }
  rows.sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      left.competitionName.localeCompare(right.competitionName) ||
      left.eventLabel.localeCompare(right.eventLabel) ||
      (left.place ?? 999) - (right.place ?? 999) ||
      left.athleteName.localeCompare(right.athleteName),
  )
  return { rows, error: null }
}

/* ---------- Mock mode ------------------------------------------------------------------------ */

async function mockClubReports(range: ReportRange): Promise<Result<ClubReports>> {
  const [base, mock, clubAdmin, competitions] = await Promise.all([
    getCoachReports({ scopeTeamId: null, range }),
    import("@/lib/mock-data"),
    import("@/lib/mock-club-admin"),
    competitionRows(range),
  ])
  if (!base.ok) return base
  const teamOf = new Map(mock.mockAthletes.map((athlete) => [athlete.id, athlete.teamId as string | null]))
  const users = clubAdmin.loadClubUsers()
  const teams: ClubReportTeam[] = clubAdmin
    .loadClubTeams()
    .filter((team) => team.status !== "archived")
    .map((team) => ({
      id: team.id,
      name: team.name,
      eventGroup: team.eventGroup,
      leadCoach: users.find((user) => user.id === team.coachUserId)?.name ?? users.find((user) => team.coachEmail && user.email === team.coachEmail)?.name ?? null,
    }))
  return ok({
    range,
    teams,
    athleteCount: base.data.athleteCount,
    adherence: base.data.adherence.map((row) => ({ ...row, teamId: teamOf.get(row.athleteId) ?? null })),
    wellness: base.data.wellness.map((row) => ({ ...row, teamId: teamOf.get(row.athleteId) ?? null })),
    records: base.data.records.map((row) => ({ ...row, teamId: teamOf.get(row.athleteId) ?? null })),
    competitions: competitions.rows,
    complete: true,
    competitionsError: competitions.error,
  })
}

/* ---------- Supabase ---------------------------------------------------------------------------- */

type BestRow = {
  best_kind: "personal_best" | "season_best" | "wind_assisted_best"
  result_id: string
  athlete_id: string
  event_label: string
  event_group: string
  mark_unit: MarkUnit
  mark_value: number | string
  mark_display: string | null
  timing: "electronic" | "hand" | null
  result_date: string
  wind: number | string | null
}

const BEST_COLUMNS = "best_kind, result_id, athlete_id, event_label, event_group, mark_unit, mark_value, mark_display, timing, result_date, wind"

async function clubAdminTenantId(client: SupabaseClient): Promise<Result<string>> {
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")
  const { data: profile, error } = await client.from("profiles").select("tenant_id, role").eq("user_id", userId).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "club-admin") return err("FORBIDDEN", "Only a club admin can open the club reports.")
  return ok(profile.tenant_id as string)
}

export async function getClubReports(params: { range: ReportRange }): Promise<Result<ClubReports>> {
  const range = params.range
  if (!isValidReportRange(range)) return err("VALIDATION", "Choose a start date that is on or before the end date.")
  if (getBackendMode() !== "supabase") return mockClubReports(range)

  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const tenant = await clubAdminTenantId(client)
    if (!tenant.ok) return tenant
    const tenantId = tenant.data
    const today = todayIso()
    // Sessions count once they are due: nothing after today, whatever the end of the period is.
    const dueUntil = range.to < today ? range.to : today

    const [teamsResult, coachLinksResult, athletesResult, sessionsResult, completionsResult, wellnessResult, bestsResult, competitions] = await Promise.all([
      client.from("teams").select("id, name, event_group, status").eq("tenant_id", tenantId).neq("status", "archived").order("name"),
      client.from("team_coaches").select("team_id, user_id, created_at").eq("tenant_id", tenantId).eq("is_primary", true),
      fetchAll<{ id: string; team_id: string | null; first_name: string; last_name: string; event_group: string | null; primary_event: string | null }>((from, to) =>
        client.from("athletes").select("id, team_id, first_name, last_name, event_group, primary_event").eq("tenant_id", tenantId).eq("is_active", true).order("id").range(from, to),
      ),
      fetchAll<{ id: string; athlete_id: string; scheduled_for: string; status: string; origin: string | null }>((from, to) =>
        client
          .from("sessions")
          .select("id, athlete_id, scheduled_for, status, origin")
          .eq("tenant_id", tenantId)
          .gte("scheduled_for", range.from)
          .lte("scheduled_for", dueUntil)
          .order("id")
          .range(from, to),
      ),
      fetchAll<{ session_id: string }>((from, to) =>
        client.from("session_completions").select("session_id").eq("tenant_id", tenantId).gte("completion_date", range.from).order("id").range(from, to),
      ),
      fetchAll<{
        id: string
        athlete_id: string
        entry_date: string
        sleep_hours: number | string
        soreness: number
        fatigue: number
        mood: number
        stress: number
        notes: string | null
        readiness: Readiness | null
        readiness_score: number | null
      }>((from, to) =>
        client
          .from("wellness_entries")
          .select("id, athlete_id, entry_date, sleep_hours, soreness, fatigue, mood, stress, notes, readiness, readiness_score")
          .eq("tenant_id", tenantId)
          .gte("entry_date", range.from)
          .lte("entry_date", range.to)
          .order("entry_date", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      fetchAll<BestRow>((from, to) =>
        client
          .from("athlete_event_bests")
          .select(BEST_COLUMNS)
          .eq("tenant_id", tenantId)
          .gte("result_date", range.from)
          .lte("result_date", range.to)
          .order("result_id")
          .order("best_kind")
          .range(from, to),
      ),
      competitionRows(range),
    ])
    if (teamsResult.error) return { ok: false, error: mapPostgrestError(teamsResult.error) }
    if (coachLinksResult.error) return { ok: false, error: mapPostgrestError(coachLinksResult.error) }
    if (!athletesResult.ok) return athletesResult
    if (!sessionsResult.ok) return sessionsResult
    if (!completionsResult.ok) return completionsResult
    if (!wellnessResult.ok) return wellnessResult
    if (!bestsResult.ok) return bestsResult

    // The lead coach of a team is its earliest primary coach.
    const leadByTeam = new Map<string, { userId: string; createdAt: string }>()
    for (const link of (coachLinksResult.data as Array<{ team_id: string; user_id: string; created_at: string }> | null) ?? []) {
      const existing = leadByTeam.get(link.team_id)
      if (!existing || link.created_at < existing.createdAt) leadByTeam.set(link.team_id, { userId: link.user_id, createdAt: link.created_at })
    }
    const leadIds = [...new Set([...leadByTeam.values()].map((lead) => lead.userId))]
    const coachName = new Map<string, string>()
    if (leadIds.length > 0) {
      // Names are a nicety: without them the team rows simply show no lead coach.
      const profiles = await client.from("profiles").select("user_id, display_name").eq("tenant_id", tenantId).in("user_id", leadIds)
      for (const row of (profiles.data as Array<{ user_id: string; display_name: string | null }> | null) ?? []) {
        if (row.display_name) coachName.set(row.user_id, row.display_name)
      }
    }
    const teams: ClubReportTeam[] = ((teamsResult.data as Array<{ id: string; name: string; event_group: string | null }> | null) ?? []).map((row) => {
      const lead = leadByTeam.get(row.id)
      return { id: row.id, name: row.name, eventGroup: row.event_group, leadCoach: lead ? (coachName.get(lead.userId) ?? null) : null }
    })

    const athletes = athletesResult.data.rows
    const ids = athletes.map((athlete) => athlete.id)
    const active = new Set(ids)
    const nameOf = new Map(athletes.map((athlete) => [athlete.id, `${athlete.first_name} ${athlete.last_name}`.trim() || "Athlete"]))
    const teamOf = new Map(athletes.map((athlete) => [athlete.id, athlete.team_id]))

    // Excused sessions leave the count. If the periods cannot be read the figure is still shown, just less forgiving.
    const availabilityResult = await listAthleteAvailability(ids, { from: range.from })
    if (!availabilityResult.ok) console.warn("[club reports] could not read athlete availability", availabilityResult.error)
    const periods = availabilityResult.ok ? availabilityResult.data : []

    const counts = adherenceCounts(
      sessionsResult.data.rows.map((row): AdherenceSession => ({ id: row.id, athleteId: row.athlete_id, scheduledFor: row.scheduled_for, status: row.status, origin: row.origin })),
      new Set(completionsResult.data.rows.map((row) => row.session_id)),
      periods,
      { from: range.from, to: dueUntil },
    )

    const wellness: ClubWellnessRow[] = wellnessResult.data.rows
      .filter((row) => active.has(row.athlete_id))
      .map((row) => ({
        id: row.id,
        athleteId: row.athlete_id,
        athleteName: nameOf.get(row.athlete_id) ?? "Athlete",
        teamId: teamOf.get(row.athlete_id) ?? null,
        date: row.entry_date.slice(0, 10),
        sleep: Number(row.sleep_hours),
        soreness: row.soreness,
        fatigue: row.fatigue,
        mood: row.mood,
        stress: row.stress,
        readiness: row.readiness ?? readinessFromScore(row.readiness_score ?? 60),
        notes: row.notes,
      }))

    // Rows arrive newest first, so the first one seen per athlete is their latest check-in in the period.
    const latest = new Map<string, ClubWellnessRow>()
    const checkIns = new Map<string, number>()
    for (const entry of wellness) {
      if (!latest.has(entry.athleteId)) latest.set(entry.athleteId, entry)
      checkIns.set(entry.athleteId, (checkIns.get(entry.athleteId) ?? 0) + 1)
    }

    const adherence: ClubAdherenceRow[] = athletes.map((athlete) => {
      const count: AdherenceCount = counts.get(athlete.id) ?? { due: 0, done: 0, excused: 0 }
      return {
        athleteId: athlete.id,
        teamId: athlete.team_id,
        name: nameOf.get(athlete.id) ?? "Athlete",
        eventGroup: toEventGroup(athlete.event_group),
        primaryEvent: athlete.primary_event ?? "Unassigned",
        readiness: latest.get(athlete.id)?.readiness ?? null,
        lastCheckIn: latest.get(athlete.id)?.date ?? null,
        checkIns: checkIns.get(athlete.id) ?? 0,
        ...count,
        adherence: adherencePercent(count),
        availability: currentAvailability(periods.filter((period) => period.athleteId === athlete.id)),
      }
    })

    // Records: every athlete and event with a best set inside the period, shown with where that
    // event stands now (personal best, season best, best wind assisted mark).
    const hits = bestsResult.data.rows.filter((row) => active.has(row.athlete_id))
    const hitKeys = new Set(hits.map((row) => `${row.athlete_id}|${row.event_group}`))
    let standingComplete = true
    let standing: BestRow[] = []
    if (hits.length > 0) {
      const standingResult = await fetchAll<BestRow>((from, to) =>
        client.from("athlete_event_bests").select(BEST_COLUMNS).eq("tenant_id", tenantId).order("result_id").order("best_kind").range(from, to),
      )
      if (!standingResult.ok) return standingResult
      standing = standingResult.data.rows
      standingComplete = standingResult.data.complete
    }
    const toMark = (row: BestRow): ReportMark => {
      const date = row.result_date.slice(0, 10)
      return {
        display: row.mark_display ?? formatMark(Number(row.mark_value), row.mark_unit, row.timing),
        unit: row.mark_unit,
        date,
        wind: formatWind(row.wind === null ? null : Number(row.wind)),
        inRange: date >= range.from && date <= range.to,
      }
    }
    const byKey = new Map<string, ClubRecordsRow>()
    for (const row of standing) {
      const key = `${row.athlete_id}|${row.event_group}`
      if (!hitKeys.has(key)) continue
      const item =
        byKey.get(key) ??
        ({
          key,
          athleteId: row.athlete_id,
          athleteName: nameOf.get(row.athlete_id) ?? "Athlete",
          teamId: teamOf.get(row.athlete_id) ?? null,
          eventLabel: row.event_label,
          personalBest: null,
          seasonBest: null,
          windAssisted: null,
        } satisfies ClubRecordsRow)
      if (row.best_kind === "personal_best") item.personalBest = toMark(row)
      else if (row.best_kind === "season_best") item.seasonBest = toMark(row)
      else item.windAssisted = toMark(row)
      byKey.set(key, item)
    }
    const records = [...byKey.values()].sort((left, right) => left.athleteName.localeCompare(right.athleteName) || left.eventLabel.localeCompare(right.eventLabel))

    return ok({
      range,
      teams,
      athleteCount: athletes.length,
      adherence,
      wellness,
      records,
      competitions: competitions.rows,
      complete:
        athletesResult.data.complete && sessionsResult.data.complete && completionsResult.data.complete && wellnessResult.data.complete && bestsResult.data.complete && standingComplete,
      competitionsError: competitions.error,
    })
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}
