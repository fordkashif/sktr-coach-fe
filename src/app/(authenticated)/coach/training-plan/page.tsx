import CoachTrainingPlanPageClient from "@/components/coach/training-plan-page-client"
import CoachTrainingPlanPageSupabaseClient from "@/components/coach/training-plan-page-supabase-client"
import { COACH_TEAM_COOKIE, getCookieValue, ROLE_COOKIE } from "@/lib/auth-session"
import type { Role } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"

export default function CoachTrainingPlanPage() {
  const backendMode = getBackendMode()
  const role = (getCookieValue(ROLE_COOKIE) as Role | null) ?? "coach"
  const coachTeamId = getCookieValue(COACH_TEAM_COOKIE)

  if (backendMode === "supabase") {
    return <CoachTrainingPlanPageSupabaseClient initialRole={role} initialCoachTeamId={coachTeamId} />
  }

  return <CoachTrainingPlanPageClient initialRole={role} initialCoachTeamId={coachTeamId} />
}
