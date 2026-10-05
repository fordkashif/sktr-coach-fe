import { useMemo } from "react"
import { PlanWorkspace } from "@/components/coach/training-plan/plan-workspace"
import { createSupabasePlanAdapter } from "@/components/coach/training-plan/supabase-adapter"
import type { Role } from "@/lib/mock-data"

type Props = {
  initialRole: Role
  initialCoachTeamId: string | null
}

/** Real backend: the same plan workspace as mock mode, stored in Supabase. */
export default function CoachTrainingPlanPageSupabaseClient({ initialRole, initialCoachTeamId }: Props) {
  const lockedTeamId = initialRole === "coach" ? initialCoachTeamId : null
  const adapter = useMemo(() => createSupabasePlanAdapter(lockedTeamId), [lockedTeamId])
  return <PlanWorkspace adapter={adapter} lockedTeamId={lockedTeamId} />
}
