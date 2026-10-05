/**
 * Attendance, the rules in one place (coach attendance screen, athlete screen, roster table, the
 * athlete's own log):
 *
 *   rate = (present + late) / (present + late + absent)
 *
 * - Excused marks are in neither number: being injured, sick or away is not a missed session.
 * - Nothing counted means there is no figure (null). It is never shown as 100%.
 * - An athlete marked injured, sick or away on the day starts as excused, with that word as the
 *   reason, until the coach changes it.
 *
 * Pure and free of imports, so the unit tests and every data module can use it.
 */

export type AttendanceStatus = "present" | "late" | "absent" | "excused"
export type AttendanceTone = "green" | "amber" | "coral" | "neutral"

export const ATTENDANCE_STATUSES: Array<{ value: AttendanceStatus; label: string; tone: AttendanceTone }> = [
  { value: "present", label: "Present", tone: "green" },
  { value: "late", label: "Late", tone: "amber" },
  { value: "absent", label: "Absent", tone: "coral" },
  { value: "excused", label: "Excused", tone: "neutral" },
]

export const ATTENDANCE_REASON_MAX = 200

export type AttendanceRecord = {
  id: string
  teamId: string
  athleteId: string
  /** ISO day, yyyy-mm-dd. */
  date: string
  sessionId: string | null
  status: AttendanceStatus
  reason: string | null
}

/** The part of an availability period these rules need. */
export type AttendancePeriod = { kind: "injured" | "sick" | "away"; startsOn: string; endsOn: string | null }

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return value === "present" || value === "late" || value === "absent" || value === "excused"
}

export function attendanceLabel(status: AttendanceStatus) {
  return ATTENDANCE_STATUSES.find((entry) => entry.value === status)?.label ?? "Not marked"
}

export function attendanceTone(status: AttendanceStatus): AttendanceTone {
  return ATTENDANCE_STATUSES.find((entry) => entry.value === status)?.tone ?? "neutral"
}

/** The period that makes the athlete unavailable on `day`, or null. A period cancelled before it began covers nothing. */
export function unavailableOn<T extends AttendancePeriod>(periods: T[], day: string): T | null {
  const date = day.slice(0, 10)
  return periods.find((period) => date >= period.startsOn && (period.endsOn === null || date <= period.endsOn)) ?? null
}

const KIND_WORD: Record<AttendancePeriod["kind"], string> = { injured: "Injured", sick: "Sick", away: "Away" }

/**
 * What an athlete with no mark yet starts as. Unavailable on the day: excused, with the reason.
 * Otherwise nothing is chosen until the coach marks them.
 */
export function defaultAttendance(period: AttendancePeriod | null): { status: AttendanceStatus | null; reason: string | null } {
  return period ? { status: "excused", reason: KIND_WORD[period.kind] } : { status: null, reason: null }
}

/** What "Mark everyone present" gives one athlete: present, or excused when they are unavailable that day. */
export function markAllStatus(period: AttendancePeriod | null): { status: AttendanceStatus; reason: string | null } {
  const start = defaultAttendance(period)
  return { status: start.status ?? "present", reason: start.reason }
}

export type AttendanceCounts = { present: number; late: number; absent: number; excused: number }

export function attendanceCounts(records: Array<{ status: AttendanceStatus }>): AttendanceCounts {
  const counts: AttendanceCounts = { present: 0, late: 0, absent: 0, excused: 0 }
  for (const record of records) counts[record.status] += 1
  return counts
}

export type AttendanceRate = {
  /** Present or late. */
  attended: number
  /** Present, late or absent. Excused days are left out. */
  counted: number
  excused: number
  /** Whole percent, or null when nothing was counted. */
  percent: number | null
}

export function attendanceRate(records: Array<{ status: AttendanceStatus }>): AttendanceRate {
  const counts = attendanceCounts(records)
  const attended = counts.present + counts.late
  const counted = attended + counts.absent
  return { attended, counted, excused: counts.excused, percent: counted > 0 ? Math.round((attended / counted) * 100) : null }
}

/** The records of one window of days, both ends included. */
export function attendanceInWindow<T extends { date: string }>(records: T[], from: string, to: string): T[] {
  return records.filter((record) => record.date >= from && record.date <= to)
}

/** "9 of 10" for a table cell, "None taken" when there is nothing to count. */
export function attendanceRateText(rate: Pick<AttendanceRate, "attended" | "counted">) {
  return rate.counted > 0 ? `${rate.attended} of ${rate.counted}` : "None taken"
}

/** "Present 4, late 1, absent 1, excused 2": only the states that happened. */
export function attendanceSummaryText(counts: AttendanceCounts) {
  const parts = ATTENDANCE_STATUSES.filter((entry) => counts[entry.value] > 0).map((entry) => `${entry.label.toLowerCase()} ${counts[entry.value]}`)
  if (parts.length === 0) return ""
  const text = parts.join(", ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function cleanAttendanceReason(text: string | null | undefined): string | null {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim().slice(0, ATTENDANCE_REASON_MAX)
  return trimmed || null
}

/** "Logged by Coach Rivera": the line an athlete sees on a session someone entered for them. */
export function loggedByLabel(name: string | null | undefined, role: string | null | undefined) {
  const clean = (name ?? "").replace(/\s+/g, " ").trim()
  if (!clean) return role === "club-admin" ? "Logged by a club admin" : "Logged by your coach"
  if (role === "club-admin") return `Logged by ${clean}`
  return /^coach\b/i.test(clean) ? `Logged by ${clean}` : `Logged by Coach ${clean}`
}
