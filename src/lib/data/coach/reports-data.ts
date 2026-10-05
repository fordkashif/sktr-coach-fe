import type { SupabaseClient } from "@supabase/supabase-js"
import { currentAvailability, listAthleteAvailability, type AthleteAvailability } from "@/lib/data/athlete/availability-data"
import { formatMark, formatWind, type MarkUnit } from "@/lib/data/pr/marks"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { adherenceCounts, adherencePercent, type AdherenceCount, type AdherenceSession } from "@/lib/data/session/adherence"
import { addDaysIso, todayIso } from "@/lib/data/training-plan/plan-builder-model"
import type { EventGroup, Readiness } from "@/lib/mock-data"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * The coach reports (adherence, wellness, records) for one period.
 * Everything is read for the period asked for: sessions and check-ins inside it, and the bests
 * that were set inside it. Mock mode builds the same shapes from the demo squad, relative to today,
 * so a different period gives different numbers there too.
 */

export type ReportRange = { from: string; to: string }

export const DEFAULT_REPORT_DAYS = 28

/** The last `days` days, today included. */
export function reportRangeForLastDays(days: number, today: string = todayIso()): ReportRange {
  return { from: addDaysIso(today, -(days - 1)), to: today }
}

export function isValidReportRange(range: ReportRange) {
  const day = /^\d{4}-\d{2}-\d{2}$/
  return day.test(range.from) && day.test(range.to) && range.from <= range.to
}

/** "8 Sep to 5 Oct 2026" */
export function describeReportRange(range: ReportRange) {
  const format = (iso: string, withYear: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC", ...(withYear ? { year: "numeric" } : {}) })
  return `${format(range.from, range.from.slice(0, 4) !== range.to.slice(0, 4))} to ${format(range.to, true)}`
}

export type AdherenceReportRow = {
  athleteId: string
  name: string
  eventGroup: EventGroup
  primaryEvent: string
  /** From the latest check-in inside the period. Null when there was none. */
  readiness: Readiness | null
  /** ISO day of the latest check-in inside the period. */
  lastCheckIn: string | null
  checkIns: number
  due: number
  done: number
  excused: number
  /** Null when nothing was due. Never shown as 100%. */
  adherence: number | null
  /** Injured, sick or away right now (or next), if anything. */
  availability: AthleteAvailability | null
}

export type WellnessReportRow = {
  id: string
  athleteId: string
  athleteName: string
  date: string
  sleep: number
  soreness: number
  fatigue: number
  mood: number
  stress: number
  readiness: Readiness
  notes: string | null
}

export type ReportMark = {
  /** The mark as written, without its unit: "10.84", "1:52.30". */
  display: string
  unit: MarkUnit
  date: string
  /** "+1.2". Empty when there was no reading. */
  wind: string
  /** Set inside the period that was asked for. */
  inRange: boolean
}

export type RecordsReportRow = {
  key: string
  athleteId: string
  athleteName: string
  eventLabel: string
  personalBest: ReportMark | null
  seasonBest: ReportMark | null
  /** The best mark with too much following wind. Shown beside the others, never as a record. */
  windAssisted: ReportMark | null
}

export type CoachReports = {
  range: ReportRange
  teamName: string | null
  athleteCount: number
  adherence: AdherenceReportRow[]
  wellness: WellnessReportRow[]
  records: RecordsReportRow[]
}

function toEventGroup(value: string | null | undefined): EventGroup {
  return value === "Mid" || value === "Distance" || value === "Jumps" || value === "Throws" ? value : "Sprint"
}

function readinessFromScore(score: number): Readiness {
  return score >= 75 ? "green" : score >= 55 ? "yellow" : "red"
}

/* ---------- Mock mode ------------------------------------------------------------------------ */

/** A stable number from 0 to 99 for a piece of text, so the demo figures do not jump between visits. */
function stableHash(text: string) {
  let hash = 7
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 100003
  return hash % 100
}

function eachDay(range: ReportRange, limit = 400): string[] {
  const days: string[] = []
  for (let day = range.from; day <= range.to && days.length < limit; day = addDaysIso(day, 1)) days.push(day)
  return days
}

async function mockReports(scopeTeamId: string | null, range: ReportRange): Promise<Result<CoachReports>> {
  const mock = await import("@/lib/mock-data")
  const today = todayIso()
  const athletes = mock.mockAthletes.filter((athlete) => (scopeTeamId ? athlete.teamId === scopeTeamId : true))
  const ids = athletes.map((athlete) => athlete.id)
  const availabilityResult = await listAthleteAvailability(ids, { from: range.from })
  const periods = availabilityResult.ok ? availabilityResult.data : []
  const days = eachDay({ from: range.from, to: range.to < today ? range.to : today })

  // Sessions: one planned session a day, Monday to Saturday, done about as often as the demo adherence says.
  const sessions: AdherenceSession[] = []
  const completed = new Set<string>()
  for (const athlete of athletes) {
    for (const day of days) {
      if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) continue
      const id = `${athlete.id}:${day}`
      sessions.push({ id, athleteId: athlete.id, scheduledFor: day, status: "scheduled", origin: "plan" })
      if (stableHash(id) < (athlete.adherence ?? 80)) completed.add(id)
    }
  }
  const counts = adherenceCounts(sessions, completed, periods, { from: range.from, to: today })

  // Check-ins: most days, with values that follow the athlete's demo readiness.
  const wellness: WellnessReportRow[] = []
  for (const athlete of athletes) {
    const base = athlete.readiness === "green" ? 0 : athlete.readiness === "yellow" ? 1 : 2
    for (const day of days) {
      const roll = stableHash(`w:${athlete.id}:${day}`)
      if (roll < 22) continue
      const wobble = roll % 3 === 0 ? 1 : 0
      const level = Math.min(2, base + (roll > 92 ? 1 : 0))
      wellness.push({
        id: `w-${athlete.id}-${day}`,
        athleteId: athlete.id,
        athleteName: athlete.name,
        date: day,
        sleep: 8 - level - (wobble ? 0.5 : 0),
        soreness: 2 + level,
        fatigue: 2 + level + wobble > 5 ? 5 : 2 + level + wobble,
        mood: 4 - level,
        stress: 2 + level,
        readiness: level === 0 ? "green" : level === 1 ? "yellow" : "red",
        notes: level === 2 && roll % 5 === 0 ? "Tight after yesterday" : null,
      })
    }
  }
  wellness.sort((left, right) => right.date.localeCompare(left.date) || left.athleteName.localeCompare(right.athleteName))

  const adherence: AdherenceReportRow[] = athletes.map((athlete) => {
    const own = wellness.filter((entry) => entry.athleteId === athlete.id)
    const count: AdherenceCount = counts.get(athlete.id) ?? { due: 0, done: 0, excused: 0 }
    return {
      athleteId: athlete.id,
      name: athlete.name,
      eventGroup: athlete.eventGroup,
      primaryEvent: athlete.primaryEvent,
      readiness: own[0]?.readiness ?? null,
      lastCheckIn: own[0]?.date ?? null,
      checkIns: own.length,
      ...count,
      adherence: adherencePercent(count),
      availability: currentAvailability(periods.filter((period) => period.athleteId === athlete.id)),
    }
  })

  // Bests: the demo records, placed at fixed distances before today.
  const offsets = [5, 9, 40, 6, 19, 75, 130, 12]
  const records: RecordsReportRow[] = mock.mockPRs
    .map((pr, index) => ({ pr, date: addDaysIso(today, -(offsets[index % offsets.length] ?? 30)) }))
    .filter(({ pr }) => ids.includes(pr.athleteId))
    .flatMap(({ pr, date }) => {
      const match = /^([\d:.]+)\s*([a-z]*)$/i.exec(pr.bestValue.trim())
      const unit: MarkUnit = match?.[2] === "m" ? "m" : match?.[2] === "kg" ? "kg" : "s"
      const mark: ReportMark = { display: match?.[1] ?? pr.bestValue, unit, date, wind: pr.wind ?? "", inRange: date >= range.from && date <= range.to }
      const sameYear = date.slice(0, 4) === today.slice(0, 4)
      const assistedDate = addDaysIso(today, -12)
      const windAssisted: ReportMark | null =
        pr.id === "pr1" ? { display: "10.19", unit: "s", date: assistedDate, wind: "+2.6", inRange: assistedDate >= range.from && assistedDate <= range.to } : null
      if (!mark.inRange && !windAssisted?.inRange) return []
      return [{ key: pr.id, athleteId: pr.athleteId, athleteName: pr.athleteName, eventLabel: pr.event, personalBest: mark, seasonBest: sameYear ? mark : null, windAssisted }]
    })

  return ok({
    range,
    teamName: mock.mockTeams.find((team) => team.id === scopeTeamId)?.name ?? null,
    athleteCount: athletes.length,
    adherence,
    wellness,
    records,
  })
}

/* ---------- Supabase ---------------------------------------------------------------------------- */

type BestRow = {
  best_kind: "personal_best" | "season_best" | "wind_assisted_best"
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

const BEST_COLUMNS = "best_kind, athlete_id, event_label, event_group, mark_unit, mark_value, mark_display, timing, result_date, wind"

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

async function scopedTeamIds(client: SupabaseClient, scopeTeamId: string | null): Promise<Result<{ tenantId: string; teamIds: string[] | null }>> {
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")
  const { data: profile, error } = await client.from("profiles").select("tenant_id, role").eq("user_id", userId).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "coach" && profile.role !== "club-admin") return err("FORBIDDEN", "Only a coach or club admin can open these reports.")
  const tenantId = profile.tenant_id as string
  if (profile.role === "club-admin") return ok({ tenantId, teamIds: scopeTeamId ? [scopeTeamId] : null })
  const memberships = await client.from("team_coaches").select("team_id").eq("tenant_id", tenantId).eq("user_id", userId)
  if (memberships.error) return { ok: false, error: mapPostgrestError(memberships.error) }
  const own = ((memberships.data as Array<{ team_id: string }> | null) ?? []).map((row) => row.team_id)
  return ok({ tenantId, teamIds: scopeTeamId ? (own.includes(scopeTeamId) ? [scopeTeamId] : []) : own })
}

export async function getCoachReports(params: { scopeTeamId?: string | null; range: ReportRange }): Promise<Result<CoachReports>> {
  const range = params.range
  const scopeTeamId = params.scopeTeamId ?? null
  if (!isValidReportRange(range)) return err("VALIDATION", "Choose a start date that is on or before the end date.")
  if (getBackendMode() !== "supabase") return mockReports(scopeTeamId, range)

  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const scope = await scopedTeamIds(client, scopeTeamId)
    if (!scope.ok) return scope
    const { tenantId, teamIds } = scope.data
    const empty: CoachReports = { range, teamName: null, athleteCount: 0, adherence: [], wellness: [], records: [] }
    if (teamIds && teamIds.length === 0) return ok(empty)

    const athletesQuery = client
      .from("athletes")
      .select("id, team_id, first_name, last_name, event_group, primary_event")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("first_name", { ascending: true })
    if (teamIds) athletesQuery.in("team_id", teamIds)
    const teamQuery = scopeTeamId ? client.from("teams").select("name").eq("id", scopeTeamId).maybeSingle() : Promise.resolve({ data: null, error: null })
    const [athletesResult, teamResult] = await Promise.all([athletesQuery, teamQuery])
    if (athletesResult.error) return { ok: false, error: mapPostgrestError(athletesResult.error) }

    const athletes = ((athletesResult.data as Array<{ id: string; team_id: string | null; first_name: string; last_name: string; event_group: string | null; primary_event: string | null }> | null) ?? []).filter(
      (row) => Boolean(row.team_id),
    )
    const teamName = ((teamResult.data as { name: string } | null) ?? null)?.name ?? null
    if (athletes.length === 0) return ok({ ...empty, teamName })
    const ids = athletes.map((athlete) => athlete.id)
    const nameOf = new Map(athletes.map((athlete) => [athlete.id, `${athlete.first_name} ${athlete.last_name}`.trim() || "Athlete"]))

    const today = todayIso()
    // Sessions count once they are due: nothing after today, whatever the end of the period is.
    const dueUntil = range.to < today ? range.to : today

    const [sessionsResult, completionsResult, wellnessResult, availabilityResult, bestsInRange] = await Promise.all([
      client.from("sessions").select("id, athlete_id, scheduled_for, status, origin").in("athlete_id", ids).gte("scheduled_for", range.from).lte("scheduled_for", dueUntil).limit(10000),
      client.from("session_completions").select("session_id").in("athlete_id", ids).gte("completion_date", range.from).limit(10000),
      client
        .from("wellness_entries")
        .select("id, athlete_id, entry_date, sleep_hours, soreness, fatigue, mood, stress, notes, readiness, readiness_score")
        .in("athlete_id", ids)
        .gte("entry_date", range.from)
        .lte("entry_date", range.to)
        .order("entry_date", { ascending: false })
        .limit(5000),
      listAthleteAvailability(ids, { from: range.from }),
      client.from("athlete_event_bests").select(BEST_COLUMNS).in("athlete_id", ids).gte("result_date", range.from).lte("result_date", range.to).limit(5000),
    ])
    if (sessionsResult.error) return { ok: false, error: mapPostgrestError(sessionsResult.error) }
    if (completionsResult.error) return { ok: false, error: mapPostgrestError(completionsResult.error) }
    if (wellnessResult.error) return { ok: false, error: mapPostgrestError(wellnessResult.error) }
    if (bestsInRange.error) return { ok: false, error: mapPostgrestError(bestsInRange.error) }
    // Excused sessions leave the count. If the periods cannot be read the figure is still shown, just less forgiving.
    if (!availabilityResult.ok) console.warn("[coach reports] could not read athlete availability", availabilityResult.error)
    const periods = availabilityResult.ok ? availabilityResult.data : []

    const counts = adherenceCounts(
      ((sessionsResult.data as Array<{ id: string; athlete_id: string; scheduled_for: string; status: string; origin: string | null }> | null) ?? []).map(
        (row): AdherenceSession => ({ id: row.id, athleteId: row.athlete_id, scheduledFor: row.scheduled_for, status: row.status, origin: row.origin }),
      ),
      new Set(((completionsResult.data as Array<{ session_id: string }> | null) ?? []).map((row) => row.session_id)),
      periods,
      { from: range.from, to: dueUntil },
    )

    const wellness: WellnessReportRow[] = (
      (wellnessResult.data as Array<{
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
      }> | null) ?? []
    ).map((row) => ({
      id: row.id,
      athleteId: row.athlete_id,
      athleteName: nameOf.get(row.athlete_id) ?? "Athlete",
      date: row.entry_date.slice(0, 10),
      sleep: Number(row.sleep_hours),
      soreness: row.soreness,
      fatigue: row.fatigue,
      mood: row.mood,
      stress: row.stress,
      readiness: row.readiness ?? readinessFromScore(row.readiness_score ?? 60),
      notes: row.notes,
    }))

    const adherence: AdherenceReportRow[] = athletes.map((athlete) => {
      const own = wellness.filter((entry) => entry.athleteId === athlete.id)
      const count: AdherenceCount = counts.get(athlete.id) ?? { due: 0, done: 0, excused: 0 }
      return {
        athleteId: athlete.id,
        name: nameOf.get(athlete.id) ?? "Athlete",
        eventGroup: toEventGroup(athlete.event_group),
        primaryEvent: athlete.primary_event ?? "Unassigned",
        readiness: own[0]?.readiness ?? null,
        lastCheckIn: own[0]?.date ?? null,
        checkIns: own.length,
        ...count,
        adherence: adherencePercent(count),
        availability: currentAvailability(periods.filter((period) => period.athleteId === athlete.id)),
      }
    })

    // Records: every athlete and event with a best set inside the period, shown with where that
    // event stands now (personal best, season best, best wind assisted mark).
    const hits = (bestsInRange.data as BestRow[] | null) ?? []
    const hitAthletes = [...new Set(hits.map((row) => row.athlete_id))]
    const hitKeys = new Set(hits.map((row) => `${row.athlete_id}|${row.event_group}`))
    let standing: BestRow[] = []
    for (const part of chunk(hitAthletes, 150)) {
      const { data, error } = await client.from("athlete_event_bests").select(BEST_COLUMNS).in("athlete_id", part).limit(5000)
      if (error) return { ok: false, error: mapPostgrestError(error) }
      standing = standing.concat((data as BestRow[] | null) ?? [])
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
    const byKey = new Map<string, RecordsReportRow>()
    for (const row of standing) {
      const key = `${row.athlete_id}|${row.event_group}`
      if (!hitKeys.has(key)) continue
      const item = byKey.get(key) ?? { key, athleteId: row.athlete_id, athleteName: nameOf.get(row.athlete_id) ?? "Athlete", eventLabel: row.event_label, personalBest: null, seasonBest: null, windAssisted: null }
      if (row.best_kind === "personal_best") item.personalBest = toMark(row)
      else if (row.best_kind === "season_best") item.seasonBest = toMark(row)
      else item.windAssisted = toMark(row)
      byKey.set(key, item)
    }
    const records = [...byKey.values()].sort((left, right) => left.athleteName.localeCompare(right.athleteName) || left.eventLabel.localeCompare(right.eventLabel))

    return ok({ range, teamName, athleteCount: athletes.length, adherence, wellness, records })
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}
