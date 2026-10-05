"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  TestWeekScreen,
  type ActionResult,
  type TestUnit,
  type TestWeekDetail,
  type TestWeekRow,
  type TestWeekSaveInput,
  type TestWeekTeamOption,
} from "@/components/coach/test-week-screen"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import type { Result } from "@/lib/data/result"
import {
  deleteTestWeekForCurrentCoach,
  getCoachTestWeekDetail,
  getCoachTestWeeksForCurrentUser,
  saveTestWeekForCurrentCoach,
  updateTestWeekStateForCurrentCoach,
  type CoachTestWeekListItem,
} from "@/lib/data/test-week/test-week-data"
import type { Role } from "@/lib/mock-data"

/** Supabase mode: same screen as mock mode, backed by test_weeks, test_definitions and test_results. */

type Props = {
  initialRole: Role
  initialCoachTeamId: string | null
}

const STARTER_TESTS: Array<{ name: string; unit: TestUnit }> = [
  { name: "30m", unit: "time" },
  { name: "Flying 30m", unit: "time" },
  { name: "150m", unit: "time" },
  { name: "Squat 1RM", unit: "weight" },
  { name: "CMJ", unit: "height" },
]

function toAction<T, U>(result: Result<T>, map: (data: T) => U): ActionResult<U> {
  return result.ok ? { ok: true, data: map(result.data) } : { ok: false, message: result.error.message }
}

export default function CoachTestWeekPageSupabaseClient({ initialRole, initialCoachTeamId }: Props) {
  const scopedTeamId = initialRole === "coach" ? initialCoachTeamId : null
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [teams, setTeams] = useState<TestWeekTeamOption[]>([])
  const [weekItems, setWeekItems] = useState<CoachTestWeekListItem[]>([])

  const load = useCallback(async () => {
    const [teamsResult, weeksResult] = await Promise.all([
      getCoachTeamsSnapshotForCurrentUser(),
      getCoachTestWeeksForCurrentUser({ scopeTeamId: scopedTeamId, includeArchived: true }),
    ])
    setIsLoading(false)
    if (!teamsResult.ok) {
      setLoadError(teamsResult.error.message)
      return
    }
    if (!weeksResult.ok) {
      setLoadError(weeksResult.error.message)
      return
    }
    setTeams(teamsResult.data.teams.map((team) => ({ id: team.id, name: team.name, athleteCount: team.athleteCount })))
    setWeekItems(weeksResult.data)
    setLoadError(null)
  }, [scopedTeamId])

  useEffect(() => {
    void load()
  }, [load])

  const weeks = useMemo<TestWeekRow[]>(
    () =>
      weekItems.map((week) => ({
        id: week.id,
        name: week.name,
        teamId: week.teamId,
        startDate: week.startDate,
        endDate: week.endDate,
        status: week.status,
        isArchived: week.isArchived,
        testCount: week.testCount,
        athleteCount: week.teamId ? (teams.find((team) => team.id === week.teamId)?.athleteCount ?? null) : null,
        submittedCount: week.submittedAthleteCount,
      })),
    [teams, weekItems],
  )

  const loadDetail = useCallback(async (testWeekId: string): Promise<ActionResult<TestWeekDetail>> => {
    const result = await getCoachTestWeekDetail(testWeekId)
    return toAction(result, (detail) => ({
      tests: detail.tests.map((test) => ({ id: test.id, name: test.name, unit: test.unit, dayIndex: test.dayIndex })),
      athletes: detail.athletes.map((athlete) => ({
        athleteId: athlete.athleteId,
        name: athlete.name,
        primaryEvent: athlete.primaryEvent,
        onRoster: athlete.onRoster,
        submittedAt: athlete.submittedAt,
        results: Object.fromEntries(
          Object.entries(athlete.resultsByDefinitionId).map(([definitionId, value]) => [
            definitionId,
            { value: value.valueText, numeric: value.valueNumeric, change: value.change },
          ]),
        ),
      })),
    }))
  }, [])

  // Every write reloads the list so counts and status tags stay true to the database.
  const afterWrite = useCallback(
    async <T,>(result: ActionResult<T>) => {
      if (result.ok) await load()
      return result
    },
    [load],
  )

  const onSave = useCallback(
    async (input: TestWeekSaveInput) => {
      const result = await saveTestWeekForCurrentCoach({
        testWeekId: input.id,
        name: input.name,
        teamId: input.teamId,
        startDate: input.startDate,
        endDate: input.endDate,
        publish: input.publish,
        tests: input.tests,
      })
      return afterWrite(toAction(result, (data) => ({ id: data.testWeekId })))
    },
    [afterWrite],
  )

  const onPublish = useCallback(
    async (testWeekId: string) =>
      afterWrite(toAction(await updateTestWeekStateForCurrentCoach(testWeekId, { status: "published" }), () => null)),
    [afterWrite],
  )

  const onSetArchived = useCallback(
    async (testWeekId: string, archived: boolean) =>
      afterWrite(toAction(await updateTestWeekStateForCurrentCoach(testWeekId, { isArchived: archived }), () => null)),
    [afterWrite],
  )

  const onDelete = useCallback(
    async (testWeekId: string) => afterWrite(toAction(await deleteTestWeekForCurrentCoach(testWeekId), () => null)),
    [afterWrite],
  )

  const starterTests = useCallback(() => STARTER_TESTS, [])

  return (
    <TestWeekScreen
      weeks={weeks}
      teams={teams}
      lockedTeamId={scopedTeamId}
      isLoading={isLoading}
      loadError={loadError}
      starterTests={starterTests}
      loadDetail={loadDetail}
      onSave={onSave}
      onPublish={onPublish}
      onSetArchived={onSetArchived}
      onDelete={onDelete}
    />
  )
}
