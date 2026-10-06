import { getCurrentAccount } from "@/lib/data/account/account-data"
import { MOCK_ATHLETE_ID } from "@/lib/data/athlete/profile-data"
import { getCurrentClubBrand } from "@/lib/data/club-admin/club-profile-data"
import { seasonForDate } from "@/lib/data/club-admin/season-logic"
import { listClubSeasons } from "@/lib/data/club-admin/seasons-data"
import { loadCoachAthleteDetail } from "@/lib/data/coach/athlete-detail-data"
import { listAthleteAttendance } from "@/lib/data/coach/attendance-data"
import { mockSessionIdentity } from "@/lib/data/coach/roster-mock"
import { getAthleteGoals } from "@/lib/data/goals/goals-data"
import { getAthleteRecords } from "@/lib/data/pr/results-data"
import {
  buildAthleteReportSnapshot,
  cleanReportSections,
  isReportLinkToken,
  readAthleteReportSnapshot,
  REPORT_LINK_DAYS,
  REPORT_SUMMARY_MAX,
  reportLinkPath,
  reportLinkState,
  reportRangeProblem,
  withReportSummary,
  type AthleteReportSnapshot,
  type AthleteReportSource,
  type ReportLinkDays,
  type ReportLinkState,
  type ReportRange,
  type ReportSectionKey,
  type ReportSourceSession,
} from "@/lib/data/reports/athlete-report"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { todayIso } from "@/lib/data/training-plan/plan-builder-model"
import { getPainReportsForAthlete } from "@/lib/data/wellness/pain-report-data"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Athlete reports (public.athlete_reports and athlete_report_links, 20261015110000).
 *
 * A coach builds a report from the same data the athlete screen shows, saves it as a snapshot,
 * and shares it with the athlete in the app or with a parent or guardian by a private link.
 * The database decides who may read and write: coaches of the athlete's team and club admins;
 * the athlete only what was shared with them; signed out only through a link's token.
 * Mock mode keeps reports in this browser, so a link made here opens here.
 *
 * Private coach notes are never read by this module.
 */

export const ATHLETE_REPORTS_CHANGED_EVENT = "pacelab:athlete-reports-changed"

export type ReportLink = {
  id: string
  madeFor: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  openCount: number
  lastOpenedAt: string | null
  state: ReportLinkState
}

export type AthleteReport = {
  id: string
  athleteId: string
  authorName: string
  period: ReportRange
  sections: ReportSectionKey[]
  summary: string
  snapshot: AthleteReportSnapshot
  createdAt: string
  /** Set once the athlete can see it in the app. */
  sharedWithAthleteAt: string | null
  links: ReportLink[]
  /** Not shared with anyone yet: the summary can still be changed. */
  canEdit: boolean
}

export type NewReportLink = { link: ReportLink; url: string }

export type SaveReportInput = { athleteId: string; range: ReportRange; sections: readonly string[]; summary: string; snapshot: AthleteReportSnapshot }

const SHARED_MESSAGE = "This report has been shared, so it can no longer be changed. Duplicate it to write a new one."
const STORAGE_BLOCKED = "Could not save in this browser. Storage may be full or blocked."

function isMock() {
  return getBackendMode() !== "supabase"
}

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ATHLETE_REPORTS_CHANGED_EVENT))
}

function linkUrl(token: string) {
  const path = reportLinkPath(token)
  return typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path
}

function newToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  }
  // No Web Crypto (an insecure origin in a demo): the demo store still never keeps the token itself.
  return `plain-${text.split("").reverse().join("")}`
}

function validateSave(input: Pick<SaveReportInput, "range" | "summary">): string | null {
  const problem = reportRangeProblem(input.range, todayIso())
  if (problem) return problem
  if (input.summary.trim().length > REPORT_SUMMARY_MAX) return `Keep the summary under ${REPORT_SUMMARY_MAX} characters.`
  return null
}

/* ---------- Mock store ---------------------------------------------------------------------------- */

const MOCK_REPORTS_KEY = "pacelab:athlete-reports:v1"
/** Not per club: the public page has no session to tell which club it is in. */
const MOCK_LINKS_KEY = "pacelab:athlete-report-links:v1"

type MockReport = {
  id: string
  athleteId: string
  authorEmail: string
  authorName: string
  period: ReportRange
  sections: ReportSectionKey[]
  summary: string
  snapshot: AthleteReportSnapshot
  createdAt: string
  sharedWithAthleteAt: string | null
}

type MockLink = {
  id: string
  reportId: string
  tokenHash: string
  madeFor: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  openCount: number
  lastOpenedAt: string | null
  /** A report with a link is frozen, so the link carries what it shows. */
  snapshot: AthleteReportSnapshot
}

function readJson<T>(key: string): T[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

const readMockReports = () => readJson<MockReport>(tenantStorageKey(MOCK_REPORTS_KEY))
const writeMockReports = (reports: MockReport[]) => writeJson(tenantStorageKey(MOCK_REPORTS_KEY), reports)
const readMockLinks = () => readJson<MockLink>(MOCK_LINKS_KEY)
const writeMockLinks = (links: MockLink[]) => writeJson(MOCK_LINKS_KEY, links)

function mockStaff(): { email: string } | null {
  const identity = mockSessionIdentity()
  if (identity.role !== "coach" && identity.role !== "club-admin") return null
  return { email: (identity.email ?? "").toLowerCase() }
}

function toLink(link: Pick<MockLink, "id" | "madeFor" | "createdAt" | "expiresAt" | "revokedAt" | "openCount" | "lastOpenedAt">): ReportLink {
  return {
    id: link.id,
    madeFor: link.madeFor,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    openCount: link.openCount,
    lastOpenedAt: link.lastOpenedAt,
    state: reportLinkState(link),
  }
}

function fromMock(report: MockReport, links: MockLink[]): AthleteReport {
  const own = links.filter((link) => link.reportId === report.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  return {
    id: report.id,
    athleteId: report.athleteId,
    authorName: report.authorName,
    period: report.period,
    sections: report.sections,
    summary: report.summary,
    snapshot: report.snapshot,
    createdAt: report.createdAt,
    sharedWithAthleteAt: report.sharedWithAthleteAt,
    links: own.map(toLink),
    canEdit: !report.sharedWithAthleteAt && own.length === 0,
  }
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/* ---------- Supabase rows ------------------------------------------------------------------------- */

const REPORT_COLUMNS = "id, athlete_id, period_start, period_end, sections, summary, snapshot, shared_with_athlete_at, created_at"
// Never "*": the token hash is not readable from a client.
const LINK_COLUMNS = "id, report_id, made_for, created_at, expires_at, revoked_at, open_count, last_opened_at"

type ReportRow = {
  id: string
  athlete_id: string
  period_start: string
  period_end: string
  sections: string[] | null
  summary: string | null
  snapshot: unknown
  shared_with_athlete_at: string | null
  created_at: string
}

type LinkRow = { id: string; report_id: string; made_for: string; created_at: string; expires_at: string; revoked_at: string | null; open_count: number; last_opened_at: string | null }

function linkFromRow(row: LinkRow): ReportLink {
  return toLink({ id: row.id, madeFor: row.made_for, createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at, openCount: row.open_count, lastOpenedAt: row.last_opened_at })
}

function fromRow(row: ReportRow, links: LinkRow[]): AthleteReport | null {
  const snapshot = readAthleteReportSnapshot(row.snapshot)
  if (!snapshot) return null
  const own = links.filter((link) => link.report_id === row.id)
  return {
    id: row.id,
    athleteId: row.athlete_id,
    authorName: snapshot.coachName || "A former coach",
    period: { from: row.period_start.slice(0, 10), to: row.period_end.slice(0, 10) },
    sections: cleanReportSections(row.sections),
    summary: row.summary ?? "",
    snapshot,
    createdAt: row.created_at,
    sharedWithAthleteAt: row.shared_with_athlete_at,
    links: own.map(linkFromRow),
    canEdit: !row.shared_with_athlete_at && own.length === 0,
  }
}

function isMissing(error: { code?: string }) {
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202"
}

function client() {
  return getBrowserSupabaseClient()
}

const NO_CLIENT = "Supabase client is not configured."
const UNREACHABLE = "Could not reach the server."

/* ---------- Building: the data a report draws on ---------------------------------------------------- */

/** Sessions planned inside the period, straight from the database, so a long period is complete. */
async function loadPeriodSessions(athleteId: string, range: ReportRange): Promise<ReportSourceSession[] | null> {
  const supabase = client()
  if (!supabase) return null
  const [sessions, completions] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, scheduled_for, status, origin, estimated_duration_minutes, completed_at")
      .eq("athlete_id", athleteId)
      .gte("scheduled_for", range.from)
      .lte("scheduled_for", range.to)
      .order("scheduled_for", { ascending: false })
      .limit(1500),
    supabase.from("session_completions").select("session_id").eq("athlete_id", athleteId).gte("completion_date", range.from).limit(3000),
  ])
  if (sessions.error || completions.error) return null
  const finished = new Set(((completions.data as Array<{ session_id: string }> | null) ?? []).map((row) => row.session_id))
  type Row = { id: string; scheduled_for: string; status: string; origin: string | null; estimated_duration_minutes: number | null; completed_at: string | null }
  return ((sessions.data as Row[] | null) ?? []).map((row) => ({
    id: row.id,
    isoDate: row.scheduled_for.slice(0, 10),
    status: finished.has(row.id) || row.completed_at ? "completed" : row.status,
    origin: row.origin === "athlete" ? "athlete" : "plan",
    durationMinutes: row.estimated_duration_minutes,
  }))
}

async function loadPeriodWellness(athleteId: string, range: ReportRange): Promise<AthleteReportSource["wellness"] | null> {
  const supabase = client()
  if (!supabase) return null
  const { data, error } = await supabase
    .from("wellness_entries")
    .select("entry_date, sleep_hours, readiness_score")
    .eq("athlete_id", athleteId)
    .gte("entry_date", range.from)
    .lte("entry_date", range.to)
    .order("entry_date", { ascending: true })
    .limit(800)
  if (error) return null
  return ((data as Array<{ entry_date: string; sleep_hours: number | string | null; readiness_score: number }> | null) ?? []).map((row) => ({
    date: row.entry_date.slice(0, 10),
    readinessScore: Number(row.readiness_score),
    sleep: row.sleep_hours === null ? null : Number(row.sleep_hours),
  }))
}

export type AthleteReportContext = {
  source: AthleteReportSource
  /** The club's season today falls in, for "This season". Null when the club has none. */
  season: { name: string; start: string; end: string } | null
  /** A parent or guardian on file, to say who a link is for. */
  guardian: { name: string | null; email: string | null } | null
  /** Under 18 today: a parent or guardian acts for them. */
  isMinor: boolean
  hasLogin: boolean
  teamId: string | null
}

/**
 * Everything a report about this athlete can draw on for the period, read with the same functions
 * the coach's athlete screen uses. Health data (check-ins, pain reports) is only read when a
 * health section is ticked.
 */
export async function loadAthleteReportContext(athleteId: string, range: ReportRange, options: { health: boolean }): Promise<Result<AthleteReportContext>> {
  const role = mockSessionIdentity().role ?? "coach"
  const [detail, records, goals, attendance, seasons, account, brand, pain] = await Promise.all([
    loadCoachAthleteDetail(athleteId),
    getAthleteRecords(athleteId),
    getAthleteGoals(athleteId),
    listAthleteAttendance(athleteId, { from: range.from, limit: 800 }),
    listClubSeasons(),
    getCurrentAccount(),
    getCurrentClubBrand(role),
    options.health ? getPainReportsForAthlete(athleteId, { status: "all", limit: 50 }) : Promise.resolve(ok([])),
  ])
  if (!detail.ok) return detail
  if (!records.ok) return records

  let sessions: ReportSourceSession[] = detail.data.sessions.map((session) => ({
    id: session.id,
    isoDate: session.isoDate,
    status: session.status,
    origin: session.origin,
    durationMinutes: session.durationMinutes,
  }))
  let wellness: AthleteReportSource["wellness"] = options.health ? detail.data.wellness.map((entry) => ({ date: entry.date, readinessScore: entry.readinessScore, sleep: entry.sleep })) : []
  if (!isMock()) {
    // The athlete screen reads the latest 60 sessions and check-ins. A season can hold more.
    const [periodSessions, periodWellness] = await Promise.all([loadPeriodSessions(athleteId, range), options.health ? loadPeriodWellness(athleteId, range) : Promise.resolve(null)])
    if (periodSessions) sessions = periodSessions
    if (periodWellness) wellness = periodWellness
  }

  const today = todayIso()
  const season = seasons.ok ? seasonForDate(seasons.data, today) : null
  const born = detail.data.dateOfBirth
  const details = detail.data.privateDetails
  return ok({
    source: {
      club: brand,
      athlete: { id: detail.data.athlete.id, name: detail.data.athlete.name, teamName: detail.data.athlete.teamName, primaryEvent: detail.data.athlete.primaryEvent },
      coachName: (account.ok ? account.data.displayName : null) ?? "Your coach",
      sessions,
      attendance: attendance.ok ? attendance.data.map((record) => ({ date: record.date, status: record.status })) : [],
      availability: detail.data.availability.map((period) => ({ kind: period.kind, startsOn: period.startsOn, endsOn: period.endsOn })),
      // The goals read brings the athlete's results too. They are the same rows, except in the demo,
      // where the demo athlete's results sit under another id that only the goals read knows.
      results: records.data.results.length > 0 || !goals.ok ? records.data.results : goals.data.results,
      season: records.data.season,
      tests: detail.data.tests.map((test) => ({ name: test.testName, value: test.value, previousValue: test.previousValue, change: test.change, submittedAt: test.submittedAt })),
      goals: goals.ok ? goals.data.goals : [],
      wellness,
      painReports: pain.ok ? pain.data : [],
    },
    season: season ? { name: season.name, start: season.start, end: season.end } : null,
    guardian: details && (details.guardianName || details.guardianEmail) ? { name: details.guardianName, email: details.guardianEmail } : null,
    isMinor: born ? ageOn(born, today) < 18 : false,
    hasLogin: detail.data.athlete.hasLogin,
    teamId: detail.data.athlete.teamId,
  })
}

function ageOn(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.slice(0, 10).split("-").map(Number)
  const [ty, tm, td] = today.split("-").map(Number)
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0)
}

/* ---------- Coach: list, read, save, change, delete -------------------------------------------------- */

/** Every report about this athlete the caller may see, newest first. */
export async function listAthleteReports(athleteId: string): Promise<Result<AthleteReport[]>> {
  if (isMock()) {
    if (!mockStaff()) return err("FORBIDDEN", "Only coaches and club admins can see an athlete's reports.")
    const links = readMockLinks()
    return ok(
      readMockReports()
        .filter((report) => report.athleteId === athleteId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((report) => fromMock(report, links)),
    )
  }
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  try {
    const { data, error } = await supabase.from("athlete_reports").select(REPORT_COLUMNS).eq("athlete_id", athleteId).order("created_at", { ascending: false }).limit(200)
    if (error) return isMissing(error) ? ok([]) : { ok: false, error: mapPostgrestError(error) }
    const rows = (data as ReportRow[] | null) ?? []
    const links = rows.length > 0 ? await supabase.from("athlete_report_links").select(LINK_COLUMNS).eq("athlete_id", athleteId).order("created_at", { ascending: false }).limit(1000) : { data: [], error: null }
    const linkRows = links.error ? [] : ((links.data as LinkRow[] | null) ?? [])
    return ok(rows.flatMap((row) => fromRow(row, linkRows) ?? []))
  } catch (cause) {
    return err("UNKNOWN", UNREACHABLE, cause)
  }
}

/** One report with its links, for staff. */
export async function getAthleteReport(reportId: string): Promise<Result<AthleteReport>> {
  if (isMock()) {
    if (!mockStaff()) return err("FORBIDDEN", "Only coaches and club admins can open this report.")
    const report = readMockReports().find((item) => item.id === reportId)
    return report ? ok(fromMock(report, readMockLinks())) : err("NOT_FOUND", "This report no longer exists.")
  }
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  try {
    const [report, links] = await Promise.all([
      supabase.from("athlete_reports").select(REPORT_COLUMNS).eq("id", reportId).maybeSingle(),
      supabase.from("athlete_report_links").select(LINK_COLUMNS).eq("report_id", reportId).order("created_at", { ascending: false }),
    ])
    if (report.error) return { ok: false, error: mapPostgrestError(report.error) }
    const mapped = report.data ? fromRow(report.data as ReportRow, links.error ? [] : ((links.data as LinkRow[] | null) ?? [])) : null
    return mapped ? ok(mapped) : err("NOT_FOUND", "This report no longer exists, or it is about an athlete on a team you do not coach.")
  } catch (cause) {
    return err("UNKNOWN", UNREACHABLE, cause)
  }
}

/** Saves a new report: the snapshot is what the sheet showed at this moment. */
export async function saveAthleteReport(input: SaveReportInput): Promise<Result<{ reportId: string }>> {
  const problem = validateSave(input)
  if (problem) return err("VALIDATION", problem)
  const sections = cleanReportSections(input.sections)
  const summary = input.summary.trim()
  // The snapshot only ever holds the sections that are ticked.
  const snapshot = readAthleteReportSnapshot({ ...withReportSummary(input.snapshot, summary), sections })
  if (!snapshot) return err("VALIDATION", "This report could not be put together. Reload and try again.")

  if (isMock()) {
    const staff = mockStaff()
    if (!staff) return err("FORBIDDEN", "Only coaches and club admins can save a report.")
    const report: MockReport = {
      id: newId("report"),
      athleteId: input.athleteId,
      authorEmail: staff.email,
      authorName: snapshot.coachName || "Coach",
      period: input.range,
      sections,
      summary,
      snapshot,
      createdAt: new Date().toISOString(),
      sharedWithAthleteAt: null,
    }
    if (!writeMockReports([...readMockReports(), report])) return err("UNKNOWN", STORAGE_BLOCKED)
    announce()
    return ok({ reportId: report.id })
  }

  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  try {
    const { data: session } = await supabase.auth.getSession()
    const userId = session.session?.user.id
    if (!userId) return err("UNAUTHORIZED", "You are signed out. Sign in again.")
    // The database stamps the club and the author; they are sent so the policy can be checked.
    const { data: athlete, error: athleteError } = await supabase.from("athletes").select("tenant_id").eq("id", input.athleteId).maybeSingle()
    if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }
    if (!athlete) return err("NOT_FOUND", "This athlete is not on a team you coach.")
    const { data, error } = await supabase
      .from("athlete_reports")
      .insert({ tenant_id: athlete.tenant_id as string, athlete_id: input.athleteId, author_user_id: userId, period_start: input.range.from, period_end: input.range.to, sections, summary, snapshot })
      .select("id")
      .single()
    if (error) return { ok: false, error: mapPostgrestError(error) }
    announce()
    return ok({ reportId: (data as { id: string }).id })
  } catch (cause) {
    return err("UNKNOWN", UNREACHABLE, cause)
  }
}

/** Changes the coach's summary. Refused once the report has been shared. */
export async function updateAthleteReportSummary(reportId: string, summary: string): Promise<Result<null>> {
  const text = summary.trim()
  if (text.length > REPORT_SUMMARY_MAX) return err("VALIDATION", `Keep the summary under ${REPORT_SUMMARY_MAX} characters.`)
  if (isMock()) {
    if (!mockStaff()) return err("FORBIDDEN", "Only coaches and club admins can change a report.")
    const reports = readMockReports()
    const report = reports.find((item) => item.id === reportId)
    if (!report) return err("NOT_FOUND", "This report no longer exists.")
    if (report.sharedWithAthleteAt || readMockLinks().some((link) => link.reportId === reportId)) return err("VALIDATION", SHARED_MESSAGE)
    const next: MockReport = { ...report, summary: text, snapshot: withReportSummary(report.snapshot, text) }
    if (!writeMockReports(reports.map((item) => (item.id === reportId ? next : item)))) return err("UNKNOWN", STORAGE_BLOCKED)
    announce()
    return ok(null)
  }
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  try {
    // The database keeps the summary inside the snapshot in step (athlete_reports_normalise).
    const { data, error } = await supabase.from("athlete_reports").update({ summary: text }).eq("id", reportId).select("id")
    if (error) return error.message.includes("has been shared") ? err("VALIDATION", SHARED_MESSAGE) : { ok: false, error: mapPostgrestError(error) }
    if (((data as unknown[] | null) ?? []).length === 0) return err("FORBIDDEN", "You cannot change this report.")
    announce()
    return ok(null)
  } catch (cause) {
    return err("UNKNOWN", UNREACHABLE, cause)
  }
}

/** Deletes a report and its links. The athlete and anyone holding a link can no longer open it. */
export async function deleteAthleteReport(reportId: string): Promise<Result<null>> {
  if (isMock()) {
    if (!mockStaff()) return err("FORBIDDEN", "Only coaches and club admins can delete a report.")
    const done = writeMockReports(readMockReports().filter((item) => item.id !== reportId)) && writeMockLinks(readMockLinks().filter((link) => link.reportId !== reportId))
    if (!done) return err("UNKNOWN", STORAGE_BLOCKED)
    announce()
    return ok(null)
  }
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  try {
    const { data, error } = await supabase.from("athlete_reports").delete().eq("id", reportId).select("id")
    if (error) return { ok: false, error: mapPostgrestError(error) }
    if (((data as unknown[] | null) ?? []).length === 0) return err("FORBIDDEN", "You cannot delete this report.")
    announce()
    return ok(null)
  } catch (cause) {
    return err("UNKNOWN", UNREACHABLE, cause)
  }
}

/* ---------- Coach: sharing --------------------------------------------------------------------------- */

/** Lets the athlete see the report under Progress and tells them. */
export async function shareAthleteReportWithAthlete(reportId: string): Promise<Result<{ sharedAt: string }>> {
  if (isMock()) {
    if (!mockStaff()) return err("FORBIDDEN", "Only coaches and club admins can share a report.")
    const reports = readMockReports()
    const report = reports.find((item) => item.id === reportId)
    if (!report) return err("NOT_FOUND", "This report no longer exists.")
    if (report.sharedWithAthleteAt) return ok({ sharedAt: report.sharedWithAthleteAt })
    const sharedAt = new Date().toISOString()
    if (!writeMockReports(reports.map((item) => (item.id === reportId ? { ...item, sharedWithAthleteAt: sharedAt } : item)))) return err("UNKNOWN", STORAGE_BLOCKED)
    announce()
    return ok({ sharedAt })
  }
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  try {
    const { data, error } = await supabase.rpc("share_athlete_report", { p_report_id: reportId })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    announce()
    return ok({ sharedAt: typeof data === "string" ? data : new Date().toISOString() })
  } catch (cause) {
    return err("UNKNOWN", UNREACHABLE, cause)
  }
}

/** Makes a private link for a parent or guardian. The address is returned once and cannot be shown again. */
export async function createAthleteReportLink(reportId: string, madeFor: string, days: ReportLinkDays): Promise<Result<NewReportLink>> {
  const name = madeFor.trim().replace(/\s+/g, " ").slice(0, 120)
  if (!name) return err("VALIDATION", "Say who the link is for.")
  if (!REPORT_LINK_DAYS.includes(days)) return err("VALIDATION", "A link lasts 7, 30 or 90 days.")

  if (isMock()) {
    if (!mockStaff()) return err("FORBIDDEN", "Only coaches and club admins can share a report.")
    const report = readMockReports().find((item) => item.id === reportId)
    if (!report) return err("NOT_FOUND", "This report no longer exists.")
    const token = newToken()
    const now = new Date()
    const link: MockLink = {
      id: newId("link"),
      reportId,
      tokenHash: await sha256Hex(token),
      madeFor: name,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
      revokedAt: null,
      openCount: 0,
      lastOpenedAt: null,
      snapshot: report.snapshot,
    }
    if (!writeMockLinks([...readMockLinks(), link])) return err("UNKNOWN", STORAGE_BLOCKED)
    announce()
    return ok({ link: toLink(link), url: linkUrl(token) })
  }

  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  try {
    const { data, error } = await supabase.rpc("create_athlete_report_link", { p_report_id: reportId, p_made_for: name, p_days: days })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    const row = (Array.isArray(data) ? data[0] : data) as { link_id?: string; token?: string; expires_at?: string } | null
    if (!row?.token || !row.link_id || !row.expires_at) return err("UNKNOWN", "The link could not be made. Try again.")
    announce()
    return ok({
      link: toLink({ id: row.link_id, madeFor: name, createdAt: new Date().toISOString(), expiresAt: row.expires_at, revokedAt: null, openCount: 0, lastOpenedAt: null }),
      url: linkUrl(row.token),
    })
  } catch (cause) {
    return err("UNKNOWN", UNREACHABLE, cause)
  }
}

/** Stops a link working at once. */
export async function revokeAthleteReportLink(linkId: string): Promise<Result<null>> {
  if (isMock()) {
    if (!mockStaff()) return err("FORBIDDEN", "Only coaches and club admins can stop a link.")
    const links = readMockLinks()
    if (!writeMockLinks(links.map((link) => (link.id === linkId && !link.revokedAt ? { ...link, revokedAt: new Date().toISOString() } : link)))) return err("UNKNOWN", STORAGE_BLOCKED)
    announce()
    return ok(null)
  }
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  try {
    const { error } = await supabase.rpc("revoke_athlete_report_link", { p_link_id: linkId })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    announce()
    return ok(null)
  } catch (cause) {
    return err("UNKNOWN", UNREACHABLE, cause)
  }
}

/* ---------- Coach: a draft for every athlete of a team ------------------------------------------------- */

export type TeamDraftOutcome = { made: Array<{ athleteId: string; reportId: string }>; failed: Array<{ athleteId: string; message: string }> }

/**
 * Saves a report with an empty summary for each athlete, for the same period and sections, so the
 * coach can write the summaries one after another. One athlete failing does not stop the rest.
 */
export async function createTeamReportDrafts(athleteIds: string[], range: ReportRange, sections: readonly string[]): Promise<Result<TeamDraftOutcome>> {
  const problem = reportRangeProblem(range, todayIso())
  if (problem) return err("VALIDATION", problem)
  const clean = cleanReportSections(sections)
  const health = clean.includes("wellness") || clean.includes("injuries")
  const outcome: TeamDraftOutcome = { made: [], failed: [] }
  for (const athleteId of athleteIds.slice(0, 200)) {
    const context = await loadAthleteReportContext(athleteId, range, { health })
    if (!context.ok) {
      outcome.failed.push({ athleteId, message: context.error.message })
      continue
    }
    const snapshot = buildAthleteReportSnapshot(context.data.source, { range, sections: clean, summary: "", today: todayIso() })
    const saved = await saveAthleteReport({ athleteId, range, sections: clean, summary: "", snapshot })
    if (saved.ok) outcome.made.push({ athleteId, reportId: saved.data.reportId })
    else outcome.failed.push({ athleteId, message: saved.error.message })
  }
  return ok(outcome)
}

/* ---------- Athlete: reports shared with me ------------------------------------------------------------ */

export type MyReport = { id: string; authorName: string; period: ReportRange; sharedAt: string; snapshot: AthleteReportSnapshot }

function mockIsAthlete() {
  return mockSessionIdentity().role === "athlete"
}

/** The reports the signed-in athlete's coaches shared with them, newest first. */
export async function listMyReports(): Promise<Result<MyReport[]>> {
  if (isMock()) {
    if (!mockIsAthlete()) return ok([])
    return ok(
      readMockReports()
        .filter((report) => report.athleteId === MOCK_ATHLETE_ID && report.sharedWithAthleteAt)
        .sort((left, right) => (right.sharedWithAthleteAt ?? "").localeCompare(left.sharedWithAthleteAt ?? ""))
        .map((report) => ({ id: report.id, authorName: report.authorName, period: report.period, sharedAt: report.sharedWithAthleteAt as string, snapshot: report.snapshot })),
    )
  }
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  try {
    // Row level security returns only the athlete's own reports that were shared with them.
    const { data, error } = await supabase
      .from("athlete_reports")
      .select(REPORT_COLUMNS)
      .not("shared_with_athlete_at", "is", null)
      .order("shared_with_athlete_at", { ascending: false })
      .limit(100)
    if (error) return isMissing(error) ? ok([]) : { ok: false, error: mapPostgrestError(error) }
    return ok(
      ((data as ReportRow[] | null) ?? []).flatMap((row) => {
        const report = fromRow(row, [])
        return report && report.sharedWithAthleteAt ? [{ id: report.id, authorName: report.authorName, period: report.period, sharedAt: report.sharedWithAthleteAt, snapshot: report.snapshot }] : []
      }),
    )
  } catch (cause) {
    return err("UNKNOWN", UNREACHABLE, cause)
  }
}

export async function getMyReport(reportId: string): Promise<Result<MyReport>> {
  const all = await listMyReports()
  if (!all.ok) return all
  const report = all.data.find((item) => item.id === reportId)
  return report ? ok(report) : err("NOT_FOUND", "This report is no longer shared with you.")
}

/* ---------- Anyone with a link ------------------------------------------------------------------------- */

/**
 * What a private link shows: the snapshot, or null. Null means "not found" and nothing more: a
 * wrong address, an expired link and a revoked link are not told apart.
 */
export async function getSharedReport(token: string | null | undefined): Promise<Result<AthleteReportSnapshot | null>> {
  const clean = (token ?? "").trim().toLowerCase()
  if (!isReportLinkToken(clean)) return ok(null)

  if (isMock()) {
    const hash = await sha256Hex(clean)
    const links = readMockLinks()
    const link = links.find((item) => item.tokenHash === hash)
    if (!link || reportLinkState(link) !== "active") return ok(null)
    writeMockLinks(links.map((item) => (item.id === link.id ? { ...item, openCount: item.openCount + 1, lastOpenedAt: new Date().toISOString() } : item)))
    return ok(readAthleteReportSnapshot(link.snapshot))
  }

  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  try {
    const { data, error } = await supabase.rpc("get_shared_athlete_report", { p_token: clean })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(readAthleteReportSnapshot(data))
  } catch (cause) {
    return err("UNKNOWN", UNREACHABLE, cause)
  }
}
