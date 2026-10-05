import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { CoachTeamDetailContent } from "@/components/coach/team-detail-content"
import { useCoachTeamScope } from "@/lib/coach-teams"
import {
  getCoachDashboardSnapshotForCurrentUser,
  peekCachedCoachDashboardSnapshot,
  type CoachDashboardSnapshot,
} from "@/lib/data/coach/dashboard-data"
import type { Team } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"
import { InvalidEntityPage } from "@/pages/invalid-entity"

export default function CoachTeamDetailPage() {
  const { teamId = "" } = useParams()
  // One screen per team in the address, so nothing from the previous team is ever shown.
  return <CoachTeamDetail key={teamId} teamId={teamId} />
}

function CoachTeamDetail({ teamId }: { teamId: string }) {
  const backendMode = getBackendMode()
  const { role, coachTeamsLoading, isAssigned, syncSelectedTeam } = useCoachTeamScope()
  const isCoach = role === "coach"
  const assigned = isCoach && isAssigned(teamId)
  // The team in the address is the scope: a coach on several teams can open any of them by link.
  const scopeTeamId = isCoach ? teamId : null
  const [backendSnapshot, setBackendSnapshot] = useState<CoachDashboardSnapshot | null>(() =>
    backendMode === "supabase" ? peekCachedCoachDashboardSnapshot(scopeTeamId) : null,
  )
  const [mockTeams, setMockTeams] = useState<Team[]>([])
  const [mockLoaded, setMockLoaded] = useState(false)
  const [backendError, setBackendError] = useState<string | null>(null)

  useEffect(() => {
    if (backendMode === "supabase") return
    let cancelled = false

    void import("@/lib/mock-data").then((module) => {
      if (!cancelled) {
        setMockTeams(module.mockTeams)
        setMockLoaded(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [backendMode])

  // Opening a team by link selects it, so the rest of the app follows.
  useEffect(() => {
    if (assigned) syncSelectedTeam(teamId)
  }, [assigned, syncSelectedTeam, teamId])

  useEffect(() => {
    if (backendMode !== "supabase") return
    // A coach's team list decides whether this team may be opened at all.
    if (isCoach && (coachTeamsLoading || !assigned)) return
    let cancelled = false

    const loadSnapshot = async () => {
      const result = await getCoachDashboardSnapshotForCurrentUser({ scopeTeamId })
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
  }, [assigned, backendMode, coachTeamsLoading, isCoach, scopeTeamId])

  const teamsSource = backendMode === "supabase" ? (backendSnapshot?.teams ?? []) : mockTeams
  const team = teamsSource.find((item) => item.id === teamId)
  const waitingForData = backendMode === "supabase" ? !backendSnapshot && !backendError && (!isCoach || assigned) : !mockLoaded

  if (coachTeamsLoading || waitingForData) {
    return (
      <div className="sk-page">
        <p className="text-sm text-sk-mute">Loading team...</p>
      </div>
    )
  }

  // In the real backend a coach cannot tell a team they are not on from one that does not exist.
  if (!team) {
    return (
      <InvalidEntityPage
        title="Team not found"
        description="This team does not exist in your SKTR Coach workspace."
        backTo="/coach/teams"
      />
    )
  }

  if (isCoach && !assigned) {
    return (
      <InvalidEntityPage
        title="Team unavailable"
        description="This team is not one you are assigned to coach."
        backTo="/coach/teams"
      />
    )
  }

  return (
    <>
      {backendError ? (
        <div className="mx-auto w-full max-w-[1320px] px-4 pt-2 sm:px-6 lg:px-10 lg:pt-8">
          <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
            Could not load the latest data: {backendError}
          </p>
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
