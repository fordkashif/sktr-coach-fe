import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { CoachAthleteDetailContent, type AthleteDetailData } from "@/components/coach/athlete-detail-content"
import { COACH_TEAM_COOKIE, getCookieValue, ROLE_COOKIE } from "@/lib/auth-session"
import {
  getCoachAthleteDetailForCurrentUser,
  getCoachDashboardSnapshotForCurrentUser,
  updateCoachSessionNoteForCurrentUser,
  type CoachAthleteDetail,
  type CoachDashboardSnapshot,
} from "@/lib/data/coach/dashboard-data"
import type { Athlete, Team } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"
import { InvalidEntityPage } from "@/pages/invalid-entity"

export default function CoachAthleteDetailPage() {
  const backendMode = getBackendMode()
  const { athleteId = "" } = useParams()
  const role = getCookieValue(ROLE_COOKIE)
  const coachTeamId = getCookieValue(COACH_TEAM_COOKIE)
  const [backendSnapshot, setBackendSnapshot] = useState<CoachDashboardSnapshot | null>(null)
  const [backendDetail, setBackendDetail] = useState<CoachAthleteDetail | null>(null)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [mockAthletes, setMockAthletes] = useState<Athlete[]>([])
  const [mockTeams, setMockTeams] = useState<Team[]>([])
  const scopeTeamId = role === "coach" ? coachTeamId : null

  useEffect(() => {
    if (backendMode !== "supabase") return
    let cancelled = false

    const loadDetail = async () => {
      const [snapshotResult, detailResult] = await Promise.all([
        getCoachDashboardSnapshotForCurrentUser({ scopeTeamId }),
        getCoachAthleteDetailForCurrentUser(athleteId, { scopeTeamId }),
      ])
      if (cancelled) return
      if (!snapshotResult.ok) {
        setBackendError(snapshotResult.error.message)
        return
      }
      setBackendSnapshot(snapshotResult.data)
      if (!detailResult.ok) {
        // The roster still tells us who this is, so show the athlete and say what failed.
        setBackendDetail(null)
        setBackendError(detailResult.error.message)
        return
      }
      setBackendError(null)
      setBackendDetail(detailResult.data)
    }

    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [athleteId, backendMode, scopeTeamId])

  const saveSessionNote = useCallback(
    async (sessionId: string, note: string) => {
      const result = await updateCoachSessionNoteForCurrentUser(athleteId, sessionId, note, { scopeTeamId })
      if (!result.ok) return result.error.message
      setBackendDetail((current) =>
        current
          ? {
              ...current,
              sessions: current.sessions.map((session) =>
                session.id === sessionId ? { ...session, coachNote: result.data.coachNote } : session,
              ),
            }
          : current,
      )
      return null
    },
    [athleteId, scopeTeamId],
  )

  useEffect(() => {
    if (backendMode === "supabase") return
    let cancelled = false

    void import("@/lib/mock-data").then((module) => {
      if (!cancelled) {
        setMockAthletes(module.mockAthletes)
        setMockTeams(module.mockTeams)
      }
    })

    return () => {
      cancelled = true
    }
  }, [backendMode])

  const athletesSource = backendMode === "supabase" ? (backendSnapshot?.athletes ?? []) : mockAthletes
  const athlete = athletesSource.find((item) => item.id === athleteId)

  if (backendMode === "supabase" && !backendSnapshot && !backendError) {
    return (
      <div className="sk-page">
        <p className="text-sm font-semibold text-sk-mute">Loading athlete details...</p>
      </div>
    )
  }

  if (!athlete && backendMode === "supabase" && backendError && !backendSnapshot) {
    return (
      <div className="sk-page">
        <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
          Could not load this athlete: {backendError}
        </p>
      </div>
    )
  }

  if (!athlete) {
    return (
      <InvalidEntityPage
        title="Athlete not found"
        description="The requested athlete does not exist in the current SKTR Coach workspace."
        backTo="/coach/teams"
      />
    )
  }

  if (role === "coach" && coachTeamId && athlete.teamId !== coachTeamId) {
    return (
      <InvalidEntityPage
        title="Athlete unavailable"
        description="This athlete is outside the currently assigned coach scope."
        backTo="/coach/teams"
      />
    )
  }

  const teamsSource = backendMode === "supabase" ? (backendSnapshot?.teams ?? []) : mockTeams
  const teamName = teamsSource.find((team) => team.id === athlete.teamId)?.name

  // Roster-level PRs, tests and trend come from the snapshot; the per-athlete detail replaces them when it loaded.
  const backendData: AthleteDetailData | undefined =
    backendMode === "supabase" && backendSnapshot
      ? {
          prs: backendDetail?.prs ?? backendSnapshot.prs.filter((item) => item.athleteId === athlete.id),
          logs: backendDetail?.sessions ?? [],
          testWeek: backendSnapshot.tests.find((item) => item.athleteId === athlete.id) ?? null,
          trend: backendSnapshot.trendSeries[athlete.id] ?? [],
          wellness: backendDetail?.wellness,
          tests: backendDetail?.tests,
          dateOfBirth: backendDetail?.dateOfBirth ?? null,
          hasReadiness: backendDetail
            ? backendDetail.wellness.length > 0 || backendDetail.readinessFlag !== null
            : (backendSnapshot.trendSeries[athlete.id] ?? []).length > 0,
        }
      : undefined

  return (
    <CoachAthleteDetailContent
      athlete={athlete}
      data={backendData}
      teamName={teamName}
      onSaveSessionNote={backendMode === "supabase" && backendDetail ? saveSessionNote : undefined}
      banner={
        backendError ? (
          <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
            Could not load the latest data: {backendError}
          </p>
        ) : null
      }
    />
  )
}
