import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { CoachAthleteDetailContent, type AthleteDetailData } from "@/components/coach/athlete-detail-content"
import { useCoachTeamScope } from "@/lib/coach-teams"
import {
  getCoachAthleteDetailForCurrentUser,
  getCoachDashboardSnapshotForCurrentUser,
  updateCoachSessionNoteForCurrentUser,
  type CoachAthleteDetail,
  type CoachDashboardSnapshot,
} from "@/lib/data/coach/dashboard-data"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import type { Athlete, Team } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"
import { InvalidEntityPage } from "@/pages/invalid-entity"

export default function CoachAthleteDetailPage() {
  const { athleteId = "" } = useParams()
  // One screen per athlete in the address, so nothing from the previous athlete is ever shown.
  return <CoachAthleteDetail key={athleteId} athleteId={athleteId} />
}

function CoachAthleteDetail({ athleteId }: { athleteId: string }) {
  const backendMode = getBackendMode()
  const { role, coachTeamId, coachTeams, coachTeamsLoading, isAssigned, syncSelectedTeam } = useCoachTeamScope()
  const isCoach = role === "coach"
  const hasSeveralTeams = isCoach && coachTeams.length > 1
  // The team this screen was opened with. The athlete in the address decides the scope from here on,
  // so picking another team in the switcher does not pull this screen back (the shell navigates away).
  const [openedWithTeamId] = useState(coachTeamId)
  // Real backend, coach on several teams: the athlete's own team, once the roster told us which it is.
  const [resolvedTeamId, setResolvedTeamId] = useState<string | null>(null)
  const [backendSnapshot, setBackendSnapshot] = useState<CoachDashboardSnapshot | null>(null)
  const [backendDetail, setBackendDetail] = useState<CoachAthleteDetail | null>(null)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [mockAthletes, setMockAthletes] = useState<Athlete[]>([])
  const [mockTeams, setMockTeams] = useState<Team[]>([])
  const [mockLoaded, setMockLoaded] = useState(false)
  const scopeTeamId = isCoach ? (resolvedTeamId ?? openedWithTeamId ?? coachTeamId) : null

  useEffect(() => {
    if (backendMode !== "supabase" || coachTeamsLoading) return
    let cancelled = false

    const loadDetail = async () => {
      // A link to an athlete on another of the coach's teams loads that team. The roster list is small
      // and cached, and this effect then runs again with the right team.
      if (hasSeveralTeams && !resolvedTeamId) {
        const rosterResult = await getCoachTeamsSnapshotForCurrentUser()
        if (cancelled) return
        const rosterTeamId = rosterResult.ok ? rosterResult.data.athletes.find((item) => item.id === athleteId)?.teamId : null
        if (rosterTeamId && rosterTeamId !== scopeTeamId) {
          setResolvedTeamId(rosterTeamId)
          return
        }
      }

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
  }, [athleteId, backendMode, coachTeamsLoading, hasSeveralTeams, resolvedTeamId, scopeTeamId])

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
        setMockLoaded(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [backendMode])

  const athletesSource = backendMode === "supabase" ? (backendSnapshot?.athletes ?? []) : mockAthletes
  const athlete = athletesSource.find((item) => item.id === athleteId)
  const athleteTeamId = athlete?.teamId ?? null
  const onOneOfMyTeams = isCoach && isAssigned(athleteTeamId)

  // Opening an athlete by link selects their team, so the rest of the app follows.
  useEffect(() => {
    if (onOneOfMyTeams) syncSelectedTeam(athleteTeamId)
  }, [athleteTeamId, onOneOfMyTeams, syncSelectedTeam])

  if (coachTeamsLoading || (backendMode === "supabase" ? !backendSnapshot && !backendError : !mockLoaded)) {
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

  if (isCoach && !onOneOfMyTeams) {
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
