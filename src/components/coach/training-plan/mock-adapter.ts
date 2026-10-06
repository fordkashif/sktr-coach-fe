import { loadMockSquads } from "@/lib/data/coach/squads-mock"
import { err, ok } from "@/lib/data/result"
import { planBlueprints } from "@/lib/data/session/session-from-plan"
import {
  createSkeletonSessions,
  defaultAssign,
  makeId,
  planFromBuilderState,
  toBuilderState,
  validateBasics,
  type PlanDraft,
} from "@/lib/data/training-plan/plan-builder-model"
import { mockAthletes, mockTeams, mockTrainingPlans } from "@/lib/mock-data"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { assignedAthletes, countAssignedAthletes, type PlanScope, type PlanStorageAdapter } from "./storage"

const STORAGE_KEY = "pacelab:coach-training-plans:v1"

type StoredPlan = PlanDraft & { id: string; updatedAt: string | null }
type StoredState = { plans: StoredPlan[]; removedSeedIds: string[] }

/** Plans a coach saved in this browser. Mock athlete screens read published ones from here. */
export function readStoredMockPlans(): Array<PlanDraft & { id: string }> {
  return readState().plans
}

function readState(): StoredState {
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(STORAGE_KEY))
    if (!raw) return { plans: [], removedSeedIds: [] }
    const parsed = JSON.parse(raw) as Partial<StoredState>
    const plans = (Array.isArray(parsed.plans) ? parsed.plans : []).flatMap((plan) => {
      if (!plan || typeof plan !== "object" || typeof plan.id !== "string") return []
      const header = {
        id: plan.id,
        status: plan.status === "published" || plan.status === "archived" ? plan.status : ("draft" as const),
        name: typeof plan.name === "string" ? plan.name : "",
        teamId: typeof plan.teamId === "string" ? plan.teamId : "",
        startDate: typeof plan.startDate === "string" ? plan.startDate : "",
        weeks: Number.isInteger(plan.weeks) && plan.weeks > 0 ? plan.weeks : 1,
        notes: typeof plan.notes === "string" ? plan.notes : "",
      }
      return [{ ...planFromBuilderState(header, plan), id: plan.id, updatedAt: plan.updatedAt ?? null }]
    })
    return {
      plans,
      removedSeedIds: Array.isArray(parsed.removedSeedIds) ? parsed.removedSeedIds.filter((id) => typeof id === "string") : [],
    }
  } catch {
    return { plans: [], removedSeedIds: [] }
  }
}

function writeState(state: StoredState) {
  window.localStorage.setItem(tenantStorageKey(STORAGE_KEY), JSON.stringify(state))
}

/** Demo plans that exist before the coach has made anything. */
function seedPlans(scopeTeamId: string | null): StoredPlan[] {
  const seeds: StoredPlan[] = []
  const demoTeam = mockTeams.find((team) => team.id === scopeTeamId) ?? mockTeams[0]
  if (demoTeam) {
    seeds.push({
      id: `seed-general-prep-${demoTeam.id}`,
      status: "published",
      name: "General preparation block",
      teamId: demoTeam.id,
      startDate: "2026-01-05",
      weeks: 4,
      notes: "",
      weekFocus: { "1": "Build the base" },
      sessions: createSkeletonSessions(4, demoTeam.eventGroup, 5),
      assign: defaultAssign(),
      updatedAt: null,
    })
  }
  for (const plan of mockTrainingPlans) {
    if (scopeTeamId && plan.teamId !== scopeTeamId) continue
    const team = mockTeams.find((candidate) => candidate.id === plan.teamId)
    seeds.push({
      id: plan.id,
      status: "published",
      name: plan.name,
      teamId: plan.teamId,
      startDate: plan.startDate,
      weeks: plan.weeks,
      notes: "",
      weekFocus: {},
      sessions: createSkeletonSessions(plan.weeks, team?.eventGroup ?? "Sprint", 5),
      assign:
        plan.assignedTo === "athlete"
          ? { ...defaultAssign(), target: "selected", athleteIds: plan.assignedAthleteIds ?? [] }
          : defaultAssign(),
      updatedAt: null,
    })
  }
  return seeds
}

/** Mock mode: plans live in localStorage, per tenant, on top of a few demo plans. */
export function createMockPlanAdapter(scope: PlanScope): PlanStorageAdapter {
  const scopeTeamId = scope.listTeamId
  const allowedTeamIds = scope.teamIds ? new Set(scope.teamIds) : null
  const athletes = mockAthletes
    .filter((athlete) => (allowedTeamIds ? allowedTeamIds.has(athlete.teamId) : true))
    .map((athlete) => ({
      id: athlete.id,
      name: athlete.name,
      teamId: athlete.teamId,
      eventGroup: athlete.eventGroup,
      primaryEvent: athlete.primaryEvent,
    }))
  // Read on every use: the coach may have changed a squad on the roster since the plans page opened.
  const squads = () => loadMockSquads().filter((squad) => (allowedTeamIds ? allowedTeamIds.has(squad.teamId) : true))
  // Seeds are generated once per adapter so their session ids stay stable while the page is open.
  const seeds = seedPlans(scopeTeamId)

  const allPlans = () => {
    const state = readState()
    const storedIds = new Set(state.plans.map((plan) => plan.id))
    const visibleSeeds = seeds.filter((seed) => !storedIds.has(seed.id) && !state.removedSeedIds.includes(seed.id))
    return [...state.plans, ...visibleSeeds].filter((plan) => (allowedTeamIds ? allowedTeamIds.has(plan.teamId) : true))
  }
  const listedPlans = () => allPlans().filter((plan) => (scopeTeamId ? plan.teamId === scopeTeamId : true))

  const store = (plan: StoredPlan) => {
    const state = readState()
    writeState({ ...state, plans: [plan, ...state.plans.filter((existing) => existing.id !== plan.id)] })
  }

  return {
    async loadDirectory() {
      const teams = mockTeams
        .filter((team) => (allowedTeamIds ? allowedTeamIds.has(team.id) : true))
        .map((team) => ({ id: team.id, name: team.name, eventGroup: team.eventGroup }))
      return ok({ teams, athletes, squads: squads() })
    },

    async listPlans() {
      return ok(
        listedPlans()
          .map((plan) => ({
            id: plan.id,
            name: plan.name,
            teamId: plan.teamId || null,
            startDate: plan.startDate,
            weeks: plan.weeks,
            status: plan.status,
            athleteCount: plan.status === "draft" ? null : countAssignedAthletes(plan, athletes, squads()),
            updatedAt: plan.updatedAt,
          }))
          .sort((left, right) => right.startDate.localeCompare(left.startDate)),
      )
    },

    async loadPlan(planId) {
      const plan = allPlans().find((candidate) => candidate.id === planId)
      if (!plan) return err("NOT_FOUND", "This plan no longer exists.")
      return ok(planFromBuilderState(plan, toBuilderState(plan)))
    },

    async saveDraft(plan) {
      const invalid = validateBasics(plan)
      if (invalid) return err("VALIDATION", invalid)
      const existing = plan.id ? allPlans().find((candidate) => candidate.id === plan.id) : null
      if (existing && existing.status !== "draft") {
        return err("CONFLICT", "This plan is no longer a draft, so it was not saved. Reload your plans and try again.")
      }
      try {
        const planId = plan.id ?? makeId("plan")
        store({ ...plan, id: planId, status: "draft", updatedAt: new Date().toISOString() })
        return ok({ planId })
      } catch {
        return err("UNKNOWN", "Could not save the draft in this browser. Storage may be full or blocked.")
      }
    },

    async publish(plan) {
      const invalid = validateBasics(plan)
      if (invalid) return err("VALIDATION", invalid)
      const assignedCount = countAssignedAthletes(plan, athletes, squads())
      try {
        const planId = plan.id ?? makeId("plan")
        store({ ...plan, id: planId, status: "published", updatedAt: new Date().toISOString() })
        return ok({ planId, assignedCount })
      } catch {
        return err("UNKNOWN", "Could not publish the plan in this browser. Storage may be full or blocked.")
      }
    },

    async listTeamPlanDays(teamId) {
      const live = squads()
      return ok(
        allPlans()
          .filter((plan) => plan.status === "published" && plan.teamId === teamId)
          .map((plan) => ({
            id: plan.id,
            name: plan.name || "Untitled plan",
            dates: planBlueprints(plan).map((blueprint) => blueprint.date),
            athleteIds: assignedAthletes(plan, athletes, live).map((athlete) => athlete.id),
          })),
      )
    },

    async archive(planId) {
      const plan = allPlans().find((candidate) => candidate.id === planId)
      if (!plan) return err("NOT_FOUND", "This plan could not be archived. It may have been removed.")
      store({ ...plan, status: "archived", updatedAt: new Date().toISOString() })
      return ok({ planId })
    },

    async remove(planId) {
      const state = readState()
      const isSeed = seeds.some((seed) => seed.id === planId)
      if (!isSeed && !state.plans.some((plan) => plan.id === planId)) {
        return err("NOT_FOUND", "This plan could not be deleted. It may already be gone.")
      }
      writeState({
        plans: state.plans.filter((plan) => plan.id !== planId),
        removedSeedIds: isSeed ? [...new Set([...state.removedSeedIds, planId])] : state.removedSeedIds,
      })
      return ok({ planId })
    },
  }
}
