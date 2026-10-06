"use client"

import { conflictSentence, readEditConflict, type EditConflict } from "@/lib/data/edit-conflict"
import { findEditConflict, getEditStamp, recordMockEdit } from "@/lib/data/edit-conflict-data"
import { Plus, UserPlus } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { PersonAvatar } from "@/components/account/person-avatar"
import { AssignTeamDialog } from "@/components/club-admin/athletes-view"
import { UpgradeRequestDialog } from "@/components/club-admin/upgrade-request-dialog"
import { AddAthletesDialog } from "@/components/coach/add-athletes-dialog"
import {
  ActionRow,
  Button,
  CheckRow,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  FormActions,
  FormGrid,
  InlineConfirm,
  Input,
  LinkButton,
  List,
  ListRow,
  Notice,
  RowMenu,
  Screen,
  ScreenHeader,
  Section,
  Select,
  SkeletonRows,
  Split,
  StatusText,
  TableSub,
  Tabs,
  notify,
  type DataTableColumn,
  type RowMenuItem,
  type StateTone,
  EditConflictDialog,
} from "@/components/sk"
import { getNextPackageTier, getPackageById, type PackageId } from "@/lib/billing/package-catalog"
import { coachLeftTeamLine, teamCoachRoleLabel, type TeamCoachRole } from "@/lib/coach-permissions"
import { mockTeamCoaches, setTeamAssistantSettings, setTeamCoachRole } from "@/lib/data/club-admin/handover-data"
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
  updateClubAdminTeam,
  type ClubAdminAssignableCoachOption,
} from "@/lib/data/club-admin/ops-data"
import type { ClubAthlete } from "@/lib/data/club-admin/people-data"
import { removeAthleteFromRoster } from "@/lib/data/coach/roster-data"
import { mergeMockAthletes, ROSTER_CHANGED_EVENT } from "@/lib/data/coach/roster-mock"
import { removeAthleteFromTeamForCurrentCoach } from "@/lib/data/coach/teams-data"
import { type ClubTeam } from "@/lib/mock-club-admin"
import { type EventGroup } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"
import { loadTeamsSafe, loadUsersSafe, persistTeams } from "../state"

const EVENT_GROUP_OPTIONS: EventGroup[] = ["Sprint", "Mid", "Distance", "Jumps", "Throws"]

type TeamCoach = { userId: string; name: string; isPrimary: boolean; isSelf: boolean; role: TeamCoachRole; active: boolean }
type TeamAthlete = { id: string; name: string; primaryEvent: string | null; hasLogin: boolean }

type TeamRow = {
  id: string
  name: string
  eventGroup: EventGroup
  status: "draft" | "active" | "archived"
  coaches: TeamCoach[]
  athletes: TeamAthlete[]
  /** Lead label from the server, used only when the lead is not in the coaches list. */
  leadCoachLabel?: string
  assistantsCanMessage: boolean
  assistantsSeeHealth: boolean
}

type TeamForm = {
  mode: "create" | "edit"
  teamId?: string
  name: string
  eventGroup: EventGroup
  leadId: string
  extraIds: string[]
  /** Role of each additional coach. Missing means coach. */
  extraRoles: Record<string, "coach" | "assistant">
}

type Confirm =
  | { kind: "archive"; teamId: string }
  | { kind: "remove-coach"; teamId: string; userId: string }
  | { kind: "remove-athlete"; teamId: string; athleteId: string }

const STATUS: Record<TeamRow["status"], { label: string; tone: StateTone }> = {
  draft: { label: "Draft", tone: "amber" },
  active: { label: "Active", tone: "green" },
  archived: { label: "Archived", tone: "neutral" },
}

function toEventGroup(value: string | null | undefined): EventGroup {
  if (value === "Sprint" || value === "Mid" || value === "Distance" || value === "Jumps" || value === "Throws") return value
  return "Sprint"
}

function plural(count: number, word: string, pluralWord = `${word}s`) {
  return `${count} ${count === 1 ? word : pluralWord}`
}

function coachLabel(coach: { name: string; isSelf: boolean }) {
  return coach.isSelf ? `${coach.name} (you)` : coach.name
}

export default function ClubAdminTeamsPage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const openTeamId = searchParams.get("team")

  const [teams, setTeams] = useState<TeamRow[]>([])
  const [coachOptions, setCoachOptions] = useState<ClubAdminAssignableCoachOption[]>([])
  const [mockTeamPageIds, setMockTeamPageIds] = useState<Set<string>>(new Set())
  const [requestedPlan, setRequestedPlan] = useState<PackageId | null>(null)
  const [backendLoading, setBackendLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<"active" | "archived">("active")
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [form, setForm] = useState<TeamForm | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const teamEditStamp = useRef<string | null | undefined>(undefined)
  const [teamConflict, setTeamConflict] = useState<EditConflict | null>(null)
  const [saving, setSaving] = useState(false)
  const [addAthletesTeam, setAddAthletesTeam] = useState<{ id: string; name: string } | null>(null)
  const [movingAthlete, setMovingAthlete] = useState<ClubAthlete | null>(null)
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false)
  const [pendingUpgradeRequest, setPendingUpgradeRequest] = useState<{ requestedPackage: PackageId; createdAt: string } | null>(null)
  const [mockAuditLogger, setMockAuditLogger] = useState<((event: { actor: string; action: string; target: string; detail?: string }) => void) | null>(null)

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
      if (!result.ok) setError((current) => current ?? `The change was saved, but the audit log entry failed: ${result.error.message}`)
      return
    }
    mockAuditLogger?.({ actor: "club-admin", action, target, detail })
  }

  const loadMock = useCallback(async () => {
    const mockData = await import("@/lib/mock-data")
    const users = loadUsersSafe()
    const userById = new Map(users.map((user) => [user.id, user]))
    // The demo roster with everything the demo coach and admin changed (moves, athletes without a login).
    const roster = mergeMockAthletes(mockData.mockAthletes)

    const rows: TeamRow[] = loadTeamsSafe().map((team) => ({
      id: team.id,
      name: team.name,
      eventGroup: team.eventGroup,
      status: team.status,
      coaches: mockTeamCoaches(team, users).map((coach) => ({ ...coach, isPrimary: coach.role === "lead", isSelf: userById.get(coach.userId)?.role === "club-admin" })),
      athletes: roster
        .filter((athlete) => athlete.teamId === team.id)
        .map((athlete) => ({ id: athlete.id, name: athlete.name, primaryEvent: athlete.primaryEvent, hasLogin: athlete.hasLogin })),
      leadCoachLabel: team.coachEmail,
      assistantsCanMessage: team.assistantsCanMessage === true,
      assistantsSeeHealth: team.assistantsSeeHealth === true,
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

    const [teamResult, membersResult, coachResult] = await Promise.all([getClubAdminTeamsSnapshot(), getClubAdminTeamMembers(), getClubAdminAssignableCoachOptions()])

    const failure = !teamResult.ok ? teamResult.error : !membersResult.ok ? membersResult.error : !coachResult.ok ? coachResult.error : null
    if (failure || !teamResult.ok || !membersResult.ok || !coachResult.ok) {
      setError(`Could not load teams: ${failure?.message ?? "unknown error"}`)
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
        assistantsCanMessage: team.assistantsCanMessage === true,
        assistantsSeeHealth: team.assistantsSeeHealth === true,
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

      const [activationResult, upgradeResult] = await Promise.all([getCurrentClubAdminActivationState(), getClubAdminPackageUpgradeRequests()])
      if (cancelled) return
      if (!activationResult.ok) {
        setError(`Could not load your package limits: ${activationResult.error.message}`)
        return
      }
      setRequestedPlan(activationResult.data.requestedPlan)
      if (!upgradeResult.ok) {
        setError(`Could not load upgrade requests: ${upgradeResult.error.message}`)
        return
      }
      const firstPendingUpgrade = upgradeResult.data.find((item) => item.status === "pending") ?? null
      setPendingUpgradeRequest(firstPendingUpgrade ? { requestedPackage: firstPendingUpgrade.requestedPackage, createdAt: firstPendingUpgrade.createdAt } : null)
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
    // The demo roster lives in this browser: the Add athletes dialog and the move dialog change it.
    const refresh = () => void reload()
    window.addEventListener(ROSTER_CHANGED_EVENT, refresh)
    return () => {
      cancelled = true
      window.removeEventListener(ROSTER_CHANGED_EVENT, refresh)
    }
  }, [isSupabaseMode, reload])

  const coachName = (userId: string) => {
    const option = coachOptions.find((coach) => coach.userId === userId)
    if (option) return coachLabel(option)
    for (const team of teams) {
      const coach = team.coaches.find((item) => item.userId === userId)
      if (coach) return coachLabel(coach)
    }
    return "Coach"
  }

  const openCreate = () => {
    setFormError(null)
    setForm({ mode: "create", name: "", eventGroup: "Sprint", leadId: "none", extraIds: [], extraRoles: {} })
  }

  const openEdit = (team: TeamRow) => {
    setFormError(null)
    // What the team looks like now, to notice another admin saving it while this form is open.
    teamEditStamp.current = undefined
    void getEditStamp("team", team.id).then((stamp) => {
      if (stamp.ok) teamEditStamp.current = stamp.data.updatedAt
    })
    setForm({
      mode: "edit",
      teamId: team.id,
      name: team.name,
      eventGroup: team.eventGroup,
      leadId: team.coaches.find((coach) => coach.isPrimary)?.userId ?? "none",
      extraIds: team.coaches.filter((coach) => !coach.isPrimary).map((coach) => coach.userId),
      extraRoles: Object.fromEntries(team.coaches.filter((coach) => coach.role === "assistant").map((coach) => [coach.userId, "assistant" as const])),
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

  const openTeam = (teamId: string | null) => {
    setConfirm(null)
    setSearchParams(teamId ? { team: teamId } : {})
  }

  const handleSaveForm = async (event: FormEvent<HTMLFormElement> | null, overwrite = false) => {
    event?.preventDefault()
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
    const extraRoles = Object.fromEntries(extraIds.filter((id) => form.extraRoles[id] === "assistant").map((id) => [id, "assistant" as const]))
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
          const coachResult = await setClubAdminTeamCoaches({ teamId: result.data.id, leadCoachUserId: leadId, coachUserIds: extraIds, roles: extraRoles })
          if (!coachResult.ok) setError(`${name} was created, but the additional coaches were not saved: ${coachResult.error.message}`)
        }
        await reload()
      } else {
        const users = loadUsersSafe()
        const lead = users.find((user) => user.id === leadId)
        await saveMockTeams((current) => [
          { id: `team-${Date.now()}`, name, eventGroup: form.eventGroup, status: "active", coachUserId: lead?.id, coachEmail: lead?.email, coachUserIds: extraIds, coachRoles: extraRoles },
          ...current,
        ])
      }
      await emitAudit("team_create", name, leadId ? `lead ${coachName(leadId)}` : "no lead coach")
      notify(`${name} created`)
      setView("active")
    } else if (form.teamId) {
      const teamId = form.teamId
      const existing = teams.find((team) => team.id === teamId)
      if (isSupabaseMode) {
        const updateResult = await updateClubAdminTeam({ teamId, name, eventGroup: form.eventGroup, status: existing?.status ?? "active", guard: { expectedUpdatedAt: teamEditStamp.current, overwrite } })
        if (!updateResult.ok) {
          setSaving(false)
          // Another admin saved this team since the form opened: ask, never overwrite silently.
          const found = readEditConflict(updateResult.error)
          if (found) {
            setTeamConflict(found)
            return
          }
          setFormError(updateResult.error.message)
          return
        }
        const coachResult = await setClubAdminTeamCoaches({ teamId, leadCoachUserId: leadId, coachUserIds: extraIds, roles: extraRoles })
        if (!coachResult.ok) {
          setSaving(false)
          setFormError(`The team details were saved, but the coaches were not: ${coachResult.error.message}`)
          void reload()
          return
        }
        await reload()
      } else {
        const found = overwrite ? null : await findEditConflict("team", teamId, teamEditStamp.current)
        if (found) {
          setSaving(false)
          setTeamConflict(found)
          return
        }
        recordMockEdit("team", teamId)
        const users = loadUsersSafe()
        const lead = users.find((user) => user.id === leadId)
        await saveMockTeams((current) =>
          current.map((team) => (team.id === teamId ? { ...team, name, eventGroup: form.eventGroup, coachUserId: lead?.id, coachEmail: lead?.email, coachUserIds: extraIds, coachRoles: extraRoles } : team)),
        )
      }
      await emitAudit("team_update", name, leadId ? `lead ${coachName(leadId)}` : "no lead coach")
      notify(`${name} saved`)
    }

    setSaving(false)
    setError(null)
    setTeamConflict(null)
    setForm(null)
  }

  // "See their version": the form closes and the teams are read again. This short form keeps no draft copy.
  const seeTheirTeamVersion = async () => {
    setSaving(true)
    await reload()
    setSaving(false)
    setTeamConflict(null)
    setForm(null)
    setFormError(null)
    notify("This is their version", "Your own changes to the team were not saved.")
  }

  const handleArchiveToggle = async (team: TeamRow, archived: boolean) => {
    setError(null)
    if (!archived && team.status === "archived" && teamLimitReached) {
      setError(teamLimitMessage)
      return
    }
    setBusyKey(`team:${team.id}`)

    if (isSupabaseMode) {
      const result = await setClubAdminTeamArchived({ teamId: team.id, archived })
      if (!result.ok) {
        setBusyKey(null)
        setConfirm(null)
        setError(`Could not ${archived ? "archive" : "update"} ${team.name}: ${result.error.message}`)
        return
      }
      await reload()
    } else {
      await saveMockTeams((current) => current.map((item) => (item.id === team.id ? { ...item, status: archived ? "archived" : "active" } : item)))
    }

    setBusyKey(null)
    setConfirm(null)
    if (openTeamId === team.id && archived) openTeam(null)
    await emitAudit(archived ? "team_archive" : "team_restore", team.name)
    if (archived) notify(`${team.name} archived`, "Find it under Archived to bring it back.")
    else notify(team.status === "draft" ? `${team.name} is now active` : `${team.name} restored`)
  }

  /** Lead coach, coach or assistant. Making someone lead moves the previous lead down to coach. */
  const handleSetRole = async (team: TeamRow, coach: TeamCoach, role: TeamCoachRole) => {
    setError(null)
    setBusyKey(`coach:${team.id}:${coach.userId}`)
    const result = await setTeamCoachRole({ teamId: team.id, userId: coach.userId, role })
    if (!result.ok) {
      setBusyKey(null)
      setError(`Could not make ${coach.name} ${role === "lead" ? "the lead coach" : role === "assistant" ? "an assistant coach" : "a coach"}: ${result.error.message}`)
      void reload()
      return
    }
    await reload()
    setBusyKey(null)
    // The database writes its own audit entry for a role change.
    if (!isSupabaseMode) await emitAudit(role === "lead" ? "team_lead_coach_set" : "team_coach_role_set", team.name, `${coach.name} is ${teamCoachRoleLabel(role).toLowerCase()}`)
    notify(
      role === "lead" ? `${coach.name} is now lead coach of ${team.name}` : role === "assistant" ? `${coach.name} is now an assistant coach on ${team.name}` : `${coach.name} is now a coach on ${team.name}`,
      role === "assistant" ? "They can see the team, take attendance, log sessions and enter test results." : undefined,
    )
  }

  /** The two per-team switches for assistant coaches. */
  const handleAssistantSetting = async (team: TeamRow, change: { assistantsCanMessage?: boolean; assistantsSeeHealth?: boolean }) => {
    setError(null)
    setBusyKey(`assistants:${team.id}`)
    const result = await setTeamAssistantSettings({ teamId: team.id, ...change })
    setBusyKey(null)
    if (!result.ok) {
      setError(`Could not change what assistants can do on ${team.name}: ${result.error.message}`)
      void reload()
      return
    }
    setTeams((current) => current.map((item) => (item.id === team.id ? { ...item, ...result.data } : item)))
    if (!isSupabaseMode) {
      await emitAudit(
        "team_assistant_settings",
        team.name,
        `assistants can message athletes: ${result.data.assistantsCanMessage ? "yes" : "no"}, assistants can see health information: ${result.data.assistantsSeeHealth ? "yes" : "no"}`,
      )
    }
    if (change.assistantsCanMessage !== undefined) notify(change.assistantsCanMessage ? `Assistants can now message athletes on ${team.name}` : `Assistants can no longer message athletes on ${team.name}`)
    else notify(change.assistantsSeeHealth ? `Assistants can now see health information on ${team.name}` : `Assistants can no longer see health information on ${team.name}`)
  }

  const handleRemoveCoach = async (team: TeamRow, coach: TeamCoach) => {
    setError(null)
    setBusyKey(`coach:${team.id}:${coach.userId}`)
    if (isSupabaseMode) {
      const result = await removeClubAdminTeamCoach({ teamId: team.id, userId: coach.userId })
      if (!result.ok) {
        setBusyKey(null)
        setConfirm(null)
        setError(`Could not remove ${coach.name}: ${result.error.message}`)
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
      // As in the database: their conversations with this team's athletes close, with a line saying why.
      const messages = await import("@/lib/data/messages/mock-messages-store")
      messages.mockCloseCoachThreadsForTeam(team.id, coachLeftTeamLine(coach.name))
    }
    setBusyKey(null)
    setConfirm(null)
    await emitAudit("team_coach_remove", team.name, coach.name)
    notify(`${coach.name} removed from ${team.name}`)
  }

  const handleRemoveAthlete = async (team: TeamRow, athlete: TeamAthlete) => {
    setError(null)
    setBusyKey(`athlete:${athlete.id}`)
    const result = isSupabaseMode ? await removeAthleteFromTeamForCurrentCoach({ athleteId: athlete.id, teamId: team.id }) : await removeAthleteFromRoster(athlete.id, team.id)
    if (!result.ok) {
      setBusyKey(null)
      setConfirm(null)
      setError(`Could not take ${athlete.name} off the team: ${result.error.message}`)
      void reload()
      return
    }
    await reload()
    setBusyKey(null)
    setConfirm(null)
    await emitAudit("team_athlete_remove", team.name, athlete.name)
    notify(`${athlete.name} is off ${team.name}`, "They keep their account and history. Find them under People, Athletes, Unassigned.")
  }

  const hasTeamPage = (team: TeamRow) => team.status === "active" && (isSupabaseMode || mockTeamPageIds.has(team.id))
  const assignableTeams = useMemo(() => teams.filter((team) => team.status === "active").map((team) => ({ id: team.id, name: team.name })), [teams])
  const teamNameOf = useCallback((teamId: string | null) => teams.find((team) => team.id === teamId)?.name ?? null, [teams])

  const teamMenu = (team: TeamRow, inDetail: boolean): RowMenuItem[] => {
    const busy = busyKey === `team:${team.id}`
    return [
      ...(inDetail ? [] : [{ label: "Open team", onSelect: () => openTeam(team.id) }]),
      ...(team.status === "active" && !inDetail ? [{ label: "Add athletes", onSelect: () => setAddAthletesTeam({ id: team.id, name: team.name }), disabled: athleteLimitReached }] : []),
      ...(inDetail ? [] : [{ label: "Edit team", onSelect: () => openEdit(team) }]),
      ...(team.status === "draft" ? [{ label: busy ? "Saving..." : "Make active", onSelect: () => void handleArchiveToggle(team, false), disabled: busy }] : []),
      team.status === "archived"
        ? { label: busy ? "Saving..." : "Restore team", onSelect: () => void handleArchiveToggle(team, false), disabled: busy }
        : { label: "Archive team", onSelect: () => setConfirm({ kind: "archive", teamId: team.id }), danger: true },
    ]
  }

  const archiveConfirm = (team: TeamRow) =>
    confirm?.kind === "archive" && confirm.teamId === team.id ? (
      <InlineConfirm
        question={`Archive ${team.name}? Coaches and athletes stop seeing it. The roster and history are kept, and you can restore it any time.`}
        confirmLabel="Archive team"
        cancelLabel="Keep team"
        busy={busyKey === `team:${team.id}`}
        onConfirm={() => void handleArchiveToggle(team, true)}
        onCancel={() => setConfirm(null)}
      />
    ) : null

  const conflictDialog = teamConflict ? (
    <EditConflictDialog
      open
      title={conflictSentence(teamConflict)}
      busy={saving}
      onClose={() => setTeamConflict(null)}
      onSeeTheirs={() => void seeTheirTeamVersion()}
      onSaveMine={() => void handleSaveForm(null, true)}
    >
      See their version closes this form and shows the team as it is now. What you changed here is not kept. Save mine anyway replaces their details with yours.
    </EditConflictDialog>
  ) : null

  const formDialog = (
    <Dialog
      open={Boolean(form)}
      onOpenChange={(next) => {
        if (!next) {
          setForm(null)
          setFormError(null)
        }
      }}
      title={form?.mode === "edit" ? "Edit team" : "New team"}
      description={form?.mode === "edit" ? "Change the name, event group and who coaches this team." : "Name the team and pick who coaches it. You can add athletes straight after."}
      className="sm:max-w-lg"
    >
      {form ? (
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void handleSaveForm(event)}>
          <Field label="Team name">
            <Input placeholder="Sprint Group B" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <FormGrid>
            <Field label="Event group">
              <Select value={form.eventGroup} onChange={(event) => setForm({ ...form, eventGroup: event.target.value as EventGroup })}>
                {EVENT_GROUP_OPTIONS.map((group) => (
                  <option key={group} value={group}>
                    {group === "Mid" ? "Middle distance" : group}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lead coach">
              <Select value={form.leadId} onChange={(event) => setForm({ ...form, leadId: event.target.value, extraIds: form.extraIds.filter((id) => id !== event.target.value) })}>
                <option value="none">Not assigned</option>
                {formCoachIds.map((id) => (
                  <option key={id} value={id}>
                    {coachName(id)}
                  </option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="sk-field-label">Additional coaches</legend>
            {formCoachIds.filter((id) => id !== form.leadId).length === 0 ? (
              <p className="text-sm text-sk-mute">Nobody else to add yet. Invite more coaches from People and they show up here.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto">
                <List aria-label="Additional coaches">
                  {formCoachIds
                    .filter((id) => id !== form.leadId)
                    .map((id) => (
                      <CheckRow
                        key={id}
                        title={coachName(id)}
                        checked={form.extraIds.includes(id)}
                        onChange={(checked) => setForm({ ...form, extraIds: checked ? [...form.extraIds, id] : form.extraIds.filter((item) => item !== id) })}
                      />
                    ))}
                </List>
              </div>
            )}
          </fieldset>
          {form.extraIds.filter((id) => id !== form.leadId).length > 0 ? (
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="sk-field-label">Their role on this team</legend>
              <p className="text-sm text-sk-mute">A coach has full rights. An assistant sees the team, takes attendance, logs sessions and enters test results, and cannot change plans or the roster.</p>
              <FormGrid>
                {form.extraIds
                  .filter((id) => id !== form.leadId)
                  .map((id) => (
                    <Field key={id} label={coachName(id)}>
                      <Select
                        data-coach-role={id}
                        value={form.extraRoles[id] ?? "coach"}
                        onChange={(event) => setForm({ ...form, extraRoles: { ...form.extraRoles, [id]: event.target.value === "assistant" ? "assistant" : "coach" } })}
                      >
                        <option value="coach">Coach</option>
                        <option value="assistant">Assistant coach</option>
                      </Select>
                    </Field>
                  ))}
              </FormGrid>
            </fieldset>
          ) : null}
          {form.mode === "create" && teamLimitReached ? <Notice tone="warning">{teamLimitMessage}</Notice> : null}
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <FormActions>
            <Button variant="quiet" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving || !form.name.trim() || (form.mode === "create" && teamLimitReached)}>
              {saving ? "Saving..." : form.mode === "edit" ? "Save changes" : "Create team"}
            </Button>
          </FormActions>
        </form>
      ) : null}
    </Dialog>
  )

  const sharedDialogs = (
    <>
      {formDialog}
      {conflictDialog}
      {addAthletesTeam ? (
        <AddAthletesDialog
          open
          onOpenChange={(next) => {
            if (!next) {
              setAddAthletesTeam(null)
              void reload()
            }
          }}
          teamId={addAthletesTeam.id}
          teamName={addAthletesTeam.name}
          onInvitesCreated={(invites) => invites.forEach((invite) => void emitAudit("athlete_invite_send", invite.email, `team ${addAthletesTeam.name}`))}
          onAthleteAdded={(_, name) => {
            void emitAudit("managed_athlete_added", name, `team ${addAthletesTeam.name}`)
            void reload()
          }}
        />
      ) : null}
      <AssignTeamDialog
        athlete={movingAthlete}
        teams={assignableTeams}
        teamName={teamNameOf}
        onClose={() => setMovingAthlete(null)}
        onMoved={(athlete, target) => {
          // The database writes its own audit entry for a move.
          if (!isSupabaseMode) void emitAudit("athlete_moved_team", athlete.name, `team ${target.name}`)
          void reload()
        }}
      />
      <UpgradeRequestDialog
        open={upgradeDialogOpen}
        onOpenChange={setUpgradeDialogOpen}
        currentPackage={requestedPlan}
        targetPackage={suggestedUpgradePackage}
        placeholder="Tell us why your club needs more room."
        onSent={(requestedPackage) => {
          setPendingUpgradeRequest({ requestedPackage, createdAt: new Date().toISOString() })
          setError(null)
        }}
      />
    </>
  )

  const errorNotice = error ? (
    <Notice
      tone="error"
      action={
        <Button variant="quiet" size="sm" onClick={() => setError(null)}>
          Dismiss
        </Button>
      }
    >
      <span className="break-words">{error}</span>
    </Notice>
  ) : null

  /* ---------- One team ------------------------------------------------------------------------------ */

  const openedTeam = openTeamId ? teams.find((team) => team.id === openTeamId) : undefined

  if (openTeamId) {
    if (!openedTeam) {
      return (
        <Screen>
          <ScreenHeader
            back={{ onClick: () => openTeam(null), label: "Teams" }}
            title={backendLoading ? "Team" : "Team not found"}
            lede={backendLoading ? undefined : "This team is not in your club any more. Go back to the list to see the teams you have."}
          />
          {backendLoading ? <SkeletonRows rows={5} leading label="Loading the team" /> : errorNotice}
        </Screen>
      )
    }

    const team = openedTeam
    const lead = team.coaches.find((coach) => coach.isPrimary)

    const rosterColumns: Array<DataTableColumn<TeamAthlete>> = [
      {
        key: "athlete",
        header: "Athlete",
        cell: (athlete) => (
          <Link to={`/coach/athletes/${athlete.id}`} className="flex items-center gap-3 hover:text-sk-blue-link">
            <PersonAvatar name={athlete.name} athleteId={athlete.id} size="sm" />
            <span className="min-w-0">
              {athlete.name}
              <TableSub>
                <span className="sm:hidden">{athlete.primaryEvent || "No event yet"}</span>
              </TableSub>
            </span>
          </Link>
        ),
      },
      { key: "event", header: "Main event", phone: "hide", cell: (athlete) => athlete.primaryEvent || <span className="text-sk-mute">Not set</span> },
      {
        key: "login",
        header: "Login",
        phone: "trailing",
        cell: (athlete) => (
          <span className="flex items-center justify-between gap-2">
            {athlete.hasLogin ? <span className="max-sm:hidden">Has a login</span> : <span className="text-sk-mute">No login</span>}
            <RowMenu
              label={`More for ${athlete.name}`}
              items={[
                { label: "Open profile", onSelect: () => navigate(`/coach/athletes/${athlete.id}`) },
                {
                  label: "Move to another team",
                  onSelect: () =>
                    setMovingAthlete({ id: athlete.id, name: athlete.name, userId: null, hasLogin: athlete.hasLogin, email: null, teamId: team.id, eventGroup: null, primaryEvent: athlete.primaryEvent, status: "active" }),
                },
                { label: "Take off this team", onSelect: () => setConfirm({ kind: "remove-athlete", teamId: team.id, athleteId: athlete.id }), danger: true },
              ]}
            />
          </span>
        ),
      },
    ]

    return (
      <Screen>
        <ScreenHeader
          back={{ onClick: () => openTeam(null), label: "Teams" }}
          title={team.name}
          lede={`${team.eventGroup === "Mid" ? "Middle distance" : team.eventGroup}. ${plural(team.coaches.length, "coach", "coaches")}, ${plural(team.athletes.length, "athlete")}.${team.status === "active" ? "" : ` ${STATUS[team.status].label}.`}`}
          actions={
            <>
              {hasTeamPage(team) ? <LinkButton to={`/coach/teams/${team.id}`}>Open coach view</LinkButton> : null}
              <Button onClick={() => openEdit(team)}>Edit team</Button>
              {team.status === "active" ? (
                <Button variant="primary" disabled={athleteLimitReached} onClick={() => setAddAthletesTeam({ id: team.id, name: team.name })}>
                  <UserPlus className="size-5" weight="bold" aria-hidden />
                  Add athletes
                </Button>
              ) : null}
              <RowMenu label={`More for ${team.name}`} items={teamMenu(team, true)} />
            </>
          }
        />

        {errorNotice}
        {archiveConfirm(team)}
        {team.status === "active" && athleteLimitReached ? <Notice tone="warning">Your club has used every athlete place in its package, so athletes cannot be added.</Notice> : null}

        <Split
          main={
            <Section title="Roster" meta={team.athletes.length > 0 ? plural(team.athletes.length, "athlete") : undefined}>
              {team.athletes.length === 0 ? (
                <EmptyState
                  title="No athletes on this team yet"
                  body={
                    team.status === "active"
                      ? "Invite athletes by email or from a list, show the squad a QR code, or add an athlete who has no login. They appear here as they join."
                      : "Athletes can be added once the team is active."
                  }
                  action={
                    team.status === "active" ? (
                      <Button size="sm" disabled={athleteLimitReached} onClick={() => setAddAthletesTeam({ id: team.id, name: team.name })}>
                        Add athletes
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <DataTable
                  caption={`Athletes on ${team.name}`}
                  columns={rosterColumns}
                  rows={team.athletes}
                  rowKey={(athlete) => athlete.id}
                  rowProps={(athlete) => ({ "data-roster-athlete": athlete.name })}
                  rowBelow={(athlete) =>
                    confirm?.kind === "remove-athlete" && confirm.athleteId === athlete.id ? (
                      <InlineConfirm
                        question={`Take ${athlete.name} off ${team.name}? They keep their account and history, and wait under Unassigned until you put them on a team.`}
                        confirmLabel="Take off team"
                        cancelLabel="Keep on team"
                        busy={busyKey === `athlete:${athlete.id}`}
                        onConfirm={() => void handleRemoveAthlete(team, athlete)}
                        onCancel={() => setConfirm(null)}
                      />
                    ) : null
                  }
                />
              )}
            </Section>
          }
          side={
            <>
            <Section
              title="Coaches"
              action={
                <button type="button" className="sk-link inline-flex cursor-pointer items-center max-lg:min-h-11" onClick={() => openEdit(team)}>
                  {team.coaches.length > 0 ? "Change coaches" : "Assign coaches"}
                </button>
              }
            >
              {team.coaches.length === 0 ? (
                <EmptyState
                  title="No coaches on this team"
                  body={team.leadCoachLabel ? `The record lists ${team.leadCoachLabel} as lead. Assign them again so they can see the roster.` : "Assign a lead coach so someone owns the roster and the plan."}
                />
              ) : (
                <List aria-label={`Coaches on ${team.name}`}>
                  {team.coaches.map((coach) => {
                    const key = `coach:${team.id}:${coach.userId}`
                    const confirming = confirm?.kind === "remove-coach" && confirm.teamId === team.id && confirm.userId === coach.userId
                    return (
                      <ActionRow
                        key={coach.userId}
                        data-team-coach={coach.name}
                        data-team-coach-role={coach.role}
                        leading={<PersonAvatar name={coach.name} userId={coach.userId} size="sm" />}
                        title={coachLabel(coach)}
                        subtitle={`${teamCoachRoleLabel(coach.role)}${coach.active ? "" : ", deactivated"}`}
                        actions={
                          <RowMenu
                            label={`More for ${coach.name}`}
                            items={[
                              ...(team.status === "archived" || !coach.active
                                ? []
                                : (["lead", "coach", "assistant"] as TeamCoachRole[])
                                    .filter((role) => role !== coach.role)
                                    .map((role) => ({
                                      label: busyKey === key ? "Saving..." : role === "lead" ? "Make lead coach" : role === "assistant" ? "Make assistant coach" : "Make coach",
                                      onSelect: () => void handleSetRole(team, coach, role),
                                      disabled: busyKey === key,
                                    }))),
                              { label: "Remove from team", onSelect: () => setConfirm({ kind: "remove-coach", teamId: team.id, userId: coach.userId }), danger: true },
                            ]}
                          />
                        }
                        below={
                          confirming ? (
                            <InlineConfirm
                              question={`Remove ${coach.name} from ${team.name}? They lose access to this team only. Their conversations with its athletes are closed, and the history is kept.`}
                              confirmLabel="Remove coach"
                              cancelLabel="Keep"
                              busy={busyKey === key}
                              onConfirm={() => void handleRemoveCoach(team, coach)}
                              onCancel={() => setConfirm(null)}
                            />
                          ) : undefined
                        }
                      />
                    )
                  })}
                </List>
              )}
              {team.coaches.length > 0 && !lead ? <Notice tone="warning">Nobody is lead coach. Make one of the coaches the lead.</Notice> : null}
            </Section>
            <Section
              title="Assistant coaches"
              hint="An assistant sees the roster, training, results and attendance, takes attendance, logs sessions for athletes and enters test results. Plans, invites and squads stay with the lead coach and coaches."
            >
              <List aria-label={`What assistant coaches can do on ${team.name}`}>
                <CheckRow
                  title="Assistants can message athletes"
                  subtitle="Direct messages with the athletes of this team. Off unless you turn it on."
                  checked={team.assistantsCanMessage}
                  disabled={busyKey === `assistants:${team.id}`}
                  onChange={(checked) => void handleAssistantSetting(team, { assistantsCanMessage: checked })}
                />
                <CheckRow
                  title="Assistants can see health information"
                  subtitle="Wellness detail, pain and injury reports, medical notes and private coach notes. Off unless you turn it on."
                  checked={team.assistantsSeeHealth}
                  disabled={busyKey === `assistants:${team.id}`}
                  onChange={(checked) => void handleAssistantSetting(team, { assistantsSeeHealth: checked })}
                />
              </List>
            </Section>
            </>
          }
        />
        {sharedDialogs}
      </Screen>
    )
  }

  /* ---------- All teams ----------------------------------------------------------------------------- */

  const visibleTeams = view === "active" ? activeTeams : archivedTeams

  const lede = backendLoading
    ? "Getting your teams..."
    : [
        `${plural(activeTeams.length, "active team")} with ${plural(totalAthletes, "athlete")} on the rosters.`,
        packageDefinition && Number.isFinite(packageDefinition.limits.teams)
          ? `${packageDefinition.label} plan: ${activeTeams.length} of ${packageDefinition.limits.teams} teams, ${totalAthletes} of ${packageDefinition.limits.athletes} athletes.`
          : null,
      ]
        .filter(Boolean)
        .join(" ")

  const columns: Array<DataTableColumn<TeamRow>> = [
    {
      key: "team",
      header: "Team",
      cell: (team) => (
        <Link to={`?team=${encodeURIComponent(team.id)}`} className="hover:text-sk-blue-link">
          {team.name}
          <TableSub>{team.eventGroup === "Mid" ? "Middle distance" : team.eventGroup}</TableSub>
        </Link>
      ),
    },
    {
      key: "lead",
      header: "Lead coach",
      cell: (team) => {
        const lead = team.coaches.find((coach) => coach.isPrimary)
        const extra = team.coaches.length - (lead ? 1 : 0)
        if (lead) {
          return (
            <>
              {coachLabel(lead)}
              {extra > 0 ? <span className="text-sk-mute"> and {extra} more</span> : null}
            </>
          )
        }
        return team.status === "archived" ? (
          <span className="text-sk-mute">None</span>
        ) : (
          <StatusText tone="coral">{team.coaches.length > 0 ? `No lead, ${plural(team.coaches.length, "coach", "coaches")}` : "No lead coach"}</StatusText>
        )
      },
    },
    { key: "athletes", header: "Athletes", align: "right", strong: true, cell: (team) => team.athletes.length },
    {
      key: "status",
      header: "Status",
      phone: "trailing",
      cell: (team) => (
        <span className="flex items-center justify-between gap-2">
          <StatusText tone={STATUS[team.status].tone}>{STATUS[team.status].label}</StatusText>
          <RowMenu label={`More for ${team.name}`} items={teamMenu(team, false)} />
        </span>
      ),
    },
  ]

  return (
    <Screen>
      <ScreenHeader
        title="Teams"
        lede={lede}
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Plus className="size-5" weight="bold" aria-hidden />
            New team
          </Button>
        }
      />

      {errorNotice}

      {packageDefinition && (teamLimitReached || athleteLimitReached) ? (
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
          Your club is at its {teamLimitReached && athleteLimitReached ? "team and athlete" : teamLimitReached ? "team" : "athlete"} limit
          <span className="mt-0.5 block font-normal">
            {packageDefinition.label} covers {plural(packageDefinition.limits.teams, "team")} and {plural(packageDefinition.limits.athletes, "athlete")}.
            {pendingUpgradeRequest ? ` Your upgrade request to ${getPackageById(pendingUpgradeRequest.requestedPackage)?.label ?? pendingUpgradeRequest.requestedPackage} is being reviewed.` : ""}
          </span>
        </Notice>
      ) : null}

      <Tabs
        label="Team status"
        value={view}
        onChange={(next) => {
          setView(next)
          setConfirm(null)
        }}
        options={[
          { value: "active", label: "Active", count: backendLoading ? undefined : activeTeams.length },
          { value: "archived", label: "Archived", count: backendLoading ? undefined : archivedTeams.length },
        ]}
      />

      <Section aria-label={view === "active" ? "Active teams" : "Archived teams"}>
        {backendLoading ? (
          <SkeletonRows rows={4} label="Loading teams" />
        ) : visibleTeams.length === 0 ? (
          view === "active" ? (
            <EmptyState
              title="No teams yet"
              body="Teams hold your coaches, rosters, plans and testing. Create the first one, give it a lead coach, then add athletes to it."
              action={
                <Button size="sm" onClick={openCreate}>
                  New team
                </Button>
              }
            />
          ) : (
            <EmptyState title="Nothing archived" body="Teams you archive are kept here with their roster and history, ready to restore." />
          )
        ) : (
          <DataTable
            caption={view === "active" ? "Active teams" : "Archived teams"}
            columns={columns}
            rows={visibleTeams}
            rowKey={(team) => team.id}
            rowProps={(team) => ({ "data-team": team.name })}
            rowBelow={archiveConfirm}
          />
        )}
      </Section>

      <Section title="Stepping in for a coach" hint="As a club admin you can open any team's training and testing.">
        <List>
          <ListRow to="/coach/training-plan" title="Training plans" subtitle="Build, edit or publish a plan for any team." />
          <ListRow to="/coach/test-week" title="Test weeks" subtitle="Set up a test week or enter results." />
        </List>
      </Section>

      {sharedDialogs}
    </Screen>
  )
}
