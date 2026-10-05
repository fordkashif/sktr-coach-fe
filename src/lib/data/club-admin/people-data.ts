import type { SupabaseClient } from "@supabase/supabase-js"
import { COACH_INVITE_VALID_DAYS, type ClubAdminInvite } from "@/lib/data/club-admin/ops-data"
import { loadMockRoster, updateMockRoster } from "@/lib/data/coach/roster-mock"
import { moveAthleteToTeam, type MoveAthleteOutcome } from "@/lib/data/coach/roster-data"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { loadClubUsers } from "@/lib/mock-club-admin"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * What only a club admin does to the people of the club: see every athlete (on a team or not, with
 * a login or not, still in the club or not), put an athlete on a team, take people out of the club,
 * delete an athlete's data, and invite several coaches at once.
 *
 * Every write is a database function that checks who is asking
 * (supabase/migrations/20261010090000_club_admin_invite_role_and_member_removal.sql and, for moving
 * an athlete, 20261009090000). Mock mode keeps the same behaviour in the browser.
 */

export type ClubAthleteStatus = "active" | "deactivated" | "left"

export type ClubAthlete = {
  id: string
  name: string
  /** Their login account, when they have one. */
  userId: string | null
  hasLogin: boolean
  /** The login email, when the club admin may see it. */
  email: string | null
  /** Null means not on a team. */
  teamId: string | null
  eventGroup: string | null
  primaryEvent: string | null
  /** active: in the club. deactivated: in the club, login switched off. left: removed from the club, history kept. */
  status: ClubAthleteStatus
}

type ClientResolution = { ok: true; client: SupabaseClient } | { ok: false; error: DataError }

function isMock() {
  return getBackendMode() !== "supabase"
}

function requireClient(operation: string): ClientResolution {
  const client = getBrowserSupabaseClient()
  if (!client) return { ok: false, error: { code: "UNKNOWN", message: `[${operation}] Supabase client is not configured.` } }
  return { ok: true, client }
}

/** Sentences the database functions raise, turned into something a club admin can act on. */
function peopleError(error: { code?: string; message: string; details?: string; hint?: string }): DataError {
  const message = error.message.toLowerCase()
  if (error.code === "PGRST202") {
    return { code: "NOT_FOUND", message: "This is not switched on for this workspace yet. The latest database update still needs to be applied.", cause: error }
  }
  if (message.includes("at least one active club-admin")) {
    return { code: "CONFLICT", message: "Your club needs at least one active club admin. Make someone else a club admin first.", cause: error }
  }
  if (message.includes("cannot remove yourself")) {
    return { code: "FORBIDDEN", message: "You cannot remove yourself from the club. Ask another club admin to do it.", cause: error }
  }
  if (message.includes("member not found")) {
    return { code: "NOT_FOUND", message: "This person is no longer part of your club. Reload the page and try again.", cause: error }
  }
  if (message.includes("athletes are removed")) {
    return { code: "VALIDATION", message: "This person is an athlete. Remove them from the Athletes list instead.", cause: error }
  }
  if (message.includes("only active club-admin")) {
    return { code: "FORBIDDEN", message: "Only an active club admin can do this. Your own access may have changed, so sign in again.", cause: error }
  }
  const mapped = mapPostgrestError(error as Parameters<typeof mapPostgrestError>[0])
  // Functions raise with a sentence written for the admin. Keep it; only hide raw policy text.
  const technical = /row-level security|permission denied|violates|does not exist$/i.test(error.message)
  if (error.hint !== "access_paused" && !technical && (error.code === "42501" || error.code === "22023" || error.code === "23514")) {
    return { code: error.code === "42501" ? "FORBIDDEN" : "VALIDATION", message: error.message, cause: error }
  }
  return mapped
}

/* ---------- Mock store ---------------------------------------------------------------------------- */

/** Demo only: what the demo club admin did to athletes that the roster demo store has no place for. */
const MOCK_KEY = "pacelab:club-athletes:v1"
type MockPeopleState = { left: string[]; deleted: string[] }

function readMockPeople(): MockPeopleState {
  if (typeof window === "undefined") return { left: [], deleted: [] }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(MOCK_KEY)) ?? "null") as Partial<MockPeopleState> | null
    return { left: Array.isArray(parsed?.left) ? parsed.left : [], deleted: Array.isArray(parsed?.deleted) ? parsed.deleted : [] }
  } catch {
    return { left: [], deleted: [] }
  }
}

function writeMockPeople(state: MockPeopleState): Result<null> {
  try {
    window.localStorage.setItem(tenantStorageKey(MOCK_KEY), JSON.stringify(state))
    return ok(null)
  } catch {
    return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
  }
}

/** The demo athlete "Marcus Johnson" is the demo athlete login. */
const MOCK_LOGIN_ATHLETE_ID = "a1"

/** Demo athletes other than the demo login have no row in the demo people list until one is needed. */
const MOCK_USER_PREFIX = "mock-user-"
export function mockAthleteUserId(athleteId: string) {
  return `${MOCK_USER_PREFIX}${athleteId}`
}

function mockEmailFor(name: string) {
  return `${name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@pacelab.local`
}

async function mockClubAthletes(): Promise<ClubAthlete[]> {
  const module = await import("@/lib/mock-data")
  const roster = loadMockRoster()
  const people = readMockPeople()
  const users = loadClubUsers()
  const loginUser = users.find((user) => user.role === "athlete" && !user.id.startsWith(MOCK_USER_PREFIX))
  const canned = module.mockAthletes
    .filter((athlete) => !people.deleted.includes(athlete.id))
    .map((athlete): ClubAthlete => {
      const override = roster.teamOverride[athlete.id]
      const left = people.left.includes(athlete.id)
      const isLogin = athlete.id === MOCK_LOGIN_ATHLETE_ID && Boolean(loginUser)
      const userId = isLogin && loginUser ? loginUser.id : mockAthleteUserId(athlete.id)
      return {
        id: athlete.id,
        name: athlete.name,
        userId,
        hasLogin: true,
        email: isLogin && loginUser ? loginUser.email : mockEmailFor(athlete.name),
        teamId: left ? null : override === undefined ? athlete.teamId : override,
        eventGroup: athlete.eventGroup,
        primaryEvent: athlete.primaryEvent,
        status: left ? "left" : users.some((user) => user.id === userId && user.status === "disabled") ? "deactivated" : "active",
      }
    })
  const added = roster.added
    .filter((athlete) => !people.deleted.includes(athlete.id))
    .map(
      (athlete): ClubAthlete => ({
        id: athlete.id,
        name: `${athlete.firstName} ${athlete.lastName}`.trim(),
        userId: athlete.hasLogin ? mockAthleteUserId(athlete.id) : null,
        hasLogin: athlete.hasLogin,
        email: null,
        teamId: athlete.active ? athlete.teamId : null,
        eventGroup: athlete.eventGroup,
        primaryEvent: athlete.primaryEvent,
        status: athlete.active ? "active" : "left",
      }),
    )
  return [...canned, ...added]
}

/* ---------- Reading ------------------------------------------------------------------------------- */

/**
 * Every athlete record of the club: on a team or not, with a login or not, and the ones who were
 * removed from the club (their history is kept until someone deletes it).
 */
export async function getClubAthletes(): Promise<Result<ClubAthlete[]>> {
  if (isMock()) return ok(await mockClubAthletes())
  const clientResult = requireClient("getClubAthletes")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client

  const rows: Array<{
    id: string
    user_id: string | null
    team_id: string | null
    first_name: string
    last_name: string
    event_group: string | null
    primary_event: string | null
    is_active: boolean
  }> = []
  // 1,000 rows a page, so a big club is not cut off by the API row limit.
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await client
      .from("athletes")
      .select("id, user_id, team_id, first_name, last_name, event_group, primary_event, is_active")
      .order("first_name", { ascending: true })
      .order("id", { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    const batch = (data as typeof rows | null) ?? []
    rows.push(...batch)
    if (batch.length < 1000) break
  }

  const userIds = rows.flatMap((row) => (row.user_id ? [row.user_id] : []))
  const inactiveUsers = new Set<string>()
  if (userIds.length > 0) {
    // Only the switched-off logins are needed, and there are few of them.
    const { data, error } = await client.from("profiles").select("user_id").eq("is_active", false)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    for (const row of (data as Array<{ user_id: string }> | null) ?? []) inactiveUsers.add(row.user_id)
  }

  const emails = new Map<string, string>()
  try {
    const emailsResult = await client.rpc("get_tenant_member_emails")
    if (!emailsResult.error) {
      for (const row of (emailsResult.data as Array<{ user_id: string | null; email: string | null }> | null) ?? []) {
        if (row.user_id && row.email) emails.set(row.user_id, row.email.toLowerCase())
      }
    }
  } catch {
    // Emails are a nicety here. The list still shows without them.
  }

  return ok(
    rows.map((row): ClubAthlete => ({
      id: row.id,
      name: `${row.first_name} ${row.last_name}`.trim() || "Athlete",
      userId: row.user_id,
      hasLogin: row.user_id !== null,
      email: row.user_id ? (emails.get(row.user_id) ?? null) : null,
      teamId: row.is_active ? row.team_id : null,
      eventGroup: row.event_group,
      primaryEvent: row.primary_event,
      status: !row.is_active ? "left" : row.user_id && inactiveUsers.has(row.user_id) ? "deactivated" : "active",
    })),
  )
}

/* ---------- Athletes: team, club, data -------------------------------------------------------------- */

/**
 * Puts an athlete on a team: one who is on no team, or one who is on another team. A club admin can
 * do this for any athlete of the club. History stays with the athlete.
 */
export async function assignAthleteToTeam(athleteId: string, toTeamId: string): Promise<Result<MoveAthleteOutcome>> {
  if (isMock()) {
    const athlete = (await mockClubAthletes()).find((item) => item.id === athleteId)
    if (!athlete || athlete.status === "left") return err("NOT_FOUND", "Athlete not found.")
    if (athlete.teamId === toTeamId) return err("VALIDATION", "The athlete is already on that team.")
    try {
      updateMockRoster((state) =>
        state.added.some((item) => item.id === athleteId)
          ? { ...state, added: state.added.map((item) => (item.id === athleteId ? { ...item, teamId: toTeamId } : item)) }
          : { ...state, teamOverride: { ...state.teamOverride, [athleteId]: toTeamId } },
      )
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    return ok({ fromTeamId: athlete.teamId, toTeamId, removedSessions: 0, createdSessions: 0, warning: null })
  }
  return moveAthleteToTeam(athleteId, toTeamId)
}

/**
 * Takes an athlete out of the club. Nothing is deleted: they come off their team, their place in
 * the package is freed and their login for this club stops working. Their sessions, results and
 * messages are kept, and they can be brought back.
 */
export async function removeAthleteFromClub(athleteId: string): Promise<Result<null>> {
  if (isMock()) {
    try {
      updateMockRoster((state) =>
        state.added.some((item) => item.id === athleteId)
          ? {
              ...state,
              added: state.added.map((item) => (item.id === athleteId ? { ...item, active: false, teamId: null } : item)),
              invites: state.invites.map((invite) => (invite.athleteId === athleteId && invite.status === "pending" ? { ...invite, status: "revoked" } : invite)),
            }
          : { ...state, teamOverride: { ...state.teamOverride, [athleteId]: null } },
      )
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    const people = readMockPeople()
    return writeMockPeople({ ...people, left: [...new Set([...people.left, athleteId])] })
  }
  const clientResult = requireClient("removeAthleteFromClub")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("remove_athlete_from_club", { p_athlete_id: athleteId })
  if (error) return { ok: false, error: peopleError(error) }
  if (data !== true) return err("NOT_FOUND", "This athlete is no longer in your club. Reload the page.")
  return ok(null)
}

/** Brings back an athlete who was removed from the club. They are on no team until you put them on one. */
export async function restoreAthleteToClub(athleteId: string): Promise<Result<null>> {
  if (isMock()) {
    try {
      updateMockRoster((state) => ({ ...state, added: state.added.map((item) => (item.id === athleteId ? { ...item, active: true, teamId: null } : item)) }))
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    const people = readMockPeople()
    return writeMockPeople({ ...people, left: people.left.filter((id) => id !== athleteId) })
  }
  const clientResult = requireClient("restoreAthleteToClub")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("restore_athlete_to_club", { p_athlete_id: athleteId })
  if (error) return { ok: false, error: peopleError(error) }
  if (data !== true) return err("NOT_FOUND", "This athlete is already in your club. Reload the page.")
  return ok(null)
}

/** True when what was typed is the athlete's full name (case and extra spaces are forgiven). */
export function isAthleteNameConfirmed(name: string, typed: string) {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase()
  return clean(name) !== "" && clean(name) === clean(typed)
}

/**
 * Deletes an athlete and everything recorded about them, for a privacy request. It cannot be undone.
 * `typedName` is what the admin typed in the confirmation box; the database checks it again.
 * The login account itself is not deleted (that needs SKTR support).
 */
export async function deleteAthleteAndData(athleteId: string, typedName: string): Promise<Result<null>> {
  if (isMock()) {
    const athlete = (await mockClubAthletes()).find((item) => item.id === athleteId)
    if (!athlete) return err("NOT_FOUND", "Athlete not found in this club.")
    if (!isAthleteNameConfirmed(athlete.name, typedName)) return err("VALIDATION", "Type the athlete's full name exactly to delete their data.")
    try {
      updateMockRoster((state) => ({
        ...state,
        added: state.added.filter((item) => item.id !== athleteId),
        teamOverride: state.added.some((item) => item.id === athleteId) ? state.teamOverride : { ...state.teamOverride, [athleteId]: null },
        invites: state.invites.filter((invite) => invite.athleteId !== athleteId),
      }))
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    const people = readMockPeople()
    return writeMockPeople({ left: people.left.filter((id) => id !== athleteId), deleted: [...new Set([...people.deleted, athleteId])] })
  }
  const clientResult = requireClient("deleteAthleteAndData")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("delete_athlete_and_data", { p_athlete_id: athleteId, p_confirm_name: typedName })
  if (error) return { ok: false, error: peopleError(error) }
  if (data !== true) return err("UNKNOWN", "The delete did not report back. Reload the page to see what is left.")
  return ok(null)
}

/* ---------- Staff ----------------------------------------------------------------------------------- */

/**
 * Removes a coach or club admin from the club for good (deactivating is the reversible switch).
 * Their profile and team assignments go; the plans, notes and messages they wrote stay, with their
 * name. Refused for yourself and for the last active club admin. Supabase mode only: the demo
 * screen changes its own list.
 */
export async function removeClubMember(userId: string): Promise<Result<null>> {
  const clientResult = requireClient("removeClubMember")
  if (!clientResult.ok) return clientResult
  const { error } = await clientResult.client.rpc("remove_tenant_member", { p_user_id: userId })
  if (error) return { ok: false, error: peopleError(error) }
  return ok(null)
}

export type StaffInviteRole = "coach" | "club-admin"

/**
 * Creates several staff invites in one request. Each line is its own row, so the row policy and the
 * club admin invite check apply to every one. Returns the invites in the order given. Supabase mode
 * only: the demo screen builds its own.
 */
export async function createStaffInvites(emails: string[], role: StaffInviteRole): Promise<Result<ClubAdminInvite[]>> {
  const clientResult = requireClient("createStaffInvites")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client
  const clean = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))]
  if (clean.length === 0) return ok([])

  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "Your session has ended. Sign in again and retry.")
  const { data: profile, error: profileError } = await client.from("profiles").select("tenant_id, role").eq("user_id", userId).maybeSingle()
  if (profileError) return { ok: false, error: mapPostgrestError(profileError) }
  if (!profile || profile.role !== "club-admin") return err("FORBIDDEN", "Only a club admin can invite staff.")

  const expiresAt = new Date(Date.now() + COACH_INVITE_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await client
    .from("coach_invites")
    .insert(
      clean.map((email) => ({
        tenant_id: profile.tenant_id as string,
        email,
        team_id: null,
        role,
        status: "pending",
        invited_by_user_id: userId,
        expires_at: expiresAt,
      })),
    )
    .select("id, email, status, created_at, expires_at")
  if (error) return { ok: false, error: peopleError(error) }

  const byEmail = new Map(
    ((data as Array<{ id: string; email: string; status: ClubAdminInvite["status"]; created_at: string; expires_at: string | null }> | null) ?? []).map((row) => [row.email.toLowerCase(), row]),
  )
  return ok(
    clean.flatMap((email): ClubAdminInvite[] => {
      const row = byEmail.get(email)
      return row
        ? [{ id: row.id, email: row.email, role, status: row.status, createdAt: row.created_at.slice(0, 10), expiresAt: row.expires_at ?? undefined, inviteUrl: `/invite/coach/${row.id}` }]
        : []
    }),
  )
}
