"use client"

import { ArrowRight, Plus, UserPlus, UsersThree } from "@phosphor-icons/react"
import { Link, Navigate } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import { InviteAthleteDialog } from "@/components/coach/team-detail-content"
import { EmptyState, Initials, PageHeader, Panel, ReadinessTag, Stat } from "@/components/sk"
import { COACH_TEAM_COOKIE, getCookieValue } from "@/lib/auth-session"
import { getCoachScope } from "@/lib/coach-scope"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import {
  createClubAdminTeam,
  getClubAdminAssignableCoachOptions,
  type ClubAdminAssignableCoachOption,
} from "@/lib/data/club-admin/ops-data"
import { useRole } from "@/lib/role-context"
import { getBackendMode } from "@/lib/supabase/config"
import type { Athlete, EventGroup, Team } from "@/lib/mock-data"

const MOCK_COACH_TEAM_STORAGE_KEY = "pacelab:mock-coach-team"
const teamEventGroupOptions: EventGroup[] = ["Sprint", "Mid", "Distance", "Jumps", "Throws"]

function getTeamDisciplineLabel(team: Pick<Team, "disciplines" | "eventGroup"> | null | undefined) {
  if (!team) return ""
  if (team.disciplines?.length) return team.disciplines.join(", ")
  return team.eventGroup
}

export default function CoachTeamsPage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const { role } = useRole()
  const isCoachViewer = role === "coach"
  const isClubAdminViewer = role === "club-admin"
  const coachScope = useMemo(() => getCoachScope(role === "coach" ? role : "club-admin"), [role])
  const [backendTeams, setBackendTeams] = useState<Team[]>([])
  const [backendAthletes, setBackendAthletes] = useState<Athlete[]>([])
  const [assignableCoaches, setAssignableCoaches] = useState<ClubAdminAssignableCoachOption[]>([])
  const [newTeamName, setNewTeamName] = useState("")
  const [newTeamEventGroup, setNewTeamEventGroup] = useState<EventGroup>("Sprint")
  const [newTeamLeadCoachUserId, setNewTeamLeadCoachUserId] = useState("none")
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [backendLoading, setBackendLoading] = useState(isSupabaseMode)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [coachTeamId, setCoachTeamId] = useState(() => {
    if (typeof window === "undefined") return getCookieValue(COACH_TEAM_COOKIE) ?? ""
    if (isSupabaseMode) return getCookieValue(COACH_TEAM_COOKIE) ?? ""
    return window.localStorage.getItem(MOCK_COACH_TEAM_STORAGE_KEY) ?? coachScope.teamId ?? ""
  })

  useEffect(() => {
    if (isSupabaseMode) return
    let cancelled = false

    void import("@/lib/mock-data").then((module) => {
      if (cancelled) return
      setBackendTeams(module.mockTeams)
      setBackendAthletes(module.mockAthletes)
      setCoachTeamId((current) => current || module.mockTeams[0]?.id || "")
    })

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false

    const loadSnapshot = async () => {
      setBackendLoading(true)
      const [result, coachOptionsResult] = await Promise.all([
        getCoachTeamsSnapshotForCurrentUser(),
        isClubAdminViewer ? getClubAdminAssignableCoachOptions() : Promise.resolve(null),
      ])
      if (cancelled) return
      if (!result.ok) {
        setBackendError(result.error.message)
        setBackendLoading(false)
        return
      }
      if (coachOptionsResult && !coachOptionsResult.ok) {
        setBackendError(coachOptionsResult.error.message)
        setBackendLoading(false)
        return
      }
      setBackendError(null)
      setBackendTeams(result.data.teams)
      setBackendAthletes(result.data.athletes)
      if (coachOptionsResult?.ok) setAssignableCoaches(coachOptionsResult.data)
      setBackendLoading(false)
      if (!coachTeamId && result.data.teams[0]?.id && isCoachViewer) setCoachTeamId(result.data.teams[0].id)
    }

    void loadSnapshot()
    return () => {
      cancelled = true
    }
  }, [coachTeamId, isClubAdminViewer, isCoachViewer, isSupabaseMode])

  const teamsSource = backendTeams
  const athletesSource = backendAthletes

  const visibleTeams = useMemo(() => {
    if (!isCoachViewer) return teamsSource
    if (isSupabaseMode) {
      return coachTeamId ? teamsSource.filter((team) => team.id === coachTeamId) : teamsSource
    }
    if (coachScope.isScopedCoach) {
      return teamsSource.filter((team) => team.id === coachTeamId)
    }
    return teamsSource
  }, [coachScope.isScopedCoach, coachTeamId, isCoachViewer, isSupabaseMode, teamsSource])

  const visibleTeamIds = new Set(visibleTeams.map((team) => team.id))
  const totalAthletes = athletesSource.filter((athlete) => visibleTeamIds.has(athlete.teamId)).length
  const readinessAlerts = visibleTeams.reduce(
    (sum, team) => sum + athletesSource.filter((athlete) => athlete.teamId === team.id && athlete.readiness !== "green").length,
    0,
  )
  const selectedLeadCoach = assignableCoaches.find((coach) => coach.userId === newTeamLeadCoachUserId)

  const createTeam = async () => {
    setCreatingTeam(true)
    const result = await createClubAdminTeam({
      name: newTeamName.trim(),
      eventGroup: newTeamEventGroup,
      leadCoachUserId: newTeamLeadCoachUserId === "none" ? null : newTeamLeadCoachUserId,
      leadCoachLabel: newTeamLeadCoachUserId === "none" ? null : selectedLeadCoach?.label ?? null,
    })
    setCreatingTeam(false)

    if (!result.ok) {
      setBackendError(result.error.message)
      return
    }

    const refreshResult = await getCoachTeamsSnapshotForCurrentUser()
    if (!refreshResult.ok) {
      setBackendError(refreshResult.error.message)
      return
    }

    setBackendTeams(refreshResult.data.teams)
    setBackendAthletes(refreshResult.data.athletes)
    setNewTeamName("")
    setNewTeamEventGroup("Sprint")
    setNewTeamLeadCoachUserId("none")
    setBackendError(null)
  }

  if (isCoachViewer && !backendLoading) {
    if (visibleTeams[0]?.id) {
      return <Navigate to={`/coach/teams/${visibleTeams[0].id}`} replace />
    }

    return (
      <div className="sk-page">
        <PageHeader title="Teams" lede="You are not assigned to a team yet." />
        {backendError ? (
          <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
            Could not load your teams: {backendError}
          </p>
        ) : null}
        <EmptyState
          icon={<UsersThree className="size-6" weight="fill" />}
          title="No team on your account"
          body="Your roster, plans, reports and invites appear once a club admin assigns you to a team. Ask them to add you, or reopen your coach invite if you did not finish setting up."
          action={
            <Link to="/coach/dashboard" className="sk-btn sk-btn-quiet sk-btn-sm">
              Back to dashboard
            </Link>
          }
        />
      </div>
    )
  }

  const lede =
    isSupabaseMode && backendLoading
      ? "Loading teams..."
      : visibleTeams.length === 0
        ? "No teams yet."
        : `${visibleTeams.length} ${visibleTeams.length === 1 ? "team" : "teams"}, ${totalAthletes} ${totalAthletes === 1 ? "athlete" : "athletes"}.`

  return (
    <div className="sk-page">
      <PageHeader title="Teams" lede={lede} />

      {backendError ? (
        <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
          Something went wrong: {backendError}
        </p>
      ) : null}

      <section aria-label="Teams at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat tone="blue" label="Teams" value={visibleTeams.length} />
        <Stat label="Athletes" value={totalAthletes} hint="Across these teams" />
        <Stat
          tone={readinessAlerts > 0 ? "coral" : "plain"}
          label="Need a look"
          value={readinessAlerts}
          hint={readinessAlerts > 0 ? "Watch or review" : "Nobody flagged"}
          className="max-lg:col-span-2"
        />
      </section>

      {isClubAdminViewer && isSupabaseMode ? (
        <Panel title="Add a team">
          <form
            className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_200px_minmax(0,1fr)_auto] lg:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              void createTeam()
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor="new-team-name" className="sk-label">Team name</label>
              <input
                id="new-team-name"
                className="sk-field"
                value={newTeamName}
                onChange={(event) => setNewTeamName(event.target.value)}
                placeholder="Sprint Group B"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="new-team-group" className="sk-label">Event group</label>
              <select
                id="new-team-group"
                className="sk-field"
                value={newTeamEventGroup}
                onChange={(event) => setNewTeamEventGroup(event.target.value as EventGroup)}
              >
                {teamEventGroupOptions.map((group) => (
                  <option key={group} value={group}>{group}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="new-team-coach" className="sk-label">Lead coach</label>
              <select
                id="new-team-coach"
                className="sk-field"
                value={newTeamLeadCoachUserId}
                onChange={(event) => setNewTeamLeadCoachUserId(event.target.value)}
              >
                <option value="none">Unassigned</option>
                {assignableCoaches.map((coach) => (
                  <option key={coach.userId} value={coach.userId}>{coach.label}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="sk-btn sk-btn-primary" disabled={creatingTeam || !newTeamName.trim()}>
              <Plus className="size-5" weight="bold" />
              {creatingTeam ? "Creating..." : "Create team"}
            </button>
          </form>
        </Panel>
      ) : null}

      {!isSupabaseMode && isCoachViewer && coachScope.allowTeamSwitcher ? (
        <div className="flex flex-col gap-3 rounded-[20px] bg-sk-yellow-tint p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <label htmlFor="mock-team-switch" className="text-sm text-sk-ink-2">
            <span className="block font-bold text-sk-ink">Demo mode team</span>
            Switch which group this demo coach is assigned to.
          </label>
          <select
            id="mock-team-switch"
            className="sk-field sm:max-w-xs"
            value={coachTeamId}
            onChange={(event) => {
              const value = event.target.value
              setCoachTeamId(value)
              window.localStorage.setItem(MOCK_COACH_TEAM_STORAGE_KEY, value)
              document.cookie = `${COACH_TEAM_COOKIE}=${value}; Path=/; Max-Age=${60 * 60 * 8}; SameSite=Lax`
            }}
          >
            {teamsSource.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      {visibleTeams.length === 0 && !(isSupabaseMode && backendLoading) ? (
        <EmptyState
          icon={<UsersThree className="size-6" weight="fill" />}
          title="No teams yet"
          body={
            isClubAdminViewer
              ? "Create your first team above, then invite athletes to it."
              : "Teams you are assigned to appear here with their roster."
          }
        />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        {visibleTeams.map((team) => {
          const roster = athletesSource.filter((athlete) => athlete.teamId === team.id)
          const flagged = roster.filter((athlete) => athlete.readiness !== "green").length
          const preview = roster.slice(0, 4)

          return (
            <Panel
              key={team.id}
              title={team.name}
              hint={`${getTeamDisciplineLabel(team)}. ${roster.length} ${roster.length === 1 ? "athlete" : "athletes"}${
                flagged > 0 ? `, ${flagged} to check on` : ""
              }.`}
              className="flex flex-col"
            >
              {roster.length > 0 ? (
                <ul>
                  {preview.map((athlete) => (
                    <li key={athlete.id}>
                      <Link to={`/coach/athletes/${athlete.id}`} className="sk-row group">
                        <span className="flex min-w-0 items-center gap-3">
                          <Initials name={athlete.name} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate font-bold text-sk-ink group-hover:text-sk-blue">{athlete.name}</span>
                            <span className="block truncate text-sm text-sk-mute">{athlete.primaryEvent}</span>
                          </span>
                        </span>
                        <ReadinessTag status={athlete.readiness} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="sk-well text-sm text-sk-mute">Nobody on this roster yet. Invite an athlete to get it started.</div>
              )}
              {roster.length > preview.length ? (
                <p className="pt-3 text-sm text-sk-mute">And {roster.length - preview.length} more.</p>
              ) : null}
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <Link to={`/coach/teams/${team.id}`} className="sk-btn sk-btn-ink sk-btn-sm max-sm:h-11">
                  Open team
                  <ArrowRight className="size-4" weight="bold" />
                </Link>
                <InviteAthleteDialog
                  teamId={team.id}
                  teamName={team.name}
                  trigger={
                    <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm max-sm:h-11">
                      <UserPlus className="size-4" weight="bold" />
                      Invite athlete
                    </button>
                  }
                />
              </div>
            </Panel>
          )
        })}
      </div>
    </div>
  )
}
