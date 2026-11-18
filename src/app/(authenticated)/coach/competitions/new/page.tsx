"use client"

import { useNavigate } from "react-router-dom"
import CoachCompetitionsPage from "@/app/(authenticated)/coach/competitions/page"
import { StaffCompetitionForm } from "@/components/coach/competitions/competition-form"
import { COMPETITIONS_PATH } from "@/components/coach/competitions/competition-parts"
import { Sheet } from "@/components/sk"
import { useCoachTeamScope } from "@/lib/coach-teams"

/** Adding a meet: a sheet over the competitions list. Closing it goes back to the list. */
export default function CoachNewCompetitionPage() {
  const navigate = useNavigate()
  const { coachTeamId, coachTeams } = useCoachTeamScope()
  const teamName = coachTeams.find((team) => team.id === coachTeamId)?.name ?? null
  return (
    <>
      <CoachCompetitionsPage />
      <Sheet
        open
        onOpenChange={(open) => (open ? undefined : navigate(COMPETITIONS_PATH))}
        title="Add competition"
        description={teamName ? `A meet for ${teamName}.` : undefined}
        className="sm:max-w-lg"
      >
        <StaffCompetitionForm key={coachTeamId ?? "all"} teamId={coachTeamId} cancelTo={COMPETITIONS_PATH} />
      </Sheet>
    </>
  )
}
