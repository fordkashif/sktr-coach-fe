import { useMemo } from "react"
import { PlanWorkspace } from "@/components/coach/training-plan/plan-workspace"
import { createSupabasePlanAdapter } from "@/components/coach/training-plan/supabase-adapter"
import type { Role } from "@/lib/mock-data"

type Props = {
  initialRole: Role
  /** The coach's selected team. Ignored for club admins. */
  initialCoachTeamId: string | null
  /** The coach's assigned teams. Null for club admins, who work on every team. */
  coachTeamIds: string[] | null
}

/** Real backend: the same plan workspace as mock mode, stored in Supabase. */
export default function CoachTrainingPlanPageSupabaseClient({ initialRole, initialCoachTeamId, coachTeamIds }: Props) {
  const isCoach = initialRole === "coach"
  const selectedTeamId = isCoach ? initialCoachTeamId : null
  const teamIdsKey = isCoach && coachTeamIds ? coachTeamIds.join(",") : null
  // The joined ids stand in for the array, so the adapter is only rebuilt when the teams really change.
  const adapter = useMemo(
    () => createSupabasePlanAdapter({ listTeamId: selectedTeamId, teamIds: teamIdsKey === null ? null : teamIdsKey.split(",").filter(Boolean) }),
    [selectedTeamId, teamIdsKey],
  )
  // A coach with one team cannot change the team on a plan. With several, the picker lists them all.
  const teamLocked = isCoach && (coachTeamIds?.length ?? 0) <= 1
  return <PlanWorkspace adapter={adapter} selectedTeamId={selectedTeamId} teamLocked={teamLocked} />
}
