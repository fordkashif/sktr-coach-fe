import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { CoachTeamDetailContent } from "@/components/coach/team-detail-content"
import { COACH_TEAM_COOKIE, getCookieValue, ROLE_COOKIE } from "@/lib/auth-session"
import { getCoachDashboardSnapshotForCurrentUser, type CoachDashboardSnapshot } from "@/lib/data/coach/dashboard-data"
import { mockTeams } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"
import { InvalidEntityPage } from "@/pages/invalid-entity"

export default function CoachTeamDetailPage() {
  const backendMode = getBackendMode()
  const { teamId = "" } = useParams()
  const role = getCookieValue(ROLE_COOKIE)
  const coachTeamId = getCookieValue(COACH_TEAM_COOKIE)
  const [backendSnapshot, setBackendSnapshot] = useState<CoachDashboardSnapshot | null>(null)
  const [backendError, setBackendError] = useState<string | null>(null)

  useEffect(() => {
    if (backendMode !== "supabase") return
    let cancelled = false

    const loadSnapshot = async () => {
      const result = await getCoachDashboardSnapshotForCurrentUser({ scopeTeamId: role === "coach" ? coachTeamId : null })
      if (cancelled) return
      if (!result.ok) {
        setBackendError(result.error.message)
        return
      }
      setBackendError(null)
      setBackendSnapshot(result.data)
    }

    void loadSnapshot()
    return () => {
      cancelled = true
    }
  }, [backendMode, coachTeamId, role])

  const teamsSource = backendMode === "supabase" ? (backendSnapshot?.teams ?? []) : mockTeams
  const team = teamsSource.find((item) => item.id === teamId)

  if (backendMode === "supabase" && !backendSnapshot && !backendError) {
    return <div className="p-6 text-sm text-slate-500">Loading team details...</div>
  }

  if (!team) {
    return (
      <InvalidEntityPage
        title="Team not found"
        description="The requested team does not exist in the current PaceLab workspace."
        backTo="/coach/teams"
      />
    )
  }

  if (role === "coach" && coachTeamId && coachTeamId !== team.id) {
    return (
      <InvalidEntityPage
        title="Team unavailable"
        description="This team is outside the currently assigned coach scope."
        backTo="/coach/teams"
      />
    )
  }

  return (
    <>
      {backendError ? (
        <div className="mx-auto mt-4 max-w-7xl rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Backend sync issue: {backendError}
        </div>
      ) : null}
      <CoachTeamDetailContent
        teamId={team.id}
        data={
          backendMode === "supabase" && backendSnapshot
            ? {
                teams: backendSnapshot.teams,
                athletes: backendSnapshot.athletes,
                prs: backendSnapshot.prs,
              }
            : undefined
        }
      />
    </>
  )
}
