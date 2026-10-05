import { useParams } from "react-router-dom"
import { CoachAthleteDetailContent } from "@/components/coach/athlete-detail-content"
import { ScreenSkeleton } from "@/components/sk"
import { useCoachTeamScope } from "@/lib/coach-teams"

export default function CoachAthleteDetailPage() {
  const { athleteId = "" } = useParams()
  const { coachTeamId, coachTeamsLoading } = useCoachTeamScope()
  // A coach's teams are known before the athlete loads, so the team switcher and this screen agree.
  if (coachTeamsLoading) return <ScreenSkeleton />
  // One screen per athlete in the address, so nothing from the previous athlete is ever shown.
  return <CoachAthleteDetailContent key={athleteId} athleteId={athleteId} fallbackBackTo={coachTeamId ? `/coach/teams/${coachTeamId}` : "/coach/teams"} />
}
