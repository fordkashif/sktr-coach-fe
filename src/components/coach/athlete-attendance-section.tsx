"use client"

import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { EmptyState, LinkButton, List, ListRow, Section, SkeletonRows, StatusDot, StatusText } from "@/components/sk"
import { attendanceCounts, attendanceInWindow, attendanceLabel, attendanceRate, attendanceSummaryText, attendanceTone, type AttendanceRecord } from "@/lib/data/coach/attendance"
import { ATTENDANCE_CHANGED_EVENT, attendanceWindow, listAthleteAttendance } from "@/lib/data/coach/attendance-data"
import { parseLocalDay } from "@/lib/data/pr/pr-display"

const SHOWN = 6

function dayText(value: string) {
  const day = parseLocalDay(value)
  return day ? day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : value
}

/** One athlete's attendance on the coach's athlete screen: the rate over the last four weeks and the latest marks. */
export function AthleteAttendanceSection({ athleteId, athleteName, teamId }: { athleteId: string; athleteName: string; teamId: string | null }) {
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null)
  const first = athleteName.split(" ")[0] || athleteName

  useEffect(() => {
    let cancelled = false
    const load = () =>
      void listAthleteAttendance(athleteId).then((result) => {
        // A read that fails leaves the section empty; the rest of the athlete screen is unaffected.
        if (!cancelled) setRecords(result.ok ? result.data : [])
      })
    load()
    window.addEventListener(ATTENDANCE_CHANGED_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(ATTENDANCE_CHANGED_EVENT, load)
    }
  }, [athleteId])

  const window4 = attendanceWindow()
  const recent = attendanceInWindow(records ?? [], window4.from, window4.to)
  const rate = attendanceRate(recent)
  const summary = attendanceSummaryText(attendanceCounts(recent))
  const takeHref = teamId ? `/coach/teams/${teamId}/attendance` : null

  return (
    <Section
      title="Attendance"
      data-athlete-attendance
      hint={records && records.length > 0 ? (rate.percent === null ? `Last 4 weeks: ${summary || "nothing taken"}.` : `${rate.attended} of ${rate.counted} sessions attended in the last 4 weeks. ${summary}.`) : undefined}
      meta={rate.percent !== null ? `${rate.percent}%` : undefined}
      action={
        takeHref && records && records.length > 0 ? (
          <Link className="sk-link" to={takeHref}>
            Take attendance
          </Link>
        ) : undefined
      }
    >
      {records === null ? (
        <SkeletonRows rows={2} label="Loading attendance" />
      ) : records.length === 0 ? (
        <EmptyState
          title="No attendance taken yet"
          body={`When you take attendance for the team, ${first}'s marks and their rate over the last 4 weeks show here.`}
          action={
            takeHref ? (
              <LinkButton to={takeHref} size="sm">
                Take attendance
              </LinkButton>
            ) : undefined
          }
        />
      ) : (
        <List aria-label="Recent attendance">
          {records.slice(0, SHOWN).map((record) => (
            <ListRow
              key={record.id}
              leading={<StatusDot tone={attendanceTone(record.status)} />}
              title={dayText(record.date)}
              subtitle={record.reason ?? undefined}
              trailing={<StatusText tone={attendanceTone(record.status)}>{attendanceLabel(record.status)}</StatusText>}
            />
          ))}
        </List>
      )}
    </Section>
  )
}
