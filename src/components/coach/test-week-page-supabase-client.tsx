"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  createPublishedTestWeekForCurrentCoach,
  getCoachTestWeeksForCurrentUser,
  type CoachTestWeekListItem,
} from "@/lib/data/test-week/test-week-data"
import type { TestDefinitionUnit } from "@/lib/data/test-week/types"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import type { Role } from "@/lib/mock-data"

type Props = {
  initialRole: Role
  initialCoachTeamId: string | null
}

type TeamOption = {
  id: string
  name: string
}

type DraftTest = {
  id: string
  name: string
  unit: TestDefinitionUnit
}

function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return toInputDate(date)
}

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

export default function CoachTestWeekPageSupabaseClient({ initialRole, initialCoachTeamId }: Props) {
  const today = toInputDate(new Date())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [teams, setTeams] = useState<TeamOption[]>([])
  const [weeks, setWeeks] = useState<CoachTestWeekListItem[]>([])
  const [name, setName] = useState("New Test Week")
  const [teamId, setTeamId] = useState("")
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(addDays(today, 4))
  const [tests, setTests] = useState<DraftTest[]>([
    { id: makeId(), name: "30m", unit: "time" },
    { id: makeId(), name: "Flying 30m", unit: "time" },
    { id: makeId(), name: "150m", unit: "time" },
    { id: makeId(), name: "Squat 1RM", unit: "weight" },
    { id: makeId(), name: "CMJ", unit: "height" },
  ])

  const scopedTeamId = useMemo(
    () => (initialRole === "coach" ? initialCoachTeamId : null),
    [initialCoachTeamId, initialRole],
  )

  const load = useCallback(async () => {
    setIsLoading(true)
    const [teamsResult, weeksResult] = await Promise.all([
      getCoachTeamsSnapshotForCurrentUser(),
      getCoachTestWeeksForCurrentUser({ scopeTeamId: scopedTeamId }),
    ])
    if (!teamsResult.ok) {
      setError(teamsResult.error.message)
      setIsLoading(false)
      return
    }
    if (!weeksResult.ok) {
      setError(weeksResult.error.message)
      setIsLoading(false)
      return
    }

    const teamOptions = teamsResult.data.teams.map((team) => ({ id: team.id, name: team.name }))
    setTeams(teamOptions)
    setWeeks(weeksResult.data)
    setTeamId((current) => current || scopedTeamId || teamOptions[0]?.id || "")
    setError(null)
    setIsLoading(false)
  }, [scopedTeamId])

  useEffect(() => {
    void load()
  }, [load])

  const addTest = () => {
    setTests((current) => [...current, { id: makeId(), name: "", unit: "time" }])
  }

  const updateTest = (id: string, next: Partial<DraftTest>) => {
    setTests((current) => current.map((test) => (test.id === id ? { ...test, ...next } : test)))
  }

  const removeTest = (id: string) => {
    setTests((current) => current.filter((test) => test.id !== id))
  }

  const publish = async () => {
    if (!teamId) {
      setError("Select a team before publishing.")
      return
    }

    const sanitizedTests = tests
      .map((test) => ({ name: test.name.trim(), unit: test.unit }))
      .filter((test) => test.name.length > 0)
    if (!sanitizedTests.length) {
      setError("Add at least one test before publishing.")
      return
    }

    setIsPublishing(true)
    const result = await createPublishedTestWeekForCurrentCoach({
      name: name.trim() || "Test Week",
      teamId,
      startDate,
      endDate,
      tests: sanitizedTests,
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
          Test Weeks
        </h1>
        <p className="text-sm text-slate-600">Supabase mode: create and publish test weeks without mock data.</p>
      </section>

      {error ? (
        <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Publish</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">Create Test Week</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Name</Label>
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
              <Label>End date</Label>
              <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-950">Tests</p>
              <Button type="button" variant="outline" onClick={addTest}>
                Add test
              </Button>
            </div>
            {tests.map((test) => (
              <div key={test.id} className="grid gap-3 rounded-[18px] border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_180px_auto]">
                <Input value={test.name} onChange={(event) => updateTest(test.id, { name: event.target.value })} placeholder="Test name" />
                <Select value={test.unit} onValueChange={(value) => updateTest(test.id, { unit: value as TestDefinitionUnit })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="time">time</SelectItem>
                    <SelectItem value="distance">distance</SelectItem>
                    <SelectItem value="weight">weight</SelectItem>
                    <SelectItem value="height">height</SelectItem>
                    <SelectItem value="score">score</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={() => removeTest(test.id)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>

          <Button className="mt-4" onClick={publish} disabled={isPublishing || isLoading}>
            {isPublishing ? "Publishing..." : "Publish test week"}
          </Button>
        </div>

        <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Recent</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">Published Test Weeks</h2>
          <div className="mt-4 space-y-3">
            {isLoading ? <p className="text-sm text-slate-500">Loading...</p> : null}
            {!isLoading && weeks.length === 0 ? <p className="text-sm text-slate-500">No test weeks yet.</p> : null}
            {weeks.map((week) => (
              <div key={week.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="font-medium text-slate-950">{week.name}</p>
                <p className="text-xs text-slate-500">
                  {week.startDate} to {week.endDate} | {week.testCount} tests | {week.status}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
