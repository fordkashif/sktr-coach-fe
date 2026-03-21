"use client"

import { useEffect, useState } from "react"
import { ClubAdminNav } from "@/components/club-admin/admin-nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  createCoachInvite,
  createUserProvisioningInvite,
  getClubAdminOpsSnapshot,
  insertAuditEvent,
  reviewAccountRequest,
  updateProfileRoleAndStatus,
  type ClubAdminAccountRequest,
  type ClubAdminInvite,
  type ClubAdminTeamOption,
  type ClubAdminUser,
} from "@/lib/data/club-admin/ops-data"
import { logAuditEvent } from "@/lib/mock-audit"
import type { AccountRequest, ClubUser, CoachInvite, UserRole } from "@/lib/mock-club-admin"
import { getBackendMode } from "@/lib/supabase/config"
import {
  loadAccountRequestsSafe,
  loadInvitesSafe,
  loadTeamsSafe,
  loadUsersSafe,
  persistAccountRequests,
  persistInvites,
  persistUsers,
} from "../state"
import { cn } from "@/lib/utils"

export default function ClubAdminUsersPage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const [users, setUsers] = useState<ClubUser[]>(() => (isSupabaseMode ? [] : loadUsersSafe()))
  const [invites, setInvites] = useState<CoachInvite[]>(() => (isSupabaseMode ? [] : loadInvitesSafe()))
  const [accountRequests, setAccountRequests] = useState<AccountRequest[]>(() =>
    isSupabaseMode ? [] : loadAccountRequestsSafe(),
  )
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<UserRole>("athlete")
  const [teamId, setTeamId] = useState<string>("none")
  const [coachInviteEmail, setCoachInviteEmail] = useState("")
  const [coachInviteTeamId, setCoachInviteTeamId] = useState<string>("none")
  const [teams, setTeams] = useState(() => (isSupabaseMode ? [] : loadTeamsSafe()))
  const [backendLoading, setBackendLoading] = useState(isSupabaseMode)
  const [backendError, setBackendError] = useState<string | null>(null)

  const saveUsers = (next: ClubUser[]) => {
    setUsers(next)
    if (backendMode !== "supabase") persistUsers(next)
  }

  const saveAccountRequests = (next: AccountRequest[]) => {
    setAccountRequests(next)
    if (backendMode !== "supabase") persistAccountRequests(next)
  }

  const emitAudit = async (action: string, target: string, detail?: string) => {
    if (backendMode === "supabase") {
      const result = await insertAuditEvent({ action, target, detail })
      if (!result.ok) setBackendError((current) => current ?? result.error.message)
      return
    }
    logAuditEvent({ actor: "club-admin", action, target, detail })
  }

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false

    const loadSnapshot = async () => {
      setBackendLoading(true)
      const result = await getClubAdminOpsSnapshot()
      if (cancelled) return
      if (!result.ok) {
        setBackendError(result.error.message)
        setBackendLoading(false)
        return
      }

      setBackendError(null)
      setUsers(
        result.data.users.map((row: ClubAdminUser) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          status: row.status,
          teamId: row.teamId,
        })),
      )
      setInvites(
        result.data.invites.map((row: ClubAdminInvite) => ({
          id: row.id,
          email: row.email,
          teamId: row.teamId,
          status: row.status === "revoked" ? "expired" : row.status,
          createdAt: row.createdAt,
          inviteUrl: row.inviteUrl ?? `/invite/coach/${row.id}`,
        })),
      )
      setAccountRequests(
        result.data.accountRequests.map((row: ClubAdminAccountRequest) => ({
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
      setTeams(result.data.teams.map((row: ClubAdminTeamOption) => ({ id: row.id, name: row.name, eventGroup: "Sprint", status: "active" })))
      setBackendLoading(false)
    }

    void loadSnapshot()
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="page-intro">
        <div className="space-y-3">
          <div>
            <h1 className="page-intro-title">Users & Roles</h1>
            <p className="page-intro-copy">Create users, review club admin requests, send coach invites, and control access.</p>
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
          Loading users and access controls...
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Create User</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Manual Provisioning</h2>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" placeholder="Full name" value={name} onChange={(event) => setName(event.target.value)} />
            <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" placeholder="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
              <SelectTrigger className="h-12 rounded-[16px] border-slate-200 bg-slate-50"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="club-admin">Club Admin</SelectItem>
                <SelectItem value="coach">Coach</SelectItem>
                <SelectItem value="athlete">Athlete</SelectItem>
              </SelectContent>
            </Select>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger className="h-12 rounded-[16px] border-slate-200 bg-slate-50"><SelectValue placeholder="Team" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No team</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              className="h-12 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
              onClick={async () => {
                if (!name.trim() || !email.trim()) return
                if (backendMode === "supabase") {
                  const inviteResult = await createUserProvisioningInvite({
                    email: email.trim().toLowerCase(),
                    role,
                    displayName: name.trim(),
                    teamId: teamId !== "none" ? teamId : undefined,
                  })
                  if (!inviteResult.ok) {
                    setBackendError(inviteResult.error.message)
                    return
                  }
                    setInvites((current) => [
                      {
                        id: inviteResult.data.id,
                        email: inviteResult.data.email,
                        teamId: inviteResult.data.teamId,
                        status: inviteResult.data.status === "revoked" ? "expired" : inviteResult.data.status,
                        createdAt: inviteResult.data.createdAt,
                        inviteUrl: inviteResult.data.inviteUrl,
                      },
                      ...current,
                    ])
                  await emitAudit("user_provision_invite", inviteResult.data.email, `${role}${teamId !== "none" ? ` (${teamId})` : ""}`)
                  setName("")
                  setEmail("")
                  setTeamId("none")
                  return
                }
                const next: ClubUser = {
                  id: `u-${Date.now()}`,
                  name: name.trim(),
                  email: email.trim().toLowerCase(),
                  role,
                  status: "active",
                  teamId: teamId !== "none" ? teamId : undefined,
                }
                saveUsers([next, ...users])
                await emitAudit("user_create", next.email, `${next.role}${next.teamId ? ` (${next.teamId})` : ""}`)
                setName("")
                setEmail("")
                setTeamId("none")
              }}
            >
              Create
            </Button>
          </div>
        </div>

        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Coach Invites</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Send Invite</h2>
          </div>
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                className="h-12 rounded-[16px] border-slate-200 bg-slate-50 sm:col-span-1"
                type="email"
                placeholder="coach@email.com"
                value={coachInviteEmail}
                onChange={(event) => setCoachInviteEmail(event.target.value)}
              />
              <Select value={coachInviteTeamId} onValueChange={setCoachInviteTeamId}>
                <SelectTrigger className="h-12 rounded-[16px] border-slate-200 bg-slate-50 sm:col-span-1"><SelectValue placeholder="Team assignment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No team</SelectItem>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                className="h-12 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
                onClick={async () => {
                  if (!coachInviteEmail.trim()) return
                  if (backendMode === "supabase") {
                    const result = await createCoachInvite({
                      email: coachInviteEmail.trim().toLowerCase(),
                      teamId: coachInviteTeamId !== "none" ? coachInviteTeamId : undefined,
                    })
                    if (!result.ok) {
                      setBackendError(result.error.message)
                      return
                    }
                    setInvites((current) => [
                      {
                        id: result.data.id,
                        email: result.data.email,
                        teamId: result.data.teamId,
                        status: result.data.status === "revoked" ? "expired" : result.data.status,
                        createdAt: result.data.createdAt,
                        inviteUrl: result.data.inviteUrl,
                      },
                      ...current,
                    ])
                    await emitAudit(
                      "coach_invite_send",
                      coachInviteEmail.trim().toLowerCase(),
                      coachInviteTeamId !== "none" ? `team ${coachInviteTeamId}` : "no team",
                    )
                    setCoachInviteEmail("")
                    setCoachInviteTeamId("none")
                    return
                  }

                  const next = [
                    {
                      id: `invite-${Date.now()}`,
                      email: coachInviteEmail.trim().toLowerCase(),
                      teamId: coachInviteTeamId !== "none" ? coachInviteTeamId : undefined,
                      status: "pending" as const,
                      createdAt: new Date().toISOString().slice(0, 10),
                    },
                    ...invites,
                  ]
                  setInvites(next)
                  persistInvites(next)
                  await emitAudit(
                    "coach_invite_send",
                    coachInviteEmail.trim().toLowerCase(),
                    coachInviteTeamId !== "none" ? `team ${coachInviteTeamId}` : "no team",
                  )
                  setCoachInviteEmail("")
                  setCoachInviteTeamId("none")
                }}
              >
                Send invite
              </Button>
            </div>
            <div className="space-y-2">
              {invites.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  No coach invites yet.
                </div>
              ) : (
                invites.map((invite) => (
                  <div key={invite.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    <div>
                      <span className="font-medium text-slate-950">{invite.email}</span> | {invite.status} | {invite.teamId ?? "No team"}
                    </div>
                    {invite.inviteUrl ? (
                      <div className="mt-2 flex items-center gap-2">
                        <code className="rounded bg-white px-2 py-1 text-xs text-slate-700">{invite.inviteUrl}</code>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 rounded-full px-3 text-xs"
                          onClick={() => {
                            const absoluteUrl = `${window.location.origin}${invite.inviteUrl}`
                            void navigator.clipboard.writeText(absoluteUrl)
                          }}
                        >
                          Copy link
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Club Admin Requests</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Approval Queue</h2>
          </div>
          <div className="mt-4 space-y-3">
            {accountRequests.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No pending club admin account requests.
              </div>
            ) : (
              accountRequests.map((request) => (
                <div key={request.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-950">{request.fullName}</p>
                      <p className="text-sm text-slate-500">{request.email}</p>
                      <p className="text-sm text-slate-500">{request.organization} | Club Admin | {request.status}</p>
                      <p className="text-xs text-slate-500">Requested {new Date(request.createdAt).toLocaleDateString()}</p>
                      {request.notes ? <p className="text-sm text-slate-500">{request.notes}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-full border-slate-200 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950"
                        disabled={request.status !== "pending"}
                        onClick={async () => {
                          if (backendMode === "supabase") {
                            const result = await reviewAccountRequest({ requestId: request.id, status: "approved" })
                            if (!result.ok) {
                              setBackendError(result.error.message)
                              return
                            }
                            saveAccountRequests(
                              accountRequests.map((item) =>
                                item.id === request.id ? { ...item, status: "approved", reviewedAt: new Date().toISOString() } : item,
                              ),
                            )
                            await emitAudit("account_request_approve", request.email, request.role)
                            return
                          }

                          const nextUser: ClubUser = {
                            id: `u-${Date.now()}`,
                            name: request.fullName,
                            email: request.email,
                            role: request.role,
                            status: "active",
                          }
                          saveUsers([nextUser, ...users])
                          saveAccountRequests(
                            accountRequests.map((item) =>
                              item.id === request.id ? { ...item, status: "approved", reviewedAt: new Date().toISOString() } : item,
                            ),
                          )
                          await emitAudit("account_request_approve", request.email, request.role)
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-full border-slate-200 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950"
                        disabled={request.status !== "pending"}
                        onClick={async () => {
                          if (backendMode === "supabase") {
                            const result = await reviewAccountRequest({ requestId: request.id, status: "declined" })
                            if (!result.ok) {
                              setBackendError(result.error.message)
                              return
                            }
                            saveAccountRequests(
                              accountRequests.map((item) =>
                                item.id === request.id ? { ...item, status: "declined", reviewedAt: new Date().toISOString() } : item,
                              ),
                            )
                            await emitAudit("account_request_decline", request.email, request.role)
                            return
                          }

                          saveAccountRequests(
                            accountRequests.map((item) =>
                              item.id === request.id ? { ...item, status: "declined", reviewedAt: new Date().toISOString() } : item,
                            ),
                          )
                          await emitAudit("account_request_decline", request.email, request.role)
                        }}
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">User Directory</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Access Control</h2>
          </div>
          <div className="mt-4 space-y-3">
            {users.map((user) => (
              <div key={user.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-950">{user.name}</p>
                    <p className="text-sm text-slate-500">{user.email}</p>
                    <p className="text-sm text-slate-500">{user.teamId ?? "No team"}</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[150px_120px_auto] sm:items-center">
                    <Select
                      value={user.role}
                      onValueChange={async (value) => {
                        if (backendMode === "supabase") {
                          const result = await updateProfileRoleAndStatus({
                            userId: user.id,
                            role: value as UserRole,
                            status: user.status,
                          })
                          if (!result.ok) {
                            setBackendError(result.error.message)
                            return
                          }
                          const next = users.map((item) => (item.id === user.id ? { ...item, role: value as UserRole } : item))
                          saveUsers(next)
                          await emitAudit("role_assign", user.email, `role ${value}`)
                          return
                        }

                        const next = users.map((item) => (item.id === user.id ? { ...item, role: value as UserRole } : item))
                        saveUsers(next)
                        await emitAudit("role_assign", user.email, `role ${value}`)
                      }}
                    >
                      <SelectTrigger className="h-11 rounded-[16px] border-slate-200 bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="club-admin">Club Admin</SelectItem>
                        <SelectItem value="coach">Coach</SelectItem>
                        <SelectItem value="athlete">Athlete</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className={cn(
                      "inline-flex h-11 items-center justify-center rounded-full px-3 text-sm font-semibold capitalize",
                      user.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700",
                    )}>
                      {user.status}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="mobile-action-secondary"
                      onClick={async () => {
                        if (backendMode === "supabase") {
                          const nextStatus = (user.status === "active" ? "disabled" : "active") as ClubUser["status"]
                          const result = await updateProfileRoleAndStatus({
                            userId: user.id,
                            role: user.role,
                            status: nextStatus,
                          })
                          if (!result.ok) {
                            setBackendError(result.error.message)
                            return
                          }
                          const next = users.map((item) => (item.id === user.id ? { ...item, status: nextStatus } : item))
                          saveUsers(next)
                          await emitAudit(nextStatus === "disabled" ? "user_disable" : "user_enable", user.email)
                          return
                        }

                        const next = users.map((item) =>
                          item.id === user.id ? { ...item, status: (item.status === "active" ? "disabled" : "active") as ClubUser["status"] } : item,
                        )
                        saveUsers(next)
                        await emitAudit(user.status === "active" ? "user_disable" : "user_enable", user.email)
                      }}
                    >
                      {user.status === "active" ? "Disable" : "Enable"}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
