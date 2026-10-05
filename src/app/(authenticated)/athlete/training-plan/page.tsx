"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Play, Plus } from "@phosphor-icons/react"
import { AvailabilityDialog, AvailabilityNotice, useMyAvailability } from "@/components/athlete/availability"
import { SkipDialog } from "@/components/athlete/log/log-parts"
import { useSessionLog } from "@/components/athlete/log/use-session-log"
import {
  Button,
  DayLabel,
  EmptyState,
  Fact,
  FactList,
  Field,
  LinkButton,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  Select,
  SkeletonRows,
  Split,
  StatusText,
  WeekPager,
  notify,
  notifyError,
  type StateTone,
} from "@/components/sk"
import { dateKeyLocal } from "@/lib/athlete-session"
import { availabilityCovers, type AthleteAvailability } from "@/lib/data/athlete/availability-data"
import { getCurrentAthleteProfileSnapshot } from "@/lib/data/athlete/profile-data"
import { listAthleteSessions } from "@/lib/data/session/session-log-data"
import { mockAthletePlans } from "@/lib/data/session/session-mock"
import { skipReasonLabel, skippedLabel, type AthleteSessionRef } from "@/lib/data/session/types"
import { getAssignedTrainingPlansForCurrentAthlete, getTrainingPlanDetail } from "@/lib/data/training-plan/training-plan-data"
import type { TrainingPlanDay, TrainingPlanDetail, TrainingPlanSummary, TrainingPlanWeek } from "@/lib/data/training-plan/types"
import { getBackendMode } from "@/lib/supabase/config"

function parseDateKey(key: string) {
  return new Date(`${key.slice(0, 10)}T00:00:00`)
}

function addDays(key: string, amount: number) {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + amount)
  return dateKeyLocal(date)
}

function shortDate(key: string, withYear = false) {
  return parseDateKey(key).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) })
}

function longDate(key: string) {
  return parseDateKey(key).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
}

function planEndKey(plan: Pick<TrainingPlanSummary, "startDate" | "weeks">) {
  return addDays(plan.startDate, Math.max(plan.weeks, 1) * 7 - 1)
}

type WeekRow = { key: string; dateKey: string; day: TrainingPlanDay | null }

/**
 * Seven consecutive dates for a plan week, counted from the plan start date (so a plan that
 * starts on a Wednesday runs Wednesday to Tuesday). Any plan day dated outside that window is
 * still shown, so nothing a coach programmed can go missing.
 */
function buildWeekRows(week: TrainingPlanWeek, planStartDate: string, weekPosition: number): WeekRow[] {
  const dayDates = week.days.map((day) => day.date.slice(0, 10)).sort()
  let start = addDays(planStartDate, weekPosition * 7)
  const end = addDays(start, 6)
  if (dayDates.length > 0 && !dayDates.some((date) => date >= start && date <= end)) {
    start = dayDates[0]
  }
  const dates = new Set(Array.from({ length: 7 }, (_, index) => addDays(start, index)))
  dayDates.forEach((date) => dates.add(date))

  return [...dates].sort().flatMap((dateKey): WeekRow[] => {
    const days = week.days
      .filter((day) => day.date.slice(0, 10) === dateKey)
      .sort((left, right) => left.dayIndex - right.dayIndex)
    if (days.length === 0) return [{ key: `rest-${dateKey}`, dateKey, day: null }]
    return days.map((day) => ({ key: day.id, dateKey, day }))
  })
}

/** One short line for a day in the week list. The full detail is one tap away. */
function daySummary(day: TrainingPlanDay) {
  const facts = [day.durationMinutes ? `${day.durationMinutes} min` : null, day.location].filter(Boolean).join(", ")
  if (day.blockPreview.length === 0) return facts || day.focus || `${day.sessionType} session`
  const shown = day.blockPreview.slice(0, 2).join(", ")
  const more = day.blockPreview.length - 2
  return more > 0 ? `${shown} and ${more} more` : shown
}

type DayState = { kind: "done" | "skipped" | "today" | "started" | "missed" | "excused" | "upcoming" | "unknown"; tone: StateTone; label: string | null }

/** Where a planned day stands, from the athlete's sessions and the periods they were unavailable. */
function planDayState(day: TrainingPlanDay, refs: AthleteSessionRef[], periods: AthleteAvailability[], today: string): DayState {
  const date = day.date.slice(0, 10)
  const planned = refs.filter((ref) => ref.origin === "plan" && ref.date === date)
  const done = planned.find((ref) => ref.status === "completed")
  if (done || day.status === "completed") return { kind: "done", tone: "green", label: "Done" }
  const skipped = planned.find((ref) => ref.status === "skipped")
  if (skipped) return { kind: "skipped", tone: "neutral", label: skippedLabel(skipped.skipReason) }
  const excused = periods.some((period) => availabilityCovers(period, date))
  if (date === today) {
    if (planned.some((ref) => ref.status === "in-progress")) return { kind: "started", tone: "blue", label: "Started" }
    return excused ? { kind: "excused", tone: "neutral", label: "Excused" } : { kind: "today", tone: "blue", label: "Today" }
  }
  if (date > today) return excused ? { kind: "excused", tone: "neutral", label: "Excused" } : { kind: "upcoming", tone: "neutral", label: null }
  if (excused) return { kind: "excused", tone: "neutral", label: "Excused" }
  // A past day with no session of the athlete's (they joined the team later) was never due.
  if (planned.length === 0) return { kind: "unknown", tone: "neutral", label: null }
  return { kind: "missed", tone: "coral", label: "Missed" }
}

/** One day of the plan: what is planned, the coach note and what to do about it. */
function PlanDayScreen({
  date,
  planName,
  planDay,
  backTo,
  current,
  onChanged,
}: {
  date: string
  planName: string
  planDay: TrainingPlanDay | null
  backTo: string
  current: AthleteAvailability | null
  onChanged: () => void
}) {
  const today = dateKeyLocal(new Date())
  const log = useSessionLog(date)
  const { day, session } = log
  const [skipOpen, setSkipOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const title = session?.title ?? planDay?.title ?? (day && !day.session ? "Rest day" : "Session")
  const duration = session?.estimatedDurationMinutes ?? planDay?.durationMinutes ?? null
  const location = session?.location ?? planDay?.location ?? null
  const lede = [planDay ? `${planDay.sessionType} session` : null, duration ? `${duration} min` : null, location].filter(Boolean).join(", ")
  const coachNote = session?.coachNote ?? planDay?.coachNote ?? null
  const completed = session?.status === "completed"
  const skipped = session?.status === "skipped"
  const started = session?.status === "in-progress"
  const excused = Boolean(day?.excused) && !completed && !skipped
  const logPath = date === today ? "/athlete/log" : `/athlete/log?date=${date}`

  const state: { tone: StateTone; label: string; detail: string } | null = !session
    ? null
    : completed
      ? { tone: "green", label: "Done", detail: session.overallRpe ? `Effort ${session.overallRpe} of 10.` : "Logged." }
      : skipped
        ? { tone: "neutral", label: skippedLabel(session.skipReason), detail: session.skipNote ?? "It does not count as missed." }
        : excused
          ? { tone: "neutral", label: "Excused", detail: "You are marked as unavailable on this day. It does not count as missed." }
          : started
            ? { tone: "blue", label: "Started", detail: "You have logged part of it." }
            : date === today
              ? { tone: "blue", label: "Today", detail: "Not logged yet." }
              : date < today
                ? { tone: "coral", label: "Missed", detail: "Not logged. You can still log it or say why you could not do it." }
                : null

  const unskip = async () => {
    setBusy(true)
    const result = await log.unskip()
    setBusy(false)
    if (!result.ok) {
      notifyError("Could not undo the skip", result.error.message)
      return
    }
    onChanged()
  }

  return (
    <Screen width="narrow">
      <ScreenHeader back={{ to: backTo, label: planName }} fact={date === today ? `Today, ${longDate(date)}` : longDate(date)} title={title} lede={lede || undefined} />

      <AvailabilityNotice current={current} />

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

      {state ? (
        <Section aria-label="Status">
          <List>
            <ListRow title={<StatusText tone={state.tone}>{state.label}</StatusText>} subtitle={state.detail} />
          </List>
        </Section>
      ) : null}

      {coachNote ? (
        <Section title="From your coach">
          <p className="pt-1 text-base leading-relaxed text-sk-ink">{coachNote}</p>
        </Section>
      ) : null}

      {!day && !log.loadError ? (
        <Section title="What is planned">
          <SkeletonRows rows={4} label="Getting the session" />
        </Section>
      ) : session && session.blocks.length > 0 ? (
        session.blocks.map((block) => (
          <Section key={block.id} title={block.name} hint={[block.focus, block.coachNote].filter(Boolean).join(" ") || undefined}>
            <List>
              {block.rows.map((row) =>
                block.rows.length === 1 && row.label === block.name ? (
                  <ListRow key={row.id} title={row.target} />
                ) : (
                  <ListRow key={row.id} title={row.label} subtitle={row.helper ?? undefined} trailing={row.target} />
                ),
              )}
            </List>
          </Section>
        ))
      ) : planDay && planDay.blockPreview.length > 0 ? (
        <Section title="What is planned">
          <List ordered>
            {planDay.blockPreview.map((block, index) => (
              <ListRow key={`${index}-${block}`} title={block} />
            ))}
          </List>
        </Section>
      ) : day ? (
        <Section aria-label="What is planned">
          <EmptyState
            title={session || planDay ? "No detail for this session yet" : "Nothing is planned for this day"}
            body={session || planDay ? "Your coach has not listed the blocks for this session." : "Enjoy the rest, or add a session of your own."}
          />
        </Section>
      ) : null}

      {day ? (
        <Section aria-label="Actions" className="gap-2">
          {session && skipped ? (
            <Button variant="primary" size="lg" block disabled={busy} onClick={() => void unskip()}>
              {busy ? "Saving..." : "Undo skip"}
            </Button>
          ) : session ? (
            <LinkButton variant="primary" size="lg" block to={logPath}>
              {completed ? null : <Play className="size-[18px]" weight="fill" aria-hidden />}
              {completed ? "See what you logged" : started ? "Resume session" : excused ? "Log anyway" : date === today ? "Start session" : date < today ? "Log this session" : "Log it early"}
            </LinkButton>
          ) : (
            <LinkButton size="lg" block to="/athlete/log/new">
              <Plus className="size-[18px]" weight="bold" aria-hidden />
              Add a session
            </LinkButton>
          )}
          {session && !completed && !skipped ? (
            <Button variant="quiet" block onClick={() => setSkipOpen(true)}>
              Can't do this one
            </Button>
          ) : null}
        </Section>
      ) : null}

      {session ? (
        <SkipDialog
          open={skipOpen}
          onOpenChange={setSkipOpen}
          sessionTitle={session.title}
          onSkip={async (reason, note) => {
            const result = await log.skip(reason, note)
            if (result.ok) {
              notify("Session skipped", `Reason: ${skipReasonLabel(reason).toLowerCase()}.`)
              onChanged()
            }
            return result
          }}
        />
      ) : null}
    </Screen>
  )
}

export default function AthleteTrainingPlanPage() {
  const backendMode = getBackendMode()
  const isSupabase = backendMode === "supabase"
  const [searchParams, setSearchParams] = useSearchParams()
  const availability = useMyAvailability()
  const [availabilityOpen, setAvailabilityOpen] = useState(false)
  const [backendPlans, setBackendPlans] = useState<TrainingPlanSummary[]>([])
  const [backendPlanDetail, setBackendPlanDetail] = useState<TrainingPlanDetail | null>(null)
  const [backendDetailLoadedFor, setBackendDetailLoadedFor] = useState<string | null>(null)
  const [backendTeamName, setBackendTeamName] = useState<string | null>(null)
  const [backendLoading, setBackendLoading] = useState(isSupabase)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [refs, setRefs] = useState<AthleteSessionRef[]>([])
  const [refsToken, setRefsToken] = useState(0)
  const [todayKey] = useState(() => dateKeyLocal(new Date()))
  const [mockPlans] = useState(() => (isSupabase ? [] : mockAthletePlans()))

  const selectedPlanId = searchParams.get("plan")
  const weekParam = Number.parseInt(searchParams.get("week") ?? "", 10)
  const dayParam = searchParams.get("day")
  const openDay = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : null

  useEffect(() => {
    if (!isSupabase) return
    let cancelled = false

    const loadPlans = async () => {
      setBackendLoading(true)
      setBackendError(null)
      const result = await getAssignedTrainingPlansForCurrentAthlete()
      if (cancelled) return
      if (!result.ok) {
        setBackendPlans([])
        setBackendPlanDetail(null)
        setBackendError(result.error.message)
        setBackendLoading(false)
        return
      }
      setBackendPlans(result.data)
      setBackendLoading(false)
    }

    const loadProfile = async () => {
      const profileResult = await getCurrentAthleteProfileSnapshot()
      if (cancelled) return
      if (!profileResult.ok) {
        // The team name is a nice-to-have in the header. Never block the plan on it.
        console.warn("[training-plan] failed to load athlete profile", profileResult.error)
        return
      }
      setBackendTeamName(profileResult.data.teamName)
    }

    void loadPlans()
    void loadProfile()
    return () => {
      cancelled = true
    }
  }, [isSupabase])

  const plans: TrainingPlanSummary[] = useMemo(() => (isSupabase ? backendPlans : mockPlans.map((plan) => plan.summary)), [backendPlans, isSupabase, mockPlans])

  // Default to the plan that is running today, otherwise the most recent one.
  const activePlan =
    plans.find((plan) => plan.id === selectedPlanId) ??
    plans.find((plan) => plan.startDate.slice(0, 10) <= todayKey && todayKey <= planEndKey(plan)) ??
    plans[0] ??
    null
  const activePlanId = activePlan?.id
  const activePlanStart = activePlan?.startDate
  const activePlanWeeks = activePlan?.weeks

  useEffect(() => {
    if (!isSupabase) return
    if (!activePlanId) {
      setBackendPlanDetail(null)
      return
    }
    let cancelled = false
    const loadDetail = async () => {
      const result = await getTrainingPlanDetail(activePlanId)
      if (cancelled) return
      if (!result.ok) {
        setBackendError(result.error.message)
        setBackendPlanDetail(null)
        setBackendDetailLoadedFor(activePlanId)
        return
      }
      setBackendPlanDetail(result.data)
      setBackendDetailLoadedFor(activePlanId)
    }
    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [activePlanId, isSupabase])

  // The athlete's own sessions over the plan: done, skipped, started, and the ones they added.
  useEffect(() => {
    if (!activePlanId || !activePlanStart) return
    let cancelled = false
    // A week before and after covers plans whose day dates drift outside the nominal range.
    void listAthleteSessions(addDays(activePlanStart, -7), addDays(activePlanStart, Math.max(activePlanWeeks ?? 1, 1) * 7 + 6)).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        console.warn("[training-plan] failed to load sessions", result.error)
        return
      }
      setRefs(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [activePlanId, activePlanStart, activePlanWeeks, refsToken])

  const activePlanDetail = useMemo<TrainingPlanDetail | null>(() => {
    if (isSupabase) return backendPlanDetail?.planId === activePlanId ? backendPlanDetail : null
    return mockPlans.find((plan) => plan.summary.id === activePlanId)?.detail ?? null
  }, [activePlanId, backendPlanDetail, isSupabase, mockPlans])

  const weeks = useMemo(() => {
    if (!activePlanDetail || !activePlanStart) return []
    return [...activePlanDetail.weeks]
      .sort((left, right) => left.weekNumber - right.weekNumber)
      .map((week, index) => {
        // week_number is normally 1-based and contiguous; fall back to list position if it is not.
        const position = week.weekNumber >= 1 ? week.weekNumber - 1 : index
        const rows = buildWeekRows(week, activePlanStart, position)
        return { week, rows, startKey: rows[0].dateKey, endKey: rows[rows.length - 1].dateKey }
      })
  }, [activePlanDetail, activePlanStart])

  const todayWeek = weeks.find((item) => item.startKey <= todayKey && todayKey <= item.endKey) ?? null
  const defaultWeek =
    todayWeek ??
    (weeks.length > 0 && todayKey > weeks[weeks.length - 1].endKey ? weeks[weeks.length - 1] : null) ??
    weeks.find((item) => item.week.status === "current") ??
    weeks[0] ??
    null
  const selected = weeks.find((item) => item.week.weekNumber === weekParam) ?? defaultWeek
  const selectedIndex = selected ? weeks.indexOf(selected) : -1

  const planQuery = (changes: { week?: number | null; day?: string | null; plan?: string | null }) => {
    const params = new URLSearchParams()
    const plan = changes.plan !== undefined ? changes.plan : selectedPlanId
    const week = changes.week !== undefined ? changes.week : selected && selected !== defaultWeek ? selected.week.weekNumber : null
    if (plan) params.set("plan", plan)
    if (week) params.set("week", String(week))
    if (changes.day) params.set("day", changes.day)
    const query = params.toString()
    return query ? `/athlete/training-plan?${query}` : "/athlete/training-plan"
  }

  const goToWeek = (index: number) => {
    const target = weeks[index]
    if (!target) return
    const params = new URLSearchParams()
    if (selectedPlanId) params.set("plan", selectedPlanId)
    if (target !== defaultWeek) params.set("week", String(target.week.weekNumber))
    setSearchParams(params, { replace: true })
  }

  const detailPending = isSupabase && Boolean(activePlanId) && backendDetailLoadedFor !== activePlanId
  const teamLabel = isSupabase ? backendTeamName : null

  if (isSupabase && (backendLoading || detailPending) && !backendError) {
    return (
      <Screen>
        <ScreenHeader title="Your plan" />
        <Section title="This week">
          <SkeletonRows rows={7} label="Getting your plan" />
        </Section>
      </Screen>
    )
  }

  if (isSupabase && backendError && !(activePlan && selected)) {
    return (
      <Screen>
        <ScreenHeader title="Your plan" />
        <Notice tone="error">We could not load your plan. {backendError}</Notice>
      </Screen>
    )
  }

  const moreSection = (
    <Section title="More">
      <List>
        <ListRow to="/athlete/log/history" title="Session history" subtitle="What you did, skipped and missed." />
        <ListRow to="/athlete/log/new" title="Add a session" subtitle="Log something that was not in your plan." />
        {!availability.current ? (
          <ListRow onClick={() => setAvailabilityOpen(true)} chevron title="I can't train for a while" subtitle="Injured, sick or away. Your coach is told." />
        ) : null}
      </List>
    </Section>
  )

  if (!activePlan) {
    return (
      <Screen>
        <ScreenHeader title="Your plan" />
        <AvailabilityNotice current={availability.current} />
        <Section aria-label="Plan">
          <EmptyState
            title="No plan assigned yet"
            body="When your coach publishes a training plan for you or your team, every week of it shows up here."
            action={
              <LinkButton size="sm" to="/athlete/home">
                Back to home
              </LinkButton>
            }
          />
        </Section>
        {moreSection}
        <AvailabilityDialog open={availabilityOpen} onOpenChange={setAvailabilityOpen} />
      </Screen>
    )
  }

  if (openDay) {
    const planDay = weeks.flatMap((item) => item.week.days).find((day) => day.date.slice(0, 10) === openDay) ?? null
    return (
      <PlanDayScreen
        key={openDay}
        date={openDay}
        planName={activePlan.name}
        planDay={planDay}
        backTo={planQuery({ day: null })}
        current={availability.current}
        onChanged={() => setRefsToken((value) => value + 1)}
      />
    )
  }

  const planLede = `${shortDate(activePlan.startDate)} to ${shortDate(planEndKey(activePlan), true)}, ${activePlan.weeks} ${activePlan.weeks === 1 ? "week" : "weeks"}${teamLabel ? `, ${teamLabel}` : ""}`
  const header = (
    <ScreenHeader title={activePlan.name} lede={planLede} />
  )

  if (!selected) {
    return (
      <Screen>
        {header}
        <AvailabilityNotice current={availability.current} />
        <Section aria-label="Plan">
          <EmptyState title="No sessions in this plan yet" body="Your coach has assigned this plan but has not added any weeks or sessions to it. Check back soon." />
        </Section>
        {moreSection}
        <AvailabilityDialog open={availabilityOpen} onOpenChange={setAvailabilityOpen} />
      </Screen>
    )
  }

  const trainingRows = selected.rows.filter((row): row is WeekRow & { day: TrainingPlanDay } => row.day !== null)
  const states = new Map(trainingRows.map((row) => [row.key, planDayState(row.day, refs, availability.periods, todayKey)]))
  const doneInWeek = trainingRows.filter((row) => states.get(row.key)?.kind === "done").length
  const excusedInWeek = trainingRows.filter((row) => ["skipped", "excused"].includes(states.get(row.key)?.kind ?? "")).length
  const extrasInWeek = refs.filter((ref) => ref.origin === "athlete" && ref.date >= selected.startKey && ref.date <= selected.endKey)
  const totalWeeks = Math.max(activePlan.weeks, weeks.length)

  return (
    <Screen>
      {header}

      <AvailabilityNotice current={availability.current} />
      {backendError ? <Notice tone="error">Some of your plan could not be loaded. {backendError}</Notice> : null}

      <Split
        main={
          <Section aria-label={`Week ${selected.week.weekNumber}`}>
            <WeekPager
              title={`Week ${selected.week.weekNumber} of ${totalWeeks}`}
              subtitle={`${shortDate(selected.startKey)} to ${shortDate(selected.endKey)}${selected === todayWeek ? ", this week" : ""}`}
              onPrevious={selectedIndex > 0 ? () => goToWeek(selectedIndex - 1) : undefined}
              onNext={selectedIndex < weeks.length - 1 ? () => goToWeek(selectedIndex + 1) : undefined}
              action={
                todayWeek && selected !== todayWeek ? (
                  <Button variant="quiet" size="sm" onClick={() => goToWeek(weeks.indexOf(todayWeek))}>
                    This week
                  </Button>
                ) : null
              }
              className="mb-1.5"
            />
            <List ordered aria-label="Days of this week">
              {selected.rows.flatMap((row) => {
                const date = parseDateKey(row.dateKey)
                const isToday = row.dateKey === todayKey
                const leading = <DayLabel weekday={date.toLocaleDateString(undefined, { weekday: "short" })} number={date.getDate()} today={isToday} muted={!row.day} />
                const extras = extrasInWeek.filter((ref) => ref.date === row.dateKey)
                const extraRows = extras.map((ref) => (
                  <ListRow
                    key={ref.id}
                    to={`/athlete/log?${new URLSearchParams({ ...(ref.date !== todayKey ? { date: ref.date } : {}), session: ref.id }).toString()}`}
                    leading={row.day ? <span className="w-9" aria-hidden /> : leading}
                    title={ref.title}
                    subtitle="Added by you"
                    trailing={ref.status === "completed" ? <StatusText tone="green">Done</StatusText> : undefined}
                    aria-current={isToday && !row.day ? "date" : undefined}
                  />
                ))
                if (!row.day) {
                  if (extras.length > 0) return extraRows
                  return [
                    <ListRow key={row.key} leading={leading} aria-current={isToday ? "date" : undefined}>
                      <span className="sk-list-sub">{isToday ? "Rest day today" : "Rest day"}</span>
                    </ListRow>,
                  ]
                }
                const day = row.day
                const state = states.get(row.key)
                return [
                  <ListRow
                    key={row.key}
                    to={planQuery({ day: row.dateKey })}
                    leading={leading}
                    title={day.title}
                    subtitle={daySummary(day)}
                    trailing={state?.label ? <StatusText tone={state.tone}>{state.kind === "skipped" ? "Skipped" : state.label}</StatusText> : undefined}
                    aria-current={isToday ? "date" : undefined}
                  />,
                  ...extraRows,
                ]
              })}
            </List>
          </Section>
        }
        side={
          <>
            <Section title="This week">
              <FactList>
                <Fact label="Focus" empty="No focus set">
                  {selected.week.emphasis}
                </Fact>
                <Fact label="Sessions done">{trainingRows.length > 0 ? `${doneInWeek} of ${trainingRows.length}` : "Rest week"}</Fact>
                {excusedInWeek > 0 ? <Fact label="Skipped or excused">{excusedInWeek}</Fact> : null}
                {extrasInWeek.length > 0 ? <Fact label="Added by you">{extrasInWeek.length}</Fact> : null}
              </FactList>
              {plans.length > 1 ? (
                <Field label="Showing plan" className="mt-4">
                  <Select value={activePlan.id} onChange={(event) => setSearchParams({ plan: event.target.value }, { replace: true })}>
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </Section>
            {moreSection}
          </>
        }
      />

      <AvailabilityDialog open={availabilityOpen} onOpenChange={setAvailabilityOpen} />
    </Screen>
  )
}
