"use client"

import { useCallback, useMemo, useState } from "react"
import {
  TestWeekScreen,
  type ActionResult,
  type ResultChange,
  type TestUnit,
  type TestWeekDetail,
  type TestWeekRow,
  type TestWeekSaveInput,
  type TestWeekStatus,
} from "@/components/coach/test-week-screen"
import { mockAthletes, mockTeams, mockTestWeekResults, onCreateTestWeek, type EventGroup, type Role } from "@/lib/mock-data"
import { tenantStorageKey } from "@/lib/tenant-storage"

/** Mock mode: test weeks live in localStorage, seeded with three published examples. */

interface CoachTestWeekPageClientProps {
  initialRole: Role
  initialCoachTeamId: string | null
  /** The coach's assigned teams. Null for club admins, who work on every team. */
  coachTeamIds: string[] | null
}

type StoredResult = { value: string; change: ResultChange | null }

type StoredWeek = {
  id: string
  name: string
  teamId: string
  startDate: string
  endDate: string
  status: TestWeekStatus
  isArchived: boolean
  tests: Array<{ id: string; name: string; unit: TestUnit; dayIndex: number }>
  submissions: Record<string, { submittedAt: string; results: Record<string, StoredResult> }>
}

const STORAGE_KEY = "pacelab:test-weeks-v2"

const SPRINT_TESTS: Array<{ name: string; unit: TestUnit }> = [
  { name: "30m", unit: "time" },
  { name: "Flying 30m", unit: "time" },
  { name: "150m", unit: "time" },
  { name: "Squat 1RM", unit: "weight" },
  { name: "CMJ", unit: "height" },
]

const JUMPS_TESTS: Array<{ name: string; unit: TestUnit }> = [
  { name: "Long Jump", unit: "distance" },
  { name: "CMJ", unit: "height" },
  { name: "Squat 1RM", unit: "weight" },
  { name: "5 Bound", unit: "distance" },
]

const THROWS_TESTS: Array<{ name: string; unit: TestUnit }> = [
  { name: "Shot Put", unit: "distance" },
  { name: "Discus", unit: "distance" },
  { name: "Javelin", unit: "distance" },
  { name: "CMJ", unit: "height" },
  { name: "Squat 1RM", unit: "weight" },
]

function templateFor(eventGroup?: EventGroup | null) {
  if (eventGroup === "Throws") return THROWS_TESTS
  if (eventGroup === "Jumps") return JUMPS_TESTS
  return SPRINT_TESTS
}

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function seedTests(weekId: string, tests: Array<{ name: string; unit: TestUnit }>, dayOf: (index: number) => number = () => 0) {
  return tests.map((test, index) => ({ id: `${weekId}-test-${index}`, name: test.name, unit: test.unit, dayIndex: dayOf(index) }))
}

function seedSubmission(weekId: string, submittedAt: string, values: Array<[string, ResultChange | null] | null>) {
  const results: Record<string, StoredResult> = {}
  values.forEach((entry, index) => {
    if (entry) results[`${weekId}-test-${index}`] = { value: entry[0], change: entry[1] }
  })
  return { submittedAt, results }
}

function seedWeeks(): StoredWeek[] {
  const sprint = "mock-test-week-1"
  const jumps = "mock-test-week-2"
  const throws = "mock-test-week-3"
  return [
    {
      id: throws,
      name: "March Throwing Benchmark",
      teamId: "t4",
      startDate: "2026-03-02",
      endDate: "2026-03-06",
      status: "published",
      isArchived: false,
      tests: seedTests(throws, THROWS_TESTS, (index) => (index < 3 ? 0 : 2)),
      submissions: {
        a8: seedSubmission(throws, "2026-03-05T08:42:00", [["16.20m", "up"], ["44.15m", "same"], ["38.40m", "up"], ["51cm", "same"], ["140kg", "up"]]),
      },
    },
    {
      id: jumps,
      name: "February Power and Jump Check",
      teamId: "t3",
      startDate: "2026-02-09",
      endDate: "2026-02-13",
      status: "published",
      isArchived: false,
      tests: seedTests(jumps, JUMPS_TESTS),
      submissions: {
        a6: seedSubmission(jumps, "2026-02-13T10:05:00", [["6.45m", "up"], ["61cm", "up"], ["110kg", "same"], ["14.82m", "same"]]),
        a7: seedSubmission(jumps, "2026-02-13T10:22:00", [["6.02m", "down"], ["58cm", "same"], ["125kg", "up"], ["14.10m", "up"]]),
      },
    },
    {
      id: sprint,
      name: "January Speed Testing",
      teamId: "t1",
      startDate: "2026-01-12",
      endDate: "2026-01-16",
      status: "published",
      isArchived: false,
      tests: seedTests(sprint, SPRINT_TESTS),
      submissions: Object.fromEntries(
        mockTestWeekResults.map((row) => [
          row.athleteId,
          seedSubmission(
            sprint,
            "2026-01-15T09:15:00",
            [row.thirtyM, row.flyingThirtyM, row.oneHundredFiftyM, row.squat1RM, row.cmj].map((metric) =>
              metric ? ([metric.value, metric.change] as [string, ResultChange]) : null,
            ),
          ),
        ]),
      ),
    },
  ]
}

function readStoredWeeks(): StoredWeek[] {
  if (typeof window === "undefined") return seedWeeks()
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(STORAGE_KEY))
    if (!raw) return seedWeeks()
    const parsed = JSON.parse(raw) as StoredWeek[]
    return Array.isArray(parsed) ? parsed : seedWeeks()
  } catch {
    return seedWeeks()
  }
}

function writeStoredWeeks(weeks: StoredWeek[]) {
  try {
    window.localStorage.setItem(tenantStorageKey(STORAGE_KEY), JSON.stringify(weeks))
  } catch {
    // Storage can be full or blocked. The session keeps working from memory.
  }
}

const done: ActionResult = { ok: true, data: null }

export default function CoachTestWeekPageClient({ initialRole, initialCoachTeamId, coachTeamIds }: CoachTestWeekPageClientProps) {
  const isCoach = initialRole === "coach"
  const scopedTeamId = isCoach ? initialCoachTeamId : null
  const teamIdsKey = isCoach && coachTeamIds ? coachTeamIds.join(",") : null
  const [storedWeeks, setStoredWeeks] = useState<StoredWeek[]>(readStoredWeeks)

  const commit = useCallback((update: (current: StoredWeek[]) => StoredWeek[]) => {
    setStoredWeeks((current) => {
      const next = update(current)
      writeStoredWeeks(next)
      return next
    })
  }, [])

  // A coach picks from the teams they are assigned to. Club admins get every team.
  const teams = useMemo(() => {
    const allowed = teamIdsKey === null ? null : new Set(teamIdsKey.split(","))
    return mockTeams
      .filter((team) => (allowed ? allowed.has(team.id) : true))
      .map((team) => ({
        id: team.id,
        name: team.name,
        athleteCount: mockAthletes.filter((athlete) => athlete.teamId === team.id).length,
      }))
  }, [teamIdsKey])

  const weeks = useMemo<TestWeekRow[]>(
    () =>
      storedWeeks
        .filter((week) => (scopedTeamId ? week.teamId === scopedTeamId : true))
        .map((week) => ({
          id: week.id,
          name: week.name,
          teamId: week.teamId,
          startDate: week.startDate,
          endDate: week.endDate,
          status: week.status,
          isArchived: week.isArchived,
          testCount: week.tests.length,
          athleteCount: teams.find((team) => team.id === week.teamId)?.athleteCount ?? null,
          submittedCount: Object.keys(week.submissions).length,
        }))
        .sort((left, right) => right.startDate.localeCompare(left.startDate)),
    [scopedTeamId, storedWeeks, teams],
  )

  const loadDetail = useCallback(
    async (testWeekId: string): Promise<ActionResult<TestWeekDetail>> => {
      const week = storedWeeks.find((candidate) => candidate.id === testWeekId)
      if (!week) return { ok: false, message: "This test week no longer exists." }
      return {
        ok: true,
        data: {
          tests: week.tests,
          athletes: mockAthletes
            .filter((athlete) => athlete.teamId === week.teamId)
            .map((athlete) => {
              const submission = week.submissions[athlete.id]
              const results: TestWeekDetail["athletes"][number]["results"] = {}
              for (const test of week.tests) {
                const result = submission?.results[test.id]
                if (result) results[test.id] = { value: result.value, numeric: null, change: result.change }
              }
              return {
                athleteId: athlete.id,
                name: athlete.name,
                primaryEvent: athlete.primaryEvent,
                onRoster: true,
                submittedAt: submission?.submittedAt ?? null,
                results,
              }
            }),
        },
      }
    },
    [storedWeeks],
  )

  const onSave = useCallback(
    async (input: TestWeekSaveInput): Promise<ActionResult<{ id: string }>> => {
      const id = input.id ?? makeId("tw")
      const existing = storedWeeks.find((week) => week.id === id) ?? null
      const tests = input.tests.map((test) => ({ id: test.id ?? makeId("test"), name: test.name, unit: test.unit, dayIndex: test.dayIndex }))
      const keptTestIds = new Set(tests.map((test) => test.id))
      const next: StoredWeek = {
        id,
        name: input.name,
        teamId: input.teamId,
        startDate: input.startDate,
        endDate: input.endDate,
        status: input.publish ? "published" : (existing?.status ?? "draft"),
        isArchived: existing?.isArchived ?? false,
        tests,
        // Results for a removed test go with it, the same as the real backend.
        submissions: Object.fromEntries(
          Object.entries(existing?.submissions ?? {}).map(([athleteId, submission]) => [
            athleteId,
            { ...submission, results: Object.fromEntries(Object.entries(submission.results).filter(([testId]) => keptTestIds.has(testId))) },
          ]),
        ),
      }
      if (input.publish && existing?.status !== "published") onCreateTestWeek()
      commit((current) => (existing ? current.map((week) => (week.id === id ? next : week)) : [next, ...current]))
      return { ok: true, data: { id } }
    },
    [commit, storedWeeks],
  )

  const onPublish = useCallback(
    async (testWeekId: string) => {
      onCreateTestWeek()
      commit((current) => current.map((week) => (week.id === testWeekId ? { ...week, status: "published" as const } : week)))
      return done
    },
    [commit],
  )

  const onSetArchived = useCallback(
    async (testWeekId: string, archived: boolean) => {
      commit((current) => current.map((week) => (week.id === testWeekId ? { ...week, isArchived: archived } : week)))
      return done
    },
    [commit],
  )

  const onDelete = useCallback(
    async (testWeekId: string) => {
      commit((current) => current.filter((week) => week.id !== testWeekId))
      return done
    },
    [commit],
  )

  const starterTests = useCallback((teamId: string) => templateFor(mockTeams.find((team) => team.id === teamId)?.eventGroup), [])

  return (
    <TestWeekScreen
      weeks={weeks}
      teams={teams}
      lockedTeamId={isCoach && teams.length <= 1 ? scopedTeamId : null}
      defaultTeamId={scopedTeamId}
      isLoading={false}
      loadError={null}
      starterTests={starterTests}
      loadDetail={loadDetail}
      onSave={onSave}
      onPublish={onPublish}
      onSetArchived={onSetArchived}
      onDelete={onDelete}
    />
  )
}
