import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { CoachTeamDetailContent } from "@/components/coach/team-detail-content"
import { COACH_TEAM_COOKIE, getCookieValue, ROLE_COOKIE } from "@/lib/auth-session"
import {
  getCoachDashboardSnapshotForCurrentUser,
  peekCachedCoachDashboardSnapshot,
  type CoachDashboardSnapshot,
} from "@/lib/data/coach/dashboard-data"
import type { Team } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"
import { InvalidEntityPage } from "@/pages/invalid-entity"

export default function CoachTeamDetailPage() {
  const backendMode = getBackendMode()
  const { teamId = "" } = useParams()
  const role = getCookieValue(ROLE_COOKIE)
  const coachTeamId = getCookieValue(COACH_TEAM_COOKIE)
  const [backendSnapshot, setBackendSnapshot] = useState<CoachDashboardSnapshot | null>(() =>
    backendMode === "supabase" ? peekCachedCoachDashboardSnapshot(role === "coach" ? coachTeamId : null) : null,
  )
  const [mockTeams, setMockTeams] = useState<Team[]>([])
  const [backendError, setBackendError] = useState<string | null>(null)

  useEffect(() => {
    if (backendMode === "supabase") return
    let cancelled = false

    void import("@/lib/mock-data").then((module) => {
      if (!cancelled) {
        setMockTeams(module.mockTeams)
      }
    })

    return () => {
      cancelled = true
    }
  }, [backendMode])

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
    return (
      <div className="sk-page">
        <p className="text-sm text-sk-mute">Loading team...</p>
      </div>
    )
  }

  if (!team) {
    return (
      <InvalidEntityPage
        title="Team not found"
        description="This team does not exist in your SKTR Coach workspace."
        backTo="/coach/teams"
      />
    )
  }

  if (role === "coach" && coachTeamId && coachTeamId !== team.id) {
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
