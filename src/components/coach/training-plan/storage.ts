import { reachedAthleteIds, type PlanDays, type Squad } from "@/lib/data/coach/squads"
import type { Result } from "@/lib/data/result"
import type { PlanDraft, PlanStatus } from "@/lib/data/training-plan/plan-builder-model"
import type { EventGroup } from "@/lib/mock-data"

export type TeamOption = {
  id: string
  name: string
  eventGroup: EventGroup
}

export type AthleteOption = {
  id: string
  name: string
  teamId: string
  eventGroup: EventGroup
  primaryEvent: string
}

export type PlanDirectory = {
  teams: TeamOption[]
  athletes: AthleteOption[]
  /** The live squads of those teams, with their members. */
  squads: Squad[]
}

export type PlanListItem = {
  id: string
  name: string
  teamId: string | null
  startDate: string
  weeks: number
  status: PlanStatus
  /** Athletes the plan is delivered to. Null when it is not assigned yet (drafts). */
  athleteCount: number | null
  updatedAt: string | null
}

/**
 * Which teams a plan screen works on.
 * listTeamId: the plan list shows this team only (a coach's selected team). Null lists every team.
 * teamIds: the teams the user may build for (a coach's assigned teams). Null means every team (club admins).
 */
export type PlanScope = {
  listTeamId: string | null
  teamIds: string[] | null
}

/**
 * A save is refused (CONFLICT, see readEditConflict) when the plan changed since loadPlan read it.
 * `overwrite` is "Save mine anyway".
 */
export type PlanSaveOptions = { overwrite?: boolean }

/** What each plan looked like when this browser last loaded or saved it (its updated_at). */
export const loadedPlanStamps = new Map<string, string | null>()

/**
 * Where plans live. The builder UI only talks to this, so mock mode and the real
 * backend get exactly the same screen and the same features.
 */
export interface PlanStorageAdapter {
  loadDirectory(): Promise<Result<PlanDirectory>>
  listPlans(): Promise<Result<PlanListItem[]>>
  loadPlan(planId: string): Promise<Result<PlanDraft>>
  /** Creates or overwrites a draft. Never reaches athletes. */
  saveDraft(plan: PlanDraft, options?: PlanSaveOptions): Promise<Result<{ planId: string }>>
  /** Publishes a new plan or a draft, or saves changes to a plan that is already published. */
  publish(plan: PlanDraft, options?: PlanSaveOptions): Promise<Result<{ planId: string; assignedCount: number }>>
  archive(planId: string): Promise<Result<{ planId: string }>>
  remove(planId: string): Promise<Result<{ planId: string }>>
  /**
   * The published plans of one team with the days they have a session on and who they reach, so
   * the publish step can say when an athlete will get two sessions on one day.
   */
  listTeamPlanDays(teamId: string): Promise<Result<PlanDays[]>>
}

/** The athletes a draft's assignment settings would reach. */
export function assignedAthletes(plan: PlanDraft, athletes: AthleteOption[], squads: Squad[] = []) {
  const ids = new Set(
    reachedAthleteIds(
      { teamId: plan.teamId, target: plan.assign.target, squadIds: plan.assign.squadIds, subgroup: plan.assign.subgroup, athleteIds: plan.assign.athleteIds },
      athletes,
      squads,
    ),
  )
  return athletes.filter((athlete) => ids.has(athlete.id))
}

/** How many athletes a draft's assignment settings would reach. */
export function countAssignedAthletes(plan: PlanDraft, athletes: AthleteOption[], squads: Squad[] = []) {
  return assignedAthletes(plan, athletes, squads).length
}
