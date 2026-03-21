"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import {
  getCoachTrainingPlansForCurrentUser,
  publishTrainingPlanForCurrentCoach,
  type PublishTrainingPlanInput,
} from "@/lib/data/training-plan/training-plan-data"
import type { TrainingPlanSummary } from "@/lib/data/training-plan/types"
import type { Role } from "@/lib/mock-data"

type Props = {
  initialRole: Role
  initialCoachTeamId: string | null
}

type TeamOption = {
  id: string
  name: string
}

function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return toInputDate(date)
}

function buildSimpleStructure(startDate: string, weeks: number): PublishTrainingPlanInput["structure"] {
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri"]
  return Array.from({ length: weeks }, (_, weekIndex) => {
    const weekNumber = weekIndex + 1
    return {
      weekNumber,
      emphasis: `Week ${weekNumber} build`,
      status: weekIndex === 0 ? ("current" as const) : ("up-next" as const),
      days: dayLabels.map((dayLabel, dayIndex) => ({
        dayIndex,
        dayLabel,
        date: addDays(startDate, weekIndex * 7 + dayIndex),
        title: `${dayLabel} session`,
        sessionType: dayIndex % 2 === 0 ? ("Track" as const) : ("Gym" as const),
        focus: "Programmed by coach",
        status: "scheduled" as const,
        durationMinutes: 75,
        location: dayIndex % 2 === 0 ? "Track" : "Weight Room",
        coachNote: null,
        isTrainingDay: true,
        blockPreview: ["Main set", "Accessory work", "Cooldown"],
      })),
    }
  })
}

export default function CoachTrainingPlanPageSupabaseClient({ initialRole, initialCoachTeamId }: Props) {
  const [teams, setTeams] = useState<TeamOption[]>([])
  const [plans, setPlans] = useState<TrainingPlanSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)

  const [name, setName] = useState("New Training Plan")
  const [teamId, setTeamId] = useState("")
  const [startDate, setStartDate] = useState(() => toInputDate(new Date()))
  const [weeks, setWeeks] = useState("4")

  const scopedTeamId = useMemo(
    () => (initialRole === "coach" ? initialCoachTeamId : null),
    [initialCoachTeamId, initialRole],
  )

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

    const teamOptions = teamsResult.data.teams.map((team) => ({ id: team.id, name: team.name }))
    setTeams(teamOptions)
    setPlans(plansResult.data)
    setTeamId((current) => current || scopedTeamId || teamOptions[0]?.id || "")
    setError(null)
    setIsLoading(false)
  }, [scopedTeamId])

  useEffect(() => {
    void load()
  }, [load])

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
      notes: null,
      teamId,
      visibilityStart: "immediate",
      visibilityDate: null,
      assignTarget: "team",
      assignSubgroup: null,
      selectedAthleteIds: [],
      structure: buildSimpleStructure(startDate, weekCount),
    })
    setIsPublishing(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setError(null)
    await load()
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <section className="space-y-2">
        <h1 className="text-[2.35rem] leading-[0.95] font-semibold tracking-[-0.07em] text-slate-950 sm:text-[2.8rem]">
          Training Plans
        </h1>
        <p className="text-sm text-slate-600">Supabase mode: create and publish plans without mock data.</p>
      </section>

      {error ? (
        <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Publish</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">Create Plan</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Plan name</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Team</Label>
              <Select value={teamId} onValueChange={setTeamId} disabled={Boolean(scopedTeamId)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Start date</Label>
              <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Weeks</Label>
              <Input value={weeks} onChange={(event) => setWeeks(event.target.value)} />
            </div>
          </div>
          <Button className="mt-4" onClick={publish} disabled={isPublishing || isLoading}>
            {isPublishing ? "Publishing..." : "Publish plan"}
          </Button>
        </div>

        <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Recent</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">Published Plans</h2>
          <div className="mt-4 space-y-3">
            {isLoading ? <p className="text-sm text-slate-500">Loading...</p> : null}
            {!isLoading && plans.length === 0 ? <p className="text-sm text-slate-500">No plans yet.</p> : null}
            {plans.map((plan) => (
              <div key={plan.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="font-medium text-slate-950">{plan.name}</p>
                <p className="text-xs text-slate-500">
                  {plan.startDate} | {plan.weeks} weeks | {plan.status}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
