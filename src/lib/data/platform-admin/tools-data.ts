import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { kickNotificationEmails } from "@/lib/data/notifications-data"
import {
  isUsagePeriod,
  normalizeEmail,
  validateNoticeDraft,
  type ClubUsage,
  type EmailStatus,
  type NoticeAudience,
  type NoticeDraft,
  type NoticeRole,
  type NoticeState,
  type PlatformAdminContact,
  type PushStatus,
  type ReminderStatus,
  type StorageStatus,
  type UsagePeriod,
} from "@/lib/data/platform-admin/tools-logic"
import {
  mockAddAdmin,
  mockClubOverview,
  mockDismissNotice,
  mockListAdmins,
  mockListNotices,
  mockSendNotice,
  mockSetAdminActive,
  mockSystemStatus,
  mockUsage,
  mockVisibleNotices,
  mockWithdrawNotice,
} from "@/lib/data/platform-admin/tools-mock"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * The platform admin tools: club overview for support, platform admins, usage, notices to all
 * clubs and system status. Supabase mode calls the definer functions of
 * 20261017110000_platform_admin_tools.sql (each checks is_platform_admin() itself). Demo mode uses
 * tools-mock. Nothing here returns athlete health data, message text, notes or results.
 */

type Row = Record<string, unknown>

function isMockMode() {
  return getBackendMode() !== "supabase"
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function num(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {}
}

function list(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(object) : []
}

const NOT_DEPLOYED = "This is not switched on for this database yet. Apply the latest migration."

/** A database refusal in plain words. The functions raise their own sentences, so those are passed on. */
function rpcError<T>(error: { code?: string; message: string; details?: string; hint?: string; name?: string }): Result<T> {
  if (error.code === "PGRST202") return err("NOT_FOUND", NOT_DEPLOYED, error)
  if (error.code === "42501") return err("FORBIDDEN", "Only platform admins can do this.", error)
  if (error.code === "22023" || error.code === "23505" || error.code === "P0002") return err(error.code === "P0002" ? "NOT_FOUND" : "VALIDATION", error.message, error)
  return { ok: false, error: mapPostgrestError(error as Parameters<typeof mapPostgrestError>[0]) }
}

function client() {
  return getBrowserSupabaseClient()
}

const NO_CLIENT = "Supabase client is not configured."

// 1. Club overview -------------------------------------------------------------------------------

export type ClubOverview = {
  tenantId: string
  clubName: string
  requestId: string | null
  packageId: string | null
  lifecycleStatus: string | null
  billingStatus: string | null
  createdAt: string | null
  closure: { closedAt: string; deleteAfter: string } | null
  /** The owner first. Names and emails of club admins only. */
  admins: Array<{ name: string; email: string | null; isOwner: boolean; isActive: boolean }>
  usage: { teams: number; coaches: number; clubAdmins: number; athletes: number; athletesWithLogin: number; guardians: number; mediaItems: number; mediaBytes: number }
  teams: Array<{ name: string; eventGroup: string | null; archived: boolean; athletes: number; coaches: number; squads: number }>
  season: { name: string | null; startDate: string | null; endDate: string | null; status: string | null } | null
  /** The newest sign-in of anyone with that role. A date, never a person. */
  lastActive: Record<string, string | null>
  counts: { plans: number; plansPublished: number; sessionsLogged28d: number; testWeeks: number; messages: number; announcements: number; failedEmails28d: number }
  /** The kind of event, the role that did it and when. No names, no text. */
  activity: Array<{ action: string; actorRole: string | null; occurredAt: string }>
}

/** Opens a club's overview. Every call is written to the platform activity (who, which club, when). */
export async function getPlatformClubOverview(tenantId: string): Promise<Result<ClubOverview>> {
  if (isMockMode()) {
    const overview = mockClubOverview(tenantId)
    return overview ? ok(overview) : err("NOT_FOUND", "That club was not found.")
  }
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  const { data, error } = await supabase.rpc("get_platform_club_overview", { p_tenant_id: tenantId })
  if (error) return rpcError(error)
  const row = object(data)
  const usage = object(row.usage)
  const counts = object(row.counts)
  const closure = row.closure ? object(row.closure) : null
  const season = row.season ? object(row.season) : null
  return ok({
    tenantId: String(row.tenant_id ?? tenantId),
    clubName: text(row.club_name) ?? "Club",
    requestId: text(row.request_id),
    packageId: text(row.package),
    lifecycleStatus: text(row.lifecycle_status),
    billingStatus: text(row.billing_status),
    createdAt: text(row.created_at),
    closure: closure && text(closure.closed_at) && text(closure.delete_after) ? { closedAt: String(closure.closed_at), deleteAfter: String(closure.delete_after) } : null,
    admins: list(row.admins).map((admin) => ({ name: text(admin.name) ?? "Club admin", email: text(admin.email), isOwner: admin.is_owner === true, isActive: admin.is_active !== false })),
    usage: {
      teams: num(usage.teams),
      coaches: num(usage.coaches),
      clubAdmins: num(usage.club_admins),
      athletes: num(usage.athletes),
      athletesWithLogin: num(usage.athletes_with_login),
      guardians: num(usage.guardians),
      mediaItems: num(usage.media_items),
      mediaBytes: num(usage.media_bytes),
    },
    teams: list(row.teams).map((team) => ({
      name: text(team.name) ?? "Team",
      eventGroup: text(team.event_group),
      archived: team.archived === true,
      athletes: num(team.athletes),
      coaches: num(team.coaches),
      squads: num(team.squads),
    })),
    season: season ? { name: text(season.name), startDate: text(season.start_date), endDate: text(season.end_date), status: text(season.status) } : null,
    lastActive: Object.fromEntries(Object.entries(object(row.last_active)).map(([role, at]) => [role, text(at)])),
    counts: {
      plans: num(counts.plans),
      plansPublished: num(counts.plans_published),
      sessionsLogged28d: num(counts.sessions_logged_28d),
      testWeeks: num(counts.test_weeks),
      messages: num(counts.messages),
      announcements: num(counts.announcements),
      failedEmails28d: num(counts.failed_emails_28d),
    },
    activity: list(row.activity)
      .filter((item) => text(item.action) && text(item.occurred_at))
      .map((item) => ({ action: String(item.action), actorRole: text(item.actor_role), occurredAt: String(item.occurred_at) })),
  })
}

// 2. Platform admins -----------------------------------------------------------------------------

export async function listPlatformAdmins(): Promise<Result<PlatformAdminContact[]>> {
  if (isMockMode()) return ok(mockListAdmins())
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  const { data, error } = await supabase.rpc("list_platform_admins")
  if (error) return rpcError(error)
  return ok(
    list(data).map((row) => ({
      id: String(row.id),
      email: String(row.email ?? ""),
      displayName: text(row.display_name),
      isActive: row.is_active === true,
      isSelf: row.is_self === true,
      addedAt: String(row.added_at ?? ""),
      addedByEmail: text(row.added_by_email),
      deactivatedAt: text(row.deactivated_at),
      lastSignInAt: text(row.last_sign_in_at),
      hasAccount: row.has_account === true,
    })),
  )
}

/** Adds a platform admin by email. They get in by signing in with an account whose confirmed email matches. */
export async function addPlatformAdmin(email: string, displayName: string): Promise<Result<null>> {
  const clean = normalizeEmail(email)
  if (isMockMode()) {
    const problem = mockAddAdmin(clean, displayName.trim() || null)
    return problem ? err("VALIDATION", problem) : ok(null)
  }
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  const { error } = await supabase.rpc("add_platform_admin", { p_email: clean, p_display_name: displayName.trim() || null })
  if (error) return rpcError(error)
  return ok(null)
}

export async function setPlatformAdminActive(id: string, active: boolean): Promise<Result<null>> {
  if (isMockMode()) {
    const problem = mockSetAdminActive(id, active)
    return problem ? err("VALIDATION", problem) : ok(null)
  }
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  const { error } = await supabase.rpc("set_platform_admin_active", { p_contact_id: id, p_active: active })
  if (error) return rpcError(error)
  return ok(null)
}

// 3. Usage ---------------------------------------------------------------------------------------

export type PlatformUsage = {
  days: UsagePeriod
  from: string
  to: string
  clubs: ClubUsage[]
  /** Sessions logged per week across every club, the last 12 weeks, oldest first. */
  weeks: Array<{ weekStart: string; sessionsLogged: number }>
}

export async function getPlatformUsage(days: UsagePeriod): Promise<Result<PlatformUsage>> {
  if (!isUsagePeriod(days)) return err("VALIDATION", "Choose 7, 28 or 90 days.")
  if (isMockMode()) return ok(mockUsage(days))
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  const { data, error } = await supabase.rpc("get_platform_usage", { p_days: days })
  if (error) return rpcError(error)
  const row = object(data)
  return ok({
    days,
    from: String(row.from ?? ""),
    to: String(row.to ?? ""),
    clubs: list(row.clubs).map((club) => ({
      tenantId: String(club.tenant_id),
      clubName: text(club.club_name) ?? "Club",
      lifecycleStatus: text(club.lifecycle_status),
      isClosed: club.is_closed === true,
      ownerName: text(club.owner_name),
      ownerEmail: text(club.owner_email),
      activeClubAdmins: num(club.active_club_admins),
      activeCoaches: num(club.active_coaches),
      activeAthletes: num(club.active_athletes),
      activeGuardians: num(club.active_guardians),
      sessionsLogged: num(club.sessions_logged),
      plansPublished: num(club.plans_published),
      messagesSent: num(club.messages_sent),
      remindersSent: num(club.reminders_sent),
      pushesSent: num(club.pushes_sent),
      emailsSent: num(club.emails_sent),
      emailsFailed: num(club.emails_failed),
      newAthletes: num(club.new_athletes),
    })),
    weeks: list(row.weeks).map((week) => ({ weekStart: String(week.week_start ?? ""), sessionsLogged: num(week.sessions_logged) })),
  })
}

// 4. Notices -------------------------------------------------------------------------------------

export type PlatformNotice = {
  id: string
  title: string
  body: string
  linkUrl: string | null
  audience: NoticeAudience
  expiresAt: string | null
  emailClubAdmins: boolean
  /** People who got it in the app, and club admins it was emailed to. Counted when it was sent. */
  reachInApp: number
  reachEmail: number
  dismissedCount: number
  sentByEmail: string | null
  createdAt: string
  withdrawnAt: string | null
  state: NoticeState
}

/** What the banner shows a club member. */
export type VisibleNotice = { id: string; title: string; body: string; linkUrl: string | null; createdAt: string; expiresAt: string | null }

export async function listPlatformNotices(): Promise<Result<PlatformNotice[]>> {
  if (isMockMode()) return ok(mockListNotices())
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  const { data, error } = await supabase.rpc("list_platform_notices")
  if (error) return rpcError(error)
  return ok(
    list(data).map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
      linkUrl: text(row.link_url),
      audience: (text(row.audience) ?? "everyone") as NoticeAudience,
      expiresAt: text(row.expires_at),
      emailClubAdmins: row.email_club_admins === true,
      reachInApp: num(row.reach_in_app),
      reachEmail: num(row.reach_email),
      dismissedCount: num(row.dismissed_count),
      sentByEmail: text(row.sent_by_email),
      createdAt: String(row.created_at ?? ""),
      withdrawnAt: text(row.withdrawn_at),
      state: (text(row.state) ?? "live") as NoticeState,
    })),
  )
}

export async function sendPlatformNotice(draft: NoticeDraft): Promise<Result<{ id: string; reachInApp: number; reachEmail: number }>> {
  const errors = validateNoticeDraft(draft)
  const first = Object.values(errors)[0]
  if (first) return err("VALIDATION", first)
  const input = {
    title: draft.title.trim(),
    body: draft.body.trim(),
    link: draft.link.trim() || null,
    audience: draft.audience,
    expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
    emailClubAdmins: draft.emailClubAdmins,
  }
  if (isMockMode()) return ok(mockSendNotice(input))
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  const { data, error } = await supabase.rpc("send_platform_notice", {
    p_title: input.title,
    p_body: input.body,
    p_link_url: input.link,
    p_audience: input.audience,
    p_expires_at: input.expiresAt,
    p_email_club_admins: input.emailClubAdmins,
  })
  if (error) return rpcError(error)
  if (input.emailClubAdmins) kickNotificationEmails()
  const row = object(data)
  return ok({ id: String(row.id ?? ""), reachInApp: num(row.reach_in_app), reachEmail: num(row.reach_email) })
}

export async function withdrawPlatformNotice(id: string): Promise<Result<null>> {
  if (isMockMode()) return mockWithdrawNotice(id) ? ok(null) : err("CONFLICT", "This notice is already withdrawn.")
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  const { error } = await supabase.rpc("withdraw_platform_notice", { p_notice_id: id })
  if (error) return rpcError(error)
  return ok(null)
}

/**
 * The notices the signed-in club member should see as a banner now. Never fails loudly: a banner
 * that cannot load is simply not shown. `role` is only used in demo mode; the database decides
 * from the caller's own profile.
 */
export async function getMyPlatformNotices(role: NoticeRole | null): Promise<VisibleNotice[]> {
  if (role === "platform-admin") return []
  if (isMockMode()) return mockVisibleNotices(role)
  const supabase = client()
  if (!supabase) return []
  try {
    const { data, error } = await supabase.rpc("get_my_platform_notices")
    if (error) return []
    return list(data).map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
      linkUrl: text(row.link_url),
      createdAt: String(row.created_at ?? ""),
      expiresAt: text(row.expires_at),
    }))
  } catch {
    return []
  }
}

export async function dismissPlatformNotice(id: string, role: NoticeRole | null): Promise<void> {
  if (isMockMode()) {
    mockDismissNotice(id, role)
    return
  }
  const supabase = client()
  if (!supabase) return
  try {
    await supabase.rpc("dismiss_platform_notice", { p_notice_id: id })
  } catch {
    // It stays hidden for this visit and comes back on the next one.
  }
}

// 5. System status -------------------------------------------------------------------------------

export type PlatformSystemStatus = {
  checkedAt: string
  email: EmailStatus
  reminders: ReminderStatus
  push: PushStatus
  storage: StorageStatus
  /** pg_cron is installed, so jobs can run by themselves. */
  schedulerAvailable: boolean
  /** The newest applied migration, when the database keeps that list. */
  latestMigration: string | null
  pausedClubs: Array<{ tenantId: string; clubName: string }>
  closingClubs: Array<{ tenantId: string; clubName: string; closedAt: string; deleteAfter: string }>
}

export async function getPlatformSystemStatus(): Promise<Result<PlatformSystemStatus>> {
  if (isMockMode()) return ok(mockSystemStatus())
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  const { data, error } = await supabase.rpc("get_platform_system_status")
  if (error) return rpcError(error)
  const row = object(data)
  const email = object(row.email)
  const reminders = object(row.reminders)
  const push = object(row.push)
  const storage = object(row.storage)
  const clubs = object(row.clubs)
  return ok({
    checkedAt: text(row.checked_at) ?? new Date().toISOString(),
    email: {
      addressSet: email.address_set === true,
      canCallOut: email.can_call_out === true,
      scheduled: email.scheduled === true,
      lastRunAt: text(email.last_run_at),
      queued: num(email.queued),
      retrying: num(email.retrying),
      failed24h: num(email.failed_24h),
      sent24h: num(email.sent_24h),
      oldestQueuedAt: text(email.oldest_queued_at),
    },
    reminders: {
      scheduled: reminders.scheduled === true,
      schedule: text(reminders.schedule),
      lastRunAt: text(reminders.last_run_at),
      lastReminderAt: text(reminders.last_reminder_at),
      sent24h: num(reminders.sent_24h),
    },
    push: {
      configured: typeof push.configured === "boolean" ? push.configured : null,
      problem: text(push.problem),
      scheduled: push.scheduled === true,
      lastRunAt: text(push.last_run_at),
      devices: num(push.devices),
      queued: num(push.queued),
      failed24h: num(push.failed_24h),
      sent24h: num(push.sent_24h),
    },
    storage: { queued: num(storage.queued), failing: num(storage.failing), oldestQueuedAt: text(storage.oldest_queued_at), lastDoneAt: text(storage.last_done_at) },
    schedulerAvailable: row.scheduler_available === true,
    latestMigration: text(row.latest_migration),
    pausedClubs: list(clubs.paused).map((club) => ({ tenantId: String(club.tenant_id), clubName: text(club.club_name) ?? "Club" })),
    closingClubs: list(clubs.closing).map((club) => ({
      tenantId: String(club.tenant_id),
      clubName: text(club.club_name) ?? "Club",
      closedAt: String(club.closed_at ?? ""),
      deleteAfter: String(club.delete_after ?? ""),
    })),
  })
}
