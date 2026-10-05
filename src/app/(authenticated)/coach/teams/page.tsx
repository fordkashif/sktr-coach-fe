"use client"

import { UserPlus } from "@phosphor-icons/react"
import { Navigate } from "react-router-dom"
import { useCallback, useEffect, useState, type FormEvent } from "react"
import { AddAthletesDialog } from "@/components/coach/add-athletes-dialog"
import {
  ActionRow,
  Button,
  EmptyState,
  Field,
  FormGrid,
  Input,
  LinkButton,
  List,
  Notice,
  Screen,
  ScreenHeader,
  ScreenSkeleton,
  Section,
  Select,
  SkeletonRows,
  Stat,
  StatStrip,
  notify,
} from "@/components/sk"
import { useCoachTeams } from "@/lib/coach-teams"
import { EVENT_GROUPS } from "@/lib/data/coach/roster-data"
import { mergeMockAthletes, ROSTER_CHANGED_EVENT } from "@/lib/data/coach/roster-mock"
import { getCoachTeamsSnapshotForCurrentUser, invalidateCoachTeamsSnapshot } from "@/lib/data/coach/teams-data"
import { createClubAdminTeam, getClubAdminAssignableCoachOptions, type ClubAdminAssignableCoachOption } from "@/lib/data/club-admin/ops-data"
import { useRole } from "@/lib/role-context"
import { getBackendMode } from "@/lib/supabase/config"
import type { Athlete, EventGroup, Team } from "@/lib/mock-data"

function teamLine(team: Team, roster: Athlete[]) {
  const group = team.disciplines?.length ? team.disciplines.join(", ") : team.eventGroup
  const flagged = roster.filter((athlete) => athlete.readiness !== "green").length
  const count = `${roster.length} ${roster.length === 1 ? "athlete" : "athletes"}`
  return `${group}. ${count}${flagged > 0 ? `, ${flagged} to check on` : ""}`
}

export default function CoachTeamsPage() {
  const isSupabaseMode = getBackendMode() === "supabase"
  const { role } = useRole()
  const isCoachViewer = role === "coach"
  const isClubAdminViewer = role === "club-admin"
  // A coach works on one team at a time (see the team switcher in the shell), so this page sends
  // them straight to the selected team. Club admins get the list of every team below.
  const coachTeams = useCoachTeams()
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [athletes, setAthletes] = useState<Athlete[]>([])
  const [assignableCoaches, setAssignableCoaches] = useState<ClubAdminAssignableCoachOption[]>([])
  const [newTeamName, setNewTeamName] = useState("")
  const [newTeamEventGroup, setNewTeamEventGroup] = useState<EventGroup>("Sprint")
  const [newTeamLeadCoachUserId, setNewTeamLeadCoachUserId] = useState("none")
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addTo, setAddTo] = useState<Team | null>(null)

  const load = useCallback(async () => {
    if (isCoachViewer) return
    if (!isSupabaseMode) {
      const module = await import("@/lib/mock-data")
      setTeams(module.mockTeams)
      setAthletes(mergeMockAthletes(module.mockAthletes))
      return
    }
    const [result, coachOptionsResult] = await Promise.all([
      getCoachTeamsSnapshotForCurrentUser(),
      isClubAdminViewer ? getClubAdminAssignableCoachOptions() : Promise.resolve(null),
    ])
    if (!result.ok) {
      setError(result.error.message)
      setTeams((current) => current ?? [])
      return
    }
    setError(coachOptionsResult && !coachOptionsResult.ok ? coachOptionsResult.error.message : null)
    setTeams(result.data.teams)
    setAthletes(result.data.athletes)
    if (coachOptionsResult?.ok) setAssignableCoaches(coachOptionsResult.data)
  }, [isClubAdminViewer, isCoachViewer, isSupabaseMode])

  useEffect(() => {
    void load()
    const refresh = () => void load()
    window.addEventListener(ROSTER_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(ROSTER_CHANGED_EVENT, refresh)
  }, [load])

  const createTeam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const selectedLeadCoach = assignableCoaches.find((coach) => coach.userId === newTeamLeadCoachUserId)
    setCreatingTeam(true)
    const result = await createClubAdminTeam({
      name: newTeamName.trim(),
      eventGroup: newTeamEventGroup,
      leadCoachUserId: newTeamLeadCoachUserId === "none" ? null : newTeamLeadCoachUserId,
      leadCoachLabel: newTeamLeadCoachUserId === "none" ? null : (selectedLeadCoach?.label ?? null),
    })
    setCreatingTeam(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    notify(`${newTeamName.trim()} created`)
    setNewTeamName("")
    setNewTeamEventGroup("Sprint")
    setNewTeamLeadCoachUserId("none")
    setError(null)
    invalidateCoachTeamsSnapshot()
    void load()
  }

  if (isCoachViewer) {
    if (coachTeams.loading) return <ScreenSkeleton />
    if (coachTeams.selectedTeamId) return <Navigate to={`/coach/teams/${coachTeams.selectedTeamId}`} replace />

    return (
      <Screen>
        <ScreenHeader title="Teams" lede="You are not assigned to a team yet." />
        {coachTeams.error ? <Notice tone="error">Could not load your teams: {coachTeams.error}</Notice> : null}
        <EmptyState
          title="No team on your account"
          body="Your roster, plans, reports and invites appear once a club admin assigns you to a team. Ask them to add you, or reopen your coach invite if you did not finish setting up."
          action={
            <LinkButton to="/coach/dashboard" size="sm">
              Back to dashboard
            </LinkButton>
          }
        />
      </Screen>
    )
  }

  const visibleTeams = teams ?? []
  const teamIds = new Set(visibleTeams.map((team) => team.id))
  const onTeams = athletes.filter((athlete) => teamIds.has(athlete.teamId))
  const needLook = onTeams.filter((athlete) => athlete.readiness !== "green").length
  const lede =
    teams === null
      ? "Getting your teams..."
      : visibleTeams.length === 0
        ? "No teams yet."
        : `${visibleTeams.length} ${visibleTeams.length === 1 ? "team" : "teams"}, ${onTeams.length} ${onTeams.length === 1 ? "athlete" : "athletes"}.`

  return (
    <Screen>
      <ScreenHeader title="Teams" lede={lede} />

      {error ? <Notice tone="error">Something went wrong: {error}</Notice> : null}

      <StatStrip aria-label="Teams at a glance">
        <Stat label="Teams" value={visibleTeams.length} />
        <Stat label="Athletes" value={onTeams.length} />
        <Stat label="Need a look" value={needLook} hint={needLook > 0 ? "Watch or review" : "Nobody flagged"} />
      </StatStrip>

      <Section title="All teams" hint={visibleTeams.length > 0 ? "Open a team for its roster and invites." : undefined}>
        {teams === null ? (
          <SkeletonRows rows={4} label="Loading teams" />
        ) : visibleTeams.length === 0 ? (
          <EmptyState
            title="No teams yet"
            body={isClubAdminViewer ? "Create your first team below, then add athletes to it." : "Teams you are assigned to appear here with their roster."}
          />
        ) : (
          <List aria-label="Teams">
            {visibleTeams.map((team) => (
              <ActionRow
                key={team.id}
                data-team={team.id}
                to={`/coach/teams/${team.id}`}
                title={team.name}
                subtitle={teamLine(
                  team,
                  athletes.filter((athlete) => athlete.teamId === team.id),
                )}
                actions={
                  <Button size="sm" onClick={() => setAddTo(team)} aria-label={`Add athletes to ${team.name}`}>
                    <UserPlus className="size-4" weight="bold" aria-hidden />
                    <span className="max-sm:sr-only">Add athletes</span>
                  </Button>
                }
              />
            ))}
          </List>
        )}
      </Section>

      {isClubAdminViewer && isSupabaseMode ? (
        <Section title="Add a team">
          <form className="flex flex-col gap-4" onSubmit={(event) => void createTeam(event)}>
            <FormGrid columns={4}>
              <Field label="Team name" className="sm:col-span-2">
                <Input value={newTeamName} onChange={(event) => setNewTeamName(event.target.value)} placeholder="Sprint Group B" />
              </Field>
              <Field label="Event group">
                <Select value={newTeamEventGroup} onChange={(event) => setNewTeamEventGroup(event.target.value as EventGroup)}>
                  {EVENT_GROUPS.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Lead coach">
                <Select value={newTeamLeadCoachUserId} onChange={(event) => setNewTeamLeadCoachUserId(event.target.value)}>
                  <option value="none">Unassigned</option>
                  {assignableCoaches.map((coach) => (
                    <option key={coach.userId} value={coach.userId}>
                      {coach.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormGrid>
            <div>
              <Button type="submit" disabled={creatingTeam || !newTeamName.trim()}>
                {creatingTeam ? "Creating..." : "Create team"}
              </Button>
            </div>
          </form>
        </Section>
      ) : null}

      {addTo ? (
        <AddAthletesDialog
          open
          onOpenChange={(open) => {
            if (!open) setAddTo(null)
          }}
          teamId={addTo.id}
          teamName={addTo.name}
          onAthleteAdded={() => {
            invalidateCoachTeamsSnapshot()
            void load()
          }}
        />
      ) : null}
    </Screen>
  )
}
