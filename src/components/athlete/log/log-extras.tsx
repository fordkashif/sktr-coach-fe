import { useEffect, useState } from "react"
import { StatusText } from "@/components/sk"
import { attendanceLabel, attendanceTone, loggedByLabel, type AttendanceRecord } from "@/lib/data/coach/attendance"
import { getMyAttendance } from "@/lib/data/coach/attendance-data"
import { getSessionLoggedBy, type SessionLoggedBy } from "@/lib/data/session/logged-by-data"

/**
 * "Logged by Coach Rivera": shown to the athlete on a session a coach or club admin entered for
 * them. Nothing shows for a session they logged themselves. They can still edit it.
 */
export function SessionEnteredBy({ sessionId }: { sessionId: string }) {
  const [by, setBy] = useState<SessionLoggedBy | null>(null)
  useEffect(() => {
    let cancelled = false
    setBy(null)
    void getSessionLoggedBy(sessionId).then((result) => {
      if (!cancelled && result.ok) setBy(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [sessionId])
  if (!by) return null
  return (
    <p className="text-[0.9375rem] text-sk-mute" data-logged-by>
      <span className="font-semibold text-sk-ink">{loggedByLabel(by.name, by.role)}.</span> If something is not right you can still edit it.
    </p>
  )
}

/** The athlete's own attendance mark for one day, as their coach took it. Read only. */
export function MyAttendanceLine({ date }: { date: string }) {
  const [record, setRecord] = useState<AttendanceRecord | null>(null)
  useEffect(() => {
    let cancelled = false
    setRecord(null)
    void getMyAttendance(date, date).then((result) => {
      if (!cancelled && result.ok) setRecord(result.data[0] ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [date])
  if (!record) return null
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-[0.9375rem] text-sk-mute" data-my-attendance={record.status}>
      Attendance taken by your coach:
      <StatusText tone={attendanceTone(record.status)}>{attendanceLabel(record.status)}</StatusText>
      {record.reason ? <span>({record.reason})</span> : null}
    </p>
  )
}
