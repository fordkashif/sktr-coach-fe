import { useEffect } from "react"
import { useParams } from "react-router-dom"
import { AttendanceScreen } from "@/components/coach/attendance-screen"
import { LinkButton, Screen, ScreenHeader, ScreenSkeleton } from "@/components/sk"
import { useCoachTeamScope } from "@/lib/coach-teams"

export default function CoachTeamAttendancePage() {
  const { teamId = "" } = useParams()
  // One screen per team in the address, so nothing from the previous team is ever shown.
  return <CoachTeamAttendance key={teamId} teamId={teamId} />
}

function CoachTeamAttendance({ teamId }: { teamId: string }) {
  const { role, coachTeams, coachTeamsLoading, isAssigned, syncSelectedTeam } = useCoachTeamScope()
  const isCoach = role === "coach"
  const assigned = isCoach && isAssigned(teamId)

  // Opening a team by link selects it, so the rest of the app follows.
  useEffect(() => {
    if (assigned) syncSelectedTeam(teamId)
  }, [assigned, syncSelectedTeam, teamId])

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

  return <AttendanceScreen teamId={teamId} teamName={coachTeams.find((team) => team.id === teamId)?.name ?? null} />
}
