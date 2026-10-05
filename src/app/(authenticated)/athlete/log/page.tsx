"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { ArrowRight, CalendarBlank, ChatText, CheckCircle, Moon, PencilSimple } from "@phosphor-icons/react"
import { ExerciseRow, formatLongDay, LoggedSummary, SyncStatus, WeekStrip } from "@/components/athlete/log/log-parts"
import { setCount, useSessionLog } from "@/components/athlete/log/use-session-log"
import { EmptyState, Meter, PageHeader, Panel, Stat } from "@/components/sk"
import { MAX_SETS } from "@/lib/data/session/session-from-plan"
import { todayIso } from "@/lib/data/training-plan/plan-builder-model"
import { cn } from "@/lib/utils"

const EFFORT_WORDS = ["", "Very easy", "Very easy", "Easy", "Easy", "Moderate", "Moderate", "Hard", "Hard", "Very hard", "Max effort"]
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
  const log = useSessionLog(date)
  const { day, session, sync, totals } = log
  const [editing, setEditing] = useState(false)
  const [justFinished, setJustFinished] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const commentId = useId()
  const topRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const flagged = window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }
    flagged.__PACELAB_MOBILE_DETAIL_MODE = true
    window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: true } }))
    const handleBack = () => window.history.back()
    window.addEventListener("pacelab:mobile-detail-back", handleBack)
    return () => {
      flagged.__PACELAB_MOBILE_DETAIL_MODE = false
      window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: false } }))
      window.removeEventListener("pacelab:mobile-detail-back", handleBack)
    }
  }, [])

  useEffect(() => {
    setEditing(false)
    setJustFinished(false)
  }, [date])

  // After finishing, the athlete lands back on home once everything is safely saved.
  useEffect(() => {
    if (!justFinished || sync.status !== "saved") return
    const timer = window.setTimeout(() => navigate("/athlete/home"), HOME_REDIRECT_MS)
    return () => window.clearTimeout(timer)
  }, [justFinished, navigate, sync.status])

  const selectDate = (next: string) => {
    setSearchParams(next === today ? {} : { date: next }, { replace: true })
  }

  const completed = session?.status === "completed"
  const showForm = Boolean(session) && (!completed || editing)
  const dayLabel = date === today ? "Today" : formatLongDay(date)
  const meta = session
    ? [
        date === today ? "Today" : formatLongDay(date),
        session.estimatedDurationMinutes ? `${session.estimatedDurationMinutes} min` : null,
        session.location,
      ]
        .filter(Boolean)
        .join(", ")
    : null

  const handleFinish = async () => {
    setFinishing(true)
    const wasEditing = editing
    await log.finish()
    setFinishing(false)
    setEditing(false)
    if (!wasEditing) setJustFinished(true)
    topRef.current?.scrollIntoView({ block: "start" })
  }

  const title = !day
    ? log.loadError
      ? "Session log"
      : "Loading"
    : session
      ? session.title
      : day.inPlan
        ? "Rest day"
        : date === today
          ? "No session today"
          : "No session"

  return (
    <div className="sk-page max-w-[860px]" ref={topRef}>
      <PageHeader
        title={title}
        lede={
          !day
            ? log.loadError
              ? null
              : "Getting your session."
            : session
              ? meta
              : day.inPlan
                ? `${dayLabel} is a rest day in your plan. Recover well.`
                : date === today
                  ? "Nothing is planned for you today."
                  : `Nothing is planned for ${formatLongDay(date)}.`
        }
      />

      {day ? <WeekStrip week={day.week} selected={date} today={today} onSelect={selectDate} /> : null}

      {log.loadError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl bg-sk-coral-tint px-4 py-4">
          <p className="text-sm font-semibold text-[#b32a0c]">Could not load this session: {log.loadError}</p>
          <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm" onClick={log.reload}>
            Try again
          </button>
        </div>
      ) : null}

      {log.fromCache ? (
        <p role="status" className="rounded-2xl bg-sk-yellow-tint px-4 py-3 text-sm font-semibold text-[#7a5600]">
          You are offline, so this is the copy saved on this phone. Keep logging. It sends when you are back online.
        </p>
      ) : null}

      {day && !session ? (
        <EmptyState
          icon={day.inPlan ? <Moon className="size-6" weight="fill" /> : <CalendarBlank className="size-6" weight="fill" />}
          title={
            day.next
              ? `Next up: ${day.next.title}`
              : day.inPlan
                ? "No more sessions in your plan"
                : "No plan yet"
          }
          body={
            day.next
              ? `Planned for ${formatLongDay(day.next.date)}.`
              : day.inPlan
                ? "You have reached the end of the sessions your coach has planned."
                : "Sessions show up here as soon as your coach publishes a training plan for you."
          }
          action={
            day.next ? (
              <button type="button" className="sk-btn sk-btn-quiet" onClick={() => selectDate(day.next?.date ?? today)}>
                See that session
                <ArrowRight className="size-4" weight="bold" aria-hidden />
              </button>
            ) : (
              <Link to="/athlete/training-plan" className="sk-btn sk-btn-quiet">
                Open training plan
              </Link>
            )
          }
        />
      ) : null}

      {session && completed && !editing ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              tone="green"
              label="Session done"
              value={totals.done}
              unit={`/${totals.total}`}
              hint={totals.total === 1 ? "item ticked" : "sets ticked"}
            />
            <Stat
              tone="plain"
              label="Effort"
              value={session.overallRpe ?? "None"}
              unit={session.overallRpe ? "/10" : undefined}
              hint={session.overallRpe ? EFFORT_WORDS[session.overallRpe] : "Not rated"}
            />
          </div>

          {justFinished ? (
            <div className="flex flex-col gap-3 rounded-[20px] bg-sk-green-tint p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle className="mt-0.5 size-7 shrink-0 text-sk-green" weight="fill" aria-hidden />
                <div>
                  <p className="sk-h3">Nice work. That is logged.</p>
                  <p className="text-sm text-sk-ink-2">
                    {sync.status === "saved"
                      ? "Your coach can see it now. Taking you home."
                      : "It is safe on this phone and will reach your coach when it sends."}
                  </p>
                </div>
              </div>
              <Link to="/athlete/home" className="sk-btn sk-btn-primary shrink-0">
                Back to home
              </Link>
            </div>
          ) : null}

          <Panel
            title="What you logged"
            hint={session.completedOn ? `Finished ${formatLongDay(session.completedOn)}` : undefined}
            action={
              <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm" onClick={() => setEditing(true)}>
                <PencilSimple className="size-4" weight="bold" aria-hidden />
                Edit
              </button>
            }
          >
            <LoggedSummary blocks={session.blocks} logs={log.logs} />
            {session.athleteComment ? (
              <div className="sk-well mt-5">
                <p className="sk-label">Your comment</p>
                <p className="mt-1 text-[0.95rem] leading-relaxed text-sk-ink">{session.athleteComment}</p>
              </div>
            ) : null}
          </Panel>
          <SyncStatus sync={sync} onRetry={log.retrySync} />
        </>
      ) : null}

      {session && showForm ? (
        <>
          {date !== today && !completed ? (
            <p className="rounded-2xl bg-sk-blue-tint px-4 py-3 text-sm font-semibold text-[#1638b8]">
              {date < today
                ? `This was planned for ${formatLongDay(date)}. You can still log it.`
                : `This is planned for ${formatLongDay(date)}. Log it now if you are doing it early.`}
            </p>
          ) : null}

          {session.coachNote ? (
            <div className="sk-card flex items-start gap-3">
              <ChatText className="mt-0.5 size-5 shrink-0 text-sk-blue" weight="fill" aria-hidden />
              <div className="min-w-0">
                <p className="sk-label">From your coach</p>
                <p className="mt-0.5 text-base leading-relaxed text-sk-ink">{session.coachNote}</p>
              </div>
            </div>
          ) : null}

          {session.blocks.length === 0 ? (
            <p className="sk-well text-sm text-sk-ink-2">Your coach has not added any detail to this session. You can still finish it below.</p>
          ) : null}

          {session.blocks.map((block) => (
            <Panel key={block.id} title={block.name} hint={[block.focus, block.coachNote].filter(Boolean).join(" ") || undefined}>
              <ul>
                {block.rows.map((row) => {
                  const count = Math.min(setCount(row, log.logs) + (log.extraSets[row.id] ?? 0), MAX_SETS)
                  return (
                    <ExerciseRow
                      key={row.id}
                      row={row}
                      logs={log.logs}
                      count={count}
                      canAddSet={row.kind !== "check" && count < MAX_SETS}
                      onToggle={(setIndex) => log.toggleSet(row, setIndex)}
                      onValue={(setIndex, field, value) => log.setValue(row, setIndex, field, value)}
                      onFill={() => log.fillRowFromTarget(row)}
                      onAddSet={() => log.addSet(row)}
                      hideLabel={block.rows.length === 1 && row.kind === "check" && row.label === block.name}
                    />
                  )
                })}
              </ul>
            </Panel>
          ))}

          <Panel title="How hard was it?" hint="1 is very easy, 10 is everything you had.">
            <div role="radiogroup" aria-label="Effort from 1 to 10" className="grid grid-cols-5 gap-2">
              {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => {
                const active = log.wrapUp.rpe === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${value}, ${EFFORT_WORDS[value]}`}
                    onClick={() => log.updateWrapUp({ rpe: active ? null : value })}
                    className={cn(
                      "h-14 rounded-[14px] border-2 text-xl font-extrabold tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue",
                      active ? "border-sk-blue bg-sk-blue text-white" : "border-sk-line bg-white text-sk-ink hover:border-sk-ink",
                    )}
                  >
                    {value}
                  </button>
                )
              })}
            </div>
            <p className="mt-3 min-h-5 text-sm font-semibold text-sk-ink-2" aria-live="polite">
              {log.wrapUp.rpe ? `${log.wrapUp.rpe} out of 10: ${EFFORT_WORDS[log.wrapUp.rpe]}` : ""}
            </p>

            <label htmlFor={commentId} className="sk-label mb-1.5 mt-3 block">
              Anything your coach should know? (optional)
            </label>
            <textarea
              id={commentId}
              rows={3}
              maxLength={1000}
              value={log.wrapUp.comment}
              onChange={(event) => log.updateWrapUp({ comment: event.target.value })}
              placeholder="How it felt, niggles, what you changed"
              className="sk-field h-auto min-h-[96px] py-3 text-base"
            />

            <button type="button" className="sk-btn sk-btn-primary mt-5 h-14 w-full text-base" disabled={finishing} onClick={() => void handleFinish()}>
              <CheckCircle className="size-5" weight="fill" aria-hidden />
              {completed ? "Save changes" : "Finish session"}
            </button>
            {!completed && totals.total > 0 && totals.done < totals.total ? (
              <p className="mt-2 text-center text-sm text-sk-mute">
                {totals.done} of {totals.total} ticked. You can finish with some left.
              </p>
            ) : null}
            {completed ? (
              <button type="button" className="sk-btn sk-btn-ghost mt-2 w-full" onClick={() => setEditing(false)}>
                Back to summary
              </button>
            ) : null}
          </Panel>

          <div className="sticky bottom-0 z-20 -mx-4 -mb-10 border-t border-sk-line bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-sk-ink">
                  <span className="tabular-nums">
                    {totals.done} of {totals.total}
                  </span>{" "}
                  done
                </p>
                <Meter value={totals.total > 0 ? (totals.done / totals.total) * 100 : 0} tone="green" className="mt-1.5" />
              </div>
              <SyncStatus sync={sync} onRetry={log.retrySync} className="shrink-0" />
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
