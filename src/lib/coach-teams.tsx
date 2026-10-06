"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  COACH_TEAM_COOKIE,
  getCookieValue,
  ROLE_COOKIE,
  SESSION_UPDATED_EVENT,
  setCoachTeamCookie,
  USER_COOKIE,
} from "@/lib/auth-session"
import { coachTeamPermissions, FULL_TEAM_PERMISSIONS, type CoachTeamPermissions, type TeamCoachRole } from "@/lib/coach-permissions"
import { resolveMockCoachTeamIds, resolveMockCoachTeamRole, resolveMockTeamAssistantSettings } from "@/lib/coach-scope"
import { getAssignedCoachTeamsForCurrentUser } from "@/lib/data/coach/teams-data"
import { MOCK_COACH_TEAM_STORAGE_KEY } from "@/lib/mock-auth"
import type { EventGroup } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * The one place that knows which teams a coach is assigned to and which one is selected.
 *
 * - Teams are loaded once per signed-in coach (Supabase: team_coaches joined to teams. Mock: demo data,
 *   see resolveMockCoachTeamIds in coach-scope.ts).
 * - The selected team id lives in the existing pacelab_coach_team cookie, so it survives a reload and
 *   older code that reads the cookie keeps working. It is also remembered per user in localStorage, so
 *   the last team comes back after signing in again.
 * - If the stored team is no longer assigned, the first assigned team is selected instead.
 *
 * Club admins and athletes get an empty, inert value: no teams, no selection, no switcher.
 */

export type CoachTeam = {
  id: string
  name: string
  eventGroup: EventGroup
  /** The coach's role on this team: lead, coach or assistant. */
  role: TeamCoachRole
  /** The team's two assistant switches. They only matter when the role is assistant. */
  assistantsCanMessage: boolean
  assistantsSeeHealth: boolean
}

/** Returns a question to ask before leaving (unsaved work), or null when it is safe to switch. */
type SwitchGuard = () => string | null

type CoachTeamsContextValue = {
  /** True when the signed-in user is a coach. */
  isCoach: boolean
  teams: CoachTeam[]
  selectedTeam: CoachTeam | null
  selectedTeamId: string | null
  /** True until the coach's teams have been loaded for the first time. */
  loading: boolean
  error: string | null
  /** Whether the coach may open this team. */
  isAssigned: (teamId: string | null | undefined) => boolean
  /** The coach picked a team. Asks first when a screen reports unsaved work. Returns false when cancelled. */
  selectTeam: (teamId: string) => boolean
  /** Follow a deep link or a save: selects the team without asking. Ignored for a team the coach is not on. */
  syncSelectedTeam: (teamId: string | null | undefined) => void
  /** Screens with unsaved work register here so switching team can confirm first. Returns the unregister function. */
  registerSwitchGuard: (guard: SwitchGuard) => () => void
  refresh: () => void
}

const INERT: CoachTeamsContextValue = {
  isCoach: false,
  teams: [],
  selectedTeam: null,
  selectedTeamId: null,
  loading: false,
  error: null,
  isAssigned: () => false,
  selectTeam: () => false,
  syncSelectedTeam: () => {},
  registerSwitchGuard: () => () => {},
  refresh: () => {},
}

const CoachTeamsContext = createContext<CoachTeamsContextValue>(INERT)

const LAST_TEAM_STORAGE_PREFIX = "pacelab:coach-last-team:"
const REFRESH_ON_RETURN_AFTER_MS = 60_000

function readLastTeam(userKey: string | null) {
  if (!userKey) return null
  try {
    return window.localStorage.getItem(`${LAST_TEAM_STORAGE_PREFIX}${userKey}`)
  } catch {
    return null
  }
}

function persistSelection(userKey: string | null, teamId: string | null) {
  if (getCookieValue(COACH_TEAM_COOKIE) !== teamId && (teamId || getCookieValue(COACH_TEAM_COOKIE))) {
    setCoachTeamCookie(teamId ?? undefined)
  }
  if (!teamId) return
  try {
    if (userKey) window.localStorage.setItem(`${LAST_TEAM_STORAGE_PREFIX}${userKey}`, teamId)
    if (getBackendMode() === "mock") window.localStorage.setItem(MOCK_COACH_TEAM_STORAGE_KEY, teamId)
  } catch {
    // Storage can be blocked. The cookie still carries the selection.
  }
}

async function loadTeams(): Promise<{ ok: true; teams: CoachTeam[] } | { ok: false; message: string }> {
  if (getBackendMode() !== "supabase") {
    const module = await import("@/lib/mock-data")
    const assigned = resolveMockCoachTeamIds(module.mockTeams.map((team) => team.id))
    return {
      ok: true,
      teams: assigned.flatMap((id) => {
        const team = module.mockTeams.find((candidate) => candidate.id === id)
        return team ? [{ id: team.id, name: team.name, eventGroup: team.eventGroup, role: resolveMockCoachTeamRole(team.id), ...resolveMockTeamAssistantSettings(team.id) }] : []
      }),
    }
  }

  const result = await getAssignedCoachTeamsForCurrentUser()
  return result.ok ? { ok: true, teams: result.data } : { ok: false, message: result.error.message }
}

export function CoachTeamsProvider({ children }: { children: ReactNode }) {
  // Cookies are the session source in both backend modes. The epoch re-reads them when they change.
  const [, setSessionEpoch] = useState(0)
  const isCoach = getCookieValue(ROLE_COOKIE) === "coach"
  const userKey = isCoach ? getCookieValue(USER_COOKIE) : null

  const [teams, setTeams] = useState<CoachTeam[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(() => (isCoach ? getCookieValue(COACH_TEAM_COOKIE) || null : null))
  const [reloadTick, setReloadTick] = useState(0)
  const guards = useRef(new Set<SwitchGuard>())
  const loadedAt = useRef(0)
  const stateRef = useRef({ teams, selectedTeamId, userKey })
  useEffect(() => {
    stateRef.current = { teams, selectedTeamId, userKey }
  })

  useEffect(() => {
    if (!isCoach) {
      setTeams(null)
      setSelectedTeamId(null)
      setError(null)
      return
    }

    let cancelled = false
    void loadTeams().then((result) => {
      if (cancelled) return
      loadedAt.current = Date.now()

      if (!result.ok) {
        // Keep working on the team from the cookie. The data layer still checks every request.
        setError(result.message)
        setTeams((current) => current ?? [])
        setSelectedTeamId((current) => current ?? (getCookieValue(COACH_TEAM_COOKIE) || null))
        return
      }

      const assigned = new Set(result.teams.map((team) => team.id))
      const candidates = [stateRef.current.selectedTeamId, readLastTeam(userKey), getCookieValue(COACH_TEAM_COOKIE)]
      // On the first load the remembered team (last picked by this user) beats the cookie the login set.
      const preferred = stateRef.current.teams === null ? [candidates[1], candidates[2], candidates[0]] : candidates
      const nextId = preferred.find((id): id is string => Boolean(id && assigned.has(id))) ?? result.teams[0]?.id ?? null

      setError(null)
      setTeams(result.teams)
      setSelectedTeamId(nextId)
      persistSelection(userKey, nextId)
    })

    return () => {
      cancelled = true
    }
  }, [isCoach, reloadTick, userKey])

  useEffect(() => {
    const handleSessionUpdated = () => {
      setSessionEpoch((value) => value + 1)
      // Something else rewrote the cookie (sign-in sync, a test, another screen). Follow it when it is a
      // team the coach is on, otherwise check the assignments again.
      const cookieTeamId = getCookieValue(COACH_TEAM_COOKIE)
      const current = stateRef.current
      if (!cookieTeamId || !current.teams || cookieTeamId === current.selectedTeamId) return
      if (current.teams.some((team) => team.id === cookieTeamId)) setSelectedTeamId(cookieTeamId)
      else setReloadTick((value) => value + 1)
    }

    // A club admin can change assignments while the app is open. Check again when the coach comes back.
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return
      if (Date.now() - loadedAt.current < REFRESH_ON_RETURN_AFTER_MS) return
      setReloadTick((value) => value + 1)
    }

    window.addEventListener(SESSION_UPDATED_EVENT, handleSessionUpdated as EventListener)
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      window.removeEventListener(SESSION_UPDATED_EVENT, handleSessionUpdated as EventListener)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [])

  const syncSelectedTeam = useCallback((teamId: string | null | undefined) => {
    const current = stateRef.current
    if (!teamId || teamId === current.selectedTeamId) return
    if (!current.teams?.some((team) => team.id === teamId)) return
    stateRef.current = { ...current, selectedTeamId: teamId }
    setSelectedTeamId(teamId)
    persistSelection(current.userKey, teamId)
  }, [])

  const selectTeam = useCallback(
    (teamId: string) => {
      const current = stateRef.current
      if (teamId === current.selectedTeamId) return true
      if (!current.teams?.some((team) => team.id === teamId)) return false
      for (const guard of guards.current) {
        const question = guard()
        if (question && !window.confirm(question)) return false
      }
      syncSelectedTeam(teamId)
      return true
    },
    [syncSelectedTeam],
  )

  const registerSwitchGuard = useCallback((guard: SwitchGuard) => {
    guards.current.add(guard)
    return () => {
      guards.current.delete(guard)
    }
  }, [])

  const refresh = useCallback(() => setReloadTick((value) => value + 1), [])

  const value = useMemo<CoachTeamsContextValue>(() => {
    if (!isCoach) return INERT
    const list = teams ?? []
    return {
      isCoach: true,
      teams: list,
      selectedTeam: list.find((team) => team.id === selectedTeamId) ?? null,
      selectedTeamId,
      loading: teams === null,
      error,
      // When the list could not be loaded, the team from the cookie stays usable.
      isAssigned: (teamId) => Boolean(teamId) && (list.some((team) => team.id === teamId) || (error !== null && teamId === selectedTeamId)),
      selectTeam,
      syncSelectedTeam,
      registerSwitchGuard,
      refresh,
    }
  }, [error, isCoach, refresh, registerSwitchGuard, selectTeam, selectedTeamId, syncSelectedTeam, teams])

  return <CoachTeamsContext.Provider value={value}>{children}</CoachTeamsContext.Provider>
}

export function useCoachTeams() {
  return useContext(CoachTeamsContext)
}

/**
 * What a coach screen needs to scope its data: the session role and, for a coach, the selected team.
 * Club admins get coachTeamId null, which means "all teams", exactly as before.
 */
export function useCoachTeamScope() {
  const { isCoach, selectedTeamId, teams, loading, isAssigned, syncSelectedTeam } = useCoachTeams()
  const role = getCookieValue(ROLE_COOKIE)
  return {
    role,
    coachTeamId: isCoach ? selectedTeamId : null,
    coachTeams: teams,
    coachTeamsLoading: isCoach && loading,
    isAssigned,
    syncSelectedTeam,
  }
}

/** Ask before switching team while this screen holds unsaved work. Pass null when there is nothing to lose. */
export function useTeamSwitchGuard(question: string | null) {
  const { registerSwitchGuard } = useCoachTeams()
  useEffect(() => {
    if (!question) return
    return registerSwitchGuard(() => question)
  }, [question, registerSwitchGuard])
}

/**
 * What the signed-in person may do on a team: the team given, or the selected team. A club admin,
 * and a coach whose teams have not loaded, get full rights here (the database decides in the end).
 * `authorsClubContent` is false for a coach who is an assistant on every team they are on.
 */
export function useCoachPermissions(teamId?: string | null): CoachTeamPermissions & { teamName: string | null; authorsClubContent: boolean } {
  const { isCoach, teams, selectedTeamId } = useCoachTeams()
  return useMemo(() => {
    const team = isCoach ? teams.find((item) => item.id === (teamId ?? selectedTeamId)) : undefined
    const permissions = team ? coachTeamPermissions(team.role, team) : FULL_TEAM_PERMISSIONS
    const authorsClubContent = !isCoach || teams.length === 0 || teams.some((item) => item.role !== "assistant")
    return { ...permissions, teamName: team?.name ?? null, authorsClubContent }
  }, [isCoach, selectedTeamId, teamId, teams])
}
