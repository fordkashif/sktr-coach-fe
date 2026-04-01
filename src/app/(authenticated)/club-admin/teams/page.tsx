"use client"

import { useEffect, useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Archive01Icon, Edit02Icon, Link01Icon, RestoreBinIcon, UserMultiple02Icon } from "@hugeicons/core-free-icons"
import { Link } from "react-router-dom"
import { ClubAdminNav } from "@/components/club-admin/admin-nav"
import { EventGroupBadge } from "@/components/badges"
import { Button } from "@/components/ui/button"
import { EmptyStateCard } from "@/components/ui/empty-state-card"
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
import {
  createClubAdminTeam,
  getClubAdminAssignableCoachOptions,
  getClubAdminTeamsSnapshot,
  setClubAdminTeamArchived,
  setClubAdminTeamLeadCoach,
  updateClubAdminTeam,
  type ClubAdminAssignableCoachOption,
  type ClubAdminTeamRecord,
} from "@/lib/data/club-admin/ops-data"
import { createAthleteInviteForCurrentCoach } from "@/lib/data/athlete/invite-data"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import { type EventGroup } from "@/lib/mock-data"
import { type ClubTeam } from "@/lib/mock-club-admin"
import { getBackendMode } from "@/lib/supabase/config"
import { loadTeamsSafe, loadUsersSafe, persistTeams } from "../state"

const EVENT_GROUP_OPTIONS: EventGroup[] = ["Sprint", "Mid", "Distance", "Jumps", "Throws"]

type TeamCard = {
  id: string
  name: string
  eventGroup: EventGroup
  status: "draft" | "active" | "archived"
  athleteCount: number
  leadCoachUserId?: string
  leadCoachLabel?: string
}

function toTeamCardFromMock(team: ClubTeam, athleteCountByTeamId: Record<string, number>): TeamCard {
  return {
    id: team.id,
    name: team.name,
    eventGroup: team.eventGroup,
    status: team.status,
    athleteCount: athleteCountByTeamId[team.id] ?? 0,
    leadCoachUserId: team.coachUserId,
    leadCoachLabel: team.coachEmail,
  }
}

function toEventGroup(value: string | null | undefined): EventGroup {
  if (value === "Sprint" || value === "Mid" || value === "Distance" || value === "Jumps" || value === "Throws") return value
  return "Sprint"
}

export default function ClubAdminTeamsPage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const [teams, setTeams] = useState<TeamCard[]>([])
  const [coachOptions, setCoachOptions] = useState<ClubAdminAssignableCoachOption[]>([])
  const [generatedInviteLinks, setGeneratedInviteLinks] = useState<Record<string, string>>({})
  const [backendLoading, setBackendLoading] = useState(true)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTeamId, setEditTeamId] = useState<string | null>(null)
  const [inviteTeamId, setInviteTeamId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [inviteSaving, setInviteSaving] = useState(false)
  const [athleteInviteEmail, setAthleteInviteEmail] = useState("")
  const [newTeamName, setNewTeamName] = useState("")
  const [newTeamEventGroup, setNewTeamEventGroup] = useState<EventGroup>("Sprint")
  const [newTeamLeadCoachUserId, setNewTeamLeadCoachUserId] = useState("none")
  const [editName, setEditName] = useState("")
  const [editEventGroup, setEditEventGroup] = useState<EventGroup>("Sprint")
  const [editLeadCoachUserId, setEditLeadCoachUserId] = useState("none")

  const activeTeams = useMemo(() => teams.filter((team) => team.status !== "archived"), [teams])
  const archivedTeams = useMemo(() => teams.filter((team) => team.status === "archived"), [teams])
  const totalAthletes = useMemo(() => teams.reduce((sum, team) => sum + team.athleteCount, 0), [teams])
  const currentEditTeam = useMemo(() => teams.find((team) => team.id === editTeamId) ?? null, [editTeamId, teams])

  useEffect(() => {
    if (currentEditTeam) {
      setEditName(currentEditTeam.name)
      setEditEventGroup(currentEditTeam.eventGroup)
      setEditLeadCoachUserId(currentEditTeam.leadCoachUserId ?? "none")
    }
  }, [currentEditTeam])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setBackendLoading(true)

      if (!isSupabaseMode) {
        const mockData = await import("@/lib/mock-data")
        const athleteCountByTeamId = mockData.mockAthletes.reduce<Record<string, number>>((acc, athlete) => {
          acc[athlete.teamId] = (acc[athlete.teamId] ?? 0) + 1
          return acc
        }, {})
        const mockTeams = loadTeamsSafe().map((team) => toTeamCardFromMock(team, athleteCountByTeamId))
        const mockUsers = loadUsersSafe()
          .filter((user) => user.status === "active" && (user.role === "coach" || user.role === "club-admin"))
          .map((user) => ({
            userId: user.id,
            name: user.name,
            email: user.email,
            label: `${user.name}${user.email ? ` (${user.email})` : ""}`,
            isSelf: user.role === "club-admin",
          }))

        if (!cancelled) {
          setTeams(mockTeams)
          setCoachOptions(mockUsers)
          setBackendError(null)
          setBackendLoading(false)
        }
        return
      }

      const [teamResult, countResult, coachResult] = await Promise.all([
        getClubAdminTeamsSnapshot(),
        getCoachTeamsSnapshotForCurrentUser(),
        getClubAdminAssignableCoachOptions(),
      ])

      if (cancelled) return
      if (!teamResult.ok) {
        setBackendError(teamResult.error.message)
        setBackendLoading(false)
        return
      }
      if (!countResult.ok) {
        setBackendError(countResult.error.message)
        setBackendLoading(false)
        return
      }
      if (!coachResult.ok) {
        setBackendError(coachResult.error.message)
        setBackendLoading(false)
        return
      }

      const athleteCountByTeamId = countResult.data.teams.reduce<Record<string, number>>((acc, team) => {
        acc[team.id] = team.athleteCount
        return acc
      }, {})

      setTeams(
        teamResult.data.map((team: ClubAdminTeamRecord) => ({
          id: team.id,
          name: team.name,
          eventGroup: toEventGroup(team.eventGroup),
          status: team.status,
          athleteCount: athleteCountByTeamId[team.id] ?? 0,
          leadCoachUserId: team.leadCoachUserId,
          leadCoachLabel: team.leadCoachLabel,
        })),
      )
      setCoachOptions(coachResult.data)
      setBackendError(null)
      setBackendLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  const resetCreateForm = () => {
    setNewTeamName("")
    setNewTeamEventGroup("Sprint")
    setNewTeamLeadCoachUserId("none")
  }

  const selectedCreateCoach = coachOptions.find((coach) => coach.userId === newTeamLeadCoachUserId)
  const selectedEditCoach = coachOptions.find((coach) => coach.userId === editLeadCoachUserId)

  const handleCreate = async () => {
    if (!newTeamName.trim()) return
    setSaving(true)

    if (isSupabaseMode) {
      const result = await createClubAdminTeam({
        name: newTeamName.trim(),
        eventGroup: newTeamEventGroup,
        leadCoachUserId: newTeamLeadCoachUserId === "none" ? null : newTeamLeadCoachUserId,
        leadCoachLabel: newTeamLeadCoachUserId === "none" ? null : selectedCreateCoach?.label ?? null,
      })
      setSaving(false)

      if (!result.ok) {
        setBackendError(result.error.message)
        return
      }

      setTeams((current) => [
        {
          id: result.data.id,
          name: result.data.name,
          eventGroup: toEventGroup(result.data.eventGroup),
          status: result.data.status,
          athleteCount: 0,
          leadCoachUserId: result.data.leadCoachUserId,
          leadCoachLabel: result.data.leadCoachLabel,
        },
        ...current,
      ])
      setBackendError(null)
    } else {
      const users = loadUsersSafe()
      const selectedCoach = users.find((user) => user.id === newTeamLeadCoachUserId)
      const nextTeam: ClubTeam = {
        id: `team-${Date.now()}`,
        name: newTeamName.trim(),
        eventGroup: newTeamEventGroup,
        status: "active",
        coachUserId: selectedCoach?.id,
        coachEmail: selectedCoach?.email,
      }
      const nextTeams = [nextTeam, ...loadTeamsSafe()]
      persistTeams(nextTeams)
      const currentCounts = teams.reduce<Record<string, number>>((acc, team) => {
        acc[team.id] = team.athleteCount
        return acc
      }, {})
      setTeams(nextTeams.map((team) => toTeamCardFromMock(team, currentCounts)))
      setBackendError(null)
      setSaving(false)
    }

    resetCreateForm()
    setCreateOpen(false)
  }

  const handleSaveEdit = async () => {
    if (!currentEditTeam || !editName.trim()) return
    setSaving(true)

    if (isSupabaseMode) {
      const updateResult = await updateClubAdminTeam({
        teamId: currentEditTeam.id,
        name: editName.trim(),
        eventGroup: editEventGroup,
        status: currentEditTeam.status,
      })
      if (!updateResult.ok) {
        setSaving(false)
        setBackendError(updateResult.error.message)
        return
      }

      const coachResult = await setClubAdminTeamLeadCoach({
        teamId: currentEditTeam.id,
        leadCoachUserId: editLeadCoachUserId === "none" ? null : editLeadCoachUserId,
      })
      setSaving(false)

      if (!coachResult.ok) {
        setBackendError(coachResult.error.message)
        return
      }

      setTeams((current) =>
        current.map((team) =>
          team.id === currentEditTeam.id
            ? {
                ...team,
                name: editName.trim(),
                eventGroup: editEventGroup,
                leadCoachUserId: editLeadCoachUserId === "none" ? undefined : editLeadCoachUserId,
                leadCoachLabel: editLeadCoachUserId === "none" ? undefined : selectedEditCoach?.label ?? undefined,
              }
            : team,
        ),
      )
      setBackendError(null)
    } else {
      const users = loadUsersSafe()
      const selectedCoach = users.find((user) => user.id === editLeadCoachUserId)
      const nextTeams = loadTeamsSafe().map((team) =>
        team.id === currentEditTeam.id
          ? {
              ...team,
              name: editName.trim(),
              eventGroup: editEventGroup,
              coachUserId: selectedCoach?.id,
              coachEmail: selectedCoach?.email,
            }
          : team,
      )
      persistTeams(nextTeams)
      const currentCounts = teams.reduce<Record<string, number>>((acc, team) => {
        acc[team.id] = team.athleteCount
        return acc
      }, {})
      setTeams(nextTeams.map((team) => toTeamCardFromMock(team, currentCounts)))
      setBackendError(null)
      setSaving(false)
    }

    setEditTeamId(null)
  }

  const handleArchiveToggle = async (team: TeamCard, archived: boolean) => {
    setSaving(true)

    if (isSupabaseMode) {
      const result = await setClubAdminTeamArchived({ teamId: team.id, archived })
      setSaving(false)

      if (!result.ok) {
        setBackendError(result.error.message)
        return
      }

      setTeams((current) =>
        current.map((item) =>
          item.id === team.id ? { ...item, status: archived ? "archived" : "active" } : item,
        ),
      )
      setBackendError(null)
      return
    }

    const nextTeams: ClubTeam[] = loadTeamsSafe().map((item) =>
      item.id === team.id ? { ...item, status: archived ? "archived" : "active" } : item,
    )
    persistTeams(nextTeams)
    const currentCounts = teams.reduce<Record<string, number>>((acc, item) => {
      acc[item.id] = item.athleteCount
      return acc
    }, {})
    setTeams(nextTeams.map((item) => toTeamCardFromMock(item, currentCounts)))
    setBackendError(null)
    setSaving(false)
  }

  const handleGenerateInvite = async (teamId: string) => {
    if (!isSupabaseMode) {
      setGeneratedInviteLinks((current) => ({ ...current, [teamId]: `/athlete/claim/${teamId}` }))
      return
    }

    const result = await createAthleteInviteForCurrentCoach({ teamId, email: athleteInviteEmail, expiresInDays: 7 })
    if (!result.ok) {
      setBackendError(result.error.message)
      return
    }

    setGeneratedInviteLinks((current) => ({ ...current, [teamId]: result.data.invitePath }))
    setBackendError(null)
  }

  const renderTeamCard = (team: TeamCard) => {
    const inviteLink = generatedInviteLinks[team.id] ?? `/athlete/claim/${team.id}`

    return (
      <article
        key={team.id}
        className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.06)]"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <EventGroupBadge group={team.eventGroup} />
              <span
                className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                  team.status === "archived" ? "bg-slate-200 text-slate-700" : "bg-[#eef5ff] text-[#1f5fd1]"
                }`}
              >
                {team.status}
              </span>
            </div>
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">{team.name}</h2>
            <p className="text-sm text-slate-500">
              Lead coach: {team.leadCoachLabel ?? "Unassigned"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-[240px]">
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Roster</p>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{team.athleteCount}</p>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Invite link</p>
              <p className="mt-2 text-sm font-medium text-slate-950">{inviteLink}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild className="h-11 rounded-full bg-[linear-gradient(135deg,#1368ff_0%,#2f80ff_100%)] px-5 text-white hover:opacity-95">
            <Link to={`/coach/teams/${team.id}`}>Open team</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-full border-slate-200 px-5"
            onClick={() => {
              setAthleteInviteEmail("")
              setInviteTeamId(team.id)
            }}
          >
            <HugeiconsIcon icon={Link01Icon} className="size-4" />
            Generate athlete invite
          </Button>
          <Button type="button" variant="outline" className="h-11 rounded-full border-slate-200 px-5" onClick={() => setEditTeamId(team.id)}>
            <HugeiconsIcon icon={Edit02Icon} className="size-4" />
            Edit team
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            className="h-11 rounded-full border-slate-200 px-5"
            onClick={() => void handleArchiveToggle(team, team.status !== "archived")}
          >
            <HugeiconsIcon icon={team.status === "archived" ? RestoreBinIcon : Archive01Icon} className="size-4" />
            {team.status === "archived" ? "Restore team" : "Archive team"}
          </Button>
        </div>
      </article>
    )
  }

  return (
    <div className="mx-auto w-full max-w-8xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="px-1 py-1 sm:px-2 lg:px-3">
        <div className="space-y-4">
          <div>
            <h1 className="max-w-[14ch] text-[clamp(2.2rem,5vw,4.75rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-slate-950">
              Team operations and structure.
            </h1>
            <p className="mt-3 max-w-[60ch] text-sm leading-7 text-slate-600 sm:text-base">
              Create teams, update ownership, archive old groups, and generate athlete invite paths from one tenant-admin surface.
            </p>
          </div>
          <ClubAdminNav />
        </div>
      </section>

      {backendError ? (
        <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Backend sync issue: {backendError}
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="mobile-card-primary">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Teams</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Tenant groups</h2>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white hover:opacity-95">
                  Create team
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Create team</DialogTitle>
                  <DialogDescription>Provision a new team and optionally assign a lead coach.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label>Team name</Label>
                    <Input value={newTeamName} onChange={(event) => setNewTeamName(event.target.value)} placeholder="Sprint Group B" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Event group</Label>
                      <Select value={newTeamEventGroup} onValueChange={(value) => setNewTeamEventGroup(value as EventGroup)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {EVENT_GROUP_OPTIONS.map((group) => (
                            <SelectItem key={group} value={group}>{group}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Lead coach</Label>
                      <Select value={newTeamLeadCoachUserId} onValueChange={setNewTeamLeadCoachUserId}>
                        <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unassigned</SelectItem>
                          {coachOptions.map((coach) => (
                            <SelectItem key={coach.userId} value={coach.userId}>{coach.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" className="border-slate-200" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" disabled={saving || !newTeamName.trim()} onClick={() => void handleCreate()}>
                    {saving ? "Saving..." : "Create team"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Active teams</p>
              <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950">{activeTeams.length}</p>
            </div>
            <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Archived teams</p>
              <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950">{archivedTeams.length}</p>
            </div>
            <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Rostered athletes</p>
              <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950">{totalAthletes}</p>
            </div>
          </div>
        </div>

        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Intervention</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Planning and testing</h2>
          </div>
          <div className="mt-4 space-y-3">
            <p className="text-sm leading-6 text-slate-600">
              Club admins can intervene in shared coach workflows when tenant operations require it.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline" className="border-slate-200">
                <Link to="/coach/training-plan">Open training plans</Link>
              </Button>
              <Button asChild variant="outline" className="border-slate-200">
                <Link to="/coach/test-week">Open test weeks</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {backendLoading ? (
        <section className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          Loading teams...
        </section>
      ) : null}

      {!backendLoading && teams.length === 0 ? (
        <EmptyStateCard
          eyebrow="Teams"
          title="No teams exist yet."
          description="Teams are the operational container for coach assignments, athlete rosters, plans, and testing. This tenant needs at least one team before daily workflows can start."
          hint="Create the first team, assign a lead coach if available, and then begin athlete invite flow from that team."
          icon={<HugeiconsIcon icon={UserMultiple02Icon} className="size-5" />}
          actions={
            <Button
              type="button"
              className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white hover:opacity-95"
              onClick={() => setCreateOpen(true)}
            >
              Create first team
            </Button>
          }
        />
      ) : null}

      {activeTeams.length > 0 ? (
        <section className="space-y-4">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Active</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Current team structure</h2>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            {activeTeams.map(renderTeamCard)}
          </div>
        </section>
      ) : null}

      {archivedTeams.length > 0 ? (
        <section className="space-y-4">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Archived</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Dormant groups</h2>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            {archivedTeams.map(renderTeamCard)}
          </div>
        </section>
      ) : null}

      <Dialog open={Boolean(editTeamId)} onOpenChange={(open) => (!open ? setEditTeamId(null) : undefined)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit team</DialogTitle>
            <DialogDescription>Update team metadata and coach assignment.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Team name</Label>
              <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Event group</Label>
                <Select value={editEventGroup} onValueChange={(value) => setEditEventGroup(value as EventGroup)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EVENT_GROUP_OPTIONS.map((group) => (
                      <SelectItem key={group} value={group}>{group}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Lead coach</Label>
                <Select value={editLeadCoachUserId} onValueChange={setEditLeadCoachUserId}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {coachOptions.map((coach) => (
                      <SelectItem key={coach.userId} value={coach.userId}>{coach.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="border-slate-200" onClick={() => setEditTeamId(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={saving || !editName.trim()} onClick={() => void handleSaveEdit()}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(inviteTeamId)} onOpenChange={(open) => (!open ? setInviteTeamId(null) : undefined)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate athlete invite</DialogTitle>
            <DialogDescription>
              Athlete invites are email-addressed so PaceLab can decide whether to sign in or create the athlete account automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Athlete email</Label>
              <Input
                type="email"
                placeholder="athlete@email.com"
                value={athleteInviteEmail}
                onChange={(event) => setAthleteInviteEmail(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="border-slate-200" onClick={() => setInviteTeamId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={inviteSaving || !inviteTeamId || !athleteInviteEmail.trim()}
              onClick={async () => {
                if (!inviteTeamId) return
                setInviteSaving(true)
                await handleGenerateInvite(inviteTeamId)
                setInviteSaving(false)
                setInviteTeamId(null)
              }}
            >
              {inviteSaving ? "Generating..." : "Generate invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
