import { useMemo } from "react"
import CoachTestWeekPageClient from "@/components/coach/test-week-page-client"
import CoachTestWeekPageSupabaseClient from "@/components/coach/test-week-page-supabase-client"
import { ScreenSkeleton } from "@/components/sk"
import { useCoachTeamScope } from "@/lib/coach-teams"
import { getBackendMode } from "@/lib/supabase/config"
type CoachPageRole = "coach" | "club-admin"

export default function CoachTestWeekPage() {
  const backendMode = getBackendMode()
  const { role: cookieRole, coachTeamId, coachTeams, coachTeamsLoading } = useCoachTeamScope()
  const role: CoachPageRole = cookieRole === "club-admin" ? "club-admin" : "coach"
  // Null means every team (club admins). A coach gets the teams they are assigned to.
  const coachTeamIds = useMemo(() => (role === "coach" ? coachTeams.map((team) => team.id) : null), [coachTeams, role])

  if (coachTeamsLoading) return <ScreenSkeleton />

  return (
    backendMode === "supabase" ? (
      <CoachTestWeekPageSupabaseClient initialRole={role} initialCoachTeamId={coachTeamId} coachTeamIds={coachTeamIds} />
    ) : (
      <CoachTestWeekPageClient initialRole={role} initialCoachTeamId={coachTeamId} coachTeamIds={coachTeamIds} />
    )
  )
}
