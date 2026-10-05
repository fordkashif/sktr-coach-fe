import { loadMockRoster, mergeMockAthletes, mockAthleteLimit, mockId, mockJoinCodeValue, mockRosterKeyForJoinCode, mockSessionIdentity, updateMockRoster, type MockJoinCode } from "@/lib/data/coach/roster-mock"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * Team join codes: the QR code a coach shows at practice so a whole squad can join at once.
 *
 * The rules live in the database (supabase/migrations/20261009090000_roster_bulk_join_codes_managed_athletes.sql):
 * a code is made by a coach of the team or a club admin, is one per team, expires, has a maximum
 * number of uses, can be turned off, and only ever makes someone an athlete of that one team.
 * Mock mode follows the same rules in the browser.
 */

export type JoinCodeExpiryDays = 1 | 7 | 30

export const JOIN_CODE_EXPIRY_OPTIONS: Array<{ value: JoinCodeExpiryDays; label: string }> = [
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
]

export type TeamJoinCode = {
  id: string
  teamId: string
  code: string
  expiresAt: string
  maxUses: number
  useCount: number
  /** Still usable: not turned off, not expired, not used up. */
  live: boolean
  /** Why it is not live, for the screen. */
  state: "live" | "expired" | "full" | "off"
}

/** What the public join page learns about a code. Names are only there for a code that works. */
export type PublicJoinCode =
  | { status: "active"; teamName: string; organizationName: string; eventGroup: string | null; expiresAt: string | null }
  | { status: "expired" | "disabled" | "full" | "unavailable" | "invalid" | "rate_limited" }

export type JoinOutcome =
  | { status: "joined" | "already_member"; teamId: string; teamName: string; athleteId: string | null }
  | {
      status:
        | "invalid"
        | "expired"
        | "disabled"
        | "full"
        | "unavailable"
        | "unconfirmed_email"
        | "not_athlete"
        | "wrong_club"
        | "other_team"
        | "inactive_athlete"
        | "has_other_access"
        | "club_full"
        | "rate_limited"
    }

/** The link a QR code carries. Always this app's own address and the code, nothing else. */
export function joinLinkPath(code: string) {
  return `/join/${code}`
}

export function joinLink(code: string) {
  return typeof window === "undefined" ? joinLinkPath(code) : new URL(joinLinkPath(code), window.location.origin).toString()
}

/** Accepts a code or a whole join link and returns the bare code (lower case), or "" when there is none. */
export function normalizeJoinCode(raw: string): string {
  const trimmed = raw.trim()
  const fromPath = /\/join\/([0-9a-fA-F]{32})(?:[/?#]|$)/.exec(trimmed)
  const value = (fromPath ? fromPath[1] : trimmed).toLowerCase()
  return /^[0-9a-f]{32}$/.test(value) ? value : ""
}

function isMock() {
  return getBackendMode() !== "supabase"
}

function stateOf(code: { expiresAt: string; maxUses: number; useCount: number; disabledAt: string | null }): TeamJoinCode["state"] {
  if (code.disabledAt) return "off"
  if (new Date(code.expiresAt).getTime() < Date.now()) return "expired"
  if (code.useCount >= code.maxUses) return "full"
  return "live"
}

function fromMock(code: MockJoinCode): TeamJoinCode {
  const state = stateOf(code)
  return { id: code.id, teamId: code.teamId, code: code.code, expiresAt: code.expiresAt, maxUses: code.maxUses, useCount: code.useCount, live: state === "live", state }
}

type CodeRow = { id: string; team_id: string; code: string; expires_at: string; max_uses: number; use_count: number; disabled_at?: string | null }

function fromRow(row: CodeRow): TeamJoinCode {
  const state = stateOf({ expiresAt: row.expires_at, maxUses: row.max_uses, useCount: row.use_count, disabledAt: row.disabled_at ?? null })
  return { id: row.id, teamId: row.team_id, code: row.code, expiresAt: row.expires_at, maxUses: row.max_uses, useCount: row.use_count, live: state === "live", state }
}

function functionError(error: { code?: string; message: string; hint?: string }): DataError {
  const mapped = mapPostgrestError(error as Parameters<typeof mapPostgrestError>[0])
  if ((error.code === "42501" || error.code === "22023") && error.hint !== "access_paused" && !/row-level security|permission denied/i.test(error.message)) {
    return { code: error.code === "42501" ? "FORBIDDEN" : "VALIDATION", message: error.message, cause: error }
  }
  return mapped
}

/** The newest join code of a team that has not been turned off, or null. It may have expired or be used up. */
export async function getTeamJoinCode(teamId: string): Promise<Result<TeamJoinCode | null>> {
  if (isMock()) {
    const code = loadMockRoster().joinCodes.find((item) => item.teamId === teamId && !item.disabledAt)
    return ok(code ? fromMock(code) : null)
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client
    .from("team_join_codes")
    .select("id, team_id, code, expires_at, max_uses, use_count, disabled_at")
    .eq("team_id", teamId)
    .is("disabled_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(data ? fromRow(data as CodeRow) : null)
}

/**
 * Makes a new join code for the team and turns off the one before it. `maxUses` left out means
 * "the athlete seats the club has left" (the database works it out).
 */
export async function createTeamJoinCode(teamId: string, expiresInDays: JoinCodeExpiryDays, maxUses?: number | null): Promise<Result<TeamJoinCode>> {
  if (maxUses !== undefined && maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 500)) {
    return err("VALIDATION", "A join code can be used between 1 and 500 times.")
  }
  if (isMock()) {
    const module = await import("@/lib/mock-data")
    const state = loadMockRoster()
    const seatsLeft = Math.max(
      mockAthleteLimit() - mergeMockAthletes(module.mockAthletes, state).length - state.invites.filter((invite) => invite.status === "pending" && !invite.athleteId).length,
      0,
    )
    if (seatsLeft === 0 && !maxUses) return err("VALIDATION", "Your club has no athlete seats left in its package. Ask a club admin to upgrade before sharing a join code.")
    const code: MockJoinCode = {
      id: mockId("code"),
      teamId,
      code: mockJoinCodeValue(),
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
      maxUses: maxUses ?? Math.min(seatsLeft, 500),
      useCount: 0,
      disabledAt: null,
      createdAt: new Date().toISOString(),
    }
    try {
      updateMockRoster((current) => ({
        ...current,
        joinCodes: [code, ...current.joinCodes.map((item) => (item.teamId === teamId && !item.disabledAt ? { ...item, disabledAt: code.createdAt } : item))],
      }))
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    return ok(fromMock(code))
  }

  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.rpc("create_team_join_code", { p_team_id: teamId, p_expires_in_days: expiresInDays, p_max_uses: maxUses ?? null })
  if (error) return { ok: false, error: functionError(error) }
  const row = ((data as CodeRow[] | null) ?? [])[0]
  if (!row) return err("UNKNOWN", "The join code was not created. Try again.")
  return ok(fromRow(row))
}

/** Turns a join code off straight away. People who already joined stay on the team. */
export async function disableTeamJoinCode(codeId: string): Promise<Result<null>> {
  if (isMock()) {
    try {
      updateMockRoster((state) => ({
        ...state,
        joinCodes: state.joinCodes.map((item) => (item.id === codeId && !item.disabledAt ? { ...item, disabledAt: new Date().toISOString() } : item)),
      }))
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    return ok(null)
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.rpc("disable_team_join_code", { p_code_id: codeId })
  if (error) return { ok: false, error: functionError(error) }
  if (data !== true) return err("NOT_FOUND", "This join code was already turned off.")
  return ok(null)
}

/* ---------- The person joining ------------------------------------------------------------------- */

/** What the public join page shows. Works signed out. A wrong code says nothing about any team. */
export async function getPublicJoinCode(rawCode: string): Promise<Result<PublicJoinCode>> {
  const code = normalizeJoinCode(rawCode)
  if (isMock()) {
    if (!code) return ok({ status: "invalid" })
    const found = loadMockRoster(mockRosterKeyForJoinCode(code)).joinCodes.find((item) => item.code === code)
    if (!found) return ok({ status: "invalid" })
    const state = stateOf(found)
    if (state !== "live") return ok({ status: state === "off" ? "disabled" : state })
    const module = await import("@/lib/mock-data")
    const team = module.mockTeams.find((item) => item.id === found.teamId)
    if (!team) return ok({ status: "unavailable" })
    return ok({ status: "active", teamName: team.name, organizationName: "Elite Track Club", eventGroup: team.eventGroup, expiresAt: found.expiresAt })
  }

  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  // The raw text is sent even when it is not code shaped, so a wrong link counts as a wrong guess.
  const { data, error } = await client.rpc("get_public_team_join_code", { p_code: code || rawCode.trim().slice(0, 64) })
  if (error) return { ok: false, error: mapPostgrestError(error) }
  const row = ((Array.isArray(data) ? data : data ? [data] : []) as Array<{
    status: string
    team_name: string | null
    organization_name: string | null
    event_group: string | null
    expires_at: string | null
  }>)[0]
  if (!row) return ok({ status: "invalid" })
  if (row.status === "active" && row.team_name) {
    return ok({ status: "active", teamName: row.team_name, organizationName: row.organization_name ?? "Your club", eventGroup: row.event_group, expiresAt: row.expires_at })
  }
  const known = ["expired", "disabled", "full", "unavailable", "rate_limited"] as const
  return ok({ status: (known as readonly string[]).includes(row.status) ? (row.status as (typeof known)[number]) : "invalid" })
}

const JOIN_STATUSES = [
  "invalid",
  "expired",
  "disabled",
  "full",
  "unavailable",
  "unconfirmed_email",
  "not_athlete",
  "wrong_club",
  "other_team",
  "inactive_athlete",
  "has_other_access",
  "club_full",
  "rate_limited",
] as const

/**
 * Joins the team of a code as the signed-in person. In mock mode `newAthleteName` adds a demo
 * athlete with that name when nobody is signed in as an athlete (there are no accounts to create).
 */
export async function joinTeamWithCode(rawCode: string, options?: { newAthleteName?: string }): Promise<Result<JoinOutcome>> {
  const code = normalizeJoinCode(rawCode)
  if (isMock()) {
    if (!code) return ok({ status: "invalid" })
    const module = await import("@/lib/mock-data")
    const storageKey = mockRosterKeyForJoinCode(code)
    const state = loadMockRoster(storageKey)
    const found = state.joinCodes.find((item) => item.code === code)
    if (!found) return ok({ status: "invalid" })
    const team = module.mockTeams.find((item) => item.id === found.teamId)
    if (!team) return ok({ status: "unavailable" })
    const identity = mockSessionIdentity()
    const athletes = mergeMockAthletes(module.mockAthletes, state)

    if (identity.role && identity.role !== "athlete") return ok({ status: "not_athlete" })
    if (identity.role === "athlete") {
      // The demo athlete is Marcus Johnson (a1).
      const me = athletes.find((athlete) => athlete.id === "a1")
      if (me?.teamId === found.teamId) return ok({ status: "already_member", teamId: team.id, teamName: team.name, athleteId: me.id })
      if (me) return ok({ status: "other_team" })
    }
    const codeState = stateOf(found)
    if (codeState !== "live") return ok({ status: codeState === "off" ? "disabled" : codeState })
    if (athletes.length >= mockAthleteLimit() && identity.role !== "athlete") return ok({ status: "club_full" })

    const name = (options?.newAthleteName ?? "").replace(/\s+/g, " ").trim()
    const [firstName, ...rest] = (name || "New Athlete").split(" ")
    const athleteId = identity.role === "athlete" ? "a1" : mockId("j")
    try {
      updateMockRoster((current) => ({
        ...current,
        joinCodes: current.joinCodes.map((item) => (item.id === found.id ? { ...item, useCount: item.useCount + 1 } : item)),
        ...(identity.role === "athlete"
          ? { teamOverride: { ...current.teamOverride, a1: found.teamId } }
          : {
              added: [
                ...current.added,
                {
                  id: athleteId,
                  firstName,
                  lastName: rest.join(" ") || "Athlete",
                  dateOfBirth: null,
                  eventGroup: null,
                  primaryEvent: null,
                  guardianName: null,
                  guardianPhone: null,
                  guardianEmail: null,
                  teamId: found.teamId,
                  hasLogin: true,
                  active: true,
                },
              ],
            }),
      }), storageKey)
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    return ok({ status: "joined", teamId: team.id, teamName: team.name, athleteId })
  }

  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.rpc("join_team_with_code", { p_code: code || rawCode.trim().slice(0, 64) })
  if (error) return { ok: false, error: mapPostgrestError(error) }
  const row = ((Array.isArray(data) ? data : data ? [data] : []) as Array<{ status: string; team_id: string | null; team_name: string | null; athlete_id: string | null }>)[0]
  if (!row) return ok({ status: "invalid" })
  if ((row.status === "joined" || row.status === "already_member") && row.team_id) {
    return ok({ status: row.status, teamId: row.team_id, teamName: row.team_name ?? "your team", athleteId: row.athlete_id })
  }
  return ok({ status: (JOIN_STATUSES as readonly string[]).includes(row.status) ? (row.status as (typeof JOIN_STATUSES)[number]) : "invalid" })
}

/** What to tell someone whose join did not go through. */
export function joinProblem(status: Exclude<JoinOutcome["status"], "joined" | "already_member"> | PublicJoinCode["status"]): { title: string; body: string } {
  switch (status) {
    case "expired":
      return { title: "This join code has expired", body: "Join codes only last a few days. Ask your coach to show you the new one." }
    case "disabled":
      return { title: "This join code was turned off", body: "Your coach turned it off or made a new one. Ask them to show you the current code." }
    case "full":
      return { title: "This join code has been used up", body: "It has reached the number of athletes it was made for. Ask your coach for a new one." }
    case "unavailable":
      return { title: "This team is not taking new athletes right now", body: "Ask your coach or your club what to do next." }
    case "rate_limited":
      return { title: "Too many tries", body: "Wait a few minutes, then scan the code again or open the link your coach shared." }
    case "unconfirmed_email":
      return { title: "Confirm your email first", body: "Open the email we sent you and tap the link in it. Then scan the code or open this page again." }
    case "not_athlete":
      return { title: "This code is for athletes", body: "You are signed in as a coach or club admin. Athletes join with their own account." }
    case "wrong_club":
      return { title: "This code is for a different club", body: "Your account belongs to another club, so it cannot join this team." }
    case "other_team":
      return { title: "You are already on another team", body: "Only a coach or your club can move you between teams. Ask your coach." }
    case "inactive_athlete":
      return { title: "Your athlete record was switched off", body: "Ask your club admin to restore it before you join a team." }
    case "has_other_access":
      return { title: "This email already has its own access", body: "It is set up for running a club or the platform, so it cannot join a team as an athlete. Use another email address." }
    case "club_full":
      return { title: "The club has no athlete places left", body: "Its package is full. Let your coach know, they can ask the club to add places." }
    case "active":
      return { title: "", body: "" }
    default:
      return { title: "We could not find that join code", body: "Scan the code again, or ask your coach for the link. Codes are long, so a typed one is easy to get wrong." }
  }
}
