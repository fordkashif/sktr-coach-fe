"use client"

import { useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { ArrowRight, Check, PencilSimple, Plus } from "@phosphor-icons/react"
import { AvailabilityDialog, AvailabilityNotice, useMyAvailability } from "@/components/athlete/availability"
import {
  AddExerciseDialog,
  DayNav,
  EFFORT_WORDS,
  ExerciseLog,
  formatLongDay,
  LoggedSummary,
  LogProgress,
  SkipDialog,
  SyncStatus,
} from "@/components/athlete/log/log-parts"
import { ClockBar, useLogClock, type RestSuggestion } from "@/components/athlete/log/log-clock"
import { MyAttendanceLine, SessionEnteredBy } from "@/components/athlete/log/log-extras"
import { SessionMediaSection, exerciseMedia, rowLabels, useSessionMedia } from "@/components/athlete/log/session-media"
import { setCount, useSessionLog } from "@/components/athlete/log/use-session-log"
import {
  ActionBar,
  Button,
  EffortScale,
  EmptyState,
  Field,
  InlineConfirm,
  Input,
  LinkButton,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  SetList,
  SkeletonRows,
  Stat,
  StatStrip,
  StatusText,
  Textarea,
  notify,
  notifyError,
} from "@/components/sk"
import { DEFAULT_REST_SECONDS, nextOpenTimeSet, restSecondsForRow } from "@/lib/data/session/log-assist"
import { MAX_SETS, logKindForBlockType } from "@/lib/data/session/session-from-plan"
import { skipReasonLabel, skippedLabel } from "@/lib/data/session/types"
import { todayIso } from "@/lib/data/training-plan/plan-builder-model"
import { useUndoableDelete } from "@/lib/use-undoable-delete"

const HOME_REDIRECT_MS = 1800

function isIsoDay(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()))
}

export default function AthleteLogPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const today = todayIso()
  const dateParam = searchParams.get("date")
  const date = isIsoDay(dateParam) ? dateParam : today
  const sessionParam = searchParams.get("session")
  const log = useSessionLog(date, sessionParam)
  const availability = useMyAvailability()
  const { day, session, sync, totals } = log
  const [editing, setEditing] = useState(false)
  const [justFinished, setJustFinished] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [logAnyway, setLogAnyway] = useState(false)
  const [skipOpen, setSkipOpen] = useState(false)
  const [exerciseOpen, setExerciseOpen] = useState(false)
  const [availabilityOpen, setAvailabilityOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  // True while a removed extra session waits on "Undo".
  const [removing, setRemoving] = useState(false)
  const undoableDelete = useUndoableDelete()
  const [busy, setBusy] = useState(false)
  const clock = useLogClock()
  // Photos and videos. They upload on their own while the athlete keeps logging.
  const media = useSessionMedia(session?.id ?? null)
  const mediaLabels = useMemo(() => rowLabels(session?.blocks ?? []), [session?.blocks])
  const [rest, setRest] = useState<RestSuggestion>({ seconds: DEFAULT_REST_SECONDS, prescribed: false, label: null })
  // The timed exercise the athlete last touched: where a stopwatch time goes.
  const [timedRowId, setTimedRowId] = useState<string | null>(null)

  const timedRows = useMemo(() => (session?.blocks ?? []).flatMap((block) => block.rows.filter((row) => row.kind === "time")), [session?.blocks])
  const shownCount = (row: (typeof timedRows)[number]) => Math.min(setCount(row, log.logs) + (log.extraSets[row.id] ?? 0), MAX_SETS)
  const stopwatchRowId = clock.clock.mode === "stopwatch" ? clock.clock.rowId : null
  const stopwatchRow = (() => {
    const preferred = timedRows.find((row) => row.id === (stopwatchRowId ?? timedRowId))
    if (preferred) return preferred
    // Nothing picked: the first timed exercise that still has a rep with no time.
    return timedRows.find((row) => nextOpenTimeSet(row.id, log.logs, shownCount(row), shownCount(row)) !== null) ?? timedRows[0] ?? null
  })()
  const stopwatchSet = stopwatchRow ? nextOpenTimeSet(stopwatchRow.id, log.logs, shownCount(stopwatchRow), MAX_SETS) : null

  useEffect(() => {
    setEditing(false)
    setJustFinished(false)
    setLogAnyway(false)
    setConfirmRemove(false)
  }, [date, sessionParam])

  // After finishing, the athlete lands back on home once everything is safely saved.
  useEffect(() => {
    if (!justFinished || sync.status !== "saved") return
    const timer = window.setTimeout(() => navigate("/athlete/home"), HOME_REDIRECT_MS)
    return () => window.clearTimeout(timer)
  }, [justFinished, navigate, sync.status])

  const selectDate = (next: string) => {
    setSearchParams(next === today ? {} : { date: next }, { replace: true })
  }
  const dayPath = (target: string, sessionId?: string) => {
    const params = new URLSearchParams()
    if (target !== today) params.set("date", target)
    if (sessionId) params.set("session", sessionId)
    const query = params.toString()
    return query ? `/athlete/log?${query}` : "/athlete/log"
  }

  const isExtra = session?.origin === "athlete"
  const completed = session?.status === "completed"
  const skipped = session?.status === "skipped"
  // Unavailable on this day: the session is excused. The athlete can still choose to log it.
  const excusedHold = Boolean(session) && !isExtra && Boolean(day?.excused) && !completed && !skipped && session?.status !== "in-progress" && !logAnyway
  const showForm = Boolean(session) && !skipped && !excusedHold && (!completed || editing)
  const dayLabel = date === today ? "Today" : formatLongDay(date)
  const meta = session
    ? [isExtra ? "Added by you" : null, session.estimatedDurationMinutes ? `${session.estimatedDurationMinutes} min` : null, session.location].filter(Boolean).join(", ")
    : null

  const handleFinish = async () => {
    setFinishing(true)
    const wasEditing = editing
    await log.finish()
    setFinishing(false)
    setEditing(false)
    if (!wasEditing) setJustFinished(true)
    // The shell scrolls inside main, not the window.
    document.getElementById("main-content")?.scrollTo({ top: 0 })
    window.scrollTo({ top: 0 })
  }

  const handleUnskip = async () => {
    setBusy(true)
    const result = await log.unskip()
    setBusy(false)
    if (!result.ok) notifyError("Could not undo the skip", result.error.message)
  }

  // The session leaves the screen at once. The delete is sent when "Undo" runs out.
  const handleRemove = () => {
    setConfirmRemove(false)
    undoableDelete({
      message: "Session removed",
      failed: "Could not remove the session",
      hide: () => setRemoving(true),
      restore: () => setRemoving(false),
      commit: () => log.removeExtraSession(),
      done: () => {
        setRemoving(false)
        navigate(dayPath(date), { replace: true })
      },
    })
  }

  const title = !day
    ? "Session log"
    : session
      ? session.title
      : day.inPlan
        ? "Rest day"
        : date === today
          ? "No session today"
          : "No session"

  const lede = !day
    ? null
    : session
      ? meta || null
      : day.inPlan
        ? `${dayLabel} is a rest day in your plan. Recover well.`
        : date === today
          ? "Nothing is planned for you today."
          : `Nothing is planned for ${formatLongDay(date)}.`

  if (removing) {
    return (
      <Screen width="narrow">
        <ScreenHeader fact={formatLongDay(date)} title="Session removed" lede="Changed your mind? Use Undo in the next few seconds to keep it." variant="top" />
      </Screen>
    )
  }

  return (
    <Screen width="narrow">
      <ScreenHeader
        fact={date === today ? `Today, ${formatLongDay(date)}` : formatLongDay(date)}
        title={title}
        lede={lede}
        variant="top"
        back={isExtra || sessionParam ? { to: dayPath(date), label: date === today ? "Today's log" : "Back to the day" } : undefined}
      />

      <AvailabilityNotice current={availability.current} />

      {day && !sessionParam ? <DayNav week={day.week} selected={date} today={today} onSelect={selectDate} /> : null}

      {/* Taken or entered by a coach (attendance, a session logged for the athlete). Read only here. */}
      {day ? <MyAttendanceLine date={date} /> : null}
      {session ? <SessionEnteredBy sessionId={session.id} /> : null}

      {!day && !log.loadError ? <SkeletonRows rows={5} label="Getting your session" /> : null}

      {log.loadError ? (
        <Notice
          tone="error"
          action={
            <Button size="sm" onClick={log.reload}>
              Try again
            </Button>
          }
        >
          Could not load this session. {log.loadError}
        </Notice>
      ) : null}

      {log.fromCache ? (
        <Notice tone="warning">You are offline, so this is the copy saved on this phone. Keep logging. It sends when you are back online.</Notice>
      ) : null}

      {day && !session ? (
        <Section aria-label="Next up">
          <EmptyState
            title={day.next ? `Next up is ${day.next.title}` : day.inPlan ? "No more sessions in your plan" : "No plan yet"}
            body={
              day.next
                ? `Planned for ${formatLongDay(day.next.date)}.`
                : day.inPlan
                  ? "You have reached the end of the sessions your coach has planned."
                  : "Sessions show up here as soon as your coach publishes a training plan for you."
            }
            action={
              day.next ? (
                <Button size="sm" onClick={() => selectDate(day.next?.date ?? today)}>
                  See that session
                  <ArrowRight className="size-4" weight="bold" aria-hidden />
                </Button>
              ) : (
                <LinkButton size="sm" to="/athlete/training-plan">
                  Open your plan
                </LinkButton>
              )
            }
          />
        </Section>
      ) : null}

      {session && skipped ? (
        <Section title="You skipped this one" aria-label="Skipped session">
          <List>
            <ListRow title={<StatusText tone="neutral">{skippedLabel(session.skipReason)}</StatusText>} subtitle={session.skipNote ?? "It does not count as missed. Your coach can see the reason."} />
          </List>
          <EmptyState
            title="Did it after all?"
            body="Undo the skip and log it like any other session."
            action={
              <Button size="sm" disabled={busy} onClick={() => void handleUnskip()}>
                {busy ? "Saving..." : "Undo skip and log it"}
              </Button>
            }
          />
        </Section>
      ) : null}

      {session && excusedHold ? (
        <Section title="This session is excused" aria-label="Excused session">
          <EmptyState
            title="You are marked as unavailable on this day."
            body="You do not need to do anything. If you trained anyway, log it and it counts."
            action={
              <Button size="sm" onClick={() => setLogAnyway(true)}>
                Log anyway
              </Button>
            }
          />
        </Section>
      ) : null}

      {session && completed && !editing ? (
        <>
          {justFinished ? (
            <Notice
              tone="success"
              action={
                <LinkButton size="sm" variant="quiet" to="/athlete/home">
                  Back to home
                </LinkButton>
              }
            >
              Nice work. That is logged.{" "}
              {sync.status === "saved" ? "Your coach can see it now. Taking you home." : "It is safe on this phone and will reach your coach when it sends."}
            </Notice>
          ) : null}

          <StatStrip aria-label="Session summary">
            <Stat label="Session done" value={totals.done} of={totals.total} hint={totals.total === 1 ? "item ticked" : "sets ticked"} />
            <Stat
              label="Effort"
              value={session.overallRpe ?? "None"}
              of={session.overallRpe ? 10 : undefined}
              hint={session.overallRpe ? EFFORT_WORDS[session.overallRpe] : "Not rated"}
            />
            <Stat label="Time" value={session.durationMinutes ?? "None"} unit={session.durationMinutes ? "min" : undefined} hint={session.durationMinutes ? undefined : "Not given"} />
          </StatStrip>

          <Section
            title="What you logged"
            hint={session.completedOn ? `Finished ${formatLongDay(session.completedOn)}` : undefined}
            action={
              <Button variant="quiet" size="sm" onClick={() => setEditing(true)}>
                <PencilSimple className="size-4" weight="bold" aria-hidden />
                Edit
              </Button>
            }
          >
            {totals.total > 0 ? <LoggedSummary blocks={session.blocks} logs={log.logs} /> : <p className="py-3.5 text-sk-mute">No exercises were logged for this session.</p>}
          </Section>

          <SessionMediaSection media={media} mode="read" labels={mediaLabels} />

          {session.athleteComment ? (
            <Section title="Your comment">
              <p className="pt-1 text-base leading-relaxed text-sk-ink">{session.athleteComment}</p>
            </Section>
          ) : null}
        </>
      ) : null}

      {session && showForm ? (
        <>
          {date !== today && !completed && !isExtra ? (
            <Notice>
              {date < today
                ? `This was planned for ${formatLongDay(date)}. You can still log it.`
                : `This is planned for ${formatLongDay(date)}. Log it now if you are doing it early.`}
            </Notice>
          ) : null}

          {session.coachNote ? (
            <Section title="From your coach">
              <p className="pt-1 text-base leading-relaxed text-sk-ink">{session.coachNote}</p>
            </Section>
          ) : null}

          {session.blocks.length === 0 ? <Notice>Your coach has not added any detail to this session. You can still finish it below.</Notice> : null}

          {session.blocks.map((block) => (
            <Section
              key={block.id}
              title={isExtra ? "Exercises" : block.name}
              hint={[block.focus, block.coachNote].filter(Boolean).join(" ") || undefined}
              action={
                isExtra && block.rows.length > 0 ? (
                  <Button variant="quiet" size="sm" onClick={() => setExerciseOpen(true)}>
                    <Plus className="size-4" weight="bold" aria-hidden />
                    Add exercise
                  </Button>
                ) : undefined
              }
            >
              {block.rows.length > 0 ? (
                <SetList>
                  {block.rows.map((row) => {
                    const count = Math.min(setCount(row, log.logs) + (log.extraSets[row.id] ?? 0), MAX_SETS)
                    return (
                      <ExerciseLog
                        key={row.id}
                        row={row}
                        logs={log.logs}
                        count={count}
                        lastTime={log.lastTime(row)}
                        onToggle={(setIndex) => {
                          log.toggleSet(row, setIndex)
                          // The rest button in the bar now offers what the coach set for this exercise.
                          setRest({ ...restSecondsForRow([row.helper, row.target, block.restLabel, block.coachNote]), label: row.label })
                          if (row.kind === "time") setTimedRowId(row.id)
                        }}
                        onValue={(setIndex, field, value) => {
                          log.setValue(row, setIndex, field, value)
                          if (row.kind === "time") setTimedRowId(row.id)
                        }}
                        onEffort={(setIndex, rpe) => log.setEffort(row, setIndex, rpe)}
                        onNote={(text) => log.setRowNote(row, text)}
                        onFill={() => log.fillRowFromTarget(row)}
                        onRepeat={() => log.repeatLastSet(row, count)}
                        onRepeatLast={() => {
                          log.repeatLastTime(row, count)
                          setRest({ ...restSecondsForRow([row.helper, row.target, block.restLabel, block.coachNote]), label: row.label })
                        }}
                        onAddSet={() => log.addSet(row)}
                        onStopwatch={() => {
                          setTimedRowId(row.id)
                          clock.openStopwatch(row.id)
                        }}
                        hideLabel={block.rows.length === 1 && row.kind === "check" && row.label === block.name}
                        media={exerciseMedia(media, row)}
                      />
                    )
                  })}
                </SetList>
              ) : (
                <EmptyState
                  title="Add what you did"
                  body="One exercise at a time: its name, then the sets, reps, times or marks."
                  action={
                    <Button size="sm" onClick={() => setExerciseOpen(true)}>
                      <Plus className="size-4" weight="bold" aria-hidden />
                      Add exercise
                    </Button>
                  }
                />
              )}
            </Section>
          ))}

          <SessionMediaSection media={media} mode="log" labels={mediaLabels} />

          <Section title="How hard was it?" hint="1 is very easy, 10 is everything you had.">
            <EffortScale className="mt-2" label="Effort from 1 to 10" words={EFFORT_WORDS} value={log.wrapUp.rpe} onChange={(rpe) => log.updateWrapUp({ rpe })} />
            {/* Prefilled from the plan, so when that is right there is nothing to do. Effort x minutes is the session's load. */}
            <Field
              label="How long did it take?"
              className="mt-4"
              hint={
                session.estimatedDurationMinutes
                  ? `In minutes. Your coach planned ${session.estimatedDurationMinutes}. Change it if it ran longer or shorter.`
                  : "In minutes, warm up to cool down. Leave it empty if you are not sure."
              }
            >
              <Input
                inputMode="numeric"
                autoComplete="off"
                className="max-w-[8rem]"
                placeholder="Minutes"
                value={log.wrapUp.minutes ?? ""}
                onChange={(event) => log.updateWrapUp({ minutes: event.target.value.replace(/[^0-9]/g, "").slice(0, 3) })}
              />
            </Field>
            <Field label="Anything your coach should know?" optional className="mt-2">
              <Textarea
                rows={3}
                maxLength={1000}
                value={log.wrapUp.comment}
                onChange={(event) => log.updateWrapUp({ comment: event.target.value })}
                placeholder="How it felt, niggles, what you changed"
              />
            </Field>
            <Button variant="primary" size="lg" block className="mt-5" disabled={finishing} onClick={() => void handleFinish()}>
              <Check className="size-5" weight="bold" aria-hidden />
              {completed ? "Save changes" : "Finish session"}
            </Button>
            {!completed && totals.total > 0 && totals.done < totals.total ? (
              <p className="mt-2 text-center text-sm text-sk-mute">
                {totals.done} of {totals.total} ticked. You can finish with some left.
              </p>
            ) : null}
            {completed ? (
              <Button variant="quiet" block className="mt-2" onClick={() => setEditing(false)}>
                Back to summary
              </Button>
            ) : null}
          </Section>
        </>
      ) : null}

      {day && day.others.length > 0 ? (
        <Section title="Also on this day">
          <List>
            {day.others.map((other) => (
              <ListRow
                key={other.id}
                to={dayPath(date, other.origin === "athlete" ? other.id : undefined)}
                title={other.title}
                subtitle={other.origin === "athlete" ? "Added by you" : "From your plan"}
                trailing={
                  other.status === "completed" ? (
                    <StatusText tone="green">Done</StatusText>
                  ) : other.status === "skipped" ? (
                    <StatusText tone="neutral">Skipped</StatusText>
                  ) : other.status === "in-progress" ? (
                    <StatusText tone="blue">Started</StatusText>
                  ) : undefined
                }
              />
            ))}
          </List>
        </Section>
      ) : null}

      {day ? (
        <Section title="More">
          {confirmRemove ? (
            <InlineConfirm
              question="Remove this session and everything logged in it?"
              confirmLabel="Remove session"
              busy={busy}
              onConfirm={handleRemove}
              onCancel={() => setConfirmRemove(false)}
            />
          ) : null}
          <List>
            {session && !isExtra && !completed && !skipped && !excusedHold ? (
              <ListRow onClick={() => setSkipOpen(true)} chevron title="Can't do this one" subtitle="Skip it with a reason. It will not count as missed." />
            ) : null}
            {session && isExtra && !confirmRemove ? (
              <ListRow onClick={() => setConfirmRemove(true)} chevron title="Remove this session" subtitle="For a session you added by mistake." />
            ) : null}
            <ListRow to="/athlete/log/new" title="Add a session" subtitle="Log something that was not in your plan." />
            <ListRow to="/athlete/history" title="Session history" subtitle="What you did, skipped and missed." />
            {!availability.current ? (
              <ListRow onClick={() => setAvailabilityOpen(true)} chevron title="I can't train for a while" subtitle="Injured, sick or away. Your coach is told." />
            ) : null}
          </List>
        </Section>
      ) : null}

      {session && (showForm || (completed && !editing && sync.status !== "saved")) ? (
        <ActionBar aria-label="Progress and timer">
          <div className="flex min-w-0 flex-1 flex-col">
            {showForm ? (
              <ClockBar
                control={clock}
                suggestion={rest}
                showStopwatch={timedRows.length > 0}
                target={stopwatchRow && stopwatchSet ? { rowLabel: stopwatchRow.label, setIndex: stopwatchSet } : null}
                onUseTime={(seconds) => {
                  if (!stopwatchRow || !stopwatchSet) return
                  if (stopwatchSet > shownCount(stopwatchRow)) log.addSet(stopwatchRow)
                  log.setValue(stopwatchRow, stopwatchSet, "timeSeconds", seconds)
                  setRest({ ...restSecondsForRow([stopwatchRow.helper, stopwatchRow.target]), label: stopwatchRow.label })
                }}
              />
            ) : null}
            <div className="flex min-h-11 items-center justify-between gap-4">
              {showForm ? <LogProgress done={totals.done} total={totals.total} /> : <p className="min-w-0 flex-1 text-sm font-bold text-sk-ink">Session done</p>}
              <SyncStatus sync={sync} onRetry={log.retrySync} className="shrink-0" />
            </div>
          </div>
        </ActionBar>
      ) : null}

      {session ? (
        <>
          <SkipDialog
            open={skipOpen}
            onOpenChange={setSkipOpen}
            sessionTitle={session.title}
            onSkip={async (reason, note) => {
              const result = await log.skip(reason, note)
              if (result.ok) notify("Session skipped", `Reason: ${skipReasonLabel(reason).toLowerCase()}.`)
              return result
            }}
          />
          <AddExerciseDialog
            open={exerciseOpen}
            onOpenChange={setExerciseOpen}
            defaultKind={session.blocks[0] ? logKindForBlockType(session.blocks[0].blockType) : "strength"}
            onAdd={log.addExercise}
          />
        </>
      ) : null}
      <AvailabilityDialog open={availabilityOpen} onOpenChange={setAvailabilityOpen} />
    </Screen>
  )
}
