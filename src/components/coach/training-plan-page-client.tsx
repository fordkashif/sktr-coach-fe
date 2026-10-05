import { useMemo } from "react"
import { createMockPlanAdapter } from "@/components/coach/training-plan/mock-adapter"
import { PlanWorkspace } from "@/components/coach/training-plan/plan-workspace"
import type { Role } from "@/lib/mock-data"

interface CoachTrainingPlanPageClientProps {
  initialRole: Role
  initialCoachTeamId: string | null
}

/** Mock mode: the shared plan workspace on top of browser storage and demo data. */
export default function CoachTrainingPlanPageClient({ initialRole, initialCoachTeamId }: CoachTrainingPlanPageClientProps) {
  const lockedTeamId = initialRole === "coach" ? initialCoachTeamId : null
  const adapter = useMemo(() => createMockPlanAdapter(lockedTeamId), [lockedTeamId])
  return <PlanWorkspace adapter={adapter} lockedTeamId={lockedTeamId} />
}
