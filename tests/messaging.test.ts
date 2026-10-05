import test from "node:test"
import assert from "node:assert/strict"
import { evaluateAccess } from "../src/lib/access-control"
import { announcementHref, canMessageAthlete, messageAthleteHref, messageCoachHref, messagesHomeHref, newAnnouncementHref, threadHref } from "../src/lib/data/messages/links"
import { audienceLabel, audiencePhrase, HIDDEN_MESSAGE_STUB, MESSAGE_MAX_LENGTH, readOnlyText, SAFEGUARDING_LINE } from "../src/lib/data/messages/types"
import { notificationActionLabel, notificationTargetPath, NOTIFICATIONS_PATH } from "../supabase/functions/_shared/notification-target"

const THREAD = "0f8fad5b-d9cb-469f-a165-70867728950e"
const ANNOUNCEMENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7"

test("message links: each role has its own Messages screen", () => {
  assert.equal(messagesHomeHref("athlete"), "/athlete/messages")
  assert.equal(messagesHomeHref("coach"), "/coach/messages")
  assert.equal(messagesHomeHref("club-admin"), "/club-admin/messages")
  assert.equal(messagesHomeHref("club-admin", "oversight"), "/club-admin/messages?tab=oversight")
  assert.equal(threadHref("coach", THREAD), `/coach/messages/t/${THREAD}`)
  assert.equal(announcementHref("athlete", ANNOUNCEMENT), `/athlete/messages/a/${ANNOUNCEMENT}`)
  assert.equal(newAnnouncementHref("club-admin"), "/club-admin/messages/a/new")
})

test("message links: the entry points other screens use", () => {
  assert.equal(messageAthleteHref("a b/c"), "/coach/messages/with/a%20b%2Fc")
  assert.equal(messageCoachHref(THREAD), `/athlete/messages/coach/${THREAD}`)
  // A managed athlete with no login cannot be messaged.
  assert.equal(canMessageAthlete({ userId: null }), false)
  assert.equal(canMessageAthlete({ userId: THREAD }), true)
  assert.equal(canMessageAthlete({ userId: THREAD, hasLogin: false }), false)
})

test("a new message notification opens the conversation of the person it was sent to", () => {
  assert.equal(notificationTargetPath("direct_message_received", { thread_id: THREAD }, "athlete"), `/athlete/messages/t/${THREAD}`)
  assert.equal(notificationTargetPath("direct_message_received", { thread_id: THREAD }, "coach"), `/coach/messages/t/${THREAD}`)
  // A club admin only gets one when they coach the athlete's team: their conversations are on the coach screens.
  assert.equal(notificationTargetPath("direct_message_received", { thread_id: THREAD }, "club-admin"), `/coach/messages/t/${THREAD}`)
  // Nothing a person typed ever ends up in a path.
  assert.equal(notificationTargetPath("direct_message_received", { thread_id: "../../login" }, "athlete"), "/athlete/messages")
  assert.equal(notificationActionLabel("direct_message_received"), "Open the conversation")
})

test("an announcement notification opens the announcement", () => {
  assert.equal(notificationTargetPath("announcement_posted", { announcement_id: ANNOUNCEMENT }, "athlete"), `/athlete/messages/a/${ANNOUNCEMENT}`)
  assert.equal(notificationTargetPath("announcement_posted", { announcement_id: ANNOUNCEMENT }, "coach"), `/coach/messages/a/${ANNOUNCEMENT}`)
  assert.equal(notificationTargetPath("announcement_posted", { announcement_id: ANNOUNCEMENT }, "club-admin"), `/club-admin/messages/a/${ANNOUNCEMENT}`)
  assert.equal(notificationTargetPath("announcement_posted", {}, "athlete"), "/athlete/messages?tab=announcements")
  assert.equal(notificationActionLabel("announcement_posted"), "Read the announcement")
})

test("a reported message opens message oversight, for club admins only", () => {
  assert.equal(notificationTargetPath("message_reported", { thread_id: THREAD }, "club-admin"), `/club-admin/messages/t/${THREAD}`)
  assert.equal(notificationTargetPath("message_reported", {}, "club-admin"), "/club-admin/messages?tab=oversight")
  assert.equal(notificationTargetPath("message_reported", { thread_id: THREAD }, "coach"), NOTIFICATIONS_PATH)
  assert.equal(notificationTargetPath("message_reported", { thread_id: THREAD }, "athlete"), NOTIFICATIONS_PATH)
})

test("the words both people are shown", () => {
  assert.equal(SAFEGUARDING_LINE, "Club admins can read messages between coaches and athletes.")
  assert.equal(HIDDEN_MESSAGE_STUB, "Message hidden by a club admin")
  assert.equal(MESSAGE_MAX_LENGTH, 1000)
  assert.equal(audienceLabel({ audience: "team", teamName: "Sprint Group" }), "Sprint Group")
  assert.equal(audiencePhrase({ audience: "club", teamName: null }), "the whole club")
  assert.equal(audiencePhrase({ audience: "coaches", teamName: null }), "all coaches")
  assert.match(readOnlyText("athlete_left_team", "coach"), /no longer on your team/)
  assert.match(readOnlyText("coach_not_on_team", "athlete"), /no longer coaches your team/)
  assert.match(readOnlyText(null, "oversight"), /never write/)
  // No em dash anywhere in the copy.
  for (const text of [SAFEGUARDING_LINE, HIDDEN_MESSAGE_STUB, readOnlyText("no_login", "coach"), readOnlyText("inactive", "athlete")]) assert.ok(!text.includes("—"))
})

test("who may open the new screens", () => {
  const as = (role: "athlete" | "coach" | "club-admin", pathname: string, extra: Record<string, unknown> = {}) =>
    evaluateAccess({ pathname, isAuthenticated: true, role, tenantId: "club", ...extra }).allowed
  // Coach screens are open to coaches and to club admins; athlete and club admin screens to their own role only.
  for (const path of ["/coach/messages", "/coach/messages/t/x", "/coach/competitions", "/coach/competitions/x/enter"]) {
    assert.equal(as("coach", path), true)
    assert.equal(as("club-admin", path), true)
    assert.equal(as("athlete", path), false)
  }
  assert.equal(as("athlete", "/athlete/messages"), true)
  assert.equal(as("coach", "/athlete/messages"), false)
  assert.equal(as("club-admin", "/club-admin/messages"), true)
  assert.equal(as("coach", "/club-admin/messages"), false)
  assert.equal(as("athlete", "/club-admin/messages/t/x"), false)
  // A deactivated member and a suspended club are stopped before any of them.
  assert.equal(as("coach", "/coach/messages", { memberActive: false }), false)
  assert.equal(as("athlete", "/athlete/messages", { tenantLifecycleStatus: "suspended" }), false)
  assert.equal(evaluateAccess({ pathname: "/coach/messages", isAuthenticated: false, role: null, tenantId: null }).redirectTo, "/login")
})
