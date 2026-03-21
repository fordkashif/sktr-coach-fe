import CoachTestWeekPageClient from "@/components/coach/test-week-page-client"
import CoachTestWeekPageSupabaseClient from "@/components/coach/test-week-page-supabase-client"
import { COACH_TEAM_COOKIE, getCookieValue, ROLE_COOKIE } from "@/lib/auth-session"
import type { Role } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"

export default function CoachTestWeekPage() {
  const backendMode = getBackendMode()
  const role = (getCookieValue(ROLE_COOKIE) as Role | null) ?? "coach"
  const coachTeamId = getCookieValue(COACH_TEAM_COOKIE)

  if (backendMode === "supabase") {
    return <CoachTestWeekPageSupabaseClient initialRole={role} initialCoachTeamId={coachTeamId} />
  }

  return <CoachTestWeekPageClient initialRole={role} initialCoachTeamId={coachTeamId} />
}
