import type { Squad } from "@/lib/data/coach/squads"
import { listSquadsForTeams } from "@/lib/data/coach/squads-data"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import { ok } from "@/lib/data/result"
import {
  planFromBuilderState,
  planFromPublishedDetail,
  toBuilderState,
  toPublishStructure,
  type PlanDraft,
} from "@/lib/data/training-plan/plan-builder-model"
import type { TrainingPlanAssignmentRow } from "@/lib/data/training-plan/training-plan-data"
import {
  archiveTrainingPlanForCurrentCoach,
  deleteTrainingPlanForCurrentCoach,
  getTrainingPlanForBuilder,
  listCoachTrainingPlansForCurrentUser,
  listPublishedPlanDaysForTeam,
  publishTrainingPlanForCurrentCoach,
  saveTrainingPlanDraftForCurrentCoach,
} from "@/lib/data/training-plan/training-plan-data"
import { loadedPlanStamps, type AthleteOption, type PlanScope, type PlanStorageAdapter } from "./storage"

/** Real backend: everything goes through src/lib/data/training-plan. */
export function createSupabasePlanAdapter(scope: PlanScope): PlanStorageAdapter {
  const scopeTeamId = scope.listTeamId
  const allowedTeamIds = scope.teamIds ? new Set(scope.teamIds) : null
  let athletes: AthleteOption[] = []
  let squads: Squad[] = []

  /** Everyone a published plan's assignment rows reach right now. */
  const reached = (assignments: TrainingPlanAssignmentRow[]) => {
    const teamIds = new Set(assignments.filter((row) => row.scope === "team").map((row) => row.teamId))
    const squadIds = new Set(assignments.filter((row) => row.scope === "squad").map((row) => row.squadId))
    const athleteIds = new Set(assignments.filter((row) => row.scope === "athlete" && row.athleteId).map((row) => row.athleteId as string))
    for (const athlete of athletes) {
      if (teamIds.has(athlete.teamId)) athleteIds.add(athlete.id)
    }
    const known = new Set(athletes.map((athlete) => athlete.id))
    for (const squad of squads) {
      if (!squadIds.has(squad.id)) continue
      for (const athleteId of squad.athleteIds) if (known.has(athleteId)) athleteIds.add(athleteId)
    }
    return athleteIds
  }

  const loadDirectory: PlanStorageAdapter["loadDirectory"] = async () => {
    const result = await getCoachTeamsSnapshotForCurrentUser()
    if (!result.ok) return result
    const teams = result.data.teams
      .filter((team) => (allowedTeamIds ? allowedTeamIds.has(team.id) : true))
      .map((team) => ({ id: team.id, name: team.name, eventGroup: team.eventGroup }))
    const teamIds = new Set(teams.map((team) => team.id))
    athletes = result.data.athletes
      .filter((athlete) => teamIds.has(athlete.teamId))
      .map((athlete) => ({
        id: athlete.id,
        name: athlete.name,
        teamId: athlete.teamId,
        eventGroup: athlete.eventGroup,
        primaryEvent: athlete.primaryEvent,
      }))
    // Squads are an extra: if they cannot be read the builder still works, with whole team and athletes.
    const squadResult = await listSquadsForTeams([...teamIds])
    squads = squadResult.ok ? squadResult.data : []
    return ok({ teams, athletes, squads })
  }

  return {
    loadDirectory,

    async listPlans() {
      if (athletes.length === 0) {
        const directory = await loadDirectory()
        if (!directory.ok) return directory
      }
      const result = await listCoachTrainingPlansForCurrentUser({ scopeTeamId })
      if (!result.ok) return result
      return ok(
        result.data.map((plan) => {
          const athleteIds = reached(plan.assignments)
          return {
            id: plan.id,
            name: plan.name,
            teamId: plan.teamId,
            startDate: plan.startDate,
            weeks: plan.weeks,
            status: plan.status,
            athleteCount: plan.assignments.length > 0 ? athleteIds.size : null,
            updatedAt: plan.updatedAt,
          }
        }),
      )
    },

    async loadPlan(planId) {
      const result = await getTrainingPlanForBuilder(planId)
      if (!result.ok) return result
      const { plan, builderState, assignments, detail } = result.data
      loadedPlanStamps.set(plan.id, plan.updatedAt)
      const header = {
        id: plan.id,
        status: plan.status,
        name: plan.name,
        teamId: plan.teamId ?? "",
        startDate: plan.startDate,
        weeks: plan.weeks,
        notes: plan.notes ?? "",
      }
      if (builderState) return ok(planFromBuilderState(header, builderState))

      // Published before the builder stored its model: rebuild from what athletes see.
      const draft = planFromPublishedDetail(header, detail)
      const athleteRows = assignments.filter((row) => row.scope === "athlete" && row.athleteId)
      const squadRows = assignments.filter((row) => row.scope === "squad" && row.squadId)
      const first = assignments[0]
      const assign: PlanDraft["assign"] = {
        target: squadRows.length > 0 ? "squads" : athleteRows.length > 0 ? "selected" : "team",
        subgroup: null,
        athleteIds: athleteRows.map((row) => row.athleteId as string),
        squadIds: squadRows.map((row) => row.squadId as string),
        visibilityStart: first?.visibilityStart ?? "immediate",
        visibilityDate: first?.visibilityDate ?? null,
      }
      return ok({ ...draft, assign })
    },

    async saveDraft(plan, options) {
      const result = await saveTrainingPlanDraftForCurrentCoach({
        guard: { expectedUpdatedAt: plan.id ? loadedPlanStamps.get(plan.id) : undefined, overwrite: options?.overwrite },
        planId: plan.id,
        name: plan.name,
        startDate: plan.startDate,
        weeks: plan.weeks,
        notes: plan.notes.trim() || null,
        teamId: plan.teamId || null,
        builderState: toBuilderState(plan),
      })
      if (result.ok) loadedPlanStamps.set(result.data.planId, result.data.updatedAt)
      return result
    },

    async publish(plan, options) {
      const result = await publishTrainingPlanForCurrentCoach({
        guard: { expectedUpdatedAt: plan.id ? loadedPlanStamps.get(plan.id) : undefined, overwrite: options?.overwrite },
        planId: plan.id,
        builderState: toBuilderState(plan),
        name: plan.name,
        startDate: plan.startDate,
        weeks: plan.weeks,
        notes: plan.notes.trim() || null,
        teamId: plan.teamId || null,
        visibilityStart: plan.assign.visibilityStart,
        visibilityDate: plan.assign.visibilityStart === "scheduled" ? plan.assign.visibilityDate : null,
        assignTarget: plan.assign.target,
        assignSubgroup: plan.assign.target === "subgroup" ? plan.assign.subgroup : null,
        selectedAthleteIds: plan.assign.target === "selected" ? plan.assign.athleteIds : [],
        squadIds: plan.assign.target === "squads" ? plan.assign.squadIds : [],
        structure: toPublishStructure(plan),
      })
      if (result.ok) loadedPlanStamps.set(result.data.planId, result.data.updatedAt)
      return result
    },

    async listTeamPlanDays(teamId) {
      if (athletes.length === 0) {
        const directory = await loadDirectory()
        if (!directory.ok) return directory
      }
      const result = await listPublishedPlanDaysForTeam(teamId)
      if (!result.ok) return result
      return ok(result.data.map((plan) => ({ id: plan.id, name: plan.name || "Untitled plan", dates: plan.dates, athleteIds: [...reached(plan.assignments)] })))
    },

    archive: (planId) => archiveTrainingPlanForCurrentCoach(planId),
    remove: (planId) => deleteTrainingPlanForCurrentCoach(planId),
  }
}
