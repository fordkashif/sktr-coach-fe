import { useEffect } from "react"
import { useParams } from "react-router-dom"
import { CoachTeamDetailContent } from "@/components/coach/team-detail-content"
import { LinkButton, Screen, ScreenHeader, ScreenSkeleton } from "@/components/sk"
import { useCoachTeamScope } from "@/lib/coach-teams"

export default function CoachTeamDetailPage() {
  const { teamId = "" } = useParams()
  // One screen per team in the address, so nothing from the previous team is ever shown.
  return <CoachTeamDetail key={teamId} teamId={teamId} />
}

function CoachTeamDetail({ teamId }: { teamId: string }) {
  const { role, coachTeams, coachTeamsLoading, isAssigned, syncSelectedTeam } = useCoachTeamScope()
  const isCoach = role === "coach"
  const assigned = isCoach && isAssigned(teamId)

  // Opening a team by link selects it, so the rest of the app follows.
  useEffect(() => {
    if (assigned) syncSelectedTeam(teamId)
  }, [assigned, syncSelectedTeam, teamId])

  // A coach's team list decides whether this team may be opened at all.
  if (coachTeamsLoading) return <ScreenSkeleton />

  // In the real backend a coach cannot tell a team they are not on from one that does not exist.
  if (isCoach && !assigned) {
    return (
      <Screen>
        <ScreenHeader title="Team unavailable" lede="Team not found on your account: it is not one you are assigned to coach, or it does not exist." />
        <div>
          <LinkButton to="/coach/teams">Back to your team</LinkButton>
        </div>
      </Screen>
    )
  }

  return <CoachTeamDetailContent teamId={teamId} teamName={coachTeams.find((team) => team.id === teamId)?.name ?? null} />
}
