import { Plus } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { PlansNav } from "@/components/coach/training-plan/plans-nav"
import type { PlanDirectory, PlanScope } from "@/components/coach/training-plan/storage"
import { Button, EmptyState, EntryGrid, Field, Notice, Screen, ScreenHeader, Section, SkeletonRows, SuggestInput, TableSub, type SaveStateValue } from "@/components/sk"
import { useCoachTeamScope } from "@/lib/coach-teams"
import { listLibraryExercises, listLiftMaxes, removeLiftMax, saveLiftMax } from "@/lib/data/exercises/exercise-data"
import { liftKey } from "@/lib/data/exercises/loads"
import type { LiftMax } from "@/lib/data/exercises/types"
import type { Result } from "@/lib/data/result"
import { getBackendMode } from "@/lib/supabase/config"

/** Teams and athletes come from the same place as the plan builder, so both modes agree on who is listed. */
async function loadDirectory(scope: PlanScope): Promise<Result<PlanDirectory>> {
  const adapter =
    getBackendMode() === "supabase"
      ? (await import("@/components/coach/training-plan/supabase-adapter")).createSupabasePlanAdapter(scope)
      : (await import("@/components/coach/training-plan/mock-adapter")).createMockPlanAdapter(scope)
  return adapter.loadDirectory()
}

function parseKg(text: string): number | null {
  const cleaned = text.trim().replace(/\s*kg$/i, "").replace(",", ".")
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  return Number.parseFloat(cleaned)
}

function formatDay(dateIso: string | null) {
  if (!dateIso) return ""
  const date = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}

/**
 * Each athlete's best single lift (1RM), one column per lift. A plan row written as a percentage
 * ("80%") is turned into kilograms from these numbers.
 */
export default function CoachLiftMaxesPage() {
  const { role, coachTeamId, coachTeams, coachTeamsLoading } = useCoachTeamScope()
  const isCoach = role !== "club-admin"
  const teamIdsKey = isCoach ? coachTeams.map((team) => team.id).join(",") : null
  const [params] = useSearchParams()
  const askedLift = params.get("lift")?.trim() ?? ""

  const [directory, setDirectory] = useState<PlanDirectory>({ teams: [], athletes: [] })
  const [maxes, setMaxes] = useState<LiftMax[]>([])
  const [libraryLifts, setLibraryLifts] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [extraLifts, setExtraLifts] = useState<string[]>(() => (askedLift ? [askedLift] : []))
  const [newLift, setNewLift] = useState("")
  const [cellState, setCellState] = useState<Record<string, { state: SaveStateValue; message?: string | null }>>({})
  const run = useRef(0)

  const athletes = useMemo(() => directory.athletes.filter((athlete) => (isCoach && coachTeamId ? athlete.teamId === coachTeamId : true)), [coachTeamId, directory.athletes, isCoach])
  const athleteIdsKey = athletes.map((athlete) => athlete.id).join(",")

  useEffect(() => {
    if (coachTeamsLoading) return
    const current = ++run.current
    void (async () => {
      const [directoryResult, libraryResult] = await Promise.all([
        loadDirectory({ listTeamId: isCoach ? coachTeamId : null, teamIds: teamIdsKey === null ? null : teamIdsKey.split(",").filter(Boolean) }),
        listLibraryExercises(),
      ])
      if (current !== run.current) return
      if (!directoryResult.ok) {
        setLoading(false)
        return setError(`Could not load your athletes: ${directoryResult.error.message}`)
      }
      setDirectory(directoryResult.data)
      if (libraryResult.ok) setLibraryLifts(libraryResult.data.filter((exercise) => !exercise.archived && exercise.measure === "reps_load" && exercise.category === "strength").map((exercise) => exercise.name))
    })()
  }, [coachTeamId, coachTeamsLoading, isCoach, teamIdsKey])

  const reloadMaxes = useCallback(async () => {
    const ids = athleteIdsKey ? athleteIdsKey.split(",") : []
    const result = await listLiftMaxes(ids)
    setLoading(false)
    if (!result.ok) return setError(`Could not load the best lifts: ${result.error.message}`)
    setError(null)
    setMaxes(result.data)
  }, [athleteIdsKey])

  useEffect(() => {
    if (coachTeamsLoading || directory.teams.length + directory.athletes.length === 0) return
    void reloadMaxes()
  }, [coachTeamsLoading, directory, reloadMaxes])

  // One column per lift: every lift that has a number, then the ones the coach added here.
  const lifts = useMemo(() => {
    const byKey = new Map<string, string>()
    for (const max of [...maxes].sort((left, right) => left.liftName.localeCompare(right.liftName))) if (!byKey.has(max.liftKey)) byKey.set(max.liftKey, max.liftName)
    for (const name of extraLifts) if (liftKey(name) && !byKey.has(liftKey(name))) byKey.set(liftKey(name), name)
    if (byKey.size === 0) byKey.set(liftKey("Back squat"), "Back squat")
    return [...byKey.entries()].map(([key, name]) => ({ key, name }))
  }, [extraLifts, maxes])

  const maxByCell = useMemo(() => new Map(maxes.map((max) => [`${max.athleteId}|${max.liftKey}`, max])), [maxes])
  const teamName = (teamId: string) => directory.teams.find((team) => team.id === teamId)?.name ?? ""
  const showTeam = !isCoach || !coachTeamId

  const addLift = () => {
    const name = newLift.trim()
    if (!liftKey(name)) return
    setExtraLifts((current) => [...current, name])
    setNewLift("")
  }

  const commit = async (athleteId: string, key: string, text: string) => {
    const cellId = `${athleteId}|${key}`
    const lift = lifts.find((entry) => entry.key === key)
    if (!lift) return
    const saved = maxByCell.get(cellId)
    setCellState((current) => ({ ...current, [cellId]: { state: "saving" } }))
    const value = parseKg(text)
    const result =
      value === null
        ? saved?.source === "result"
          ? ({ ok: false, error: { code: "VALIDATION", message: "This best comes from the athlete's results. Type a number over it to correct it." } } as const)
          : await removeLiftMax(athleteId, lift.name)
        : await saveLiftMax({ athleteId, liftName: saved?.source === "result" ? lift.name : (saved?.liftName ?? lift.name), valueKg: value })
    if (!result.ok) return setCellState((current) => ({ ...current, [cellId]: { state: "error", message: result.error.message } }))
    await reloadMaxes()
    setCellState((current) => ({ ...current, [cellId]: { state: "saved" } }))
  }

  const fromResults = maxes.filter((max) => max.source === "result").length
  const lede = "Each athlete's best single lift (1RM), in kilograms. A plan load written as a percentage is worked out from these, to the nearest 2.5 kg."

  return (
    <Screen>
      <ScreenHeader title="Best lifts" lede={lede} />
      <PlansNav />

      {error ? <Notice tone="error">{error}</Notice> : null}

      <Section title="By athlete" hint="Type a number and move on. It saves by itself, and athletes see the new weight in sessions they have not finished." meta={athletes.length > 0 ? `${athletes.length} ${athletes.length === 1 ? "athlete" : "athletes"}` : undefined}>
        {loading || coachTeamsLoading ? (
          <SkeletonRows rows={5} label="Loading best lifts" />
        ) : athletes.length === 0 ? (
          <EmptyState title="No athletes yet" body="Athletes on your team are listed here once they are added." />
        ) : (
          <>
            <EntryGrid
              className="mt-3"
              caption="Best single lift per athlete, in kilograms"
              rowHeader="Athlete"
              rows={athletes.map((athlete) => ({
                key: athlete.id,
                label: athlete.name,
                header: (
                  <>
                    {athlete.name}
                    {showTeam ? <TableSub>{teamName(athlete.teamId)}</TableSub> : null}
                  </>
                ),
              }))}
              columns={lifts.map((lift) => ({ key: lift.key, header: lift.name, sub: "kg" }))}
              cell={(athleteId, key) => {
                const max = maxByCell.get(`${athleteId}|${key}`)
                const state = cellState[`${athleteId}|${key}`]
                return { value: max ? String(max.valueKg) : "", state: state?.state ?? "idle", message: state?.message ?? (max ? `${max.source === "result" ? "From results" : max.source === "athlete" ? "Entered by the athlete" : "Entered by a coach"}${max.measuredOn ? `, ${formatDay(max.measuredOn)}` : ""}` : null), marked: max?.source === "result" }
              }}
              validate={(_key, text) => {
                if (!text.trim()) return null
                const value = parseKg(text)
                if (value === null || value <= 0) return "Write the weight in kilograms, like 120 or 122.5."
                return value > 1000 ? "That is more than anyone has lifted. Check the number." : null
              }}
              onCommit={(athleteId, key, text) => void commit(athleteId, key, text)}
            />
            {fromResults > 0 ? <p className="sk-list-sub mt-2">A number with a dot comes from the athlete's results (a test week, for example). Type over it to correct it.</p> : null}

            <form
              className="mt-5 flex max-w-md items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                addLift()
              }}
            >
              <Field label="Add a lift" className="min-w-0 flex-1">
                <SuggestInput
                  value={newLift}
                  onValueChange={setNewLift}
                  options={libraryLifts.filter((name) => !lifts.some((lift) => lift.key === liftKey(name))).map((name) => ({ id: name, label: name }))}
                  onPick={(option) => setNewLift(option.label)}
                  aria-label="Add a lift"
                  listLabel="Strength exercises in the library"
                  placeholder="Power clean"
                  maxLength={80}
                />
              </Field>
              <Button type="submit" disabled={!liftKey(newLift) || lifts.some((lift) => lift.key === liftKey(newLift))}>
                <Plus className="size-5" weight="bold" aria-hidden />
                Add column
              </Button>
            </form>
          </>
        )}
      </Section>
    </Screen>
  )
}
