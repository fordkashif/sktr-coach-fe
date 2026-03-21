"use client"

import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { getCurrentAthleteProfileSnapshot } from "@/lib/data/athlete/profile-data"
import { getAssignedTrainingPlansForCurrentAthlete, getTrainingPlanDetail } from "@/lib/data/training-plan/training-plan-data"
import type { TrainingPlanDay, TrainingPlanDetail, TrainingPlanSummary } from "@/lib/data/training-plan/types"
import { tenantStorageKey } from "@/lib/tenant-storage"
import {
  mockAthleteTrainingPlanDetails,
  mockAthletes,
  mockTrainingPlans,
} from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"
import { cn } from "@/lib/utils"

const ASSIGNMENT_STORAGE_KEY = "pacelab:plan-assignments"

interface PlanAssignment {
  planId: string
  scope: "team" | "athlete"
  teamId: string
  athleteId?: string
}

function planRangeLabel(startDate: string, weeks: number) {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(start)
  end.setDate(start.getDate() + weeks * 7 - 1)
  return `${start.toLocaleDateString(undefined, { month: "long", day: "numeric" })} - ${end.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`
}

function formatDayDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

const typeToneMap: Record<TrainingPlanDay["sessionType"], string> = {
  Track: "bg-[#dbeafe] text-[#1d4ed8]",
  Gym: "bg-[#ede9fe] text-[#6d28d9]",
  Recovery: "bg-[#dcfce7] text-[#15803d]",
  Technical: "bg-[#fef3c7] text-[#b45309]",
  Mixed: "bg-[#fee2e2] text-[#be123c]",
}

export default function AthleteTrainingPlanPage() {
  const backendMode = getBackendMode()
  const athlete = mockAthletes[0]
  const [selectedWeekNumber, setSelectedWeekNumber] = useState<number | null>(null)
  const [backendPlans, setBackendPlans] = useState<TrainingPlanSummary[]>([])
  const [backendPlanDetail, setBackendPlanDetail] = useState<TrainingPlanDetail | null>(null)
  const [backendTeamName, setBackendTeamName] = useState<string | null>(null)
  const [backendLoading, setBackendLoading] = useState(false)
  const [backendError, setBackendError] = useState<string | null>(null)
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
    const base = mockTrainingPlans.filter(
      (plan) => plan.teamId === athlete.teamId || (plan.assignedTo === "athlete" && plan.assignedAthleteIds?.includes(athlete.id)),
    )

    const fromAssignments = storageAssignments
      .filter((assignment) => {
        if (assignment.scope === "team") return assignment.teamId === athlete.teamId
        return assignment.athleteId === athlete.id
      })
      .map((assignment) => mockTrainingPlans.find((plan) => plan.id === assignment.planId))
      .filter((plan): plan is (typeof mockTrainingPlans)[number] => Boolean(plan))

    const deduped = new Map([...base, ...fromAssignments].map((plan) => [plan.id, plan]))
    return [...deduped.values()]
  }, [athlete.id, athlete.teamId, storageAssignments])

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
        setBackendError((current) => current ?? profileResult.error.message)
        return
      }
      setBackendTeamName(profileResult.data.teamName)
    }

    void loadProfile()
    return () => {
      cancelled = true
    }
  }, [backendMode])

  const activePlan =
    backendMode === "supabase"
      ? backendPlans[0] ?? null
      : ((mockPlans[0]
          ? {
              id: mockPlans[0].id,
              name: mockPlans[0].name,
              teamId: mockPlans[0].teamId,
              startDate: mockPlans[0].startDate,
              weeks: mockPlans[0].weeks,
              status: "published",
            }
          : null) satisfies TrainingPlanSummary | null)

  useEffect(() => {
    if (backendMode !== "supabase") return
    if (!activePlan?.id) {
      setBackendPlanDetail(null)
      return
    }

    let cancelled = false
    const loadDetail = async () => {
      const result = await getTrainingPlanDetail(activePlan.id)
      if (cancelled) return
      if (!result.ok) {
        setBackendError(result.error.message)
        setBackendPlanDetail(null)
        return
      }
      setBackendPlanDetail(result.data)
    }

    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [activePlan?.id, backendMode])

  const activePlanDetail = useMemo<TrainingPlanDetail | null>(() => {
    if (backendMode === "supabase") return backendPlanDetail
    const mockDetail = mockAthleteTrainingPlanDetails.find((detail) => detail.planId === activePlan?.id)
    if (!mockDetail) return null

    return {
      planId: mockDetail.planId,
      weeks: mockDetail.weeks.map((week) => ({
        id: `${mockDetail.planId}-week-${week.weekNumber}`,
        weekNumber: week.weekNumber,
        emphasis: week.emphasis,
        status: week.status,
        days: week.days.map((day) => ({
          id: day.id,
          dayIndex: Number.parseInt(day.id.split("-").at(-1) ?? "0", 10) || 0,
          dayLabel: day.dayLabel,
          date: day.date,
          title: day.title,
          sessionType: day.type,
          focus: day.focus,
          status: day.status,
          durationMinutes: Number.parseInt(day.duration, 10) || null,
          location: day.location,
          coachNote: day.coachNote ?? null,
          blockPreview: day.blockPreview,
        })),
      })),
    }
  }, [activePlan?.id, backendMode, backendPlanDetail])

  const currentWeek = activePlanDetail?.weeks.find((week) => week.status === "current") ?? activePlanDetail?.weeks[0] ?? null
  const selectedWeek =
    activePlanDetail?.weeks.find((week) => week.weekNumber === selectedWeekNumber) ??
    currentWeek ??
    null
  const teamLabel = backendMode === "supabase" ? backendTeamName ?? "Assigned team" : "Assigned team"

  useEffect(() => {
    setSelectedWeekNumber(null)
  }, [activePlan?.id])

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 pb-6 pt-4 sm:px-6 sm:pt-6">
      {backendMode === "supabase" && backendLoading ? (
        <section className="rounded-[26px] border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-[0_18px_48px_rgba(15,23,42,0.06)] sm:rounded-[30px]">
          Loading assigned plans...
        </section>
      ) : backendMode === "supabase" && backendError ? (
        <section className="rounded-[26px] border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-[0_18px_48px_rgba(15,23,42,0.06)] sm:rounded-[30px]">
          Failed to load plans: {backendError}
        </section>
      ) : activePlan && activePlanDetail && selectedWeek ? (
        <>
          <section className="space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full bg-[#eef5ff] px-3 py-1 text-xs font-medium text-slate-700">
                  {teamLabel}
                </span>
                <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  {activePlan.weeks} weeks
                </span>
              </div>
              <h1 className="text-[2.15rem] leading-[0.95] font-semibold tracking-[-0.07em] text-slate-950 sm:text-[2.5rem]">
                {activePlan.name}
              </h1>
              <p className="text-base leading-7 text-slate-600">{planRangeLabel(activePlan.startDate, activePlan.weeks)}</p>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Current week", value: `Week ${selectedWeek.weekNumber}` },
                  { label: "Days", value: `${selectedWeek.days.length}` },
                  { label: "Status", value: selectedWeek.status === "current" ? "Live" : selectedWeek.status === "completed" ? "Done" : "Next" },
                ].map((item) => (
                  <div key={item.label} className="rounded-[18px] bg-[#f8fafc] px-3 py-3 text-center">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                    <p className="mt-1 text-lg font-semibold tracking-[-0.04em] text-slate-950">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-[20px] bg-[#031733] px-4 py-4 text-white">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8db8ff]">Week emphasis</p>
                <p className="mt-2 text-sm text-white/80">{selectedWeek.emphasis ?? "No emphasis set."}</p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Week Navigation</p>
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Plan Weeks</h2>
              </div>
              <Button asChild variant="outline" className="h-11 rounded-full border-slate-200 px-4 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950">
                <Link to="/athlete/log">Open Today</Link>
              </Button>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-1">
              {activePlanDetail.weeks.map((week) => {
                const isSelected = week.weekNumber === selectedWeek.weekNumber
                const statusTone =
                  week.status === "completed"
                    ? "text-emerald-700"
                    : week.status === "current"
                      ? "text-[#1368ff]"
                      : "text-slate-400"

                return (
                  <button
                    key={`${activePlan.id}-week-${week.weekNumber}`}
                    type="button"
                    onClick={() => setSelectedWeekNumber(week.weekNumber)}
                    className={cn(
                      "min-w-[200px] rounded-[22px] border px-4 py-4 text-left transition",
                      isSelected ? "border-[#1f8cff] bg-[#eef5ff]" : "border-slate-200 bg-white",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-950">Week {week.weekNumber}</p>
                        <p className="mt-1 text-sm text-slate-500">{week.emphasis ?? "No emphasis set."}</p>
                      </div>
                      <span className={cn("text-xs font-semibold uppercase tracking-[0.14em]", statusTone)}>
                        {week.status === "completed" ? "Done" : week.status === "current" ? "Current" : "Next"}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="space-y-3">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Week {selectedWeek.weekNumber}</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Daily Schedule</h2>
            </div>

            {selectedWeek.days.map((day) => {
              const statusTone =
                day.status === "completed"
                  ? "bg-emerald-100 text-emerald-700"
                  : day.status === "scheduled"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-200 text-slate-700"

              return (
                <div key={day.id} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-950">{day.dayLabel}</p>
                        <span className="text-sm text-slate-400">{formatDayDate(day.date)}</span>
                      </div>
                      <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">{day.title}</h3>
                      <p className="mt-1 text-sm text-slate-500">{day.focus}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", typeToneMap[day.sessionType])}>{day.sessionType}</span>
                      <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", statusTone)}>
                        {day.status === "completed" ? "Completed" : day.status === "scheduled" ? "Scheduled" : "Up next"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-[16px] bg-[#f8fafc] px-3 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Duration</p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-950">{day.durationMinutes ? `${day.durationMinutes} min` : "Programmed"}</p>
                    </div>
                    <div className="rounded-[16px] bg-[#f8fafc] px-3 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Location</p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-950">{day.location ?? "TBD"}</p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[18px] bg-[#f8fafc] px-3.5 py-3.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Block preview</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {day.blockPreview.map((block) => (
                        <span key={`${day.id}-${block}`} className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600">
                          {block}
                        </span>
                      ))}
                    </div>
                  </div>

                  {day.coachNote ? (
                    <div className="mt-4 rounded-[18px] border border-[#c9dcff] bg-[#eef5ff] px-3.5 py-3.5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1f5fd1]">Coach note</p>
                      <p className="mt-1.5 text-sm text-slate-600">{day.coachNote}</p>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </section>
        </>
      ) : (
        <section className="rounded-[26px] border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-[0_18px_48px_rgba(15,23,42,0.06)] sm:rounded-[30px]">
          No assigned plans available yet.
        </section>
      )}
    </div>
  )
}
