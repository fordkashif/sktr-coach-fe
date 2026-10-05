import { useEffect, useMemo, useState } from "react"
import { ArrowRight, Check, CheckCircle, UserPlus, UsersThree } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import { EmptyState, Meter, PageHeader, Panel, Stat, Tag, scoreTone } from "@/components/sk"
import { useClubAdmin } from "@/lib/club-admin-context"
import { setClubAdminSetupGuideDismissed } from "@/lib/data/club-admin/ops-data"
import {
  getClubAdminTeamHealthSnapshot,
  type ClubAdminTeamHealthRow,
  type ClubAdminTeamHealthSnapshot,
} from "@/lib/data/club-admin/team-health-data"
import type { Athlete } from "@/lib/mock-data"
import type { AccountRequest, ClubTeam, ClubUser, CoachInvite } from "@/lib/mock-club-admin"
import { averageAdherence } from "@/lib/data/session/adherence"
import { getBackendMode } from "@/lib/supabase/config"
import { cn } from "@/lib/utils"
import { loadClubAccountRequests, loadClubInvites, loadClubTeams, loadClubUsers, loadProfileSafe } from "../state"

/** One row of the team table. `adherenceWeight` lets the club figure weight teams fairly. */
type TeamRow = ClubAdminTeamHealthRow & { adherenceWeight: number }

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function buildMockTeamRows(teams: ClubTeam[], users: ClubUser[], athletes: Athlete[]): TeamRow[] {
  return teams
    .filter((team) => team.status !== "archived")
    .map((team) => {
      const roster = athletes.filter((athlete) => athlete.teamId === team.id)
      const lead = team.coachUserId ? users.find((user) => user.id === team.coachUserId) : undefined
      const leadCoachName = lead?.name ?? team.coachEmail ?? null
      return {
        id: team.id,
        name: team.name,
        eventGroup: team.eventGroup,
        status: team.status,
        leadCoachName,
        hasLeadCoach: Boolean(team.coachUserId || team.coachEmail),
        coachCount: users.filter((user) => user.role === "coach" && user.teamId === team.id).length,
        athleteCount: roster.length,
        ready: roster.filter((athlete) => athlete.readiness === "green").length,
        watch: roster.filter((athlete) => athlete.readiness === "yellow").length,
        review: roster.filter((athlete) => athlete.readiness === "red").length,
        noCheckIn: 0,
        adherence: averageAdherence(roster.map((athlete) => athlete.adherence)),
        scheduledSessions: 0,
        adherenceWeight: roster.filter((athlete) => athlete.adherence !== null).length,
      }
    })
}

function ReadinessCell({ team }: { team: TeamRow }) {
  if (team.athleteCount === 0) return <span className="text-sm text-sk-mute">No athletes yet</span>
  const checkedIn = team.ready + team.watch + team.review
  if (checkedIn === 0) return <span className="text-sm text-sk-mute">No check-ins yet</span>
  const parts = [
    team.ready > 0 ? `${team.ready} ready` : null,
    team.watch > 0 ? `${team.watch} watch` : null,
    team.review > 0 ? `${team.review} review` : null,
  ].filter(Boolean)
  return (
    <div className="min-w-[150px]">
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {team.ready > 0 ? <span className="bg-sk-green" style={{ flexGrow: team.ready }} /> : null}
        {team.watch > 0 ? <span className="bg-sk-yellow" style={{ flexGrow: team.watch }} /> : null}
        {team.review > 0 ? <span className="bg-sk-coral" style={{ flexGrow: team.review }} /> : null}
      </div>
      <p className="mt-1.5 text-sm text-sk-ink-2">{parts.join(", ")}</p>
    </div>
  )
}

export default function ClubAdminDashboardPage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const clubAdmin = useClubAdmin()

  const [users, setUsers] = useState<ClubUser[]>(() => (isSupabaseMode ? [] : loadClubUsers()))
  const [mockTeams] = useState<ClubTeam[]>(() => (isSupabaseMode ? [] : loadClubTeams()))
  const [invites, setInvites] = useState<CoachInvite[]>(() => (isSupabaseMode ? [] : loadClubInvites()))
  const [accountRequests, setAccountRequests] = useState<AccountRequest[]>(() => (isSupabaseMode ? [] : loadClubAccountRequests()))
  const [mockAthletes, setMockAthletes] = useState<Athlete[] | null>(null)
  const [health, setHealth] = useState<ClubAdminTeamHealthSnapshot | null>(null)
  const [healthLoading, setHealthLoading] = useState(isSupabaseMode)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [setupGuideDismissedAt, setSetupGuideDismissedAt] = useState<string | null>(clubAdmin.profile?.setupGuideDismissedAt ?? null)
  const [setupGuideSaving, setSetupGuideSaving] = useState(false)

  useEffect(() => {
    if (!isSupabaseMode) return

    if (clubAdmin.opsSnapshot) {
      setUsers(
        clubAdmin.opsSnapshot.users.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          status: row.status,
          teamId: row.teamId,
        })),
      )
      setInvites(
        clubAdmin.opsSnapshot.invites.map((row) => ({
          id: row.id,
          email: row.email,
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

    if (clubAdmin.profile) {
      setSetupGuideDismissedAt(clubAdmin.profile.setupGuideDismissedAt ?? null)
    }
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

    void import("@/lib/mock-data").then((module) => {
      if (!cancelled) setMockAthletes(module.mockAthletes)
    })

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  const teamRows = useMemo<TeamRow[]>(() => {
    if (isSupabaseMode) return (health?.teams ?? []).map((team) => ({ ...team, adherenceWeight: team.scheduledSessions }))
    return buildMockTeamRows(mockTeams, users, mockAthletes ?? [])
  }, [health, isSupabaseMode, mockAthletes, mockTeams, users])

  const kpi = useMemo(() => {
    const athletes = isSupabaseMode ? (health?.athleteCount ?? 0) : (mockAthletes?.length ?? 0)
    const ready = teamRows.reduce((sum, team) => sum + team.ready, 0)
    const watch = teamRows.reduce((sum, team) => sum + team.watch, 0)
    const review = teamRows.reduce((sum, team) => sum + team.review, 0)
    const weighted = teamRows.filter((team) => team.adherence !== null && team.adherenceWeight > 0)
    const weight = weighted.reduce((sum, team) => sum + team.adherenceWeight, 0)
    return {
      athletes,
      coaches: users.filter((user) => user.role === "coach" && user.status === "active").length,
      teams: teamRows.filter((team) => team.status === "active").length,
      pendingInvites: invites.filter((invite) => invite.status === "pending").length,
      pendingRequests: accountRequests.filter((request) => request.status === "pending").length,
      teamsWithoutLead: teamRows.filter((team) => !team.hasLeadCoach).length,
      teamsWithoutAthletes: teamRows.filter((team) => team.athleteCount === 0).length,
      unassignedAthletes: isSupabaseMode ? (health?.unassignedAthleteCount ?? 0) : 0,
      ready,
      watch,
      review,
      checkedIn: ready + watch + review,
      adherence: weight > 0 ? Math.round(weighted.reduce((sum, team) => sum + (team.adherence ?? 0) * team.adherenceWeight, 0) / weight) : null,
    }
  }, [accountRequests, health, invites, isSupabaseMode, mockAthletes, teamRows, users])

  const needsYou = [
    {
      key: "requests",
      count: kpi.pendingRequests,
      title: kpi.pendingRequests === 1 ? "Account request to review" : "Account requests to review",
      body: "People who asked to join your club and are waiting on you.",
      to: "/club-admin/users",
      cta: "Review",
    },
    {
      key: "invites",
      count: kpi.pendingInvites,
      title: kpi.pendingInvites === 1 ? "Coach invite not accepted yet" : "Coach invites not accepted yet",
      body: "A nudge or a fresh link usually does it.",
      to: "/club-admin/users",
      cta: "Open invites",
    },
    {
      key: "no-lead",
      count: kpi.teamsWithoutLead,
      title: kpi.teamsWithoutLead === 1 ? "Team without a lead coach" : "Teams without a lead coach",
      body: "Nobody owns the plan for these athletes yet.",
      to: "/club-admin/teams",
      cta: "Assign a coach",
    },
    {
      key: "no-athletes",
      count: kpi.teamsWithoutAthletes,
      title: kpi.teamsWithoutAthletes === 1 ? "Team with no athletes" : "Teams with no athletes",
      body: "Coaches add athletes from their team roster.",
      to: "/club-admin/teams",
      cta: "Open teams",
    },
    {
      key: "unassigned",
      count: kpi.unassignedAthletes,
      title: kpi.unassignedAthletes === 1 ? "Athlete not on a team" : "Athletes not on a team",
      body: "They will not get a plan until they are on a roster.",
      to: "/club-admin/users",
      cta: "Open users",
    },
  ].filter((item) => item.count > 0)

  const setupSteps = [
    {
      title: "Create your first team",
      body: "A squad or training group that coaches and athletes join.",
      to: "/club-admin/teams",
      cta: "Open teams",
      done: teamRows.length > 0,
    },
    {
      title: "Invite your coaches",
      body: "Send each coach an invite and put them on a team.",
      to: "/club-admin/users",
      cta: "Invite a coach",
      done: kpi.coaches > 0 || kpi.pendingInvites > 0,
    },
    {
      title: "Get athletes on a roster",
      body: "Coaches invite their athletes. They show up here as they join.",
      to: "/club-admin/teams",
      cta: "See rosters",
      done: kpi.athletes > 0,
    },
  ]

  const dataLoading = isSupabaseMode
    ? (clubAdmin.opsLoading && !clubAdmin.opsSnapshot) || (healthLoading && !health)
    : mockAthletes === null
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
    if (clubAdmin.profile) {
      clubAdmin.updateCachedProfile({
        ...clubAdmin.profile,
        setupGuideDismissedAt: nextDismissedAt,
      })
    }
  }

  const clubName = (isSupabaseMode ? clubAdmin.profile?.clubName : loadProfileSafe().clubName)?.trim() || "Your club"

  const lede = dataLoading
    ? "Loading your club..."
    : kpi.teams === 0 && kpi.athletes === 0 && kpi.coaches === 0
      ? "Your club is ready to fill. Start with a team, then bring in your coaches."
      : `${plural(kpi.coaches, "coach", "coaches")} and ${plural(kpi.athletes, "athlete")} across ${plural(kpi.teams, "team")}. ${
          needsYou.length === 0 ? "Nothing is waiting on you." : `${plural(needsYou.length, "thing")} ${needsYou.length === 1 ? "needs" : "need"} you.`
        }`

  return (
    <div className="sk-page">
      {backendError ? (
        <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
          Could not load the latest data: {backendError}
        </p>
      ) : null}

      <PageHeader
        title={clubName}
        lede={lede}
        actions={
          <>
            <Link to="/club-admin/teams" className="sk-btn sk-btn-quiet">
              <UsersThree className="size-5" weight="bold" />
              Manage teams
            </Link>
            <Link to="/club-admin/users" className="sk-btn sk-btn-primary">
              <UserPlus className="size-5" weight="bold" />
              Invite a coach
            </Link>
          </>
        }
      />

      {setupIncomplete && !setupGuideDismissedAt ? (
        <section className="rounded-[20px] bg-sk-yellow p-5 sm:p-6" aria-labelledby="club-setup-heading">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 id="club-setup-heading" className="sk-h2">
                Get your club running in three steps
              </h2>
              <p className="mt-1 max-w-[56ch] text-sk-ink-2">
                {stepsDone === 0 ? "Do these in order and this dashboard fills itself in." : `${stepsDone} of ${setupSteps.length} done. Keep going and this dashboard fills itself in.`}
              </p>
            </div>
            <button
              type="button"
              className="sk-btn sk-btn-ghost sk-btn-sm self-start"
              disabled={setupGuideSaving}
              onClick={() => void handleSetupGuideStateChange(true)}
            >
              {setupGuideSaving ? "Saving..." : "Hide for now"}
            </button>
          </div>
          <ol className="mt-5 grid gap-3 md:grid-cols-3">
            {setupSteps.map((item, index) => (
              <li key={item.title} className="flex flex-col gap-3 rounded-2xl bg-white p-4">
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full text-sm font-extrabold",
                      item.done ? "bg-sk-green text-white" : "bg-sk-ink text-white",
                    )}
                  >
                    {item.done ? <Check className="size-4" weight="bold" aria-hidden /> : index + 1}
                  </span>
                  {item.done ? <span className="text-sm font-bold text-[#07673f]">Done</span> : null}
                </div>
                <div>
                  <p className="sk-h3">{item.title}</p>
                  <p className="mt-1 text-sm text-sk-mute">{item.body}</p>
                </div>
                <div className="mt-auto">
                  <Link to={item.to} className="sk-btn sk-btn-quiet sk-btn-sm">
                    {item.cta}
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {setupIncomplete && setupGuideDismissedAt ? (
        <div className="flex flex-col gap-3 rounded-[20px] border border-sk-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-sk-ink">
            Club setup is not finished yet. {stepsDone} of {setupSteps.length} steps done.
          </p>
          <button
            type="button"
            className="sk-btn sk-btn-quiet sk-btn-sm"
            disabled={setupGuideSaving}
            onClick={() => void handleSetupGuideStateChange(false)}
          >
            {setupGuideSaving ? "Saving..." : "Show setup steps"}
          </button>
        </div>
      ) : null}

      {dataLoading ? (
        <p role="status" className="sk-card text-sm font-semibold text-sk-mute">
          Loading...
        </p>
      ) : (
        <>
          <section aria-label="Club size" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat tone="blue" label="Athletes" value={kpi.athletes} hint={kpi.unassignedAthletes > 0 ? `${kpi.unassignedAthletes} not on a team` : "On your rosters"} />
            <Stat label="Coaches" value={kpi.coaches} hint={kpi.pendingInvites > 0 ? `${plural(kpi.pendingInvites, "invite")} pending` : "Active accounts"} />
            <Stat label="Teams" value={kpi.teams} hint={kpi.teamsWithoutLead > 0 ? `${kpi.teamsWithoutLead} without a lead coach` : "Active"} />
            <Stat
              tone={kpi.checkedIn > 0 ? "green" : "plain"}
              label="Ready to train"
              value={kpi.ready}
              hint={kpi.checkedIn > 0 ? `of ${plural(kpi.checkedIn, "athlete")} checked in` : "No check-ins yet"}
            />
          </section>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Panel title="Needs you" hint="Requests, invites and teams that are waiting on a club admin.">
              {needsYou.length > 0 ? (
                <ul>
                  {needsYou.map((item) => (
                    <li key={item.key} className="border-b border-sk-line last:border-b-0">
                      <Link
                        to={item.to}
                        className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 py-4"
                      >
                        <span className="sk-num w-9 text-center text-[2rem] text-sk-coral">{item.count}</span>
                        <span className="min-w-0">
                          <span className="block font-bold text-sk-ink group-hover:text-sk-blue">{item.title}</span>
                          <span className="block text-sm text-sk-mute">{item.body}</span>
                        </span>
                        <span className="hidden items-center gap-1.5 text-sm font-bold text-sk-ink-2 group-hover:text-sk-blue sm:inline-flex">
                          {item.cta}
                          <ArrowRight className="size-4" weight="bold" />
                        </span>
                        <ArrowRight className="size-5 text-sk-mute sm:hidden" weight="bold" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<CheckCircle className="size-6" weight="fill" />}
                  title="Nothing is waiting on you"
                  body="Account requests, unanswered coach invites, teams without a lead coach and teams with no athletes show up here."
                  className="border-0 bg-sk-canvas"
                />
              )}
            </Panel>

            <Panel title="Across the club" hint={isSupabaseMode ? `Sessions completed in the last ${health?.windowDays ?? 28} days.` : "Share of planned sessions completed."}>
              {kpi.adherence !== null ? (
                <>
                  <p className="sk-num text-[3.5rem]">
                    {kpi.adherence}
                    <span className="ml-1 text-base font-bold tracking-normal text-sk-mute">% plan adherence</span>
                  </p>
                  <Meter value={kpi.adherence} tone={scoreTone(kpi.adherence)} className="mt-4" />
                </>
              ) : (
                <div className="sk-well">
                  <p className="sk-h3">No adherence yet</p>
                  <p className="mt-1 text-sm leading-relaxed text-sk-mute">
                    This fills in once coaches schedule sessions and athletes start completing them.
                  </p>
                </div>
              )}
              <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-sk-line pt-4 text-center">
                {[
                  { label: "Ready", value: kpi.ready, dot: "bg-sk-green" },
                  { label: "Watch", value: kpi.watch, dot: "bg-sk-yellow" },
                  { label: "Review", value: kpi.review, dot: "bg-sk-coral" },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col-reverse">
                    <dt className="mt-1 inline-flex items-center justify-center gap-1.5 text-sm text-sk-mute">
                      <span className={cn("size-2 rounded-full", item.dot)} />
                      {item.label}
                    </dt>
                    <dd className="sk-num text-2xl">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </div>

          <Panel
            title="Team by team"
            hint="Who leads each team, how many athletes they have, and how they are doing."
            action={
              <Link to="/club-admin/reports" className="sk-btn sk-btn-ghost sk-btn-sm">
                Reports
                <ArrowRight className="size-4" weight="bold" />
              </Link>
            }
          >
            {teamRows.length > 0 ? (
              <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
                <table className="w-full min-w-[720px] text-left">
                  <thead>
                    <tr className="border-b border-sk-line text-sm text-sk-mute">
                      <th scope="col" className="py-2 pr-4 font-semibold">Team</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Lead coach</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Athletes</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Readiness</th>
                      <th scope="col" className="py-2 pl-3 font-semibold">Plan adherence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamRows.map((team) => (
                      <tr key={team.id} className="border-b border-sk-line align-middle last:border-b-0">
                        <th scope="row" className="py-4 pr-4 font-normal">
                          <Link to="/club-admin/teams" className="font-bold text-sk-ink hover:text-sk-blue">
                            {team.name}
                          </Link>
                          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-sk-mute">
                            {team.eventGroup ?? "No event group"}
                            {team.status === "draft" ? <Tag>Draft</Tag> : null}
                          </span>
                        </th>
                        <td className="px-3 py-4">
                          {team.hasLeadCoach ? (
                            <span className="font-semibold text-sk-ink">{team.leadCoachName ?? "Assigned"}</span>
                          ) : (
                            <Link to="/club-admin/teams" aria-label={`Assign a lead coach to ${team.name}`}>
                              <Tag tone="coral">No lead coach</Tag>
                            </Link>
                          )}
                        </td>
                        <td className="px-3 py-4 text-right">
                          <span className={cn("sk-num text-xl", team.athleteCount === 0 && "text-sk-mute")}>{team.athleteCount}</span>
                        </td>
                        <td className="px-3 py-4">
                          <ReadinessCell team={team} />
                        </td>
                        <td className="py-4 pl-3">
                          {team.adherence !== null ? (
                            <div className="flex min-w-[150px] items-center gap-3">
                              <Meter value={team.adherence} tone={scoreTone(team.adherence)} />
                              <span className="w-11 shrink-0 text-right font-bold tabular-nums text-sk-ink">{team.adherence}%</span>
                            </div>
                          ) : (
                            <span className="text-sm text-sk-mute">{team.athleteCount === 0 ? "No athletes yet" : "No sessions yet"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<UsersThree className="size-6" weight="fill" />}
                title="No teams yet"
                body="Create a team and it appears here with its lead coach, roster size, readiness and plan adherence."
                action={
                  <Link to="/club-admin/teams" className="sk-btn sk-btn-ink sk-btn-sm">
                    Create a team
                  </Link>
                }
                className="border-0 bg-sk-canvas"
              />
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
