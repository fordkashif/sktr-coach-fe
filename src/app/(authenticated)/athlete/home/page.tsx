"use client"

import { useEffect, useState, type ReactNode } from "react"
import {
  ArrowRight,
  ArrowUp,
  Barbell,
  CalendarBlank,
  CaretRight,
  Check,
  CheckCircle,
  ClipboardText,
  Heartbeat,
  Lightning,
  MapPin,
  MoonStars,
  PersonSimpleRun,
  Play,
  Target,
  Timer,
} from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import { EmptyState, PageHeader, Panel, Tag } from "@/components/sk"
import {
  dateKeyLocal,
  defaultSessionProgress,
  parseSessionCompletions,
  progressForCurrentSession,
  SESSION_COMPLETIONS_STORAGE_KEY,
  SESSION_PROGRESS_STORAGE_KEY,
  type SessionProgress,
} from "@/lib/athlete-session"
import {
  getCurrentAthleteWeeklySessionCompletions,
  getLatestSessionDetailForCurrentAthlete,
  type CurrentAthleteLatestSessionDetail,
} from "@/lib/data/session/session-data"
import {
  getCurrentAthleteOnboardingState,
  setCurrentAthleteSetupGuideDismissed,
} from "@/lib/data/athlete/invite-claim-data"
import { getCurrentAthleteActiveTestWeekContext } from "@/lib/data/test-week/test-week-data"
import type { CurrentAthleteTestWeekContext } from "@/lib/data/test-week/types"
import { getAssignedTrainingPlansForCurrentAthlete, getTrainingPlanDetail } from "@/lib/data/training-plan/training-plan-data"
import type { TrainingPlanDay } from "@/lib/data/training-plan/types"
import { getCurrentAthleteWellnessEntries } from "@/lib/data/wellness/wellness-data"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { cn } from "@/lib/utils"
import type { CurrentSession } from "@/lib/mock-data"

const TEST_WEEK_STORAGE_KEY = "pacelab:test-week-submission"

/** Demo session shown in mock mode only. Supabase mode never falls back to this. */
const mockModeSession: CurrentSession = {
  id: "fallback-session",
  title: "Acceleration and gym",
  status: "not-started",
  scheduledFor: "Today",
  estimatedDuration: "75 min",
  coachNote: "",
  blocks: [
    {
      id: "fallback-block-1",
      type: "Sprint",
      name: "Acceleration",
      focus: "Starts and sled accels",
      coachNote: "",
      rows: [
        { label: "Starts", target: "4 x 20m" },
        { label: "Sled accel", target: "4 x 15m" },
      ],
    },
    {
      id: "fallback-block-2",
      type: "Strength",
      name: "Gym Work",
      focus: "Back squat",
      coachNote: "",
      rows: [{ label: "Back squat", target: "4 x 4" }],
    },
  ],
}

type HomeSession = Omit<CurrentSession, "estimatedDuration"> & { estimatedDuration: string | null }

function parseDateKey(key: string) {
  return new Date(`${key.slice(0, 10)}T00:00:00`)
}

function longDate(key: string) {
  return parseDateKey(key).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
}

function BlockIcon({ type }: { type: CurrentSession["blocks"][number]["type"] }) {
  const className = "size-5"
  if (type === "Strength") return <Barbell className={className} weight="bold" />
  if (type === "Run") return <PersonSimpleRun className={className} weight="bold" />
  if (type === "Jumps") return <ArrowUp className={className} weight="bold" />
  if (type === "Throws") return <Target className={className} weight="bold" />
  return <Lightning className={className} weight="bold" />
}

function TodoRow({ to, icon, title, body }: { to: string; icon: ReactNode; title: string; body: string }) {
  return (
    <li>
      <Link to={to} className="group flex min-h-[64px] items-center gap-3 border-b border-sk-line py-3.5 last:border-b-0">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-sk-yellow text-sk-ink">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-sk-ink group-hover:text-sk-blue">{title}</span>
          <span className="block text-sm text-sk-mute">{body}</span>
        </span>
        <CaretRight className="size-5 shrink-0 text-sk-mute" weight="bold" />
      </Link>
    </li>
  )
}

export default function AthleteHomePage() {
  const backendMode = getBackendMode()
  const isSupabase = backendMode === "supabase"
  const [now, setNow] = useState(() => new Date())
  const [backendSessionDetail, setBackendSessionDetail] = useState<CurrentAthleteLatestSessionDetail | null>(null)
  const [backendLoaded, setBackendLoaded] = useState(false)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState("")
  const [setupGuideDismissedAt, setSetupGuideDismissedAt] = useState<string | null>(null)
  const [setupGuideSaving, setSetupGuideSaving] = useState(false)
  const [planName, setPlanName] = useState<string | null>(null)
  const [planDays, setPlanDays] = useState<TrainingPlanDay[] | null>(null)
  const [wellnessDates, setWellnessDates] = useState<string[] | null>(null)
  const [testWeek, setTestWeek] = useState<CurrentAthleteTestWeekContext | null>(null)
  const [mockTestWeekSubmitted, setMockTestWeekSubmitted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return Boolean(window.localStorage.getItem(tenantStorageKey(TEST_WEEK_STORAGE_KEY)))
  })
  const [progress, setProgress] = useState<SessionProgress>(() => {
    if (typeof window === "undefined") return defaultSessionProgress()
    return progressForCurrentSession(window.localStorage.getItem(tenantStorageKey(SESSION_PROGRESS_STORAGE_KEY)))
  })
  const [completionDates, setCompletionDates] = useState<string[]>(() => {
    if (typeof window === "undefined" || isSupabase) return []
    return parseSessionCompletions(window.localStorage.getItem(tenantStorageKey(SESSION_COMPLETIONS_STORAGE_KEY)))
  })

  const currentSession: HomeSession | null =
    isSupabase
      ? backendSessionDetail
        ? {
            id: backendSessionDetail.session.id,
            title: backendSessionDetail.session.title,
            status:
              backendSessionDetail.session.status === "completed"
                ? ("completed" as const)
                : backendSessionDetail.session.status === "in-progress"
                  ? ("in-progress" as const)
                  : ("not-started" as const),
            scheduledFor: backendSessionDetail.session.scheduledFor,
            estimatedDuration: backendSessionDetail.session.estimatedDurationMinutes
              ? `${backendSessionDetail.session.estimatedDurationMinutes} min`
              : null,
            coachNote: backendSessionDetail.session.coachNote ?? "",
            blocks: backendSessionDetail.blocks
              .slice()
              .sort((left, right) => left.sortOrder - right.sortOrder)
              .map((block) => ({
                id: block.id,
                type: block.blockType,
                name: block.name,
                focus: block.focus ?? "",
                coachNote: block.coachNote ?? "",
                previousResult: block.previousResult ?? undefined,
                rest: block.restLabel ?? undefined,
                rows: block.rows
                  .slice()
                  .sort((left, right) => left.sortOrder - right.sortOrder)
                  .map((row) => ({
                    label: row.label,
                    target: row.target,
                    helper: row.helper ?? undefined,
                  })),
              })),
          }
        : null
      : mockModeSession
  const currentSessionId = currentSession?.id
  const currentSessionBlockCount = currentSession?.blocks.length ?? 0

  useEffect(() => {
    if (typeof window === "undefined") return

    const syncProgress = () => {
      setProgress(
        progressForCurrentSession(window.localStorage.getItem(tenantStorageKey(SESSION_PROGRESS_STORAGE_KEY)), {
          sessionId: currentSessionId,
          blockCount: currentSessionBlockCount,
        }),
      )
      if (!isSupabase) {
        setCompletionDates(parseSessionCompletions(window.localStorage.getItem(tenantStorageKey(SESSION_COMPLETIONS_STORAGE_KEY))))
        setMockTestWeekSubmitted(Boolean(window.localStorage.getItem(tenantStorageKey(TEST_WEEK_STORAGE_KEY))))
      }
    }

    syncProgress()
    window.addEventListener("focus", syncProgress)
    window.addEventListener("storage", syncProgress)

    return () => {
      window.removeEventListener("focus", syncProgress)
      window.removeEventListener("storage", syncProgress)
    }
  }, [currentSessionId, currentSessionBlockCount, isSupabase])

  useEffect(() => {
    if (backendMode !== "supabase") return
    let cancelled = false

    const loadSessionDetail = async () => {
      const [result, onboardingResult] = await Promise.all([
        getLatestSessionDetailForCurrentAthlete(),
        getCurrentAthleteOnboardingState(),
      ])
      if (cancelled) return
      if (onboardingResult.ok) {
        setSetupGuideDismissedAt(onboardingResult.data.setupGuideDismissedAt ?? null)
        setDisplayName(onboardingResult.data.displayName ?? "")
      }
      setBackendLoaded(true)
      if (!result.ok) {
        setBackendError(result.error.message)
        return
      }
      setBackendError(null)
      setBackendSessionDetail(result.data)
    }

    const loadPlan = async () => {
      const plansResult = await getAssignedTrainingPlansForCurrentAthlete()
      if (cancelled) return
      if (!plansResult.ok) {
        console.warn("[home] failed to load assigned plans", plansResult.error)
        return
      }
      if (plansResult.data.length === 0) {
        setPlanDays([])
        return
      }
      const todayKey = dateKeyLocal(new Date())
      const plan =
        plansResult.data.find((item) => {
          const end = parseDateKey(item.startDate)
          end.setDate(end.getDate() + item.weeks * 7 - 1)
          return item.startDate.slice(0, 10) <= todayKey && todayKey <= dateKeyLocal(end)
        }) ?? plansResult.data[0]
      const detailResult = await getTrainingPlanDetail(plan.id)
      if (cancelled) return
      if (!detailResult.ok) {
        console.warn("[home] failed to load plan detail", detailResult.error)
        return
      }
      setPlanName(plan.name)
      setPlanDays((detailResult.data?.weeks ?? []).flatMap((week) => week.days))
    }

    const loadTodos = async () => {
      const [wellnessResult, testWeekResult] = await Promise.all([
        // The data function returns the oldest rows first, so ask for plenty to be sure today is included.
        getCurrentAthleteWellnessEntries(1000),
        getCurrentAthleteActiveTestWeekContext(),
      ])
      if (cancelled) return
      if (wellnessResult.ok) setWellnessDates(wellnessResult.data.map((entry) => entry.entryDate.slice(0, 10)))
      if (testWeekResult.ok) setTestWeek(testWeekResult.data)
    }

    void loadSessionDetail()
    void loadPlan()
    void loadTodos()
    return () => {
      cancelled = true
    }
  }, [backendMode])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [])

  const todayKey = dateKeyLocal(now)
  const startOfWeek = new Date(now)
  const dayOffset = (startOfWeek.getDay() + 6) % 7
  startOfWeek.setDate(startOfWeek.getDate() - dayOffset)
  startOfWeek.setHours(0, 0, 0, 0)
  const weekStartKey = dateKeyLocal(startOfWeek)
  const weekEnd = new Date(startOfWeek)
  weekEnd.setDate(startOfWeek.getDate() + 6)
  const weekEndKey = dateKeyLocal(weekEnd)

  useEffect(() => {
    let cancelled = false

    const loadWeeklyCompletions = async () => {
      if (backendMode !== "supabase") return

      const result = await getCurrentAthleteWeeklySessionCompletions(weekStartKey, weekEndKey)
      if (!result.ok) {
        console.warn("[session] failed to load weekly completions in supabase mode", result.error)
        return
      }

      if (cancelled) return
      setCompletionDates(result.data.map((item) => item.completionDate.slice(0, 10)))
    }

    void loadWeeklyCompletions()

    return () => {
      cancelled = true
    }
  }, [backendMode, weekStartKey, weekEndKey])

  /* Today ----------------------------------------------------------- */
  const sessionDateKey = isSupabase && currentSession ? currentSession.scheduledFor.slice(0, 10) : todayKey
  const todaySession = currentSession && sessionDateKey === todayKey ? currentSession : null
  const overdueSession =
    currentSession && sessionDateKey < todayKey && currentSession.status !== "completed" ? currentSession : null
  const upcomingSession = currentSession && sessionDateKey > todayKey ? currentSession : null

  const planDaysToday = (planDays ?? []).filter((day) => day.date.slice(0, 10) === todayKey)
  const planDayToday = planDaysToday[0] ?? null
  const nextPlanDay =
    (planDays ?? [])
      .filter((day) => day.date.slice(0, 10) > todayKey)
      .sort((left, right) => left.date.localeCompare(right.date))[0] ?? null
  const hasPlan = (planDays?.length ?? 0) > 0

  const completionDateSet = new Set(completionDates)
  const completedBlockCount = todaySession
    ? todaySession.blocks.filter((block) => progress.completedBlockIds.includes(block.id)).length
    : 0
  const todayDone =
    completionDateSet.has(todayKey) ||
    todaySession?.status === "completed" ||
    Boolean(todaySession && todaySession.blocks.length > 0 && completedBlockCount === todaySession.blocks.length)
  const inProgress = !todayDone && (completedBlockCount > 0 || todaySession?.status === "in-progress")
  const nextActionLabel = todayDone ? "Review workout" : inProgress ? "Resume workout" : "Start workout"

  const loadingToday = isSupabase && !backendLoaded
  const athleteNeedsGuide = isSupabase && backendLoaded && !backendSessionDetail?.session.id

  /* Week ------------------------------------------------------------ */
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startOfWeek)
    date.setDate(startOfWeek.getDate() + index)
    const key = dateKeyLocal(date)
    const planned =
      (planDays ?? []).some((day) => day.date.slice(0, 10) === key) || (currentSession !== null && sessionDateKey === key)
    return {
      key,
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      longLabel: date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }),
      day: date.getDate(),
      completed: completionDateSet.has(key) || (key === todayKey && todayDone),
      planned,
      isToday: key === todayKey,
    }
  })
  const doneThisWeek = week.filter((day) => day.completed).length
  const plannedThisWeek = week.filter((day) => day.planned || day.completed).length
  const weekSummary = hasPlan
    ? plannedThisWeek > 0
      ? `${doneThisWeek} of ${plannedThisWeek} sessions done`
      : "No sessions planned this week"
    : doneThisWeek > 0
      ? `${doneThisWeek} ${doneThisWeek === 1 ? "session" : "sessions"} done`
      : "Nothing logged yet this week"

  /* To do ----------------------------------------------------------- */
  const utcTodayKey = now.toISOString().slice(0, 10)
  const wellnessKnown = isSupabase ? wellnessDates !== null : true
  const wellnessDoneToday = isSupabase
    ? Boolean(wellnessDates?.some((date) => date === todayKey || date === utcTodayKey))
    : false
  const showWellnessTodo = wellnessKnown && !wellnessDoneToday
  const openTestWeek =
    isSupabase && testWeek && !testWeek.lastSubmittedAt && testWeek.tests.length > 0 && testWeek.endDate.slice(0, 10) >= todayKey
      ? testWeek
      : null
  const showMockTestWeekTodo = !isSupabase && !mockTestWeekSubmitted
  const todoCount = [showWellnessTodo, Boolean(openTestWeek), showMockTestWeekTodo, Boolean(overdueSession)].filter(Boolean).length

  const firstName = displayName.trim().split(/\s+/)[0] || backendSessionDetail?.athleteFirstName || ""
  const weekdayName = now.toLocaleDateString(undefined, { weekday: "long" })
  const dateLine = now.toLocaleDateString(undefined, { day: "numeric", month: "long" })
  const title = firstName && firstName !== "Athlete" ? `Hey, ${firstName}` : weekdayName
  const lede = firstName && firstName !== "Athlete" ? `${weekdayName}, ${dateLine}` : dateLine

  const toggleGuide = async (dismissed: boolean) => {
    setSetupGuideSaving(true)
    const result = await setCurrentAthleteSetupGuideDismissed(dismissed)
    setSetupGuideSaving(false)
    if (!result.ok) {
      setBackendError((current) => current ?? result.error.message)
      return
    }
    setSetupGuideDismissedAt(dismissed ? new Date().toISOString() : null)
  }

  const startButton = (
    <Link to="/athlete/log" className="sk-btn sk-btn-primary hidden h-12 px-6 text-base lg:inline-flex">
      {todayDone ? <CheckCircle className="size-5" weight="fill" /> : <Play className="size-5" weight="fill" />}
      {nextActionLabel}
    </Link>
  )

  return (
    <div className="sk-page">
      <PageHeader title={title} lede={lede} />

      {backendError ? (
        <div role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
          We could not load your session. {backendError}
        </div>
      ) : null}

      {athleteNeedsGuide && !setupGuideDismissedAt ? (
        <section aria-label="Getting started" className="rounded-[20px] bg-sk-yellow-tint p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="sk-h2">Three things to get set up</h2>
              <p className="mt-1 max-w-[52ch] text-sm leading-relaxed text-sk-ink-2">
                Your coach has not sent a session yet. Use the time to get your details right.
              </p>
            </div>
            <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm self-start" disabled={setupGuideSaving} onClick={() => void toggleGuide(true)}>
              {setupGuideSaving ? "Saving..." : "Hide these steps"}
            </button>
          </div>
          <ol className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              {
                step: 1,
                title: "Check your profile",
                body: "Make sure your team, event group and name are right.",
                links: [{ to: "/athlete/profile", label: "Open profile" }],
              },
              {
                step: 2,
                title: "Do a wellness check-in",
                body: "It takes a minute and tells your coach how ready you are.",
                links: [{ to: "/athlete/wellness", label: "Check in" }],
              },
              {
                step: 3,
                title: "Look at your plan",
                body: "See what is coming once your coach assigns one.",
                links: [{ to: "/athlete/training-plan", label: "Open plan" }],
              },
            ].map((item) => (
              <li key={item.step} className="flex flex-col gap-3 rounded-2xl bg-white p-4">
                <span className="flex size-9 items-center justify-center rounded-full bg-sk-blue text-sm font-extrabold text-white">{item.step}</span>
                <div>
                  <p className="sk-h3">{item.title}</p>
                  <p className="mt-1 text-sm text-sk-mute">{item.body}</p>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  {item.links.map((link) => (
                    <Link key={link.to} to={link.to} className="sk-btn sk-btn-quiet sk-btn-sm">
                      {link.label}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {athleteNeedsGuide && setupGuideDismissedAt ? (
        <div className="flex flex-col gap-3 rounded-[20px] border border-sk-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-sk-ink">Setup steps are hidden.</p>
          <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm self-start" disabled={setupGuideSaving} onClick={() => void toggleGuide(false)}>
            {setupGuideSaving ? "Saving..." : "Show setup steps"}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        {/* What am I doing today */}
        <section aria-label="Today" className="sk-card">
          {loadingToday ? (
            <p className="py-6 text-sk-mute">Getting today ready...</p>
          ) : todaySession ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="sk-label">Today</p>
                {todayDone ? (
                  <Tag tone="green">
                    <Check className="size-3.5" weight="bold" />
                    Completed
                  </Tag>
                ) : null}
              </div>
              <h2 className="mt-2 text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.035em] text-sk-ink sm:text-[2.25rem]">
                {todaySession.title}
              </h2>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold text-sk-ink-2">
                {todaySession.estimatedDuration ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Timer className="size-4 text-sk-mute" weight="bold" />
                    {todaySession.estimatedDuration}
                  </span>
                ) : null}
                {todaySession.blocks.length > 0 ? (
                  <span>
                    {inProgress
                      ? `${completedBlockCount} of ${todaySession.blocks.length} blocks done`
                      : `${todaySession.blocks.length} ${todaySession.blocks.length === 1 ? "block" : "blocks"}`}
                  </span>
                ) : null}
              </p>

              {todaySession.coachNote ? (
                <p className="mt-4 rounded-2xl bg-sk-canvas p-4 text-sm leading-relaxed text-sk-ink-2">
                  <span className="font-bold text-sk-ink">Coach says: </span>
                  {todaySession.coachNote}
                </p>
              ) : null}

              {todaySession.blocks.length > 0 ? (
                <ol className="mt-4">
                  {todaySession.blocks.map((block) => {
                    const blockDone = todayDone || progress.completedBlockIds.includes(block.id)
                    return (
                      <li key={block.id} className="flex items-center gap-3 border-b border-sk-line py-3.5 last:border-b-0">
                        <span
                          className={cn(
                            "flex size-11 shrink-0 items-center justify-center rounded-2xl",
                            blockDone ? "bg-sk-green-tint text-[#07673f]" : "bg-sk-blue-tint text-sk-blue",
                          )}
                        >
                          {blockDone ? <Check className="size-5" weight="bold" /> : <BlockIcon type={block.type} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold text-sk-ink">{block.name}</span>
                          {block.rows[0]?.target || block.focus ? (
                            <span className="block truncate text-sm text-sk-mute">{block.rows.length > 0 ? block.rows.map((row) => row.target).filter((target, index, all) => all.indexOf(target) === index).join(", ") : block.focus}</span>
                          ) : null}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="mt-4 text-sm text-sk-mute">Your coach has not added the detail for this session yet.</p>
              )}

              <div className="mt-5 hidden lg:block">{startButton}</div>
            </>
          ) : planDayToday ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="sk-label">Today</p>
                {todayDone ? (
                  <Tag tone="green">
                    <Check className="size-3.5" weight="bold" />
                    Completed
                  </Tag>
                ) : null}
              </div>
              <h2 className="mt-2 text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.035em] text-sk-ink sm:text-[2.25rem]">
                {planDayToday.title}
              </h2>
              {planDayToday.focus ? <p className="mt-2 text-sk-ink-2">{planDayToday.focus}</p> : null}
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold text-sk-ink-2">
                {planDayToday.durationMinutes ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Timer className="size-4 text-sk-mute" weight="bold" />
                    {planDayToday.durationMinutes} min
                  </span>
                ) : null}
                {planDayToday.location ? (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-4 text-sk-mute" weight="bold" />
                    {planDayToday.location}
                  </span>
                ) : null}
              </p>
              {planDayToday.coachNote ? (
                <p className="mt-4 rounded-2xl bg-sk-canvas p-4 text-sm leading-relaxed text-sk-ink-2">
                  <span className="font-bold text-sk-ink">Coach says: </span>
                  {planDayToday.coachNote}
                </p>
              ) : null}
              {planDayToday.blockPreview.length > 0 ? (
                <ol className="mt-4">
                  {planDayToday.blockPreview.map((block, index) => (
                    <li key={`${index}-${block}`} className="flex items-center gap-3 border-b border-sk-line py-3 last:border-b-0">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-sk-blue-tint text-sm font-extrabold text-sk-blue">
                        {index + 1}
                      </span>
                      <span className="min-w-0 font-semibold text-sk-ink">{block}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
              {planDaysToday.length > 1 ? (
                <p className="mt-3 text-sm text-sk-mute">
                  Plus {planDaysToday.length - 1} more today: {planDaysToday.slice(1).map((day) => day.title).join(", ")}.
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {startButton}
                <Link to="/athlete/training-plan" className="sk-btn sk-btn-ghost sk-btn-sm -ml-3 lg:ml-0">
                  See it in your plan
                  <ArrowRight className="size-4" weight="bold" />
                </Link>
              </div>
            </>
          ) : hasPlan ? (
            <div className="flex flex-col items-start gap-3">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-sk-green-tint text-[#07673f]">
                <MoonStars className="size-6" weight="fill" />
              </span>
              <div>
                <p className="sk-label">Today</p>
                <h2 className="mt-1 text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.035em] text-sk-ink sm:text-[2.25rem]">Rest day</h2>
                <p className="mt-2 max-w-[46ch] text-sk-mute">
                  {nextPlanDay
                    ? `Nothing planned today. Next up is ${nextPlanDay.title} on ${longDate(nextPlanDay.date)}.`
                    : `Nothing planned today, and that is the last of ${planName ?? "your plan"}.`}
                </p>
              </div>
              <Link to="/athlete/training-plan" className="sk-btn sk-btn-quiet sk-btn-sm">
                Open your plan
              </Link>
            </div>
          ) : upcomingSession ? (
            <div className="flex flex-col items-start gap-3">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-sk-blue-tint text-sk-blue">
                <CalendarBlank className="size-6" weight="fill" />
              </span>
              <div>
                <p className="sk-label">Today</p>
                <h2 className="mt-1 text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.035em] text-sk-ink sm:text-[2.25rem]">Nothing today</h2>
                <p className="mt-2 max-w-[46ch] text-sk-mute">
                  Next up is {upcomingSession.title} on {longDate(upcomingSession.scheduledFor)}.
                </p>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<CalendarBlank className="size-6" weight="fill" />}
              title={planDays === null && isSupabase ? "No session today" : "No plan yet"}
              body={
                planDays === null && isSupabase
                  ? "When your coach schedules a session for today, it shows up here."
                  : "Your coach has not assigned you a training plan. Once they do, today's session shows up here."
              }
              action={
                <Link to="/athlete/training-plan" className="sk-btn sk-btn-quiet sk-btn-sm">
                  Open your plan
                </Link>
              }
              className="border-0 p-0"
            />
          )}
        </section>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          {/* How is my week going */}
          <Panel
            title="This week"
            hint={weekSummary}
            action={
              <Link to="/athlete/training-plan" className="sk-btn sk-btn-ghost sk-btn-sm -mr-2">
                Plan
                <ArrowRight className="size-4" weight="bold" />
              </Link>
            }
          >
            <ol className="grid grid-cols-7 gap-1">
              {week.map((day) => (
                <li
                  key={day.key}
                  aria-current={day.isToday ? "date" : undefined}
                  aria-label={`${day.longLabel}: ${day.completed ? "session done" : day.planned ? "session planned" : hasPlan ? "rest day" : "nothing logged"}`}
                  className="flex flex-col items-center gap-2"
                >
                  <span className={cn("text-xs font-bold", day.isToday ? "text-sk-blue" : "text-sk-mute")}>{day.label}</span>
                  <span
                    className={cn(
                      "flex size-10 items-center justify-center rounded-full text-sm font-extrabold tabular-nums",
                      day.completed
                        ? "bg-sk-green text-white"
                        : day.isToday
                          ? "bg-sk-blue text-white"
                          : day.planned
                            ? "border-2 border-sk-ink bg-white text-sk-ink"
                            : "bg-sk-canvas text-sk-mute",
                    )}
                  >
                    {day.completed ? <Check className="size-5" weight="bold" /> : day.day}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-sk-line pt-3 text-xs font-semibold text-sk-mute">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-sk-green" /> Done
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-sk-blue" /> Today
              </span>
              {hasPlan ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full border-2 border-sk-ink" /> Planned
                </span>
              ) : null}
            </p>
          </Panel>

          {/* Is there anything I need to do */}
          <Panel title="To do">
            {todoCount > 0 ? (
              <ul className="-my-2">
                {overdueSession ? (
                  <TodoRow
                    to="/athlete/log"
                    icon={<Play className="size-5" weight="fill" />}
                    title={`Finish ${overdueSession.title}`}
                    body={`Scheduled for ${longDate(overdueSession.scheduledFor)} and not logged yet.`}
                  />
                ) : null}
                {showWellnessTodo ? (
                  <TodoRow
                    to="/athlete/wellness"
                    icon={<Heartbeat className="size-5" weight="bold" />}
                    title="Do today's wellness check-in"
                    body="Sleep, soreness and mood. It takes a minute."
                  />
                ) : null}
                {openTestWeek ? (
                  <TodoRow
                    to="/athlete/test-week"
                    icon={<ClipboardText className="size-5" weight="bold" />}
                    title={`Enter your results for ${openTestWeek.testWeekName}`}
                    body={`${openTestWeek.tests.length} ${openTestWeek.tests.length === 1 ? "test" : "tests"}, open until ${longDate(openTestWeek.endDate)}.`}
                  />
                ) : null}
                {showMockTestWeekTodo ? (
                  <TodoRow
                    to="/athlete/test-week"
                    icon={<ClipboardText className="size-5" weight="bold" />}
                    title="Enter your test week results"
                    body="Your coach is waiting on these."
                  />
                ) : null}
              </ul>
            ) : wellnessKnown ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-[#07673f]">
                <CheckCircle className="size-5" weight="fill" />
                Check-in done, nothing else waiting.
              </p>
            ) : (
              <p className="text-sm text-sk-mute">Checking...</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
