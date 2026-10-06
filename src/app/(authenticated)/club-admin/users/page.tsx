"use client"

import { UserPlus } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { PersonAvatar } from "@/components/account/person-avatar"
import { AddAthletesToTeam, ClubAthletesView } from "@/components/club-admin/athletes-view"
import { ClubGuardiansView } from "@/components/club-admin/guardians-view"
import { CoachHandoverDialog } from "@/components/club-admin/coach-handover-dialog"
import { InviteStaffDialog, type InviteStaffView, type StaffInviteCheck, type StaffInviteCreated } from "@/components/club-admin/invite-staff-dialog"
import { UpgradeRequestDialog } from "@/components/club-admin/upgrade-request-dialog"
import { applyInviteEmailResult, canResendInviteEmail, inviteEmailSummary, resendInviteEmailLabel } from "@/components/invites/invite-email-ui"
import {
  ActionRow,
  Avatar,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  FilterChips,
  InlineConfirm,
  List,
  Notice,
  RowMenu,
  Screen,
  ScreenHeader,
  SearchInput,
  Section,
  SkeletonRows,
  StatusText,
  TableSub,
  Tabs,
  notify,
  type DataTableColumn,
  type RowMenuItem,
  type StateTone,
} from "@/components/sk"
import { getNextPackageTier, getPackageById, type PackageId } from "@/lib/billing/package-catalog"
import { useClubAdmin } from "@/lib/club-admin-context"
import { teamsCoachedBy, type HandoverChoice, type HandoverTeam, type HandoverThen } from "@/lib/coach-permissions"
import {
  dismissHandoverRequest,
  getOpenHandoverRequests,
  handOverCoachTeams,
  mockTeamCoaches,
  type HandoverOutcome,
  type HandoverRequest,
} from "@/lib/data/club-admin/handover-data"
import {
  COACH_INVITE_VALID_DAYS,
  createCoachInvite,
  getClubAdminPackageUpgradeRequests,
  getClubAdminPeopleDirectory,
  getClubAdminTeamMembers,
  getClubAdminTeamsSnapshot,
  getCurrentClubAdminActivationState,
  insertAuditEvent,
  reviewAccountRequest,
  revokeCoachInvite,
  updateProfileRoleAndStatus,
  type ClubAdminPeopleDirectory,
} from "@/lib/data/club-admin/ops-data"
import { createStaffInvites, getClubAthletes, removeClubMember, type ClubAthlete, type StaffInviteRole } from "@/lib/data/club-admin/people-data"
import { ROSTER_CHANGED_EVENT } from "@/lib/data/coach/roster-mock"
import { sendInviteEmail, type InviteEmailSent } from "@/lib/data/invites/invite-email-data"
import { ok, type Result } from "@/lib/data/result"
import type { AccountRequest, ClubTeam, ClubUser, CoachInvite, UserRole } from "@/lib/mock-club-admin"
import { getBackendMode } from "@/lib/supabase/config"
import {
  loadAccountRequestsSafe,
  loadInvitesSafe,
  loadTeamsSafe,
  loadUsersSafe,
  persistAccountRequests,
  persistInvites,
  persistTeams,
  persistUsers,
} from "../state"

type View = "staff" | "athletes" | "guardians" | "invites" | "requests"
const VIEWS: View[] = ["staff", "athletes", "guardians", "invites", "requests"]

type Confirm =
  | { kind: "role"; userId: string; role: UserRole }
  | { kind: "deactivate"; userId: string }
  | { kind: "remove"; userId: string }
  | { kind: "cancel-invite"; inviteId: string }
  | { kind: "decline"; requestId: string }

type InviteFilter = "all" | CoachInvite["status"]

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

const INVITE_STATUS: Record<CoachInvite["status"], { label: string; tone: StateTone }> = {
  pending: { label: "Waiting", tone: "amber" },
  accepted: { label: "Joined", tone: "green" },
  expired: { label: "Expired", tone: "coral" },
  revoked: { label: "Cancelled", tone: "neutral" },
}

const REQUEST_STATUS: Record<AccountRequest["status"], { label: string; tone: StateTone }> = {
  pending: { label: "Waiting", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  declined: { label: "Declined", tone: "neutral" },
}

const MOCK_USER_EMAIL_STORAGE_KEY = "pacelab:mock-user-email"

function toAbsoluteLink(path: string) {
  return typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path
}

function shortDate(value: string | null | undefined) {
  if (!value) return null
  // A bare date ("2026-10-05") is a calendar day, not midnight UTC, so it must not shift a day in local time.
  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const parsed = dayOnly ? new Date(Number(dayOnly[1]), Number(dayOnly[2]) - 1, Number(dayOnly[3])) : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

function withExpiry(invite: CoachInvite): CoachInvite {
  if (invite.status === "pending" && invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    return { ...invite, status: "expired" }
  }
  return invite
}

function article(role: UserRole) {
  return role === "athlete" ? "an" : "a"
}

export default function ClubAdminUsersPage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const clubAdmin = useClubAdmin()
  const [searchParams, setSearchParams] = useSearchParams()
  const isLocalPreviewEnabled = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")

  const [users, setUsers] = useState<ClubUser[]>(() => (isSupabaseMode ? [] : loadUsersSafe()))
  const [invites, setInvites] = useState<CoachInvite[]>(() => (isSupabaseMode ? [] : loadInvitesSafe().map(withExpiry)))
  const [requests, setRequests] = useState<AccountRequest[]>(() => (isSupabaseMode ? [] : loadAccountRequestsSafe()))
  const [teams, setTeams] = useState<Array<Pick<ClubTeam, "id" | "name" | "coachUserId" | "coachUserIds">>>(() =>
    isSupabaseMode ? [] : loadTeamsSafe().filter((team) => team.status === "active"),
  )
  const [directory, setDirectory] = useState<ClubAdminPeopleDirectory | null>(null)
  const [athletes, setAthletes] = useState<ClubAthlete[] | null>(null)
  const [athletesError, setAthletesError] = useState<string | null>(null)
  const [mockUserEmail] = useState(() => (isSupabaseMode || typeof window === "undefined" ? null : window.localStorage.getItem(MOCK_USER_EMAIL_STORAGE_KEY)))

  // The newest lists, for handlers that finish after other changes were made (a bulk invite emailing).
  const invitesRef = useRef(invites)
  invitesRef.current = invites
  const usersRef = useRef(users)
  usersRef.current = users

  const requestedView = searchParams.get("view") as View | null
  const view: View = requestedView && VIEWS.includes(requestedView) ? requestedView : "staff"
  const setView = (next: View) => {
    setConfirm(null)
    setSearchParams(next === "staff" ? {} : { view: next }, { replace: true })
  }

  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all")
  const [statusFilter, setStatusFilter] = useState<"all" | ClubUser["status"]>("all")
  const [inviteFilter, setInviteFilter] = useState<InviteFilter>("all")
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteStart, setInviteStart] = useState<{ view: InviteStaffView; role: StaffInviteRole }>({ view: "one", role: "coach" })
  const [addAthletesOpen, setAddAthletesOpen] = useState(false)
  const [handover, setHandover] = useState<{ user: ClubUser; then: HandoverThen; teams: HandoverTeam[] } | null>(null)
  const [handoverRequests, setHandoverRequests] = useState<HandoverRequest[]>([])

  const [requestedPlan, setRequestedPlan] = useState<PackageId | null>(null)
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false)
  const [pendingUpgradeRequest, setPendingUpgradeRequest] = useState<{ requestedPackage: PackageId; createdAt: string } | null>(null)

  const [backendLoading, setBackendLoading] = useState(isSupabaseMode && !clubAdmin.opsSnapshot)
  const [backendError, setBackendError] = useState<string | null>(clubAdmin.opsError)
  const [mockAuditLogger, setMockAuditLogger] = useState<((event: { actor: string; action: string; target: string; detail?: string }) => void) | null>(null)

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

  const reloadAthletes = useCallback(async () => {
    const result = await getClubAthletes()
    if (!result.ok) {
      setAthletesError(result.error.message)
      return
    }
    setAthletesError(null)
    setAthletes(result.data)
  }, [])

  useEffect(() => {
    void reloadAthletes()
    // The Add athletes dialog and the coach screens change the demo roster in this browser.
    const refresh = () => void reloadAthletes()
    window.addEventListener(ROSTER_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(ROSTER_CHANGED_EVENT, refresh)
  }, [reloadAthletes])

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
        role: row.role,
        teamId: row.teamId,
        status: row.status,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        inviteUrl: row.inviteUrl ?? `/invite/coach/${row.id}`,
        emailSentAt: row.emailSentAt,
        emailSendCount: row.emailSendCount,
        emailError: row.emailError,
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
      if (!cancelled) setMockAuditLogger(() => module.logAuditEvent)
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
        setPendingUpgradeRequest(firstPendingUpgrade ? { requestedPackage: firstPendingUpgrade.requestedPackage, createdAt: firstPendingUpgrade.createdAt } : null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  const reloadHandoverRequests = useCallback(async () => {
    const result = await getOpenHandoverRequests()
    if (result.ok) setHandoverRequests(result.data)
  }, [])

  useEffect(() => {
    void reloadHandoverRequests()
  }, [reloadHandoverRequests, opsSnapshot])

  const saveUsers = (next: ClubUser[]) => {
    usersRef.current = next
    setUsers(next)
    if (!isSupabaseMode) persistUsers(next)
  }

  const saveInvites = (next: CoachInvite[]) => {
    invitesRef.current = next
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
    if (!isSupabaseMode) for (const team of loadTeamsSafe()) map.set(team.id, team.name)
    for (const team of teams) map.set(team.id, team.name)
    return map
  }, [directory, isSupabaseMode, teams])
  const teamName = useCallback((teamId: string | null) => (teamId ? (teamNameById.get(teamId) ?? null) : null), [teamNameById])
  const teamOptions = useMemo(() => teams.map((team) => ({ id: team.id, name: team.name })), [teams])

  const emailOf = (user: ClubUser) => (isSupabaseMode ? (directory?.members[user.id]?.email ?? "") : user.email)
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

  const isSelf = (user: ClubUser) => (isSupabaseMode ? directory?.currentUserId === user.id : Boolean(mockUserEmail) && user.email === mockUserEmail)

  // Staff: coaches and club admins, plus anyone whose account says athlete but who has no athlete
  // record (a staff member whose role was changed), so nobody is invisible on both lists.
  const athleteUserIds = useMemo(() => new Set((athletes ?? []).flatMap((athlete) => (athlete.userId ? [athlete.userId] : []))), [athletes])
  const staff = users.filter((user) => user.role !== "athlete" || (athletes !== null && !athleteUserIds.has(user.id)))
  const currentAthletes = (athletes ?? []).filter((athlete) => athlete.status !== "left")

  const packageDefinition = getPackageById(requestedPlan)
  const activeCoachCount = users.filter((user) => user.role === "coach" && user.status === "active").length
  const coachLimit = packageDefinition && Number.isFinite(packageDefinition.limits.coaches) ? packageDefinition.limits.coaches : null
  const coachLimitReached = coachLimit !== null && activeCoachCount >= coachLimit
  const suggestedUpgradePackage = getNextPackageTier(requestedPlan)
  const coachLimitMessage = packageDefinition
    ? `${packageDefinition.label} allows up to ${packageDefinition.limits.coaches} coach${packageDefinition.limits.coaches === 1 ? "" : "es"}. Upgrade the package before adding another coach.`
    : "This club has reached the package limit for coaches."

  const pendingInvites = invites.filter((invite) => invite.status === "pending")
  const pendingRequests = requests.filter((request) => request.status === "pending")
  const sortedInvites = [...pendingInvites, ...invites.filter((invite) => invite.status !== "pending")]
  const shownInvites = sortedInvites.filter((invite) => inviteFilter === "all" || invite.status === inviteFilter)
  const sortedRequests = [...pendingRequests, ...requests.filter((request) => request.status !== "pending")]

  const query = search.trim().toLowerCase()
  const visibleStaff = staff.filter((user) => {
    if (roleFilter !== "all" && user.role !== roleFilter) return false
    if (statusFilter !== "all" && user.status !== statusFilter) return false
    if (!query) return true
    return user.name.toLowerCase().includes(query) || emailOf(user).toLowerCase().includes(query) || teamNamesOf(user).some((name) => name.toLowerCase().includes(query))
  })
  const activeFilters = (roleFilter !== "all" ? 1 : 0) + (statusFilter !== "all" ? 1 : 0)
  const clearFilters = () => {
    setRoleFilter("all")
    setStatusFilter("all")
  }

  const openInvite = (start: { view: InviteStaffView; role: StaffInviteRole } = { view: "one", role: "coach" }) => {
    setInviteStart(start)
    setInviteOpen(true)
  }

  // "Invite a coach" on the dashboard lands here with the dialog open.
  useEffect(() => {
    if (searchParams.get("invite") !== "1") return
    setInviteStart({ view: "one", role: "coach" })
    setInviteOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete("invite")
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const checkEmail = (email: string): StaffInviteCheck => {
    if (invitesRef.current.some((invite) => invite.status === "pending" && invite.email.toLowerCase() === email)) return "invited"
    if (usersRef.current.some((user) => emailOf(user).toLowerCase() === email && user.status === "active" && user.role !== "athlete")) return "staff"
    return "ok"
  }

  /** Creates one staff invite in the current backend. Returns the invite or a message explaining why not. */
  const createInvite = async (email: string, teamId: string | undefined, role: StaffInviteRole): Promise<{ invite: CoachInvite } | { error: string }> => {
    if (role === "coach" && coachLimitReached) return { error: coachLimitMessage }
    const check = checkEmail(email)
    if (check === "invited") return { error: `${email} already has an invite waiting. Resend its email from Invites, or cancel it first.` }
    if (check === "staff") return { error: `${email} is already on the staff of this club.` }

    if (isSupabaseMode) {
      const result = await createCoachInvite({ email, teamId, role })
      if (!result.ok) return { error: result.error.message }
      return {
        invite: {
          id: result.data.id,
          email: result.data.email,
          role,
          teamId: result.data.teamId,
          status: result.data.status,
          createdAt: result.data.createdAt,
          expiresAt: result.data.expiresAt,
          inviteUrl: result.data.inviteUrl ?? `/invite/coach/${result.data.id}`,
        },
      }
    }

    const id = `invite-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    return {
      invite: {
        id,
        email,
        role,
        teamId,
        status: "pending",
        createdAt: new Date().toISOString().slice(0, 10),
        expiresAt: new Date(Date.now() + COACH_INVITE_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        inviteUrl: `/invite/coach/${id}`,
      },
    }
  }

  /**
   * Creates a staff invite and emails it straight away. The invite stands even when the email fails:
   * the returned invite then carries the failure so the list and the dialog can say so.
   */
  const createAndEmailInvite = async (email: string, teamId: string | undefined, role: StaffInviteRole): Promise<StaffInviteCreated | { error: string }> => {
    const created = await createInvite(email, teamId, role)
    if ("error" in created) return created
    const emailResult = await sendInviteEmail({ kind: "coach", inviteId: created.invite.id })
    // With a real backend the email function writes the audit entry itself.
    if (!isSupabaseMode && emailResult.ok) await emitAudit("coach_invite_email_sent", email, `coach invite ${created.invite.id}`)
    return { invite: applyInviteEmailResult(created.invite, emailResult), emailResult }
  }

  const inviteAuditDetail = (role: StaffInviteRole, teamId: string | undefined) => `${role === "club-admin" ? "club admin, " : ""}${teamId ? `team ${teamId}` : "no team"}`

  const handleInviteOne = async (email: string, role: StaffInviteRole, teamId: string | undefined) => {
    const result = await createAndEmailInvite(email, teamId, role)
    if ("error" in result) return result
    saveInvites([result.invite, ...invitesRef.current])
    await emitAudit("coach_invite_send", email, inviteAuditDetail(role, teamId))
    // The new invite is on the Invites list behind the dialog.
    setView("invites")
    syncBackend()
    return result
  }

  /** Creates the invites of a pasted list. They are emailed by the dialog, one at a time. */
  const handleInviteMany = async (emails: string[], role: StaffInviteRole): Promise<{ invites: CoachInvite[] } | { error: string }> => {
    let created: CoachInvite[]
    if (isSupabaseMode) {
      const result = await createStaffInvites(emails, role)
      if (!result.ok) return { error: result.error.message }
      created = result.data.map((row) => ({
        id: row.id,
        email: row.email,
        role,
        status: row.status,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        inviteUrl: row.inviteUrl ?? `/invite/coach/${row.id}`,
      }))
    } else {
      const stamp = Date.now()
      created = emails.map((email, index) => ({
        id: `invite-${stamp}-${index}`,
        email,
        role,
        status: "pending",
        createdAt: new Date().toISOString().slice(0, 10),
        expiresAt: new Date(stamp + COACH_INVITE_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        inviteUrl: `/invite/coach/invite-${stamp}-${index}`,
      }))
    }
    saveInvites([...created, ...invitesRef.current])
    await emitAudit("coach_invite_bulk_send", `${created.length} ${created.length === 1 ? "invite" : "invites"}`, role === "club-admin" ? "club admin, from a list" : "coach, from a list")
    setView("invites")
    syncBackend()
    return { invites: created }
  }

  const handleInviteEmailed = (inviteId: string, result: Result<InviteEmailSent>) => {
    saveInvites(invitesRef.current.map((item) => (item.id === inviteId ? applyInviteEmailResult(item, result) : item)))
    const invite = invitesRef.current.find((item) => item.id === inviteId)
    if (!isSupabaseMode && result.ok && invite) void emitAudit("coach_invite_email_sent", invite.email, `coach invite ${inviteId}`)
  }

  const handleCancelInvite = async (invite: CoachInvite) => {
    setBackendError(null)
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
    saveInvites(invitesRef.current.map((item) => (item.id === invite.id ? { ...item, status: "revoked" } : item)))
    setConfirm(null)
    await emitAudit("coach_invite_revoke", invite.email)
    notify(`Invite for ${invite.email} cancelled`, "Its link no longer works.")
    syncBackend()
  }

  const handleRenewInvite = async (invite: CoachInvite) => {
    setBackendError(null)
    setBusyKey(`invite:${invite.id}`)
    const role = invite.role ?? "coach"
    const result = await createAndEmailInvite(invite.email.toLowerCase(), invite.teamId, role)
    setBusyKey(null)
    if ("error" in result) {
      setBackendError(`Could not create a new invite for ${invite.email}: ${result.error}`)
      return
    }
    saveInvites([result.invite, ...invitesRef.current])
    await emitAudit("coach_invite_resend", invite.email, inviteAuditDetail(role, invite.teamId))
    if (result.emailResult.ok) notify(`New invite emailed to ${invite.email}`)
    else setBackendError(`A new invite was created for ${invite.email}, but the email was not sent. ${result.emailResult.error.message} Copy its link from the list and send it to them yourself.`)
    syncBackend()
  }

  /** Emails a waiting invite again. The link stays the same. */
  const handleResendInviteEmail = async (invite: CoachInvite) => {
    setBackendError(null)
    setBusyKey(`invite-email:${invite.id}`)
    const result = await sendInviteEmail({ kind: "coach", inviteId: invite.id })
    setBusyKey(null)
    saveInvites(invitesRef.current.map((item) => (item.id === invite.id ? applyInviteEmailResult(item, result) : item)))
    if (result.ok) {
      if (!isSupabaseMode) await emitAudit("coach_invite_email_resent", invite.email, `coach invite ${invite.id}`)
      notify(`Invite emailed to ${invite.email}`)
    } else {
      setBackendError(`The invite email to ${invite.email} was not sent. ${result.error.message} You can still copy the link and send it yourself.`)
    }
    syncBackend()
  }

  const handleCopyInvite = async (invite: CoachInvite) => {
    const link = toAbsoluteLink(invite.inviteUrl ?? `/invite/coach/${invite.id}`)
    try {
      await navigator.clipboard.writeText(link)
      notify("Invite link copied")
    } catch {
      setBackendError(`Could not copy automatically. The link is ${link}`)
    }
  }

  const handleChangeRole = async (user: ClubUser, role: UserRole) => {
    setBackendError(null)
    if (role === "coach" && user.status === "active" && coachLimitReached) {
      setConfirm(null)
      setBackendError(coachLimitMessage)
      return
    }
    if (isSupabaseMode) {
      setBusyKey(`user:${user.id}`)
      const result = await updateProfileRoleAndStatus({ userId: user.id, role, status: user.status })
      setBusyKey(null)
      if (!result.ok) {
        setConfirm(null)
        setBackendError(`Could not change the role for ${user.name}: ${result.error.message}`)
        return
      }
    }
    saveUsers(usersRef.current.map((item) => (item.id === user.id ? { ...item, role } : item)))
    setConfirm(null)
    await emitAudit("role_assign", labelOf(user), `role ${role}`)
    notify(`${user.name} is now ${article(role)} ${ROLE_LABEL[role].toLowerCase()}`)
    syncBackend()
  }

  const handleSetStatus = async (user: ClubUser, nextStatus: ClubUser["status"]) => {
    setBackendError(null)
    if (nextStatus === "active" && user.role === "coach" && coachLimitReached) {
      setBackendError(coachLimitMessage)
      return
    }
    if (isSupabaseMode) {
      setBusyKey(`user:${user.id}`)
      const result = await updateProfileRoleAndStatus({ userId: user.id, role: user.role, status: nextStatus })
      setBusyKey(null)
      if (!result.ok) {
        setConfirm(null)
        setBackendError(`Could not ${nextStatus === "active" ? "reactivate" : "deactivate"} ${user.name}: ${result.error.message}`)
        return
      }
    }
    saveUsers(usersRef.current.map((item) => (item.id === user.id ? { ...item, status: nextStatus } : item)))
    setConfirm(null)
    await emitAudit(nextStatus === "disabled" ? "user_disable" : "user_enable", labelOf(user))
    notify(nextStatus === "disabled" ? `${user.name} no longer has access` : `${user.name} has access again`)
    syncBackend()
  }

  /** Removes a coach or club admin from the club for good. What they wrote stays, with their name. */
  const handleRemoveMember = async (user: ClubUser) => {
    setBackendError(null)
    const otherActiveAdmins = usersRef.current.filter((item) => item.role === "club-admin" && item.status === "active" && item.id !== user.id).length
    if (user.role === "club-admin" && user.status === "active" && otherActiveAdmins === 0) {
      setConfirm(null)
      setBackendError("Your club needs at least one active club admin. Make someone else a club admin first.")
      return
    }
    if (isSupabaseMode) {
      setBusyKey(`user:${user.id}`)
      const result = await removeClubMember(user.id)
      setBusyKey(null)
      if (!result.ok) {
        setConfirm(null)
        setBackendError(`Could not remove ${user.name}: ${result.error.message}`)
        return
      }
    } else {
      // The demo keeps coaches on teams in the team list: take them off there too.
      persistTeams(
        loadTeamsSafe().map((team) => ({
          ...team,
          coachUserId: team.coachUserId === user.id ? undefined : team.coachUserId,
          coachEmail: team.coachUserId === user.id ? undefined : team.coachEmail,
          coachUserIds: (team.coachUserIds ?? []).filter((id) => id !== user.id),
        })),
      )
      setTeams(loadTeamsSafe().filter((team) => team.status === "active"))
      const email = user.email.toLowerCase()
      saveInvites(invitesRef.current.map((invite) => (invite.status === "pending" && invite.email.toLowerCase() === email ? { ...invite, status: "revoked" } : invite)))
      await emitAudit("member_removed", labelOf(user), `${user.name} removed from the club (${ROLE_LABEL[user.role].toLowerCase()})`)
    }
    saveUsers(usersRef.current.filter((item) => item.id !== user.id))
    setConfirm(null)
    notify(`${user.name} removed from the club`, "Their plans, notes and messages are kept.")
    syncBackend()
  }

  /** The teams (not archived) a member coaches, with everyone on them, read fresh for the handover step. */
  const coachedTeamsOf = async (user: ClubUser): Promise<Result<HandoverTeam[]>> => {
    if (!isSupabaseMode) {
      const everyone = loadUsersSafe()
      return ok(
        teamsCoachedBy(
          user.id,
          loadTeamsSafe()
            .filter((team) => team.status !== "archived")
            .map((team) => ({ id: team.id, name: team.name, coaches: mockTeamCoaches(team, everyone) })),
        ),
      )
    }
    const [teamResult, memberResult] = await Promise.all([getClubAdminTeamsSnapshot(), getClubAdminTeamMembers()])
    if (!teamResult.ok) return teamResult
    if (!memberResult.ok) return memberResult
    return ok(
      teamsCoachedBy(
        user.id,
        teamResult.data
          .filter((team) => team.status !== "archived")
          .map((team) => ({
            id: team.id,
            name: team.name,
            coaches: (memberResult.data[team.id]?.coaches ?? []).map((coach) => ({ userId: coach.userId, name: coach.name, role: coach.role, active: coach.active })),
          })),
      ),
    )
  }

  /**
   * Deactivate, remove or hand over. A coach who still coaches a team gets the handover step, so
   * no team is left without a coach. Anyone else gets the plain confirmation.
   */
  const beginStaffAction = async (user: ClubUser, kind: "handover" | "deactivate" | "remove") => {
    setBackendError(null)
    if (user.role === "athlete") {
      if (kind !== "handover") setConfirm({ kind, userId: user.id })
      return
    }
    setBusyKey(`user:${user.id}`)
    const result = await coachedTeamsOf(user)
    setBusyKey(null)
    if (!result.ok) {
      setBackendError(`Could not check which teams ${user.name} coaches: ${result.error.message}`)
      return
    }
    if (result.data.length === 0) {
      if (kind === "handover") notify(`${user.name} does not coach a team`, "There is nothing to hand over.")
      else setConfirm({ kind, userId: user.id })
      return
    }
    setConfirm(null)
    setHandover({ user, then: kind === "handover" ? "none" : kind, teams: result.data })
  }

  const nameOfUser = (userId: string) => usersRef.current.find((item) => item.id === userId)?.name ?? "Coach"

  const submitHandover = (choices: Record<string, HandoverChoice | "">): Promise<Result<HandoverOutcome>> => {
    if (!handover) return Promise.resolve(ok({ teams: 0, threadsClosed: 0, summary: [] }))
    return handOverCoachTeams({ userId: handover.user.id, coachName: handover.user.name, teams: handover.teams, choices, then: handover.then, nameOf: nameOfUser })
  }

  const handleHandoverDone = async (outcome: HandoverOutcome) => {
    if (!handover) return
    const { user, then } = handover
    setHandover(null)
    if (!isSupabaseMode) {
      // The demo keeps coaches on teams in the team list. The database writes these audit entries itself.
      setTeams(loadTeamsSafe().filter((team) => team.status === "active"))
      const after = then === "remove" ? ". Then removed from the club." : then === "deactivate" ? ". Then deactivated." : ""
      await emitAudit("coach_handover", labelOf(user), `${outcome.summary.join("; ") || "no teams to hand over"}${after}`)
      if (then === "remove") {
        const email = user.email.toLowerCase()
        saveInvites(invitesRef.current.map((invite) => (invite.status === "pending" && invite.email.toLowerCase() === email ? { ...invite, status: "revoked" } : invite)))
        await emitAudit("member_removed", labelOf(user), `${user.name} removed from the club (${ROLE_LABEL[user.role].toLowerCase()})`)
      } else if (then === "deactivate") {
        await emitAudit("user_disable", labelOf(user))
      }
    }
    if (!isSupabaseMode) {
      // The demo store was changed by the handover itself: show what it holds now.
      const fresh = loadUsersSafe()
      usersRef.current = fresh
      setUsers(fresh)
    } else if (then === "remove") saveUsers(usersRef.current.filter((item) => item.id !== user.id))
    else if (then === "deactivate") saveUsers(usersRef.current.map((item) => (item.id === user.id ? { ...item, status: "disabled" } : item)))

    const closed = outcome.threadsClosed > 0 ? ` ${outcome.threadsClosed} ${outcome.threadsClosed === 1 ? "conversation was" : "conversations were"} closed, the history is kept.` : ""
    notify(
      then === "remove" ? `${user.name} handed over and removed from the club` : then === "deactivate" ? `${user.name} handed over and deactivated` : `${user.name}'s teams handed over`,
      `${outcome.summary.join(". ")}.${closed}`,
    )
    syncBackend()
    void reloadHandoverRequests()
    if (isSupabaseMode) {
      const directoryResult = await getClubAdminPeopleDirectory()
      if (directoryResult.ok) setDirectory(directoryResult.data)
    }
  }

  const handleDismissRequest = async (request: HandoverRequest) => {
    const result = await dismissHandoverRequest(request.id)
    if (!result.ok) {
      setBackendError(`Could not set the request aside: ${result.error.message}`)
      return
    }
    setHandoverRequests((current) => current.filter((item) => item.id !== request.id))
    notify("Handover request set aside")
  }

  /** Switches an athlete's login for the club off or on. Returns a message when it did not work. */
  const handleSetAthleteLogin = async (athlete: ClubAthlete, active: boolean): Promise<string | null> => {
    if (!athlete.userId) return "This athlete has no login."
    const status: ClubUser["status"] = active ? "active" : "disabled"
    if (isSupabaseMode) {
      const result = await updateProfileRoleAndStatus({ userId: athlete.userId, role: "athlete", status })
      if (!result.ok) return result.error.message
      await emitAudit(active ? "user_enable" : "user_disable", athlete.email ?? athlete.name)
      syncBackend()
      return null
    }
    const existing = usersRef.current.find((user) => user.id === athlete.userId)
    saveUsers(
      existing
        ? usersRef.current.map((user) => (user.id === athlete.userId ? { ...user, status } : user))
        : [...usersRef.current, { id: athlete.userId, name: athlete.name, email: athlete.email ?? "", role: "athlete", status, teamId: athlete.teamId ?? undefined }],
    )
    await emitAudit(active ? "user_enable" : "user_disable", athlete.email ?? athlete.name)
    return null
  }

  const handleReviewRequest = async (request: AccountRequest, status: "approved" | "declined") => {
    setBackendError(null)
    setBusyKey(`request:${request.id}`)
    const email = request.email.trim().toLowerCase()
    let createdInvite: CoachInvite | null = null
    let inviteEmailResult: Result<InviteEmailSent> | null = null
    const staffRole: StaffInviteRole | null = request.role === "coach" ? "coach" : request.role === "club-admin" ? "club-admin" : null

    // Approving a coach or club admin request only means something if they can then join, so create their invite first.
    if (status === "approved" && staffRole) {
      const alreadyInvited = invitesRef.current.some((invite) => invite.status === "pending" && invite.email.toLowerCase() === email)
      if (!alreadyInvited) {
        const inviteResult = await createAndEmailInvite(email, undefined, staffRole)
        if ("error" in inviteResult) {
          setBusyKey(null)
          setBackendError(`Could not approve ${request.fullName}: ${inviteResult.error}`)
          return
        }
        createdInvite = inviteResult.invite
        inviteEmailResult = inviteResult.emailResult
      }
    }

    if (isSupabaseMode) {
      const result = await reviewAccountRequest({ requestId: request.id, status })
      if (!result.ok) {
        setBusyKey(null)
        if (createdInvite) saveInvites([createdInvite, ...invitesRef.current])
        setBackendError(`Could not ${status === "approved" ? "approve" : "decline"} ${request.fullName}: ${result.error.message}`)
        syncBackend()
        return
      }
    }

    setBusyKey(null)
    if (createdInvite && staffRole) {
      saveInvites([createdInvite, ...invitesRef.current])
      await emitAudit("coach_invite_send", email, inviteAuditDetail(staffRole, undefined))
    }
    saveRequests(requests.map((item) => (item.id === request.id ? { ...item, status, reviewedAt: new Date().toISOString() } : item)))
    setConfirm(null)
    await emitAudit(status === "approved" ? "account_request_approve" : "account_request_decline", email, `role ${request.role}`)
    if (status === "declined") {
      notify(`Request from ${request.fullName} declined`)
    } else if (staffRole) {
      const what = staffRole === "coach" ? "coach" : "club admin"
      if (inviteEmailResult && !inviteEmailResult.ok) {
        setBackendError(`${request.fullName} approved, but their invite email was not sent. ${inviteEmailResult.error.message} Copy the link from Invites and send it to them yourself.`)
      } else if (inviteEmailResult) {
        notify(`${request.fullName} approved`, `Their ${what} invite was emailed to ${email}.`)
      } else {
        notify(`${request.fullName} approved`, "They already have an invite waiting under Invites.")
      }
    } else {
      notify(`${request.fullName} approved`, "Athletes join through a team. Use Add athletes to invite them.")
    }
    syncBackend()
  }

  const staffCount = staff.length
  const lede = backendLoading
    ? "Getting your people..."
    : [
        `${staffCount} staff and ${currentAthletes.length} ${currentAthletes.length === 1 ? "athlete" : "athletes"} in your club.`,
        pendingInvites.length > 0 ? `${pendingInvites.length} ${pendingInvites.length === 1 ? "invite is" : "invites are"} waiting to be accepted.` : null,
        packageDefinition && coachLimit !== null ? `${packageDefinition.label} plan: ${activeCoachCount} of ${coachLimit} coaches.` : null,
      ]
        .filter(Boolean)
        .join(" ")

  const staffMenu = (user: ClubUser): RowMenuItem[] => {
    const busy = busyKey === `user:${user.id}`
    const roles = (["club-admin", "coach", "athlete"] as UserRole[]).filter((role) => role !== user.role)
    return [
      ...roles.map((role) => ({ label: `Make ${ROLE_LABEL[role].toLowerCase()}`, onSelect: () => setConfirm({ kind: "role" as const, userId: user.id, role }), disabled: busy })),
      // Only offered to someone who coaches a team, so the item is never a dead end.
      ...(user.role !== "athlete" && teamNamesOf(user).length > 0 ? [{ label: "Hand over teams", onSelect: () => void beginStaffAction(user, "handover"), disabled: busy }] : []),
      user.status === "active"
        ? { label: "Deactivate", onSelect: () => void beginStaffAction(user, "deactivate"), disabled: busy }
        : { label: "Reactivate", onSelect: () => void handleSetStatus(user, "active"), disabled: busy },
      ...(user.role === "athlete" ? [] : [{ label: "Remove from club", onSelect: () => void beginStaffAction(user, "remove"), danger: true, disabled: busy }]),
    ]
  }

  const staffColumns: Array<DataTableColumn<ClubUser>> = [
    {
      key: "person",
      header: "Person",
      cell: (user) => {
        const email = emailOf(user)
        return (
          <span className="flex items-center gap-3">
            <PersonAvatar name={user.name} userId={user.id} email={email} size="sm" />
            <span className="min-w-0">
              {user.name}
              {isSelf(user) ? <span className="font-normal text-sk-mute"> (you)</span> : null}
              <TableSub>
                <span className="block max-sm:truncate sm:break-all">{email || "No email on file"}</span>
              </TableSub>
            </span>
          </span>
        )
      },
    },
    { key: "role", header: "Role", cell: (user) => (user.role === "athlete" ? "Athlete, no athlete record" : ROLE_LABEL[user.role]) },
    {
      key: "teams",
      header: "Teams",
      cell: (user) => {
        const names = teamNamesOf(user)
        return names.length > 0 ? names.join(", ") : <span className="text-sk-mute">No team</span>
      },
    },
    {
      key: "status",
      header: "Status",
      phone: "trailing",
      cell: (user) => (
        <span className="flex min-h-11 items-center justify-between gap-2">
          <StatusText tone={user.status === "active" ? "green" : "neutral"}>{user.status === "active" ? "Active" : "Deactivated"}</StatusText>
          {isSelf(user) ? null : <RowMenu label={`More for ${user.name}`} items={staffMenu(user)} />}
        </span>
      ),
    },
  ]

  const staffConfirm = (user: ClubUser) => {
    if (!confirm || !("userId" in confirm) || confirm.userId !== user.id) return null
    const busy = busyKey === `user:${user.id}`
    if (confirm.kind === "role") {
      const role = confirm.role
      return (
        <InlineConfirm
          question={`Make ${user.name} ${article(role)} ${ROLE_LABEL[role].toLowerCase()}? ${ROLE_CHANGE_EFFECT[role]}`}
          confirmLabel="Change role"
          cancelLabel={`Keep as ${ROLE_LABEL[user.role].toLowerCase()}`}
          busy={busy}
          onConfirm={() => void handleChangeRole(user, role)}
          onCancel={() => setConfirm(null)}
        />
      )
    }
    if (confirm.kind === "deactivate") {
      return (
        <InlineConfirm
          question={`Deactivate ${user.name}? They lose access to the club until you reactivate them. Their teams and history are kept.`}
          confirmLabel="Deactivate"
          cancelLabel="Keep active"
          busy={busy}
          onConfirm={() => void handleSetStatus(user, "disabled")}
          onCancel={() => setConfirm(null)}
        />
      )
    }
    if (confirm.kind === "remove") {
      return (
        <InlineConfirm
          question={`Remove ${user.name} from the club for good? They lose access and come off their teams. The plans, notes and messages they wrote stay, with their name. To switch access off for a while, deactivate them instead.`}
          confirmLabel="Remove from club"
          cancelLabel="Keep in club"
          busy={busy}
          onConfirm={() => void handleRemoveMember(user)}
          onCancel={() => setConfirm(null)}
        />
      )
    }
    return null
  }

  const inviteCount = (status: InviteFilter) => (status === "all" ? invites.length : invites.filter((invite) => invite.status === status).length)

  return (
    <Screen>
      <ScreenHeader
        title="People"
        lede={lede}
        actions={
          <>
            <Button onClick={() => setAddAthletesOpen(true)}>Add athletes</Button>
            <Button variant="primary" onClick={() => openInvite()}>
              <UserPlus className="size-5" weight="bold" aria-hidden />
              Invite staff
            </Button>
          </>
        }
      />

      {backendError ? (
        <Notice
          tone="error"
          action={
            <Button variant="quiet" size="sm" onClick={() => setBackendError(null)}>
              Dismiss
            </Button>
          }
        >
          <span className="break-words">{backendError}</span>
        </Notice>
      ) : null}

      {coachLimitReached && packageDefinition ? (
        <Notice
          tone="warning"
          action={
            !pendingUpgradeRequest && suggestedUpgradePackage ? (
              <Button size="sm" onClick={() => setUpgradeDialogOpen(true)}>
                Request upgrade to {getPackageById(suggestedUpgradePackage)?.label ?? suggestedUpgradePackage}
              </Button>
            ) : undefined
          }
        >
          Your club is at its coach limit
          <span className="mt-0.5 block font-normal">
            {packageDefinition.label} covers {packageDefinition.limits.coaches} coach{packageDefinition.limits.coaches === 1 ? "" : "es"}, so new coach invites are paused.
            {pendingUpgradeRequest ? ` Your upgrade request to ${getPackageById(pendingUpgradeRequest.requestedPackage)?.label ?? pendingUpgradeRequest.requestedPackage} is being reviewed.` : ""}
          </span>
        </Notice>
      ) : null}

      <Tabs
        label="People views"
        value={view}
        onChange={setView}
        options={[
          { value: "staff", label: "Staff", count: backendLoading ? undefined : staffCount },
          { value: "athletes", label: "Athletes", count: athletes ? currentAthletes.length : undefined },
          { value: "guardians", label: "Guardians" },
          { value: "invites", label: "Invites", count: pendingInvites.length > 0 ? pendingInvites.length : undefined },
          { value: "requests", label: "Requests", count: pendingRequests.length > 0 ? pendingRequests.length : undefined },
        ]}
      />

      {view === "staff" ? (
        <Section aria-label="Staff">
          {backendLoading ? (
            <SkeletonRows rows={5} leading label="Loading staff" />
          ) : staff.length === 0 ? (
            <EmptyState
              title="Nobody here yet"
              body="Coaches and club admins appear here once they accept an invite. Start by inviting your first coach."
              action={
                <Button size="sm" onClick={() => openInvite()}>
                  Invite staff
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {handoverRequests.map((request) => {
                const coach = staff.find((user) => user.id === request.coachUserId)
                const names = request.teamIds.map((id) => teamNameById.get(id)).filter((name): name is string => Boolean(name))
                return (
                  <Notice
                    key={request.id}
                    tone="info"
                    action={
                      <span className="flex flex-wrap gap-2">
                        {coach ? (
                          <Button size="sm" onClick={() => void beginStaffAction(coach, "handover")}>
                            Hand over teams
                          </Button>
                        ) : null}
                        <Button size="sm" variant="quiet" onClick={() => void handleDismissRequest(request)}>
                          Set aside
                        </Button>
                      </span>
                    }
                  >
                    <span data-handover-request>
                      {coach?.name ?? "A coach"} asked to hand over {names.length > 0 ? names.join(", ") : "their teams"}
                      {request.note ? <span className="mt-0.5 block font-normal">{request.note}</span> : null}
                    </span>
                  </Notice>
                )
              })}
              <FilterBar
                search={<SearchInput aria-label="Search staff" placeholder="Search by name, email or team" value={search} onChange={(event) => setSearch(event.target.value)} />}
                activeCount={activeFilters}
                onClear={clearFilters}
              >
                <FilterChips
                  label="Role"
                  value={roleFilter}
                  onChange={setRoleFilter}
                  options={[
                    { value: "all", label: "All" },
                    { value: "club-admin", label: "Club admins" },
                    { value: "coach", label: "Coaches" },
                  ]}
                />
                <FilterChips
                  label="Status"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: "all", label: "All" },
                    { value: "active", label: "Active" },
                    { value: "disabled", label: "Deactivated" },
                  ]}
                />
              </FilterBar>
              {visibleStaff.length > 0 ? (
                <DataTable
                  caption="Coaches and club admins of your club"
                  columns={staffColumns}
                  rows={visibleStaff}
                  rowKey={(user) => user.id}
                  rowProps={(user) => ({ "data-person": emailOf(user) || user.name })}
                  rowBelow={staffConfirm}
                />
              ) : (
                <EmptyState
                  title="Nobody matches"
                  body="No coach or club admin fits that search and those filters."
                  action={
                    <Button
                      size="sm"
                      onClick={() => {
                        setSearch("")
                        clearFilters()
                      }}
                    >
                      Show everyone
                    </Button>
                  }
                />
              )}
              {visibleStaff.length > 0 && visibleStaff.length < staff.length ? (
                <p className="text-sm text-sk-mute" aria-live="polite">
                  Showing {visibleStaff.length} of {staff.length}.
                </p>
              ) : null}
            </div>
          )}
        </Section>
      ) : null}

      {view === "athletes" ? (
        <ClubAthletesView
          athletes={athletes}
          loadError={athletesError}
          teams={teamOptions}
          teamName={teamName}
          onChanged={() => {
            void reloadAthletes()
            syncBackend()
          }}
          onSetLogin={handleSetAthleteLogin}
          onAudit={(action, target, detail) => {
            // The database functions write their own audit entries.
            if (!isSupabaseMode) void emitAudit(action, target, detail)
          }}
          onAddAthletes={() => setAddAthletesOpen(true)}
        />
      ) : null}

      {view === "guardians" ? <ClubGuardiansView /> : null}

      {view === "invites" ? (
        <Section
          aria-label="Invites"
          title="Staff invites"
          hint={`Each invite is emailed with a personal link that works for ${COACH_INVITE_VALID_DAYS} days. Open the menu on a waiting invite to email it again, copy its link or cancel it. Athlete invites are on each team.`}
        >
          {backendLoading ? (
            <SkeletonRows rows={3} label="Loading invites" />
          ) : sortedInvites.length === 0 ? (
            <EmptyState
              title="No staff invites yet"
              body="Invite a coach or a club admin and we email them a link to join. The invite appears here, so you can see who has joined and who is still waiting."
              action={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => openInvite()}>
                    Invite staff
                  </Button>
                  <Button size="sm" onClick={() => openInvite({ view: "list", role: "coach" })}>
                    Invite a list
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              <FilterChips
                label="Show"
                value={inviteFilter}
                onChange={setInviteFilter}
                options={[
                  { value: "all", label: "All", count: inviteCount("all") },
                  { value: "pending", label: "Waiting", count: inviteCount("pending") },
                  { value: "accepted", label: "Joined", count: inviteCount("accepted") },
                  { value: "expired", label: "Expired", count: inviteCount("expired") },
                ]}
              />
              {shownInvites.length === 0 ? (
                <EmptyState title="None like that" body="No staff invite is in that state right now." />
              ) : (
                <List aria-label="Staff invites">
                  {shownInvites.map((invite) => {
                    const status = INVITE_STATUS[invite.status]
                    const sent = shortDate(invite.createdAt)
                    const expires = shortDate(invite.expiresAt)
                    const isPending = invite.status === "pending"
                    const canRenew = invite.status === "expired" || invite.status === "revoked"
                    const hasNewerPending = canRenew && pendingInvites.some((item) => item.email.toLowerCase() === invite.email.toLowerCase())
                    const busy = busyKey === `invite:${invite.id}`
                    const emailBusy = busyKey === `invite-email:${invite.id}`
                    const emailInfo = inviteEmailSummary(invite)
                    const invitedTeam = invite.teamId ? teamNameById.get(invite.teamId) : null
                    const roleText = invite.role === "club-admin" ? (invitedTeam ? `Club admin, coaching ${invitedTeam}` : "Club admin") : invitedTeam ? `Coach for ${invitedTeam}` : "Coach, no team yet"
                    const items: RowMenuItem[] = isPending
                      ? [
                          { label: resendInviteEmailLabel(invite, emailBusy), onSelect: () => void handleResendInviteEmail(invite), disabled: emailBusy || !canResendInviteEmail(invite) },
                          { label: "Copy link", onSelect: () => void handleCopyInvite(invite) },
                          ...(isLocalPreviewEnabled
                            ? [{ label: "Open invite", onSelect: () => window.open(toAbsoluteLink(invite.inviteUrl ?? `/invite/coach/${invite.id}`), "_blank", "noopener,noreferrer") }]
                            : []),
                          { label: "Cancel invite", onSelect: () => setConfirm({ kind: "cancel-invite", inviteId: invite.id }), danger: true },
                        ]
                      : canRenew && !hasNewerPending
                        ? [{ label: busy ? "Sending..." : "Send new invite", onSelect: () => void handleRenewInvite(invite), disabled: busy }]
                        : []
                    return (
                      <ActionRow
                        key={invite.id}
                        data-invite={invite.email}
                        data-invite-status={invite.status}
                        data-invite-role={invite.role ?? "coach"}
                        title={<span className="break-all">{invite.email}</span>}
                        subtitle={
                          <>
                            {roleText}
                            {sent ? `. Invited ${sent}` : ""}
                            {isPending && expires ? `, link works until ${expires}` : ""}
                            {invite.status === "expired" && expires ? `, expired ${expires}` : ""}
                            {isPending ? (
                              <span data-invite-email-status className={emailInfo.problem ? "block font-semibold text-sk-coral-ink" : "block"}>
                                {emailInfo.text}
                              </span>
                            ) : null}
                          </>
                        }
                        trailing={<StatusText tone={status.tone}>{status.label}</StatusText>}
                        actions={items.length > 0 ? <RowMenu label={`More for the invite to ${invite.email}`} items={items} /> : undefined}
                        below={
                          confirm?.kind === "cancel-invite" && confirm.inviteId === invite.id ? (
                            <InlineConfirm
                              question={`Cancel the invite to ${invite.email}? Its link stops working straight away.`}
                              confirmLabel="Cancel invite"
                              cancelLabel="Keep it"
                              busy={busy}
                              onConfirm={() => void handleCancelInvite(invite)}
                              onCancel={() => setConfirm(null)}
                            />
                          ) : undefined
                        }
                      />
                    )
                  })}
                </List>
              )}
            </div>
          )}
        </Section>
      ) : null}

      {view === "requests" ? (
        <Section aria-label="Requests" title="Account requests" hint="People who asked to join your club. Approving a coach or a club admin emails them an invite.">
          {backendLoading ? (
            <SkeletonRows rows={3} leading label="Loading requests" />
          ) : sortedRequests.length === 0 ? (
            <EmptyState title="No requests waiting" body="When someone asks to join your club, their request shows up here for you to approve or decline." />
          ) : (
            <List aria-label="Account requests">
              {sortedRequests.map((request) => {
                const isPending = request.status === "pending"
                const status = REQUEST_STATUS[request.status]
                const busy = busyKey === `request:${request.id}`
                const confirming = confirm?.kind === "decline" && confirm.requestId === request.id
                const asked = shortDate(request.createdAt)
                return (
                  <ActionRow
                    key={request.id}
                    data-request={request.email}
                    className="[&_.sk-list-row]:items-start"
                    leading={<Avatar name={request.fullName} />}
                    title={request.fullName}
                    subtitle={
                      <>
                        <span className="block break-all">{request.email}</span>
                        Wants to join as {article(request.role)} {ROLE_LABEL[request.role].toLowerCase()}
                        {request.organization ? `, from ${request.organization}` : ""}
                        {asked ? `. Asked ${asked}` : ""}
                        {request.notes ? <span className="mt-1 block text-sk-ink-2">{request.notes}</span> : null}
                        {isPending ? (
                          <span className="mt-2.5 flex flex-wrap gap-2">
                            <Button size="sm" disabled={busy} onClick={() => void handleReviewRequest(request, "approved")}>
                              {busy && !confirming ? "Saving..." : "Approve"}
                            </Button>
                            <Button size="sm" variant="quiet" disabled={busy} aria-expanded={confirming} onClick={() => setConfirm(confirming ? null : { kind: "decline", requestId: request.id })}>
                              Decline
                            </Button>
                          </span>
                        ) : null}
                      </>
                    }
                    trailing={isPending ? undefined : <StatusText tone={status.tone}>{status.label}</StatusText>}
                    below={
                      confirming ? (
                        <InlineConfirm
                          question={`Decline the request from ${request.fullName}? They will not be added to your club.`}
                          confirmLabel="Decline request"
                          cancelLabel="Keep request"
                          busy={busy}
                          onConfirm={() => void handleReviewRequest(request, "declined")}
                          onCancel={() => setConfirm(null)}
                        />
                      ) : undefined
                    }
                  />
                )
              })}
            </List>
          )}
        </Section>
      ) : null}

      <InviteStaffDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        teams={teamOptions}
        coachLimitMessage={coachLimitReached ? coachLimitMessage : null}
        coachSeatsLeft={coachLimit !== null ? Math.max(coachLimit - activeCoachCount, 0) : null}
        initialRole={inviteStart.role}
        initialView={inviteStart.view}
        checkEmail={checkEmail}
        onCreateOne={handleInviteOne}
        onCreateMany={handleInviteMany}
        onEmailed={handleInviteEmailed}
      />

      <CoachHandoverDialog
        open={Boolean(handover)}
        coach={handover ? { userId: handover.user.id, name: handover.user.name } : null}
        then={handover?.then ?? "none"}
        teams={handover?.teams ?? []}
        candidates={users
          .filter((user) => user.status === "active" && (user.role === "coach" || user.role === "club-admin") && user.id !== handover?.user.id)
          .map((user) => ({ userId: user.id, name: isSelf(user) ? `${user.name} (you)` : user.name }))}
        onClose={() => setHandover(null)}
        onInviteCoach={() => {
          setHandover(null)
          openInvite()
        }}
        onSubmit={submitHandover}
        onDone={(outcome) => void handleHandoverDone(outcome)}
      />

      <AddAthletesToTeam open={addAthletesOpen} onOpenChange={setAddAthletesOpen} teams={teamOptions} onChanged={() => void reloadAthletes()} />

      <UpgradeRequestDialog
        open={upgradeDialogOpen}
        onOpenChange={setUpgradeDialogOpen}
        currentPackage={requestedPlan}
        targetPackage={suggestedUpgradePackage}
        placeholder="Tell us why your club needs more coaches."
        onSent={(requestedPackage) => {
          setPendingUpgradeRequest({ requestedPackage, createdAt: new Date().toISOString() })
          setBackendError(null)
        }}
      />
    </Screen>
  )
}
