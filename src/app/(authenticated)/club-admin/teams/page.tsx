"use client"

import { useEffect, useState } from "react"
import { ClubAdminNav } from "@/components/club-admin/admin-nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  getClubAdminAssignableCoachOptions,
  createClubAdminTeam,
  getClubAdminTeamsSnapshot,
  insertAuditEvent,
  setClubAdminTeamArchived,
  setClubAdminTeamLeadCoach,
  type ClubAdminAssignableCoachOption,
  updateClubAdminTeam,
} from "@/lib/data/club-admin/ops-data"
import type { ClubTeam } from "@/lib/mock-club-admin"
import type { EventGroup } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"
import { cn } from "@/lib/utils"
import { loadTeamsSafe, loadUsersSafe, persistTeams } from "../state"

const groups: EventGroup[] = ["Sprint", "Mid", "Distance", "Jumps", "Throws"]
const groupTones: Record<EventGroup, string> = {
  Sprint: "bg-[#dbeafe] text-[#1d4ed8]",
  Mid: "bg-[#ede9fe] text-[#6d28d9]",
  Distance: "bg-[#dcfce7] text-[#15803d]",
  Jumps: "bg-[#fef3c7] text-[#b45309]",
  Throws: "bg-[#fee2e2] text-[#b91c1c]",
}

function toEventGroup(value: string | null | undefined): EventGroup {
  if (!value) return "Sprint"
  return groups.includes(value as EventGroup) ? (value as EventGroup) : "Sprint"
}

export default function ClubAdminTeamsPage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const initialMockAssignableCoaches: ClubAdminAssignableCoachOption[] = loadUsersSafe()
    .filter((user) => user.status === "active" && (user.role === "coach" || user.role === "club-admin"))
    .map((user) => ({
      userId: user.id,
      name: user.name,
      email: user.email,
      label: user.role === "club-admin" ? `Assign self (${user.email})` : `${user.name} (${user.email})`,
      isSelf: user.role === "club-admin",
    }))
    .sort((left, right) => Number(left.isSelf) - Number(right.isSelf))

  const [teams, setTeams] = useState<ClubTeam[]>(() => (isSupabaseMode ? [] : loadTeamsSafe()))
  const [name, setName] = useState("")
  const [eventGroup, setEventGroup] = useState<EventGroup>("Sprint")
  const [leadCoachSelection, setLeadCoachSelection] = useState("none")
  const [assignableCoaches, setAssignableCoaches] = useState<ClubAdminAssignableCoachOption[]>(
    () => (isSupabaseMode ? [] : initialMockAssignableCoaches),
  )
  const [backendLoading, setBackendLoading] = useState(isSupabaseMode)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [mockAuditLogger, setMockAuditLogger] = useState<((event: {
    actor: string
    action: string
    target: string
    detail?: string
  }) => void) | null>(null)

  const saveTeams = (next: ClubTeam[]) => {
    setTeams(next)
    if (!isSupabaseMode) persistTeams(next)
  }

  const emitAudit = async (action: string, target: string, detail?: string) => {
    if (isSupabaseMode) {
      const result = await insertAuditEvent({ action, target, detail })
      if (!result.ok) setBackendError((current) => current ?? result.error.message)
      return
    }
    mockAuditLogger?.({ actor: "club-admin", action, target, detail })
  }

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false

    const load = async () => {
      setBackendLoading(true)
      const [teamsResult, coachesResult] = await Promise.all([
        getClubAdminTeamsSnapshot(),
        getClubAdminAssignableCoachOptions(),
      ])
      if (cancelled) return

      if (!teamsResult.ok) {
        setBackendError(teamsResult.error.message)
        setBackendLoading(false)
        return
      }
      if (!coachesResult.ok) {
        setBackendError(coachesResult.error.message)
        setBackendLoading(false)
        return
      }

      setTeams(
        teamsResult.data.map((team) => ({
          id: team.id,
          name: team.name,
          eventGroup: toEventGroup(team.eventGroup),
          status: team.status,
          coachEmail: team.leadCoachLabel,
        })),
      )
      setAssignableCoaches(coachesResult.data)
      setBackendError(null)
      setBackendLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  useEffect(() => {
    if (isSupabaseMode) return
    let cancelled = false

    void import("@/lib/mock-audit").then((module) => {
      if (!cancelled) {
        setMockAuditLogger(() => module.logAuditEvent)
      }
    })

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  const selectedLeadCoach = assignableCoaches.find((option) => option.userId === leadCoachSelection)
  const resolvedLeadCoachLabel =
    leadCoachSelection === "none"
      ? undefined
      : selectedLeadCoach?.isSelf
        ? `${selectedLeadCoach.name}${selectedLeadCoach.email ? ` (${selectedLeadCoach.email})` : ""}`
        : selectedLeadCoach?.email || selectedLeadCoach?.name

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="page-intro">
        <div className="space-y-3">
          <div>
            <h1 className="page-intro-title">Team Management</h1>
            <p className="page-intro-copy">Create teams, assign lead coaches, and maintain active or archived team status.</p>
          </div>
          <ClubAdminNav />
        </div>
      </section>

      {backendError ? (
        <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Backend sync issue: {backendError}
        </section>
      ) : null}
      {isSupabaseMode && backendLoading ? (
        <section className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          Loading teams...
        </section>
      ) : null}

      <section className="mobile-card-primary">
        <div className="space-y-1 border-b border-slate-200 pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Create Team</p>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Provision New Group</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-950">Team name</Label>
            <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" value={name} onChange={(event) => setName(event.target.value)} placeholder="Sprint Group B" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-950">Event group</Label>
            <Select value={eventGroup} onValueChange={(value) => setEventGroup(value as EventGroup)}>
              <SelectTrigger className="h-12 w-full rounded-[16px] border-slate-200 bg-slate-50"><SelectValue /></SelectTrigger>
              <SelectContent>
                {groups.map((group) => (
                  <SelectItem key={group} value={group}>{group}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-950">Lead coach</Label>
            <Select value={leadCoachSelection} onValueChange={setLeadCoachSelection}>
              <SelectTrigger className="h-12 w-full rounded-[16px] border-slate-200 bg-slate-50">
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
              className="h-12 w-full rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
              onClick={async () => {
                if (!name.trim()) return

                if (isSupabaseMode) {
                  const result = await createClubAdminTeam({
                    name: name.trim(),
                    eventGroup,
                    leadCoachUserId: leadCoachSelection === "none" ? null : leadCoachSelection,
                    leadCoachLabel: resolvedLeadCoachLabel ?? null,
                  })
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
                      coachEmail: result.data.leadCoachLabel,
                    },
                    ...current,
                  ])
                  await emitAudit(
                    "team_create",
                    result.data.name,
                    `${eventGroup}${result.data.leadCoachLabel ? ` (${result.data.leadCoachLabel})` : ""}`,
                  )
                  setName("")
                  setLeadCoachSelection("none")
                  return
                }

                const next: ClubTeam = {
                  id: `t-${Date.now()}`,
                  name: name.trim(),
                  eventGroup,
                  status: "active",
                  coachEmail: resolvedLeadCoachLabel,
                }
                saveTeams([next, ...teams])
                await emitAudit(
                  "team_create",
                  next.name,
                  `${next.eventGroup}${next.coachEmail ? ` (${next.coachEmail})` : ""}`,
                )
                setName("")
                setLeadCoachSelection("none")
              }}
            >
              Create
            </Button>
          </div>
        </div>
      </section>

      <section className="mobile-card-primary">
        <div className="space-y-1 border-b border-slate-200 pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Manage Teams</p>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Current Groups</h2>
        </div>
        <div className="mt-4 space-y-3">
          {teams.map((team) => (
            <div key={team.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="grid gap-3 sm:grid-cols-3 xl:flex-1">
                  <Input
                    className="h-11 rounded-[16px] border-slate-200 bg-white"
                    value={team.name}
                    onChange={async (event) => {
                      const nextName = event.target.value
                      const next = teams.map((item) => (item.id === team.id ? { ...item, name: nextName } : item))
                      saveTeams(next)

                      if (isSupabaseMode) {
                        const result = await updateClubAdminTeam({
                          teamId: team.id,
                          name: nextName,
                          eventGroup: team.eventGroup,
                        })
                        if (!result.ok) setBackendError((current) => current ?? result.error.message)
                      }
                    }}
                  />
                  <Select
                    value={team.eventGroup}
                    onValueChange={async (value) => {
                      const nextGroup = value as EventGroup
                      const next = teams.map((item) => (item.id === team.id ? { ...item, eventGroup: nextGroup } : item))
                      saveTeams(next)

                      if (isSupabaseMode) {
                        const result = await updateClubAdminTeam({
                          teamId: team.id,
                          name: team.name,
                          eventGroup: nextGroup,
                        })
                        if (!result.ok) setBackendError((current) => current ?? result.error.message)
                      }
                    }}
                  >
                    <SelectTrigger className="h-11 w-full rounded-[16px] border-slate-200 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {groups.map((group) => (
                        <SelectItem key={group} value={group}>{group}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={assignableCoaches.find((coach) => {
                      const selfLabel = coach.isSelf
                        ? `${coach.name}${coach.email ? ` (${coach.email})` : ""}`
                        : coach.email || coach.name
                      return team.coachEmail === selfLabel
                    })?.userId ?? "none"}
                    onValueChange={async (value) => {
                      const selectedCoach = assignableCoaches.find((coach) => coach.userId === value)
                      const nextCoachLabel =
                        value === "none"
                          ? undefined
                          : selectedCoach?.isSelf
                            ? `${selectedCoach.name}${selectedCoach.email ? ` (${selectedCoach.email})` : ""}`
                            : selectedCoach?.email || selectedCoach?.name
                      const next = teams.map((item) => (item.id === team.id ? { ...item, coachEmail: nextCoachLabel } : item))
                      saveTeams(next)

                      if (isSupabaseMode) {
                        const result = await setClubAdminTeamLeadCoach({
                          teamId: team.id,
                          leadCoachUserId: value === "none" ? null : value,
                        })
                        if (!result.ok) setBackendError((current) => current ?? result.error.message)
                      }
                    }}
                  >
                    <SelectTrigger className="h-11 w-full rounded-[16px] border-slate-200 bg-white">
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
                <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                  <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", groupTones[team.eventGroup])}>
                    {team.eventGroup}
                  </span>
                  {(() => {
                    const selfCoachOption = assignableCoaches.find((option) => option.isSelf)
                    if (!team.coachEmail || !selfCoachOption) return null
                    const selfCoachDisplayLabel = `${selfCoachOption.name}${selfCoachOption.email ? ` (${selfCoachOption.email})` : ""}`
                    if (team.coachEmail !== selfCoachDisplayLabel) return null
                    return (
                    <span className="inline-flex rounded-full bg-[#eef5ff] px-2.5 py-1 text-xs font-semibold text-[#1368ff]">
                      Assigned to me
                    </span>
                    )
                  })()}
                  <span className={cn(
                    "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize",
                    team.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700",
                  )}>
                    {team.status}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="mobile-action-secondary"
                    onClick={async () => {
                      const nextStatus = (team.status === "active" ? "archived" : "active") as ClubTeam["status"]
                      const next = teams.map((item) => (item.id === team.id ? { ...item, status: nextStatus } : item))
                      saveTeams(next)

                      if (isSupabaseMode) {
                        const result = await setClubAdminTeamArchived({
                          teamId: team.id,
                          archived: nextStatus === "archived",
                        })
                        if (!result.ok) {
                          setBackendError((current) => current ?? result.error.message)
                          return
                        }
                      }

                      await emitAudit(nextStatus === "archived" ? "team_archive" : "team_restore", team.id)
                    }}
                  >
                    {team.status === "active" ? "Archive" : "Restore"}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
