import { useMemo, useState } from "react"
import { Check } from "@phosphor-icons/react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { EFFORT_WORDS, ExerciseLog, LogProgress } from "@/components/athlete/log/log-parts"
import { SessionMediaSection, exerciseMedia, rowLabels, useSessionMedia } from "@/components/athlete/log/session-media"
import { setCount } from "@/components/athlete/log/use-session-log"
import { useCoachSessionLog } from "@/components/coach/athlete-log/use-coach-session-log"
import {
  ActionBar,
  Button,
  EffortScale,
  EmptyState,
  Field,
  FormGrid,
  Input,
  LinkButton,
  Notice,
  Screen,
  ScreenHeader,
  ScreenSkeleton,
  Section,
  SetList,
  SkeletonRows,
  StatusText,
  Textarea,
  notify,
} from "@/components/sk"
import { useCoachPermissions, useCoachTeamScope } from "@/lib/coach-teams"
import { loggedByLabel } from "@/lib/data/coach/attendance"
import { MAX_SETS } from "@/lib/data/session/session-from-plan"
import { skippedLabel } from "@/lib/data/session/types"
import { todayIso } from "@/lib/data/training-plan/plan-builder-model"

function isIsoDay(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()))
}

function longDay(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
}

export default function CoachLogForAthletePage() {
  const { athleteId = "" } = useParams()
  const { coachTeamsLoading } = useCoachTeamScope()
  if (coachTeamsLoading) return <ScreenSkeleton />
  // One screen per athlete in the address, so nothing typed for one athlete is ever shown for another.
  return <CoachLogForAthlete key={athleteId} athleteId={athleteId} />
}

/** A coach or club admin entering an athlete's session for them, on the same parts the athlete logs with. */
function CoachLogForAthlete({ athleteId }: { athleteId: string }) {
  // An assistant coach logs sessions and does not build plans, so they are not sent to the plan builder.
  const permissions = useCoachPermissions()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const today = todayIso()
  const dateParam = searchParams.get("date")
  const date = isIsoDay(dateParam) && dateParam <= today ? dateParam : today
  const fromAttendance = searchParams.get("from") === "attendance"
  const log = useCoachSessionLog(athleteId, date)
  const { day, session, save, totals } = log
  const [finishing, setFinishing] = useState(false)
  // A coach adds a photo or video for the athlete only here, while logging their session for them.
  const media = useSessionMedia(session?.id ?? null, { athleteId })
  const mediaLabels = useMemo(() => rowLabels(session?.blocks ?? []), [session?.blocks])

  const athlete = day?.athlete ?? null
  const first = athlete ? athlete.name.split(" ")[0] || athlete.name : "the athlete"
  const athletePath = `/coach/athletes/${athleteId}`
  const back =
    fromAttendance && athlete?.teamId
      ? { to: `/coach/teams/${athlete.teamId}/attendance${date === today ? "" : `?date=${date}`}`, label: "Attendance" }
      : { to: athletePath, label: athlete?.name ?? "Athlete" }

  const setDate = (next: string) => {
    if (!isIsoDay(next) || next > today) return
    const params = new URLSearchParams(searchParams)
    if (next === today) params.delete("date")
    else params.set("date", next)
    setSearchParams(params, { replace: true })
  }

  const handleFinish = async () => {
    setFinishing(true)
    const wasCompleted = session?.status === "completed"
    const done = await log.finish()
    setFinishing(false)
    if (!done) return
    notify(wasCompleted ? `Changes saved for ${first}` : `Session logged for ${first}`, athlete?.hasLogin ? `${first} sees it as logged by you and can still edit it.` : undefined)
    navigate(back.to)
  }

  if (log.loadError && !day) {
    return (
      <Screen width="narrow">
        <ScreenHeader
          back={{ to: athletePath, label: "Athlete" }}
          title={log.loadError.notFound ? "Athlete not found" : "Log a session"}
          lede={log.loadError.notFound ? "This athlete is not on a team you coach, or does not exist in your SKTR Coach workspace." : undefined}
        />
        {log.loadError.notFound ? null : (
          <Notice
            tone="error"
            action={
              <Button size="sm" onClick={log.reload}>
                Try again
              </Button>
            }
          >
            Could not load this session: {log.loadError.message}
          </Notice>
        )}
      </Screen>
    )
  }

  const completed = session?.status === "completed"
  const meta = session ? [session.estimatedDurationMinutes ? `${session.estimatedDurationMinutes} min` : null, session.location].filter(Boolean).join(", ") : null

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={back}
        fact={date === today ? `Today, ${longDay(date)}` : longDay(date)}
        title={!day ? "Log a session" : session ? session.title : "No session"}
        lede={!day ? "Getting the session..." : session ? meta || null : `Nothing is planned for ${first} on this day.`}
      />

      {athlete ? (
        <div data-logging-for={athlete.id}>
          <Notice>
            Logging for {athlete.name}
            <span className="mt-0.5 block font-normal">
              {athlete.hasLogin
                ? `It goes into ${first}'s own log, marked as entered by you. ${first} can still change it.`
                : `${first} has no login, so you keep their log. It is marked as entered by you.`}
            </span>
          </Notice>
        </div>
      ) : null}

      <FormGrid>
        <Field label="Day" hint="Today or any day before it.">
          <Input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} />
        </Field>
      </FormGrid>

      {!day ? <SkeletonRows rows={5} label="Getting the session" /> : null}

      {day && !session ? (
        <Section aria-label="No session">
          <EmptyState
            title={`No session for ${first} on this day`}
            body="Pick another day above. Sessions come from the training plan published to their team."
            action={
              permissions.canEditPlans ? (
                <LinkButton size="sm" to="/coach/training-plan">
                  Open plans
                </LinkButton>
              ) : undefined
            }
          />
        </Section>
      ) : null}

      {session ? (
        <>
          {session.status === "skipped" ? (
            <Notice tone="warning">
              {first} skipped this session ({skippedLabel(session.skipReason).toLowerCase().replace(/^skipped: /, "")}). Finishing it here marks it as done after all.
            </Notice>
          ) : null}
          {completed ? (
            <Notice tone="success">
              {day?.loggedBy ? `${loggedByLabel(day.loggedBy.name, day.loggedBy.role)}.` : `${first} logged this session.`} What you change here changes their log.
            </Notice>
          ) : null}

          {session.blocks.length === 0 ? <Notice>This session has no exercises in the plan. You can still mark it done below.</Notice> : null}

          {session.blocks.map((block) => (
            <Section key={block.id} title={block.name} hint={[block.focus, block.coachNote].filter(Boolean).join(" ") || undefined}>
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
                        lastTime={null}
                        onToggle={(setIndex) => log.toggleSet(row, setIndex)}
                        onValue={(setIndex, field, value) => log.setValue(row, setIndex, field, value)}
                        onEffort={(setIndex, rpe) => log.setEffort(row, setIndex, rpe)}
                        onNote={(text) => log.setRowNote(row, text)}
                        onFill={() => log.fillRowFromTarget(row)}
                        onRepeat={() => log.repeatLastSet(row, count)}
                        onRepeatLast={() => undefined}
                        onAddSet={() => log.addSet(row)}
                        hideLabel={block.rows.length === 1 && row.kind === "check" && row.label === block.name}
                        media={exerciseMedia(media, row, true)}
                      />
                    )
                  })}
                </SetList>
              ) : (
                <p className="py-2 text-[0.9375rem] text-sk-mute">Nothing to log in this part.</p>
              )}
            </Section>
          ))}

          <SessionMediaSection media={media} mode="log" labels={mediaLabels} hint={`Add a photo or video of ${first} to their log.`} staff />

          <Section title="How hard was it?" hint={`Ask ${first}, or leave it empty. 1 is very easy, 10 is everything they had.`}>
            <EffortScale className="mt-2" label="Effort from 1 to 10" words={EFFORT_WORDS} value={log.wrapUp.rpe} onChange={(rpe) => log.updateWrapUp({ rpe })} />
            <Field label="How long did it take?" hint="In minutes. With the effort it gives the session's load. Leave it empty if you do not know." className="mt-4">
              <Input
                inputMode="numeric"
                autoComplete="off"
                className="max-w-[8rem]"
                placeholder="Minutes"
                value={log.wrapUp.minutes}
                onChange={(event) => log.updateWrapUp({ minutes: event.target.value.replace(/[^0-9]/g, "").slice(0, 3) })}
              />
            </Field>
            <Field label="Comment" optional hint={`Saved as the comment on ${first}'s session.`} className="mt-2">
              <Textarea rows={3} maxLength={1000} value={log.wrapUp.comment} onChange={(event) => log.updateWrapUp({ comment: event.target.value })} />
            </Field>
            {save.status === "error" ? (
              <Notice
                tone="error"
                className="mt-4"
                action={
                  <Button size="sm" onClick={log.retry}>
                    Try again
                  </Button>
                }
              >
                Not saved: {save.message}
              </Notice>
            ) : null}
            <Button variant="primary" size="lg" block className="mt-5" disabled={finishing} onClick={() => void handleFinish()}>
              <Check className="size-5" weight="bold" aria-hidden />
              {finishing ? "Saving..." : completed ? "Save changes" : `Finish session for ${first}`}
            </Button>
            {!completed && totals.total > 0 && totals.done < totals.total ? (
              <p className="mt-2 text-center text-sm text-sk-mute">
                {totals.done} of {totals.total} ticked. You can finish with some left.
              </p>
            ) : null}
          </Section>

          <ActionBar aria-label="Progress">
            <LogProgress done={totals.done} total={totals.total} />
            <div role="status" aria-live="polite" data-coach-log-save={save.status} className="shrink-0 text-sm">
              {save.status === "saved" ? (
                <StatusText tone="green">Saved</StatusText>
              ) : save.status === "saving" ? (
                <StatusText tone="neutral">Saving</StatusText>
              ) : save.status === "error" ? (
                <StatusText tone="coral">Not saved</StatusText>
              ) : null}
            </div>
          </ActionBar>
        </>
      ) : null}
    </Screen>
  )
}
