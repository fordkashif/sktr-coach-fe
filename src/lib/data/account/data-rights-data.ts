import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"
import { ACCESS_PAUSED_MESSAGE, isAccessPausedError } from "@/lib/access-paused"
import { clearSessionCookies, COACH_TEAM_COOKIE, getCookieValue, ROLE_COOKIE, USER_COOKIE } from "@/lib/auth-session"
import { getCurrentAccount, removeAvatar } from "@/lib/data/account/account-data"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import {
  COACH_NOTES_AREA_KEY,
  buildPersonalExport,
  evaluateDeletion,
  isTypedConfirmation,
  personalExportFileName,
  type BlockingTeam,
  type CoachedTeam,
  type DeletionBlockReason,
  type DeletionCheck,
  type ExportRole,
  type PersonalExportArea,
  type PersonalExportFile,
} from "@/lib/data-rights"
import { logAuditEvent } from "@/lib/mock-audit"
import { MOCK_COACH_TEAM_STORAGE_KEY, MOCK_COACH_TEAMS_STORAGE_KEY, MOCK_ROLE_STORAGE_KEY, getMockCoachConfig } from "@/lib/mock-auth"
import { loadClubProfile, loadClubTeams, loadClubUsers, saveClubUsers } from "@/lib/mock-club-admin"
import { getMockClubOwnerEmail, logMockExport, markMockAccountDeleted, mockTenantId } from "@/lib/mock-data-rights"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * Personal data rights for the signed-in person: a copy of their data, and deleting their account.
 *
 * Supabase mode: the export is built in the browser from plain table reads, so it can only ever
 * hold what row level security already lets this person read. Deleting calls the database
 * function delete_my_account (20261014120000), which checks the rules again and removes the
 * login itself; the browser never deletes a user.
 * Mock mode: a sample export from the demo data, and the same rules against the demo stores.
 */

/* ---------- Shared with the club and platform data files -------------------------------------------- */

const NOT_SWITCHED_ON = "This is not available yet. The database needs its latest update. Try again later or email support."

/**
 * Errors raised by the data rights functions are already plain sentences (SQLSTATE P0001 with a
 * hint that names the reason), so they are shown as they are.
 */
export function mapDataRightsError(error: PostgrestError): DataError {
  if (isAccessPausedError(error)) return { code: "FORBIDDEN", message: ACCESS_PAUSED_MESSAGE, cause: error }
  if (error.code === "P0001") return { code: error.hint === "confirm_mismatch" ? "VALIDATION" : "FORBIDDEN", message: error.message, cause: error }
  if (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "")) return { code: "UNKNOWN", message: NOT_SWITCHED_ON, cause: error }
  return mapPostgrestError(error)
}

export function dataRightsClient(): SupabaseClient | null {
  return getBackendMode() === "supabase" ? getBrowserSupabaseClient() : null
}

export function isMockMode() {
  return getBackendMode() !== "supabase"
}

/** Hands a file made in the browser to the person: a JSON export, a zip. */
export function downloadFile(filename: string, content: string | Uint8Array, type: string) {
  const blob = new Blob([content as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Some browsers start the download a moment after the click.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const PAGE = 1000
const MAX_ROWS = 50_000

type Query = {
  eq: (column: string, value: string) => Query
  in: (column: string, values: string[]) => Query
  order: (column: string, options?: { ascending?: boolean }) => Query
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: PostgrestError | null }>
}

/**
 * Reads every row a query returns, a page at a time. A failure does not throw: the rows read so
 * far come back with the reason, so one unreadable table never loses the rest of an export.
 */
export async function readAllRows(
  client: SupabaseClient,
  table: string,
  select: string,
  apply: (query: Query) => Query,
  orderBy: string = "created_at",
  /** Second sort column, so pages do not overlap when many rows share a timestamp. */
  tieBreak: string = "id",
): Promise<{ rows: Array<Record<string, unknown>>; error?: string }> {
  const rows: Array<Record<string, unknown>> = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const base = client.from(table).select(select) as unknown as Query
    const { data, error } = await apply(base).order(orderBy, { ascending: true }).order(tieBreak, { ascending: true }).range(from, from + PAGE - 1)
    if (error) return { rows, error: isAccessPausedError(error) ? "Your access is paused." : error.code === "42501" ? "You do not have access to this." : "It could not be read." }
    const page = (data ?? []) as Array<Record<string, unknown>>
    rows.push(...page)
    if (page.length < PAGE) return { rows }
  }
  return { rows, error: `Only the first ${MAX_ROWS} records are included.` }
}

function chunk<T>(values: T[], size = 150): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

async function readByIds(client: SupabaseClient, table: string, select: string, column: string, ids: string[], orderBy = "created_at", tieBreak = "id") {
  const rows: Array<Record<string, unknown>> = []
  let error: string | undefined
  for (const part of chunk(ids)) {
    const result = await readAllRows(client, table, select, (query) => query.in(column, part), orderBy, tieBreak)
    rows.push(...result.rows)
    error = error ?? result.error
  }
  return { rows, error }
}

/* ---------- Download your data ---------------------------------------------------------------------- */

export type PersonalExport = { fileName: string; json: string; file: PersonalExportFile }

type AreaSpec = { key: string; label: string; table: string; select?: string; column: string; ids: string[]; orderBy?: string; tieBreak?: string }

async function readAreas(client: SupabaseClient, specs: AreaSpec[]): Promise<PersonalExportArea[]> {
  const areas: PersonalExportArea[] = []
  for (const spec of specs) {
    if (spec.ids.length === 0) {
      areas.push({ key: spec.key, label: spec.label, rows: [] })
      continue
    }
    const result = await readByIds(client, spec.table, spec.select ?? "*", spec.column, spec.ids, spec.orderBy, spec.tieBreak)
    areas.push({ key: spec.key, label: spec.label, rows: result.rows, error: result.error })
  }
  return areas
}

function athleteSpecs(userId: string, athleteIds: string[], threadIds: string[]): AreaSpec[] {
  return [
    { key: "private_details", label: "Private details", table: "athlete_private_details", column: "athlete_id", ids: athleteIds, tieBreak: "athlete_id" },
    { key: "training_sessions", label: "Training sessions", table: "sessions", select: "*, session_blocks(*, session_block_rows(*))", column: "athlete_id", ids: athleteIds },
    { key: "session_logs", label: "Session logs", table: "session_row_logs", column: "athlete_id", ids: athleteIds },
    { key: "sessions_finished", label: "Finished sessions", table: "session_completions", column: "athlete_id", ids: athleteIds },
    { key: "wellness_check_ins", label: "Wellness check-ins", table: "wellness_entries", column: "athlete_id", ids: athleteIds },
    { key: "pain_reports", label: "Pain and injury reports", table: "pain_reports", column: "athlete_id", ids: athleteIds },
    { key: "availability", label: "Injured, sick and away", table: "athlete_availability", column: "athlete_id", ids: athleteIds },
    { key: "results", label: "Results", table: "athlete_results", column: "athlete_id", ids: athleteIds },
    { key: "personal_bests", label: "Personal bests", table: "pr_records", column: "athlete_id", ids: athleteIds },
    { key: "test_week_results", label: "Test week results", table: "test_results", select: "*, test_definitions(name, unit)", column: "athlete_id", ids: athleteIds },
    { key: "lift_maxes", label: "Lift maxes", table: "athlete_lift_maxes", column: "athlete_id", ids: athleteIds },
    { key: "goals", label: "Goals", table: "athlete_goals", column: "athlete_id", ids: athleteIds },
    { key: "attendance", label: "Attendance", table: "athlete_attendance", column: "athlete_id", ids: athleteIds },
    { key: "competition_entries", label: "Competition entries", table: "competition_entries", select: "*, competitions(name, start_date, venue)", column: "athlete_id", ids: athleteIds },
    { key: "competitions_you_added", label: "Competitions you added", table: "competitions", column: "owner_athlete_id", ids: athleteIds },
    { key: "conversations", label: "Conversations with coaches", table: "message_threads", column: "athlete_id", ids: athleteIds },
    { key: "messages", label: "Messages sent and received", table: "messages", column: "thread_id", ids: threadIds },
    { key: "plans_assigned_to_you", label: "Plans assigned to you", table: "training_plan_assignments", select: "*, training_plans(name, start_date, weeks)", column: "athlete_id", ids: athleteIds },
    { key: "join_codes_used", label: "Team join codes you used", table: "team_join_code_uses", column: "user_id", ids: [userId], orderBy: "joined_at" },
  ]
}

function staffSpecs(userId: string, threadIds: string[], isAdmin: boolean): AreaSpec[] {
  const me = [userId]
  const specs: AreaSpec[] = [
    { key: "contact_setting", label: "Contact setting for athletes", table: "coach_contact_settings", column: "user_id", ids: me, tieBreak: "user_id" },
    { key: "team_assignments", label: "Teams you coach", table: "team_coaches", select: "*, teams(name)", column: "user_id", ids: me },
    { key: "plans_you_wrote", label: "Training plans you wrote", table: "training_plans", select: "*, training_plan_weeks(*, training_plan_days(*, training_plan_blocks(*)))", column: "created_by_user_id", ids: me },
    { key: "plan_templates_you_saved", label: "Plan templates you saved", table: "plan_templates", column: "created_by_user_id", ids: me },
    { key: "exercises_you_added", label: "Exercises you added", table: "exercise_library", column: "created_by_user_id", ids: me },
    { key: COACH_NOTES_AREA_KEY, label: "Notes you wrote about athletes", table: "coach_athlete_notes", column: "author_user_id", ids: me },
    { key: "test_weeks_you_set_up", label: "Test weeks you set up", table: "test_weeks", select: "*, test_definitions(*)", column: "created_by_user_id", ids: me },
    { key: "competitions_you_added", label: "Competitions you added", table: "competitions", column: "created_by_user_id", ids: me },
    { key: "announcements_you_sent", label: "Announcements you sent", table: "announcements", column: "sender_user_id", ids: me },
    { key: "conversations", label: "Conversations with athletes", table: "message_threads", column: "coach_user_id", ids: me },
    { key: "messages", label: "Messages sent and received", table: "messages", column: "thread_id", ids: threadIds },
    { key: "activity", label: "Your actions in the club's activity log", table: "audit_events", column: "actor_user_id", ids: me, orderBy: "occurred_at" },
  ]
  if (isAdmin) specs.push({ key: "package_requests", label: "Package requests you made", table: "tenant_package_upgrade_requests", column: "requested_by_user_id", ids: me })
  return specs
}

function everyoneSpecs(userId: string): AreaSpec[] {
  const me = [userId]
  return [
    { key: "notification_choices", label: "Notification choices", table: "notification_preferences", column: "user_id", ids: me },
    {
      key: "announcements_received",
      label: "Announcements you received",
      table: "announcement_recipients",
      select: "read_at, created_at, announcements(body, audience, sender_role, created_at)",
      column: "recipient_user_id",
      ids: me,
      tieBreak: "announcement_id",
    },
    {
      key: "notifications",
      label: "Notifications",
      table: "user_notifications",
      select: "state, read_at, dismissed_at, created_at, notification_events(event_type, channel, subject, body, created_at)",
      column: "recipient_user_id",
      ids: me,
    },
  ]
}

async function collectSupabaseExport(client: SupabaseClient): Promise<Result<PersonalExport>> {
  const { data: sessionData } = await client.auth.getSession()
  const user = sessionData.session?.user
  if (!user) return err("UNAUTHORIZED", "You are not signed in.")

  const accountResult = await getCurrentAccount()
  const role = (accountResult.ok ? accountResult.data.role : null) as ExportRole | null
  const profile = await client.from("profiles").select("*").eq("user_id", user.id).maybeSingle()
  if (profile.error && isAccessPausedError(profile.error)) return err("FORBIDDEN", ACCESS_PAUSED_MESSAGE)
  const club = await client.from("club_profiles").select("club_name").limit(1).maybeSingle()
  const clubName = (club.data as { club_name?: string | null } | null)?.club_name ?? null

  const areas: PersonalExportArea[] = [
    {
      key: "account",
      label: "Account and profile",
      rows: [
        {
          user_id: user.id,
          email: user.email ?? null,
          email_waiting_for_confirmation: user.new_email ?? null,
          account_created_at: user.created_at ?? null,
          last_sign_in_at: user.last_sign_in_at ?? null,
          name: accountResult.ok ? accountResult.data.displayName : null,
          photo_url: accountResult.ok ? accountResult.data.avatarUrl : null,
          club: clubName,
          profile: profile.data ?? null,
        },
      ],
    },
  ]

  if (role === "athlete") {
    const athletes = await readAllRows(client, "athletes", "*", (query) => query.eq("user_id", user.id))
    areas.push({ key: "athlete_profile", label: "Athlete profile", rows: athletes.rows, error: athletes.error })
    const athleteIds = athletes.rows.map((row) => String(row.id))
    const threads = athleteIds.length ? await readByIds(client, "message_threads", "id", "athlete_id", athleteIds) : { rows: [] }
    areas.push(...(await readAreas(client, athleteSpecs(user.id, athleteIds, threads.rows.map((row) => String(row.id))))))
  } else if (role === "coach" || role === "club-admin") {
    const threads = await readAllRows(client, "message_threads", "id", (query) => query.eq("coach_user_id", user.id))
    areas.push(...(await readAreas(client, staffSpecs(user.id, threads.rows.map((row) => String(row.id)), role === "club-admin"))))
  } else if (role === "platform-admin") {
    areas.push(
      ...(await readAreas(client, [
        { key: "platform_admin_record", label: "Platform admin record", table: "platform_admin_contacts", column: "user_id", ids: [user.id] },
        { key: "activity", label: "Your actions in the platform log", table: "platform_audit_events", column: "actor_user_id", ids: [user.id], orderBy: "occurred_at" },
      ])),
    )
  }
  areas.push(...(await readAreas(client, everyoneSpecs(user.id))))

  const generatedAt = new Date().toISOString()
  const name = accountResult.ok ? accountResult.data.displayName : null
  const file = buildPersonalExport({ generatedAt, role, account: { name, email: user.email ?? null, club: clubName }, areas })
  return ok({ fileName: personalExportFileName(name ?? user.email ?? null, generatedAt), json: JSON.stringify(file, null, 2), file })
}

function mockEmail() {
  return getCookieValue(USER_COOKIE)?.trim().toLowerCase() || null
}

function mockRole(): ExportRole | null {
  const role = getCookieValue(ROLE_COOKIE)
  return role === "athlete" || role === "coach" || role === "club-admin" || role === "platform-admin" ? role : null
}

async function collectMockExport(): Promise<Result<PersonalExport>> {
  const email = mockEmail()
  const role = mockRole()
  if (!email || !role) return err("UNAUTHORIZED", "You are not signed in.")
  const accountResult = await getCurrentAccount()
  const name = accountResult.ok ? accountResult.data.displayName : null
  const mock = await import("@/lib/mock-data")
  const clubName = role === "platform-admin" ? null : loadClubProfile().clubName

  const areas: PersonalExportArea[] = [{ key: "account", label: "Account and profile", rows: [{ email, name, role, club: clubName, photo: accountResult.ok && accountResult.data.avatarUrl ? "on file" : null }] }]

  if (role === "athlete") {
    const id = "a1"
    areas.push(
      { key: "athlete_profile", label: "Athlete profile", rows: mock.mockAthletes.filter((athlete) => athlete.id === id) },
      { key: "private_details", label: "Private details", rows: [{ emergency_contact_name: "Sample contact", emergency_contact_phone: "+1 876 555 0100" }] },
      { key: "session_logs", label: "Session logs", rows: mock.mockLogs.filter((log) => log.athleteId === id) },
      { key: "wellness_check_ins", label: "Wellness check-ins", rows: mock.mockWellness.filter((entry) => entry.athleteId === id) },
      { key: "pain_reports", label: "Pain and injury reports", rows: [] },
      { key: "personal_bests", label: "Personal bests", rows: mock.mockPRs.filter((record) => (record as { athleteId?: string }).athleteId === id) },
      { key: "test_week_results", label: "Test week results", rows: mock.mockTestWeekResults.filter((result) => result.athleteId === id) },
      { key: "goals", label: "Goals", rows: [] },
      { key: "attendance", label: "Attendance", rows: [] },
      { key: "messages", label: "Messages sent and received", rows: [{ from: "Coach", body: "Sample message", sent_at: "2026-02-25T08:00:00.000Z" }] },
    )
  } else if (role === "coach" || role === "club-admin") {
    areas.push(
      { key: "plans_you_wrote", label: "Training plans you wrote", rows: mock.mockTrainingPlans },
      { key: "plan_templates_you_saved", label: "Plan templates you saved", rows: [] },
      { key: "exercises_you_added", label: "Exercises you added", rows: [] },
      { key: COACH_NOTES_AREA_KEY, label: "Notes you wrote about athletes", rows: [{ athlete: "Sample athlete", body: "Sample note", written_on: "2026-02-25" }] },
      { key: "messages", label: "Messages sent and received", rows: [{ to: "Sample athlete", body: "Sample message", sent_at: "2026-02-25T08:00:00.000Z" }] },
    )
  }
  areas.push({ key: "notification_choices", label: "Notification choices", rows: [] }, { key: "notifications", label: "Notifications", rows: [] })

  const generatedAt = new Date().toISOString()
  const file = buildPersonalExport({ generatedAt, role, account: { name, email, club: clubName }, areas, sample: true })
  return ok({ fileName: personalExportFileName(name ?? email, generatedAt), json: JSON.stringify(file, null, 2), file })
}

/** Everything stored about the signed-in person, as one JSON file with a summary at the top. */
export async function collectPersonalExport(): Promise<Result<PersonalExport>> {
  const client = dataRightsClient()
  if (isMockMode()) return collectMockExport()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  return collectSupabaseExport(client)
}

/**
 * Writes the audit entry for an export: who and when, never the content. A failure here does not
 * take the file away from the person (the caller downloads first), it is reported back.
 */
export async function recordDataExport(kind: "personal" | "club", includeHealth = false): Promise<Result<null>> {
  if (isMockMode()) {
    const email = mockEmail() ?? "unknown"
    logMockExport({ email, kind, includeHealth })
    if (kind === "club" || mockRole() === "club-admin") {
      logAuditEvent({
        actor: email,
        action: kind === "club" ? "club_data_exported" : "personal_data_exported",
        target: kind === "club" ? "club" : "club-admin",
        detail: kind === "club" ? (includeHealth ? "whole club export, health data included" : "whole club export, without health data") : "downloaded a copy of their own data",
      })
    }
    return ok(null)
  }
  const client = dataRightsClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { error } = await client.rpc("record_data_export", { p_kind: kind, p_include_health: includeHealth })
  if (error) return { ok: false, error: mapDataRightsError(error) }
  return ok(null)
}

/* ---------- Delete your account --------------------------------------------------------------------- */

function mockCoachTeams(email: string): CoachedTeam[] {
  const stored = window.localStorage.getItem(MOCK_COACH_TEAMS_STORAGE_KEY)
  const ids = stored
    ? stored.split(",").map((id) => id.trim()).filter(Boolean)
    : [getCookieValue(COACH_TEAM_COOKIE) || window.localStorage.getItem(MOCK_COACH_TEAM_STORAGE_KEY) || getMockCoachConfig(email)?.defaultTeamId || ""].filter(Boolean)
  const teams = loadClubTeams()
  return ids.map((id) => {
    const team = teams.find((item) => item.id === id)
    // The demo coach is the only coach of each of their teams.
    return { id, name: team?.name ?? "your team", isLead: true, otherCoaches: 0, athletes: 1, archived: team?.status === "archived" }
  })
}

/** What stands in the way of deleting the signed-in person's account. */
export async function getAccountDeletionCheck(): Promise<Result<DeletionCheck>> {
  if (isMockMode()) {
    const email = mockEmail()
    const role = mockRole()
    if (!email || !role) return err("UNAUTHORIZED", "You are not signed in.")
    return ok(
      evaluateDeletion({
        role,
        email,
        isClubOwner: role === "club-admin" && getMockClubOwnerEmail(mockTenantId()) === email,
        teams: role === "coach" ? mockCoachTeams(email) : [],
      }),
    )
  }
  const client = dataRightsClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.rpc("get_my_account_deletion_check")
  if (error) return { ok: false, error: mapDataRightsError(error) }
  const row = data as {
    role?: string
    can_delete?: boolean
    reason?: string | null
    email?: string | null
    blocking_teams?: Array<{ team_id: string; team_name: string; reason: string; athletes: number }>
  } | null
  if (!row) return err("UNAUTHORIZED", "You are not signed in.")
  const role = row.role === "athlete" || row.role === "coach" || row.role === "club-admin" || row.role === "platform-admin" ? row.role : "none"
  const reason: DeletionBlockReason | null = row.reason === "platform_admin" || row.reason === "club_owner" || row.reason === "teams" ? row.reason : null
  return ok({
    role,
    canDelete: row.can_delete === true,
    reason,
    email: row.email ?? null,
    blockingTeams: (row.blocking_teams ?? []).map(
      (team): BlockingTeam => ({ teamId: team.team_id, teamName: team.team_name, reason: team.reason === "lead" ? "lead" : "only_coach", athletes: Number(team.athletes) || 0 }),
    ),
  })
}

/**
 * Deletes the signed-in person's account and personal data, then signs this device out.
 * `typedEmail` is what they typed to confirm; the database checks it and every rule again.
 */
export async function deleteMyAccount(typedEmail: string): Promise<Result<{ conversationsKept: boolean }>> {
  const check = await getAccountDeletionCheck()
  if (!check.ok) return check
  if (!check.data.canDelete) return err("FORBIDDEN", "Your account cannot be deleted yet. See what has to happen first above.")
  if (!isTypedConfirmation(check.data.email, typedEmail)) return err("VALIDATION", "Type your sign-in email exactly to delete your account.")

  if (isMockMode()) {
    const email = check.data.email as string
    if (!markMockAccountDeleted(email)) return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    if (check.data.role !== "athlete") saveClubUsers(loadClubUsers().filter((user) => user.email.toLowerCase() !== email))
    window.localStorage.removeItem(MOCK_ROLE_STORAGE_KEY)
    window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
    clearSessionCookies()
    return ok({ conversationsKept: check.data.role === "athlete" })
  }

  const client = dataRightsClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  // The photo file is the person's own, so they remove it themselves while they still can. If this
  // fails the database queues the file and the storage clean-up function removes it later.
  await removeAvatar().catch(() => undefined)
  const { data, error } = await client.rpc("delete_my_account", { p_confirm_email: typedEmail })
  if (error) return { ok: false, error: mapDataRightsError(error) }
  await client.auth.signOut({ scope: "local" }).catch(() => undefined)
  clearSessionCookies()
  return ok({ conversationsKept: (data as { conversations_kept?: boolean } | null)?.conversations_kept === true })
}
