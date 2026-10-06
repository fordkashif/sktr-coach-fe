import {
  applyHandover,
  coachLeftTeamLine,
  describeHandover,
  HANDOVER_KEEP,
  toHandoverAssignments,
  type HandoverChoice,
  type HandoverTeam,
  type HandoverThen,
  type TeamAssistantSettings,
  type TeamCoachRole,
} from "@/lib/coach-permissions"
import { kickNotificationEmails } from "@/lib/data/notifications-data"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { loadClubTeams, loadClubUsers, saveClubTeams, saveClubUsers, type ClubTeam } from "@/lib/mock-club-admin"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Coach handover and the roles on a team assignment, for both backends.
 *
 * Supabase: thin calls to the database functions of migration 20261015090000. Every rule is
 * enforced there (club admins only, one transaction, conversations closed, nothing deleted).
 * Demo: the same steps on the club's demo stores in this browser.
 */

function isMock() {
  return getBackendMode() !== "supabase"
}

function requireClient(operation: string) {
  const client = getBrowserSupabaseClient()
  if (!client) return { ok: false as const, error: { code: "UNKNOWN", message: `[${operation}] Supabase client is not configured.` } as DataError }
  return { ok: true as const, client }
}

/** The database functions raise sentences written for the person doing the work. Keep them. */
function handoverError(error: { code?: string; message: string; details?: string; hint?: string }): DataError {
  if (error.code === "PGRST202" || error.code === "42883") {
    return { code: "NOT_FOUND", message: "This is not switched on for this workspace yet. The latest database update still needs to be applied.", cause: error }
  }
  const mapped = mapPostgrestError(error as Parameters<typeof mapPostgrestError>[0])
  const technical = /row-level security|permission denied|violates|does not exist$/i.test(error.message)
  if (technical) return mapped
  return { ...mapped, message: error.message }
}

/* ---------- Demo store helpers ------------------------------------------------------------------------ */

/** The coaches of a demo team as the handover logic sees them. */
export function mockTeamCoaches(team: ClubTeam, users = loadClubUsers()): HandoverTeam["coaches"] {
  const byId = new Map(users.map((user) => [user.id, user]))
  const ids = [team.coachUserId, ...(team.coachUserIds ?? [])].filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index)
  return ids.flatMap((id) => {
    const user = byId.get(id)
    if (!user) return []
    const role: TeamCoachRole = id === team.coachUserId ? "lead" : (team.coachRoles?.[id] ?? "coach")
    return [{ userId: id, name: user.name, role, active: user.status === "active" }]
  })
}

/** Writes a list of coaches back onto a demo team: the lead, the others and their roles. */
export function withMockTeamCoaches(team: ClubTeam, coaches: HandoverTeam["coaches"], users = loadClubUsers()): ClubTeam {
  const lead = coaches.find((coach) => coach.role === "lead")
  const others = coaches.filter((coach) => coach !== lead)
  const roles: Record<string, "coach" | "assistant"> = {}
  for (const coach of others) if (coach.role === "assistant") roles[coach.userId] = "assistant"
  return {
    ...team,
    coachUserId: lead?.userId,
    coachEmail: lead ? users.find((user) => user.id === lead.userId)?.email : undefined,
    coachUserIds: others.map((coach) => coach.userId),
    coachRoles: roles,
  }
}

/* ---------- Roles and the two team switches ----------------------------------------------------------- */

/** Club admins only. Making someone lead moves the previous lead down to coach. */
export async function setTeamCoachRole(params: { teamId: string; userId: string; role: TeamCoachRole }): Promise<Result<null>> {
  if (isMock()) {
    const users = loadClubUsers()
    saveClubTeams(
      loadClubTeams().map((team) => {
        if (team.id !== params.teamId) return team
        let coaches = mockTeamCoaches(team, users)
        if (!coaches.some((coach) => coach.userId === params.userId)) {
          const user = users.find((item) => item.id === params.userId)
          if (!user) return team
          coaches = [...coaches, { userId: user.id, name: user.name, role: params.role, active: user.status === "active" }]
        }
        coaches = coaches.map((coach) =>
          coach.userId === params.userId ? { ...coach, role: params.role } : params.role === "lead" && coach.role === "lead" ? { ...coach, role: "coach" as const } : coach,
        )
        return withMockTeamCoaches(team, coaches, users)
      }),
    )
    return ok(null)
  }
  const clientResult = requireClient("setTeamCoachRole")
  if (!clientResult.ok) return clientResult
  const { error } = await clientResult.client.rpc("set_team_coach_role", { p_team_id: params.teamId, p_user_id: params.userId, p_role: params.role })
  if (error) return { ok: false, error: handoverError(error) }
  kickNotificationEmails()
  return ok(null)
}

/** A club admin or the team's lead coach. Leave a switch out to keep it as it is. */
export async function setTeamAssistantSettings(params: { teamId: string } & Partial<TeamAssistantSettings>): Promise<Result<TeamAssistantSettings>> {
  if (isMock()) {
    let saved: TeamAssistantSettings | null = null
    saveClubTeams(
      loadClubTeams().map((team) => {
        if (team.id !== params.teamId) return team
        saved = {
          assistantsCanMessage: params.assistantsCanMessage ?? team.assistantsCanMessage === true,
          assistantsSeeHealth: params.assistantsSeeHealth ?? team.assistantsSeeHealth === true,
        }
        return { ...team, ...saved }
      }),
    )
    return saved ? ok(saved) : err("NOT_FOUND", "This team is no longer in your club.")
  }
  const clientResult = requireClient("setTeamAssistantSettings")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("set_team_assistant_settings", {
    p_team_id: params.teamId,
    p_can_message: params.assistantsCanMessage ?? null,
    p_see_health: params.assistantsSeeHealth ?? null,
  })
  if (error) return { ok: false, error: handoverError(error) }
  const row = (Array.isArray(data) ? data[0] : data) as { assistants_can_message?: boolean; assistants_see_health?: boolean } | null
  return ok({ assistantsCanMessage: row?.assistants_can_message === true, assistantsSeeHealth: row?.assistants_see_health === true })
}

/* ---------- The handover ------------------------------------------------------------------------------- */

export type HandoverOutcome = {
  teams: number
  threadsClosed: number
  /** One line per team, for the confirmation toast and the demo audit entry. */
  summary: string[]
}

/**
 * Hands a coach's teams over and, when asked, deactivates or removes the coach afterwards. One
 * transaction in the database. `teams` are the teams the coach is on, `choices` what happens to each.
 */
export async function handOverCoachTeams(params: {
  userId: string
  coachName: string
  teams: HandoverTeam[]
  choices: Record<string, HandoverChoice | "">
  then: HandoverThen
  nameOf: (userId: string) => string
}): Promise<Result<HandoverOutcome>> {
  const summary = describeHandover(params.teams, params.choices, params.nameOf)
  const handed = params.teams.filter((team) => params.choices[team.id] && params.choices[team.id] !== HANDOVER_KEEP)

  if (isMock()) {
    const users = loadClubUsers()
    const stored = loadClubTeams()
    const asHandover: HandoverTeam[] = stored.map((team) => ({ id: team.id, name: team.name, coaches: mockTeamCoaches(team, users) }))
    const after = applyHandover(asHandover, params.userId, params.choices, params.nameOf)
    const afterById = new Map(after.map((team) => [team.id, team]))
    saveClubTeams(stored.map((team) => (handed.some((item) => item.id === team.id) ? withMockTeamCoaches(team, afterById.get(team.id)?.coaches ?? [], users) : team)))

    // Their conversations with those teams' athletes close with a system line. Nothing is deleted.
    let threadsClosed = 0
    const messages = await import("@/lib/data/messages/mock-messages-store")
    for (const team of handed) threadsClosed += messages.mockCloseCoachThreadsForTeam(team.id, coachLeftTeamLine(params.coachName))

    // The demo also notes one team on the person. It goes when that team was handed over.
    const handedIds = new Set(handed.map((team) => team.id))
    const withoutTeam = users.map((user) => (user.id === params.userId && user.teamId && handedIds.has(user.teamId) ? { ...user, teamId: undefined } : user))
    if (params.then === "deactivate") {
      saveClubUsers(withoutTeam.map((user) => (user.id === params.userId ? { ...user, status: "disabled" as const } : user)))
    } else if (params.then === "remove") {
      saveClubUsers(withoutTeam.filter((user) => user.id !== params.userId))
    } else {
      saveClubUsers(withoutTeam)
    }
    resolveMockHandoverRequests(params.userId)
    return ok({ teams: handed.length, threadsClosed, summary })
  }

  const clientResult = requireClient("handOverCoachTeams")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("hand_over_coach_teams", {
    p_user_id: params.userId,
    p_assignments: toHandoverAssignments(params.teams, params.choices),
    p_then: params.then,
  })
  if (error) return { ok: false, error: handoverError(error) }
  kickNotificationEmails()
  const result = (data ?? {}) as { teams?: number; threads_closed?: number }
  return ok({ teams: result.teams ?? handed.length, threadsClosed: result.threads_closed ?? 0, summary })
}

/* ---------- A coach asks for a handover ------------------------------------------------------------------ */

export type HandoverRequest = {
  id: string
  coachUserId: string
  teamIds: string[]
  note: string | null
  createdAt: string
}

const MOCK_REQUESTS_KEY = "pacelab:coach-handover-requests"
export const HANDOVER_NOTE_MAX_LENGTH = 500
/** The demo coach has no row in the club's people list, so their request carries this id. */
export const MOCK_REQUESTING_COACH_ID = "mock-coach-user"

type StoredRequest = HandoverRequest & { status: "open" | "done" | "dismissed"; coachName?: string }

function loadMockRequests(): StoredRequest[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(MOCK_REQUESTS_KEY)) ?? "[]") as StoredRequest[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveMockRequests(requests: StoredRequest[]) {
  try {
    window.localStorage.setItem(tenantStorageKey(MOCK_REQUESTS_KEY), JSON.stringify(requests))
  } catch {
    // Storage can be blocked. The request then lasts for this page only.
  }
}

function resolveMockHandoverRequests(coachUserId: string) {
  saveMockRequests(loadMockRequests().map((request) => (request.coachUserId === coachUserId && request.status === "open" ? { ...request, status: "done" } : request)))
}

type RequestRow = { id: string; coach_user_id: string; team_ids: string[] | null; note: string | null; created_at: string }

const toRequest = (row: RequestRow): HandoverRequest => ({ id: row.id, coachUserId: row.coach_user_id, teamIds: row.team_ids ?? [], note: row.note, createdAt: row.created_at })

/**
 * A coach asks club admins to hand their teams to someone else. It is a message to the admins,
 * nothing more: a coach cannot reassign themselves.
 */
export async function requestCoachHandover(params: { note: string; teamIds: string[] }): Promise<Result<HandoverRequest>> {
  const note = params.note.replace(/\s+/g, " ").trim()
  if (note.length > HANDOVER_NOTE_MAX_LENGTH) return err("VALIDATION", `Keep the note to ${HANDOVER_NOTE_MAX_LENGTH} characters.`)
  if (params.teamIds.length === 0) return err("VALIDATION", "Choose the team you want to hand over.")

  if (isMock()) {
    const request: StoredRequest = {
      id: `handover-${Date.now()}`,
      coachUserId: MOCK_REQUESTING_COACH_ID,
      teamIds: params.teamIds,
      note: note || null,
      createdAt: new Date().toISOString(),
      status: "open",
    }
    saveMockRequests([request, ...loadMockRequests().filter((item) => !(item.coachUserId === MOCK_REQUESTING_COACH_ID && item.status === "open"))])
    const audit = await import("@/lib/mock-audit")
    audit.logAuditEvent({ actor: "coach", action: "coach_handover_requested", target: "Coach", detail: `asked to hand over ${params.teamIds.length} ${params.teamIds.length === 1 ? "team" : "teams"}` })
    return ok(request)
  }

  const clientResult = requireClient("requestCoachHandover")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("request_coach_handover", { p_note: note || null, p_team_ids: params.teamIds })
  if (error) return { ok: false, error: handoverError(error) }
  kickNotificationEmails()
  return ok({ id: String(data), coachUserId: "", teamIds: params.teamIds, note: note || null, createdAt: new Date().toISOString() })
}

/** The signed-in coach's open request, if they have one. */
export async function getMyOpenHandoverRequest(): Promise<Result<HandoverRequest | null>> {
  if (isMock()) {
    return ok(loadMockRequests().find((request) => request.coachUserId === MOCK_REQUESTING_COACH_ID && request.status === "open") ?? null)
  }
  const clientResult = requireClient("getMyOpenHandoverRequest")
  if (!clientResult.ok) return clientResult
  const { data: session } = await clientResult.client.auth.getSession()
  const userId = session.session?.user.id
  if (!userId) return ok(null)
  const { data, error } = await clientResult.client
    .from("coach_handover_requests")
    .select("id, coach_user_id, team_ids, note, created_at")
    .eq("coach_user_id", userId)
    .eq("status", "open")
    .limit(1)
  // A database without the table yet: there is simply no request.
  if (error) return error.code === "42P01" || error.code === "PGRST205" ? ok(null) : { ok: false, error: handoverError(error) }
  const row = ((data as RequestRow[] | null) ?? [])[0]
  return ok(row ? toRequest(row) : null)
}

/** Club admins: every open request in the club, newest first. */
export async function getOpenHandoverRequests(): Promise<Result<HandoverRequest[]>> {
  if (isMock()) return ok(loadMockRequests().filter((request) => request.status === "open"))
  const clientResult = requireClient("getOpenHandoverRequests")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client
    .from("coach_handover_requests")
    .select("id, coach_user_id, team_ids, note, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) return error.code === "42P01" || error.code === "PGRST205" ? ok([]) : { ok: false, error: handoverError(error) }
  return ok(((data as RequestRow[] | null) ?? []).map(toRequest))
}

/** The coach takes their request back, or a club admin sets it aside. */
export async function dismissHandoverRequest(requestId: string): Promise<Result<null>> {
  if (isMock()) {
    saveMockRequests(loadMockRequests().map((request) => (request.id === requestId ? { ...request, status: "dismissed" } : request)))
    return ok(null)
  }
  const clientResult = requireClient("dismissHandoverRequest")
  if (!clientResult.ok) return clientResult
  const { error } = await clientResult.client.rpc("resolve_coach_handover_request", { p_request_id: requestId })
  if (error) return { ok: false, error: handoverError(error) }
  return ok(null)
}
