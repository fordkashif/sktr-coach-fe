"use client"

import { useEffect, useState } from "react"
import { Check, Play } from "@phosphor-icons/react"
import { MyAvailabilityNotice } from "@/components/athlete/availability"
import { NextCompetitionSection } from "@/components/athlete/next-competition"
import {
  Button,
  DayStrip,
  EmptyState,
  HeroAction,
  HeroBlock,
  LinkButton,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  SkeletonRows,
  Split,
  StatusDot,
  StatusText,
  type DayStripDay,
} from "@/components/sk"
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

function greeting(date: Date) {
  const hour = date.getHours()
  return hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening"
}

const SETUP_STEPS = [
  { to: "/athlete/profile", title: "Check your profile", body: "Make sure your team, event group and name are right." },
  { to: "/athlete/wellness", title: "Do a wellness check-in", body: "It takes a minute and tells your coach how ready you are." },
  { to: "/athlete/training-plan", title: "Look at your plan", body: "See what is coming once your coach assigns one." },
]

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
  const nextActionLabel = todayDone ? "Review session" : inProgress ? "Resume session" : "Start session"

  const loadingToday = isSupabase && !backendLoaded
  const athleteNeedsGuide = isSupabase && backendLoaded && !backendSessionDetail?.session.id

  /* Week ------------------------------------------------------------ */
  const week: DayStripDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startOfWeek)
    date.setDate(startOfWeek.getDate() + index)
    const key = dateKeyLocal(date)
    const isToday = key === todayKey
    const planned =
      (planDays ?? []).some((day) => day.date.slice(0, 10) === key) || (currentSession !== null && sessionDateKey === key)
    const completed = completionDateSet.has(key) || (isToday && todayDone)
    const state: DayStripDay["state"] = completed ? "done" : isToday ? "today" : planned ? "planned" : "rest"
    const longLabel = date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    return {
      key,
      letter: date.toLocaleDateString(undefined, { weekday: "narrow" }),
      number: date.getDate(),
      state,
      isToday,
      label: `${longLabel}: ${completed ? "session done" : planned ? "session planned" : hasPlan ? "rest day" : "nothing logged"}`,
    }
  })
  const doneThisWeek = week.filter((day) => day.state === "done").length
  const plannedThisWeek = week.filter((day) => day.state !== "rest").length
  const weekSummary = hasPlan
    ? plannedThisWeek > 0
      ? `${doneThisWeek} of ${plannedThisWeek} done`
      : "Nothing planned"
    : doneThisWeek > 0
      ? `${doneThisWeek} done`
      : "Nothing logged yet"

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
  const coachNote = (!todayDone && (todaySession?.coachNote || planDayToday?.coachNote)) || ""
  const todoCount = [showWellnessTodo, Boolean(openTestWeek), showMockTestWeekTodo, Boolean(overdueSession), Boolean(coachNote)].filter(Boolean).length

  const firstName = displayName.trim().split(/\s+/)[0] || backendSessionDetail?.athleteFirstName || ""
  const title = firstName && firstName !== "Athlete" ? `${greeting(now)}, ${firstName}` : `Good ${greeting(now).toLowerCase()}`
  const dateLine = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })

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

  /* Today: the one colour block, only when there is a session to do --- */
  const sessionSummary = todaySession
    ? todaySession.blocks
        .flatMap((block) => (block.rows.length > 0 ? block.rows.map((row) => `${row.label} ${row.target}`) : [block.name]))
        .join(", ")
    : planDayToday
      ? planDayToday.blockPreview.join(", ") || planDayToday.focus
      : ""
  const sessionMeta = todaySession
    ? inProgress && todaySession.blocks.length > 0
      ? `${completedBlockCount} of ${todaySession.blocks.length} blocks done`
      : todaySession.estimatedDuration
    : planDayToday?.durationMinutes
      ? `${planDayToday.durationMinutes} min`
      : null
  const heroSession = todaySession ?? planDayToday

  return (
    <Screen>
      <ScreenHeader fact={dateLine} title={title} />

      <MyAvailabilityNotice />

      {backendError ? <Notice tone="error">We could not load your session. {backendError}</Notice> : null}

      {athleteNeedsGuide && !setupGuideDismissedAt ? (
        <Section
          aria-label="Getting started"
          title="Three things to get set up"
          hint="Your coach has not sent a session yet. Use the time to get your details right."
          action={
            <Button variant="quiet" size="sm" disabled={setupGuideSaving} onClick={() => void toggleGuide(true)}>
              {setupGuideSaving ? "Saving..." : "Hide these steps"}
            </Button>
          }
        >
          <List ordered>
            {SETUP_STEPS.map((step, index) => (
              <ListRow key={step.to} to={step.to} leading={<span className="w-5 text-center font-bold text-sk-blue-link">{index + 1}</span>} title={step.title} subtitle={step.body} />
            ))}
          </List>
        </Section>
      ) : null}

      {athleteNeedsGuide && setupGuideDismissedAt ? (
        <Notice
          action={
            <Button variant="quiet" size="sm" disabled={setupGuideSaving} onClick={() => void toggleGuide(false)}>
              {setupGuideSaving ? "Saving..." : "Show setup steps"}
            </Button>
          }
        >
          Setup steps are hidden.
        </Notice>
      ) : null}

      <Split
        main={
          loadingToday ? (
            <Section aria-label="Today" title="Today">
              <SkeletonRows rows={2} label="Getting today ready" />
            </Section>
          ) : heroSession ? (
            <HeroBlock
              label={todayDone ? "Today's session, done" : "Today's session"}
              meta={sessionMeta}
              title={heroSession.title}
              body={
                sessionSummary ||
                (todaySession ? "Your coach has not added the detail for this session yet." : undefined)
              }
              action={
                <HeroAction to="/athlete/log">
                  {todayDone ? <Check className="size-[18px]" weight="bold" aria-hidden /> : <Play className="size-[18px]" weight="fill" aria-hidden />}
                  {nextActionLabel}
                </HeroAction>
              }
            />
          ) : (
            <Section aria-label="Today" title={hasPlan ? "Rest day" : upcomingSession ? "Nothing today" : planDays === null && isSupabase ? "No session today" : "No plan yet"}>
              <EmptyState
                title={
                  hasPlan
                    ? nextPlanDay
                      ? `Next up is ${nextPlanDay.title} on ${longDate(nextPlanDay.date)}.`
                      : `That was the last session of ${planName ?? "your plan"}.`
                    : upcomingSession
                      ? `Next up is ${upcomingSession.title} on ${longDate(upcomingSession.scheduledFor)}.`
                      : planDays === null && isSupabase
                        ? "When your coach schedules a session for today, it shows up here."
                        : "Your coach has not assigned you a training plan yet."
                }
                body={hasPlan || upcomingSession ? "Nothing is planned for today." : "Once they do, today's session shows up here."}
                action={
                  <LinkButton to="/athlete/training-plan" size="sm">
                    Open your plan
                  </LinkButton>
                }
              />
            </Section>
          )
        }
        side={
          <Section title="This week" meta={weekSummary}>
            <DayStrip days={week} aria-label="This week" className="mt-1" />
            {planDaysToday.length > 1 ? (
              <p className="mt-3 text-sm text-sk-mute">
                Also today: {planDaysToday.slice(1).map((day) => day.title).join(", ")}.
              </p>
            ) : null}
          </Section>
        }
      />

      <Section title="To do">
        {todoCount > 0 ? (
          <List>
            {overdueSession ? (
              <ListRow
                to="/athlete/log"
                leading={<StatusDot tone="coral" />}
                title={`Finish ${overdueSession.title}`}
                subtitle={`Planned for ${longDate(overdueSession.scheduledFor)}, not logged yet`}
              />
            ) : null}
            {showWellnessTodo ? (
              <ListRow to="/athlete/wellness" leading={<StatusDot tone="coral" />} title="Wellness check-in" subtitle="Sleep, soreness and mood. It takes a minute." />
            ) : null}
            {openTestWeek ? (
              <ListRow
                to="/athlete/test-week"
                leading={<StatusDot tone="yellow" />}
                title={openTestWeek.testWeekName}
                subtitle={`${openTestWeek.tests.length} ${openTestWeek.tests.length === 1 ? "result" : "results"} to enter, closes ${longDate(openTestWeek.endDate)}`}
              />
            ) : null}
            {showMockTestWeekTodo ? (
              <ListRow to="/athlete/test-week" leading={<StatusDot tone="yellow" />} title="Test week results" subtitle="Your coach is waiting on these" />
            ) : null}
            {coachNote ? <ListRow to="/athlete/log" leading={<StatusDot tone="blue" />} title="Note from your coach" subtitle={coachNote} /> : null}
          </List>
        ) : wellnessKnown ? (
          <p className="py-3.5">
            <StatusText tone="green">Check-in done, nothing else waiting.</StatusText>
          </p>
        ) : (
          <SkeletonRows rows={2} label="Checking what is left to do" />
        )}
      </Section>

      <NextCompetitionSection />
    </Screen>
  )
}
