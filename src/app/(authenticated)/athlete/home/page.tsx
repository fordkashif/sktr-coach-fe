"use client"

import { useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Dumbbell01Icon,
  Fire03Icon,
  RepeatIcon,
} from "@hugeicons/core-free-icons"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { mockCurrentSession } from "@/lib/mock-data"
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
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

type PreviewBlock = {
  id: string
  label: string
  helper: string
  value: string
  tone: string
  glyph: "clock" | "strength" | "repeat"
}

export default function AthleteHomePage() {
  const backendMode = getBackendMode()
  const [now, setNow] = useState(() => new Date())
  const [backendSessionDetail, setBackendSessionDetail] = useState<CurrentAthleteLatestSessionDetail | null>(null)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [progress, setProgress] = useState<SessionProgress>(() => {
    if (typeof window === "undefined") return defaultSessionProgress()
    return progressForCurrentSession(window.localStorage.getItem(tenantStorageKey(SESSION_PROGRESS_STORAGE_KEY)))
  })
  const [completionDates, setCompletionDates] = useState<string[]>(() => {
    if (typeof window === "undefined") return []
    return parseSessionCompletions(window.localStorage.getItem(tenantStorageKey(SESSION_COMPLETIONS_STORAGE_KEY)))
  })

  useEffect(() => {
    if (typeof window === "undefined") return

    const syncProgress = () => {
      setProgress(progressForCurrentSession(window.localStorage.getItem(tenantStorageKey(SESSION_PROGRESS_STORAGE_KEY))))
      setCompletionDates(parseSessionCompletions(window.localStorage.getItem(tenantStorageKey(SESSION_COMPLETIONS_STORAGE_KEY))))
    }

    syncProgress()
    window.addEventListener("focus", syncProgress)
    window.addEventListener("storage", syncProgress)

    return () => {
      window.removeEventListener("focus", syncProgress)
      window.removeEventListener("storage", syncProgress)
    }
  }, [])

  useEffect(() => {
    if (backendMode !== "supabase") return
    let cancelled = false

    const loadSessionDetail = async () => {
      const result = await getLatestSessionDetailForCurrentAthlete()
      if (cancelled) return
      if (!result.ok) {
        setBackendError(result.error.message)
        return
      }
      setBackendError(null)
      setBackendSessionDetail(result.data)
    }

    void loadSessionDetail()
    return () => {
      cancelled = true
    }
  }, [backendMode])

  const currentSession =
    backendMode === "supabase" && backendSessionDetail
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
            : "N/A",
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
      : mockCurrentSession

  useEffect(() => {
    if (typeof window === "undefined") return
    setProgress(
      progressForCurrentSession(window.localStorage.getItem(tenantStorageKey(SESSION_PROGRESS_STORAGE_KEY)), {
        sessionId: currentSession.id,
        blockCount: currentSession.blocks.length,
      }),
    )
  }, [currentSession.id, currentSession.blocks.length])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  const completedCount = progress.completedBlockIds.length
  const allComplete = currentSession.status === "completed" || completedCount === currentSession.blocks.length
  const nextActionLabel = allComplete ? "Review Workout" : completedCount > 0 ? "Resume Workout" : "Start Workout"
  const completionDateSet = new Set(completionDates)

  const startOfWeek = new Date(now)
  const dayOffset = (startOfWeek.getDay() + 6) % 7
  startOfWeek.setDate(startOfWeek.getDate() - dayOffset)
  startOfWeek.setHours(0, 0, 0, 0)
  const weekStartKey = dateKeyLocal(startOfWeek)
  const weekEnd = new Date(startOfWeek)
  weekEnd.setDate(startOfWeek.getDate() + 4)
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
      setCompletionDates(result.data.map((item) => item.completionDate))
    }

    void loadWeeklyCompletions()

    return () => {
      cancelled = true
    }
  }, [backendMode, weekStartKey, weekEndKey])

  const weeklyCompletions = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(startOfWeek)
    date.setDate(startOfWeek.getDate() + index)
    const key = dateKeyLocal(date)
    return {
      key,
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      day: `${date.getDate()}`,
      completed: completionDateSet.has(key) || (backendMode !== "supabase" && index <= 2),
      isToday: key === dateKeyLocal(now),
    }
  })

  const previewBlocks: PreviewBlock[] = currentSession.blocks.slice(0, 4).map((block, index) => ({
    id: block.id,
    label: block.name,
    helper: block.rows[0]?.target ?? "",
    value: block.rows.length > 0 ? `${block.rows.length} rows` : block.focus || "Programmed",
    tone: index % 2 === 0 ? "bg-[#eaf4ff]" : "bg-[#eef2ff]",
    glyph:
      block.type === "Strength"
        ? "strength"
        : block.type === "Run"
          ? "repeat"
          : block.type === "Sprint"
            ? "clock"
            : "repeat",
  }))

  return (
    <div className="mx-auto min-h-[calc(100dvh-env(safe-area-inset-top)-2rem)] w-full max-w-7xl px-4 pb-6 pt-4 sm:min-h-0 sm:p-6">
      <section className="flex min-h-full max-w-xl flex-col">
        <div className="flex min-h-full flex-col">
          {backendError ? (
            <div className="mb-4 rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              Backend sync issue: {backendError}
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-4 pb-4">
            <div className="space-y-3">
              <h1 className="text-[2.2rem] leading-[0.95] font-semibold tracking-[-0.07em] text-slate-950 sm:text-[2.6rem]">
                Hey, {backendSessionDetail?.athleteFirstName ?? "Athlete"}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full bg-[#f5ecff] px-3 py-1 text-xs font-medium text-slate-700 shadow-[0_6px_14px_rgba(15,23,42,0.04)]">
                  Stretch: +8%
                </span>
                <span className="inline-flex rounded-full bg-[#eef5ff] px-3 py-1 text-xs font-medium text-slate-700 shadow-[0_6px_14px_rgba(15,23,42,0.04)]">
                  Endurance: +4%
                </span>
              </div>
            </div>
            <div className="shrink-0 rounded-[22px] border border-slate-200 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              <div className="flex items-center gap-2 text-slate-950">
                <HugeiconsIcon icon={Fire03Icon} className="size-4 text-[#ff7a2f]" />
                <span className="text-xl font-semibold tracking-[-0.04em]">11</span>
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <p className="text-[3rem] leading-none font-medium tracking-[-0.07em] text-slate-950">
              {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </p>
            <div className="inline-flex rounded-full bg-[#eef5ff] px-3 py-1 text-sm font-medium text-slate-700">
              Lower Body
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <HugeiconsIcon icon={Clock01Icon} className="size-3.5 text-slate-400" />
                {currentSession.estimatedDuration}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <HugeiconsIcon icon={Fire03Icon} className="size-3.5 text-[#ff7a2f]" />
                234 kcal
              </span>
            </div>
          </div>

          <div className="mt-auto pt-6">
            <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {allComplete ? (
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-5 text-emerald-600" />
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="size-2.5 rounded-full bg-[#1368ff]" />
                      <span className="size-2.5 rounded-full bg-[#0f172a]" />
                    </div>
                  )}
                    <p className="text-[1.2rem] font-semibold tracking-[-0.04em] text-slate-950">
                      {allComplete ? "Session Completed" : "Today's Workout"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Open workout"
                  className="flex size-10 items-center justify-center rounded-[16px] border border-slate-200 bg-white text-slate-600 shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
                >
                  <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
                </button>
              </div>

              {allComplete ? (
                <div className="relative mt-4 overflow-hidden rounded-[22px] border border-[#99f6cf] bg-[linear-gradient(140deg,#f7fffb_0%,#ebfff5_48%,#e6fff9_100%)] px-4 py-4 shadow-[0_14px_34px_rgba(16,185,129,0.15)]">
                  <div className="pointer-events-none absolute -top-10 -right-8 h-24 w-24 rounded-full bg-[#34d399]/20 blur-2xl" />
                  <div className="pointer-events-none absolute -bottom-10 -left-8 h-24 w-24 rounded-full bg-[#10b981]/15 blur-2xl" />
                  <div className="relative flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700/80">Completed</p>
                      <p className="mt-1 text-base font-semibold text-emerald-900">Today&apos;s program is done.</p>
                      <p className="mt-1.5 max-w-[30ch] text-sm text-emerald-800/85">
                        Recovery window started. Next assigned workout will show up here.
                      </p>
                    </div>
                    <span className="inline-flex rounded-full border border-emerald-300/80 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                      Locked In
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  {previewBlocks.map((block) => (
                    <div key={block.id} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`flex size-10 items-center justify-center rounded-full ${block.tone}`}>
                          {block.glyph === "clock" ? (
                            <HugeiconsIcon icon={Clock01Icon} className="size-4 text-slate-950" />
                          ) : block.glyph === "repeat" ? (
                            <HugeiconsIcon icon={RepeatIcon} className="size-4 text-slate-950" />
                          ) : (
                            <HugeiconsIcon icon={Dumbbell01Icon} className="size-4 text-slate-950" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-950">{block.label}</p>
                          {block.helper ? <p className="text-xs text-slate-500">{block.helper}</p> : null}
                        </div>
                      </div>
                      <p className="text-sm font-semibold text-slate-950">{block.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
              <p className="text-sm font-semibold text-slate-950">Week Completion</p>
              <p className="mt-1 text-xs text-slate-500">Checked days show completed training sessions.</p>
              <div className="mt-3 grid grid-cols-5 gap-2">
                {weeklyCompletions.map((day) => (
                  <div
                    key={day.key}
                    className={`rounded-[14px] border px-2 py-2 text-center ${
                      day.completed ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"
                    } ${day.isToday ? "ring-1 ring-[#1f8cff]/40" : ""}`}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{day.label}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-950">{day.day}</p>
                    <div className="mt-1 flex justify-center">
                      {day.completed ? (
                        <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-4 text-emerald-600" />
                      ) : (
                        <span className="size-4 rounded-full border border-slate-300 bg-white" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Button
              asChild
              className="mt-4 hidden h-[60px] w-full rounded-[28px] bg-[linear-gradient(135deg,rgba(7,17,34,0.94)_0%,rgba(9,20,39,0.92)_100%)] px-5 text-base font-semibold text-white shadow-[0_20px_60px_rgba(5,12,24,0.34)] hover:opacity-95 sm:inline-flex"
            >
              <Link to="/athlete/log">
                {nextActionLabel}
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
