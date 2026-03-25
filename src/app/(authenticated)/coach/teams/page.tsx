"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { FilePasteIcon, Link01Icon, QrCodeIcon, UserMultiple02Icon } from "@hugeicons/core-free-icons"
import { Link, Navigate } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import { EventGroupBadge } from "@/components/badges"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { COACH_TEAM_COOKIE, getCookieValue } from "@/lib/auth-session"
import { getCoachScope } from "@/lib/coach-scope"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import { createAthleteInviteForCurrentCoach } from "@/lib/data/athlete/invite-data"
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
  if (team.disciplines?.length) return team.disciplines.join(" / ")
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
  const [generatedInviteLinks, setGeneratedInviteLinks] = useState<Record<string, string>>({})
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

  const totalAthletes = visibleTeams.reduce((sum, team) => sum + team.athleteCount, 0)
  const visibleEventGroups = Array.from(new Set(visibleTeams.map((team) => team.eventGroup)))
  const scopedTeam = visibleTeams[0] ?? null
  const readinessAlerts = visibleTeams.reduce(
    (sum, team) => sum + athletesSource.filter((athlete) => athlete.teamId === team.id && athlete.readiness !== "green").length,
    0,
  )
  const selectedLeadCoach = assignableCoaches.find((coach) => coach.userId === newTeamLeadCoachUserId)

  if (isCoachViewer && !backendLoading) {
    if (visibleTeams[0]?.id) {
      return <Navigate to={`/coach/teams/${visibleTeams[0].id}`} replace />
    }

    return (
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        <section className="rounded-[28px] border border-dashed border-slate-300 bg-white px-5 py-8 text-sm text-slate-500 shadow-sm">
          No team is assigned for this coach profile.
        </section>
      </div>
    )
  }

  return (
    <div
      className={
        isClubAdminViewer
          ? "min-h-full bg-[linear-gradient(180deg,#f7f9fc_0%,#eef3f8_100%)]"
          : "min-h-full bg-[linear-gradient(180deg,#081120_0%,#0b1424_280px,#f3f6fb_280px,#eef3f8_100%)]"
      }
    >
      <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 pb-8 pt-4 sm:px-6 sm:pb-10 sm:pt-6 lg:px-8">
        {isClubAdminViewer ? (
          <section className="px-1 py-1 sm:px-2 lg:px-3">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
              <div className="space-y-4">
                <h1 className="max-w-[16ch] text-[clamp(2.2rem,5vw,4.75rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-slate-950">
                  Team operations overview.
                </h1>
                <p className="max-w-[60ch] text-sm leading-7 text-slate-600 sm:text-base">
                  Create teams, review roster load, manage athlete invite flow, and keep group health visible from one operating surface.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Visible teams", value: visibleTeams.length },
                  { label: "Athletes", value: totalAthletes },
                  { label: "Alerts", value: readinessAlerts },
                  { label: "Event groups", value: visibleEventGroups.length },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] px-4 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)]"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#1368ff]">
                      {item.label}
                    </p>
                    <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,rgba(7,17,34,0.96)_0%,rgba(10,24,44,0.9)_55%,rgba(20,67,160,0.72)_100%)] text-white shadow-[0_24px_80px_rgba(5,12,24,0.28)]">
            <div className="grid gap-8 px-5 py-6 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,420px)] lg:px-8 lg:py-9 xl:px-10">
              <div className="space-y-6">
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#6fb6ff]">
                    Coach Teams
                  </p>
                  <h1 className="max-w-[11ch] text-[clamp(2.35rem,6vw,4.9rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-white">
                    Team operations with clearer signal and less admin clutter.
                  </h1>
                  <p className="max-w-[58ch] text-sm leading-7 text-white/72 sm:text-base">
                    Review roster load, invite flow, and current group health from one surface.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[24px] border border-white/12 bg-white/[0.06] px-4 py-4 backdrop-blur-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6fb6ff]">Visible teams</p>
                    <p className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{visibleTeams.length}</p>
                    <p className="mt-1 text-sm text-white/64">Current operational scope</p>
                  </div>
                  <div className="rounded-[24px] border border-white/12 bg-white/[0.06] px-4 py-4 backdrop-blur-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6fb6ff]">Athletes</p>
                    <p className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{totalAthletes}</p>
                    <p className="mt-1 text-sm text-white/64">Across active roster view</p>
                  </div>
                  <div className="rounded-[24px] border border-white/12 bg-white/[0.06] px-4 py-4 backdrop-blur-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6fb6ff]">Alerts</p>
                    <p className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{readinessAlerts}</p>
                    <p className="mt-1 text-sm text-white/64">Readiness issues in view</p>
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/12 bg-white/[0.08] p-5 backdrop-blur-sm lg:self-end">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6fb6ff]">In scope</p>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3 text-sm text-white/72">
                    <span>Event groups</span>
                    <span className="font-semibold text-white">{visibleEventGroups.length}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3 text-sm text-white/72">
                    <span>Primary team</span>
                    <span className="font-semibold text-white">{scopedTeam?.name ?? "Mixed scope"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm text-white/72">
                    <span>Workflow priority</span>
                    <span className="font-semibold text-white">Roster + invites</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
        {backendError ? (
          <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Backend sync issue: {backendError}
          </section>
        ) : null}

        {isClubAdminViewer && isSupabaseMode ? (
          <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
            <div className="space-y-1 border-b border-slate-200 pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Create team</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Provision a new group from this surface</h2>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_220px_280px_180px]">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-slate-950">Team name</Label>
                <Input
                  className="h-12 rounded-[16px] border-slate-200 bg-slate-50"
                  value={newTeamName}
                  onChange={(event) => setNewTeamName(event.target.value)}
                  placeholder="Sprint Group B"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium text-slate-950">Event group</Label>
                <Select value={newTeamEventGroup} onValueChange={(value) => setNewTeamEventGroup(value as EventGroup)}>
                  <SelectTrigger className="h-12 rounded-[16px] border-slate-200 bg-slate-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {teamEventGroupOptions.map((group) => (
                      <SelectItem key={group} value={group}>
                        {group}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium text-slate-950">Lead coach</Label>
                <Select value={newTeamLeadCoachUserId} onValueChange={setNewTeamLeadCoachUserId}>
                  <SelectTrigger className="h-12 rounded-[16px] border-slate-200 bg-slate-50">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {assignableCoaches.map((coach) => (
                      <SelectItem key={coach.userId} value={coach.userId}>
                        {coach.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  disabled={creatingTeam || !newTeamName.trim()}
                  className="h-12 w-full rounded-full bg-[linear-gradient(135deg,#1368ff_0%,#2f80ff_100%)] px-5 text-white shadow-[0_12px_32px_rgba(28,101,255,0.22)] hover:opacity-95"
                  onClick={async () => {
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
                  }}
                >
                  {creatingTeam ? "Creating..." : "Create team"}
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {!isSupabaseMode && isCoachViewer && coachScope.allowTeamSwitcher ? (
          <section className="rounded-[28px] border border-slate-200 bg-white/85 px-5 py-4 shadow-sm backdrop-blur-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Mock only</p>
                <p className="text-sm font-medium text-slate-900">Switch the assigned coach group for QA and demo testing.</p>
                <p className="text-sm text-slate-500">Keep this out of production coach workflows.</p>
              </div>
              <Select
                value={coachTeamId}
                onValueChange={(value) => {
                  setCoachTeamId(value)
                  window.localStorage.setItem(MOCK_COACH_TEAM_STORAGE_KEY, value)
                  document.cookie = `${COACH_TEAM_COOKIE}=${value}; Path=/; Max-Age=${60 * 60 * 8}; SameSite=Lax`
                }}
              >
                <SelectTrigger className="w-full rounded-full border-slate-200 bg-white sm:max-w-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {teamsSource.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>
        ) : null}

        {isSupabaseMode && backendLoading ? (
          <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-8 text-sm text-slate-500 shadow-sm">
            Loading teams...
          </section>
        ) : null}

        {visibleTeams.length === 0 ? (
          <section className="rounded-[28px] border border-dashed border-slate-300 bg-white px-5 py-8 text-sm text-slate-500 shadow-sm">
            {isClubAdminViewer ? "No teams have been created yet." : "No team is assigned for this coach profile."}
          </section>
        ) : null}

        <section className="grid gap-5 xl:grid-cols-2">
          {visibleTeams.map((team) => {
            const inviteLink = generatedInviteLinks[team.id] ?? `/athlete/claim/${team.id}`
            const roster = athletesSource.filter((athlete) => athlete.teamId === team.id)
            const lowAdherenceCount = roster.filter((athlete) => athlete.adherence < 75).length
            const teamReadinessAlerts = roster.filter((athlete) => athlete.readiness !== "green").length

            return (
              <article
                key={team.id}
                className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]"
              >
                <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#081120_0%,#10203d_55%,#1b4cc7_120%)] px-5 py-5 text-white sm:px-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6fb6ff]">{getTeamDisciplineLabel(team)}</p>
                      <h2 className="text-2xl font-semibold tracking-[-0.04em]">{team.name}</h2>
                      <p className="text-sm text-white/70">{team.athleteCount} athletes currently assigned</p>
                    </div>
                    <div className="shrink-0">
                      <EventGroupBadge group={team.eventGroup} />
                    </div>
                  </div>
                </div>

                <div className="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Roster</p>
                      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{team.athleteCount}</p>
                    </div>
                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Readiness</p>
                      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{teamReadinessAlerts}</p>
                    </div>
                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Adherence risk</p>
                      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{lowAdherenceCount}</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button asChild className="h-12 rounded-full bg-[linear-gradient(135deg,#1368ff_0%,#2f80ff_100%)] px-5 text-white shadow-[0_12px_32px_rgba(28,101,255,0.22)] hover:opacity-95">
                      <Link to={`/coach/teams/${team.id}`}>Open team</Link>
                    </Button>

                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" className="h-12 rounded-full border-slate-200 px-5">
                          Invite athletes
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Invite to {team.name}</DialogTitle>
                          <DialogDescription>Share link or QR to add athletes to this group.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor={`invite-link-${team.id}`}>Invite link</Label>
                            <div className="flex items-center gap-2">
                              <Input
                                id={`invite-link-${team.id}`}
                                value={inviteLink}
                                readOnly
                                className="text-slate-950 selection:bg-[#dbeafe] selection:text-slate-950"
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                onClick={() => navigator.clipboard.writeText(inviteLink)}
                                aria-label="Copy invite link"
                              >
                                <HugeiconsIcon icon={FilePasteIcon} className="size-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>Invite expiration</Label>
                            <Select defaultValue="7d">
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="24h">24h</SelectItem>
                                <SelectItem value="7d">7d</SelectItem>
                                <SelectItem value="30d">30d</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex h-24 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                            <HugeiconsIcon icon={QrCodeIcon} className="mr-2 size-4" />
                            QR placeholder
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            type="button"
                            className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
                            onClick={async () => {
                              if (isSupabaseMode) {
                                const result = await createAthleteInviteForCurrentCoach({ teamId: team.id, expiresInDays: 7 })
                                if (!result.ok) {
                                  setBackendError(result.error.message)
                                  return
                                }
                                setGeneratedInviteLinks((current) => ({
                                  ...current,
                                  [team.id]: result.data.invitePath,
                                }))
                                return
                              }
                            }}
                          >
                            <HugeiconsIcon icon={Link01Icon} className="size-4" />
                            Generate Invite
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>

                  <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-4">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon icon={UserMultiple02Icon} className="size-4 text-slate-500" />
                      <p className="text-sm font-medium text-slate-900">Roster preview</p>
                    </div>
                    <div className="mt-4 space-y-3">
                      {roster.slice(0, 3).map((athlete) => (
                        <div key={athlete.id} className="flex items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-950">{athlete.name}</p>
                            <p className="truncate text-sm text-slate-500">
                              {athlete.primaryEvent} | Adherence {athlete.adherence}%
                            </p>
                          </div>
                          <div className="shrink-0">
                            <EventGroupBadge group={athlete.eventGroup} />
                          </div>
                        </div>
                      ))}
                      {roster.length === 0 ? <p className="text-sm text-slate-500">No athletes assigned yet.</p> : null}
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      </div>
    </div>
  )
}
