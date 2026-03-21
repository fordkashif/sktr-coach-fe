import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { CoachAthleteDetailContent, type AthleteDetailData } from "@/components/coach/athlete-detail-content"
import { COACH_TEAM_COOKIE, getCookieValue, ROLE_COOKIE } from "@/lib/auth-session"
import {
  getCoachAthleteSessionLogsForCurrentUser,
  getCoachDashboardSnapshotForCurrentUser,
  type CoachDashboardSnapshot,
} from "@/lib/data/coach/dashboard-data"
import { mockAthletes, type LogEntry } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"
import { InvalidEntityPage } from "@/pages/invalid-entity"

export default function CoachAthleteDetailPage() {
  const backendMode = getBackendMode()
  const { athleteId = "" } = useParams()
  const role = getCookieValue(ROLE_COOKIE)
  const coachTeamId = getCookieValue(COACH_TEAM_COOKIE)
  const [backendSnapshot, setBackendSnapshot] = useState<CoachDashboardSnapshot | null>(null)
  const [backendLogs, setBackendLogs] = useState<LogEntry[]>([])
  const [backendError, setBackendError] = useState<string | null>(null)

  useEffect(() => {
    if (backendMode !== "supabase") return
    let cancelled = false

    const loadDetail = async () => {
      const [snapshotResult, logsResult] = await Promise.all([
        getCoachDashboardSnapshotForCurrentUser({ scopeTeamId: role === "coach" ? coachTeamId : null }),
        getCoachAthleteSessionLogsForCurrentUser(athleteId, { scopeTeamId: role === "coach" ? coachTeamId : null }),
      ])
      if (cancelled) return
      if (!snapshotResult.ok) {
        setBackendError(snapshotResult.error.message)
        return
      }
      if (!logsResult.ok) {
        setBackendError(logsResult.error.message)
        return
      }
      setBackendError(null)
      setBackendSnapshot(snapshotResult.data)
      setBackendLogs(logsResult.data)
    }

    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [athleteId, backendMode, coachTeamId, role])

  const athletesSource = backendMode === "supabase" ? (backendSnapshot?.athletes ?? []) : mockAthletes
  const athlete = athletesSource.find((item) => item.id === athleteId)

  if (backendMode === "supabase" && !backendSnapshot && !backendError) {
    return <div className="p-6 text-sm text-slate-500">Loading athlete details...</div>
  }

  if (!athlete) {
    return (
      <InvalidEntityPage
        title="Athlete not found"
        description="The requested athlete does not exist in the current PaceLab workspace."
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

  const backendData: AthleteDetailData | undefined =
    backendMode === "supabase" && backendSnapshot
      ? {
          prs: backendSnapshot.prs.filter((item) => item.athleteId === athlete.id),
          logs: backendLogs.filter((item) => item.athleteId === athlete.id),
          testWeek: backendSnapshot.tests.find((item) => item.athleteId === athlete.id) ?? null,
          trend: backendSnapshot.trendSeries[athlete.id] ?? [],
        }
      : undefined

  return (
    <>
      {backendError ? (
        <div className="mx-auto mt-4 max-w-7xl rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Backend sync issue: {backendError}
        </div>
      ) : null}
      <CoachAthleteDetailContent athlete={athlete} data={backendData} />
    </>
  )
}
