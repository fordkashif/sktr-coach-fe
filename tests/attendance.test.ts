import test from "node:test"
import assert from "node:assert/strict"
import {
  attendanceCounts,
  attendanceInWindow,
  attendanceRate,
  attendanceRateText,
  attendanceSummaryText,
  cleanAttendanceReason,
  defaultAttendance,
  loggedByLabel,
  markAllStatus,
  unavailableOn,
  type AttendancePeriod,
  type AttendanceStatus,
} from "../src/lib/data/coach/attendance"

const marks = (...statuses: AttendanceStatus[]) => statuses.map((status) => ({ status }))

test("attendance rate counts present and late over present, late and absent", () => {
  const rate = attendanceRate(marks("present", "present", "late", "absent"))
  assert.deepEqual(rate, { attended: 3, counted: 4, excused: 0, percent: 75 })
  assert.equal(attendanceRateText(rate), "3 of 4")
})

test("excused days leave the rate", () => {
  const rate = attendanceRate(marks("present", "excused", "excused", "absent"))
  assert.equal(rate.counted, 2)
  assert.equal(rate.excused, 2)
  assert.equal(rate.percent, 50)
})

test("nothing counted gives no figure, never 100 percent", () => {
  assert.equal(attendanceRate([]).percent, null)
  assert.equal(attendanceRate(marks("excused")).percent, null)
  assert.equal(attendanceRateText(attendanceRate(marks("excused"))), "None taken")
})

test("the rate rounds to a whole percent", () => {
  assert.equal(attendanceRate(marks("present", "present", "absent")).percent, 67)
  assert.equal(attendanceRate(marks("late")).percent, 100)
  assert.equal(attendanceRate(marks("absent")).percent, 0)
})

test("the window keeps both end days and nothing outside", () => {
  const records = ["2026-09-07", "2026-09-08", "2026-10-05", "2026-10-06"].map((date) => ({ date, status: "present" as const }))
  assert.deepEqual(attendanceInWindow(records, "2026-09-08", "2026-10-05").map((record) => record.date), ["2026-09-08", "2026-10-05"])
})

test("counts and their summary only name what happened", () => {
  const counts = attendanceCounts(marks("present", "present", "late", "excused"))
  assert.deepEqual(counts, { present: 2, late: 1, absent: 0, excused: 1 })
  assert.equal(attendanceSummaryText(counts), "Present 2, late 1, excused 1")
  assert.equal(attendanceSummaryText(attendanceCounts([])), "")
})

const period = (kind: AttendancePeriod["kind"], startsOn: string, endsOn: string | null): AttendancePeriod => ({ kind, startsOn, endsOn })

test("an athlete is unavailable on the first and last day of a period, not around it", () => {
  const periods = [period("injured", "2026-10-02", "2026-10-06")]
  assert.equal(unavailableOn(periods, "2026-10-01"), null)
  assert.equal(unavailableOn(periods, "2026-10-02")?.kind, "injured")
  assert.equal(unavailableOn(periods, "2026-10-06")?.kind, "injured")
  assert.equal(unavailableOn(periods, "2026-10-07"), null)
})

test("an open ended period covers every later day, a cancelled one covers nothing", () => {
  assert.equal(unavailableOn([period("sick", "2026-10-02", null)], "2027-01-01")?.kind, "sick")
  // Cancelled before it began: the last day is the day before the first.
  assert.equal(unavailableOn([period("away", "2026-10-02", "2026-10-01")], "2026-10-02"), null)
})

test("the default mark is excused with the reason for an unavailable athlete, and empty otherwise", () => {
  assert.deepEqual(defaultAttendance(period("injured", "2026-10-01", null)), { status: "excused", reason: "Injured" })
  assert.deepEqual(defaultAttendance(period("sick", "2026-10-01", null)), { status: "excused", reason: "Sick" })
  assert.deepEqual(defaultAttendance(period("away", "2026-10-01", null)), { status: "excused", reason: "Away" })
  assert.deepEqual(defaultAttendance(null), { status: null, reason: null })
})

test("mark everyone present keeps unavailable athletes excused", () => {
  assert.deepEqual(markAllStatus(null), { status: "present", reason: null })
  assert.deepEqual(markAllStatus(period("away", "2026-10-01", null)), { status: "excused", reason: "Away" })
})

test("a reason is trimmed, collapsed and cut to 200 characters", () => {
  assert.equal(cleanAttendanceReason("  bus   was late "), "bus was late")
  assert.equal(cleanAttendanceReason("   "), null)
  assert.equal(cleanAttendanceReason(null), null)
  assert.equal(cleanAttendanceReason("x".repeat(300))?.length, 200)
})

test("logged by reads naturally for a coach, a coach already called Coach, and a club admin", () => {
  assert.equal(loggedByLabel("Dana Rivera", "coach"), "Logged by Coach Dana Rivera")
  assert.equal(loggedByLabel("Coach Rivera", "coach"), "Logged by Coach Rivera")
  assert.equal(loggedByLabel("Ada Admin", "club-admin"), "Logged by Ada Admin")
  assert.equal(loggedByLabel("", "coach"), "Logged by your coach")
  assert.equal(loggedByLabel(null, "club-admin"), "Logged by a club admin")
})
