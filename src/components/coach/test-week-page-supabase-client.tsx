"use client"

import { Add01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { EmptyStateCard } from "@/components/ui/empty-state-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StandardPageHeader } from "@/components/ui/standard-page-header"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import {
  archiveTestWeekForCurrentCoach,
  createPublishedTestWeekForCurrentCoach,
  deleteTestWeekForCurrentCoach,
  getCoachTestWeekDefinitions,
  getCoachTestWeeksForCurrentUser,
  type CoachTestWeekListItem,
} from "@/lib/data/test-week/test-week-data"
import type { ActiveTestDefinition, TestDefinitionUnit } from "@/lib/data/test-week/types"
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
}

type DraftTest = {
  id: string
  name: string
  unit: TestDefinitionUnit
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

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

function formatStatus(status: CoachTestWeekListItem["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function countByUnit(definitions: ActiveTestDefinition[]) {
  return definitions.reduce<Record<TestDefinitionUnit, number>>(
    (acc, definition) => {
      acc[definition.unit] += 1
      return acc
    },
    { time: 0, distance: 0, weight: 0, height: 0, score: 0 },
  )
}

export default function CoachTestWeekPageSupabaseClient({ initialRole, initialCoachTeamId }: Props) {
  const today = toInputDate(new Date())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [activeWeekActionId, setActiveWeekActionId] = useState<string | null>(null)
  const [view, setView] = useState<"list" | "create">("list")
  const [teams, setTeams] = useState<TeamOption[]>([])
  const [weeks, setWeeks] = useState<CoachTestWeekListItem[]>([])
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null)
  const [selectedDefinitions, setSelectedDefinitions] = useState<ActiveTestDefinition[]>([])
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

  const selectedWeek = useMemo(() => weeks.find((week) => week.id === selectedWeekId) ?? null, [weeks, selectedWeekId])
  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedWeek?.teamId) ?? null,
    [selectedWeek?.teamId, teams],
  )
  const selectedWeekCounts = useMemo(() => countByUnit(selectedDefinitions), [selectedDefinitions])

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

    const teamOptions = teamsResult.data.teams.map((team) => ({
      id: team.id,
      name: team.name,
      athleteCount: team.athleteCount,
    }))
    setTeams(teamOptions)
    setWeeks(weeksResult.data)
    setTeamId((current) => current || scopedTeamId || teamOptions[0]?.id || "")
    setSelectedWeekId((current) => current && weeksResult.data.some((week) => week.id === current) ? current : weeksResult.data[0]?.id ?? null)
    setError(null)
    setIsLoading(false)
  }, [scopedTeamId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selectedWeekId) {
      setSelectedDefinitions([])
      return
    }

    let cancelled = false
    void (async () => {
      const result = await getCoachTestWeekDefinitions(selectedWeekId)
      if (cancelled) return
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setSelectedDefinitions(result.data)
    })()

    return () => {
      cancelled = true
    }
  }, [selectedWeekId])

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
    setSelectedWeekId(result.data.testWeekId)
    setView("list")
  }

  const archiveWeek = async (testWeekId: string) => {
    setActiveWeekActionId(testWeekId)
    const result = await archiveTestWeekForCurrentCoach(testWeekId)
    setActiveWeekActionId(null)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    if (selectedWeekId === testWeekId) {
      setSelectedWeekId(null)
      setSelectedDefinitions([])
    }
    await load()
  }

  const deleteWeek = async (testWeekId: string) => {
    setActiveWeekActionId(testWeekId)
    const result = await deleteTestWeekForCurrentCoach(testWeekId)
    setActiveWeekActionId(null)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    if (selectedWeekId === testWeekId) {
      setSelectedWeekId(null)
      setSelectedDefinitions([])
    }
    await load()
  }

  if (view === "list") {
    return (
      <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
        <StandardPageHeader
          eyebrow="Coach testing"
          title="Test Weeks"
          description={`Build and publish testing blocks.${selectedTeam ? ` Viewing ${selectedTeam.name}.` : ""}`}
          trailing={
            <Button
              type="button"
              onClick={() => setView("create")}
              className="h-12 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
            >
              <HugeiconsIcon icon={Add01Icon} className="size-4" />
              Create test
            </Button>
          }
        />

        {error ? (
          <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            {!isLoading && weeks.length === 0 ? (
              <EmptyStateCard
                eyebrow="Test weeks"
                title="No test weeks yet."
                description="No testing windows have been created for this team scope yet."
                hint="Start with a first test week so coaches can compare athlete movement across repeated benchmarks."
                icon={<HugeiconsIcon icon={Add01Icon} className="size-5" />}
                actions={
                  <Button type="button" className="h-10 rounded-full px-4" onClick={() => setView("create")}>
                    Create first test week
                  </Button>
                }
              />
            ) : null}

            {weeks.map((week) => {
              const team = teams.find((candidate) => candidate.id === week.teamId) ?? null
              const isSelected = selectedWeekId === week.id
              return (
                <article
                  key={week.id}
                  className={cn(
                    "rounded-[26px] border bg-white px-4 py-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)] transition-all sm:px-5",
                    isSelected
                      ? "border-[#1f8cff] shadow-[0_18px_48px_rgba(31,140,255,0.12)]"
                      : "border-slate-200 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(15,23,42,0.08)]",
                  )}
                >
                  <button type="button" className="w-full text-left" onClick={() => setSelectedWeekId(week.id)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            {team?.name ?? "Assigned team"}
                          </span>
                          <span className="inline-flex rounded-full bg-[#eef5ff] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1f5fd1]">
                            {week.testCount} test{week.testCount === 1 ? "" : "s"}
                          </span>
                        </div>
                        <p className="text-[1.15rem] font-semibold leading-tight tracking-[-0.03em] text-slate-950">{week.name}</p>
                        <p className="text-sm text-slate-500">
                          {week.startDate} to {week.endDate}
                        </p>
                        <div className="flex items-center gap-3 pt-1">
                          <div className="flex -space-x-2">
                            {Array.from({ length: Math.min(team?.athleteCount ?? 0, 5) }, (_, index) => (
                              <div
                                key={`${week.id}-avatar-${index}`}
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
                      <span className="inline-flex rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white">
                        {formatStatus(week.status)}
                      </span>
                    </div>
                  </button>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 rounded-full border-slate-200 px-5 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950"
                      disabled={activeWeekActionId === week.id}
                      onClick={() => {
                        if (!window.confirm(`Archive "${week.name}"?`)) return
                        void archiveWeek(week.id)
                      }}
                    >
                      Archive
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 rounded-full border-rose-200 px-5 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                      disabled={activeWeekActionId === week.id}
                      onClick={() => {
                        if (!window.confirm(`Delete "${week.name}" permanently? This cannot be undone.`)) return
                        void deleteWeek(week.id)
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>

          <aside className="hidden rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] xl:block">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Current template</p>
              <h2 className="text-lg font-semibold tracking-tight text-slate-950">Assessment mix</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-slate-500">Time tests</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">{selectedWeekCounts.time}</p>
              </div>
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-slate-500">Distance tests</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">{selectedWeekCounts.distance}</p>
              </div>
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-slate-500">Strength / jump tests</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">{selectedWeekCounts.weight + selectedWeekCounts.height}</p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
      <StandardPageHeader
        eyebrow="Coach testing"
        title="Create test"
        description="Define the testing window, add tests, and publish it to the selected team."
        trailing={
          <Button type="button" variant="outline" className="h-11 rounded-full border-slate-200 px-5" onClick={() => setView("list")}>
            Back to test weeks
          </Button>
        }
      />

      {error ? (
        <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Publish</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">Create test</h2>

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
            {!isLoading && weeks.length === 0 ? (
              <EmptyStateCard
                eyebrow="Published test weeks"
                title="No test weeks have been created yet."
                description="This coach scope does not have any published test windows in Supabase yet."
                hint="Use the publish form to define the window, add tests, and send the first test week to the team."
                icon={<HugeiconsIcon icon={Search01Icon} className="size-5" />}
                className="rounded-[18px] border-dashed bg-slate-50 px-4 py-5 shadow-none"
                contentClassName="gap-2"
              />
            ) : null}
            {weeks.map((week) => (
              <div key={week.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="font-medium text-slate-950">{week.name}</p>
                <p className="text-xs text-slate-500">
                  {week.startDate} to {week.endDate} | {week.testCount} tests | {formatStatus(week.status)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
