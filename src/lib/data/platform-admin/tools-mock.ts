import { getMockActorEmail, loadMockFailedNotificationEmails, loadMockPlatformAdminRequests, recordMockPlatformAudit, type MockPlatformAdminRequest } from "@/lib/mock-platform-admin"
import { loadMockClubClosures } from "@/lib/mock-data-rights"
import type { NotificationItem } from "@/lib/data/notifications-data"
import {
  addAdminProblem,
  deactivateAdminProblem,
  isSafeClubAction,
  lastWeekStarts,
  normalizeEmail,
  noticeReaches,
  noticeState,
  noticeVisibleTo,
  type ClubUsage,
  type NoticeAudience,
  type NoticeRole,
  type PlatformAdminContact,
  type UsagePeriod,
} from "@/lib/data/platform-admin/tools-logic"
import type { ClubOverview, PlatformNotice, PlatformSystemStatus, PlatformUsage, VisibleNotice } from "@/lib/data/platform-admin/tools-data"

/**
 * Demo mode for the platform admin tools. There is no backend, so admins, notices and dismissals
 * live in this browser's storage and the numbers are made up from the club's id (the same club
 * always shows the same numbers). The rules are the shared ones in tools-logic.
 */

const ADMINS_KEY = "pacelab:platform-admin:admins"
const NOTICES_KEY = "pacelab:platform-admin:notices"
const DISMISSED_KEY = "pacelab:platform-notices:dismissed"
const DEMO_ADMIN_EMAIL = "platformadmin@pacelab.local"
/** The demo logins of the club roles. None of them can be a platform admin. */
const DEMO_CLUB_MEMBER_EMAILS = ["athlete@pacelab.local", "coach@pacelab.local", "clubadmin@pacelab.local", "guardian@pacelab.local"]

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save<T>(key: string, value: T) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be blocked. The change then lasts for this visit only.
  }
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

/** A steady number from a string, so demo numbers do not change between visits. */
function seeded(key: string, max: number) {
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % (max + 1)
}

function daysAgo(days: number, hours = 0) {
  return new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString()
}

// Clubs --------------------------------------------------------------------------------------------

type DemoClub = { tenantId: string; requestId: string | null; name: string; ownerName: string; ownerEmail: string; packageId: string; lifecycleStatus: string; billingStatus: string | null; createdAt: string; quiet: boolean }

const DEMO_CLUBS: DemoClub[] = [
  { tenantId: "elite-track-club", requestId: null, name: "Elite Track Club", ownerName: "Dana Whitfield", ownerEmail: "clubadmin@pacelab.local", packageId: "pro", lifecycleStatus: "active", billingStatus: "active", createdAt: daysAgo(210), quiet: false },
  { tenantId: "blue-mountain-athletics", requestId: null, name: "Blue Mountain Athletics", ownerName: "Marcus Reid", ownerEmail: "marcus@bluemountain.example", packageId: "starter", lifecycleStatus: "active", billingStatus: "active", createdAt: daysAgo(96), quiet: false },
  { tenantId: "harbour-view-track", requestId: null, name: "Harbour View Track", ownerName: "Simone Clarke", ownerEmail: "simone@harbourview.example", packageId: "starter", lifecycleStatus: "active", billingStatus: "active", createdAt: daysAgo(61), quiet: true },
]

function fromRequest(request: MockPlatformAdminRequest): DemoClub {
  return {
    tenantId: request.provisionedTenantId as string,
    requestId: request.id,
    name: request.organizationName,
    ownerName: request.requestorName,
    ownerEmail: request.requestorEmail,
    packageId: request.requestedPlan,
    lifecycleStatus: request.lifecycleStatus,
    billingStatus: request.billingStatus,
    createdAt: request.createdAt,
    // A club whose name says so has no activity, so the "at risk" list can be shown and tested.
    quiet: /quiet|dormant/i.test(request.organizationName),
  }
}

/** Clubs with a workspace in the demo request list. With none, three demo clubs so the screens are not empty. */
export function mockClubs(): DemoClub[] {
  const provisioned = loadMockPlatformAdminRequests().filter((request) => request.provisionedTenantId)
  const seen = new Set<string>()
  const clubs = provisioned.map(fromRequest).filter((club) => (seen.has(club.tenantId) ? false : (seen.add(club.tenantId), true)))
  return clubs.length > 0 ? clubs : DEMO_CLUBS
}

function closureOf(tenantId: string) {
  return loadMockClubClosures().find((closure) => closure.tenantId === tenantId && !closure.reopenedAt && !closure.deletedAt) ?? null
}

const DEMO_ACTIVITY = ["season_started", "team_join_code_created", "athlete_invites_bulk_created", "coach_invite_accept", "message_hidden", "athlete_moved_team", "package_upgrade_requested", "club_data_exported"]

export function mockClubOverview(tenantId: string): ClubOverview | null {
  const club = mockClubs().find((item) => item.tenantId === tenantId)
  if (!club) return null
  const scale = club.quiet ? 0 : 1
  const athletesSprint = 8 + seeded(`${tenantId}:a1`, 14)
  const athletesJumps = 4 + seeded(`${tenantId}:a2`, 9)
  const closure = closureOf(tenantId)

  recordMockPlatformAudit({
    action: "platform_club_overview_opened",
    target: club.name,
    detail: "Opened the club overview for support",
    metadata: { tenantId, requestId: club.requestId },
  })

  return {
    tenantId,
    clubName: club.name,
    requestId: club.requestId,
    packageId: club.packageId,
    lifecycleStatus: club.lifecycleStatus,
    billingStatus: club.billingStatus,
    createdAt: club.createdAt,
    closure: closure ? { closedAt: closure.closedAt, deleteAfter: closure.deleteAfter } : null,
    admins: [
      { name: club.ownerName, email: club.ownerEmail, isOwner: true, isActive: true },
      { name: "Jordan Ellis", email: `jordan@${tenantId}.example`, isOwner: false, isActive: true },
    ],
    usage: {
      teams: 2,
      coaches: 2 + seeded(`${tenantId}:c`, 2),
      clubAdmins: 2,
      athletes: athletesSprint + athletesJumps,
      athletesWithLogin: athletesSprint + athletesJumps - seeded(`${tenantId}:nl`, 4),
      guardians: seeded(`${tenantId}:g`, 6),
      mediaItems: scale * (12 + seeded(`${tenantId}:mi`, 60)),
      mediaBytes: scale * (180 + seeded(`${tenantId}:mb`, 900)) * 1024 * 1024,
    },
    teams: [
      { name: "Sprint Group", eventGroup: "Sprint", archived: false, athletes: athletesSprint, coaches: 2, squads: 2 },
      { name: "Jumps", eventGroup: "Jumps", archived: false, athletes: athletesJumps, coaches: 1, squads: 0 },
      { name: "Juniors 2025", eventGroup: "Sprint", archived: true, athletes: 0, coaches: 0, squads: 0 },
    ],
    season: { name: "2026", startDate: "2026-01-10", endDate: "2026-10-30", status: "current" },
    lastActive: club.quiet
      ? { "club-admin": daysAgo(47), coach: daysAgo(52), athlete: daysAgo(58), guardian: null }
      : { "club-admin": daysAgo(0, 3), coach: daysAgo(0, 1), athlete: daysAgo(0, 2), guardian: daysAgo(4) },
    counts: {
      plans: 3 + seeded(`${tenantId}:p`, 6),
      plansPublished: 2 + seeded(`${tenantId}:pp`, 3),
      sessionsLogged28d: scale * (40 + seeded(`${tenantId}:s`, 160)),
      testWeeks: 1 + seeded(`${tenantId}:tw`, 3),
      messages: scale * (25 + seeded(`${tenantId}:m`, 200)),
      announcements: 2 + seeded(`${tenantId}:an`, 8),
      failedEmails28d: loadMockFailedNotificationEmails().filter((email) => email.tenantId === tenantId).length,
    },
    // The same filter as the database: nothing about messages or health reaches this screen.
    activity: DEMO_ACTIVITY.filter(isSafeClubAction).map((action, index) => ({
      action,
      actorRole: index % 3 === 0 ? "club-admin" : "coach",
      occurredAt: daysAgo((club.quiet ? 45 : 0) + index * 2, index),
    })),
  }
}

// Usage --------------------------------------------------------------------------------------------

export function mockUsage(days: UsagePeriod): PlatformUsage {
  const factor = days / 28
  const clubs: ClubUsage[] = mockClubs().map((club) => {
    const key = club.tenantId
    const blocked = club.lifecycleStatus === "suspended" || club.lifecycleStatus === "cancelled"
    const on = club.quiet || blocked ? 0 : 1
    const count = (name: string, base: number, spread: number) => on * Math.round((base + seeded(`${key}:${name}`, spread)) * factor)
    return {
      tenantId: club.tenantId,
      clubName: club.name,
      lifecycleStatus: club.lifecycleStatus,
      isClosed: Boolean(closureOf(club.tenantId)),
      ownerName: club.ownerName,
      ownerEmail: club.ownerEmail,
      activeClubAdmins: on * (1 + seeded(`${key}:uca`, 1)),
      activeCoaches: on * (2 + seeded(`${key}:uc`, 2)),
      activeAthletes: on * Math.min(12 + seeded(`${key}:ua`, 20), Math.round((10 + seeded(`${key}:ua`, 20)) * Math.min(1, 0.6 + factor / 4))),
      activeGuardians: on * seeded(`${key}:ug`, 4),
      sessionsLogged: count("us", 60, 140),
      plansPublished: count("up", 1, 3),
      messagesSent: count("um", 30, 90),
      remindersSent: count("ur", 80, 120),
      pushesSent: count("upu", 40, 100),
      emailsSent: count("ue", 50, 80),
      emailsFailed: on * seeded(`${key}:uf`, 2),
      newAthletes: count("un", 1, 5),
    }
  })

  const live = clubs.filter((club) => club.sessionsLogged > 0).length
  const weeks = lastWeekStarts(12).map((weekStart, index) => ({
    weekStart,
    sessionsLogged: live === 0 ? 0 : Math.round(live * (22 + index * 2 + seeded(`week:${weekStart}`, 18))),
  }))
  return { days, from: new Date(Date.now() - days * 86_400_000).toISOString(), to: new Date().toISOString(), clubs, weeks }
}

// Platform admins ----------------------------------------------------------------------------------

type StoredAdmin = Omit<PlatformAdminContact, "isSelf">

function selfEmail() {
  return normalizeEmail(getMockActorEmail() ?? DEMO_ADMIN_EMAIL)
}

function loadAdmins(): StoredAdmin[] {
  const stored = load<StoredAdmin[] | null>(ADMINS_KEY, null)
  if (Array.isArray(stored) && stored.length > 0) return stored
  return [
    { id: "mock-admin-1", email: selfEmail(), displayName: "Platform Admin", isActive: true, addedAt: daysAgo(400), addedByEmail: null, deactivatedAt: null, lastSignInAt: daysAgo(0, 1), hasAccount: true },
    { id: "mock-admin-2", email: "support@sktr.example", displayName: "Support desk", isActive: true, addedAt: daysAgo(120), addedByEmail: selfEmail(), deactivatedAt: null, lastSignInAt: daysAgo(6), hasAccount: true },
  ]
}

export function mockListAdmins(): PlatformAdminContact[] {
  const me = selfEmail()
  return loadAdmins()
    .map((admin) => ({ ...admin, isSelf: normalizeEmail(admin.email) === me }))
    .sort((left, right) => Number(right.isActive) - Number(left.isActive) || left.addedAt.localeCompare(right.addedAt))
}

function clubMemberEmails() {
  return [...DEMO_CLUB_MEMBER_EMAILS, ...loadMockPlatformAdminRequests().filter((request) => request.status === "approved").map((request) => request.requestorEmail)]
}

/** Returns the problem in words, or null when the admin was added. */
export function mockAddAdmin(email: string, displayName: string | null): string | null {
  const admins = loadAdmins()
  const problem = addAdminProblem(email, admins, clubMemberEmails())
  if (problem) return problem
  const clean = normalizeEmail(email)
  const id = newId("mock-admin")
  save(ADMINS_KEY, [...admins, { id, email: clean, displayName: displayName?.trim() || null, isActive: true, addedAt: new Date().toISOString(), addedByEmail: selfEmail(), deactivatedAt: null, lastSignInAt: null, hasAccount: false }])
  recordMockPlatformAudit({ action: "platform_admin_added", target: clean, detail: "Added as a platform admin", metadata: { contactId: id, email: clean } })
  return null
}

export function mockSetAdminActive(id: string, active: boolean): string | null {
  const admins = mockListAdmins()
  const target = admins.find((admin) => admin.id === id)
  if (!target) return "That platform admin was not found."
  if (target.isActive === active) return null
  if (!active) {
    const problem = deactivateAdminProblem(target, admins)
    if (problem) return problem
  } else if (clubMemberEmails().some((member) => normalizeEmail(member) === normalizeEmail(target.email))) {
    return "That email now belongs to a club member, so it cannot be a platform admin."
  }
  save(
    ADMINS_KEY,
    loadAdmins().map((admin) => (admin.id === id ? { ...admin, isActive: active, deactivatedAt: active ? null : new Date().toISOString() } : admin)),
  )
  recordMockPlatformAudit({
    action: active ? "platform_admin_reactivated" : "platform_admin_deactivated",
    target: target.email,
    detail: active ? "Platform admin access switched back on" : "Platform admin access switched off",
    metadata: { contactId: id, email: target.email },
  })
  return null
}

// Notices ------------------------------------------------------------------------------------------

type StoredNotice = Omit<PlatformNotice, "state" | "dismissedCount">

function loadNotices(): StoredNotice[] {
  const stored = load<StoredNotice[]>(NOTICES_KEY, [])
  return Array.isArray(stored) ? stored : []
}

/** Dismissals are kept per demo login, as they are per login in the database. */
function loadDismissed(): Record<string, string[]> {
  const stored = load<Record<string, string[]>>(DISMISSED_KEY, {})
  return stored && typeof stored === "object" ? stored : {}
}

function dismissedBy(role: NoticeRole) {
  return loadDismissed()[role] ?? []
}

/** How many demo people a notice reaches: the demo has one login per role in each club. */
function demoReach(audience: NoticeAudience) {
  const clubs = mockClubs().filter((club) => club.lifecycleStatus !== "suspended" && club.lifecycleStatus !== "cancelled" && !closureOf(club.tenantId))
  const perClub = { admins: 2, coaches: 3, athletes: 18, guardians: 4 }
  const each = audience === "everyone" ? perClub.admins + perClub.coaches + perClub.athletes + perClub.guardians : audience === "staff" ? perClub.admins + perClub.coaches : perClub.admins
  return { inApp: clubs.length * each, admins: clubs.length * perClub.admins }
}

export function mockListNotices(): PlatformNotice[] {
  const dismissed = loadDismissed()
  return loadNotices()
    .map((notice) => ({
      ...notice,
      state: noticeState(notice),
      dismissedCount: Object.values(dismissed).filter((ids) => ids.includes(notice.id)).length,
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function mockSendNotice(input: { title: string; body: string; link: string | null; audience: NoticeAudience; expiresAt: string | null; emailClubAdmins: boolean }) {
  const reach = demoReach(input.audience)
  const notice: StoredNotice = {
    id: newId("mock-notice"),
    title: input.title,
    body: input.body,
    linkUrl: input.link,
    audience: input.audience,
    expiresAt: input.expiresAt,
    emailClubAdmins: input.emailClubAdmins,
    reachInApp: reach.inApp,
    reachEmail: input.emailClubAdmins ? reach.admins : 0,
    sentByEmail: selfEmail(),
    createdAt: new Date().toISOString(),
    withdrawnAt: null,
  }
  save(NOTICES_KEY, [notice, ...loadNotices()])
  recordMockPlatformAudit({
    action: "platform_notice_sent",
    target: notice.title,
    detail: `Notice sent to ${input.audience} (${notice.reachInApp} in the app, ${notice.reachEmail} by email)`,
    metadata: { noticeId: notice.id, audience: input.audience, reachInApp: notice.reachInApp, reachEmail: notice.reachEmail },
  })
  return { id: notice.id, reachInApp: notice.reachInApp, reachEmail: notice.reachEmail }
}

export function mockWithdrawNotice(id: string) {
  const notices = loadNotices()
  const target = notices.find((notice) => notice.id === id)
  if (!target || target.withdrawnAt) return false
  save(NOTICES_KEY, notices.map((notice) => (notice.id === id ? { ...notice, withdrawnAt: new Date().toISOString() } : notice)))
  recordMockPlatformAudit({ action: "platform_notice_withdrawn", target: target.title, detail: "Notice withdrawn", metadata: { noticeId: id } })
  return true
}

/** The banner in demo mode: live notices for this role that this demo login has not dismissed. */
export function mockVisibleNotices(role: NoticeRole | null): VisibleNotice[] {
  if (!role) return []
  const dismissed = dismissedBy(role)
  return loadNotices()
    .filter((notice) => noticeVisibleTo(notice, role, dismissed))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 3)
    .map((notice) => ({ id: notice.id, title: notice.title, body: notice.body, linkUrl: notice.linkUrl, createdAt: notice.createdAt, expiresAt: notice.expiresAt }))
}

export function mockDismissNotice(id: string, role: NoticeRole | null) {
  if (!role) return
  const all = loadDismissed()
  const mine = new Set(all[role] ?? [])
  mine.add(id)
  save(DISMISSED_KEY, { ...all, [role]: [...mine] })
}

/** Notices as notification rows for the demo bell and notification list. A withdrawn notice leaves the list. */
export function mockNoticeFeedItems(role: NoticeRole): Array<Omit<NotificationItem, "state" | "readAt">> {
  return loadNotices()
    .filter((notice) => !notice.withdrawnAt && noticeReaches(notice.audience, role))
    .map((notice) => ({
      id: `platform-notice-${notice.id}`,
      eventType: "platform_notice",
      subject: notice.title,
      body: notice.body,
      createdAt: notice.createdAt,
      href: notice.linkUrl && notice.linkUrl.startsWith("/") ? notice.linkUrl : "/notifications",
    }))
}

// System status ------------------------------------------------------------------------------------

export function mockSystemStatus(): PlatformSystemStatus {
  const clubs = mockClubs()
  const failed = loadMockFailedNotificationEmails().length
  return {
    checkedAt: new Date().toISOString(),
    email: { addressSet: true, canCallOut: true, scheduled: true, lastRunAt: daysAgo(0, 0.02), queued: 0, retrying: 0, failed24h: failed, sent24h: 46, oldestQueuedAt: null },
    reminders: { scheduled: true, schedule: "0 * * * *", lastRunAt: daysAgo(0, 0.6), lastReminderAt: daysAgo(0, 0.6), sent24h: 31 },
    // The demo has no push keys, which is also how a new installation starts.
    push: { configured: false, problem: "missing", scheduled: true, lastRunAt: daysAgo(0, 0.02), devices: 0, queued: 0, failed24h: 0, sent24h: 0 },
    storage: { queued: 3, failing: 0, oldestQueuedAt: daysAgo(0, 7), lastDoneAt: daysAgo(1) },
    schedulerAvailable: true,
    latestMigration: "20261017110000_platform_admin_tools",
    pausedClubs: clubs.filter((club) => club.lifecycleStatus === "suspended" && !closureOf(club.tenantId)).map((club) => ({ tenantId: club.tenantId, clubName: club.name })),
    closingClubs: loadMockClubClosures()
      .filter((closure) => !closure.reopenedAt && !closure.deletedAt)
      .map((closure) => ({ tenantId: closure.tenantId, clubName: closure.clubName, closedAt: closure.closedAt, deleteAfter: closure.deleteAfter })),
  }
}
