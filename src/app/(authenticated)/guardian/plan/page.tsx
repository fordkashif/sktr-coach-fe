"use client"

import { useEffect, useState } from "react"
import { GuardianChildScreen, dayRange, shortDay } from "@/components/guardian/guardian-frame"
import { Button, DayLabel, EmptyState, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows, Split, StatusText, WeekPager, type StateTone } from "@/components/sk"
import { attendanceLabel, attendanceTone } from "@/lib/data/coach/attendance"
import { getGuardianAttendance, getGuardianWeek } from "@/lib/data/guardian/guardian-data"
import { weekStartOf } from "@/lib/data/guardian/mock-guardian-content"
import type { GuardianAttendanceRow, GuardianChild, GuardianDayState, GuardianWeek } from "@/lib/data/guardian/types"

function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function shiftDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function shiftWeek(weekStart: string, weeks: number) {
  return shiftDays(weekStart, weeks * 7)
}

const STATE: Record<Exclude<GuardianDayState, "rest">, { tone: StateTone; label: string }> = {
  done: { tone: "green", label: "Done" },
  skipped: { tone: "amber", label: "Skipped" },
  missed: { tone: "neutral", label: "Not logged" },
  today: { tone: "blue", label: "Today" },
  planned: { tone: "neutral", label: "Planned" },
}

function ChildPlan({ child }: { child: GuardianChild }) {
  const thisWeek = weekStartOf(todayIso())
  const [weekStart, setWeekStart] = useState(thisWeek)
  const [week, setWeek] = useState<GuardianWeek | null>(null)
  const [attendance, setAttendance] = useState<GuardianAttendanceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setWeek(null)
    setError(null)
    void getGuardianWeek(child.athleteId, weekStart).then((result) => {
      if (cancelled) return
      if (result.ok) setWeek(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [child.athleteId, weekStart])

  useEffect(() => {
    let cancelled = false
    setAttendance(null)
    void getGuardianAttendance(child.athleteId).then((result) => {
      if (!cancelled) setAttendance(result.ok ? result.data : [])
    })
    return () => {
      cancelled = true
    }
  }, [child.athleteId])

  const today = todayIso()
  const offset = Math.round((new Date(`${weekStart}T12:00:00`).getTime() - new Date(`${thisWeek}T12:00:00`).getTime()) / (7 * 86400000))
  const weekEnd = shiftDays(weekStart, 6)
  const weekTitle = offset === 0 ? "This week" : offset === -1 ? "Last week" : offset === 1 ? "Next week" : `Week of ${dayRange(weekStart, weekStart)}`
  const attended = attendance?.filter((row) => row.status === "present" || row.status === "late").length ?? 0

  return (
    <Screen>
      <ScreenHeader
        fact={child.teamName ?? undefined}
        title={`${child.firstName}'s plan`}
        lede={week && week.planned > 0 ? `${week.planName ?? "Training plan"}. ${week.done} of ${week.planned} sessions done${week.skipped > 0 ? `, ${week.skipped} skipped` : ""}.` : "What the coach planned, and what was done or skipped."}
      />

      {error ? <Notice tone="error">{`The plan could not be loaded. ${error}`}</Notice> : null}

      <Split
        main={
          <Section aria-label="The week">
            <WeekPager
              title={weekTitle}
              subtitle={dayRange(weekStart, weekEnd)}
              onPrevious={offset > -8 ? () => setWeekStart(shiftWeek(weekStart, -1)) : undefined}
              onNext={offset < 4 ? () => setWeekStart(shiftWeek(weekStart, 1)) : undefined}
              action={
                offset !== 0 ? (
                  <Button size="sm" variant="quiet" onClick={() => setWeekStart(thisWeek)}>
                    Today
                  </Button>
                ) : undefined
              }
            />
            {!week ? (
              error ? null : (
                <SkeletonRows rows={5} leading />
              )
            ) : week.planned === 0 ? (
              <EmptyState title="Nothing planned this week" body={`When the coach publishes a plan for ${child.firstName}, each day shows here with what was done.`} />
            ) : (
              <List aria-label={`${child.firstName}'s week`}>
                {week.days.map((day) => {
                  const date = new Date(`${day.date}T12:00:00`)
                  const leading = <DayLabel weekday={date.toLocaleDateString(undefined, { weekday: "short" })} number={date.getDate()} today={day.date === today} muted={day.state === "rest"} />
                  if (day.state === "rest") {
                    return <ListRow key={day.date} leading={leading} title={<span className="font-normal text-sk-faint">Rest day</span>} data-day={day.date} data-state="rest" />
                  }
                  const state = STATE[day.state]
                  return (
                    <ListRow
                      key={day.date}
                      leading={leading}
                      title={day.title ?? "Session"}
                      subtitle={
                        <>
                          {day.focus ? <span className="block">{day.focus}</span> : null}
                          {day.blocks.length > 0 ? <span className="block">{day.blocks.join(" · ")}</span> : null}
                          {day.state === "skipped" && day.skipReason ? <span className="block">{`Reason: ${day.skipReason}`}</span> : null}
                        </>
                      }
                      trailing={<StatusText tone={state.tone}>{state.label}</StatusText>}
                      data-day={day.date}
                      data-state={day.state}
                    />
                  )
                })}
              </List>
            )}
          </Section>
        }
        side={
          <Section title="Attendance" hint="Marked by the coach at training." meta={attendance && attendance.length > 0 ? `${attended} of ${attendance.length} attended` : undefined}>
            {!attendance ? (
              <SkeletonRows rows={4} />
            ) : attendance.length === 0 ? (
              <EmptyState title="No attendance marked yet" body="When the coach takes the register, each day shows here." />
            ) : (
              <List aria-label="Attendance">
                {attendance.slice(0, 12).map((row) => (
                  <ListRow key={row.date} title={shortDay(row.date)} subtitle={row.reason ?? undefined} trailing={<StatusText tone={attendanceTone(row.status)}>{attendanceLabel(row.status)}</StatusText>} data-attendance={row.status} />
                ))}
              </List>
            )}
          </Section>
        }
      />
    </Screen>
  )
}

/** This week's plan for the athlete a guardian follows, day by day, with what was done or skipped. Read only. */
export default function GuardianPlanPage() {
  return <GuardianChildScreen title="Plan">{(child) => <ChildPlan child={child} />}</GuardianChildScreen>
}
