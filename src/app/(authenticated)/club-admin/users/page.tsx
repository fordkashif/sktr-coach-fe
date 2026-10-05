"use client"

import { Check, Copy, EnvelopeSimple, MagnifyingGlass, Tray, UserPlus, UsersThree, X } from "@phosphor-icons/react"
import { Fragment, useEffect, useMemo, useState } from "react"
import { EmptyState, Initials, PageHeader, Panel, Segmented, Tag, type TagTone } from "@/components/sk"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useClubAdmin } from "@/lib/club-admin-context"
import {
  COACH_INVITE_VALID_DAYS,
  createCoachInvite,
  getClubAdminPackageUpgradeRequests,
  getClubAdminPeopleDirectory,
  getCurrentClubAdminActivationState,
  insertAuditEvent,
  reviewAccountRequest,
  revokeCoachInvite,
  submitClubAdminPackageUpgradeRequest,
  updateProfileRoleAndStatus,
  type ClubAdminPeopleDirectory,
} from "@/lib/data/club-admin/ops-data"
import { getNextPackageTier, getPackageById, type PackageId } from "@/lib/billing/package-catalog"
import type { AccountRequest, ClubTeam, ClubUser, CoachInvite, UserRole } from "@/lib/mock-club-admin"
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

type Section = "people" | "invites" | "requests"

type Confirm =
  | { kind: "role"; userId: string; role: UserRole }
  | { kind: "deactivate"; userId: string }
  | { kind: "cancel-invite"; inviteId: string }
  | { kind: "decline"; requestId: string }

const ROLE_LABEL: Record<UserRole, string> = {
  "club-admin": "Club admin",
  coach: "Coach",
  athlete: "Athlete",
}

const ROLE_CHANGE_EFFECT: Record<UserRole, string> = {
  "club-admin": "They will be able to manage people, teams and billing for the whole club.",
  coach: "They will work with the teams they are assigned to.",
  athlete: "They lose staff access to teams, plans and reports.",
}

const INVITE_STATUS: Record<CoachInvite["status"], { label: string; tone: TagTone }> = {
  pending: { label: "Waiting", tone: "yellow" },
  accepted: { label: "Joined", tone: "green" },
  expired: { label: "Expired", tone: "coral" },
  revoked: { label: "Cancelled", tone: "plain" },
}

const REQUEST_STATUS: Record<AccountRequest["status"], { label: string; tone: TagTone }> = {
  pending: { label: "Waiting", tone: "yellow" },
  approved: { label: "Approved", tone: "green" },
  declined: { label: "Declined", tone: "plain" },
}

const MOCK_USER_EMAIL_STORAGE_KEY = "pacelab:mock-user-email"
const alertClass = "rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]"

function toAbsoluteLink(path: string) {
  return typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function shortDate(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function withExpiry(invite: CoachInvite): CoachInvite {
  if (invite.status === "pending" && invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    return { ...invite, status: "expired" }
  }
  return invite
}

export default function ClubAdminUsersPage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const clubAdmin = useClubAdmin()
  const isLocalPreviewEnabled =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")

  const [users, setUsers] = useState<ClubUser[]>(() => (isSupabaseMode ? [] : loadUsersSafe()))
  const [invites, setInvites] = useState<CoachInvite[]>(() => (isSupabaseMode ? [] : loadInvitesSafe().map(withExpiry)))
  const [requests, setRequests] = useState<AccountRequest[]>(() => (isSupabaseMode ? [] : loadAccountRequestsSafe()))
  const [teams, setTeams] = useState<Array<Pick<ClubTeam, "id" | "name" | "coachUserId" | "coachUserIds">>>(() =>
    isSupabaseMode ? [] : loadTeamsSafe().filter((team) => team.status !== "archived"),
  )
  const [directory, setDirectory] = useState<ClubAdminPeopleDirectory | null>(null)
  const [mockUserEmail] = useState(() =>
    isSupabaseMode || typeof window === "undefined" ? null : window.localStorage.getItem(MOCK_USER_EMAIL_STORAGE_KEY),
  )

  const [section, setSection] = useState<Section>("people")
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all")
  const [statusFilter, setStatusFilter] = useState<"all" | ClubUser["status"]>("all")
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteTeamId, setInviteTeamId] = useState("none")
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [createdInvite, setCreatedInvite] = useState<{ email: string; link: string } | null>(null)
  const [createdCopied, setCreatedCopied] = useState(false)

  const [requestedPlan, setRequestedPlan] = useState<PackageId | null>(null)
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false)
  const [upgradeReason, setUpgradeReason] = useState("")
  const [upgradeSaving, setUpgradeSaving] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)
  const [pendingUpgradeRequest, setPendingUpgradeRequest] = useState<{ requestedPackage: PackageId; createdAt: string } | null>(null)

  const [backendLoading, setBackendLoading] = useState(isSupabaseMode && !clubAdmin.opsSnapshot)
  const [backendError, setBackendError] = useState<string | null>(clubAdmin.opsError)
  const [mockAuditLogger, setMockAuditLogger] = useState<((event: {
    actor: string
    action: string
    target: string
    detail?: string
  }) => void) | null>(null)

  const { opsSnapshot, opsLoading, opsError, refreshOpsSnapshot } = clubAdmin

  const emitAudit = async (action: string, target: string, detail?: string) => {
    if (backendMode === "supabase") {
      const result = await insertAuditEvent({ action, target, detail })
      if (!result.ok) setBackendError((current) => current ?? `The change was saved, but the audit log entry failed: ${result.error.message}`)
      return
    }
    mockAuditLogger?.({ actor: "club-admin", action, target, detail })
  }

  /** The club admin context caches the snapshot, so refresh it after every change or other screens show stale people. */
  const syncBackend = () => {
    if (isSupabaseMode) void refreshOpsSnapshot()
  }

  useEffect(() => {
    if (!isSupabaseMode) return
    setBackendLoading(opsLoading && !opsSnapshot)
    if (opsError) setBackendError(opsError)
    if (!opsSnapshot) return

    setUsers(
      opsSnapshot.users.map((row) => ({
        id: row.id,
        name: row.name,
        // Profiles do not store an email. Known emails are filled in from the people directory.
        email: "",
        role: row.role,
        status: row.status,
        teamId: row.teamId,
      })),
    )
    setInvites(
      opsSnapshot.invites.map((row) => ({
        id: row.id,
        email: row.email,
        teamId: row.teamId,
        status: row.status,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        inviteUrl: row.inviteUrl ?? `/invite/coach/${row.id}`,
      })),
    )
    setRequests(opsSnapshot.accountRequests ?? [])
    setTeams(opsSnapshot.teams.map((row) => ({ id: row.id, name: row.name })))
  }, [opsError, opsLoading, opsSnapshot, isSupabaseMode])

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false

    void getClubAdminPeopleDirectory().then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setBackendError((current) => current ?? `Could not load team assignments: ${result.error.message}`)
        return
      }
      setDirectory(result.data)
    })

    return () => {
      cancelled = true
    }
    // Reload assignments whenever the people snapshot changes.
  }, [isSupabaseMode, opsSnapshot])

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
    if (!isSupabaseMode) return
    let cancelled = false

    void Promise.all([getCurrentClubAdminActivationState(), getClubAdminPackageUpgradeRequests()]).then(([activationResult, upgradeResult]) => {
      if (cancelled) return
      if (activationResult.ok) setRequestedPlan(activationResult.data.requestedPlan)
      if (upgradeResult.ok) {
        const firstPendingUpgrade = upgradeResult.data.find((item) => item.status === "pending") ?? null
        setPendingUpgradeRequest(
          firstPendingUpgrade
            ? { requestedPackage: firstPendingUpgrade.requestedPackage, createdAt: firstPendingUpgrade.createdAt }
            : null,
        )
      }
    })

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  const saveUsers = (next: ClubUser[]) => {
    setUsers(next)
    if (!isSupabaseMode) persistUsers(next)
  }

  const saveInvites = (next: CoachInvite[]) => {
    setInvites(next)
    if (!isSupabaseMode) persistInvites(next)
  }

  const saveRequests = (next: AccountRequest[]) => {
    setRequests(next)
    if (!isSupabaseMode) persistAccountRequests(next)
  }

  const teamNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const team of directory?.teams ?? []) map.set(team.id, team.name)
    for (const team of teams) map.set(team.id, team.name)
    return map
  }, [directory, teams])

  const emailOf = (user: ClubUser) => (isSupabaseMode ? directory?.members[user.id]?.email ?? "" : user.email)
  const labelOf = (user: ClubUser) => emailOf(user) || user.name

  const teamNamesOf = (user: ClubUser) => {
    const ids = new Set<string>()
    if (isSupabaseMode) {
      for (const id of directory?.members[user.id]?.teamIds ?? []) ids.add(id)
    } else {
      if (user.teamId) ids.add(user.teamId)
      for (const team of teams) {
        if (team.coachUserId === user.id || team.coachUserIds?.includes(user.id)) ids.add(team.id)
      }
    }
    return Array.from(ids)
      .map((id) => teamNameById.get(id))
      .filter((name): name is string => Boolean(name))
  }

  const isSelf = (user: ClubUser) =>
    isSupabaseMode ? directory?.currentUserId === user.id : Boolean(mockUserEmail) && user.email === mockUserEmail

  const packageDefinition = getPackageById(requestedPlan)
  const activeCoachCount = users.filter((user) => user.role === "coach" && user.status === "active").length
  const coachLimitReached = Boolean(packageDefinition && activeCoachCount >= packageDefinition.limits.coaches)
  const suggestedUpgradePackage = getNextPackageTier(requestedPlan)
  const coachLimitMessage = packageDefinition
    ? `${packageDefinition.label} allows up to ${packageDefinition.limits.coaches} coach${packageDefinition.limits.coaches === 1 ? "" : "es"}. Upgrade the package before adding another coach.`
    : "This club has reached the package limit for coaches."

  const pendingInvites = invites.filter((invite) => invite.status === "pending")
  const pendingRequests = requests.filter((request) => request.status === "pending")
  const sortedInvites = [...pendingInvites, ...invites.filter((invite) => invite.status !== "pending")]
  const sortedRequests = [...pendingRequests, ...requests.filter((request) => request.status !== "pending")]

  const query = search.trim().toLowerCase()
  const visibleUsers = users.filter((user) => {
    if (roleFilter !== "all" && user.role !== roleFilter) return false
    if (statusFilter !== "all" && user.status !== statusFilter) return false
    if (!query) return true
    return (
      user.name.toLowerCase().includes(query) ||
      emailOf(user).toLowerCase().includes(query) ||
      teamNamesOf(user).some((name) => name.toLowerCase().includes(query))
    )
  })
  const filtersActive = Boolean(query) || roleFilter !== "all" || statusFilter !== "all"

  const handleSubmitUpgradeRequest = async () => {
    if (!isSupabaseMode || !suggestedUpgradePackage || pendingUpgradeRequest) return
    setUpgradeSaving(true)
    setUpgradeError(null)
    const result = await submitClubAdminPackageUpgradeRequest({
      requestedPackage: suggestedUpgradePackage,
      reason: upgradeReason,
    })
    setUpgradeSaving(false)

    if (!result.ok) {
      setUpgradeError(result.error.message)
      return
    }

    setPendingUpgradeRequest({
      requestedPackage: suggestedUpgradePackage,
      createdAt: new Date().toISOString(),
    })
    setUpgradeReason("")
    setUpgradeDialogOpen(false)
    setBackendError(null)
  }

  /** Creates one coach invite in the current backend. Returns the invite or a message explaining why not. */
  const createInvite = async (email: string, teamId: string | undefined): Promise<{ invite: CoachInvite } | { error: string }> => {
    if (coachLimitReached) return { error: coachLimitMessage }
    if (invites.some((invite) => invite.status === "pending" && invite.email.toLowerCase() === email)) {
      return { error: `${email} already has an invite waiting. Copy its link from Invites, or cancel it first.` }
    }
    if (users.some((user) => emailOf(user).toLowerCase() === email && user.status === "active" && user.role !== "athlete")) {
      return { error: `${email} is already on the staff of this club.` }
    }

    if (isSupabaseMode) {
      const result = await createCoachInvite({ email, teamId })
      if (!result.ok) return { error: result.error.message }
      return {
        invite: {
          id: result.data.id,
          email: result.data.email,
          teamId: result.data.teamId,
          status: result.data.status,
          createdAt: result.data.createdAt,
          expiresAt: result.data.expiresAt,
          inviteUrl: result.data.inviteUrl ?? `/invite/coach/${result.data.id}`,
        },
      }
    }

    const id = `invite-${Date.now()}`
    return {
      invite: {
        id,
        email,
        teamId,
        status: "pending",
        createdAt: new Date().toISOString().slice(0, 10),
        expiresAt: new Date(Date.now() + COACH_INVITE_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        inviteUrl: `/invite/coach/${id}`,
      },
    }
  }

  const resetInviteDialog = () => {
    setInviteEmail("")
    setInviteTeamId("none")
    setInviteError(null)
    setCreatedInvite(null)
    setCreatedCopied(false)
  }

  const handleSendCoachInvite = async () => {
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return
    if (!isValidEmail(email)) {
      setInviteError("Enter a full email address, like coach@club.com.")
      return
    }
    const teamId = inviteTeamId !== "none" ? inviteTeamId : undefined

    setInviteBusy(true)
    setInviteError(null)
    const result = await createInvite(email, teamId)
    if ("error" in result) {
      setInviteBusy(false)
      setInviteError(result.error)
      return
    }

    saveInvites([result.invite, ...invites])
    await emitAudit("coach_invite_send", email, teamId ? `team ${teamId}` : "no team")
    setInviteBusy(false)
    setCreatedInvite({ email, link: toAbsoluteLink(result.invite.inviteUrl ?? `/invite/coach/${result.invite.id}`) })
    setCreatedCopied(false)
    setSection("invites")
    syncBackend()
  }

  const handleCancelInvite = async (invite: CoachInvite) => {
    setBackendError(null)
    setNotice(null)
    if (isSupabaseMode) {
      setBusyKey(`invite:${invite.id}`)
      const result = await revokeCoachInvite(invite.id)
      setBusyKey(null)
      if (!result.ok) {
        setBackendError(`Could not cancel the invite for ${invite.email}: ${result.error.message}`)
        syncBackend()
        return
      }
    }
    saveInvites(invites.map((item) => (item.id === invite.id ? { ...item, status: "revoked" } : item)))
    setConfirm(null)
    await emitAudit("coach_invite_revoke", invite.email)
    setNotice(`Invite for ${invite.email} cancelled. Its link no longer works.`)
    syncBackend()
  }

  const handleRenewInvite = async (invite: CoachInvite) => {
    setBackendError(null)
    setNotice(null)
    setBusyKey(`invite:${invite.id}`)
    const result = await createInvite(invite.email.toLowerCase(), invite.teamId)
    setBusyKey(null)
    if ("error" in result) {
      setBackendError(`Could not create a new link for ${invite.email}: ${result.error}`)
      return
    }
    saveInvites([result.invite, ...invites])
    await emitAudit("coach_invite_resend", invite.email, invite.teamId ? `team ${invite.teamId}` : "no team")
    setNotice(`New invite link ready for ${invite.email}. Copy it and send it to them.`)
    syncBackend()
  }

  const handleCopyInvite = async (invite: CoachInvite) => {
    const link = toAbsoluteLink(invite.inviteUrl ?? `/invite/coach/${invite.id}`)
    if (await copyText(link)) {
      setCopiedInviteId(invite.id)
      window.setTimeout(() => setCopiedInviteId((current) => (current === invite.id ? null : current)), 2000)
    } else {
      setBackendError(`Could not copy automatically. The link is ${link}`)
    }
  }

  const handleChangeRole = async (user: ClubUser, role: UserRole) => {
    setBackendError(null)
    setNotice(null)
    if (role === "coach" && user.status === "active" && coachLimitReached) {
      setBackendError(coachLimitMessage)
      return
    }
    if (isSupabaseMode) {
      setBusyKey(`user:${user.id}`)
      const result = await updateProfileRoleAndStatus({ userId: user.id, role, status: user.status })
      setBusyKey(null)
      if (!result.ok) {
        setBackendError(`Could not change the role for ${user.name}: ${result.error.message}`)
        return
      }
    }
    saveUsers(users.map((item) => (item.id === user.id ? { ...item, role } : item)))
    setConfirm(null)
    await emitAudit("role_assign", labelOf(user), `role ${role}`)
    setNotice(`${user.name} is now ${role === "athlete" ? "an" : "a"} ${ROLE_LABEL[role].toLowerCase()}.`)
    syncBackend()
  }

  const handleSetStatus = async (user: ClubUser, nextStatus: ClubUser["status"]) => {
    setBackendError(null)
    setNotice(null)
    if (nextStatus === "active" && user.role === "coach" && coachLimitReached) {
      setBackendError(coachLimitMessage)
      return
    }
    if (isSupabaseMode) {
      setBusyKey(`user:${user.id}`)
      const result = await updateProfileRoleAndStatus({ userId: user.id, role: user.role, status: nextStatus })
      setBusyKey(null)
      if (!result.ok) {
        setBackendError(`Could not ${nextStatus === "active" ? "reactivate" : "deactivate"} ${user.name}: ${result.error.message}`)
        return
      }
    }
    saveUsers(users.map((item) => (item.id === user.id ? { ...item, status: nextStatus } : item)))
    setConfirm(null)
    await emitAudit(nextStatus === "disabled" ? "user_disable" : "user_enable", labelOf(user))
    setNotice(nextStatus === "disabled" ? `${user.name} no longer has access.` : `${user.name} has access again.`)
    syncBackend()
  }

  const handleReviewRequest = async (request: AccountRequest, status: "approved" | "declined") => {
    setBackendError(null)
    setNotice(null)
    setBusyKey(`request:${request.id}`)
    const email = request.email.trim().toLowerCase()
    let nextInvites = invites
    let createdCoachInvite = false

    // Approving a coach request only means something if they can then join, so create their invite first.
    if (status === "approved" && request.role === "coach") {
      const alreadyInvited = invites.some((invite) => invite.status === "pending" && invite.email.toLowerCase() === email)
      if (!alreadyInvited) {
        const inviteResult = await createInvite(email, undefined)
        if ("error" in inviteResult) {
          setBusyKey(null)
          setBackendError(`Could not approve ${request.fullName}: ${inviteResult.error}`)
          return
        }
        nextInvites = [inviteResult.invite, ...invites]
        createdCoachInvite = true
      }
    }

    if (isSupabaseMode) {
      const result = await reviewAccountRequest({ requestId: request.id, status })
      if (!result.ok) {
        setBusyKey(null)
        if (createdCoachInvite) saveInvites(nextInvites)
        setBackendError(`Could not ${status === "approved" ? "approve" : "decline"} ${request.fullName}: ${result.error.message}`)
        syncBackend()
        return
      }
    }

    setBusyKey(null)
    if (createdCoachInvite) {
      saveInvites(nextInvites)
      await emitAudit("coach_invite_send", email, "no team")
    }
    saveRequests(
      requests.map((item) => (item.id === request.id ? { ...item, status, reviewedAt: new Date().toISOString() } : item)),
    )
    setConfirm(null)
    await emitAudit(status === "approved" ? "account_request_approve" : "account_request_decline", email, `role ${request.role}`)
    if (status === "declined") {
      setNotice(`Request from ${request.fullName} declined.`)
    } else if (request.role === "coach") {
      setNotice(`${request.fullName} approved. Their coach invite link is under Invites, ready to copy and send.`)
    } else if (request.role === "athlete") {
      setNotice(`${request.fullName} approved. Athletes join through a team, so invite them from the Teams screen.`)
    } else {
      setNotice(`${request.fullName} approved. Invite them as a coach, then change their role to club admin once they join.`)
    }
    syncBackend()
  }

  const peopleCount = users.length
  const lede = backendLoading
    ? "Loading people..."
    : [
        `${peopleCount} ${peopleCount === 1 ? "person" : "people"} in your club.`,
        pendingInvites.length > 0
          ? `${pendingInvites.length} ${pendingInvites.length === 1 ? "invite is" : "invites are"} waiting to be accepted.`
          : null,
        packageDefinition && Number.isFinite(packageDefinition.limits.coaches)
          ? `${packageDefinition.label} plan: ${activeCoachCount} of ${packageDefinition.limits.coaches} coaches.`
          : null,
      ]
        .filter(Boolean)
        .join(" ")

  const count = (value: number) => <span className="ml-1.5 tabular-nums text-sk-mute">{value}</span>
  const th = "px-3 py-3 font-semibold"

  return (
    <div className="sk-page">
      <PageHeader
        title="People"
        lede={lede}
        actions={
          <button
            type="button"
            className="sk-btn sk-btn-primary w-full sm:w-auto"
            onClick={() => {
              resetInviteDialog()
              setInviteOpen(true)
            }}
          >
            <UserPlus className="size-5" weight="bold" />
            Invite coach
          </button>
        }
      />

      {backendError ? (
        <div role="alert" className={`${alertClass} flex items-start justify-between gap-3`}>
          <p className="min-w-0 break-words">{backendError}</p>
          <button type="button" className="-my-1 shrink-0 rounded-lg p-1 hover:bg-white/60" aria-label="Dismiss message" onClick={() => setBackendError(null)}>
            <X className="size-4" weight="bold" />
          </button>
        </div>
      ) : null}

      {notice ? (
        <div role="status" className="flex items-start justify-between gap-3 rounded-2xl bg-sk-green-tint px-4 py-3 text-sm font-semibold text-[#07673f]">
          <p className="min-w-0 break-words">{notice}</p>
          <button type="button" className="-my-1 shrink-0 rounded-lg p-1 hover:bg-white/60" aria-label="Dismiss message" onClick={() => setNotice(null)}>
            <X className="size-4" weight="bold" />
          </button>
        </div>
      ) : null}

      {coachLimitReached && packageDefinition ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-sk-yellow-tint px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-sk-ink">
            <span className="font-bold">Your club is at its coach limit.</span> {packageDefinition.label} covers{" "}
            {packageDefinition.limits.coaches} coach{packageDefinition.limits.coaches === 1 ? "" : "es"}, so new coach invites are paused.
            {pendingUpgradeRequest
              ? ` Your upgrade request to ${getPackageById(pendingUpgradeRequest.requestedPackage)?.label ?? pendingUpgradeRequest.requestedPackage} is being reviewed.`
              : ""}
          </p>
          {!pendingUpgradeRequest && suggestedUpgradePackage ? (
            <button type="button" className="sk-btn sk-btn-ink sk-btn-sm shrink-0 max-sm:h-11" onClick={() => setUpgradeDialogOpen(true)}>
              Request upgrade to {getPackageById(suggestedUpgradePackage)?.label ?? suggestedUpgradePackage}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Segmented
          label="People sections"
          value={section}
          onChange={(next) => {
            setSection(next)
            setConfirm(null)
          }}
          options={[
            { value: "people", label: <>People{count(users.length)}</> },
            { value: "invites", label: <>Invites{count(pendingInvites.length)}</> },
            { value: "requests", label: <>Requests{count(pendingRequests.length)}</> },
          ]}
        />
      </div>

      {section === "people" ? (
        <Panel flush>
          <div className="flex flex-col gap-3 border-b border-sk-line p-5 sm:p-6 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-sk-mute" weight="bold" />
              <input
                type="search"
                aria-label="Search people"
                placeholder="Search by name, email or team"
                className="sk-field pl-11"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 md:flex">
              <select
                aria-label="Filter by role"
                className="sk-field md:w-40"
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}
              >
                <option value="all">All roles</option>
                <option value="club-admin">Club admins</option>
                <option value="coach">Coaches</option>
                <option value="athlete">Athletes</option>
              </select>
              <select
                aria-label="Filter by status"
                className="sk-field md:w-40"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              >
                <option value="all">Any status</option>
                <option value="active">Active</option>
                <option value="disabled">Deactivated</option>
              </select>
            </div>
          </div>

          {backendLoading ? (
            <p className="p-6 text-sm text-sk-mute">Loading people...</p>
          ) : users.length === 0 ? (
            <div className="p-5 sm:p-6">
              <EmptyState
                icon={<UsersThree className="size-6" weight="fill" />}
                title="Nobody here yet"
                body="Coaches and athletes appear here once they accept an invite. Start by inviting your first coach."
                className="border-0 bg-sk-canvas"
              />
            </div>
          ) : visibleUsers.length === 0 ? (
            <div className="flex flex-col items-start gap-3 p-5 sm:p-6">
              <p className="text-sm text-sk-mute">Nobody matches that search or filter.</p>
              <button
                type="button"
                className="sk-btn sk-btn-quiet sk-btn-sm"
                onClick={() => {
                  setSearch("")
                  setRoleFilter("all")
                  setStatusFilter("all")
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <table className="relative block w-full text-left md:table">
              <caption className="sr-only">People in your club{filtersActive ? ", filtered" : ""}</caption>
              <thead className="hidden md:table-header-group">
                <tr className="border-b border-sk-line text-sm text-sk-mute">
                  <th scope="col" className={`${th} pl-6`}>Name</th>
                  <th scope="col" className={th}>Email</th>
                  <th scope="col" className={th}>Role</th>
                  <th scope="col" className={th}>Teams</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={`${th} pr-6 text-right`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group">
                {visibleUsers.map((user) => {
                  const self = isSelf(user)
                  const email = emailOf(user)
                  const teamNames = teamNamesOf(user)
                  const busy = busyKey === `user:${user.id}`
                  const roleConfirm = confirm?.kind === "role" && confirm.userId === user.id ? confirm : null
                  const deactivateConfirm = confirm?.kind === "deactivate" && confirm.userId === user.id
                  return (
                    <Fragment key={user.id}>
                      <tr
                        data-person={email || user.name}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-sk-line px-5 py-4 first:border-t-0 md:table-row md:px-0 md:py-0"
                      >
                        <th scope="row" className="min-w-0 font-normal md:py-3.5 md:pl-6 md:pr-3">
                          <span className="flex min-w-0 items-center gap-3">
                            <Initials name={user.name} />
                            <span className="min-w-0 truncate font-bold text-sk-ink">
                              {user.name}
                              {self ? <span className="font-normal text-sk-mute"> (you)</span> : null}
                            </span>
                          </span>
                        </th>
                        <td className="max-md:col-span-2 max-md:row-start-2 max-md:pl-[52px] min-w-0 break-all text-sm text-sk-ink-2 md:px-3 md:py-3.5">
                          {email || <span className="text-sk-mute">No email on file</span>}
                        </td>
                        <td className="max-md:row-start-4 max-md:pl-[52px] md:px-3 md:py-3.5">
                          <select
                            aria-label={`Role for ${user.name}`}
                            className="sk-field h-11 w-full min-w-[9rem] md:h-9 md:w-36 md:rounded-xl md:text-sm"
                            value={roleConfirm?.role ?? user.role}
                            disabled={self || busy}
                            title={self ? "You cannot change your own role" : undefined}
                            onChange={(event) => {
                              const role = event.target.value as UserRole
                              setConfirm(role === user.role ? null : { kind: "role", userId: user.id, role })
                            }}
                          >
                            <option value="club-admin">Club admin</option>
                            <option value="coach">Coach</option>
                            <option value="athlete">Athlete</option>
                          </select>
                        </td>
                        <td className="max-md:col-span-2 max-md:row-start-3 max-md:pl-[52px] text-sm text-sk-ink-2 md:px-3 md:py-3.5">
                          {teamNames.length > 0 ? teamNames.join(", ") : <span className="text-sk-mute">No team</span>}
                        </td>
                        <td className="max-md:col-start-2 max-md:row-start-1 max-md:justify-self-end md:px-3 md:py-3.5">
                          <Tag tone={user.status === "active" ? "green" : "plain"}>{user.status === "active" ? "Active" : "Deactivated"}</Tag>
                        </td>
                        <td className="max-md:row-start-4 max-md:justify-self-end text-right md:py-3.5 md:pl-3 md:pr-6">
                          {self ? null : user.status === "active" ? (
                            <button
                              type="button"
                              className="sk-btn sk-btn-ghost sk-btn-sm max-md:h-11 hover:bg-sk-coral-tint hover:text-[#c7300f]"
                              aria-expanded={deactivateConfirm}
                              disabled={busy}
                              onClick={() => setConfirm(deactivateConfirm ? null : { kind: "deactivate", userId: user.id })}
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="sk-btn sk-btn-quiet sk-btn-sm max-md:h-11"
                              disabled={busy}
                              onClick={() => void handleSetStatus(user, "active")}
                            >
                              {busy ? "Saving..." : "Reactivate"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {roleConfirm || deactivateConfirm ? (
                        <tr className="block md:table-row">
                          <td colSpan={6} className="block px-5 pb-4 md:table-cell md:px-6">
                            <div role="group" aria-label="Confirm" className="flex flex-col gap-3 rounded-2xl bg-sk-coral-tint p-4 sm:flex-row sm:items-center sm:justify-between">
                              {roleConfirm ? (
                                <p className="text-sm text-sk-ink">
                                  <span className="font-bold">
                                    Make {user.name} {roleConfirm.role === "athlete" ? "an" : "a"} {ROLE_LABEL[roleConfirm.role].toLowerCase()}?
                                  </span>{" "}
                                  {ROLE_CHANGE_EFFECT[roleConfirm.role]}
                                </p>
                              ) : (
                                <p className="text-sm text-sk-ink">
                                  <span className="font-bold">Deactivate {user.name}?</span> They lose access to the club until you reactivate them. Their history is kept.
                                </p>
                              )}
                              <div className="flex shrink-0 gap-2">
                                <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm max-sm:h-11 max-sm:flex-1" onClick={() => setConfirm(null)}>
                                  {roleConfirm ? `Keep as ${ROLE_LABEL[user.role].toLowerCase()}` : "Keep active"}
                                </button>
                                <button
                                  type="button"
                                  className="sk-btn sk-btn-danger sk-btn-sm max-sm:h-11 max-sm:flex-1"
                                  disabled={busy}
                                  onClick={() => void (roleConfirm ? handleChangeRole(user, roleConfirm.role) : handleSetStatus(user, "disabled"))}
                                >
                                  {busy ? "Saving..." : roleConfirm ? "Change role" : "Deactivate"}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </Panel>
      ) : null}

      {section === "invites" ? (
        <Panel title="Coach invites" hint={`Each invite is a personal link that works for ${COACH_INVITE_VALID_DAYS} days. Copy it and send it to the coach yourself.`}>
          {backendLoading ? (
            <p className="py-6 text-sm text-sk-mute">Loading invites...</p>
          ) : sortedInvites.length === 0 ? (
            <EmptyState
              icon={<EnvelopeSimple className="size-6" weight="fill" />}
              title="No coach invites yet"
              body="Invite a coach and their link appears here, so you can see who has joined and who is still waiting."
              action={
                <button
                  type="button"
                  className="sk-btn sk-btn-ink sk-btn-sm"
                  onClick={() => {
                    resetInviteDialog()
                    setInviteOpen(true)
                  }}
                >
                  <UserPlus className="size-4" weight="bold" />
                  Invite coach
                </button>
              }
              className="border-0 bg-sk-canvas"
            />
          ) : (
            <ul>
              {sortedInvites.map((invite) => {
                const status = INVITE_STATUS[invite.status]
                const sent = shortDate(invite.createdAt)
                const expires = shortDate(invite.expiresAt)
                const isPending = invite.status === "pending"
                const canRenew = invite.status === "expired" || invite.status === "revoked"
                const hasNewerPending = canRenew && pendingInvites.some((item) => item.email.toLowerCase() === invite.email.toLowerCase())
                const busy = busyKey === `invite:${invite.id}`
                const confirming = confirm?.kind === "cancel-invite" && confirm.inviteId === invite.id
                const teamName = invite.teamId ? teamNameById.get(invite.teamId) : null
                return (
                  <li key={invite.id} data-invite={invite.email} className="border-b border-sk-line py-4 last:border-b-0">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-start justify-between gap-3 md:flex-1 md:items-center">
                        <div className="min-w-0">
                          <p className="break-all font-bold text-sk-ink">{invite.email}</p>
                          <p className="text-sm text-sk-mute">
                            {teamName ? `Coach for ${teamName}` : "Coach, no team yet"}
                            {sent ? `. Sent ${sent}` : ""}
                            {isPending && expires ? `, works until ${expires}` : ""}
                            {invite.status === "expired" && expires ? `, expired ${expires}` : ""}
                          </p>
                        </div>
                        <Tag tone={status.tone} className="shrink-0">{status.label}</Tag>
                      </div>
                      {isPending ? (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm max-md:h-11 max-md:flex-1" onClick={() => void handleCopyInvite(invite)}>
                            {copiedInviteId === invite.id ? <Check className="size-4" weight="bold" /> : <Copy className="size-4" weight="bold" />}
                            {copiedInviteId === invite.id ? "Copied" : "Copy link"}
                          </button>
                          {isLocalPreviewEnabled ? (
                            <a
                              className="sk-btn sk-btn-ghost sk-btn-sm max-md:hidden"
                              href={toAbsoluteLink(invite.inviteUrl ?? `/invite/coach/${invite.id}`)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open invite
                            </a>
                          ) : null}
                          <button
                            type="button"
                            className="sk-btn sk-btn-ghost sk-btn-sm max-md:h-11 max-md:flex-1"
                            aria-expanded={confirming}
                            disabled={busy}
                            onClick={() => setConfirm(confirming ? null : { kind: "cancel-invite", inviteId: invite.id })}
                          >
                            Cancel invite
                          </button>
                        </div>
                      ) : canRenew && !hasNewerPending ? (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            className="sk-btn sk-btn-quiet sk-btn-sm max-md:h-11 max-md:flex-1"
                            disabled={busy}
                            onClick={() => void handleRenewInvite(invite)}
                          >
                            {busy ? "Creating..." : "Create new link"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {confirming ? (
                      <div role="group" aria-label="Confirm" className="mt-3 flex flex-col gap-3 rounded-2xl bg-sk-coral-tint p-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-sk-ink">
                          <span className="font-bold">Cancel the invite for {invite.email}?</span> The link stops working straight away.
                        </p>
                        <div className="flex shrink-0 gap-2">
                          <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm max-sm:h-11 max-sm:flex-1" onClick={() => setConfirm(null)}>
                            Keep invite
                          </button>
                          <button
                            type="button"
                            className="sk-btn sk-btn-danger sk-btn-sm max-sm:h-11 max-sm:flex-1"
                            disabled={busy}
                            onClick={() => void handleCancelInvite(invite)}
                          >
                            {busy ? "Cancelling..." : "Yes, cancel it"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      ) : null}

      {section === "requests" ? (
        <Panel title="Account requests" hint="People who asked to join your club. Approving a coach creates their invite link.">
          {backendLoading ? (
            <p className="py-6 text-sm text-sk-mute">Loading requests...</p>
          ) : sortedRequests.length === 0 ? (
            <EmptyState
              icon={<Tray className="size-6" weight="fill" />}
              title="No requests waiting"
              body="When someone asks to join your club, their request shows up here for you to approve or decline."
              className="border-0 bg-sk-canvas"
            />
          ) : (
            <ul>
              {sortedRequests.map((request) => {
                const isPending = request.status === "pending"
                const status = REQUEST_STATUS[request.status]
                const busy = busyKey === `request:${request.id}`
                const confirming = confirm?.kind === "decline" && confirm.requestId === request.id
                const asked = shortDate(request.createdAt)
                return (
                  <li key={request.id} data-request={request.email} className="border-b border-sk-line py-4 last:border-b-0">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-start gap-3 md:flex-1">
                        <Initials name={request.fullName} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <p className="min-w-0 font-bold text-sk-ink">{request.fullName}</p>
                            {isPending ? null : <Tag tone={status.tone} className="shrink-0">{status.label}</Tag>}
                          </div>
                          <p className="break-all text-sm text-sk-ink-2">{request.email}</p>
                          <p className="text-sm text-sk-mute">
                            Wants to join as {request.role === "athlete" ? "an" : "a"} {ROLE_LABEL[request.role].toLowerCase()}
                            {request.organization ? `, from ${request.organization}` : ""}
                            {asked ? `. Asked ${asked}` : ""}
                          </p>
                          {request.notes ? <p className="mt-1.5 text-sm text-sk-ink-2">{request.notes}</p> : null}
                        </div>
                      </div>
                      {isPending ? (
                        <div className="flex shrink-0 gap-2 max-md:pl-[52px]">
                          <button
                            type="button"
                            className="sk-btn sk-btn-ink sk-btn-sm max-md:h-11 max-md:flex-1"
                            disabled={busy}
                            onClick={() => void handleReviewRequest(request, "approved")}
                          >
                            <Check className="size-4" weight="bold" />
                            {busy && !confirming ? "Saving..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            className="sk-btn sk-btn-ghost sk-btn-sm max-md:h-11 max-md:flex-1"
                            aria-expanded={confirming}
                            disabled={busy}
                            onClick={() => setConfirm(confirming ? null : { kind: "decline", requestId: request.id })}
                          >
                            Decline
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {confirming ? (
                      <div role="group" aria-label="Confirm" className="mt-3 flex flex-col gap-3 rounded-2xl bg-sk-coral-tint p-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-sk-ink">
                          <span className="font-bold">Decline the request from {request.fullName}?</span> They will not be added to your club.
                        </p>
                        <div className="flex shrink-0 gap-2">
                          <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm max-sm:h-11 max-sm:flex-1" onClick={() => setConfirm(null)}>
                            Keep request
                          </button>
                          <button
                            type="button"
                            className="sk-btn sk-btn-danger sk-btn-sm max-sm:h-11 max-sm:flex-1"
                            disabled={busy}
                            onClick={() => void handleReviewRequest(request, "declined")}
                          >
                            {busy ? "Declining..." : "Decline request"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      ) : null}

      <Dialog
        open={inviteOpen}
        onOpenChange={(next) => {
          setInviteOpen(next)
          if (!next) resetInviteDialog()
        }}
      >
        <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto rounded-[20px] border-sk-line bg-white p-5 shadow-none sm:max-w-md sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="sk-h2">Invite a coach</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed text-sk-mute">
                They get a personal link to join your club. It works once, for the email you enter, for {COACH_INVITE_VALID_DAYS} days.
              </DialogDescription>
            </div>
            <DialogClose className="sk-btn sk-btn-ghost size-11 shrink-0 px-0" aria-label="Close">
              <X className="size-5" weight="bold" />
            </DialogClose>
          </div>

          {createdInvite ? (
            <div className="space-y-4">
              <div className="sk-well space-y-3">
                <p className="text-sm text-sk-ink-2">
                  Invite ready for <span className="break-all font-bold text-sk-ink">{createdInvite.email}</span>. Send them this link.
                </p>
                <input
                  readOnly
                  aria-label="Invite link"
                  value={createdInvite.link}
                  className="sk-field text-sm"
                  onFocus={(event) => event.currentTarget.select()}
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button type="button" className="sk-btn sk-btn-quiet" onClick={resetInviteDialog}>
                  Invite another
                </button>
                <button type="button" className="sk-btn sk-btn-primary" onClick={async () => setCreatedCopied(await copyText(createdInvite.link))}>
                  {createdCopied ? <Check className="size-5" weight="bold" /> : <Copy className="size-5" weight="bold" />}
                  {createdCopied ? "Link copied" : "Copy link"}
                </button>
              </div>
            </div>
          ) : (
            <form
              className="space-y-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                void handleSendCoachInvite()
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor="coach-invite-email" className="sk-label">
                  Coach email
                </label>
                <input
                  id="coach-invite-email"
                  type="email"
                  autoComplete="off"
                  placeholder="coach@email.com"
                  className="sk-field"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="coach-invite-team" className="sk-label">
                  Team
                </label>
                <select id="coach-invite-team" className="sk-field" value={inviteTeamId} onChange={(event) => setInviteTeamId(event.target.value)}>
                  <option value="none">No team yet</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-sk-mute">Pick a team and they become its lead coach when they accept.</p>
              </div>
              {coachLimitReached ? (
                <p className="rounded-2xl bg-sk-yellow-tint px-4 py-3 text-sm font-semibold text-[#7a5600]">{coachLimitMessage}</p>
              ) : null}
              {inviteError ? (
                <p role="alert" className={alertClass}>
                  {inviteError}
                </p>
              ) : null}
              <div className="flex justify-end">
                <button type="submit" className="sk-btn sk-btn-primary w-full sm:w-auto" disabled={inviteBusy || !inviteEmail.trim() || coachLimitReached}>
                  <UserPlus className="size-5" weight="bold" />
                  {inviteBusy ? "Creating..." : "Create invite link"}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={upgradeDialogOpen}
        onOpenChange={(next) => {
          setUpgradeDialogOpen(next)
          if (!next) setUpgradeError(null)
        }}
      >
        <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto rounded-[20px] border-sk-line bg-white p-5 shadow-none sm:max-w-md sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="sk-h2">Request a package upgrade</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed text-sk-mute">
                Ask to move your club from {packageDefinition?.label ?? "your current package"} to{" "}
                {getPackageById(suggestedUpgradePackage)?.label ?? suggestedUpgradePackage ?? "the next package"}. We review every request.
              </DialogDescription>
            </div>
            <DialogClose className="sk-btn sk-btn-ghost size-11 shrink-0 px-0" aria-label="Close">
              <X className="size-5" weight="bold" />
            </DialogClose>
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmitUpgradeRequest()
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor="coach-upgrade-reason" className="sk-label">
                Reason
              </label>
              <textarea
                id="coach-upgrade-reason"
                rows={4}
                className="sk-field h-auto py-3"
                value={upgradeReason}
                onChange={(event) => setUpgradeReason(event.target.value)}
                placeholder="Tell us why your club needs more coaches."
              />
            </div>
            {upgradeError ? (
              <p role="alert" className={alertClass}>
                {upgradeError}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="sk-btn sk-btn-quiet" onClick={() => setUpgradeDialogOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="sk-btn sk-btn-ink" disabled={upgradeSaving}>
                {upgradeSaving ? "Sending..." : "Send upgrade request"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
