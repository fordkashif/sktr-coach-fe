import test from "node:test"
import assert from "node:assert/strict"
import { describeNoAccessError } from "../src/lib/auth-errors"
import { clubDayAt, clubToday, weekdayShortOf } from "../src/lib/club-day"
import { agoText, conflictSentence, editConflictError, isStaleWrite, readEditConflict, type EditConflict } from "../src/lib/data/edit-conflict"
import { cleanReturnPath, loginPathWithReturn, safeReturnPath } from "../src/lib/return-path"
import { createUndoQueue, UNDO_DELAY_MS } from "../src/lib/undo-queue"

/* ------------------------------ Undo queue ------------------------------ */

function fakeClock() {
  let now = 0
  let nextHandle = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  return {
    clock: {
      setTimeout: (run: () => void, ms: number) => {
        const handle = nextHandle++
        timers.set(handle, { at: now + ms, run })
        return handle
      },
      clearTimeout: (handle: unknown) => {
        timers.delete(handle as number)
      },
    },
    advance(ms: number) {
      now += ms
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(handle)
          timer.run()
        }
      }
    },
    waiting: () => timers.size,
  }
}

test("undo queue: a delete is sent only when its time is up", () => {
  const time = fakeClock()
  const queue = createUndoQueue(time.clock)
  const sent: string[] = []
  queue.add(() => void sent.push("note"))
  time.advance(UNDO_DELAY_MS - 1)
  assert.deepEqual(sent, [])
  assert.equal(queue.size(), 1)
  time.advance(1)
  assert.deepEqual(sent, ["note"])
  assert.equal(queue.size(), 0)
})

test("undo queue: Undo cancels the delete and it is never sent", () => {
  const time = fakeClock()
  const queue = createUndoQueue(time.clock)
  const sent: string[] = []
  const id = queue.add(() => void sent.push("goal"))
  assert.equal(queue.undo(id), true)
  time.advance(UNDO_DELAY_MS * 2)
  assert.deepEqual(sent, [])
  assert.equal(time.waiting(), 0)
  assert.equal(queue.has(id), false)
})

test("undo queue: Undo after the delete was sent reports that it is too late", () => {
  const time = fakeClock()
  const queue = createUndoQueue(time.clock)
  const id = queue.add(() => undefined)
  time.advance(UNDO_DELAY_MS)
  assert.equal(queue.undo(id), false)
})

test("undo queue: flushing (page hidden) sends everything held, once, in order", () => {
  const time = fakeClock()
  const queue = createUndoQueue(time.clock)
  const sent: string[] = []
  queue.add(() => void sent.push("first"))
  queue.add(() => void sent.push("second"))
  queue.flushAll()
  assert.deepEqual(sent, ["first", "second"])
  assert.equal(queue.size(), 0)
  // The timers are gone too: nothing is sent a second time.
  time.advance(UNDO_DELAY_MS * 2)
  queue.flushAll()
  assert.deepEqual(sent, ["first", "second"])
})

test("undo queue: flushing one delete leaves the others waiting", () => {
  const time = fakeClock()
  const queue = createUndoQueue(time.clock)
  const sent: string[] = []
  const first = queue.add(() => void sent.push("first"))
  const second = queue.add(() => void sent.push("second"))
  queue.flush(first)
  assert.deepEqual(sent, ["first"])
  assert.equal(queue.has(second), true)
  queue.flush(first)
  assert.deepEqual(sent, ["first"])
})

test("undo queue: a delete that throws or rejects does not stop the next one", async () => {
  const time = fakeClock()
  const queue = createUndoQueue(time.clock)
  const sent: string[] = []
  queue.add(() => {
    throw new Error("offline")
  })
  queue.add(() => Promise.reject(new Error("offline")))
  queue.add(() => void sent.push("third"))
  queue.flushAll()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(sent, ["third"])
})

test("undo queue: a commit that flushes the queue again is not sent twice", () => {
  const time = fakeClock()
  const queue = createUndoQueue(time.clock)
  let count = 0
  queue.add(() => {
    count += 1
    queue.flushAll()
  })
  queue.flushAll()
  assert.equal(count, 1)
})

/* ------------------------------ Return path ----------------------------- */

test("return path: only paths inside the app survive", () => {
  assert.equal(cleanReturnPath("/athlete/log?date=2026-10-05"), "/athlete/log?date=2026-10-05")
  assert.equal(cleanReturnPath("/coach/training-plan#week-2"), "/coach/training-plan#week-2")
  for (const bad of [
    null,
    undefined,
    "",
    "athlete/home",
    "//evil.example/athlete/home",
    "/\\evil.example",
    "/\\/evil.example",
    "https://evil.example/athlete/home",
    "javascript:alert(1)",
    "/athlete/home\n//evil.example",
    "/\tevil.example",
    "/login",
    "/login?redirect=/athlete/home",
    `/${"a".repeat(600)}`,
  ]) {
    assert.equal(cleanReturnPath(bad), null, `should refuse ${JSON.stringify(bad)}`)
  }
})

test("return path: a person goes back only to a screen their role can open", () => {
  assert.equal(safeReturnPath("/athlete/log?date=2026-10-05", "athlete"), "/athlete/log?date=2026-10-05")
  assert.equal(safeReturnPath("/coach/athletes/a1/log", "coach"), "/coach/athletes/a1/log")
  assert.equal(safeReturnPath("/coach/training-plan", "club-admin"), "/coach/training-plan")
  assert.equal(safeReturnPath("/club-admin/teams?team=t1", "club-admin"), "/club-admin/teams?team=t1")
  assert.equal(safeReturnPath("/guardian/plan", "guardian"), "/guardian/plan")
  assert.equal(safeReturnPath("/platform-admin/dashboard", "platform-admin"), "/platform-admin/dashboard")
  // Another role's area, after someone else signs in on the same device.
  assert.equal(safeReturnPath("/coach/dashboard", "athlete"), null)
  assert.equal(safeReturnPath("/club-admin/users", "coach"), null)
  assert.equal(safeReturnPath("/athlete/home", "guardian"), null)
  assert.equal(safeReturnPath("/athlete/home", "coach"), null)
  assert.equal(safeReturnPath("/platform-admin/dashboard", "club-admin"), null)
  assert.equal(safeReturnPath("/guardian/home", "athlete"), null)
})

test("return path: unknown screens, public pages and bad shapes fall back to the role's home", () => {
  assert.equal(safeReturnPath("/pricing", "athlete"), null)
  assert.equal(safeReturnPath("/", "coach"), null)
  assert.equal(safeReturnPath("//evil.example", "coach"), null)
  assert.equal(safeReturnPath("https://evil.example/coach/dashboard", "coach"), null)
  assert.equal(safeReturnPath("/coach/dashboard", null), null)
})

test("return path: invite and join links come back for anyone", () => {
  assert.equal(safeReturnPath("/guardian/claim/abc", "guardian"), "/guardian/claim/abc")
  assert.equal(safeReturnPath("/athlete/claim/abc", "coach"), "/athlete/claim/abc")
  assert.equal(safeReturnPath("/invite/coach/abc", "athlete"), "/invite/coach/abc")
  assert.equal(safeReturnPath("/join/ABC123", "athlete"), "/join/ABC123")
})

test("return path: the login address carries the screen the person was on", () => {
  assert.equal(loginPathWithReturn("/athlete/log", "?date=2026-10-05"), "/login?redirect=%2Fathlete%2Flog%3Fdate%3D2026-10-05")
  assert.equal(loginPathWithReturn("//evil.example"), "/login")
  // Round trip: what the guard writes, the login page accepts for that role.
  const written = new URL(loginPathWithReturn("/coach/test-week", "?week=w1"), "https://app.invalid").searchParams.get("redirect")
  assert.equal(safeReturnPath(written, "coach"), "/coach/test-week?week=w1")
})

/* --------------------------- Stale write detection ---------------------- */

test("stale write: the same moment is not stale, however it is spelled", () => {
  assert.equal(isStaleWrite("2026-10-05T12:00:00.123456+00:00", "2026-10-05T12:00:00.123456+00:00"), false)
  assert.equal(isStaleWrite("2026-10-05T12:00:00.000Z", "2026-10-05T12:00:00+00:00"), false)
  assert.equal(isStaleWrite("2026-10-05T07:00:00-05:00", "2026-10-05T12:00:00Z"), false)
})

test("stale write: a later change on the server is stale", () => {
  assert.equal(isStaleWrite("2026-10-05T12:00:00Z", "2026-10-05T12:02:00Z"), true)
  // Never changed when loaded, changed since.
  assert.equal(isStaleWrite(null, "2026-10-05T12:02:00Z"), true)
  assert.equal(isStaleWrite(null, null), false)
})

test("stale write: an editor that is not tracking the record is never refused", () => {
  assert.equal(isStaleWrite(undefined, "2026-10-05T12:02:00Z"), false)
  assert.equal(isStaleWrite(undefined, null), false)
})

test("stale write: the sentence says who and how long ago", () => {
  const now = new Date("2026-10-05T12:02:10Z")
  const base: EditConflict = { kind: "plan", changedAt: "2026-10-05T12:00:00Z", changedByName: "Andre", changedBySelf: false }
  assert.equal(conflictSentence(base, now), "Andre changed this plan 2 minutes ago.")
  assert.equal(conflictSentence({ ...base, kind: "test-week", changedByName: null }, now), "This test week was changed 2 minutes ago.")
  assert.equal(conflictSentence({ ...base, kind: "club-profile", changedByName: null, changedBySelf: true }, now), "You changed this club profile 2 minutes ago, on another device or tab.")
  assert.equal(conflictSentence({ ...base, kind: "team", changedAt: null }, now), "Andre changed this team since you opened it.")
})

test("stale write: time ago reads in plain words", () => {
  const now = new Date("2026-10-05T12:00:00Z")
  assert.equal(agoText("2026-10-05T11:59:40Z", now), "just now")
  assert.equal(agoText("2026-10-05T11:59:00Z", now), "1 minute ago")
  assert.equal(agoText("2026-10-05T10:00:00Z", now), "2 hours ago")
  assert.equal(agoText("2026-10-03T12:00:00Z", now), "2 days ago")
  assert.equal(agoText(null, now), "")
  assert.equal(agoText("not a date", now), "")
  // A clock that is slightly behind never says "in the future".
  assert.equal(agoText("2026-10-05T12:00:30Z", now), "just now")
})

test("stale write: the conflict travels inside the save error and nothing else is mistaken for one", () => {
  const conflict: EditConflict = { kind: "plan", changedAt: "2026-10-05T12:00:00Z", changedByName: "Andre", changedBySelf: false }
  const error = editConflictError(conflict)
  assert.equal(error.code, "CONFLICT")
  assert.deepEqual(readEditConflict(error), conflict)
  assert.equal(readEditConflict({ code: "CONFLICT", message: "duplicate key", cause: { code: "23505" } }), null)
  assert.equal(readEditConflict({ code: "FORBIDDEN", message: "no", cause: { editConflict: conflict } }), null)
  assert.equal(readEditConflict(null), null)
})

/* -------------------------------- Club day ------------------------------ */

test("club day: late evening in Jamaica is still that day for a coach in London", () => {
  // 03:30 UTC on the 6th: 04:30 in London (BST), 22:30 on the 5th in Kingston.
  const at = new Date("2026-10-06T03:30:00Z")
  assert.equal(clubDayAt("America/Jamaica", at), "2026-10-05")
  assert.equal(clubDayAt("Europe/London", at), "2026-10-06")
  assert.equal(clubDayAt("UTC", at), "2026-10-06")
})

test("club day: a club ahead of UTC is already on tomorrow", () => {
  const at = new Date("2026-10-05T20:30:00Z")
  assert.equal(clubDayAt("Australia/Sydney", at), "2026-10-06")
  assert.equal(clubDayAt("America/Jamaica", at), "2026-10-05")
})

test("club day: daylight saving and year end land on the right day", () => {
  // New York is UTC-4 in October and UTC-5 in December.
  assert.equal(clubDayAt("America/New_York", new Date("2026-10-06T03:59:00Z")), "2026-10-05")
  assert.equal(clubDayAt("America/New_York", new Date("2026-10-06T04:00:00Z")), "2026-10-06")
  assert.equal(clubDayAt("America/New_York", new Date("2027-01-01T04:59:00Z")), "2026-12-31")
  assert.equal(clubDayAt("America/New_York", new Date("2027-01-01T05:00:00Z")), "2027-01-01")
})

test("club day: an unknown zone falls back to the device's day instead of failing", () => {
  const at = new Date(2026, 9, 5, 9, 0, 0)
  assert.equal(clubDayAt("Mars/Olympus", at), "2026-10-05")
  assert.equal(clubDayAt(null, at), "2026-10-05")
  assert.equal(clubDayAt("", at), "2026-10-05")
})

test("club day: with no zone kept on the device, today is the device's day", () => {
  const at = new Date(2026, 9, 5, 23, 30, 0)
  assert.equal(clubToday(at), "2026-10-05")
})

test("club day: the weekday of a day does not depend on where the device is", () => {
  assert.equal(weekdayShortOf("2026-10-05"), "Mon")
  assert.equal(weekdayShortOf("2026-10-11"), "Sun")
})

/* ------------------------------ Login hint ------------------------------ */

test("login hint: a waiting invite is explained for parents and guardians too", () => {
  const hint = describeNoAccessError("invite_pending")
  assert.match(hint, /invite email/)
  assert.match(hint, /parent or guardian/)
  assert.doesNotMatch(describeNoAccessError("none"), /parent or guardian/)
})
