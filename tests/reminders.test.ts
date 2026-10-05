import test from "node:test"
import assert from "node:assert/strict"
import {
  cleanClubTimezone,
  DEFAULT_CLUB_TIMEZONE,
  isKnownTimezone,
  localClockIn,
  localDayIn,
  timezoneLabel,
  timezoneOffsetLabel,
  timezoneOffsetMinutes,
  timezoneOptions,
} from "../src/lib/club-timezone"
import { NOTIFICATION_PREFERENCE_CATEGORIES, notificationCategoriesForRole } from "../src/lib/notification-categories"
import { notificationActionLabel, notificationTargetPath, NOTIFICATIONS_PATH } from "../supabase/functions/_shared/notification-target"

const TEAM = "0f8fad5b-d9cb-469f-a165-70867728950e"

test("a reminder opens the screen it is about", () => {
  assert.equal(notificationTargetPath("reminder_session_today", { session_date: "2026-10-13" }, "athlete"), "/athlete/log?date=2026-10-13")
  assert.equal(notificationTargetPath("reminder_session_today", {}, "athlete"), "/athlete/log")
  assert.equal(notificationTargetPath("reminder_checkin", { entry_date: "2026-10-13" }, "athlete"), "/athlete/wellness")
  assert.equal(notificationTargetPath("reminder_test_week_closing", { test_week_id: TEAM }, "athlete"), "/athlete/test-week")
  assert.equal(notificationTargetPath("reminder_test_week_closing_coach", { test_week_id: TEAM }, "coach"), "/coach/test-week")
  // The coach digest: one team opens that team, several teams open the dashboard.
  assert.equal(notificationTargetPath("reminder_athletes_not_logged", { team_id: TEAM }, "coach"), `/coach/teams/${TEAM}`)
  assert.equal(notificationTargetPath("reminder_athletes_not_logged", { athlete_count: 4 }, "coach"), "/coach/dashboard")
  // A club admin who coaches a team gets the digest too and lands on the coach screens.
  assert.equal(notificationTargetPath("reminder_athletes_not_logged", { team_id: TEAM }, "club-admin"), `/coach/teams/${TEAM}`)
})

test("nothing typed ends up in a reminder path, and an unknown reminder falls back to the list", () => {
  assert.equal(notificationTargetPath("reminder_session_today", { session_date: "../../login" }, "athlete"), "/athlete/log")
  assert.equal(notificationTargetPath("reminder_athletes_not_logged", { team_id: "x/../y" }, "coach"), "/coach/dashboard")
  assert.equal(notificationTargetPath("reminder_something_new", {}, "athlete"), NOTIFICATIONS_PATH)
})

test("the button in a reminder email says where it goes", () => {
  assert.equal(notificationActionLabel("reminder_session_today"), "Open today's session")
  assert.equal(notificationActionLabel("reminder_checkin"), "Do your check-in")
  assert.equal(notificationActionLabel("reminder_test_week_closing"), "Open the test week")
  assert.equal(notificationActionLabel("reminder_test_week_closing_coach"), "Open the test week")
  assert.equal(notificationActionLabel("reminder_athletes_not_logged"), "See who has not logged")
})

test("reminder settings: each role sees its own, with the defaults the job uses", () => {
  const reminders = (role: "athlete" | "coach" | "club-admin" | "platform-admin") =>
    notificationCategoriesForRole(role).filter((category) => category.group === "reminders")
  assert.deepEqual(
    reminders("athlete").map((category) => category.eventTypes[0]),
    ["reminder_session_today", "reminder_checkin", "reminder_test_week_closing"],
  )
  assert.deepEqual(
    reminders("coach").map((category) => category.eventTypes[0]),
    ["reminder_test_week_closing_coach", "reminder_athletes_not_logged"],
  )
  assert.equal(reminders("platform-admin").length, 0)

  const byType = (eventType: string) => NOTIFICATION_PREFERENCE_CATEGORIES.find((category) => category.eventTypes.includes(eventType))
  // Daily ones: in the app, no email unless switched on. Test week closing: both.
  for (const eventType of ["reminder_session_today", "reminder_checkin", "reminder_athletes_not_logged"]) {
    assert.deepEqual(byType(eventType)?.defaults, { "in-app": true, email: false }, eventType)
    assert.equal(byType(eventType)?.emailAvailable, true, eventType)
  }
  for (const eventType of ["reminder_test_week_closing", "reminder_test_week_closing_coach"]) {
    assert.deepEqual(byType(eventType)?.defaults, { "in-app": true, email: true }, eventType)
  }
  // One event type belongs to one setting, and keys are unique.
  const types = NOTIFICATION_PREFERENCE_CATEGORIES.flatMap((category) => category.eventTypes)
  assert.equal(new Set(types).size, types.length)
  const keys = NOTIFICATION_PREFERENCE_CATEGORIES.map((category) => category.key)
  assert.equal(new Set(keys).size, keys.length)
})

test("time zones: known names, the default, and labels", () => {
  assert.equal(DEFAULT_CLUB_TIMEZONE, "America/Jamaica")
  assert.equal(isKnownTimezone("America/Jamaica"), true)
  assert.equal(isKnownTimezone("Europe/London"), true)
  assert.equal(isKnownTimezone("Mars/Olympus"), false)
  assert.equal(isKnownTimezone(""), false)
  assert.equal(isKnownTimezone(null), false)
  assert.equal(isKnownTimezone("America/Jamaica'; drop table"), false)
  assert.equal(cleanClubTimezone(" Europe/London "), "Europe/London")
  assert.equal(cleanClubTimezone("nope"), "America/Jamaica")
  assert.equal(timezoneLabel("America/Port_of_Spain"), "Port of Spain (America)")
  assert.equal(timezoneLabel("America/Argentina/Buenos_Aires"), "Buenos Aires (America, Argentina)")
  assert.equal(timezoneLabel("UTC"), "UTC")
})

test("time zones: the local clock, day and offset at a fixed moment", () => {
  const noonUtc = new Date("2026-10-13T12:00:00Z")
  // Jamaica has no daylight saving: UTC-5 all year. This is the 07:00 the session reminder uses.
  assert.equal(localClockIn("America/Jamaica", noonUtc), "07:00")
  assert.equal(timezoneOffsetMinutes("America/Jamaica", noonUtc), -300)
  assert.equal(timezoneOffsetLabel("America/Jamaica", noonUtc), "UTC-5")
  assert.equal(localClockIn("Europe/London", noonUtc), "13:00")
  assert.equal(timezoneOffsetLabel("Europe/London", noonUtc), "UTC+1")
  assert.equal(timezoneOffsetLabel("Europe/London", new Date("2026-12-01T12:00:00Z")), "UTC")
  assert.equal(timezoneOffsetLabel("Asia/Kolkata", noonUtc), "UTC+5:30")
  // The day changes at local midnight, not at UTC midnight.
  assert.equal(localDayIn("America/Jamaica", new Date("2026-10-14T03:30:00Z")), "2026-10-13")
  assert.equal(localDayIn("Europe/London", new Date("2026-10-13T23:30:00Z")), "2026-10-14")
  assert.equal(localClockIn("America/Jamaica", new Date("2026-10-14T05:00:00Z")), "00:00")
  assert.equal(localClockIn("Mars/Olympus", noonUtc), "")
  assert.equal(timezoneOffsetLabel("Mars/Olympus", noonUtc), "")
})

test("time zone picker: common ones first, the saved one never dropped, no duplicates", () => {
  const options = timezoneOptions("Pacific/Auckland", ["Africa/Lagos", "America/Jamaica", "Europe/London"])
  assert.equal(options.common[0].value, "America/Jamaica")
  assert.deepEqual(options.others.map((option) => option.value), ["Africa/Lagos", "Pacific/Auckland"])
  const all = [...options.common, ...options.others].map((option) => option.value)
  assert.equal(new Set(all).size, all.length)
  // With the browser's own list the default is still there.
  assert.ok(timezoneOptions().common.some((option) => option.value === "America/Jamaica"))
})
