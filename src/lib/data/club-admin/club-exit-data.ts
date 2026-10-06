import { clearSessionCookies, getCookieValue, USER_COOKIE } from "@/lib/auth-session"
import { dataRightsClient, isMockMode, mapDataRightsError, readAllRows } from "@/lib/data/account/data-rights-data"
import { getClubAthletes } from "@/lib/data/club-admin/people-data"
import { err, ok, type Result } from "@/lib/data/result"
import { buildClubExportFiles, buildZip, isTypedConfirmation, type ClubExportTable } from "@/lib/data-rights"
import { loadAuditLogs, logAuditEvent } from "@/lib/mock-audit"
import { MOCK_COACH_TEAM_STORAGE_KEY, MOCK_ROLE_STORAGE_KEY } from "@/lib/mock-auth"
import { loadClubProfile, loadClubTeams, loadClubUsers } from "@/lib/mock-club-admin"
import { closeMockClub, getMockClubClosure, getMockClubOwnerEmail, mockTenantId, setMockClubOwnerEmail } from "@/lib/mock-data-rights"

/**
 * The club's side of data rights: who owns the club, handing it to another admin, exporting
 * everything, and closing the club (which starts the 90 days after which it is deleted).
 * Supabase mode calls the functions of 20261014120000; mock mode keeps the same rules in
 * the demo stores.
 */

export type ClubAdminOption = { userId: string; name: string; email: string | null }

export type ClubOwnership = {
  clubName: string
  ownerUserId: string | null
  ownerName: string | null
  isOwner: boolean
  /** Active club admins other than the owner: who the club could be handed to. */
  otherAdmins: ClubAdminOption[]
}

function mockEmail() {
  return getCookieValue(USER_COOKIE)?.trim().toLowerCase() || null
}

function mockOwnership(): ClubOwnership {
  const users = loadClubUsers()
  const ownerEmail = getMockClubOwnerEmail(mockTenantId())
  const owner = users.find((user) => user.email.toLowerCase() === ownerEmail)
  return {
    clubName: loadClubProfile().clubName,
    ownerUserId: owner?.id ?? null,
    ownerName: owner?.name ?? "Club Admin",
    isOwner: mockEmail() === ownerEmail,
    otherAdmins: users
      .filter((user) => user.role === "club-admin" && user.status === "active" && user.email.toLowerCase() !== ownerEmail)
      .map((user) => ({ userId: user.id, name: user.name, email: user.email })),
  }
}

export async function getClubOwnership(): Promise<Result<ClubOwnership>> {
  if (isMockMode()) return ok(mockOwnership())
  const client = dataRightsClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.rpc("get_club_ownership")
  if (error) return { ok: false, error: mapDataRightsError(error) }
  const row = data as {
    club_name?: string
    owner_user_id?: string | null
    owner_name?: string | null
    is_owner?: boolean
    other_admins?: Array<{ user_id: string; name: string; email: string | null }>
  } | null
  if (!row) return err("FORBIDDEN", "Only club staff can see who owns the club.")
  return ok({
    clubName: row.club_name ?? "",
    ownerUserId: row.owner_user_id ?? null,
    ownerName: row.owner_name ?? null,
    isOwner: row.is_owner === true,
    otherAdmins: (row.other_admins ?? []).map((admin) => ({ userId: admin.user_id, name: admin.name, email: admin.email })),
  })
}

/** Hands the club to another active club admin. Owner only; `typedName` is the club's name as typed. */
export async function transferClubOwnership(newOwnerUserId: string, typedName: string): Promise<Result<null>> {
  if (isMockMode()) {
    const ownership = mockOwnership()
    if (!ownership.isOwner) return err("FORBIDDEN", "Only the club owner can transfer ownership.")
    const target = ownership.otherAdmins.find((admin) => admin.userId === newOwnerUserId)
    if (!target?.email) return err("VALIDATION", "The new owner must be an active club admin of this club.")
    if (!isTypedConfirmation(ownership.clubName, typedName)) return err("VALIDATION", "Type the club's name exactly to transfer ownership.")
    if (!setMockClubOwnerEmail(mockTenantId(), target.email)) return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    logAuditEvent({ actor: mockEmail() ?? "club admin", action: "club_ownership_transferred", target: target.name, detail: `${ownership.ownerName ?? "The owner"} handed the club to ${target.name}` })
    return ok(null)
  }
  const client = dataRightsClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { error } = await client.rpc("transfer_club_ownership", { p_new_owner_user_id: newOwnerUserId, p_confirm_name: typedName })
  if (error) return { ok: false, error: mapDataRightsError(error) }
  return ok(null)
}

/* ---------- Whole club export ----------------------------------------------------------------------- */

export type ClubExport = { zipName: string; bytes: Uint8Array; counts: Array<{ file: string; label: string; rows: number }>; problems: string[] }

type TableSpec = { file: string; label: string; table: string; select?: string; orderBy?: string; health?: boolean }

/** Everything a club admin can read about their own club, one table per file. */
const CLUB_TABLES: TableSpec[] = [
  { file: "teams", label: "Teams", table: "teams" },
  { file: "team-coaches", label: "Which coach is on which team", table: "team_coaches" },
  { file: "plans", label: "Training plans", table: "training_plans", select: "id, team_id, name, start_date, weeks, status, notes, created_by_user_id, published_at, created_at, updated_at" },
  { file: "plan-assignments", label: "Who each plan is assigned to", table: "training_plan_assignments" },
  { file: "sessions", label: "Sessions", table: "sessions" },
  { file: "sessions-finished", label: "Finished sessions", table: "session_completions" },
  { file: "session-logs", label: "Session logs", table: "session_row_logs" },
  { file: "results", label: "Results", table: "athlete_results" },
  { file: "personal-bests", label: "Personal bests", table: "pr_records" },
  { file: "test-weeks", label: "Test weeks", table: "test_weeks" },
  { file: "test-week-results", label: "Test week results", table: "test_results", select: "*, test_definitions(name, unit)" },
  { file: "attendance", label: "Attendance", table: "athlete_attendance" },
  { file: "competitions", label: "Competitions", table: "competitions" },
  { file: "competition-entries", label: "Competition entries", table: "competition_entries" },
  { file: "goals", label: "Athlete goals", table: "athlete_goals" },
  { file: "announcements", label: "Announcements", table: "announcements" },
  { file: "activity-log", label: "Activity log", table: "audit_events", orderBy: "occurred_at" },
  { file: "wellness", label: "Wellness check-ins", table: "wellness_entries", health: true },
  { file: "pain-reports", label: "Pain and injury reports", table: "pain_reports", health: true },
  { file: "availability", label: "Injured, sick and away", table: "athlete_availability", health: true },
]

async function collectSupabaseTables(): Promise<Result<{ clubName: string; by: string | null; tables: ClubExportTable[] }>> {
  const client = dataRightsClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const ownership = await getClubOwnership()
  if (!ownership.ok) return ownership
  const { data: sessionData } = await client.auth.getSession()
  const me = sessionData.session?.user

  const emails = new Map<string, string>()
  const emailRows = await client.rpc("get_tenant_member_emails")
  if (!emailRows.error) {
    for (const row of (emailRows.data as Array<{ user_id: string | null; email: string | null }> | null) ?? []) {
      if (row.user_id && row.email) emails.set(row.user_id, row.email)
    }
  }

  const tables: ClubExportTable[] = []

  const people = await readAllRows(client, "profiles", "user_id, role, display_name, is_active, created_at", (query) => query, "created_at", "user_id")
  tables.push({
    file: "people",
    label: "People",
    rows: people.rows.map((row) => ({ ...row, email: emails.get(String(row.user_id)) ?? null })),
    error: people.error,
  })

  const athletes = await readAllRows(client, "athletes", "*", (query) => query)
  const details = await readAllRows(client, "athlete_private_details", "*", (query) => query, "created_at", "athlete_id")
  const detailsByAthlete = new Map(details.rows.map((row) => [String(row.athlete_id), row]))
  tables.push({
    file: "athletes",
    label: "Athletes with private details",
    healthColumns: ["medical_notes"],
    error: athletes.error ?? details.error,
    rows: athletes.rows.map((athlete) => {
      const detail = detailsByAthlete.get(String(athlete.id)) ?? {}
      const privateDetails = Object.fromEntries(Object.entries(detail).filter(([key]) => !["athlete_id", "tenant_id", "created_at", "updated_at"].includes(key)))
      return { ...athlete, email: athlete.user_id ? (emails.get(String(athlete.user_id)) ?? null) : null, ...privateDetails }
    }),
  })

  for (const spec of CLUB_TABLES) {
    const result = await readAllRows(client, spec.table, spec.select ?? "*", (query) => query, spec.orderBy)
    tables.push({ file: spec.file, label: spec.label, rows: result.rows, health: spec.health, error: result.error })
  }

  const by = me ? (people.rows.find((row) => row.user_id === me.id)?.display_name as string | null | undefined) ?? me.email ?? null : null
  return ok({ clubName: ownership.data.clubName || "club", by, tables })
}

async function collectMockTables(): Promise<Result<{ clubName: string; by: string | null; tables: ClubExportTable[] }>> {
  const mock = await import("@/lib/mock-data")
  const athletes = await getClubAthletes()
  const tables: ClubExportTable[] = [
    { file: "teams", label: "Teams", rows: loadClubTeams().map((team) => ({ ...team })) },
    { file: "people", label: "People", rows: loadClubUsers().map((user) => ({ ...user })) },
    {
      file: "athletes",
      label: "Athletes with private details",
      healthColumns: ["medical_notes"],
      rows: (athletes.ok ? athletes.data : []).map((athlete) => ({ ...athlete, emergency_contact_name: null, medical_notes: athlete.id === "a7" ? "Sample: knee, cleared for light work" : null })),
    },
    { file: "plans", label: "Training plans", rows: mock.mockTrainingPlans.map((plan) => ({ ...plan })) },
    { file: "session-logs", label: "Session logs", rows: mock.mockLogs.map((log) => ({ ...log })) },
    { file: "personal-bests", label: "Personal bests", rows: mock.mockPRs.map((record) => ({ ...record })) },
    { file: "test-week-results", label: "Test week results", rows: mock.mockTestWeekResults.map((row) => ({ ...row })) },
    { file: "attendance", label: "Attendance", rows: [] },
    { file: "competitions", label: "Competitions", rows: [] },
    { file: "announcements", label: "Announcements", rows: [] },
    { file: "activity-log", label: "Activity log", rows: loadAuditLogs().map((event) => ({ ...event })) },
    { file: "wellness", label: "Wellness check-ins", health: true, rows: mock.mockWellness.map((entry) => ({ ...entry })) },
    { file: "pain-reports", label: "Pain and injury reports", health: true, rows: [] },
  ]
  return ok({ clubName: loadClubProfile().clubName, by: mockEmail(), tables })
}

/**
 * Builds the whole club export: one zip of CSV files and a readme with the number of rows in each.
 * Health data (wellness check-ins, pain reports, availability and medical notes) is only read
 * into the archive when `includeHealth` is true.
 */
export async function collectClubExport(includeHealth: boolean): Promise<Result<ClubExport>> {
  const collected = isMockMode() ? await collectMockTables() : await collectSupabaseTables()
  if (!collected.ok) return collected
  const built = buildClubExportFiles({
    clubName: collected.data.clubName,
    generatedAt: new Date().toISOString(),
    generatedBy: collected.data.by,
    includeHealth,
    tables: collected.data.tables,
    sample: isMockMode(),
  })
  return ok({
    zipName: built.zipName,
    bytes: buildZip(built.files),
    counts: built.counts,
    problems: collected.data.tables.filter((table) => table.error && (includeHealth || !table.health)).map((table) => `${table.label}: ${table.error}`),
  })
}

/* ---------- Closing the club ------------------------------------------------------------------------ */

export type ClubClosure = { clubName: string; closedAt: string; deleteAfter: string; deleted: boolean }

/** Why the signed-in member is locked out: their club is closed. Null when it is not. */
export async function getMyClubClosure(): Promise<ClubClosure | null> {
  if (isMockMode()) {
    const closure = getMockClubClosure(mockTenantId())
    return closure ? { clubName: closure.clubName, closedAt: closure.closedAt, deleteAfter: closure.deleteAfter, deleted: Boolean(closure.deletedAt) } : null
  }
  const client = dataRightsClient()
  if (!client) return null
  try {
    const { data, error } = await client.rpc("get_current_club_closure")
    const row = data as { club_name?: string; closed_at?: string; delete_after?: string } | null
    if (error || !row?.closed_at || !row.delete_after) return null
    return { clubName: row.club_name ?? "", closedAt: row.closed_at, deleteAfter: row.delete_after, deleted: false }
  } catch {
    return null
  }
}

/**
 * Closes the club. Owner only; `typedName` is the club's name as typed. Every member is locked out
 * at once (this device is signed out), nothing is deleted, and the 90 days start.
 */
export async function closeClub(typedName: string): Promise<Result<ClubClosure>> {
  if (isMockMode()) {
    const ownership = mockOwnership()
    if (!ownership.isOwner) return err("FORBIDDEN", "Only the club owner can close the club.")
    if (!isTypedConfirmation(ownership.clubName, typedName)) return err("VALIDATION", "Type the club's name exactly to close it.")
    const athletes = await getClubAthletes()
    logAuditEvent({ actor: mockEmail() ?? "club owner", action: "club_closed", target: ownership.clubName, detail: "closed by the owner" })
    const closure = closeMockClub({
      tenantId: mockTenantId(),
      clubName: ownership.clubName,
      closedByName: ownership.ownerName ?? "Club owner",
      memberCount: loadClubUsers().length,
      athleteCount: athletes.ok ? athletes.data.length : 0,
    })
    if (!closure) return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    return ok({ clubName: closure.clubName, closedAt: closure.closedAt, deleteAfter: closure.deleteAfter, deleted: false })
  }
  const client = dataRightsClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.rpc("close_current_club", { p_confirm_name: typedName })
  if (error) return { ok: false, error: mapDataRightsError(error) }
  const row = data as { club_name?: string; closed_at?: string; delete_after?: string } | null
  if (!row?.closed_at || !row.delete_after) return err("UNKNOWN", "The club was closed but did not report back. Reload the page.")
  return ok({ clubName: row.club_name ?? "", closedAt: row.closed_at, deleteAfter: row.delete_after, deleted: false })
}

/** Signs this device out after the club was closed (every member is locked out by then). */
export async function signOutAfterClosing() {
  if (isMockMode()) {
    window.localStorage.removeItem(MOCK_ROLE_STORAGE_KEY)
    window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
  } else {
    await dataRightsClient()?.auth.signOut({ scope: "local" }).catch(() => undefined)
  }
  clearSessionCookies()
}
