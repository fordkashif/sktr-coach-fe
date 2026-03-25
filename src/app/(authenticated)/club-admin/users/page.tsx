"use client"

import { useEffect, useState } from "react"
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
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useClubAdmin } from "@/lib/club-admin-context"
import {
  createCoachInvite,
  insertAuditEvent,
  updateProfileRoleAndStatus,
} from "@/lib/data/club-admin/ops-data"
import type { ClubUser, CoachInvite, UserRole } from "@/lib/mock-club-admin"
import { getBackendMode } from "@/lib/supabase/config"
import {
  loadInvitesSafe,
  loadTeamsSafe,
  loadUsersSafe,
  persistInvites,
  persistUsers,
} from "../state"
import { cn } from "@/lib/utils"

export default function ClubAdminUsersPage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const clubAdmin = useClubAdmin()
  const isLocalPreviewEnabled =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  const [users, setUsers] = useState<ClubUser[]>(() => (isSupabaseMode ? [] : loadUsersSafe()))
  const [invites, setInvites] = useState<CoachInvite[]>(() => (isSupabaseMode ? [] : loadInvitesSafe()))
  const [coachInviteEmail, setCoachInviteEmail] = useState("")
  const [coachInviteTeamId, setCoachInviteTeamId] = useState<string>("none")
  const [inviteComposerOpen, setInviteComposerOpen] = useState(false)
  const [useDesktopInviteDialog, setUseDesktopInviteDialog] = useState(false)
  const [teams, setTeams] = useState(() => (isSupabaseMode ? [] : loadTeamsSafe()))
  const [backendLoading, setBackendLoading] = useState(isSupabaseMode && !clubAdmin.opsSnapshot)
  const [backendError, setBackendError] = useState<string | null>(clubAdmin.opsError)
  const [mockAuditLogger, setMockAuditLogger] = useState<((event: {
    actor: string
    action: string
    target: string
    detail?: string
  }) => void) | null>(null)

  const saveUsers = (next: ClubUser[]) => {
    setUsers(next)
    if (backendMode !== "supabase") persistUsers(next)
  }

  const emitAudit = async (action: string, target: string, detail?: string) => {
    if (backendMode === "supabase") {
      const result = await insertAuditEvent({ action, target, detail })
      if (!result.ok) setBackendError((current) => current ?? result.error.message)
      return
    }
    mockAuditLogger?.({ actor: "club-admin", action, target, detail })
  }

  useEffect(() => {
    if (!isSupabaseMode) return
    setBackendLoading(clubAdmin.opsLoading)
    setBackendError(clubAdmin.opsError)
    if (!clubAdmin.opsSnapshot) return

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
        inviteUrl: row.inviteUrl ?? `/invite/coach/${row.id}`,
      })),
    )
    setTeams(
      clubAdmin.opsSnapshot.teams.map((row) => ({
        id: row.id,
        name: row.name,
        eventGroup: "Sprint",
        status: "active",
      })),
    )
  }, [clubAdmin.opsError, clubAdmin.opsLoading, clubAdmin.opsSnapshot, isSupabaseMode])

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

  useEffect(() => {
    if (typeof window === "undefined") return

    const mediaQuery = window.matchMedia("(min-width: 640px)")
    const sync = () => setUseDesktopInviteDialog(mediaQuery.matches)

    sync()
    mediaQuery.addEventListener("change", sync)
    return () => mediaQuery.removeEventListener("change", sync)
  }, [])

  const handleSendCoachInvite = async () => {
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
      setInviteComposerOpen(false)
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
    setInviteComposerOpen(false)
  }

  const inviteComposer = (
    <div className="space-y-4">
      <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
        Club admins can invite users into the tenant, but they should never create user accounts manually. Account creation begins from the invite flow only.
      </div>
      <div className="space-y-3">
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-950">Coach email</label>
          <Input
            className="h-12 rounded-[16px] border-slate-200 bg-slate-50"
            type="email"
            placeholder="coach@email.com"
            value={coachInviteEmail}
            onChange={(event) => setCoachInviteEmail(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-950">Team assignment</label>
          <Select value={coachInviteTeamId} onValueChange={setCoachInviteTeamId}>
            <SelectTrigger className="h-12 rounded-[16px] border-slate-200 bg-slate-50">
              <SelectValue placeholder="Team assignment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No team</SelectItem>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-8xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="px-1 py-1 sm:px-2 lg:px-3">
        <div className="space-y-4">
          <h1 className="max-w-[14ch] text-[clamp(2.2rem,5vw,4.75rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-slate-950">
            Invite and access control.
          </h1>
          <p className="max-w-[60ch] text-sm leading-7 text-slate-600 sm:text-base">
            Send invites and manage active user access. Club admins should never provision accounts manually.
          </p>
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

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] xl:items-start">
        <div className="mobile-card-primary">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Invite Access</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Send coach invite</h2>
              <p className="text-sm text-slate-500">Start coach access from an invite instead of exposing the form inline on the page.</p>
            </div>
            <div className="shrink-0">
              {useDesktopInviteDialog ? (
                <Dialog open={inviteComposerOpen} onOpenChange={setInviteComposerOpen}>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
                    >
                      New invite
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader className="text-left">
                      <DialogTitle>Send coach invite</DialogTitle>
                      <DialogDescription>
                        Invite a coach into this tenant and optionally attach the invite to a team.
                      </DialogDescription>
                    </DialogHeader>
                    {inviteComposer}
                    <DialogFooter className="gap-3 sm:justify-start">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-full border-slate-200"
                        onClick={() => setInviteComposerOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
                        onClick={() => void handleSendCoachInvite()}
                      >
                        Send invite
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : (
                <Drawer open={inviteComposerOpen} onOpenChange={setInviteComposerOpen}>
                  <DrawerTrigger asChild>
                    <Button
                      type="button"
                      className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
                    >
                      New invite
                    </Button>
                  </DrawerTrigger>
                  <DrawerContent className="max-h-[88dvh]">
                    <DrawerHeader className="text-left">
                      <DrawerTitle>Send coach invite</DrawerTitle>
                      <DrawerDescription>
                        Invite a coach into this tenant and optionally attach the invite to a team.
                      </DrawerDescription>
                    </DrawerHeader>
                    <div className="px-4 pb-2">{inviteComposer}</div>
                    <DrawerFooter className="gap-3">
                      <Button
                        type="button"
                        className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
                        onClick={() => void handleSendCoachInvite()}
                      >
                        Send invite
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-full border-slate-200"
                        onClick={() => setInviteComposerOpen(false)}
                      >
                        Cancel
                      </Button>
                    </DrawerFooter>
                  </DrawerContent>
                </Drawer>
              )}
            </div>
          </div>
          <div className="mt-4 space-y-3">
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
                        {isLocalPreviewEnabled ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 rounded-full px-3 text-xs"
                            onClick={() => {
                              const absoluteUrl = `${window.location.origin}${invite.inviteUrl}`
                              window.open(absoluteUrl, "_blank", "noopener,noreferrer")
                            }}
                          >
                            Open invite
                          </Button>
                        ) : null}
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
