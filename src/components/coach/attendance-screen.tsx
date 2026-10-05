"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { PersonAvatar } from "@/components/account/person-avatar"
import {
  ActionRow,
  Button,
  EmptyState,
  Field,
  Input,
  LinkButton,
  List,
  Notice,
  QuickPick,
  SaveState,
  Screen,
  ScreenHeader,
  Section,
  SkeletonRows,
  notify,
  notifyError,
  type SaveStateValue,
} from "@/components/sk"
import { describeAvailability } from "@/lib/data/athlete/availability-data"
import {
  ATTENDANCE_REASON_MAX,
  ATTENDANCE_STATUSES,
  attendanceCounts,
  attendanceSummaryText,
  cleanAttendanceReason,
  defaultAttendance,
  markAllStatus,
  type AttendanceStatus,
} from "@/lib/data/coach/attendance"
import { clearAttendanceMark, getTeamAttendanceDay, saveAttendanceMark, type AttendanceDayRow, type TeamAttendanceDay } from "@/lib/data/coach/attendance-data"
import { skippedLabel } from "@/lib/data/session/types"
import { addDaysIso, todayIso } from "@/lib/data/training-plan/plan-builder-model"

function isIsoDay(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()))
}

function longDay(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
}

function sentenceCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** What the line under the name says: unavailable first, then what happened to their session. */
function rowDetail(row: AttendanceDayRow, date: string) {
  const parts: string[] = []
  if (row.period) parts.push(sentenceCase(describeAvailability(row.period, date)))
  if (row.session?.status === "completed") parts.push("Session logged")
  else if (row.session?.status === "skipped") parts.push(skippedLabel(row.session.skipReason))
  else if (row.session?.status === "in-progress") parts.push("Session started")
  if (!row.hasLogin) parts.push("No login")
  if (row.period && !row.record) parts.push("Excused unless you change it")
  return parts.join(". ")
}

/**
 * Attendance of one team for one day, taken in one screen: tap a state per athlete, or mark
 * everyone present and adjust. Every tap saves. Athletes who are injured, sick or away that day
 * start as excused.
 */
export function AttendanceScreen({ teamId, teamName }: { teamId: string; teamName?: string | null }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const today = todayIso()
  const dateParam = searchParams.get("date")
  const date = isIsoDay(dateParam) && dateParam <= today ? dateParam : today
  const [day, setDay] = useState<TeamAttendanceDay | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveStateValue>("idle")
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({})
  const [markingAll, setMarkingAll] = useState(false)
  const inFlight = useRef(0)

  const load = useCallback(async () => {
    const result = await getTeamAttendanceDay(teamId, date)
    if (!result.ok) {
      setLoadError(result.error.message)
      return
    }
    setLoadError(null)
    setDay(result.data)
    setReasonDraft(Object.fromEntries(result.data.rows.map((row) => [row.athleteId, row.record?.reason ?? ""])))
  }, [date, teamId])

  useEffect(() => {
    setDay(null)
    setSaveState("idle")
    void load()
  }, [load])

  const setDate = (next: string) => {
    if (!isIsoDay(next) || next > today) return
    setSearchParams(next === today ? {} : { date: next }, { replace: true })
  }

  /** Saves one mark and puts the answer in the list. Returns false when the save was refused. */
  const save = useCallback(
    async (row: AttendanceDayRow, status: AttendanceStatus, reason: string | null) => {
      const previous = row.record
      inFlight.current += 1
      setSaveState("saving")
      // Shown at once; put back if the save fails.
      setDay((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((item) =>
                item.athleteId === row.athleteId
                  ? { ...item, record: { id: previous?.id ?? "pending", teamId, athleteId: row.athleteId, date, sessionId: row.session?.id ?? null, status, reason } }
                  : item,
              ),
            }
          : current,
      )
      const result = await saveAttendanceMark({ teamId, athleteId: row.athleteId, date, status, reason, sessionId: row.session?.id ?? null })
      inFlight.current -= 1
      setDay((current) =>
        current ? { ...current, rows: current.rows.map((item) => (item.athleteId === row.athleteId ? { ...item, record: result.ok ? result.data : previous } : item)) } : current,
      )
      if (!result.ok) {
        setSaveState("error")
        notifyError(`Could not save ${row.name}`, result.error.message)
        return false
      }
      if (inFlight.current === 0) setSaveState("saved")
      return true
    },
    [date, teamId],
  )

  const choose = (row: AttendanceDayRow, status: AttendanceStatus) => {
    // An unavailable athlete keeps "Injured" as the reason while they stay excused; a typed reason always stays.
    const typed = cleanAttendanceReason(reasonDraft[row.athleteId])
    const fallback = status === "excused" ? defaultAttendance(row.period).reason : null
    const reason = status === "present" ? null : (typed ?? fallback)
    setReasonDraft((current) => ({ ...current, [row.athleteId]: reason ?? "" }))
    void save(row, status, reason)
  }

  const saveReason = (row: AttendanceDayRow) => {
    if (!row.record) return
    const reason = cleanAttendanceReason(reasonDraft[row.athleteId])
    if (reason === row.record.reason) return
    void save(row, row.record.status, reason)
  }

  const clear = async (row: AttendanceDayRow) => {
    setSaveState("saving")
    const result = await clearAttendanceMark(teamId, row.athleteId, date)
    if (!result.ok) {
      setSaveState("error")
      notifyError(`Could not clear ${row.name}`, result.error.message)
      return
    }
    setDay((current) => (current ? { ...current, rows: current.rows.map((item) => (item.athleteId === row.athleteId ? { ...item, record: null } : item)) } : current))
    setReasonDraft((current) => ({ ...current, [row.athleteId]: "" }))
    setSaveState("saved")
  }

  const rows = useMemo(() => day?.rows ?? [], [day])
  const unmarked = rows.filter((row) => !row.record)
  const marked = rows.length - unmarked.length
  const summary = attendanceSummaryText(attendanceCounts(rows.flatMap((row) => (row.record ? [row.record] : []))))

  const markAll = async () => {
    setMarkingAll(true)
    let saved = 0
    for (const row of unmarked) {
      const start = markAllStatus(row.period)
      setReasonDraft((current) => ({ ...current, [row.athleteId]: start.reason ?? "" }))
      if (await save(row, start.status, start.reason)) saved += 1
    }
    setMarkingAll(false)
    if (saved > 0) notify(`${saved} ${saved === 1 ? "athlete" : "athletes"} marked`, "Change anyone who was late, absent or excused.")
  }

  const name = day?.team.name ?? teamName ?? "Team"
  const backTo = `/coach/teams/${teamId}`
  const lede = !day
    ? "Getting the roster..."
    : `${date === today ? "Today" : longDay(date)}. ${day.sessionTitle ? day.sessionTitle : "No session planned on this day"}.`

  if (loadError && !day) {
    return (
      <Screen width="narrow">
        <ScreenHeader back={{ to: backTo, label: name }} title="Attendance" />
        <Notice
          tone="error"
          action={
            <Button size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          Could not load attendance: {loadError}
        </Notice>
      </Screen>
    )
  }

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: backTo, label: name }}
        title="Attendance"
        lede={lede}
        actions={
          day && unmarked.length > 0 ? (
            <Button variant="primary" disabled={markingAll} onClick={() => void markAll()}>
              {markingAll ? "Marking..." : "Mark everyone present"}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
        <Field label="Day" className="min-w-0 flex-1 basis-56 sm:max-w-xs">
          <Input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Button size="sm" variant="quiet" onClick={() => setDate(addDaysIso(date, -1))}>
          Day before
        </Button>
        {date < today ? (
          <>
            <Button size="sm" variant="quiet" onClick={() => setDate(addDaysIso(date, 1))}>
              Day after
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setDate(today)}>
              Today
            </Button>
          </>
        ) : null}
      </div>

      <Section
        title="Athletes"
        hint={
          rows.some((row) => row.period)
            ? "Every tap saves. Athletes who are injured, sick or away are excused when you mark everyone."
            : "Every tap saves. Mark everyone present, then change the ones who were not."
        }
        meta={day ? `${marked} of ${rows.length} marked` : undefined}
        action={<SaveState state={saveState} />}
      >
        {!day ? (
          <SkeletonRows rows={6} leading label="Loading the roster" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nobody on this team yet"
            body="Add athletes to the roster first. They show up here the same day."
            action={
              <LinkButton to={backTo} size="sm">
                Open the roster
              </LinkButton>
            }
          />
        ) : (
          <>
            <List aria-label={`Attendance of ${name}`}>
              {rows.map((row) => {
                const start = defaultAttendance(row.period)
                const status = row.record?.status ?? start.status
                const detail = rowDetail(row, date)
                return (
                  <ActionRow
                    key={row.athleteId}
                    data-attendance-row={row.athleteId}
                    data-attendance-status={row.record?.status ?? "none"}
                    leading={<PersonAvatar name={row.name} athleteId={row.athleteId} size="sm" />}
                    title={row.name}
                    subtitle={detail || undefined}
                    to={`/coach/athletes/${row.athleteId}`}
                    actions={
                      row.session ? (
                        <LinkButton size="sm" variant="quiet" to={`/coach/athletes/${row.athleteId}/log?date=${date}&from=attendance`} aria-label={`Log the session for ${row.name}`}>
                          {row.session.status === "completed" ? "Edit log" : "Log session"}
                        </LinkButton>
                      ) : undefined
                    }
                    below={
                      <div className="flex flex-col gap-2">
                        <QuickPick label={`Attendance of ${row.name}`} value={status} onChange={(next) => choose(row, next)} options={ATTENDANCE_STATUSES} />
                        {row.record && row.record.status !== "present" ? (
                          <div className="flex items-center gap-1">
                            <Input
                              className="min-w-0 flex-1"
                              aria-label={`Reason for ${row.name}`}
                              placeholder="Reason (optional)"
                              maxLength={ATTENDANCE_REASON_MAX}
                              enterKeyHint="done"
                              value={reasonDraft[row.athleteId] ?? ""}
                              onChange={(event) => setReasonDraft((current) => ({ ...current, [row.athleteId]: event.target.value }))}
                              onBlur={() => saveReason(row)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur()
                              }}
                            />
                            <Button size="sm" variant="quiet" aria-label={`Clear the mark of ${row.name}`} onClick={() => void clear(row)}>
                              Clear
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    }
                  />
                )
              })}
            </List>
            {summary ? (
              <p className="text-sm text-sk-mute" aria-live="polite" data-attendance-summary>
                {summary}.
              </p>
            ) : null}
          </>
        )}
      </Section>
    </Screen>
  )
}
