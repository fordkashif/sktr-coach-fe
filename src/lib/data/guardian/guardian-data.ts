import type { SupabaseClient } from "@supabase/supabase-js"
import { getCookieValue, ROLE_COOKIE, USER_COOKIE } from "@/lib/auth-session"
import {
  mockGuardianAnnouncements,
  mockGuardianAttendance,
  mockGuardianCalendar,
  mockGuardianCoaches,
  mockGuardianHealth,
  mockGuardianResults,
  mockGuardianWeek,
} from "@/lib/data/guardian/mock-guardian-content"
import {
  getMockGuardianContact,
  listMockGuardianChildren,
  mockAthleteTeam,
  mockGuardianFollows,
  mockGuardianHealthRule,
  saveMockGuardianContact,
} from "@/lib/data/guardian/mock-guardian-store"
import type {
  GuardianAnnouncement,
  GuardianAttendanceRow,
  GuardianCalendarItem,
  GuardianChild,
  GuardianCoach,
  GuardianContact,
  GuardianDayState,
  GuardianHealth,
  GuardianPlanDay,
  GuardianResults,
  GuardianWeek,
} from "@/lib/data/guardian/types"
import { formatMark, formatMarkWithUnit, type MarkUnit } from "@/lib/data/pr/marks"
import { listSharedReportsOfAthlete, type MyReport } from "@/lib/data/reports/athlete-report-data"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { skipReasonLabel, type SkipReason } from "@/lib/data/session/types"
import { bodyAreaLabel } from "@/lib/data/wellness/pain-report-types"
import { asGuardianHealthRule, guardianSeesHealth } from "@/lib/guardian/health-visibility"
import { mockAthletes } from "@/lib/mock-data"
import { loadClubProfile } from "@/lib/mock-club-admin"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * What a parent or guardian reads about the athletes they follow. Read only, apart from the
 * guardian contact the club holds for their child.
 *
 * Supabase mode: plain selects. Row level security (20261016090000_guardian_access.sql) returns
 * only the linked athletes' rows and leaves health out when it is hidden; the three places where
 * a health value sits inside an otherwise plain row (why a session was skipped, the reason on an
 * attendance mark, medical notes) come from functions that blank it.
 * Mock mode: demo content (mock-guardian-content.ts) for the links in mock-guardian-store.ts.
 */

const NO_CLIENT = "Supabase client is not configured."
const NOT_YOURS = "You can only see the athletes the club linked to your account."

function isMock() {
  return getBackendMode() !== "supabase"
}

function client(): SupabaseClient | null {
  return getBrowserSupabaseClient()
}

function mockEmail(): string | null {
  return getCookieValue(ROLE_COOKIE) === "guardian" ? (getCookieValue(USER_COOKIE)?.trim().toLowerCase() ?? null) : null
}

function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

async function attempt<T>(run: (supabase: SupabaseClient) => Promise<Result<T>>): Promise<Result<T>> {
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  try {
    return await run(supabase)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server. Check your connection and try again.", cause)
  }
}

/* ---------- Children --------------------------------------------------------------------------- */

export async function getGuardianChildren(): Promise<Result<GuardianChild[]>> {
  if (isMock()) {
    const clubName = loadClubProfile().clubName
    return ok(
      listMockGuardianChildren(mockEmail()).map((child) => {
        const athlete = mockAthletes.find((item) => item.id === child.athleteId)
        const team = mockAthleteTeam(child.athleteId)
        return {
          linkId: child.linkId,
          athleteId: child.athleteId,
          name: child.name,
          firstName: child.name.split(" ")[0] ?? child.name,
          teamId: team?.id ?? null,
          teamName: team?.name ?? null,
          primaryEvent: athlete?.primaryEvent ?? null,
          relationship: child.relationship,
          healthRule: mockGuardianHealthRule(child.athleteId),
          clubName,
        }
      }),
    )
  }
  return attempt(async (supabase) => {
    const { data, error } = await supabase.rpc("get_guardian_children")
    if (error) return { ok: false, error: mapPostgrestError(error) }
    type Row = { link_id: string; athlete_id: string; first_name: string; last_name: string; team_id: string | null; team_name: string | null; primary_event: string | null; relationship: string; health_rule: string; club_name: string | null }
    return ok(
      ((data as Row[] | null) ?? []).map((row) => ({
        linkId: row.link_id,
        athleteId: row.athlete_id,
        name: `${row.first_name} ${row.last_name}`.trim(),
        firstName: row.first_name,
        teamId: row.team_id,
        teamName: row.team_name,
        primaryEvent: row.primary_event,
        relationship: row.relationship,
        healthRule: asGuardianHealthRule(row.health_rule),
        clubName: row.club_name,
      })),
    )
  })
}

export async function getGuardianCoaches(athleteId: string): Promise<Result<GuardianCoach[]>> {
  if (isMock()) return mockGuardianFollows(mockEmail(), athleteId) ? ok(mockGuardianCoaches(athleteId)) : ok([])
  return attempt(async (supabase) => {
    const { data, error } = await supabase.rpc("get_guardian_child_coaches", { p_athlete_id: athleteId })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    type Row = { display_name: string; team_role: string; contact_email: string | null }
    return ok(
      ((data as Row[] | null) ?? []).map((row) => ({
        name: row.display_name,
        role: row.team_role === "lead" ? "lead" : row.team_role === "assistant" ? "assistant" : "coach",
        email: row.contact_email,
      })),
    )
  })
}

/* ---------- This week's plan ------------------------------------------------------------------- */

function dayState(date: string, today: string, sessionStatus: string | null, hasPlan: boolean): GuardianDayState {
  if (sessionStatus === "completed") return "done"
  if (sessionStatus === "skipped") return "skipped"
  if (!hasPlan && !sessionStatus) return "rest"
  if (date < today) return "missed"
  return date === today ? "today" : "planned"
}

export async function getGuardianWeek(athleteId: string, weekStart: string): Promise<Result<GuardianWeek>> {
  if (isMock()) return mockGuardianFollows(mockEmail(), athleteId) ? ok(mockGuardianWeek(athleteId, weekStart)) : err("FORBIDDEN", NOT_YOURS)
  const to = addDays(weekStart, 6)
  return attempt(async (supabase) => {
    const [planIdsResult, sessionsResult] = await Promise.all([
      supabase.rpc("guardian_athlete_plan_ids", { p_athlete_id: athleteId }),
      supabase.rpc("get_guardian_child_sessions", { p_athlete_id: athleteId, p_from: weekStart, p_to: to }),
    ])
    if (planIdsResult.error) return { ok: false, error: mapPostgrestError(planIdsResult.error) }
    if (sessionsResult.error) return { ok: false, error: mapPostgrestError(sessionsResult.error) }
    const planIds = ((planIdsResult.data as string[] | null) ?? []).filter(Boolean)
    type SessionRow = { id: string; scheduled_for: string; title: string; session_type: string | null; status: string; plan_id: string | null; skip_reason: string | null }
    const sessions = (sessionsResult.data as SessionRow[] | null) ?? []

    type DayRow = { id: string; plan_week_id: string; date: string; title: string; focus: string | null; is_training_day: boolean | null }
    let days: DayRow[] = []
    let blocks: Array<{ plan_day_id: string; sort_order: number; preview_text: string }> = []
    const planOfWeek = new Map<string, string>()
    const planNames = new Map<string, string>()
    if (planIds.length > 0) {
      const [plans, weeks] = await Promise.all([
        supabase.from("training_plans").select("id, name").in("id", planIds),
        supabase.from("training_plan_weeks").select("id, plan_id").in("plan_id", planIds),
      ])
      if (plans.error) return { ok: false, error: mapPostgrestError(plans.error) }
      if (weeks.error) return { ok: false, error: mapPostgrestError(weeks.error) }
      for (const plan of (plans.data as Array<{ id: string; name: string }> | null) ?? []) planNames.set(plan.id, plan.name)
      for (const week of (weeks.data as Array<{ id: string; plan_id: string }> | null) ?? []) planOfWeek.set(week.id, week.plan_id)
      const weekIds = [...planOfWeek.keys()]
      if (weekIds.length > 0) {
        const dayResult = await supabase
          .from("training_plan_days")
          .select("id, plan_week_id, date, title, focus, is_training_day")
          .in("plan_week_id", weekIds)
          .gte("date", weekStart)
          .lte("date", to)
          .order("date", { ascending: true })
        if (dayResult.error) return { ok: false, error: mapPostgrestError(dayResult.error) }
        days = ((dayResult.data as DayRow[] | null) ?? []).filter((day) => day.is_training_day !== false)
        if (days.length > 0) {
          const blockResult = await supabase.from("training_plan_blocks").select("plan_day_id, sort_order, preview_text").in("plan_day_id", days.map((day) => day.id)).order("sort_order", { ascending: true })
          if (blockResult.error) return { ok: false, error: mapPostgrestError(blockResult.error) }
          blocks = (blockResult.data as typeof blocks | null) ?? []
        }
      }
    }

    const today = todayIso()
    const result: GuardianPlanDay[] = []
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(weekStart, index)
      const planDay = days.find((day) => day.date.slice(0, 10) === date) ?? null
      const session = sessions.find((item) => item.scheduled_for.slice(0, 10) === date && (item.status === "completed" || item.status === "skipped")) ?? sessions.find((item) => item.scheduled_for.slice(0, 10) === date) ?? null
      result.push({
        date,
        title: planDay?.title ?? session?.title ?? null,
        focus: planDay?.focus || null,
        blocks: planDay ? blocks.filter((block) => block.plan_day_id === planDay.id).map((block) => block.preview_text).slice(0, 6) : [],
        state: dayState(date, today, session?.status ?? null, Boolean(planDay)),
        skipReason: session?.status === "skipped" && session.skip_reason ? skipReasonLabel(session.skip_reason as SkipReason).toLowerCase() : null,
      })
    }
    const firstPlan = days[0] ? planOfWeek.get(days[0].plan_week_id) : undefined
    return ok({
      from: weekStart,
      to,
      planName: (firstPlan ? planNames.get(firstPlan) : null) ?? null,
      days: result,
      done: result.filter((day) => day.state === "done").length,
      skipped: result.filter((day) => day.state === "skipped").length,
      planned: result.filter((day) => day.state !== "rest").length,
    })
  })
}

/* ---------- Results, records, goals, test weeks ----------------------------------------------- */

const SOURCE_WORD: Record<string, string> = { competition: "Competition", test_week: "Test week", training: "Training", manual: "Added by hand", imported: "Imported" }

export async function getGuardianResults(athlete: Pick<GuardianChild, "athleteId" | "teamId">): Promise<Result<GuardianResults>> {
  if (isMock()) return mockGuardianFollows(mockEmail(), athlete.athleteId) ? ok(mockGuardianResults(athlete.athleteId)) : err("FORBIDDEN", NOT_YOURS)
  const athleteId = athlete.athleteId
  return attempt(async (supabase) => {
    const today = todayIso()
    const [competitions, entries, results, goals, testWeekIds] = await Promise.all([
      supabase.from("competitions").select("id, name, start_date, end_date, venue, location, scope, team_id, owner_athlete_id").gte("end_date", today).order("start_date", { ascending: true }).limit(40),
      supabase.from("competition_entries").select("competition_id, event_label, status").eq("athlete_id", athleteId),
      supabase
        .from("athlete_results")
        .select("id, event_key, event_label, mark_unit, lower_is_better, compare_value, mark_display, result_date, source, place, wind, location, competition_id")
        .eq("athlete_id", athleteId)
        .order("result_date", { ascending: false })
        .limit(300),
      supabase.from("athlete_goals").select("id, event_label, mark_unit, target_value, target_date, achieved_on").eq("athlete_id", athleteId).order("created_at", { ascending: false }).limit(30),
      supabase.rpc("guardian_athlete_test_week_ids", { p_athlete_id: athleteId }),
    ])
    for (const part of [competitions, entries, results, goals, testWeekIds]) if (part.error) return { ok: false, error: mapPostgrestError(part.error) }

    type EntryRow = { competition_id: string; event_label: string; status: string }
    const entryRows = ((entries.data as EntryRow[] | null) ?? []).filter((entry) => entry.status !== "scratched")
    type CompetitionRow = { id: string; name: string; start_date: string; end_date: string; venue: string | null; location: string | null; scope: string; team_id: string | null; owner_athlete_id: string | null }
    // A guardian of two athletes on different teams reads both teams' meets: keep this athlete's.
    const upcoming = ((competitions.data as CompetitionRow[] | null) ?? [])
      .filter((row) => row.scope === "club" || (row.scope === "team" && row.team_id === athlete.teamId) || row.owner_athlete_id === athleteId || entryRows.some((entry) => entry.competition_id === row.id))
      .map((row) => ({
        id: row.id,
        name: row.name,
        startDate: row.start_date,
        endDate: row.end_date,
        place: [row.venue, row.location].filter(Boolean).join(", ") || null,
        events: entryRows.filter((entry) => entry.competition_id === row.id).map((entry) => entry.event_label),
      }))

    type ResultRow = { id: string; event_key: string; event_label: string; mark_unit: MarkUnit; lower_is_better: boolean; compare_value: number; mark_display: string; result_date: string; source: string; place: number | null; wind: number | null; location: string | null }
    const resultRows = (results.data as ResultRow[] | null) ?? []
    const best = new Map<string, ResultRow>()
    for (const row of resultRows) {
      const current = best.get(row.event_key)
      const better = !current || (row.lower_is_better ? Number(row.compare_value) < Number(current.compare_value) : Number(row.compare_value) > Number(current.compare_value))
      if (better) best.set(row.event_key, row)
    }

    const weekIds = ((testWeekIds.data as string[] | null) ?? []).filter(Boolean)
    let testWeeks: GuardianResults["testWeeks"] = []
    if (weekIds.length > 0) {
      const [weeks, definitions, testResults] = await Promise.all([
        supabase.from("test_weeks").select("id, name, start_date, end_date, status").in("id", weekIds).order("start_date", { ascending: false }).limit(6),
        supabase.from("test_definitions").select("id, test_week_id, name, sort_order").in("test_week_id", weekIds).order("sort_order", { ascending: true }),
        supabase.from("test_results").select("test_definition_id, value_text").eq("athlete_id", athleteId).in("test_week_id", weekIds),
      ])
      for (const part of [weeks, definitions, testResults]) if (part.error) return { ok: false, error: mapPostgrestError(part.error) }
      const values = new Map(((testResults.data as Array<{ test_definition_id: string; value_text: string }> | null) ?? []).map((row) => [row.test_definition_id, row.value_text]))
      const definitionRows = (definitions.data as Array<{ id: string; test_week_id: string; name: string }> | null) ?? []
      testWeeks = ((weeks.data as Array<{ id: string; name: string; start_date: string; end_date: string; status: string }> | null) ?? []).map((week) => ({
        id: week.id,
        name: week.name,
        startDate: week.start_date,
        endDate: week.end_date,
        status: week.status === "closed" ? "closed" : "published",
        tests: definitionRows.filter((definition) => definition.test_week_id === week.id).map((definition) => ({ name: definition.name, value: values.get(definition.id) ?? null })),
      }))
    }

    return ok({
      upcoming,
      results: resultRows.slice(0, 30).map((row) => ({
        id: row.id,
        eventLabel: row.event_label,
        mark: formatMarkWithUnit(row.mark_display, row.mark_unit),
        date: row.result_date,
        source: SOURCE_WORD[row.source] ?? "Result",
        where: row.location,
        place: row.place,
        wind: row.wind === null || row.wind === undefined ? null : `${Number(row.wind) > 0 ? "+" : ""}${Number(row.wind).toFixed(1)}`,
      })),
      records: [...best.values()].map((row) => ({ eventLabel: row.event_label, mark: formatMarkWithUnit(row.mark_display, row.mark_unit), date: row.result_date })).sort((left, right) => left.eventLabel.localeCompare(right.eventLabel)),
      goals: ((goals.data as Array<{ id: string; event_label: string; mark_unit: MarkUnit; target_value: number; target_date: string | null; achieved_on: string | null }> | null) ?? []).map((row) => ({
        id: row.id,
        eventLabel: row.event_label,
        target: formatMarkWithUnit(formatMark(Number(row.target_value), row.mark_unit), row.mark_unit),
        targetDate: row.target_date,
        achievedOn: row.achieved_on,
      })),
      testWeeks,
    })
  })
}

/* ---------- Attendance, reports, news, calendar ----------------------------------------------- */

export async function getGuardianAttendance(athleteId: string): Promise<Result<GuardianAttendanceRow[]>> {
  if (isMock()) return mockGuardianFollows(mockEmail(), athleteId) ? ok(mockGuardianAttendance(athleteId)) : err("FORBIDDEN", NOT_YOURS)
  const today = todayIso()
  return attempt(async (supabase) => {
    const { data, error } = await supabase.rpc("get_guardian_child_attendance", { p_athlete_id: athleteId, p_from: addDays(today, -120), p_to: today })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    type Row = { attendance_date: string; status: string; reason: string | null }
    return ok(
      ((data as Row[] | null) ?? []).map((row) => ({
        date: row.attendance_date,
        status: row.status === "late" || row.status === "absent" || row.status === "excused" ? row.status : "present",
        reason: row.reason,
      })),
    )
  })
}

function reportHasHealth(report: MyReport) {
  const snapshot = report.snapshot as unknown as Record<string, unknown>
  return Boolean(snapshot.wellness || snapshot.injuries)
}

/** Reports the coach shared with the athlete. One with a health section only when health is visible. */
export async function getGuardianReports(athleteId: string): Promise<Result<MyReport[]>> {
  if (isMock()) {
    if (!mockGuardianFollows(mockEmail(), athleteId)) return err("FORBIDDEN", NOT_YOURS)
    const all = await listSharedReportsOfAthlete(athleteId)
    if (!all.ok) return all
    const health = guardianSeesHealth(mockGuardianHealthRule(athleteId))
    return ok(all.data.filter((report) => health || !reportHasHealth(report)))
  }
  return listSharedReportsOfAthlete(athleteId)
}

export async function getGuardianReport(athleteId: string, reportId: string): Promise<Result<MyReport>> {
  const all = await getGuardianReports(athleteId)
  if (!all.ok) return all
  const report = all.data.find((item) => item.id === reportId)
  return report ? ok(report) : err("NOT_FOUND", "This report is not shared with you.")
}

/** Announcements to the teams of the athletes the guardian follows, and to the whole club. */
export async function getGuardianAnnouncements(children: Array<Pick<GuardianChild, "teamName">>): Promise<Result<GuardianAnnouncement[]>> {
  if (isMock()) return ok(children.length > 0 ? mockGuardianAnnouncements(children.flatMap((child) => (child.teamName ? [child.teamName] : []))) : [])
  return attempt(async (supabase) => {
    const { data, error } = await supabase.from("announcements").select("id, body, audience, team_id, created_at, teams(name)").order("created_at", { ascending: false }).limit(50)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    type Row = { id: string; body: string; audience: string; created_at: string; teams: { name: string } | Array<{ name: string }> | null }
    return ok(
      ((data as Row[] | null) ?? []).map((row) => {
        const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
        return { id: row.id, body: row.body, from: row.audience === "club" ? "Whole club" : (team?.name ?? "Team"), createdAt: row.created_at }
      }),
    )
  })
}

/** What is coming up for one athlete: team and club events, competitions, test weeks. */
export async function getGuardianCalendar(athlete: Pick<GuardianChild, "athleteId" | "teamId">): Promise<Result<GuardianCalendarItem[]>> {
  if (isMock()) return mockGuardianFollows(mockEmail(), athlete.athleteId) ? ok(mockGuardianCalendar(athlete.athleteId)) : err("FORBIDDEN", NOT_YOURS)
  return attempt(async (supabase) => {
    const today = todayIso()
    const until = addDays(today, 120)
    const [events, results, testWeekIds] = await Promise.all([
      supabase.from("club_events").select("id, title, starts_on, ends_on, start_time, place, audience, club_event_teams(team_id)").gte("ends_on", today).lte("starts_on", until).order("starts_on", { ascending: true }).limit(100),
      getGuardianResults(athlete),
      supabase.rpc("guardian_athlete_test_week_ids", { p_athlete_id: athlete.athleteId }),
    ])
    if (events.error) return { ok: false, error: mapPostgrestError(events.error) }
    if (!results.ok) return results
    type EventRow = { id: string; title: string; starts_on: string; ends_on: string; start_time: string | null; place: string | null; audience: string; club_event_teams: Array<{ team_id: string }> | null }
    const items: GuardianCalendarItem[] = ((events.data as EventRow[] | null) ?? [])
      .filter((row) => row.audience === "club" || (row.club_event_teams ?? []).some((team) => team.team_id === athlete.teamId))
      .map((row) => ({ id: row.id, kind: "event", title: row.title, startsOn: row.starts_on, endsOn: row.ends_on, startTime: row.start_time ? row.start_time.slice(0, 5) : null, place: row.place }))
    for (const meet of results.data.upcoming) items.push({ id: meet.id, kind: "competition", title: meet.name, startsOn: meet.startDate, endsOn: meet.endDate, startTime: null, place: meet.place })
    const weekIds = (!testWeekIds.error ? ((testWeekIds.data as string[] | null) ?? []) : []).filter(Boolean)
    if (weekIds.length > 0) {
      const weeks = await supabase.from("test_weeks").select("id, name, start_date, end_date").in("id", weekIds).gte("end_date", today)
      for (const week of (weeks.data as Array<{ id: string; name: string; start_date: string; end_date: string }> | null) ?? []) {
        items.push({ id: week.id, kind: "test-week", title: week.name, startsOn: week.start_date, endsOn: week.end_date, startTime: null, place: null })
      }
    }
    return ok(items.sort((left, right) => left.startsOn.localeCompare(right.startsOn)))
  })
}

/* ---------- Health ----------------------------------------------------------------------------- */

export async function getGuardianHealth(athlete: Pick<GuardianChild, "athleteId" | "healthRule">): Promise<Result<GuardianHealth>> {
  if (isMock()) return mockGuardianFollows(mockEmail(), athlete.athleteId) ? ok(mockGuardianHealth(athlete.athleteId)) : err("FORBIDDEN", NOT_YOURS)
  if (!guardianSeesHealth(athlete.healthRule)) return ok({ visible: false, rule: athlete.healthRule, checkIns: [], painReports: [], availability: [], medicalNotes: null })
  const athleteId = athlete.athleteId
  return attempt(async (supabase) => {
    const today = todayIso()
    const [checkIns, pain, availability, details] = await Promise.all([
      supabase.from("wellness_entries").select("entry_date, readiness, sleep_hours, notes").eq("athlete_id", athleteId).order("entry_date", { ascending: false }).limit(14),
      supabase.from("pain_reports").select("id, body_areas, severity, started_on, training_impact, status, note").eq("athlete_id", athleteId).order("started_on", { ascending: false }).limit(20),
      supabase.from("athlete_availability").select("id, kind, starts_on, ends_on, note, ended_at").eq("athlete_id", athleteId).order("starts_on", { ascending: false }).limit(20),
      supabase.rpc("get_guardian_child_details", { p_athlete_id: athleteId }),
    ])
    for (const part of [checkIns, pain, availability, details]) if (part.error) return { ok: false, error: mapPostgrestError(part.error) }
    const detailRow = details.data as { medical_notes?: string | null; health_visible?: boolean } | null
    return ok({
      // The database has the last word: between loading the list and this call the athlete may have switched sharing off.
      visible: detailRow?.health_visible !== false,
      rule: athlete.healthRule,
      checkIns: ((checkIns.data as Array<{ entry_date: string; readiness: string; sleep_hours: number | null; notes: string | null }> | null) ?? []).map((row) => ({
        date: row.entry_date,
        readiness: row.readiness === "red" ? "red" : row.readiness === "yellow" ? "yellow" : "green",
        sleepHours: row.sleep_hours === null ? null : Number(row.sleep_hours),
        note: row.notes,
      })),
      painReports: ((pain.data as Array<{ id: string; body_areas: string[] | null; severity: number; started_on: string; training_impact: string; status: string; note: string | null }> | null) ?? []).map((row) => ({
        id: row.id,
        areas: (row.body_areas ?? []).map((area) => bodyAreaLabel(area)),
        severity: row.severity,
        startedOn: row.started_on,
        impact: row.training_impact === "cannot_train" ? "cannot_train" : row.training_impact === "modified" ? "modified" : "none",
        open: row.status === "open",
        note: row.note,
      })),
      availability: ((availability.data as Array<{ id: string; kind: string; starts_on: string; ends_on: string | null; note: string | null; ended_at: string | null }> | null) ?? []).map((row) => ({
        id: row.id,
        kind: row.kind === "injured" ? "injured" : row.kind === "sick" ? "sick" : "away",
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        note: row.note,
        current: !row.ended_at && row.starts_on <= today && (row.ends_on === null || row.ends_on >= today),
      })),
      medicalNotes: detailRow?.medical_notes ?? null,
    })
  })
}

/* ---------- The guardian contact the club holds ------------------------------------------------ */

export async function getGuardianContact(athleteId: string): Promise<Result<GuardianContact>> {
  if (isMock()) return mockGuardianFollows(mockEmail(), athleteId) ? ok(getMockGuardianContact(athleteId)) : err("FORBIDDEN", NOT_YOURS)
  return attempt(async (supabase) => {
    const { data, error } = await supabase.rpc("get_guardian_child_details", { p_athlete_id: athleteId })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    const row = data as { guardian_name?: string | null; guardian_phone?: string | null; guardian_email?: string | null } | null
    if (!row) return err("FORBIDDEN", NOT_YOURS)
    return ok({ name: row.guardian_name ?? null, phone: row.guardian_phone ?? null, email: row.guardian_email ?? null })
  })
}

export function validateGuardianContact(input: GuardianContact): { ok: true; contact: GuardianContact } | { ok: false; field: "name" | "phone" | "email"; message: string } {
  const name = input.name?.replace(/\s+/g, " ").trim() || null
  const phone = input.phone?.trim() || null
  const email = input.email?.trim().toLowerCase() || null
  if (name && name.length > 120) return { ok: false, field: "name", message: "Keep the name under 120 characters." }
  if (phone && (!/^[+\d][\d\s()-]*$/.test(phone) || phone.replace(/\D/g, "").length < 7 || phone.replace(/\D/g, "").length > 15)) {
    return { ok: false, field: "phone", message: "Enter a phone number with 7 to 15 digits." }
  }
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { ok: false, field: "email", message: "Enter an email address like name@example.com." }
  if ((phone || email) && !name) return { ok: false, field: "name", message: "Add your name." }
  return { ok: true, contact: { name, phone, email } }
}

/** The one thing a guardian can change about an athlete: the guardian contact the club holds. */
export async function updateGuardianContact(athleteId: string, input: GuardianContact): Promise<Result<GuardianContact>> {
  const checked = validateGuardianContact(input)
  if (!checked.ok) return err("VALIDATION", checked.message)
  if (isMock()) {
    if (!mockGuardianFollows(mockEmail(), athleteId)) return err("FORBIDDEN", NOT_YOURS)
    return saveMockGuardianContact(athleteId, checked.contact) ? ok(checked.contact) : err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
  }
  return attempt(async (supabase) => {
    const { error } = await supabase.rpc("update_guardian_contact", {
      p_athlete_id: athleteId,
      p_name: checked.contact.name,
      p_phone: checked.contact.phone,
      p_email: checked.contact.email,
    })
    if (error) {
      const mapped = mapPostgrestError(error)
      // The function's own sentences are written for the person ("Enter a valid email address.").
      return { ok: false, error: error.code === "23514" || error.hint === "not_allowed" ? { ...mapped, message: error.message } : mapped }
    }
    return ok(checked.contact)
  })
}
