"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarBlank, CaretDown, CaretLeft, CaretRight, CheckCircle, MapPin, MoonStars, Play, Timer } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import { EmptyState, PageHeader, Tag } from "@/components/sk"
import { dateKeyLocal, parseSessionCompletions, SESSION_COMPLETIONS_STORAGE_KEY } from "@/lib/athlete-session"
import { getCurrentAthleteProfileSnapshot } from "@/lib/data/athlete/profile-data"
import { getCurrentAthleteWeeklySessionCompletions } from "@/lib/data/session/session-data"
import { getAssignedTrainingPlansForCurrentAthlete, getTrainingPlanDetail } from "@/lib/data/training-plan/training-plan-data"
import type { TrainingPlanDay, TrainingPlanDetail, TrainingPlanSummary, TrainingPlanWeek } from "@/lib/data/training-plan/types"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { getBackendMode } from "@/lib/supabase/config"
import { cn } from "@/lib/utils"

const ASSIGNMENT_STORAGE_KEY = "pacelab:plan-assignments"

interface PlanAssignment {
  planId: string
  scope: "team" | "athlete"
  teamId: string
  athleteId?: string
}

const fallbackAthlete = {
  id: "fallback-athlete",
  teamId: "fallback-team",
}

function parseDateKey(key: string) {
  return new Date(`${key.slice(0, 10)}T00:00:00`)
}

function addDays(key: string, amount: number) {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + amount)
  return dateKeyLocal(date)
}

/* Mock mode only: a small demo plan built around the current date so the week view has something to show. */
function mockPlanStartKey() {
  const start = new Date()
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7)
  return dateKeyLocal(start)
}

const MOCK_WEEK_TEMPLATE: Array<{
  offset: number
  title: string
  type: TrainingPlanDay["sessionType"]
  focus: string
  duration: number
  location: string
  coachNote?: string
  blockPreview: string[]
}> = [
  {
    offset: 0,
    title: "Acceleration and gym",
    type: "Mixed",
    focus: "First steps and squat intent",
    duration: 75,
    location: "Track and gym",
    coachNote: "Stay sharp and relaxed.",
    blockPreview: ["Starts 4 x 20m", "Sled accel 4 x 15m", "Back squat 4 x 4"],
  },
  {
    offset: 1,
    title: "Tempo and mobility",
    type: "Recovery",
    focus: "Easy running, loosen up",
    duration: 50,
    location: "Track",
    blockPreview: ["6 x 200m tempo", "Mobility circuit"],
  },
  {
    offset: 3,
    title: "Max velocity",
    type: "Track",
    focus: "Upright mechanics",
    duration: 70,
    location: "Track",
    blockPreview: ["Wickets 6 x 30m", "Flying 30m x 4", "Bounds 3 x 40m"],
  },
  {
    offset: 4,
    title: "Lower body strength",
    type: "Gym",
    focus: "Heavy and fast",
    duration: 60,
    location: "Gym",
    blockPreview: ["Power clean 5 x 2", "Trap bar deadlift 4 x 3", "Core"],
  },
]

/** Keeps the demo in step with the mock home screen, which always has a session today. */
function mockTemplateForToday(startDate: string) {
  const todayOffset = (((new Date().getDay() + 6) % 7) - ((parseDateKey(startDate).getDay() + 6) % 7) + 7) % 7
  if (MOCK_WEEK_TEMPLATE.some((template) => template.offset === todayOffset)) return MOCK_WEEK_TEMPLATE
  return [...MOCK_WEEK_TEMPLATE.filter((template) => template.offset !== 0), { ...MOCK_WEEK_TEMPLATE[0], offset: todayOffset }].sort(
    (left, right) => left.offset - right.offset,
  )
}

const MOCK_WEEK_EMPHASIS = ["Getting back into rhythm", "Speed and strength", "Sharpen up"]

function buildFallbackPlans() {
  return [
    {
      id: "fallback-plan",
      name: "General Performance Block",
      teamId: "fallback-team",
      startDate: mockPlanStartKey(),
      weeks: MOCK_WEEK_EMPHASIS.length,
      assignedTo: "team" as "team" | "athlete",
      assignedAthleteIds: undefined as string[] | undefined,
    },
  ]
}

function buildFallbackPlanDetail(planId: string, startDate: string): TrainingPlanDetail {
  return {
    planId,
    weeks: MOCK_WEEK_EMPHASIS.map((emphasis, weekIndex) => ({
      id: `${planId}-week-${weekIndex + 1}`,
      weekNumber: weekIndex + 1,
      emphasis,
      status: weekIndex === 0 ? "completed" : weekIndex === 1 ? "current" : "up-next",
      days: mockTemplateForToday(startDate).map((template) => {
        const date = addDays(startDate, weekIndex * 7 + template.offset)
        return {
          id: `${planId}-w${weekIndex + 1}-${template.offset}`,
          dayIndex: template.offset,
          dayLabel: parseDateKey(date).toLocaleDateString(undefined, { weekday: "short" }),
          date,
          title: template.title,
          sessionType: template.type,
          focus: template.focus,
          status: weekIndex === 0 ? "completed" : "scheduled",
          durationMinutes: template.duration,
          location: template.location,
          coachNote: template.coachNote ?? null,
          blockPreview: template.blockPreview,
        }
      }),
    })),
  }
}

function shortDate(key: string, withYear = false) {
  return parseDateKey(key).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) })
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

function DayDetail({
  day,
  isToday,
  isDone,
  isPast,
  showTitle,
}: {
  day: TrainingPlanDay
  isToday: boolean
  isDone: boolean
  isPast: boolean
  showTitle: boolean
}) {
  return (
    <div className="space-y-4">
      {showTitle ? (
        <div>
          <p className="sk-label">
            {parseDateKey(day.date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h2 className="mt-1 text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.035em] text-sk-ink">{day.title}</h2>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {isDone ? (
          <Tag tone="green">
            <CheckCircle className="size-3.5" weight="fill" />
            Completed
          </Tag>
        ) : isToday ? (
          <Tag tone="blue">Today</Tag>
        ) : isPast ? (
          <Tag>Not logged</Tag>
        ) : null}
        <span className="text-sm font-semibold text-sk-ink-2">{day.sessionType} session</span>
      </div>

      {day.focus ? <p className="text-sk-ink-2">{day.focus}</p> : null}

      {day.durationMinutes || day.location ? (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold text-sk-ink-2">
          {day.durationMinutes ? (
            <span className="inline-flex items-center gap-1.5">
              <Timer className="size-4 text-sk-mute" weight="bold" />
              {day.durationMinutes} min
            </span>
          ) : null}
          {day.location ? (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4 text-sk-mute" weight="bold" />
              {day.location}
            </span>
          ) : null}
        </p>
      ) : null}

      {day.blockPreview.length > 0 ? (
        <ol>
          {day.blockPreview.map((block, index) => (
            <li key={`${index}-${block}`} className="flex items-center gap-3 border-b border-sk-line py-3 last:border-b-0">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-sk-blue-tint text-sm font-extrabold text-sk-blue">
                {index + 1}
              </span>
              <span className="min-w-0 font-semibold text-sk-ink">{block}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-sk-mute">Your coach has not listed the blocks for this session.</p>
      )}

      {day.coachNote ? (
        <p className="rounded-2xl bg-sk-yellow-tint p-4 text-sm leading-relaxed text-sk-ink-2">
          <span className="font-bold text-sk-ink">Coach says: </span>
          {day.coachNote}
        </p>
      ) : null}

      {isToday ? (
        <Link to="/athlete/log" className="sk-btn sk-btn-primary h-12 w-full text-base sm:w-auto">
          <Play className="size-5" weight="fill" />
          {isDone ? "Review workout" : "Start workout"}
        </Link>
      ) : null}
    </div>
  )
}

export default function AthleteTrainingPlanPage() {
  const backendMode = getBackendMode()
  const athlete = fallbackAthlete
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [selectedWeekNumber, setSelectedWeekNumber] = useState<number | null>(null)
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null)
  const [backendPlans, setBackendPlans] = useState<TrainingPlanSummary[]>([])
  const [backendPlanDetail, setBackendPlanDetail] = useState<TrainingPlanDetail | null>(null)
  const [backendDetailLoadedFor, setBackendDetailLoadedFor] = useState<string | null>(null)
  const [backendTeamName, setBackendTeamName] = useState<string | null>(null)
  const [backendLoading, setBackendLoading] = useState(backendMode === "supabase")
  const [backendError, setBackendError] = useState<string | null>(null)
  const [backendCompletionDates, setBackendCompletionDates] = useState<string[]>([])
  const [todayKey] = useState(() => dateKeyLocal(new Date()))
  const [fallbackPlans] = useState(buildFallbackPlans)
  const [storageAssignments] = useState<PlanAssignment[]>(() => {
    if (typeof window === "undefined" || backendMode === "supabase") return []
    const raw = window.localStorage.getItem(tenantStorageKey(ASSIGNMENT_STORAGE_KEY))
    if (!raw) return []
    try {
      return JSON.parse(raw) as PlanAssignment[]
    } catch {
      return []
    }
  })
  const [mockCompletionDates] = useState<string[]>(() => {
    if (typeof window === "undefined" || backendMode === "supabase") return []
    return parseSessionCompletions(window.localStorage.getItem(tenantStorageKey(SESSION_COMPLETIONS_STORAGE_KEY)))
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    ;(window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }).__PACELAB_MOBILE_DETAIL_MODE = true
    window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: true } }))
    const handleBack = () => window.history.back()
    window.addEventListener("pacelab:mobile-detail-back", handleBack)

    return () => {
      ;(window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }).__PACELAB_MOBILE_DETAIL_MODE = false
      window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: false } }))
      window.removeEventListener("pacelab:mobile-detail-back", handleBack)
    }
  }, [])

  const mockPlans = useMemo(() => {
    const base = fallbackPlans.filter(
      (plan) => plan.teamId === athlete.teamId || (plan.assignedTo === "athlete" && plan.assignedAthleteIds?.includes(athlete.id)),
    )

    const fromAssignments = storageAssignments
      .filter((assignment) => {
        if (assignment.scope === "team") return assignment.teamId === athlete.teamId
        return assignment.athleteId === athlete.id
      })
      .map((assignment) => fallbackPlans.find((plan) => plan.id === assignment.planId))
      .filter((plan): plan is (typeof fallbackPlans)[number] => Boolean(plan))

    const deduped = new Map([...base, ...fromAssignments].map((plan) => [plan.id, plan]))
    return [...deduped.values()]
  }, [athlete.id, athlete.teamId, fallbackPlans, storageAssignments])

  useEffect(() => {
    if (backendMode !== "supabase") return
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

    void loadPlans()

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

    void loadProfile()
    return () => {
      cancelled = true
    }
  }, [backendMode])

  const plans: TrainingPlanSummary[] = useMemo(
    () =>
      backendMode === "supabase"
        ? backendPlans
        : mockPlans.map((plan) => ({
            id: plan.id,
            name: plan.name,
            teamId: plan.teamId,
            startDate: plan.startDate,
            weeks: plan.weeks,
            status: "published" as const,
          })),
    [backendMode, backendPlans, mockPlans],
  )

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
    if (backendMode !== "supabase") return
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
  }, [activePlanId, backendMode])

  useEffect(() => {
    if (backendMode !== "supabase" || !activePlanId || !activePlanStart) return
    let cancelled = false

    const loadCompletions = async () => {
      // A week before and after covers plans whose day dates drift outside the nominal range.
      const result = await getCurrentAthleteWeeklySessionCompletions(
        addDays(activePlanStart, -7),
        addDays(activePlanStart, Math.max(activePlanWeeks ?? 1, 1) * 7 + 6),
      )
      if (cancelled) return
      if (!result.ok) {
        console.warn("[training-plan] failed to load session completions", result.error)
        return
      }
      setBackendCompletionDates(result.data.map((item) => item.completionDate.slice(0, 10)))
    }

    void loadCompletions()
    return () => {
      cancelled = true
    }
  }, [activePlanId, activePlanStart, activePlanWeeks, backendMode])

  const activePlanDetail = useMemo<TrainingPlanDetail | null>(() => {
    if (backendMode === "supabase") return backendPlanDetail?.planId === activePlanId ? backendPlanDetail : null
    if (!activePlanId || !activePlanStart) return null
    return buildFallbackPlanDetail(activePlanId, activePlanStart)
  }, [activePlanId, activePlanStart, backendMode, backendPlanDetail])

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
  const selected = weeks.find((item) => item.week.weekNumber === selectedWeekNumber) ?? defaultWeek
  const selectedIndex = selected ? weeks.indexOf(selected) : -1

  const completionDateSet = useMemo(
    () => new Set(backendMode === "supabase" ? backendCompletionDates : mockCompletionDates),
    [backendCompletionDates, backendMode, mockCompletionDates],
  )
  const isDayDone = (day: TrainingPlanDay) => day.status === "completed" || completionDateSet.has(day.date.slice(0, 10))

  const trainingRows = selected?.rows.filter((row): row is WeekRow & { day: TrainingPlanDay } => row.day !== null) ?? []
  const selectedRow =
    trainingRows.find((row) => row.day.id === selectedDayId) ??
    trainingRows.find((row) => row.dateKey === todayKey) ??
    trainingRows.find((row) => row.dateKey > todayKey) ??
    trainingRows[0] ??
    null
  const doneInWeek = trainingRows.filter((row) => isDayDone(row.day)).length

  useEffect(() => {
    setSelectedWeekNumber(null)
    setSelectedDayId(null)
  }, [activePlanId])

  const goToWeek = (index: number) => {
    const target = weeks[index]
    if (!target) return
    setSelectedWeekNumber(target.week.weekNumber)
    setSelectedDayId(null)
  }

  const detailPending = backendMode === "supabase" && Boolean(activePlanId) && backendDetailLoadedFor !== activePlanId
  const teamLabel = backendMode === "supabase" ? backendTeamName : null

  if (backendMode === "supabase" && (backendLoading || detailPending) && !backendError) {
    return (
      <div className="sk-page">
        <PageHeader title="Your plan" />
        <p className="text-sk-mute">Getting your plan...</p>
      </div>
    )
  }

  if (backendMode === "supabase" && backendError && !(activePlan && selected)) {
    return (
      <div className="sk-page">
        <PageHeader title="Your plan" />
        <div role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
          We could not load your plan. {backendError}
        </div>
      </div>
    )
  }

  if (!activePlan) {
    return (
      <div className="sk-page">
        <PageHeader title="Your plan" />
        <EmptyState
          icon={<CalendarBlank className="size-6" weight="fill" />}
          title="No plan assigned yet"
          body="When your coach publishes a training plan for you or your team, every week of it shows up here."
          action={
            <Link to="/athlete/home" className="sk-btn sk-btn-quiet sk-btn-sm">
              Back to home
            </Link>
          }
        />
      </div>
    )
  }

  const planPicker =
    plans.length > 1 ? (
      <label className="flex max-w-sm flex-col gap-1.5 text-sm font-semibold text-sk-mute">
        Showing plan
        <select className="sk-field" value={activePlan.id} onChange={(event) => setSelectedPlanId(event.target.value)}>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
      </label>
    ) : null

  const planLede = `${shortDate(activePlan.startDate)} to ${shortDate(planEndKey(activePlan), true)}, ${activePlan.weeks} ${activePlan.weeks === 1 ? "week" : "weeks"}${teamLabel ? `, ${teamLabel}` : ""}`

  if (!selected) {
    return (
      <div className="sk-page">
        <PageHeader title={activePlan.name} lede={planLede}>
          {planPicker}
        </PageHeader>
        <EmptyState
          icon={<CalendarBlank className="size-6" weight="fill" />}
          title="No sessions in this plan yet"
          body="Your coach has assigned this plan but has not added any weeks or sessions to it. Check back soon."
          action={
            <Link to="/athlete/home" className="sk-btn sk-btn-quiet sk-btn-sm">
              Back to home
            </Link>
          }
        />
      </div>
    )
  }

  const isThisWeek = selected === todayWeek

  return (
    <div className="sk-page">
      <PageHeader title={activePlan.name} lede={planLede}>
        {planPicker}
      </PageHeader>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
        <section aria-label={`Week ${selected.week.weekNumber}`} className="sk-card p-0 sm:p-0">
          <div className="flex items-center gap-2 border-b border-sk-line p-3 sm:p-4">
            <button
              type="button"
              aria-label="Previous week"
              className="sk-btn sk-btn-quiet size-11 shrink-0 px-0"
              disabled={selectedIndex <= 0}
              onClick={() => goToWeek(selectedIndex - 1)}
            >
              <CaretLeft className="size-5" weight="bold" />
            </button>
            <div className="min-w-0 flex-1 text-center" aria-live="polite">
              <p className="text-lg font-extrabold tracking-[-0.02em] text-sk-ink">
                Week {selected.week.weekNumber} <span className="font-semibold text-sk-mute">of {Math.max(activePlan.weeks, weeks.length)}</span>
              </p>
              <p className="text-sm font-semibold text-sk-mute">
                {shortDate(selected.startKey)} to {shortDate(selected.endKey)}
              </p>
            </div>
            <button
              type="button"
              aria-label="Next week"
              className="sk-btn sk-btn-quiet size-11 shrink-0 px-0"
              disabled={selectedIndex >= weeks.length - 1}
              onClick={() => goToWeek(selectedIndex + 1)}
            >
              <CaretRight className="size-5" weight="bold" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-4 sm:px-6">
            <p className="min-w-0 text-sk-ink-2">
              {selected.week.emphasis ? (
                <>
                  <span className="font-bold text-sk-ink">Focus: </span>
                  {selected.week.emphasis}
                </>
              ) : (
                <span className="text-sk-mute">No focus set for this week.</span>
              )}
            </p>
            <div className="flex items-center gap-3">
              {trainingRows.length > 0 ? (
                <span className="text-sm font-bold tabular-nums text-sk-ink-2">
                  {doneInWeek} of {trainingRows.length} done
                </span>
              ) : null}
              {isThisWeek ? (
                <Tag tone="blue">This week</Tag>
              ) : todayWeek ? (
                <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm -mr-2" onClick={() => goToWeek(weeks.indexOf(todayWeek))}>
                  Back to this week
                </button>
              ) : null}
            </div>
          </div>

          <ol className="mt-3 px-2 pb-2 sm:px-3 sm:pb-3">
            {selected.rows.map((row) => {
              const date = parseDateKey(row.dateKey)
              const isToday = row.dateKey === todayKey
              const isPast = row.dateKey < todayKey
              const weekday = date.toLocaleDateString(undefined, { weekday: "short" })
              const dateBlock = (
                <span
                  className={cn(
                    "flex size-12 shrink-0 flex-col items-center justify-center rounded-2xl leading-none",
                    isToday ? "bg-sk-blue text-white" : row.day ? "bg-sk-canvas text-sk-ink" : "text-sk-mute",
                  )}
                >
                  <span className="text-[0.7rem] font-bold">{weekday}</span>
                  <span className="mt-0.5 text-lg font-extrabold tabular-nums">{date.getDate()}</span>
                </span>
              )

              if (!row.day) {
                return (
                  <li key={row.key} aria-current={isToday ? "date" : undefined} className="flex items-center gap-3 px-3 py-1.5">
                    {dateBlock}
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-sk-mute">
                      <MoonStars className="size-4" weight="bold" />
                      {isToday ? "Rest day today" : "Rest day"}
                    </span>
                  </li>
                )
              }

              const day = row.day
              const done = isDayDone(day)
              const isSelected = selectedRow?.day.id === day.id
              return (
                <li key={row.key} aria-current={isToday ? "date" : undefined}>
                  <button
                    type="button"
                    aria-expanded={isSelected}
                    onClick={() => setSelectedDayId(day.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue",
                      isSelected ? "bg-sk-blue-tint" : "hover:bg-sk-canvas",
                    )}
                  >
                    {dateBlock}
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold leading-snug text-sk-ink">{day.title}</span>
                      <span className="mt-0.5 block truncate text-sm text-sk-mute">
                        {day.blockPreview.length > 0 ? day.blockPreview.join(", ") : day.focus || `${day.sessionType} session`}
                      </span>
                    </span>
                    {done ? (
                      <CheckCircle className="size-6 shrink-0 text-sk-green" weight="fill" aria-label="Completed" />
                    ) : null}
                    <CaretDown className={cn("size-4 shrink-0 text-sk-mute transition-transform lg:hidden", isSelected && "rotate-180")} weight="bold" />
                    <CaretRight className="hidden size-4 shrink-0 text-sk-mute lg:block" weight="bold" />
                  </button>
                  {isSelected ? (
                    <div className="px-3 pb-4 pt-3 lg:hidden">
                      <DayDetail day={day} isToday={isToday} isDone={done} isPast={isPast} showTitle={false} />
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </section>

        <section aria-label="Session detail" className="sk-card hidden lg:sticky lg:top-6 lg:block">
          {selectedRow ? (
            <DayDetail
              day={selectedRow.day}
              isToday={selectedRow.dateKey === todayKey}
              isDone={isDayDone(selectedRow.day)}
              isPast={selectedRow.dateKey < todayKey}
              showTitle
            />
          ) : (
            <EmptyState
              icon={<MoonStars className="size-6" weight="fill" />}
              title="A full rest week"
              body="Nothing is planned for this week. Flip to another week to see sessions."
              className="border-0 p-0"
            />
          )}
        </section>
      </div>
    </div>
  )
}
