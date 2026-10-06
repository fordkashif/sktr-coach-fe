import { readEditConflict } from "@/lib/data/edit-conflict"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  TestWeekScreen,
  type ActionResult,
  type TestUnit,
  type TestWeekDetail,
  type TestWeekResultInput,
  type TestWeekRow,
  type TestWeekSaveInput,
  type TestWeekSavedResult,
  type TestWeekTeamOption,
} from "@/components/coach/test-week-screen"
import type { Squad } from "@/lib/data/coach/squads"
import { listSquadsForTeams } from "@/lib/data/coach/squads-data"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import type { Result } from "@/lib/data/result"
import {
  deleteTestWeekForCurrentCoach,
  getCoachTestWeekDetail,
  getCoachTestWeeksForCurrentUser,
  saveTestResultForAthleteAsCoach,
  saveTestWeekForCurrentCoach,
  setTestWeekOpenForCurrentCoach,
  updateTestWeekStateForCurrentCoach,
  type CoachTestWeekListItem,
} from "@/lib/data/test-week/test-week-data"
import type { Role } from "@/lib/mock-data"

/** Supabase mode: same screen as mock mode, backed by test_weeks, test_definitions and test_results. */

type Props = {
  initialRole: Role
  initialCoachTeamId: string | null
  /** The coach's assigned teams. Null for club admins, who work on every team. */
  coachTeamIds: string[] | null
}

const STARTER_TESTS: Array<{ name: string; unit: TestUnit }> = [
  { name: "30m", unit: "time" },
  { name: "Flying 30m", unit: "time" },
  { name: "150m", unit: "time" },
  { name: "Squat 1RM", unit: "weight" },
  { name: "CMJ", unit: "height" },
]

function toAction<T, U>(result: Result<T>, map: (data: T) => U): ActionResult<U> {
  return result.ok ? { ok: true, data: map(result.data) } : { ok: false, message: result.error.message, conflict: readEditConflict(result.error) }
}

export default function CoachTestWeekPageSupabaseClient({ initialRole, initialCoachTeamId, coachTeamIds }: Props) {
  const isCoach = initialRole === "coach"
  const scopedTeamId = isCoach ? initialCoachTeamId : null
  const teamIdsKey = isCoach && coachTeamIds ? coachTeamIds.join(",") : null
  const [loadError, setLoadError] = useState<string | null>(null)
  const [teams, setTeams] = useState<TestWeekTeamOption[]>([])
  const [squads, setSquads] = useState<Squad[]>([])
  // The list remembers which team it was loaded for, so a switch never shows the last team's weeks.
  const [loaded, setLoaded] = useState<{ scope: string | null; items: CoachTestWeekListItem[] } | null>(null)
  const isLoading = loaded === null || loaded.scope !== scopedTeamId
  const weekItems = useMemo(() => (loaded && loaded.scope === scopedTeamId ? loaded.items : []), [loaded, scopedTeamId])
  const loadRun = useRef(0)

  const load = useCallback(async () => {
    const run = ++loadRun.current
    const [teamsResult, weeksResult, squadsResult] = await Promise.all([
      getCoachTeamsSnapshotForCurrentUser(),
      getCoachTestWeeksForCurrentUser({ scopeTeamId: scopedTeamId, includeArchived: true }),
      listSquadsForTeams(teamIdsKey === null ? null : teamIdsKey.split(",")),
    ])
    // Only the newest load may land.
    if (run !== loadRun.current) return
    setLoaded((current) => (current && current.scope === scopedTeamId ? current : { scope: scopedTeamId, items: [] }))
    if (!teamsResult.ok) {
      setLoadError(teamsResult.error.message)
      return
    }
    if (!weeksResult.ok) {
      setLoadError(weeksResult.error.message)
      return
    }
    const allowed = teamIdsKey === null ? null : new Set(teamIdsKey.split(","))
    setTeams(
      teamsResult.data.teams
        .filter((team) => (allowed ? allowed.has(team.id) : true))
        .map((team) => ({ id: team.id, name: team.name, athleteCount: team.athleteCount })),
    )
    // Squads are an extra: without them a test week still goes to the whole team.
    setSquads(squadsResult.ok ? squadsResult.data : [])
    setLoaded({ scope: scopedTeamId, items: weeksResult.data })
    setLoadError(null)
  }, [scopedTeamId, teamIdsKey])

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
        squadIds: week.squadIds,
        testCount: week.testCount,
        athleteCount:
          week.squadIds.length > 0
            ? new Set(squads.filter((squad) => week.squadIds.includes(squad.id)).flatMap((squad) => squad.athleteIds)).size
            : week.teamId
              ? (teams.find((team) => team.id === week.teamId)?.athleteCount ?? null)
              : null,
        submittedCount: week.submittedAthleteCount,
      })),
    [squads, teams, weekItems],
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
            { value: value.valueText, numeric: value.valueNumeric, change: value.change, enteredBy: value.enteredByRole },
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
        squadIds: input.squadIds,
        startDate: input.startDate,
        endDate: input.endDate,
        publish: input.publish,
        tests: input.tests,
        guard: { expectedUpdatedAt: input.expectedUpdatedAt, overwrite: input.overwrite },
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

  const onSetOpen = useCallback(
    async (testWeekId: string, open: boolean) => afterWrite(toAction(await setTestWeekOpenForCurrentCoach(testWeekId, open), () => null)),
    [afterWrite],
  )

  // Results are typed one cell at a time, so the list (its "results in" counts) is reloaded once the typing pauses.
  const reloadTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current)
  }, [])
  const onSaveResult = useCallback(
    async (input: TestWeekResultInput): Promise<ActionResult<TestWeekSavedResult | null>> => {
      const result = await saveTestResultForAthleteAsCoach({
        testWeekId: input.testWeekId,
        testDefinitionId: input.testId,
        athleteId: input.athleteId,
        unit: input.unit,
        value: input.value,
      })
      if (result.ok) {
        if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current)
        reloadTimer.current = window.setTimeout(() => void load(), 2000)
      }
      return toAction(result, (saved) =>
        saved ? { value: saved.valueText, numeric: saved.valueNumeric, enteredBy: saved.enteredByRole, submittedAt: saved.submittedAt } : null,
      )
    },
    [load],
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
      squads={squads}
      lockedTeamId={isCoach && (coachTeamIds?.length ?? 0) <= 1 ? scopedTeamId : null}
      defaultTeamId={scopedTeamId}
      isLoading={isLoading}
      loadError={loadError}
      starterTests={starterTests}
      loadDetail={loadDetail}
      onSave={onSave}
      onReload={load}
      onPublish={onPublish}
      onSetOpen={onSetOpen}
      onSaveResult={onSaveResult}
      onSetArchived={onSetArchived}
      onDelete={onDelete}
    />
  )
}
