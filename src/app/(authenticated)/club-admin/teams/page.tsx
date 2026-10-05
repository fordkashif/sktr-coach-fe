"use client"

import {
  Archive,
  ArrowCounterClockwise,
  ArrowRight,
  CaretDown,
  PencilSimple,
  Plus,
  Trash,
  UserPlus,
  UsersThree,
  X,
} from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { InviteAthleteDialog } from "@/components/coach/team-detail-content"
import { EmptyState, Initials, PageHeader, Panel, Segmented, Tag, type TagTone } from "@/components/sk"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import {
  createClubAdminTeam,
  getClubAdminAssignableCoachOptions,
  getClubAdminPackageUpgradeRequests,
  getClubAdminTeamMembers,
  getClubAdminTeamsSnapshot,
  getCurrentClubAdminActivationState,
  insertAuditEvent,
  removeClubAdminTeamCoach,
  setClubAdminTeamArchived,
  setClubAdminTeamCoaches,
  setClubAdminTeamLeadCoach,
  submitClubAdminPackageUpgradeRequest,
  updateClubAdminTeam,
  type ClubAdminAssignableCoachOption,
} from "@/lib/data/club-admin/ops-data"
import { removeAthleteFromTeamForCurrentCoach } from "@/lib/data/coach/teams-data"
import { getNextPackageTier, getPackageById, type PackageId } from "@/lib/billing/package-catalog"
import { type EventGroup } from "@/lib/mock-data"
import { type ClubTeam } from "@/lib/mock-club-admin"
import { getBackendMode } from "@/lib/supabase/config"
import { cn } from "@/lib/utils"
import { loadTeamsSafe, loadUsersSafe, persistTeams } from "../state"

const EVENT_GROUP_OPTIONS: EventGroup[] = ["Sprint", "Mid", "Distance", "Jumps", "Throws"]

type TeamCoach = { userId: string; name: string; isPrimary: boolean; isSelf: boolean }
type TeamAthlete = { id: string; name: string; primaryEvent: string | null }

type TeamRow = {
  id: string
  name: string
  eventGroup: EventGroup
  status: "draft" | "active" | "archived"
  coaches: TeamCoach[]
  athletes: TeamAthlete[]
  /** Lead label from the server, used only when the lead is not in the coaches list. */
  leadCoachLabel?: string
}

type TeamForm = {
  mode: "create" | "edit"
  teamId?: string
  name: string
  eventGroup: EventGroup
  leadId: string
  extraIds: string[]
}

type Confirm =
  | { kind: "archive"; teamId: string }
  | { kind: "remove-coach"; teamId: string; userId: string }
  | { kind: "remove-athlete"; teamId: string; athleteId: string }

const STATUS_TAG: Record<TeamRow["status"], { label: string; tone: TagTone }> = {
  draft: { label: "Draft", tone: "yellow" },
  active: { label: "Active", tone: "green" },
  archived: { label: "Archived", tone: "plain" },
}

const alertClass = "rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]"
const dialogClass = "max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto rounded-[20px] border-sk-line bg-white p-5 shadow-none sm:max-w-lg sm:p-6"

/**
 * Athletes taken off a roster in mock mode. Mock athletes are static, so this keeps a removed
 * athlete off the roster for the rest of the browser session.
 */
const removedMockAthleteIds = new Set<string>()

function toEventGroup(value: string | null | undefined): EventGroup {
  if (value === "Sprint" || value === "Mid" || value === "Distance" || value === "Jumps" || value === "Throws") return value
  return "Sprint"
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

export default function ClubAdminTeamsPage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [coachOptions, setCoachOptions] = useState<ClubAdminAssignableCoachOption[]>([])
  const [mockTeamPageIds, setMockTeamPageIds] = useState<Set<string>>(new Set())
  const [requestedPlan, setRequestedPlan] = useState<PackageId | null>(null)
  const [backendLoading, setBackendLoading] = useState(true)
  const [error, setError] = useState<{ message: string; teamId?: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [view, setView] = useState<"active" | "archived">("active")
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [form, setForm] = useState<TeamForm | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false)
  const [upgradeReason, setUpgradeReason] = useState("")
  const [upgradeSaving, setUpgradeSaving] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)
  const [pendingUpgradeRequest, setPendingUpgradeRequest] = useState<{ requestedPackage: PackageId; createdAt: string } | null>(null)
  const [mockAuditLogger, setMockAuditLogger] = useState<((event: {
    actor: string
    action: string
    target: string
    detail?: string
  }) => void) | null>(null)

  const activeTeams = useMemo(() => teams.filter((team) => team.status !== "archived"), [teams])
  const archivedTeams = useMemo(() => teams.filter((team) => team.status === "archived"), [teams])
  const totalAthletes = useMemo(() => teams.reduce((sum, team) => sum + team.athletes.length, 0), [teams])
  const packageDefinition = useMemo(() => getPackageById(requestedPlan), [requestedPlan])
  const teamLimitReached = Boolean(packageDefinition && activeTeams.length >= packageDefinition.limits.teams)
  const athleteLimitReached = Boolean(packageDefinition && totalAthletes >= packageDefinition.limits.athletes)
  const suggestedUpgradePackage = getNextPackageTier(requestedPlan)
  const teamLimitMessage = packageDefinition
    ? `${packageDefinition.label} allows up to ${packageDefinition.limits.teams} active team${packageDefinition.limits.teams === 1 ? "" : "s"}. Upgrade the package or archive a team first.`
    : "This club has reached the package limit for teams."

  const emitAudit = async (action: string, target: string, detail?: string) => {
    if (isSupabaseMode) {
      const result = await insertAuditEvent({ action, target, detail })
      if (!result.ok) {
        setError((current) => current ?? { message: `The change was saved, but the audit log entry failed: ${result.error.message}` })
      }
      return
    }
    mockAuditLogger?.({ actor: "club-admin", action, target, detail })
  }

  const loadMock = useCallback(async () => {
    const mockData = await import("@/lib/mock-data")
    const users = loadUsersSafe()
    const userById = new Map(users.map((user) => [user.id, user]))
    const toCoach = (userId: string, isPrimary: boolean): TeamCoach | null => {
      const user = userById.get(userId)
      return user ? { userId, name: user.name, isPrimary, isSelf: user.role === "club-admin" } : null
    }

    const rows: TeamRow[] = loadTeamsSafe().map((team) => ({
      id: team.id,
      name: team.name,
      eventGroup: team.eventGroup,
      status: team.status,
      coaches: [
        team.coachUserId ? toCoach(team.coachUserId, true) : null,
        ...(team.coachUserIds ?? []).filter((id) => id !== team.coachUserId).map((id) => toCoach(id, false)),
      ].filter((coach): coach is TeamCoach => coach !== null),
      athletes: mockData.mockAthletes
        .filter((athlete) => athlete.teamId === team.id && !removedMockAthleteIds.has(athlete.id))
        .map((athlete) => ({ id: athlete.id, name: athlete.name, primaryEvent: athlete.primaryEvent })),
      leadCoachLabel: team.coachEmail,
    }))

    return {
      rows,
      coachOptions: users
        .filter((user) => user.status === "active" && (user.role === "coach" || user.role === "club-admin"))
        .map((user) => ({
          userId: user.id,
          name: user.name,
          email: user.email,
          label: `${user.name}${user.email ? ` (${user.email})` : ""}`,
          isSelf: user.role === "club-admin",
        })),
      teamPageIds: new Set(mockData.mockTeams.map((team) => team.id)),
    }
  }, [])

  /** Loads everything from the current backend. Returns false when the team list could not be loaded. */
  const reload = useCallback(async (): Promise<boolean> => {
    if (!isSupabaseMode) {
      const mock = await loadMock()
      setTeams(mock.rows)
      setCoachOptions(mock.coachOptions)
      setMockTeamPageIds(mock.teamPageIds)
      return true
    }

    const [teamResult, membersResult, coachResult] = await Promise.all([
      getClubAdminTeamsSnapshot(),
      getClubAdminTeamMembers(),
      getClubAdminAssignableCoachOptions(),
    ])

    const failure = !teamResult.ok ? teamResult.error : !membersResult.ok ? membersResult.error : !coachResult.ok ? coachResult.error : null
    if (failure || !teamResult.ok || !membersResult.ok || !coachResult.ok) {
      setError({ message: `Could not load teams: ${failure?.message ?? "unknown error"}` })
      return false
    }

    setTeams(
      teamResult.data.map((team) => ({
        id: team.id,
        name: team.name,
        eventGroup: toEventGroup(team.eventGroup),
        status: team.status,
        coaches: membersResult.data[team.id]?.coaches ?? [],
        athletes: membersResult.data[team.id]?.athletes ?? [],
        leadCoachLabel: team.leadCoachLabel,
      })),
    )
    setCoachOptions(coachResult.data)
    return true
  }, [isSupabaseMode, loadMock])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setBackendLoading(true)
      const loaded = await reload()
      if (cancelled) return
      setBackendLoading(false)
      if (!loaded || !isSupabaseMode) return

      const [activationResult, upgradeResult] = await Promise.all([
        getCurrentClubAdminActivationState(),
        getClubAdminPackageUpgradeRequests(),
      ])
      if (cancelled) return
      if (!activationResult.ok) {
        setError({ message: `Could not load your package limits: ${activationResult.error.message}` })
        return
      }
      setRequestedPlan(activationResult.data.requestedPlan)
      if (!upgradeResult.ok) {
        setError({ message: `Could not load upgrade requests: ${upgradeResult.error.message}` })
        return
      }
      const firstPendingUpgrade = upgradeResult.data.find((item) => item.status === "pending") ?? null
      setPendingUpgradeRequest(
        firstPendingUpgrade
          ? { requestedPackage: firstPendingUpgrade.requestedPackage, createdAt: firstPendingUpgrade.createdAt }
          : null,
      )
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode, reload])

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
    setError(null)
  }

  const coachName = (userId: string) => {
    const option = coachOptions.find((coach) => coach.userId === userId)
    if (option) return option.isSelf ? `${option.name} (you)` : option.name
    for (const team of teams) {
      const coach = team.coaches.find((item) => item.userId === userId)
      if (coach) return coach.isSelf ? `${coach.name} (you)` : coach.name
    }
    return "Coach"
  }

  const openCreate = () => {
    setFormError(null)
    setForm({ mode: "create", name: "", eventGroup: "Sprint", leadId: "none", extraIds: [] })
  }

  const openEdit = (team: TeamRow) => {
    setFormError(null)
    setForm({
      mode: "edit",
      teamId: team.id,
      name: team.name,
      eventGroup: team.eventGroup,
      leadId: team.coaches.find((coach) => coach.isPrimary)?.userId ?? "none",
      extraIds: team.coaches.filter((coach) => !coach.isPrimary).map((coach) => coach.userId),
    })
  }

  /** Coaches offered in the form: everyone assignable, plus anyone already on the team being edited. */
  const formCoachIds = useMemo(() => {
    const ids = coachOptions.map((coach) => coach.userId)
    const editing = form?.teamId ? teams.find((team) => team.id === form.teamId) : null
    for (const coach of editing?.coaches ?? []) {
      if (!ids.includes(coach.userId)) ids.push(coach.userId)
    }
    return ids
  }, [coachOptions, form?.teamId, teams])

  const saveMockTeams = async (update: (current: ClubTeam[]) => ClubTeam[]) => {
    persistTeams(update(loadTeamsSafe()))
    await reload()
  }

  const handleSaveForm = async () => {
    if (!form) return
    const name = form.name.trim()
    if (!name) {
      setFormError("Give the team a name.")
      return
    }
    if (teams.some((team) => team.id !== form.teamId && team.name.trim().toLowerCase() === name.toLowerCase())) {
      setFormError(`There is already a team called ${name}. Pick a different name.`)
      return
    }
    if (form.mode === "create" && teamLimitReached) {
      setFormError(teamLimitMessage)
      return
    }

    const leadId = form.leadId === "none" ? null : form.leadId
    const extraIds = form.extraIds.filter((id) => id !== leadId)
    setSaving(true)
    setFormError(null)

    if (form.mode === "create") {
      if (isSupabaseMode) {
        const result = await createClubAdminTeam({
          name,
          eventGroup: form.eventGroup,
          leadCoachUserId: leadId,
          leadCoachLabel: leadId ? coachName(leadId) : null,
        })
        if (!result.ok) {
          setSaving(false)
          setFormError(result.error.message)
          // The team row may exist even when the coach assignment failed, so show the real state.
          void reload()
          return
        }
        if (extraIds.length > 0) {
          const coachResult = await setClubAdminTeamCoaches({ teamId: result.data.id, leadCoachUserId: leadId, coachUserIds: extraIds })
          if (!coachResult.ok) {
            setError({ message: `${name} was created, but the additional coaches were not saved: ${coachResult.error.message}` })
          }
        }
        await reload()
      } else {
        const users = loadUsersSafe()
        const lead = users.find((user) => user.id === leadId)
        await saveMockTeams((current) => [
          {
            id: `team-${Date.now()}`,
            name,
            eventGroup: form.eventGroup,
            status: "active",
            coachUserId: lead?.id,
            coachEmail: lead?.email,
            coachUserIds: extraIds,
          },
          ...current,
        ])
      }
      await emitAudit("team_create", name, leadId ? `lead ${coachName(leadId)}` : "no lead coach")
      setNotice(`${name} created.`)
      setView("active")
    } else if (form.teamId) {
      const teamId = form.teamId
      const existing = teams.find((team) => team.id === teamId)
      if (isSupabaseMode) {
        const updateResult = await updateClubAdminTeam({
          teamId,
          name,
          eventGroup: form.eventGroup,
          status: existing?.status ?? "active",
        })
        if (!updateResult.ok) {
          setSaving(false)
          setFormError(updateResult.error.message)
          return
        }
        const coachResult = await setClubAdminTeamCoaches({ teamId, leadCoachUserId: leadId, coachUserIds: extraIds })
        if (!coachResult.ok) {
          setSaving(false)
          setFormError(`The team details were saved, but the coaches were not: ${coachResult.error.message}`)
          void reload()
          return
        }
        await reload()
      } else {
        const users = loadUsersSafe()
        const lead = users.find((user) => user.id === leadId)
        await saveMockTeams((current) =>
          current.map((team) =>
            team.id === teamId
              ? { ...team, name, eventGroup: form.eventGroup, coachUserId: lead?.id, coachEmail: lead?.email, coachUserIds: extraIds }
              : team,
          ),
        )
      }
      await emitAudit("team_update", name, leadId ? `lead ${coachName(leadId)}` : "no lead coach")
      setNotice(`${name} saved.`)
    }

    setSaving(false)
    setError(null)
    setForm(null)
  }

  const handleArchiveToggle = async (team: TeamRow, archived: boolean) => {
    setError(null)
    setNotice(null)
    if (!archived && team.status === "archived" && teamLimitReached) {
      setError({ message: teamLimitMessage, teamId: team.id })
      return
    }
    setBusyKey(`team:${team.id}`)

    if (isSupabaseMode) {
      const result = await setClubAdminTeamArchived({ teamId: team.id, archived })
      if (!result.ok) {
        setBusyKey(null)
        setError({ message: `Could not ${archived ? "archive" : "update"} ${team.name}: ${result.error.message}`, teamId: team.id })
        return
      }
      await reload()
    } else {
      await saveMockTeams((current) =>
        current.map((item) => (item.id === team.id ? { ...item, status: archived ? "archived" : "active" } : item)),
      )
    }

    setBusyKey(null)
    setConfirm(null)
    setExpandedTeamId(null)
    await emitAudit(archived ? "team_archive" : "team_restore", team.name)
    setNotice(
      archived
        ? `${team.name} archived. Find it under Archived to bring it back.`
        : team.status === "draft"
          ? `${team.name} is now active.`
          : `${team.name} restored.`,
    )
  }

  const handleMakeLead = async (team: TeamRow, coach: TeamCoach) => {
    setError(null)
    setNotice(null)
    setBusyKey(`coach:${team.id}:${coach.userId}`)
    if (isSupabaseMode) {
      const result = await setClubAdminTeamLeadCoach({ teamId: team.id, leadCoachUserId: coach.userId })
      if (!result.ok) {
        setBusyKey(null)
        setError({ message: `Could not make ${coach.name} the lead coach: ${result.error.message}`, teamId: team.id })
        void reload()
        return
      }
      await reload()
    } else {
      const users = loadUsersSafe()
      const lead = users.find((user) => user.id === coach.userId)
      await saveMockTeams((current) =>
        current.map((item) =>
          item.id === team.id
            ? {
                ...item,
                coachUserId: coach.userId,
                coachEmail: lead?.email,
                coachUserIds: [...(item.coachUserId ? [item.coachUserId] : []), ...(item.coachUserIds ?? [])].filter(
                  (id, index, all) => id !== coach.userId && all.indexOf(id) === index,
                ),
              }
            : item,
        ),
      )
    }
    setBusyKey(null)
    await emitAudit("team_lead_coach_set", team.name, coach.name)
    setNotice(`${coach.name} is now lead coach of ${team.name}.`)
  }

  const handleRemoveCoach = async (team: TeamRow, coach: TeamCoach) => {
    setError(null)
    setNotice(null)
    setBusyKey(`coach:${team.id}:${coach.userId}`)
    if (isSupabaseMode) {
      const result = await removeClubAdminTeamCoach({ teamId: team.id, userId: coach.userId })
      if (!result.ok) {
        setBusyKey(null)
        setError({ message: `Could not remove ${coach.name}: ${result.error.message}`, teamId: team.id })
        void reload()
        return
      }
      await reload()
    } else {
      await saveMockTeams((current) =>
        current.map((item) =>
          item.id === team.id
            ? {
                ...item,
                coachUserId: item.coachUserId === coach.userId ? undefined : item.coachUserId,
                coachEmail: item.coachUserId === coach.userId ? undefined : item.coachEmail,
                coachUserIds: (item.coachUserIds ?? []).filter((id) => id !== coach.userId),
              }
            : item,
        ),
      )
    }
    setBusyKey(null)
    setConfirm(null)
    await emitAudit("team_coach_remove", team.name, coach.name)
    setNotice(`${coach.name} removed from ${team.name}.`)
  }

  const handleRemoveAthlete = async (team: TeamRow, athlete: TeamAthlete) => {
    setError(null)
    setNotice(null)
    setBusyKey(`athlete:${athlete.id}`)
    if (isSupabaseMode) {
      const result = await removeAthleteFromTeamForCurrentCoach({ athleteId: athlete.id, teamId: team.id })
      if (!result.ok) {
        setBusyKey(null)
        setError({ message: `Could not remove ${athlete.name}: ${result.error.message}`, teamId: team.id })
        void reload()
        return
      }
    } else {
      removedMockAthleteIds.add(athlete.id)
    }
    await reload()
    setBusyKey(null)
    setConfirm(null)
    await emitAudit("team_athlete_remove", team.name, athlete.name)
    setNotice(`${athlete.name} removed from ${team.name}. They keep their account and history.`)
  }

  const visibleTeams = view === "active" ? activeTeams : archivedTeams
  const hasTeamPage = (team: TeamRow) => team.status === "active" && (isSupabaseMode || mockTeamPageIds.has(team.id))

  const lede = backendLoading
    ? "Loading teams..."
    : [
        `${plural(activeTeams.length, "active team")} with ${plural(totalAthletes, "athlete")} on the rosters.`,
        packageDefinition && Number.isFinite(packageDefinition.limits.teams)
          ? `${packageDefinition.label} plan: ${activeTeams.length} of ${packageDefinition.limits.teams} teams, ${totalAthletes} of ${packageDefinition.limits.athletes} athletes.`
          : null,
      ]
        .filter(Boolean)
        .join(" ")

  const count = (value: number) => <span className="ml-1.5 tabular-nums text-sk-mute">{value}</span>
  const iconAction = "sk-btn sk-btn-ghost sk-btn-sm w-9 shrink-0 px-0 max-md:size-11"

  const confirmBox = (message: ReactNode, keepLabel: string, actionLabel: string, busy: boolean, onConfirm: () => void) => (
    <div role="group" aria-label="Confirm" className="flex flex-col gap-3 rounded-2xl bg-sk-coral-tint p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-sk-ink">{message}</p>
      <div className="flex shrink-0 gap-2">
        <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm max-sm:h-11 max-sm:flex-1" onClick={() => setConfirm(null)}>
          {keepLabel}
        </button>
        <button type="button" className="sk-btn sk-btn-danger sk-btn-sm max-sm:h-11 max-sm:flex-1" disabled={busy} onClick={onConfirm}>
          {busy ? "Saving..." : actionLabel}
        </button>
      </div>
    </div>
  )

  return (
    <div className="sk-page">
      <PageHeader
        title="Teams"
        lede={lede}
        actions={
          <button type="button" className="sk-btn sk-btn-primary w-full sm:w-auto" onClick={openCreate}>
            <Plus className="size-5" weight="bold" />
            New team
          </button>
        }
      />

      {error && !error.teamId ? (
        <div role="alert" className={`${alertClass} flex items-start justify-between gap-3`}>
          <p className="min-w-0 break-words">{error.message}</p>
          <button type="button" className="-my-1 shrink-0 rounded-lg p-1 hover:bg-white/60" aria-label="Dismiss message" onClick={() => setError(null)}>
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

      {packageDefinition && (teamLimitReached || athleteLimitReached) ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-sk-yellow-tint px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-sk-ink">
            <span className="font-bold">
              Your club is at its {teamLimitReached && athleteLimitReached ? "team and athlete" : teamLimitReached ? "team" : "athlete"} limit.
            </span>{" "}
            {packageDefinition.label} covers {plural(packageDefinition.limits.teams, "team")} and {plural(packageDefinition.limits.athletes, "athlete")}.
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

      <Segmented
        label="Team status"
        value={view}
        onChange={(next) => {
          setView(next)
          setConfirm(null)
          setExpandedTeamId(null)
        }}
        options={[
          { value: "active", label: <>Active{count(activeTeams.length)}</> },
          { value: "archived", label: <>Archived{count(archivedTeams.length)}</> },
        ]}
      />

      <Panel flush>
        {backendLoading ? (
          <p className="p-6 text-sm text-sk-mute">Loading teams...</p>
        ) : visibleTeams.length === 0 ? (
          <div className="p-5 sm:p-6">
            {view === "active" ? (
              <EmptyState
                icon={<UsersThree className="size-6" weight="fill" />}
                title="No teams yet"
                body="Teams hold your coaches, rosters, plans and testing. Create the first one, give it a lead coach, then invite athletes into it."
                action={
                  <button type="button" className="sk-btn sk-btn-ink sk-btn-sm" onClick={openCreate}>
                    <Plus className="size-4" weight="bold" />
                    New team
                  </button>
                }
                className="border-0 bg-sk-canvas"
              />
            ) : (
              <EmptyState
                icon={<Archive className="size-6" weight="fill" />}
                title="Nothing archived"
                body="Teams you archive are kept here with their roster and history, ready to restore."
                className="border-0 bg-sk-canvas"
              />
            )}
          </div>
        ) : (
          <>
            <div className="relative hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_100px_96px_250px] gap-3 border-b border-sk-line px-6 py-3 text-sm font-semibold text-sk-mute lg:grid">
              <span>Team</span>
              <span>Lead coach</span>
              <span>Athletes</span>
              <span>Status</span>
              <span className="sr-only">Actions</span>
            </div>
            <ul>
              {visibleTeams.map((team) => {
                const expanded = expandedTeamId === team.id
                const lead = team.coaches.find((coach) => coach.isPrimary)
                const leadName = lead ? (lead.isSelf ? `${lead.name} (you)` : lead.name) : null
                const extraCoachCount = team.coaches.length - (lead ? 1 : 0)
                const status = STATUS_TAG[team.status]
                const teamBusy = busyKey === `team:${team.id}`
                const archiveConfirm = confirm?.kind === "archive" && confirm.teamId === team.id
                return (
                  <li key={team.id} data-team={team.name} className="relative border-b border-sk-line last:border-b-0">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_100px_96px_250px]">
                      <button
                        type="button"
                        className="group flex min-w-0 items-center gap-3 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
                        aria-expanded={expanded}
                        aria-controls={`team-detail-${team.id}`}
                        onClick={() => {
                          setExpandedTeamId(expanded ? null : team.id)
                          setConfirm(null)
                        }}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sk-canvas text-sk-ink-2 group-hover:bg-sk-blue-tint group-hover:text-sk-blue">
                          <CaretDown className={cn("size-4 transition-transform", expanded && "rotate-180")} weight="bold" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-sk-ink group-hover:text-sk-blue">{team.name}</span>
                          <span className="block truncate text-sm text-sk-mute">
                            {team.eventGroup}
                            <span className="sr-only">. {expanded ? "Hide" : "Show"} coaches and roster</span>
                          </span>
                        </span>
                      </button>

                      <div className="max-lg:col-span-2 max-lg:row-start-2 flex min-w-0 items-center gap-2 text-sm">
                        <span className="text-sk-mute lg:hidden">Lead coach</span>
                        {leadName ? (
                          <span className="min-w-0 truncate font-semibold text-sk-ink">
                            {leadName}
                            {extraCoachCount > 0 ? <span className="font-normal text-sk-mute"> +{extraCoachCount} more</span> : null}
                          </span>
                        ) : (
                          <span className="text-sk-mute">
                            {team.coaches.length > 0 ? `No lead, ${team.coaches.length} ${team.coaches.length === 1 ? "coach" : "coaches"}` : "Not assigned"}
                          </span>
                        )}
                      </div>

                      <div className="max-lg:col-span-2 max-lg:row-start-3 text-sm text-sk-ink-2">
                        <span className="font-bold tabular-nums text-sk-ink">{team.athletes.length}</span>
                        <span className="lg:hidden"> {team.athletes.length === 1 ? "athlete" : "athletes"}</span>
                      </div>

                      <div className="max-lg:col-start-2 max-lg:row-start-1">
                        <Tag tone={status.tone}>{status.label}</Tag>
                      </div>

                      <div className="max-lg:col-span-2 flex flex-wrap items-center gap-2 lg:justify-end">
                        {team.status === "active" ? (
                          <InviteAthleteDialog
                            teamId={team.id}
                            teamName={team.name}
                            onCreated={(invite) => void emitAudit("athlete_invite_send", invite.email, `team ${team.name}`)}
                            trigger={
                              <button
                                type="button"
                                className="sk-btn sk-btn-quiet sk-btn-sm max-md:h-11 max-md:flex-1"
                                disabled={athleteLimitReached}
                                title={athleteLimitReached ? "Your club is at its athlete limit" : undefined}
                              >
                                <UserPlus className="size-4" weight="bold" />
                                Invite athlete
                              </button>
                            }
                          />
                        ) : (
                          <button
                            type="button"
                            className="sk-btn sk-btn-quiet sk-btn-sm max-md:h-11 max-md:flex-1"
                            disabled={teamBusy}
                            onClick={() => void handleArchiveToggle(team, false)}
                          >
                            {team.status === "archived" ? <ArrowCounterClockwise className="size-4" weight="bold" /> : null}
                            {teamBusy ? "Saving..." : team.status === "archived" ? "Restore team" : "Make active"}
                          </button>
                        )}
                        <button type="button" className={iconAction} aria-label={`Edit ${team.name}`} title="Edit team" onClick={() => openEdit(team)}>
                          <PencilSimple className="size-4" weight="bold" />
                        </button>
                        {team.status !== "archived" ? (
                          <button
                            type="button"
                            className={`${iconAction} hover:bg-sk-coral-tint hover:text-[#c7300f]`}
                            aria-label={`Archive ${team.name}`}
                            aria-expanded={archiveConfirm}
                            title="Archive team"
                            onClick={() => setConfirm(archiveConfirm ? null : { kind: "archive", teamId: team.id })}
                          >
                            <Archive className="size-4" weight="bold" />
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {error?.teamId === team.id ? (
                      <p role="alert" className={`${alertClass} mx-5 mb-4 sm:mx-6`}>
                        {error.message}
                      </p>
                    ) : null}

                    {archiveConfirm ? (
                      <div className="px-5 pb-4 sm:px-6">
                        {confirmBox(
                          <>
                            <span className="font-bold">Archive {team.name}?</span> Coaches and athletes stop seeing it. The roster and history are kept, and you can restore it any time.
                          </>,
                          "Keep team",
                          "Archive team",
                          teamBusy,
                          () => void handleArchiveToggle(team, true),
                        )}
                      </div>
                    ) : null}

                    {expanded ? (
                      <div id={`team-detail-${team.id}`} className="grid gap-x-10 gap-y-6 border-t border-sk-line bg-sk-canvas px-5 py-5 sm:px-6 lg:grid-cols-2">
                        <section aria-label={`Coaches on ${team.name}`}>
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="sk-h3">Coaches</h3>
                            <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm -mr-2" onClick={() => openEdit(team)}>
                              {team.coaches.length > 0 ? "Change coaches" : "Assign coaches"}
                            </button>
                          </div>
                          {team.coaches.length === 0 ? (
                            <p className="mt-2 text-sm text-sk-mute">
                              No coaches on this team yet. {team.leadCoachLabel ? `The record lists ${team.leadCoachLabel} as lead.` : "Assign a lead coach so someone owns the roster."}
                            </p>
                          ) : (
                            <ul className="mt-1">
                              {team.coaches.map((coach) => {
                                const key = `coach:${team.id}:${coach.userId}`
                                const confirming = confirm?.kind === "remove-coach" && confirm.teamId === team.id && confirm.userId === coach.userId
                                return (
                                  <li key={coach.userId} className="border-b border-sk-line py-2.5 last:border-b-0">
                                    <div className="flex items-center gap-3">
                                      <Initials name={coach.name} size="sm" />
                                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-sk-ink">
                                        {coach.name}
                                        {coach.isSelf ? <span className="font-normal text-sk-mute"> (you)</span> : null}
                                      </span>
                                      {coach.isPrimary ? (
                                        <Tag tone="blue">Lead</Tag>
                                      ) : team.status !== "archived" ? (
                                        <button
                                          type="button"
                                          className="sk-btn sk-btn-ghost sk-btn-sm max-md:h-11"
                                          disabled={busyKey === key}
                                          onClick={() => void handleMakeLead(team, coach)}
                                        >
                                          {busyKey === key && !confirming ? "Saving..." : "Make lead"}
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        className="sk-btn sk-btn-ghost size-11 shrink-0 px-0 hover:bg-sk-coral-tint hover:text-[#c7300f] md:size-9"
                                        aria-label={`Remove ${coach.name} from ${team.name}`}
                                        aria-expanded={confirming}
                                        onClick={() => setConfirm(confirming ? null : { kind: "remove-coach", teamId: team.id, userId: coach.userId })}
                                      >
                                        <Trash className="size-4" weight="bold" />
                                      </button>
                                    </div>
                                    {confirming ? (
                                      <div className="mt-2">
                                        {confirmBox(
                                          <>
                                            <span className="font-bold">Remove {coach.name} from {team.name}?</span> They lose access to this team only.
                                          </>,
                                          "Keep",
                                          "Remove coach",
                                          busyKey === key,
                                          () => void handleRemoveCoach(team, coach),
                                        )}
                                      </div>
                                    ) : null}
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </section>

                        <section aria-label={`Roster of ${team.name}`}>
                          <div className="flex min-h-9 items-center justify-between gap-3">
                            <h3 className="sk-h3">Roster</h3>
                            {hasTeamPage(team) ? (
                              <Link to={`/coach/teams/${team.id}`} className="sk-btn sk-btn-ghost sk-btn-sm -mr-2">
                                Open team page
                                <ArrowRight className="size-4" weight="bold" />
                              </Link>
                            ) : null}
                          </div>
                          {team.athletes.length === 0 ? (
                            <p className="mt-2 text-sm text-sk-mute">
                              No athletes yet. {team.status === "active" ? "Invite an athlete and they appear here once they accept." : "Athletes can be invited once the team is active."}
                            </p>
                          ) : (
                            <ul className="mt-1">
                              {team.athletes.map((athlete) => {
                                const key = `athlete:${athlete.id}`
                                const confirming = confirm?.kind === "remove-athlete" && confirm.teamId === team.id && confirm.athleteId === athlete.id
                                return (
                                  <li key={athlete.id} className="border-b border-sk-line py-2.5 last:border-b-0">
                                    <div className="flex items-center gap-3">
                                      <Initials name={athlete.name} size="sm" />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-semibold text-sk-ink">{athlete.name}</span>
                                        {athlete.primaryEvent ? <span className="block truncate text-sm text-sk-mute">{athlete.primaryEvent}</span> : null}
                                      </span>
                                      <button
                                        type="button"
                                        className="sk-btn sk-btn-ghost size-11 shrink-0 px-0 hover:bg-sk-coral-tint hover:text-[#c7300f] md:size-9"
                                        aria-label={`Remove ${athlete.name} from ${team.name}`}
                                        aria-expanded={confirming}
                                        onClick={() => setConfirm(confirming ? null : { kind: "remove-athlete", teamId: team.id, athleteId: athlete.id })}
                                      >
                                        <Trash className="size-4" weight="bold" />
                                      </button>
                                    </div>
                                    {confirming ? (
                                      <div className="mt-2">
                                        {confirmBox(
                                          <>
                                            <span className="font-bold">Remove {athlete.name} from {team.name}?</span> They keep their account and training history.
                                          </>,
                                          "Keep",
                                          "Remove from roster",
                                          busyKey === key,
                                          () => void handleRemoveAthlete(team, athlete),
                                        )}
                                      </div>
                                    ) : null}
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </section>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Panel>

      <p className="text-sm text-sk-mute">
        Need to step in on a coach's work? Open{" "}
        <Link to="/coach/training-plan" className="font-semibold text-sk-blue hover:underline">
          training plans
        </Link>{" "}
        or{" "}
        <Link to="/coach/test-week" className="font-semibold text-sk-blue hover:underline">
          test weeks
        </Link>
        .
      </p>

      <Dialog
        open={Boolean(form)}
        onOpenChange={(next) => {
          if (!next) {
            setForm(null)
            setFormError(null)
          }
        }}
      >
        <DialogContent showCloseButton={false} className={dialogClass}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="sk-h2">{form?.mode === "edit" ? "Edit team" : "New team"}</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed text-sk-mute">
                {form?.mode === "edit"
                  ? "Change the name, event group and who coaches this team."
                  : "Name the team and pick who coaches it. You can invite athletes straight after."}
              </DialogDescription>
            </div>
            <DialogClose className="sk-btn sk-btn-ghost size-11 shrink-0 px-0" aria-label="Close">
              <X className="size-5" weight="bold" />
            </DialogClose>
          </div>

          {form ? (
            <form
              className="space-y-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                void handleSaveForm()
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor="team-form-name" className="sk-label">
                  Team name
                </label>
                <input
                  id="team-form-name"
                  className="sk-field"
                  placeholder="Sprint Group B"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="team-form-group" className="sk-label">
                    Event group
                  </label>
                  <select
                    id="team-form-group"
                    className="sk-field"
                    value={form.eventGroup}
                    onChange={(event) => setForm({ ...form, eventGroup: event.target.value as EventGroup })}
                  >
                    {EVENT_GROUP_OPTIONS.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="team-form-lead" className="sk-label">
                    Lead coach
                  </label>
                  <select
                    id="team-form-lead"
                    className="sk-field"
                    value={form.leadId}
                    onChange={(event) =>
                      setForm({ ...form, leadId: event.target.value, extraIds: form.extraIds.filter((id) => id !== event.target.value) })
                    }
                  >
                    <option value="none">Not assigned</option>
                    {formCoachIds.map((id) => (
                      <option key={id} value={id}>
                        {coachName(id)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <fieldset className="space-y-1.5">
                <legend className="sk-label">Additional coaches</legend>
                {formCoachIds.filter((id) => id !== form.leadId).length === 0 ? (
                  <p className="text-sm text-sk-mute">Nobody else to add yet. Invite more coaches from People and they show up here.</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto rounded-[14px] border border-[#d5d9e3]">
                    {formCoachIds
                      .filter((id) => id !== form.leadId)
                      .map((id) => (
                        <label key={id} className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-sk-line px-3.5 py-2 text-[0.95rem] text-sk-ink last:border-b-0 hover:bg-sk-canvas">
                          <input
                            type="checkbox"
                            className="size-4 accent-[#2152ff]"
                            checked={form.extraIds.includes(id)}
                            onChange={(event) =>
                              setForm({
                                ...form,
                                extraIds: event.target.checked ? [...form.extraIds, id] : form.extraIds.filter((item) => item !== id),
                              })
                            }
                          />
                          <span className="min-w-0 truncate">{coachName(id)}</span>
                        </label>
                      ))}
                  </div>
                )}
              </fieldset>
              {form.mode === "create" && teamLimitReached ? (
                <p className="rounded-2xl bg-sk-yellow-tint px-4 py-3 text-sm font-semibold text-[#7a5600]">{teamLimitMessage}</p>
              ) : null}
              {formError ? (
                <p role="alert" className={alertClass}>
                  {formError}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" className="sk-btn sk-btn-quiet" onClick={() => setForm(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="sk-btn sk-btn-primary"
                  disabled={saving || !form.name.trim() || (form.mode === "create" && teamLimitReached)}
                >
                  {saving ? "Saving..." : form.mode === "edit" ? "Save changes" : "Create team"}
                </button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={upgradeDialogOpen}
        onOpenChange={(next) => {
          setUpgradeDialogOpen(next)
          if (!next) setUpgradeError(null)
        }}
      >
        <DialogContent showCloseButton={false} className={dialogClass}>
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
              <label htmlFor="team-upgrade-reason" className="sk-label">
                Reason
              </label>
              <textarea
                id="team-upgrade-reason"
                rows={4}
                className="sk-field h-auto py-3"
                value={upgradeReason}
                onChange={(event) => setUpgradeReason(event.target.value)}
                placeholder="Tell us why your club needs more room."
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
