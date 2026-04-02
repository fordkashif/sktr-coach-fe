"use client"

import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { EmptyStateCard } from "@/components/ui/empty-state-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StandardPageHeader } from "@/components/ui/standard-page-header"
import { Textarea } from "@/components/ui/textarea"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import {
  archiveTrainingPlanForCurrentCoach,
  deleteTrainingPlanForCurrentCoach,
  getCoachTrainingPlansForCurrentUser,
  getTrainingPlanDetail,
  publishTrainingPlanForCurrentCoach,
} from "@/lib/data/training-plan/training-plan-data"
import type { TrainingPlanDay, TrainingPlanDetail, TrainingPlanSummary } from "@/lib/data/training-plan/types"
import type { Role } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

type Props = {
  initialRole: Role
  initialCoachTeamId: string | null
}

type TeamOption = {
  id: string
  name: string
  athleteCount: number
  eventGroup: "Sprint" | "Mid" | "Distance" | "Jumps" | "Throws"
}

type CreateStep = 1 | 2 | 3
type SessionType = TrainingPlanDay["sessionType"]
type EventGroup = TeamOption["eventGroup"]

type ExerciseRowDraft = {
  id: string
  name: string
  sets: string
  reps: string
  load: string
  notes: string
}

type SessionBlockDraft = {
  id: string
  title: string
  detail: string
}

type SessionDayDraft = {
  id: string
  weekNumber: number
  dayIndex: number
  dayLabel: string
  date: string
  title: string
  sessionType: SessionType
  location: string
  notes: string
  exerciseRows: ExerciseRowDraft[]
  exerciseDraft: {
    name: string
    sets: string
    reps: string
    load: string
    notes: string
  }
  blocks: SessionBlockDraft[]
  blockDraft: {
    title: string
    detail: string
  }
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const SESSION_TYPE_OPTIONS: SessionType[] = ["Track", "Gym", "Recovery", "Technical", "Mixed"]
const ADVANCED_BLOCK_LIBRARY: Record<EventGroup, Array<{ title: string; detail: string }>> = {
  Sprint: [
    { title: "Acceleration", detail: "Short starts, projection work, and sled progression." },
    { title: "Weights", detail: "High-force lift pairing with low-volume accessories." },
    { title: "Tempo", detail: "Restore rhythm and tissue quality between high days." },
  ],
  Mid: [
    { title: "Threshold", detail: "Controlled aerobic power intervals." },
    { title: "Gym", detail: "Strength support with low residual fatigue." },
    { title: "Race Pace", detail: "Specific rhythm and pacing work." },
  ],
  Distance: [
    { title: "Long Run", detail: "Aerobic support and capillary work." },
    { title: "Intervals", detail: "VO2 / economy-focused interval set." },
    { title: "Mobility", detail: "Tissue maintenance and range support." },
  ],
  Jumps: [
    { title: "Approach", detail: "Run-up consistency and check-mark rhythm." },
    { title: "Takeoff", detail: "Penultimate and vertical impulse work." },
    { title: "Power", detail: "Explosive lift support for jumping qualities." },
  ],
  Throws: [
    { title: "Technical Drills", detail: "Patterning and position work." },
    { title: "Full Throws", detail: "Competition rhythm and release consistency." },
    { title: "Special Strength", detail: "Rotational or linear force support." },
  ],
}

const AVATAR_SWATCHES = [
  "bg-[#dbeafe] text-[#1d4ed8]",
  "bg-[#ede9fe] text-[#6d28d9]",
  "bg-[#e0f2fe] text-[#0369a1]",
  "bg-[#fee2e2] text-[#b91c1c]",
  "bg-[#fef3c7] text-[#b45309]",
]

function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return toInputDate(date)
}

function formatStatus(status: TrainingPlanSummary["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatShortDate(dateIso: string) {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatWeekRange(days: TrainingPlanDay[]) {
  if (days.length === 0) return "No days scheduled"
  const sortedDays = [...days].sort((left, right) => left.dayIndex - right.dayIndex)
  const start = new Date(`${sortedDays[0].date}T00:00:00`)
  const end = new Date(`${sortedDays[sortedDays.length - 1].date}T00:00:00`)
  const sameMonth = start.getMonth() === end.getMonth()
  const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const endLabel = end.toLocaleDateString(undefined, { month: sameMonth ? undefined : "short", day: "numeric" })
  return `${startLabel} - ${endLabel}`
}

function formatDraftWeekRange(days: Array<{ dayLabel: string; date: string; dayIndex: number }>) {
  if (days.length === 0) return "No days scheduled"
  const sortedDays = [...days].sort((left, right) => left.dayIndex - right.dayIndex)
  const start = new Date(`${sortedDays[0].date}T00:00:00`)
  const end = new Date(`${sortedDays[sortedDays.length - 1].date}T00:00:00`)
  const sameMonth = start.getMonth() === end.getMonth()
  const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const endLabel = end.toLocaleDateString(undefined, { month: sameMonth ? undefined : "short", day: "numeric" })
  return `${startLabel} - ${endLabel}`
}

function makeDraftId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function createDraftStructure(
  startDate: string,
  weeks: number,
  trainingDaysPerWeek: number,
  buildMode: "simple" | "advanced",
  eventGroup: EventGroup,
): SessionDayDraft[] {
  const dayLabels = DAY_LABELS.slice(0, trainingDaysPerWeek)
  const templates = ADVANCED_BLOCK_LIBRARY[eventGroup]

  return Array.from({ length: weeks }, (_, weekIndex) =>
    dayLabels.map((dayLabel, dayIndex) => {
      const template = templates[(weekIndex + dayIndex) % templates.length]
      const isSimple = buildMode === "simple"

      const sessionType: SessionType = dayIndex % 2 === 0 ? "Track" : "Gym"

      return {
        id: makeDraftId("day"),
        weekNumber: weekIndex + 1,
        dayIndex,
        dayLabel,
        date: addDays(startDate, weekIndex * 7 + dayIndex),
        title: isSimple ? `${dayLabel} session` : template.title,
        sessionType,
        location: dayIndex % 2 === 0 ? "Track" : "Weight Room",
        notes: "",
        exerciseRows: isSimple
          ? [
              {
                id: makeDraftId("exercise"),
                name: "Primary set",
                sets: "4",
                reps: "4",
                load: "",
                notes: "",
              },
            ]
          : [],
        exerciseDraft: {
          name: "",
          sets: "",
          reps: "",
          load: "",
          notes: "",
        },
        blocks: isSimple
          ? []
          : [
              {
                id: makeDraftId("block"),
                title: template.title,
                detail: template.detail,
              },
            ],
        blockDraft: {
          title: "",
          detail: "",
        },
      }
    }),
  ).flat()
}

function draftDayConfigured(day: SessionDayDraft, buildMode: "simple" | "advanced") {
  if (!day.title.trim()) return false
  if (buildMode === "simple") return day.exerciseRows.length > 0
  return day.blocks.length > 0
}

function summarizeDraftDay(day: SessionDayDraft, buildMode: "simple" | "advanced") {
  if (buildMode === "simple") {
    return day.exerciseRows
      .map((row) => [row.name, row.sets && row.reps ? `${row.sets} x ${row.reps}` : row.reps || row.sets, row.load ? `@ ${row.load}` : ""].filter(Boolean).join(" "))
      .filter(Boolean)
      .slice(0, 6)
  }
  return day.blocks.map((block) => `${block.title}${block.detail ? `: ${block.detail}` : ""}`).slice(0, 6)
}

export default function CoachTrainingPlanPageSupabaseClient({ initialRole, initialCoachTeamId }: Props) {
  const [teams, setTeams] = useState<TeamOption[]>([])
  const [plans, setPlans] = useState<TrainingPlanSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [activePlanActionId, setActivePlanActionId] = useState<string | null>(null)
  const [view, setView] = useState<"list" | "create">("list")
  const [createStep, setCreateStep] = useState<CreateStep>(1)
  const [previewPlanId, setPreviewPlanId] = useState<string | null>(null)
  const [previewDetail, setPreviewDetail] = useState<TrainingPlanDetail | null>(null)
  const [previewWeek, setPreviewWeek] = useState(1)
  const [previewSelectedDayId, setPreviewSelectedDayId] = useState<string | null>(null)

  const [name, setName] = useState("New Training Plan")
  const [teamId, setTeamId] = useState("")
  const [startDate, setStartDate] = useState(() => toInputDate(new Date()))
  const [weeks, setWeeks] = useState("4")
  const [trainingDaysPerWeek, setTrainingDaysPerWeek] = useState("5")
  const [buildMode, setBuildMode] = useState<"simple" | "advanced">("simple")
  const [notes, setNotes] = useState("")
  const [visibilityStart, setVisibilityStart] = useState<"immediate" | "scheduled">("immediate")
  const [athletePermissions, setAthletePermissions] = useState<"none" | "read-only">("none")
  const [draftDays, setDraftDays] = useState<SessionDayDraft[]>([])
  const [activeBuildWeek, setActiveBuildWeek] = useState(1)
  const [editingDraftDayId, setEditingDraftDayId] = useState<string | null>(null)

  const scopedTeamId = useMemo(
    () => (initialRole === "coach" ? initialCoachTeamId : null),
    [initialCoachTeamId, initialRole],
  )

  const previewPlan = useMemo(() => plans.find((plan) => plan.id === previewPlanId) ?? null, [plans, previewPlanId])
  const previewPlanTeam = useMemo(
    () => teams.find((team) => team.id === previewPlan?.teamId) ?? null,
    [previewPlan?.teamId, teams],
  )
  const previewWeekDays = useMemo(
    () => previewDetail?.weeks.find((week) => week.weekNumber === previewWeek)?.days ?? [],
    [previewDetail, previewWeek],
  )
  const previewSelectedDay = useMemo(
    () => previewWeekDays.find((day) => day.id === previewSelectedDayId) ?? previewWeekDays[0] ?? null,
    [previewSelectedDayId, previewWeekDays],
  )
  const effectiveTeam = useMemo(() => teams.find((team) => team.id === teamId) ?? null, [teamId, teams])
  const weekCount = useMemo(() => {
    const parsed = Number.parseInt(weeks, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }, [weeks])
  const trainingDayCount = useMemo(() => {
    const parsed = Number.parseInt(trainingDaysPerWeek, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }, [trainingDaysPerWeek])
  const activeDraftWeek = useMemo(
    () => draftDays.filter((day) => day.weekNumber === activeBuildWeek),
    [activeBuildWeek, draftDays],
  )
  const editingDraftDay = useMemo(
    () => activeDraftWeek.find((day) => day.id === editingDraftDayId) ?? activeDraftWeek[0] ?? null,
    [activeDraftWeek, editingDraftDayId],
  )
  const completenessRatio = useMemo(() => {
    if (draftDays.length === 0) return 0
    const configured = draftDays.filter((day) => draftDayConfigured(day, buildMode)).length
    return configured / draftDays.length
  }, [buildMode, draftDays])

  const load = useCallback(async () => {
    setIsLoading(true)
    const [teamsResult, plansResult] = await Promise.all([
      getCoachTeamsSnapshotForCurrentUser(),
      getCoachTrainingPlansForCurrentUser({ scopeTeamId: scopedTeamId }),
    ])

    if (!teamsResult.ok) {
      setError(teamsResult.error.message)
      setIsLoading(false)
      return
    }
    if (!plansResult.ok) {
      setError(plansResult.error.message)
      setIsLoading(false)
      return
    }

    const teamOptions = teamsResult.data.teams.map((team) => ({
      id: team.id,
      name: team.name,
      athleteCount: team.athleteCount,
      eventGroup: team.eventGroup,
    }))
    setTeams(teamOptions)
    setPlans(plansResult.data)
    setTeamId((current) => current || scopedTeamId || teamOptions[0]?.id || "")
    setPreviewPlanId((current) => current && plansResult.data.some((plan) => plan.id === current) ? current : plansResult.data[0]?.id ?? null)
    setError(null)
    setIsLoading(false)
  }, [scopedTeamId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!previewPlanId) {
      setPreviewDetail(null)
      return
    }

    let cancelled = false
    void (async () => {
      const result = await getTrainingPlanDetail(previewPlanId)
      if (cancelled) return
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setPreviewDetail(result.data)
    })()

    return () => {
      cancelled = true
    }
  }, [previewPlanId])

  useEffect(() => {
    if (!previewDetail) {
      setPreviewWeek(1)
      setPreviewSelectedDayId(null)
      return
    }
    if (!previewDetail.weeks.some((week) => week.weekNumber === previewWeek)) {
      setPreviewWeek(previewDetail.weeks[0]?.weekNumber ?? 1)
    }
  }, [previewDetail, previewWeek])

  useEffect(() => {
    if (!previewWeekDays.length) {
      setPreviewSelectedDayId(null)
      return
    }
    if (!previewWeekDays.some((day) => day.id === previewSelectedDayId)) {
      setPreviewSelectedDayId(previewWeekDays[0]?.id ?? null)
    }
  }, [previewSelectedDayId, previewWeekDays])

  useEffect(() => {
    if (!activeDraftWeek.length) {
      setEditingDraftDayId(null)
      return
    }
    if (!editingDraftDayId || !activeDraftWeek.some((day) => day.id === editingDraftDayId)) {
      setEditingDraftDayId(activeDraftWeek[0]?.id ?? null)
    }
  }, [activeDraftWeek, editingDraftDayId])

  const resetCreateState = useCallback(() => {
    setCreateStep(1)
    setDraftDays([])
    setActiveBuildWeek(1)
    setEditingDraftDayId(null)
    setName("New Training Plan")
    setTeamId((current) => scopedTeamId || current || teams[0]?.id || "")
    setStartDate(toInputDate(new Date()))
    setWeeks("4")
    setTrainingDaysPerWeek("5")
    setBuildMode("simple")
    setNotes("")
    setVisibilityStart("immediate")
    setAthletePermissions("none")
  }, [scopedTeamId, teams])

  const initializeDraftDays = useCallback(() => {
    if (!effectiveTeam || weekCount <= 0 || trainingDayCount <= 0) return
    const nextDraftDays = createDraftStructure(startDate, weekCount, trainingDayCount, buildMode, effectiveTeam.eventGroup)
    setDraftDays(nextDraftDays)
    setActiveBuildWeek(1)
    setEditingDraftDayId(nextDraftDays[0]?.id ?? null)
  }, [buildMode, effectiveTeam, startDate, trainingDayCount, weekCount])

  const updateDraftDay = useCallback((dayId: string, updater: (day: SessionDayDraft) => SessionDayDraft) => {
    setDraftDays((current) => current.map((day) => (day.id === dayId ? updater(day) : day)))
  }, [])

  const publish = async () => {
    if (!teamId) {
      setError("Select a team before publishing.")
      return
    }
    const weekCount = Number.parseInt(weeks, 10)
    if (!Number.isFinite(weekCount) || weekCount <= 0) {
      setError("Weeks must be a positive number.")
      return
    }

    setIsPublishing(true)
    const result = await publishTrainingPlanForCurrentCoach({
      name,
      startDate,
      weeks: weekCount,
      notes: notes.trim() || null,
      teamId,
      visibilityStart,
      visibilityDate: null,
      assignTarget: "team",
      assignSubgroup: null,
      selectedAthleteIds: [],
      structure: Array.from({ length: weekCount }, (_, index) => {
        const weekNumber = index + 1
        const weekDays = draftDays
          .filter((day) => day.weekNumber === weekNumber)
          .sort((left, right) => left.dayIndex - right.dayIndex)

        return {
          weekNumber,
          emphasis: `Week ${weekNumber} build`,
          status: weekNumber === 1 ? ("current" as const) : ("up-next" as const),
          days: weekDays.map((day) => ({
            dayIndex: day.dayIndex,
            dayLabel: day.dayLabel,
            date: day.date,
            title: day.title || `${day.dayLabel} session`,
            sessionType: day.sessionType,
            focus:
              buildMode === "simple"
                ? day.exerciseRows[0]?.name || "Programmed session"
                : day.blocks[0]?.title || "Programmed session",
            status: draftDayConfigured(day, buildMode) ? ("scheduled" as const) : ("up-next" as const),
            durationMinutes: 75,
            location: day.location || null,
            coachNote: day.notes.trim() || null,
            isTrainingDay: true,
            blockPreview: summarizeDraftDay(day, buildMode),
          })),
        }
      }),
    })
    setIsPublishing(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setError(null)
    await load()
    setPreviewPlanId(result.data.planId)
    setView("list")
    setCreateStep(1)
  }

  const archivePlan = async (planId: string) => {
    setActivePlanActionId(planId)
    const result = await archiveTrainingPlanForCurrentCoach(planId)
    setActivePlanActionId(null)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    if (previewPlanId === planId) {
      setPreviewPlanId(null)
      setPreviewDetail(null)
    }
    await load()
  }

  const deletePlan = async (planId: string) => {
    setActivePlanActionId(planId)
    const result = await deleteTrainingPlanForCurrentCoach(planId)
    setActivePlanActionId(null)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    if (previewPlanId === planId) {
      setPreviewPlanId(null)
      setPreviewDetail(null)
    }
    await load()
  }

  if (view === "list") {
    return (
      <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
        <StandardPageHeader
          eyebrow="Coach programs"
          title="Training Plans"
          description={`Review published plans and start a new program when you are ready.${previewPlanTeam ? ` Viewing ${previewPlanTeam.name}.` : ""}`}
          trailing={
            <Button
              type="button"
              onClick={() => {
                resetCreateState()
                setView("create")
              }}
              className="h-12 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
            >
              <HugeiconsIcon icon={Add01Icon} className="size-4" />
              Create program
            </Button>
          }
        />

        {error ? (
          <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</section>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-3">
            {!isLoading && plans.length === 0 ? (
              <EmptyStateCard
                eyebrow="Plans"
                title="No training plans exist yet."
                description="This team has not published any program in the current workspace."
                hint="Use the create action to publish the first structured plan."
                icon={<HugeiconsIcon icon={Search01Icon} className="size-5" />}
                className="rounded-[26px] bg-white px-5 py-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)]"
                contentClassName="gap-3"
                actions={
                  <Button
                    type="button"
                    className="h-10 rounded-full px-4"
                    onClick={() => {
                      resetCreateState()
                      setView("create")
                    }}
                  >
                    Create first program
                  </Button>
                }
              />
            ) : null}

            {plans.map((plan) => {
              const team = teams.find((candidate) => candidate.id === plan.teamId) ?? null
              const isSelected = previewPlan?.id === plan.id
              return (
                <article
                  key={plan.id}
                  className={cn(
                    "rounded-[26px] border bg-white px-4 py-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)] transition-all sm:px-5",
                    isSelected ? "border-[#1f8cff] shadow-[0_18px_48px_rgba(31,140,255,0.12)]" : "border-slate-200",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {team?.name ?? "Assigned team"}
                        </span>
                        <span className="inline-flex rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                          {plan.weeks} week{plan.weeks === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className="text-[1.15rem] font-semibold leading-tight tracking-[-0.03em] text-slate-950">{plan.name}</p>
                      <p className="text-sm text-slate-500">Starts {plan.startDate}</p>
                      <div className="flex items-center gap-3 pt-1">
                        <div className="flex -space-x-2">
                          {Array.from({ length: Math.min(team?.athleteCount ?? 0, 5) }, (_, index) => (
                            <div
                              key={`${plan.id}-avatar-${index}`}
                              className={cn(
                                "flex size-8 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold shadow-sm",
                                AVATAR_SWATCHES[index % AVATAR_SWATCHES.length],
                              )}
                            >
                              {index + 1}
                            </div>
                          ))}
                          {(team?.athleteCount ?? 0) > 5 ? (
                            <div className="flex size-8 items-center justify-center rounded-full border-2 border-white bg-slate-950 text-[11px] font-semibold text-white shadow-sm">
                              +{(team?.athleteCount ?? 0) - 5}
                            </div>
                          ) : null}
                        </div>
                        <p className="text-xs text-slate-500">
                          {team?.athleteCount ?? 0} athlete{team?.athleteCount === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-3 py-1.5 text-xs font-semibold",
                        plan.status === "published" ? "bg-[#1f8cff] text-white" : "bg-slate-100 text-slate-700",
                      )}
                    >
                      {formatStatus(plan.status)}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 xl:flex">
                    <Button
                      type="button"
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      className={cn(
                        "h-11 rounded-full px-5",
                        isSelected
                          ? "bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] text-white shadow-[0_12px_28px_rgba(31,140,255,0.24)] hover:opacity-95"
                          : "",
                      )}
                      onClick={() => {
                        setPreviewPlanId(plan.id)
                        setPreviewWeek(1)
                      }}
                    >
                      Preview
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 rounded-full border-slate-200 px-5 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950"
                      disabled={activePlanActionId === plan.id}
                      onClick={() => {
                        if (!window.confirm(`Archive "${plan.name}"?`)) return
                        void archivePlan(plan.id)
                      }}
                    >
                      Archive
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 rounded-full border-rose-200 px-5 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                      disabled={activePlanActionId === plan.id}
                      onClick={() => {
                        if (!window.confirm(`Delete "${plan.name}" permanently? This cannot be undone.`)) return
                        void deletePlan(plan.id)
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>

          {previewPlan ? (
            <aside className="hidden overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.06)] xl:block">
              <div className="bg-[linear-gradient(135deg,#081528_0%,#0b1f39_58%,#14386f_100%)] px-5 py-5 text-white">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6fb6ff]">Plan Preview</p>
                <h2 className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-[-0.04em]">{previewPlan.name}</h2>
                <p className="mt-2 text-sm text-white/72">
                  {previewPlanTeam?.name ?? "Assigned team"} | {previewPlan.weeks} weeks | starts {previewPlan.startDate}
                </p>
              </div>

              <div className="space-y-4 px-5 py-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Weeks</p>
                    <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{previewPlan.weeks}</p>
                  </div>
                  <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Status</p>
                    <p className="mt-2 text-base font-semibold text-slate-950">{formatStatus(previewPlan.status)}</p>
                  </div>
                </div>

                {previewDetail?.weeks?.length ? (
                  <>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {previewDetail.weeks.map((week) => (
                        <Button
                          key={week.id}
                          type="button"
                          size="sm"
                          variant={previewWeek === week.weekNumber ? "default" : "outline"}
                          className={cn(
                            "h-10 rounded-full px-4",
                            previewWeek === week.weekNumber ? "bg-slate-950 text-white hover:bg-slate-950" : "",
                          )}
                          onClick={() => setPreviewWeek(week.weekNumber)}
                        >
                          Week {week.weekNumber}
                        </Button>
                      ))}
                    </div>

                    <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="border-b border-slate-200 pb-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Week {previewWeek}</p>
                        <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">{formatWeekRange(previewWeekDays)}</p>
                      </div>

                      <div className="mt-4 space-y-4">
                        <div className="grid grid-cols-5 gap-2">
                          {previewWeekDays.map((day) => {
                            const isSelected = previewSelectedDay?.id === day.id
                            return (
                              <button
                                key={day.id}
                                type="button"
                                onClick={() => setPreviewSelectedDayId(day.id)}
                                className={cn(
                                  "rounded-[18px] border px-2 py-3 text-left transition",
                                  isSelected
                                    ? "border-[#1f8cff] bg-[#eaf3ff] shadow-[0_10px_24px_rgba(31,140,255,0.12)]"
                                    : "border-slate-200 bg-white hover:border-slate-300",
                                )}
                              >
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{day.dayLabel}</p>
                                <p className="mt-1 text-base font-semibold tracking-[-0.03em] text-slate-950">
                                  {new Date(`${day.date}T00:00:00`).getDate()}
                                </p>
                                <div className="mt-3 space-y-1">
                                  <div className={cn("h-1.5 rounded-full", day.blockPreview.length > 0 ? "bg-[#1f8cff]" : "bg-slate-200")} />
                                  <p className="text-[11px] text-slate-500">
                                    {day.blockPreview.length > 0 ? `${day.blockPreview.length} blocks` : "Empty"}
                                  </p>
                                </div>
                              </button>
                            )
                          })}
                        </div>

                        {previewSelectedDay ? (
                          <div className="rounded-[20px] border border-slate-200 bg-white p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                              {previewSelectedDay.dayLabel} | {formatShortDate(previewSelectedDay.date)}
                            </p>
                            <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">
                              {previewSelectedDay.title || "No session title"}
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              {previewSelectedDay.location ?? "Assigned location"} | {previewSelectedDay.focus}
                            </p>
                            <div className="mt-4 space-y-2">
                              {previewSelectedDay.blockPreview.length ? (
                                previewSelectedDay.blockPreview.map((block, index) => (
                                  <div key={`${previewSelectedDay.id}-block-${index}`} className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                                    {block}
                                  </div>
                                ))
                              ) : (
                                <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                                  No block preview is available for this day yet.
                                </div>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                    <div className="border-b border-slate-200 pb-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Week Preview</p>
                      <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">No week structure stored yet</p>
                    </div>
                    <div className="mt-4 grid grid-cols-5 gap-2">
                      {["Mon", "Tue", "Wed", "Thu", "Fri"].map((label) => (
                        <div key={label} className="rounded-[18px] border border-slate-200 bg-white px-2 py-3 opacity-70">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
                          <div className="mt-6 h-1.5 rounded-full bg-slate-200" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </aside>
          ) : (
            <aside className="hidden overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.06)] xl:block">
              <div className="bg-[linear-gradient(135deg,#081528_0%,#0b1f39_58%,#14386f_100%)] px-5 py-5 text-white">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6fb6ff]">Plan Preview</p>
                <h2 className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-[-0.04em]">No Plan Selected</h2>
                <p className="mt-2 text-sm text-white/72">Choose a plan from the list to preview its week layout.</p>
              </div>
            </aside>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
      <StandardPageHeader
        eyebrow="Coach programs"
        title="Create Training Plan"
        description={`Set up the plan, shape the week structure, then review before publishing.${effectiveTeam ? ` Scoped to ${effectiveTeam.name}.` : ""}`}
        trailing={
          <Button type="button" variant="outline" className="h-11 rounded-full border-slate-200 px-5" onClick={() => {
            resetCreateState()
            setView("list")
          }}>
            Back to plans
          </Button>
        }
      />

      {error ? (
        <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</section>
      ) : null}

      <div className="rounded-[22px] border border-slate-200 bg-white p-3 shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: 1, label: "Setup" },
            { value: 2, label: "Build" },
            { value: 3, label: "Review" },
          ].map(({ value, label }) => (
            <div key={value} className="space-y-1">
              <div className={cn("h-1.5 rounded-full", createStep >= value ? "bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)]" : "bg-slate-200")} />
              <div className="text-center">
                <p className="text-xs font-medium text-slate-950">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {createStep === 1 ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Step 1</p>
              <h2 className="text-lg font-semibold text-slate-950">Setup</h2>
              <p className="text-sm text-slate-500">Define the plan context for your assigned group.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Plan Name</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Duration (weeks)</Label>
                <Select value={weeks} onValueChange={setWeeks}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["4", "6", "8"].map((value) => (
                      <SelectItem key={value} value={value}>{value} weeks</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Training Days Per Week</Label>
                <Select value={trainingDaysPerWeek} onValueChange={setTrainingDaysPerWeek}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["3", "4", "5", "6", "7"].map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Build Mode</Label>
                <Select value={buildMode} onValueChange={(value) => setBuildMode(value as "simple" | "advanced")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simple">Simple</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  {buildMode === "simple" ? "Simple mode uses flat exercise rows for the whole program." : "Advanced mode keeps the staged builder flow."}
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Notes (optional)</Label>
                <Textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional plan notes" />
              </div>
            </div>

            <div className="rounded-[22px] border border-slate-200 bg-[#fbfcfe] p-4">
              <h3 className="font-semibold text-slate-950">Publishing</h3>
              <p className="mt-1 text-sm text-slate-500">This plan is locked to your assigned team.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Team</Label>
                  <Select value={teamId} onValueChange={setTeamId} disabled={Boolean(scopedTeamId)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Visibility start</Label>
                  <Select value={visibilityStart} onValueChange={(value) => setVisibilityStart(value as "immediate" | "scheduled")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="immediate">Immediate</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Athlete permissions</Label>
                  <Select value={athletePermissions} onValueChange={(value) => setAthletePermissions(value as "none" | "read-only")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="read-only">Read-only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-full border-slate-200 px-5 text-slate-950"
                onClick={() => {
                  window.localStorage.setItem(
                    "pacelab:supabase-training-plan-draft",
                    JSON.stringify({
                      name,
                      teamId,
                      startDate,
                      weeks,
                      trainingDaysPerWeek,
                      buildMode,
                      notes,
                      visibilityStart,
                      athletePermissions,
                    }),
                  )
                }}
              >
                Save Draft
              </Button>
              <Button
                type="button"
                className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
                onClick={() => {
                  if (!name.trim()) {
                    setError("Plan name is required before you can build.")
                    return
                  }
                  if (!effectiveTeam) {
                    setError("A scoped team is required before the builder can start.")
                    return
                  }
                  initializeDraftDays()
                  setError(null)
                  setCreateStep(2)
                }}
              >
                Continue to Build
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </Button>
            </div>
          </div>

          <aside className="hidden xl:block rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Summary</p>
              <h3 className="text-lg font-semibold tracking-tight text-slate-950">Context</h3>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-slate-500">Team</p>
                <p className="mt-1 font-medium text-slate-950">{effectiveTeam?.name ?? "Assigned team"}</p>
              </div>
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-slate-500">Window</p>
                <p className="mt-1 font-medium text-slate-950">{weekCount > 0 ? `${weekCount} weeks from ${startDate}` : "Set duration"}</p>
              </div>
            </div>
          </aside>
        </section>
      ) : null}

      {createStep === 2 ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Step 2</p>
              <h2 className="text-lg font-semibold text-slate-950">Build</h2>
              <p className="text-sm text-slate-500">
                {buildMode === "simple"
                  ? "Use direct exercise rows to build each day."
                  : "Use structured blocks to shape each training day before review."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: weekCount }, (_, index) => index + 1).map((weekNumber) => (
                <Button
                  key={weekNumber}
                  type="button"
                  size="sm"
                  variant={activeBuildWeek === weekNumber ? "default" : "outline"}
                  className={cn("h-10 rounded-full px-4", activeBuildWeek === weekNumber ? "bg-slate-950 text-white hover:bg-slate-950" : "")}
                  onClick={() => setActiveBuildWeek(weekNumber)}
                >
                  Week {weekNumber}
                </Button>
              ))}
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-[22px] border border-slate-200 bg-[#fbfcfe] p-4">
                <div className="border-b border-slate-200 pb-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Week {activeBuildWeek}</p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">{formatDraftWeekRange(activeDraftWeek)}</p>
                </div>
                <div className="mt-4 grid grid-cols-5 gap-2">
                  {activeDraftWeek.map((day) => {
                    const isSelected = editingDraftDay?.id === day.id
                    const configured = draftDayConfigured(day, buildMode)
                    return (
                      <button
                        key={day.id}
                        type="button"
                        onClick={() => setEditingDraftDayId(day.id)}
                        className={cn(
                          "rounded-[18px] border px-2 py-3 text-left transition",
                          isSelected ? "border-[#1f8cff] bg-[#eaf3ff] shadow-[0_10px_24px_rgba(31,140,255,0.12)]" : "border-slate-200 bg-white hover:border-slate-300",
                        )}
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{day.dayLabel}</p>
                        <p className="mt-1 text-base font-semibold tracking-[-0.03em] text-slate-950">{new Date(`${day.date}T00:00:00`).getDate()}</p>
                        <div className="mt-3 space-y-1">
                          <div className={cn("h-1.5 rounded-full", configured ? "bg-[#1f8cff]" : "bg-slate-200")} />
                          <p className="text-[11px] text-slate-500">
                            {buildMode === "simple" ? `${day.exerciseRows.length} rows` : `${day.blocks.length} blocks`}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-4 rounded-[22px] border border-slate-200 bg-white p-4">
                {editingDraftDay ? (
                  <>
                    <div className="border-b border-slate-200 pb-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {editingDraftDay.dayLabel} | {formatShortDate(editingDraftDay.date)}
                      </p>
                      <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">Day Builder</p>
                    </div>
                    <div className="grid gap-3">
                      <div className="space-y-2">
                        <Label>Session title</Label>
                        <Input value={editingDraftDay.title} onChange={(event) => updateDraftDay(editingDraftDay.id, (day) => ({ ...day, title: event.target.value }))} />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Session type</Label>
                          <Select value={editingDraftDay.sessionType} onValueChange={(value) => updateDraftDay(editingDraftDay.id, (day) => ({ ...day, sessionType: value as SessionType }))}>
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {SESSION_TYPE_OPTIONS.map((option) => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Location</Label>
                          <Input value={editingDraftDay.location} onChange={(event) => updateDraftDay(editingDraftDay.id, (day) => ({ ...day, location: event.target.value }))} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Coach note</Label>
                        <Textarea rows={3} value={editingDraftDay.notes} onChange={(event) => updateDraftDay(editingDraftDay.id, (day) => ({ ...day, notes: event.target.value }))} />
                      </div>

                      {buildMode === "simple" ? (
                        <div className="space-y-3 rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-4">
                          <div>
                            <p className="font-semibold text-slate-950">Exercise rows</p>
                            <p className="text-sm text-slate-500">Add exact sets, reps, and loads for this day.</p>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Input placeholder="Exercise" value={editingDraftDay.exerciseDraft.name} onChange={(event) => updateDraftDay(editingDraftDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, name: event.target.value } }))} />
                            <Input placeholder="Sets" value={editingDraftDay.exerciseDraft.sets} onChange={(event) => updateDraftDay(editingDraftDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, sets: event.target.value } }))} />
                            <Input placeholder="Reps" value={editingDraftDay.exerciseDraft.reps} onChange={(event) => updateDraftDay(editingDraftDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, reps: event.target.value } }))} />
                            <Input placeholder="Load / Target" value={editingDraftDay.exerciseDraft.load} onChange={(event) => updateDraftDay(editingDraftDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, load: event.target.value } }))} />
                          </div>
                          <Input placeholder="Notes / Cue" value={editingDraftDay.exerciseDraft.notes} onChange={(event) => updateDraftDay(editingDraftDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, notes: event.target.value } }))} />
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 rounded-full border-slate-200 px-4"
                            onClick={() => updateDraftDay(editingDraftDay.id, (day) => {
                              if (!day.exerciseDraft.name.trim()) return day
                              return {
                                ...day,
                                exerciseRows: [...day.exerciseRows, { id: makeDraftId("exercise"), ...day.exerciseDraft, name: day.exerciseDraft.name.trim() }],
                                exerciseDraft: { name: "", sets: "", reps: "", load: "", notes: "" },
                              }
                            })}
                          >
                            Add row
                          </Button>
                          <div className="space-y-2">
                            {editingDraftDay.exerciseRows.map((row) => (
                              <div key={row.id} className="flex items-start justify-between gap-3 rounded-[16px] border border-slate-200 bg-white px-3 py-3">
                                <div>
                                  <p className="font-medium text-slate-950">{row.name}</p>
                                  <p className="text-xs text-slate-500">
                                    {row.sets || "-"} sets | {row.reps || "-"} reps {row.load ? `| ${row.load}` : ""}
                                  </p>
                                  {row.notes ? <p className="mt-1 text-xs text-slate-500">{row.notes}</p> : null}
                                </div>
                                <Button type="button" variant="outline" size="sm" className="rounded-full border-rose-200 px-3 text-rose-700 hover:bg-rose-50" onClick={() => updateDraftDay(editingDraftDay.id, (day) => ({ ...day, exerciseRows: day.exerciseRows.filter((item) => item.id !== row.id) }))}>
                                  Remove
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3 rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-4">
                          <div>
                            <p className="font-semibold text-slate-950">Structured blocks</p>
                            <p className="text-sm text-slate-500">Build the day with guided blocks instead of flat rows.</p>
                          </div>
                          <div className="grid gap-3">
                            <Input placeholder="Block title" value={editingDraftDay.blockDraft.title} onChange={(event) => updateDraftDay(editingDraftDay.id, (day) => ({ ...day, blockDraft: { ...day.blockDraft, title: event.target.value } }))} />
                            <Textarea rows={3} placeholder="Block detail" value={editingDraftDay.blockDraft.detail} onChange={(event) => updateDraftDay(editingDraftDay.id, (day) => ({ ...day, blockDraft: { ...day.blockDraft, detail: event.target.value } }))} />
                            <Button
                              type="button"
                              variant="outline"
                              className="h-10 rounded-full border-slate-200 px-4"
                              onClick={() => updateDraftDay(editingDraftDay.id, (day) => {
                                if (!day.blockDraft.title.trim()) return day
                                return {
                                  ...day,
                                  blocks: [...day.blocks, { id: makeDraftId("block"), title: day.blockDraft.title.trim(), detail: day.blockDraft.detail.trim() }],
                                  blockDraft: { title: "", detail: "" },
                                }
                              })}
                            >
                              Add block
                            </Button>
                          </div>
                          <div className="space-y-2">
                            {editingDraftDay.blocks.map((block) => (
                              <div key={block.id} className="flex items-start justify-between gap-3 rounded-[16px] border border-slate-200 bg-white px-3 py-3">
                                <div>
                                  <p className="font-medium text-slate-950">{block.title}</p>
                                  <p className="text-xs text-slate-500">{block.detail || "No detail added."}</p>
                                </div>
                                <Button type="button" variant="outline" size="sm" className="rounded-full border-rose-200 px-3 text-rose-700 hover:bg-rose-50" onClick={() => updateDraftDay(editingDraftDay.id, (day) => ({ ...day, blocks: day.blocks.filter((item) => item.id !== block.id) }))}>
                                  Remove
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" className="h-11 rounded-full border-slate-200 px-5 text-slate-950" onClick={() => setCreateStep(1)}>
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
                Back
              </Button>
              <Button
                type="button"
                className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
                onClick={() => {
                  if (completenessRatio < 0.6) {
                    setError("Build at least 60% of the programmed days before moving to review.")
                    return
                  }
                  setError(null)
                  setCreateStep(3)
                }}
              >
                Continue to Review
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </Button>
            </div>
          </div>

          <aside className="hidden xl:block rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Summary</p>
              <h3 className="text-lg font-semibold tracking-tight text-slate-950">Coverage</h3>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-slate-500">Configured days</p>
                <p className="mt-1 font-medium text-slate-950">{draftDays.filter((day) => draftDayConfigured(day, buildMode)).length} / {draftDays.length}</p>
              </div>
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-slate-500">Readiness</p>
                <p className="mt-1 font-medium text-slate-950">{Math.round(completenessRatio * 100)}%</p>
              </div>
            </div>
          </aside>
        </section>
      ) : null}

      {createStep === 3 ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Step 3</p>
              <h2 className="text-lg font-semibold text-slate-950">Review</h2>
              <p className="text-sm text-slate-500">Confirm the plan scope and publish when you are ready.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-sm text-slate-500">Plan</p>
                <p className="mt-1 text-xl font-semibold text-slate-950">{name}</p>
              </div>
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-sm text-slate-500">Structure</p>
                <p className="mt-1 text-xl font-semibold text-slate-950">{weekCount} weeks | {buildMode === "simple" ? "Simple" : "Advanced"}</p>
              </div>
            </div>
            <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-4">
              <p className="text-sm text-slate-500">Build readiness</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{Math.round(completenessRatio * 100)}%</p>
              <p className="mt-2 text-sm text-slate-500">At least 60% of planned days need usable structure before publishing.</p>
            </div>
            <div className="space-y-3 rounded-[20px] border border-slate-200 bg-white p-4">
              {draftDays
                .filter((day) => day.weekNumber === 1)
                .map((day) => (
                  <div key={day.id} className="rounded-[16px] border border-slate-200 bg-[#fbfcfe] px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-950">{day.dayLabel} | {formatShortDate(day.date)}</p>
                        <p className="text-sm text-slate-500">{day.title || "No session title"}</p>
                      </div>
                      <span className={cn("inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold", draftDayConfigured(day, buildMode) ? "bg-[#eef5ff] text-[#1f5fd1]" : "bg-slate-100 text-slate-500")}>
                        {draftDayConfigured(day, buildMode) ? "Ready" : "Draft"}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" className="h-11 rounded-full border-slate-200 px-5 text-slate-950" onClick={() => setCreateStep(2)}>
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
                Back to Build
              </Button>
              <Button className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95" onClick={publish} disabled={isPublishing || isLoading || completenessRatio < 0.6}>
                {isPublishing ? "Publishing..." : "Publish"}
              </Button>
            </div>
          </div>

          <aside className="hidden xl:block rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Summary</p>
              <h3 className="text-lg font-semibold tracking-tight text-slate-950">Publish Check</h3>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-slate-500">Team</p>
                <p className="mt-1 font-medium text-slate-950">{effectiveTeam?.name ?? "Assigned team"}</p>
              </div>
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-slate-500">Visibility</p>
                <p className="mt-1 font-medium text-slate-950">{visibilityStart === "immediate" ? "Immediate" : "Scheduled"}</p>
              </div>
            </div>
          </aside>
        </section>
      ) : null}
    </div>
  )
}
