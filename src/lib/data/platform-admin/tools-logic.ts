/**
 * Pure rules for the platform admin tools (club overview, platform admins, usage, notices, system
 * status). No imports, no browser: the screens, mock mode and the unit tests share these, and the
 * database functions in 20261017110000_platform_admin_tools.sql enforce the same rules.
 */

// Platform admins ----------------------------------------------------------------------------------

export type PlatformAdminContact = {
  id: string
  email: string
  displayName: string | null
  isActive: boolean
  /** The signed-in platform admin's own row. */
  isSelf: boolean
  addedAt: string
  addedByEmail: string | null
  deactivatedAt: string | null
  lastSignInAt: string | null
  /** An account with this email exists. False: access starts when one signs in. */
  hasAccount: boolean
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

/** Why this email cannot be added as a platform admin, or null when it can. */
export function addAdminProblem(email: string, admins: Array<Pick<PlatformAdminContact, "email">>, clubMemberEmails: string[] = []): string | null {
  const clean = normalizeEmail(email)
  if (!EMAIL_PATTERN.test(clean) || clean.length > 254) return "Enter a full email address."
  if (admins.some((admin) => normalizeEmail(admin.email) === clean)) return "That email is already a platform admin. Reactivate it in the list if it is switched off."
  if (clubMemberEmails.some((member) => normalizeEmail(member) === clean)) {
    return "That email belongs to a club member. A platform admin needs an email that is not used in any club."
  }
  return null
}

/** Why this platform admin cannot be switched off, or null when they can. */
export function deactivateAdminProblem(target: Pick<PlatformAdminContact, "id" | "isSelf" | "isActive">, admins: Array<Pick<PlatformAdminContact, "id" | "isActive">>): string | null {
  if (!target.isActive) return "This platform admin is already switched off."
  const othersActive = admins.filter((admin) => admin.isActive && admin.id !== target.id).length
  if (othersActive === 0) return "This is the last active platform admin. Add another one first."
  if (target.isSelf) return "You cannot switch off your own access. Ask another platform admin."
  return null
}

// Usage ------------------------------------------------------------------------------------------

export const USAGE_PERIODS = [7, 28, 90] as const
export type UsagePeriod = (typeof USAGE_PERIODS)[number]

export function isUsagePeriod(value: number): value is UsagePeriod {
  return (USAGE_PERIODS as readonly number[]).includes(value)
}

/** The first moment of a period that ends now. */
export function periodStart(days: UsagePeriod, now: Date = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

export type UsageCounts = {
  activeClubAdmins: number
  activeCoaches: number
  activeAthletes: number
  activeGuardians: number
  sessionsLogged: number
  plansPublished: number
  messagesSent: number
  remindersSent: number
  pushesSent: number
  emailsSent: number
  emailsFailed: number
  newAthletes: number
}

export type ClubUsage = UsageCounts & {
  tenantId: string
  clubName: string
  lifecycleStatus: string | null
  isClosed: boolean
  ownerName: string | null
  ownerEmail: string | null
}

export const USAGE_COUNT_KEYS: Array<keyof UsageCounts> = [
  "activeClubAdmins",
  "activeCoaches",
  "activeAthletes",
  "activeGuardians",
  "sessionsLogged",
  "plansPublished",
  "messagesSent",
  "remindersSent",
  "pushesSent",
  "emailsSent",
  "emailsFailed",
  "newAthletes",
]

export function emptyUsageCounts(): UsageCounts {
  return {
    activeClubAdmins: 0,
    activeCoaches: 0,
    activeAthletes: 0,
    activeGuardians: 0,
    sessionsLogged: 0,
    plansPublished: 0,
    messagesSent: 0,
    remindersSent: 0,
    pushesSent: 0,
    emailsSent: 0,
    emailsFailed: 0,
    newAthletes: 0,
  }
}

export function activeMembers(row: UsageCounts) {
  return row.activeClubAdmins + row.activeCoaches + row.activeAthletes + row.activeGuardians
}

/** Every count added up over the clubs given. */
export function usageTotals(rows: UsageCounts[]): UsageCounts {
  const total = emptyUsageCounts()
  for (const row of rows) {
    for (const key of USAGE_COUNT_KEYS) total[key] += Number.isFinite(row[key]) ? row[key] : 0
  }
  return total
}

/** A club that is meant to be in use: not paused, cancelled, closed or still waiting on billing. */
export function isLiveClub(row: Pick<ClubUsage, "lifecycleStatus" | "isClosed">) {
  if (row.isClosed) return false
  return row.lifecycleStatus === null || row.lifecycleStatus === "active" || row.lifecycleStatus === "active_onboarding"
}

/**
 * At risk: a live club where nobody signed in or did anything in the period. Emails, reminders and
 * pushes are sent by the system, so they do not count as the club being active.
 */
export function isAtRisk(row: ClubUsage) {
  if (!isLiveClub(row)) return false
  return activeMembers(row) === 0 && row.sessionsLogged === 0 && row.plansPublished === 0 && row.messagesSent === 0
}

export function atRiskClubs(rows: ClubUsage[]) {
  return rows.filter(isAtRisk)
}

/** "6 Oct" for the Monday a week starts on (a YYYY-MM-DD value, read as a calendar day). */
export function weekLabel(weekStart: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(weekStart)
  if (!match) return weekStart
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? ""}`.trim()
}

/** The Monday (UTC) of the week a moment falls in, as YYYY-MM-DD. */
export function weekStartOf(date: Date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const sinceMonday = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - sinceMonday)
  return day.toISOString().slice(0, 10)
}

/** The last `count` week starts, oldest first, ending with the week `now` is in. */
export function lastWeekStarts(count: number, now: Date = new Date()) {
  const current = new Date(`${weekStartOf(now)}T00:00:00Z`)
  const weeks: string[] = []
  for (let index = count - 1; index >= 0; index -= 1) {
    const week = new Date(current)
    week.setUTCDate(current.getUTCDate() - index * 7)
    weeks.push(week.toISOString().slice(0, 10))
  }
  return weeks
}

export function usageCsvRows(rows: ClubUsage[], days: UsagePeriod): Array<Array<string | number>> {
  const header = [
    "Club",
    "Status",
    "Owner",
    "Owner email",
    "Active club admins",
    "Active coaches",
    "Active athletes",
    "Active guardians",
    "Sessions logged",
    "Plans published",
    "Messages sent",
    "Reminders sent",
    "Pushes sent",
    "Emails sent",
    "Emails failed",
    "New athletes",
    `No activity in ${days} days`,
  ]
  const line = (name: string, status: string, owner: string, email: string, counts: UsageCounts, risk: string) => [
    name,
    status,
    owner,
    email,
    ...USAGE_COUNT_KEYS.map((key) => counts[key]),
    risk,
  ]
  return [
    header,
    ...rows.map((row) => line(row.clubName, row.isClosed ? "closing" : (row.lifecycleStatus ?? ""), row.ownerName ?? "", row.ownerEmail ?? "", row, isAtRisk(row) ? "yes" : "no")),
    line("All clubs", "", "", "", usageTotals(rows), String(atRiskClubs(rows).length)),
  ]
}

// Notices ----------------------------------------------------------------------------------------

export type NoticeAudience = "everyone" | "staff" | "club_admins"
export type NoticeRole = "athlete" | "coach" | "club-admin" | "guardian" | "platform-admin"

export const NOTICE_AUDIENCE_LABEL: Record<NoticeAudience, string> = {
  everyone: "Everyone",
  staff: "Staff only",
  club_admins: "Club admins only",
}

export const NOTICE_AUDIENCE_HINT: Record<NoticeAudience, string> = {
  everyone: "Club admins, coaches, athletes and guardians.",
  staff: "Club admins and coaches. Athletes and guardians do not see it.",
  club_admins: "Club admins only.",
}

export const NOTICE_TITLE_MAX = 120
export const NOTICE_BODY_MAX = 500
export const NOTICE_LINK_MAX = 300

/** Does a notice for this audience reach this role? Athletes and guardians only with "everyone". */
export function noticeReaches(audience: NoticeAudience, role: NoticeRole | null | undefined) {
  if (!role || role === "platform-admin") return false
  if (audience === "everyone") return true
  if (audience === "staff") return role === "coach" || role === "club-admin"
  return role === "club-admin"
}

/** A link is a secure web address or a page in the app. Nothing else (no http, no scripts). */
export function isAllowedNoticeLink(link: string) {
  if (link.length > NOTICE_LINK_MAX || /\s/.test(link)) return false
  return /^https:\/\/\S+$/.test(link) || /^\/[^/\s]\S*$/.test(link)
}

export type NoticeDraft = {
  title: string
  body: string
  link: string
  audience: NoticeAudience
  /** A local date and time from a datetime-local input, or empty for no end. */
  expiresAt: string
  emailClubAdmins: boolean
}

export type NoticeDraftErrors = Partial<Record<"title" | "body" | "link" | "expiresAt", string>>

export function validateNoticeDraft(draft: NoticeDraft, now: Date = new Date()): NoticeDraftErrors {
  const errors: NoticeDraftErrors = {}
  const title = draft.title.trim()
  const body = draft.body.trim()
  const link = draft.link.trim()
  if (title.length < 3) errors.title = "Give the notice a title of at least 3 characters."
  else if (title.length > NOTICE_TITLE_MAX) errors.title = `Keep the title to ${NOTICE_TITLE_MAX} characters.`
  if (body.length < 1) errors.body = "Write the notice."
  else if (body.length > NOTICE_BODY_MAX) errors.body = `Keep the notice to ${NOTICE_BODY_MAX} characters.`
  if (link && !isAllowedNoticeLink(link)) errors.link = "The link must start with https:// or be a page in the app that starts with /."
  if (draft.expiresAt) {
    const end = new Date(draft.expiresAt)
    if (Number.isNaN(end.getTime())) errors.expiresAt = "Choose a date and time."
    else if (end.getTime() <= now.getTime()) errors.expiresAt = "The end must be in the future."
  }
  return errors
}

export type NoticeState = "live" | "expired" | "withdrawn"

export function noticeState(notice: { withdrawnAt: string | null; expiresAt: string | null }, now: Date = new Date()): NoticeState {
  if (notice.withdrawnAt) return "withdrawn"
  if (notice.expiresAt && new Date(notice.expiresAt).getTime() <= now.getTime()) return "expired"
  return "live"
}

/** Should the banner show this notice to this person now? */
export function noticeVisibleTo(
  notice: { id: string; audience: NoticeAudience; withdrawnAt: string | null; expiresAt: string | null },
  role: NoticeRole | null | undefined,
  dismissedIds: Iterable<string>,
  now: Date = new Date(),
) {
  if (noticeState(notice, now) !== "live") return false
  if (!noticeReaches(notice.audience, role)) return false
  for (const id of dismissedIds) if (id === notice.id) return false
  return true
}

// System status ----------------------------------------------------------------------------------

export type HealthState = "working" | "attention" | "not_set_up"

export const HEALTH_LABEL: Record<HealthState, string> = {
  working: "Working",
  attention: "Needs attention",
  not_set_up: "Not set up",
}

export type Health = { state: HealthState; /** What is going on. */ summary: string; /** What to do, when something should be done. */ todo: string | null }

export type EmailStatus = {
  addressSet: boolean
  canCallOut: boolean
  scheduled: boolean
  lastRunAt: string | null
  queued: number
  retrying: number
  failed24h: number
  sent24h: number
  oldestQueuedAt: string | null
}

export type ReminderStatus = {
  scheduled: boolean
  schedule: string | null
  lastRunAt: string | null
  lastReminderAt: string | null
  sent24h: number
}

export type PushStatus = {
  /** Null: the sending function has not reported yet. */
  configured: boolean | null
  problem: string | null
  scheduled: boolean
  lastRunAt: string | null
  devices: number
  queued: number
  failed24h: number
  sent24h: number
}

export type StorageStatus = { queued: number; failing: number; oldestQueuedAt: string | null; lastDoneAt: string | null }

const MINUTE = 60 * 1000

function minutesSince(value: string | null, now: Date) {
  if (!value) return null
  const then = new Date(value).getTime()
  return Number.isNaN(then) ? null : (now.getTime() - then) / MINUTE
}

export function emailHealth(email: EmailStatus, now: Date = new Date()): Health {
  if (!email.addressSet) {
    return {
      state: "not_set_up",
      summary: "The database does not know where the sending function is yet.",
      todo: "Deploy the dispatch-notification-emails function and set its email keys. The address is saved the first time someone in a club triggers a notification.",
    }
  }
  const waiting = minutesSince(email.oldestQueuedAt, now)
  if (waiting !== null && waiting > 15) {
    return {
      state: "attention",
      summary: `${email.queued} queued, the oldest for ${Math.round(waiting)} minutes.`,
      todo: "Emails are not leaving. Check the email keys of the dispatch-notification-emails function, then press Send queued emails on the Requests screen.",
    }
  }
  if (email.failed24h > 0) {
    return {
      state: "attention",
      summary: `${email.failed24h} failed in the last 24 hours after five tries each.`,
      todo: "Open Failed emails under Activity to see why and send them again.",
    }
  }
  if (!email.scheduled && !email.canCallOut) {
    return {
      state: "attention",
      summary: "Emails only go out when someone in a club acts or you press Send queued emails.",
      todo: "Switch on pg_cron and pg_net for this database so emails leave by themselves.",
    }
  }
  return { state: "working", summary: email.scheduled ? "Sent every minute by the scheduled job." : "Sent as soon as they are queued.", todo: null }
}

export function reminderHealth(reminders: ReminderStatus, now: Date = new Date()): Health {
  if (!reminders.scheduled) {
    return {
      state: "not_set_up",
      summary: "The hourly reminder job is not scheduled.",
      todo: "Switch on pg_cron for this database and apply the reminders migration again. Until then no reminders are sent.",
    }
  }
  const sinceRun = minutesSince(reminders.lastRunAt, now)
  if (sinceRun !== null && sinceRun > 180) {
    return { state: "attention", summary: "The job is scheduled but has not finished a run in the last three hours.", todo: "Look at the pg_cron run history for sktr-run-reminders in the Supabase dashboard." }
  }
  return { state: "working", summary: "Scheduled every hour.", todo: null }
}

export function pushHealth(push: PushStatus): Health {
  if (push.configured === false) {
    return {
      state: "not_set_up",
      summary: push.problem === "missing" || !push.problem ? "The push keys are missing." : `The push keys were refused (${push.problem.replaceAll("_", " ")}).`,
      todo: "Set the VAPID keys on the dispatch-notification-emails function. Until then push is quietly off and people still get in-app and email updates.",
    }
  }
  if (push.configured === null) {
    return {
      state: "not_set_up",
      summary: "The sending function has not reported whether push is set up.",
      todo: "It reports the first time it runs. If this stays, deploy dispatch-notification-emails and set its VAPID keys.",
    }
  }
  if (push.failed24h > 0) {
    return { state: "attention", summary: `${push.failed24h} failed in the last 24 hours.`, todo: "A few failures are normal when a phone is offline. If the number keeps growing, check the VAPID keys." }
  }
  return { state: "working", summary: push.scheduled ? "Sent every minute by the scheduled job." : "Sent as soon as they are queued.", todo: null }
}

export function storageHealth(storage: StorageStatus): Health {
  if (storage.failing > 0) {
    return {
      state: "attention",
      summary: `${storage.failing} of ${storage.queued} files could not be removed after three tries.`,
      todo: "Check that the purge-deleted-storage function is deployed. It runs again with the daily clean-up.",
    }
  }
  if (storage.queued > 0) return { state: "working", summary: `${storage.queued} files waiting to be removed by the daily clean-up.`, todo: null }
  return { state: "working", summary: "Nothing waiting to be removed.", todo: null }
}

/** "1.4 GB", "320 MB", "12 KB". */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB"
  const units = ["bytes", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 100 || unit <= 1 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

/** Club activity safe to show the platform: never an event about messages or health. Same rule as the database. */
export function isSafeClubAction(action: string) {
  return action.trim() !== "" && !/(message|health|pain|wellness|readiness|injur|availability|note|medical)/i.test(action)
}
