import test from "node:test"
import assert from "node:assert/strict"
import {
  addAdminProblem,
  atRiskClubs,
  deactivateAdminProblem,
  emailHealth,
  emptyUsageCounts,
  formatBytes,
  isAllowedNoticeLink,
  isAtRisk,
  isSafeClubAction,
  isUsagePeriod,
  lastWeekStarts,
  noticeReaches,
  noticeState,
  noticeVisibleTo,
  periodStart,
  pushHealth,
  reminderHealth,
  storageHealth,
  usageCsvRows,
  usageTotals,
  validateNoticeDraft,
  weekLabel,
  weekStartOf,
  type ClubUsage,
  type NoticeDraft,
} from "../src/lib/data/platform-admin/tools-logic"
import { notificationTargetPath } from "../supabase/functions/_shared/notification-target"

const admins = [
  { id: "a", email: "owner@sktr.test", isActive: true, isSelf: true },
  { id: "b", email: "second@sktr.test", isActive: true, isSelf: false },
  { id: "c", email: "old@sktr.test", isActive: false, isSelf: false },
]

test("adding a platform admin: a full email, not already an admin, not a club member", () => {
  assert.equal(addAdminProblem("new@sktr.test", admins, ["coach@club.test"]), null)
  assert.match(addAdminProblem("nope", admins) ?? "", /full email/)
  assert.match(addAdminProblem(" Owner@SKTR.test ", admins) ?? "", /already a platform admin/)
  assert.match(addAdminProblem("old@sktr.test", admins) ?? "", /Reactivate/)
  assert.match(addAdminProblem("Coach@Club.test", admins, ["coach@club.test"]) ?? "", /belongs to a club member/)
})

test("deactivating: never yourself, never the last active one", () => {
  assert.equal(deactivateAdminProblem(admins[1], admins), null)
  assert.match(deactivateAdminProblem(admins[0], admins) ?? "", /your own access/)
  const alone = [admins[0], admins[2]]
  assert.match(deactivateAdminProblem(admins[0], alone) ?? "", /last active platform admin/)
  // The other admin being switched off already does not count as someone left.
  assert.match(deactivateAdminProblem(admins[1], [admins[1], admins[2]]) ?? "", /last active/)
  assert.match(deactivateAdminProblem(admins[2], admins) ?? "", /already switched off/)
})

test("usage periods are 7, 28 or 90 days and start that many days back", () => {
  assert.deepEqual([7, 28, 90, 30, 0].map(isUsagePeriod), [true, true, true, false, false])
  const now = new Date("2026-10-15T12:00:00Z")
  assert.equal(periodStart(7, now).toISOString(), "2026-10-08T12:00:00.000Z")
  assert.equal(periodStart(28, now).toISOString(), "2026-09-17T12:00:00.000Z")
  assert.equal(periodStart(90, now).toISOString(), "2026-07-17T12:00:00.000Z")
})

test("weeks start on Monday and the last 12 end with this week", () => {
  assert.equal(weekStartOf(new Date("2026-10-15T12:00:00Z")), "2026-10-12") // a Thursday
  assert.equal(weekStartOf(new Date("2026-10-12T00:00:00Z")), "2026-10-12") // the Monday itself
  assert.equal(weekStartOf(new Date("2026-10-18T23:59:00Z")), "2026-10-12") // the Sunday
  const weeks = lastWeekStarts(12, new Date("2026-10-15T12:00:00Z"))
  assert.equal(weeks.length, 12)
  assert.equal(weeks[11], "2026-10-12")
  assert.equal(weeks[0], "2026-07-27")
  assert.equal(weekLabel("2026-10-05"), "5 Oct")
  assert.equal(weekLabel("not a date"), "not a date")
})

function club(patch: Partial<ClubUsage>): ClubUsage {
  return { tenantId: "t", clubName: "Club", lifecycleStatus: "active", isClosed: false, ownerName: "Owner", ownerEmail: "owner@club.test", ...emptyUsageCounts(), ...patch }
}

test("totals add every count over the clubs", () => {
  const totals = usageTotals([club({ sessionsLogged: 4, activeCoaches: 2, emailsFailed: 1 }), club({ sessionsLogged: 6, activeAthletes: 9 })])
  assert.equal(totals.sessionsLogged, 10)
  assert.equal(totals.activeCoaches, 2)
  assert.equal(totals.activeAthletes, 9)
  assert.equal(totals.emailsFailed, 1)
  assert.equal(totals.messagesSent, 0)
})

test("at risk is a live club where nobody did anything; system sends do not count as activity", () => {
  assert.equal(isAtRisk(club({})), true)
  assert.equal(isAtRisk(club({ remindersSent: 12, emailsSent: 3, pushesSent: 4 })), true)
  assert.equal(isAtRisk(club({ activeGuardians: 1 })), false)
  assert.equal(isAtRisk(club({ sessionsLogged: 1 })), false)
  assert.equal(isAtRisk(club({ messagesSent: 1 })), false)
  assert.equal(isAtRisk(club({ lifecycleStatus: "suspended" })), false)
  assert.equal(isAtRisk(club({ lifecycleStatus: "cancelled" })), false)
  assert.equal(isAtRisk(club({ isClosed: true })), false)
  assert.equal(isAtRisk(club({ lifecycleStatus: "active_onboarding" })), true)
  assert.equal(atRiskClubs([club({}), club({ sessionsLogged: 2 })]).length, 1)
})

test("the CSV has one row per club, a totals row, and only the owner as a person", () => {
  const rows = usageCsvRows([club({ clubName: "A", sessionsLogged: 3 }), club({ clubName: "B", activeCoaches: 1, sessionsLogged: 2 })], 28)
  assert.equal(rows.length, 4)
  assert.equal(rows[0].length, rows[1].length)
  assert.equal(rows[0][rows[0].length - 1], "No activity in 28 days")
  assert.deepEqual(rows[1].slice(0, 4), ["A", "active", "Owner", "owner@club.test"])
  assert.equal(rows[3][0], "All clubs")
  assert.equal(rows[3][rows[0].indexOf("Sessions logged")], 5)
  assert.equal(rows[1][rows[1].length - 1], "no")
})

test("who a notice reaches: athletes and guardians only when it is for everyone", () => {
  const roles = ["athlete", "guardian", "coach", "club-admin", "platform-admin"] as const
  assert.deepEqual(roles.map((role) => noticeReaches("everyone", role)), [true, true, true, true, false])
  assert.deepEqual(roles.map((role) => noticeReaches("staff", role)), [false, false, true, true, false])
  assert.deepEqual(roles.map((role) => noticeReaches("club_admins", role)), [false, false, false, true, false])
  assert.equal(noticeReaches("everyone", null), false)
})

test("a notice link is https or a page in the app, nothing else", () => {
  assert.equal(isAllowedNoticeLink("https://status.sktr.test/x"), true)
  assert.equal(isAllowedNoticeLink("/settings/notifications"), true)
  for (const bad of ["http://x.test", "javascript:alert(1)", "//evil.test", "/", "ftp://x", "https://a b", `https://x.test/${"a".repeat(300)}`]) {
    assert.equal(isAllowedNoticeLink(bad), false, bad)
  }
})

test("a notice needs a title, a body of at most 500 characters and an end in the future", () => {
  const now = new Date("2026-10-15T12:00:00Z")
  const draft: NoticeDraft = { title: "Maintenance", body: "Sunday 6 to 7 am.", link: "", audience: "everyone", expiresAt: "", emailClubAdmins: false }
  assert.deepEqual(validateNoticeDraft(draft, now), {})
  assert.ok(validateNoticeDraft({ ...draft, title: "a" }, now).title)
  assert.ok(validateNoticeDraft({ ...draft, body: "  " }, now).body)
  assert.ok(validateNoticeDraft({ ...draft, body: "x".repeat(501) }, now).body)
  assert.equal(validateNoticeDraft({ ...draft, body: "x".repeat(500) }, now).body, undefined)
  assert.ok(validateNoticeDraft({ ...draft, link: "http://x.test" }, now).link)
  assert.ok(validateNoticeDraft({ ...draft, expiresAt: "2026-10-15T11:00:00Z" }, now).expiresAt)
  assert.equal(validateNoticeDraft({ ...draft, expiresAt: "2026-10-16T11:00:00Z" }, now).expiresAt, undefined)
})

test("the banner shows a notice only while it is live, for the right role, and not once dismissed", () => {
  const now = new Date("2026-10-15T12:00:00Z")
  const notice = { id: "n1", audience: "staff" as const, withdrawnAt: null, expiresAt: "2026-10-16T00:00:00Z" }
  assert.equal(noticeState(notice, now), "live")
  assert.equal(noticeVisibleTo(notice, "coach", [], now), true)
  assert.equal(noticeVisibleTo(notice, "athlete", [], now), false)
  assert.equal(noticeVisibleTo(notice, "guardian", [], now), false)
  assert.equal(noticeVisibleTo(notice, "coach", ["n1"], now), false)
  assert.equal(noticeVisibleTo(notice, "coach", [], new Date("2026-10-16T00:00:00Z")), false)
  assert.equal(noticeState({ ...notice, withdrawnAt: "2026-10-15T10:00:00Z" }, now), "withdrawn")
  assert.equal(noticeVisibleTo({ ...notice, withdrawnAt: "2026-10-15T10:00:00Z" }, "club-admin", [], now), false)
  assert.equal(noticeState({ ...notice, expiresAt: null }, new Date("2030-01-01T00:00:00Z")), "live")
})

test("a notice notification opens its in-app link, and never an outside address", () => {
  assert.equal(notificationTargetPath("platform_notice", { link: "/club-admin/billing" }, "club-admin"), "/club-admin/billing")
  assert.equal(notificationTargetPath("platform_notice", { link: "https://evil.test" }, "coach"), "/notifications")
  assert.equal(notificationTargetPath("platform_notice", { link: "//evil.test" }, "coach"), "/notifications")
  assert.equal(notificationTargetPath("platform_notice", { link: "/\\evil.test" }, "coach"), "/notifications")
  assert.equal(notificationTargetPath("platform_notice", {}, "athlete"), "/notifications")
})

test("system status: working, needs attention or not set up, with what to do", () => {
  const now = new Date("2026-10-15T12:00:00Z")
  const email = { addressSet: true, canCallOut: true, scheduled: true, lastRunAt: "2026-10-15T11:59:00Z", queued: 0, retrying: 0, failed24h: 0, sent24h: 5, oldestQueuedAt: null }
  assert.equal(emailHealth(email, now).state, "working")
  assert.equal(emailHealth(email, now).todo, null)
  assert.equal(emailHealth({ ...email, addressSet: false }, now).state, "not_set_up")
  assert.ok(emailHealth({ ...email, addressSet: false }, now).todo)
  assert.equal(emailHealth({ ...email, queued: 3, oldestQueuedAt: "2026-10-15T11:30:00Z" }, now).state, "attention")
  assert.equal(emailHealth({ ...email, queued: 3, oldestQueuedAt: "2026-10-15T11:55:00Z" }, now).state, "working")
  assert.equal(emailHealth({ ...email, failed24h: 2 }, now).state, "attention")

  const reminders = { scheduled: true, schedule: "0 * * * *", lastRunAt: "2026-10-15T11:00:00Z", lastReminderAt: null, sent24h: 0 }
  assert.equal(reminderHealth(reminders, now).state, "working")
  assert.equal(reminderHealth({ ...reminders, lastRunAt: null }, now).state, "working")
  assert.equal(reminderHealth({ ...reminders, lastRunAt: "2026-10-15T06:00:00Z" }, now).state, "attention")
  assert.equal(reminderHealth({ ...reminders, scheduled: false }, now).state, "not_set_up")

  const push = { configured: true as boolean | null, problem: null, scheduled: true, lastRunAt: null, devices: 4, queued: 0, failed24h: 0, sent24h: 9 }
  assert.equal(pushHealth(push).state, "working")
  assert.equal(pushHealth({ ...push, configured: false, problem: "missing" }).state, "not_set_up")
  assert.match(pushHealth({ ...push, configured: false, problem: "missing" }).todo ?? "", /VAPID/)
  assert.equal(pushHealth({ ...push, configured: null }).state, "not_set_up")
  assert.equal(pushHealth({ ...push, failed24h: 3 }).state, "attention")

  assert.equal(storageHealth({ queued: 0, failing: 0, oldestQueuedAt: null, lastDoneAt: null }).state, "working")
  assert.equal(storageHealth({ queued: 4, failing: 0, oldestQueuedAt: null, lastDoneAt: null }).state, "working")
  assert.equal(storageHealth({ queued: 4, failing: 2, oldestQueuedAt: null, lastDoneAt: null }).state, "attention")
})

test("bytes in words, and club activity about messages or health is never shown", () => {
  assert.equal(formatBytes(0), "0 MB")
  assert.equal(formatBytes(320 * 1024 * 1024), "320 MB")
  assert.equal(formatBytes(1.5 * 1024 * 1024 * 1024), "1.5 GB")
  assert.equal(formatBytes(12 * 1024), "12 KB")
  assert.deepEqual(
    ["season_started", "message_hidden", "message_reported", "athlete_pain_note", "wellness_reset", "availability_set", "coach_handover", ""].map(isSafeClubAction),
    [true, false, false, false, false, false, true, false],
  )
})
