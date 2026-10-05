"use client"

import { StaffCompetitionForm } from "@/components/coach/competitions/competition-form"
import { COMPETITIONS_PATH } from "@/components/coach/competitions/competition-parts"
import { Screen, ScreenHeader } from "@/components/sk"
import { useCoachTeamScope } from "@/lib/coach-teams"

export default function CoachNewCompetitionPage() {
  const { coachTeamId, coachTeams } = useCoachTeamScope()
  const teamName = coachTeams.find((team) => team.id === coachTeamId)?.name ?? null
  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: COMPETITIONS_PATH, label: "Competitions" }}
        title="Add competition"
        lede={teamName ? `A meet for ${teamName}. After saving you enter your athletes in their events.` : "A meet for one team or for the whole club. After saving you enter athletes in their events."}
      />
      <StaffCompetitionForm key={coachTeamId ?? "all"} teamId={coachTeamId} cancelTo={COMPETITIONS_PATH} />
    </Screen>
  )
}
