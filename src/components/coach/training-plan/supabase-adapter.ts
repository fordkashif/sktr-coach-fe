import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import { ok } from "@/lib/data/result"
import {
  planFromBuilderState,
  planFromPublishedDetail,
  toBuilderState,
  toPublishStructure,
  type PlanDraft,
} from "@/lib/data/training-plan/plan-builder-model"
import {
  archiveTrainingPlanForCurrentCoach,
  deleteTrainingPlanForCurrentCoach,
  getTrainingPlanForBuilder,
  listCoachTrainingPlansForCurrentUser,
  publishTrainingPlanForCurrentCoach,
  saveTrainingPlanDraftForCurrentCoach,
} from "@/lib/data/training-plan/training-plan-data"
import type { AthleteOption, PlanStorageAdapter } from "./storage"

/** Real backend: everything goes through src/lib/data/training-plan. */
export function createSupabasePlanAdapter(scopeTeamId: string | null): PlanStorageAdapter {
  let athletes: AthleteOption[] = []

  const loadDirectory: PlanStorageAdapter["loadDirectory"] = async () => {
    const result = await getCoachTeamsSnapshotForCurrentUser()
    if (!result.ok) return result
    const teams = result.data.teams
      .filter((team) => (scopeTeamId ? team.id === scopeTeamId : true))
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
    return ok({ teams, athletes })
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
          const teamIds = new Set(plan.assignments.filter((row) => row.scope === "team").map((row) => row.teamId))
          const athleteIds = new Set(
            plan.assignments.filter((row) => row.scope === "athlete" && row.athleteId).map((row) => row.athleteId as string),
          )
          for (const athlete of athletes) {
            if (teamIds.has(athlete.teamId)) athleteIds.add(athlete.id)
          }
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
      const first = assignments[0]
      const assign: PlanDraft["assign"] = {
        target: athleteRows.length > 0 ? "selected" : "team",
        subgroup: null,
        athleteIds: athleteRows.map((row) => row.athleteId as string),
        visibilityStart: first?.visibilityStart ?? "immediate",
        visibilityDate: first?.visibilityDate ?? null,
      }
      return ok({ ...draft, assign })
    },

    saveDraft(plan) {
      return saveTrainingPlanDraftForCurrentCoach({
        planId: plan.id,
        name: plan.name,
        startDate: plan.startDate,
        weeks: plan.weeks,
        notes: plan.notes.trim() || null,
        teamId: plan.teamId || null,
        builderState: toBuilderState(plan),
      })
    },

    publish(plan) {
      return publishTrainingPlanForCurrentCoach({
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
        structure: toPublishStructure(plan),
      })
    },

    archive: (planId) => archiveTrainingPlanForCurrentCoach(planId),
    remove: (planId) => deleteTrainingPlanForCurrentCoach(planId),
  }
}
