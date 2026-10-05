import { useEffect, useMemo, useState } from "react"
import { Check } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import {
  Button,
  DataTable,
  EmptyState,
  LinkButton,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  SkeletonRows,
  Stat,
  StatStrip,
  StatusDot,
  StatusText,
  TableSub,
  type DataTableColumn,
  type StateTone,
} from "@/components/sk"
import { useClubAdmin } from "@/lib/club-admin-context"
import { setClubAdminSetupGuideDismissed } from "@/lib/data/club-admin/ops-data"
import { getClubAthletes, type ClubAthlete } from "@/lib/data/club-admin/people-data"
import { getClubAdminTeamHealthSnapshot, type ClubAdminTeamHealthRow, type ClubAdminTeamHealthSnapshot } from "@/lib/data/club-admin/team-health-data"
import { ROSTER_CHANGED_EVENT } from "@/lib/data/coach/roster-mock"
import { messagesHomeHref } from "@/lib/data/messages/links"
import { useMessageUnread } from "@/lib/data/messages/unread-store"
import { adherenceText, averageAdherence, NO_SESSIONS_DUE } from "@/lib/data/session/adherence"
import type { Athlete } from "@/lib/mock-data"
import type { AccountRequest, ClubTeam, ClubUser, CoachInvite } from "@/lib/mock-club-admin"
import { getBackendMode } from "@/lib/supabase/config"
import { loadClubAccountRequests, loadClubInvites, loadClubTeams, loadClubUsers, loadProfileSafe } from "../state"

/** One row of the team table. `adherenceWeight` lets the club figure weight teams fairly. */
type TeamRow = ClubAdminTeamHealthRow & { adherenceWeight: number }

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** The demo club's team rows: the demo roster as it is now (moves and removals applied), with the canned readiness. */
function buildMockTeamRows(teams: ClubTeam[], users: ClubUser[], canned: Athlete[], club: ClubAthlete[]): TeamRow[] {
  const cannedById = new Map(canned.map((athlete) => [athlete.id, athlete]))
  return teams
    .filter((team) => team.status !== "archived")
    .map((team) => {
      const roster = club.filter((athlete) => athlete.status !== "left" && athlete.teamId === team.id)
      const readiness = roster.map((athlete) => cannedById.get(athlete.id)?.readiness ?? null)
      const lead = team.coachUserId ? users.find((user) => user.id === team.coachUserId) : undefined
      return {
        id: team.id,
        name: team.name,
        eventGroup: team.eventGroup,
        status: team.status,
        leadCoachName: lead?.name ?? team.coachEmail ?? null,
        hasLeadCoach: Boolean(team.coachUserId || team.coachEmail),
        coachCount: (team.coachUserId ? 1 : 0) + (team.coachUserIds?.length ?? 0),
        athleteCount: roster.length,
        ready: readiness.filter((value) => value === "green").length,
        watch: readiness.filter((value) => value === "yellow").length,
        review: readiness.filter((value) => value === "red").length,
        noCheckIn: readiness.filter((value) => value === null).length,
        adherence: averageAdherence(roster.map((athlete) => cannedById.get(athlete.id)?.adherence ?? null)),
        scheduledSessions: 0,
        adherenceWeight: roster.filter((athlete) => (cannedById.get(athlete.id)?.adherence ?? null) !== null).length,
      }
    })
}

/** Readiness of a team in one line: the worst state leads, as a dot and words. */
function TeamReadiness({ team }: { team: TeamRow }) {
  if (team.athleteCount === 0) return <span className="text-sk-mute">No athletes yet</span>
  if (team.ready + team.watch + team.review === 0) return <span className="text-sk-mute">No check-ins yet</span>
  const tone: StateTone = team.review > 0 ? "coral" : team.watch > 0 ? "amber" : "green"
  const parts = [team.review > 0 ? `${team.review} review` : null, team.watch > 0 ? `${team.watch} watch` : null, team.ready > 0 ? `${team.ready} ready` : null].filter(Boolean)
  return <StatusText tone={tone}>{parts.join(", ")}</StatusText>
}

export default function ClubAdminDashboardPage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const clubAdmin = useClubAdmin()
  const unread = useMessageUnread()

  const [users, setUsers] = useState<ClubUser[]>(() => (isSupabaseMode ? [] : loadClubUsers()))
  const [mockTeams] = useState<ClubTeam[]>(() => (isSupabaseMode ? [] : loadClubTeams()))
  const [invites, setInvites] = useState<CoachInvite[]>(() => (isSupabaseMode ? [] : loadClubInvites()))
  const [accountRequests, setAccountRequests] = useState<AccountRequest[]>(() => (isSupabaseMode ? [] : loadClubAccountRequests()))
  const [mock, setMock] = useState<{ canned: Athlete[]; club: ClubAthlete[] } | null>(null)
  const [health, setHealth] = useState<ClubAdminTeamHealthSnapshot | null>(null)
  const [healthLoading, setHealthLoading] = useState(isSupabaseMode)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [setupGuideDismissedAt, setSetupGuideDismissedAt] = useState<string | null>(clubAdmin.profile?.setupGuideDismissedAt ?? null)
  const [setupGuideSaving, setSetupGuideSaving] = useState(false)

  useEffect(() => {
    if (!isSupabaseMode) return

    if (clubAdmin.opsSnapshot) {
      setUsers(clubAdmin.opsSnapshot.users.map((row) => ({ id: row.id, name: row.name, email: row.email, role: row.role, status: row.status, teamId: row.teamId })))
      setInvites(
        clubAdmin.opsSnapshot.invites.map((row) => ({
          id: row.id,
          email: row.email,
          role: row.role,
          teamId: row.teamId,
          status: row.status === "revoked" ? "expired" : row.status,
          createdAt: row.createdAt,
        })),
      )
      setAccountRequests(
        clubAdmin.opsSnapshot.accountRequests.map((row) => ({
          id: row.id,
          fullName: row.fullName,
          email: row.email,
          organization: row.organization,
          role: row.role,
          notes: row.notes,
          status: row.status,
          createdAt: row.createdAt,
          reviewedAt: row.reviewedAt,
        })),
      )
    }

    if (clubAdmin.profile) setSetupGuideDismissedAt(clubAdmin.profile.setupGuideDismissedAt ?? null)
  }, [clubAdmin.opsSnapshot, clubAdmin.profile, isSupabaseMode])

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false

    const loadHealth = async () => {
      const result = await getClubAdminTeamHealthSnapshot()
      if (cancelled) return
      setHealthLoading(false)
      if (!result.ok) {
        setHealthError(result.error.message)
        return
      }
      setHealthError(null)
      setHealth(result.data)
    }

    void loadHealth()
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  useEffect(() => {
    if (isSupabaseMode) return
    let cancelled = false

    const load = async () => {
      const [module, club] = await Promise.all([import("@/lib/mock-data"), getClubAthletes()])
      if (!cancelled) setMock({ canned: module.mockAthletes, club: club.ok ? club.data : [] })
    }
    void load()
    const refresh = () => void load()
    window.addEventListener(ROSTER_CHANGED_EVENT, refresh)
    return () => {
      cancelled = true
      window.removeEventListener(ROSTER_CHANGED_EVENT, refresh)
    }
  }, [isSupabaseMode])

  const teamRows = useMemo<TeamRow[]>(() => {
    if (isSupabaseMode) return (health?.teams ?? []).map((team) => ({ ...team, adherenceWeight: team.scheduledSessions }))
    return buildMockTeamRows(mockTeams, users, mock?.canned ?? [], mock?.club ?? [])
  }, [health, isSupabaseMode, mock, mockTeams, users])

  const kpi = useMemo(() => {
    const mockCurrent = (mock?.club ?? []).filter((athlete) => athlete.status !== "left")
    const athletes = isSupabaseMode ? (health?.athleteCount ?? 0) : mockCurrent.length
    const ready = teamRows.reduce((sum, team) => sum + team.ready, 0)
    const watch = teamRows.reduce((sum, team) => sum + team.watch, 0)
    const review = teamRows.reduce((sum, team) => sum + team.review, 0)
    const weighted = teamRows.filter((team) => team.adherence !== null && team.adherenceWeight > 0)
    const weight = weighted.reduce((sum, team) => sum + team.adherenceWeight, 0)
    const liveTeamIds = new Set(teamRows.map((team) => team.id))
    return {
      athletes,
      coaches: users.filter((user) => user.role === "coach" && user.status === "active").length,
      teams: teamRows.filter((team) => team.status === "active").length,
      pendingInvites: invites.filter((invite) => invite.status === "pending").length,
      pendingRequests: accountRequests.filter((request) => request.status === "pending").length,
      teamsWithoutLead: teamRows.filter((team) => !team.hasLeadCoach).length,
      teamsWithoutAthletes: teamRows.filter((team) => team.athleteCount === 0).length,
      unassignedAthletes: isSupabaseMode ? (health?.unassignedAthleteCount ?? 0) : mockCurrent.filter((athlete) => !athlete.teamId || !liveTeamIds.has(athlete.teamId)).length,
      ready,
      checkedIn: ready + watch + review,
      adherence: weight > 0 ? Math.round(weighted.reduce((sum, team) => sum + (team.adherence ?? 0) * team.adherenceWeight, 0) / weight) : null,
    }
  }, [accountRequests, health, invites, isSupabaseMode, mock, teamRows, users])

  const needsYou: Array<{ key: string; count: number; title: string; body: string; to: string; tone: StateTone }> = [
    {
      key: "reports",
      count: unread.openReports,
      title: unread.openReports === 1 ? "Reported message to look at" : "Reported messages to look at",
      body: "Someone reported a message between a coach and an athlete.",
      to: messagesHomeHref("club-admin", "oversight"),
      tone: "coral" as const,
    },
    {
      key: "requests",
      count: kpi.pendingRequests,
      title: kpi.pendingRequests === 1 ? "Account request to review" : "Account requests to review",
      body: "People who asked to join your club and are waiting on you.",
      to: "/club-admin/users?view=requests",
      tone: "blue" as const,
    },
    {
      key: "unassigned",
      count: kpi.unassignedAthletes,
      title: kpi.unassignedAthletes === 1 ? "Athlete not on a team" : "Athletes not on a team",
      body: "No coach sees them and they get no plan until you put them on a team.",
      to: "/club-admin/users?view=athletes",
      tone: "amber" as const,
    },
    {
      key: "no-lead",
      count: kpi.teamsWithoutLead,
      title: kpi.teamsWithoutLead === 1 ? "Team without a lead coach" : "Teams without a lead coach",
      body: "Nobody owns the plan for these athletes yet.",
      to: "/club-admin/teams",
      tone: "amber" as const,
    },
    {
      key: "no-athletes",
      count: kpi.teamsWithoutAthletes,
      title: kpi.teamsWithoutAthletes === 1 ? "Team with no athletes" : "Teams with no athletes",
      body: "Add athletes from the team, or ask its coach to.",
      to: "/club-admin/teams",
      tone: "neutral" as const,
    },
    {
      key: "invites",
      count: kpi.pendingInvites,
      title: kpi.pendingInvites === 1 ? "Staff invite not accepted yet" : "Staff invites not accepted yet",
      body: "A nudge or a fresh link usually does it.",
      to: "/club-admin/users?view=invites",
      tone: "neutral" as const,
    },
  ].filter((item) => item.count > 0)

  const setupSteps = [
    { title: "Create your first team", body: "A squad or training group that coaches and athletes join.", to: "/club-admin/teams", done: teamRows.length > 0 },
    { title: "Invite your coaches", body: "Send each coach an invite and put them on a team.", to: "/club-admin/users?invite=1", done: kpi.coaches > 0 || kpi.pendingInvites > 0 },
    { title: "Get athletes on a roster", body: "Add athletes to a team, or let its coach do it. They show up here as they join.", to: "/club-admin/teams", done: kpi.athletes > 0 },
  ]

  const dataLoading = isSupabaseMode ? (clubAdmin.opsLoading && !clubAdmin.opsSnapshot) || (healthLoading && !health) : mock === null
  const backendError = actionError ?? clubAdmin.opsError ?? healthError ?? clubAdmin.profileError
  const setupIncomplete = !dataLoading && !backendError && setupSteps.some((step) => !step.done)
  const stepsDone = setupSteps.filter((step) => step.done).length

  const handleSetupGuideStateChange = async (dismissed: boolean) => {
    if (!isSupabaseMode) {
      setSetupGuideDismissedAt(dismissed ? new Date().toISOString() : null)
      return
    }

    setSetupGuideSaving(true)
    const result = await setClubAdminSetupGuideDismissed(dismissed)
    setSetupGuideSaving(false)

    if (!result.ok) {
      setActionError(result.error.message)
      return
    }

    setActionError(null)
    const nextDismissedAt = dismissed ? new Date().toISOString() : null
    setSetupGuideDismissedAt(nextDismissedAt)
    if (clubAdmin.profile) clubAdmin.updateCachedProfile({ ...clubAdmin.profile, setupGuideDismissedAt: nextDismissedAt })
  }

  const clubName = (isSupabaseMode ? clubAdmin.profile?.clubName : loadProfileSafe().clubName)?.trim() || "Your club"

  const lede = dataLoading
    ? "Getting your club..."
    : kpi.teams === 0 && kpi.athletes === 0 && kpi.coaches === 0
      ? "Your club is ready to fill. Start with a team, then bring in your coaches."
      : `${plural(kpi.coaches, "coach", "coaches")} and ${plural(kpi.athletes, "athlete")} across ${plural(kpi.teams, "team")}. ${
          needsYou.length === 0 ? "Nothing is waiting on you." : `${plural(needsYou.length, "thing")} ${needsYou.length === 1 ? "needs" : "need"} you.`
        }`

  const teamColumns: Array<DataTableColumn<TeamRow>> = [
    {
      key: "team",
      header: "Team",
      cell: (team) => (
        <Link to={`/club-admin/teams?team=${encodeURIComponent(team.id)}`} className="hover:text-sk-blue-link">
          {team.name}
          <TableSub>{[team.eventGroup ?? "No event group", team.status === "draft" ? "draft" : null].filter(Boolean).join(", ")}</TableSub>
        </Link>
      ),
    },
    {
      key: "lead",
      header: "Lead coach",
      cell: (team) => (team.hasLeadCoach ? (team.leadCoachName ?? "Assigned") : <StatusText tone="coral">No lead coach</StatusText>),
    },
    { key: "athletes", header: "Athletes", align: "right", cell: (team) => team.athleteCount },
    { key: "readiness", header: "Readiness", phone: "plain", cell: (team) => <TeamReadiness team={team} /> },
    {
      key: "adherence",
      header: "Adherence",
      align: "right",
      strong: true,
      phone: "trailing",
      cell: (team) => (team.athleteCount === 0 ? <span className="font-normal text-sk-mute">No athletes</span> : adherenceText(team.adherence)),
    },
  ]

  return (
    <Screen>
      <ScreenHeader
        title={clubName}
        lede={lede}
        actions={
          <>
            <LinkButton to="/club-admin/teams">Manage teams</LinkButton>
            <LinkButton to="/club-admin/users?invite=1" variant="primary">
              Invite a coach
            </LinkButton>
          </>
        }
      />

      {backendError ? <Notice tone="error">Could not load the latest data: {backendError}</Notice> : null}

      {dataLoading ? null : needsYou.length > 0 ? (
        <Section title="Needs you" hint="Requests, athletes and teams that are waiting on a club admin." meta={`${needsYou.length} open`}>
          <List>
            {needsYou.map((item) => (
              <ListRow
                key={item.key}
                to={item.to}
                leading={<StatusDot tone={item.tone} />}
                title={`${item.count} ${item.title.charAt(0).toLowerCase()}${item.title.slice(1)}`}
                subtitle={item.body}
              />
            ))}
          </List>
        </Section>
      ) : null}

      {setupIncomplete && !setupGuideDismissedAt ? (
        <Section
          title="Get your club running in three steps"
          hint={stepsDone === 0 ? "Do these in order and this dashboard fills itself in." : `${stepsDone} of ${setupSteps.length} done. Keep going and this dashboard fills itself in.`}
          action={
            <Button variant="quiet" size="sm" disabled={setupGuideSaving} onClick={() => void handleSetupGuideStateChange(true)}>
              {setupGuideSaving ? "Saving..." : "Hide for now"}
            </Button>
          }
        >
          <List ordered>
            {setupSteps.map((step, index) => (
              <ListRow
                key={step.title}
                to={step.to}
                leading={
                  step.done ? (
                    <Check className="size-5 text-sk-green" weight="bold" aria-label="Done" />
                  ) : (
                    <span className="w-5 text-center font-bold text-sk-blue-link">{index + 1}</span>
                  )
                }
                title={step.title}
                subtitle={step.body}
                trailing={step.done ? <span className="font-semibold text-sk-green-ink">Done</span> : undefined}
              />
            ))}
          </List>
        </Section>
      ) : null}

      {setupIncomplete && setupGuideDismissedAt ? (
        <Notice
          action={
            <Button variant="quiet" size="sm" disabled={setupGuideSaving} onClick={() => void handleSetupGuideStateChange(false)}>
              {setupGuideSaving ? "Saving..." : "Show setup steps"}
            </Button>
          }
        >
          Club setup is not finished yet. {stepsDone} of {setupSteps.length} steps done.
        </Notice>
      ) : null}

      <StatStrip aria-label="Club size">
        <Stat label="Athletes" value={dataLoading ? "-" : kpi.athletes} hint={kpi.unassignedAthletes > 0 ? `${kpi.unassignedAthletes} not on a team` : undefined} />
        <Stat label="Coaches" value={dataLoading ? "-" : kpi.coaches} hint={kpi.pendingInvites > 0 ? `${plural(kpi.pendingInvites, "invite")} waiting` : undefined} />
        <Stat label="Teams" value={dataLoading ? "-" : kpi.teams} hint={kpi.teamsWithoutLead > 0 ? `${kpi.teamsWithoutLead} without a lead coach` : undefined} />
        {dataLoading ? <Stat label="Ready to train" value="-" /> : kpi.checkedIn > 0 ? <Stat label="Ready to train" value={kpi.ready} of={kpi.checkedIn} /> : <Stat label="Ready to train" value="None" hint="No check-ins yet" />}
        {dataLoading ? (
          <Stat label="Plan adherence" value="-" />
        ) : kpi.adherence === null ? (
          <Stat label="Plan adherence" value="None" hint={NO_SESSIONS_DUE} />
        ) : (
          <Stat label="Plan adherence" value={kpi.adherence} unit="%" hint={isSupabaseMode ? `Last ${health?.windowDays ?? 28} days` : undefined} />
        )}
      </StatStrip>

      <Section
        title="Team by team"
        hint="Who leads each team, how many athletes they have, and how they are doing."
        action={
          <Link to="/club-admin/reports" className="sk-link">
            Reports
          </Link>
        }
      >
        {dataLoading ? (
          <SkeletonRows rows={4} label="Loading teams" />
        ) : teamRows.length > 0 ? (
          <DataTable caption="Teams of the club with their lead coach, size, readiness and adherence" columns={teamColumns} rows={teamRows} rowKey={(team) => team.id} />
        ) : (
          <EmptyState
            title="No teams yet"
            body="Create a team and it appears here with its lead coach, roster size, readiness and plan adherence."
            action={
              <LinkButton to="/club-admin/teams" size="sm">
                Create a team
              </LinkButton>
            }
          />
        )}
      </Section>

      {!dataLoading && needsYou.length === 0 && !setupIncomplete ? (
        <Section title="Needs you">
          <EmptyState title="Nothing is waiting on you" body="Account requests, reported messages, athletes without a team and teams without a lead coach show up here." />
        </Section>
      ) : null}
    </Screen>
  )
}
