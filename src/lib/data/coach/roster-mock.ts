import { getCookieValue, ROLE_COOKIE, USER_COOKIE } from "@/lib/auth-session"
import type { Athlete, EventGroup } from "@/lib/mock-data"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Mock mode only: what the demo coach changed about the roster, kept in this browser.
 * The canned demo athletes stay as they are; this file holds the differences (athletes without a
 * login that were added, athletes moved or removed, people who joined with a join code, invites
 * and join codes), so the roster screens behave the same way they do against the real backend.
 */

const STORAGE_KEY = "pacelab:coach-roster:v1"
/** Demo package limit. Set localStorage "pacelab:mock-athlete-limit" to a number to try the limit states. */
const LIMIT_STORAGE_KEY = "pacelab:mock-athlete-limit"
const DEFAULT_MOCK_LIMIT = 150
export const ROSTER_CHANGED_EVENT = "pacelab:roster-changed"

export type MockManagedAthlete = {
  id: string
  firstName: string
  lastName: string
  dateOfBirth: string | null
  eventGroup: EventGroup | null
  primaryEvent: string | null
  guardianName: string | null
  guardianPhone: string | null
  guardianEmail: string | null
  teamId: string | null
  /** False while staff enter everything for them. True once a login invite was "accepted" or they joined with a code. */
  hasLogin: boolean
  active: boolean
}

export type MockInvite = {
  id: string
  teamId: string
  email: string
  name: string | null
  /** Set on a "give them a login" invite. */
  athleteId: string | null
  status: "pending" | "accepted" | "expired" | "revoked"
  createdAt: string
  expiresAt: string | null
  emailSentAt: string | null
  emailSendCount: number
  emailError: string | null
}

export type MockJoinCode = {
  id: string
  teamId: string
  code: string
  expiresAt: string
  maxUses: number
  useCount: number
  disabledAt: string | null
  createdAt: string
}

type MockRosterState = {
  added: MockManagedAthlete[]
  /** Team of a canned demo athlete after a move. null means removed from their team. */
  teamOverride: Record<string, string | null>
  invites: MockInvite[]
  joinCodes: MockJoinCode[]
}

const EMPTY: MockRosterState = { added: [], teamOverride: {}, invites: [], joinCodes: [] }

function read(storageKey: string = tenantStorageKey(STORAGE_KEY)): MockRosterState {
  if (typeof window === "undefined") return EMPTY
  try {
    const raw = window.localStorage.getItem(storageKey)
    const parsed = raw ? (JSON.parse(raw) as Partial<MockRosterState>) : null
    if (!parsed || typeof parsed !== "object") return { ...EMPTY }
    return {
      added: Array.isArray(parsed.added) ? parsed.added : [],
      teamOverride: parsed.teamOverride && typeof parsed.teamOverride === "object" ? parsed.teamOverride : {},
      invites: Array.isArray(parsed.invites) ? parsed.invites : [],
      joinCodes: Array.isArray(parsed.joinCodes) ? parsed.joinCodes : [],
    }
  } catch {
    return { ...EMPTY }
  }
}

function write(state: MockRosterState, storageKey: string = tenantStorageKey(STORAGE_KEY)) {
  window.localStorage.setItem(storageKey, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent(ROSTER_CHANGED_EVENT))
}

export function loadMockRoster(storageKey?: string): MockRosterState {
  return read(storageKey)
}

/** Applies a change and saves it. Throws when the browser refuses to store (private mode, full). */
export function updateMockRoster(change: (state: MockRosterState) => MockRosterState, storageKey?: string): MockRosterState {
  const next = change(read(storageKey))
  write(next, storageKey)
  return next
}

/**
 * The demo club whose roster holds this join code. Someone opening a join link is signed out, so
 * there is no club in their session: the code itself says which club it belongs to, as it does on
 * the real backend. Undefined when no demo club has the code.
 */
export function mockRosterKeyForJoinCode(code: string): string | undefined {
  if (typeof window === "undefined") return undefined
  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index)
    if (key?.startsWith(`${STORAGE_KEY}:`) && read(key).joinCodes.some((item) => item.code === code)) return key
  }
  return undefined
}

export function mockId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 32 hex characters, the same shape as a real join code. */
export function mockJoinCodeValue() {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function mockAthleteLimit(): number {
  if (typeof window === "undefined") return DEFAULT_MOCK_LIMIT
  const stored = Number.parseInt(window.localStorage.getItem(LIMIT_STORAGE_KEY) ?? "", 10)
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_MOCK_LIMIT
}

export type MockRosterAthlete = Athlete & { hasLogin: boolean; dateOfBirth: string | null; managed: MockManagedAthlete | null }

function ageFrom(dateOfBirth: string | null) {
  if (!dateOfBirth) return 0
  const born = new Date(`${dateOfBirth}T00:00:00`)
  if (Number.isNaN(born.getTime())) return 0
  const today = new Date()
  let age = today.getFullYear() - born.getFullYear()
  if (today.getMonth() < born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() < born.getDate())) age -= 1
  return Math.max(age, 0)
}

/** Every demo athlete as the roster sees them now: canned athletes with moves applied, plus the added ones. */
export function mergeMockAthletes(canned: Athlete[], state: MockRosterState = read()): MockRosterAthlete[] {
  const fromCanned = canned.flatMap((athlete): MockRosterAthlete[] => {
    const override = state.teamOverride[athlete.id]
    if (override === null) return []
    return [{ ...athlete, teamId: override ?? athlete.teamId, hasLogin: true, dateOfBirth: null, managed: null }]
  })
  const added = state.added
    .filter((athlete) => athlete.active && athlete.teamId)
    .map(
      (athlete): MockRosterAthlete => ({
        id: athlete.id,
        name: `${athlete.firstName} ${athlete.lastName}`.trim(),
        age: ageFrom(athlete.dateOfBirth),
        eventGroup: athlete.eventGroup ?? "Sprint",
        primaryEvent: athlete.primaryEvent ?? "No event yet",
        readiness: "green",
        adherence: null,
        lastWellness: "-",
        teamId: athlete.teamId as string,
        hasLogin: athlete.hasLogin,
        dateOfBirth: athlete.dateOfBirth,
        managed: athlete,
      }),
    )
  return [...fromCanned, ...added]
}

/** Who is signed in to the demo, for the join page. */
export function mockSessionIdentity(): { role: string | null; email: string | null } {
  return { role: getCookieValue(ROLE_COOKIE) || null, email: getCookieValue(USER_COOKIE) || null }
}
