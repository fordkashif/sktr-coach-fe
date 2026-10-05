import { lazy, Suspense, useMemo } from "react"
import { useCoachTeamScope } from "@/lib/coach-teams"
import { getBackendMode } from "@/lib/supabase/config"

// Each backend mode loads only its own storage code (mock data stays out of the real bundle).
const CoachTrainingPlanPageClient = lazy(() => import("@/components/coach/training-plan-page-client"))
const CoachTrainingPlanPageSupabaseClient = lazy(() => import("@/components/coach/training-plan-page-supabase-client"))

type CoachPageRole = "coach" | "club-admin"

export default function CoachTrainingPlanPage() {
  const backendMode = getBackendMode()
  const { role: cookieRole, coachTeamId, coachTeams, coachTeamsLoading } = useCoachTeamScope()
  const role: CoachPageRole = cookieRole === "club-admin" ? "club-admin" : "coach"
  // Null means every team (club admins). A coach gets the teams they are assigned to.
  const coachTeamIds = useMemo(() => (role === "coach" ? coachTeams.map((team) => team.id) : null), [coachTeams, role])

  if (coachTeamsLoading) return <div className="sk-page" aria-busy="true" />

  return (
    <Suspense fallback={<div className="sk-page" aria-busy="true" />}>
      {backendMode === "supabase" ? (
        <CoachTrainingPlanPageSupabaseClient initialRole={role} initialCoachTeamId={coachTeamId} coachTeamIds={coachTeamIds} />
      ) : (
        <CoachTrainingPlanPageClient initialRole={role} initialCoachTeamId={coachTeamId} coachTeamIds={coachTeamIds} />
      )}
    </Suspense>
  )
}
