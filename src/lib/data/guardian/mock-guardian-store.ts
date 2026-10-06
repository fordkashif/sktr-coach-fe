import { loadMockAthleteProfileEdits, MOCK_ATHLETE_ID } from "@/lib/data/athlete/profile-data"
import { guardianHealthRule, type GuardianHealthRule } from "@/lib/guardian/health-visibility"
import { MOCK_CREDENTIALS } from "@/lib/mock-auth"
import { loadClubUsers } from "@/lib/mock-club-admin"
import { mockAthletes, mockTeams } from "@/lib/mock-data"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Demo mode: parent and guardian links, invites, the athlete's sharing switch and the guardian
 * contact on file, kept in this browser per demo club. The real thing lives in the database
 * (supabase/migrations/20261016090000_guardian_access.sql); the rules here are the same.
 *
 * The demo guardian (guardian@pacelab.local) follows two athletes:
 *   Mia Anderson (a8, Throws Group)   16 years old, so health is visible
 *   Marcus Johnson (a1, Sprint Group) an adult, who is also the demo athlete: sign in as the
 *                                     athlete and switch sharing on in the profile to see it change
 * Liam Patel (a9) has no date of birth on file, which shows the coach the hint to add it.
 */

export const MOCK_GUARDIAN_EMAIL = MOCK_CREDENTIALS.guardian.email
export const MOCK_GUARDIAN_NAME = "Dana Anderson"
export const MOCK_GUARDIANS_CHANGED_EVENT = "pacelab:guardians-changed"

export type MockGuardianLink = {
  id: string
  athleteId: string
  email: string
  name: string | null
  relationship: string
  status: "active" | "revoked"
  createdAt: string
}

export type MockGuardianInvite = {
  id: string
  athleteId: string
  email: string
  name: string | null
  relationship: string
  status: "pending" | "accepted" | "revoked"
  createdAt: string
  expiresAt: string
  lastEmailSentAt: string | null
}

export type MockGuardianContact = { name: string | null; phone: string | null; email: string | null }

type State = {
  links: MockGuardianLink[]
  invites: MockGuardianInvite[]
  /** athlete id to "share my health information with my guardians". */
  sharing: Record<string, boolean>
  contacts: Record<string, MockGuardianContact>
}

const STORAGE_KEY = "pacelab:guardians:v1"
export const MAX_GUARDIANS_PER_ATHLETE = 6

function isoDaysFromNow(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

function seed(): State {
  return {
    links: [
      { id: "gl-mia", athleteId: "a8", email: MOCK_GUARDIAN_EMAIL, name: MOCK_GUARDIAN_NAME, relationship: "Mother", status: "active", createdAt: isoDaysFromNow(-40) },
      { id: "gl-marcus", athleteId: "a1", email: MOCK_GUARDIAN_EMAIL, name: MOCK_GUARDIAN_NAME, relationship: "Aunt", status: "active", createdAt: isoDaysFromNow(-12) },
    ],
    invites: [],
    sharing: {},
    contacts: {
      a8: { name: MOCK_GUARDIAN_NAME, phone: "+1 876 555 0142", email: MOCK_GUARDIAN_EMAIL },
      a9: { name: "Priya Patel", phone: "+1 876 555 0177", email: "priya.patel@example.com" },
    },
  }
}

function read(): State {
  if (typeof window === "undefined") return seed()
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(STORAGE_KEY))
    if (!raw) return seed()
    const parsed = JSON.parse(raw) as Partial<State> | null
    if (!parsed || !Array.isArray(parsed.links) || !Array.isArray(parsed.invites)) return seed()
    return { links: parsed.links, invites: parsed.invites, sharing: parsed.sharing ?? {}, contacts: parsed.contacts ?? {} }
  } catch {
    return seed()
  }
}

function write(state: State): boolean {
  try {
    window.localStorage.setItem(tenantStorageKey(STORAGE_KEY), JSON.stringify(state))
    window.dispatchEvent(new CustomEvent(MOCK_GUARDIANS_CHANGED_EVENT))
    return true
  } catch {
    return false
  }
}

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function yearsAgo(years: number, extraDays: number): string {
  const date = new Date()
  date.setFullYear(date.getFullYear() - years)
  date.setDate(date.getDate() - extraDays)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** The demo athletes' dates of birth. Mia is 16, Liam's is not on file, the rest follow their demo age. */
export function mockAthleteDateOfBirth(athleteId: string): string | null {
  if (athleteId === "a8") return yearsAgo(16, 120)
  if (athleteId === "a9") return null
  if (athleteId === MOCK_ATHLETE_ID) {
    const edited = loadMockAthleteProfileEdits().dateOfBirth
    if (edited) return edited
  }
  const athlete = mockAthletes.find((item) => item.id === athleteId)
  return athlete ? yearsAgo(athlete.age, 120) : null
}

export function mockGuardianHealthRule(athleteId: string): GuardianHealthRule {
  return guardianHealthRule({ dateOfBirth: mockAthleteDateOfBirth(athleteId), adultOptIn: read().sharing[athleteId] === true, today: todayIso() })
}

export function mockAthleteName(athleteId: string): string {
  return mockAthletes.find((athlete) => athlete.id === athleteId)?.name ?? "Athlete"
}

export function mockAthleteTeam(athleteId: string) {
  const athlete = mockAthletes.find((item) => item.id === athleteId)
  return mockTeams.find((team) => team.id === athlete?.teamId) ?? null
}

/* ---------- The guardian's side ---------------------------------------------------------------- */

export type MockGuardianChild = { linkId: string; athleteId: string; name: string; relationship: string }

export function listMockGuardianChildren(email: string | null): MockGuardianChild[] {
  const key = (email ?? "").trim().toLowerCase()
  if (!key) return []
  return read()
    .links.filter((link) => link.status === "active" && link.email === key && mockAthletes.some((athlete) => athlete.id === link.athleteId))
    .map((link) => ({ linkId: link.id, athleteId: link.athleteId, name: mockAthleteName(link.athleteId), relationship: link.relationship }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function mockGuardianFollows(email: string | null, athleteId: string): boolean {
  return listMockGuardianChildren(email).some((child) => child.athleteId === athleteId)
}

export function getMockGuardianContact(athleteId: string): MockGuardianContact {
  return read().contacts[athleteId] ?? { name: null, phone: null, email: null }
}

export function saveMockGuardianContact(athleteId: string, contact: MockGuardianContact): boolean {
  const state = read()
  state.contacts = { ...state.contacts, [athleteId]: contact }
  return write(state)
}

/* ---------- The athlete's side ----------------------------------------------------------------- */

export function getMockHealthSharing(athleteId: string): boolean {
  return read().sharing[athleteId] === true
}

export function setMockHealthSharing(athleteId: string, enabled: boolean): boolean {
  const state = read()
  state.sharing = { ...state.sharing, [athleteId]: enabled }
  return write(state)
}

export function listMockGuardiansOfAthlete(athleteId: string): MockGuardianLink[] {
  return read().links.filter((link) => link.athleteId === athleteId && link.status === "active")
}

/* ---------- The staff side ---------------------------------------------------------------------- */

export function listMockPendingInvites(athleteId?: string): MockGuardianInvite[] {
  return read().invites.filter((invite) => invite.status === "pending" && (!athleteId || invite.athleteId === athleteId))
}

export function listMockActiveLinks(): MockGuardianLink[] {
  return read().links.filter((link) => link.status === "active")
}

/** What an email already is in the demo club: the same answers as guardian_email_standing(). */
export function mockEmailStanding(email: string): "new" | "guardian" | "has_role" {
  const key = email.trim().toLowerCase()
  if (key === MOCK_GUARDIAN_EMAIL) return "guardian"
  if (Object.values(MOCK_CREDENTIALS).some((account) => account.email === key)) return "has_role"
  if (loadClubUsers().some((user) => user.email.toLowerCase() === key)) return "has_role"
  if (read().links.some((link) => link.email === key)) return "guardian"
  return "new"
}

export const ROLE_MIXING_MESSAGE = "This email already has a coach, admin or athlete account. A guardian needs their own email address."

export type MockInviteOutcome = { ok: true; outcome: "invited"; inviteId: string } | { ok: true; outcome: "linked"; linkId: string } | { ok: false; message: string; code: "VALIDATION" | "CONFLICT" | "UNKNOWN" }

export function inviteMockGuardian(input: { athleteId: string; email: string; name: string | null; relationship: string }): MockInviteOutcome {
  const email = input.email.trim().toLowerCase()
  if (!/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(email)) return { ok: false, code: "VALIDATION", message: "Enter a valid email address for the guardian." }
  const standing = mockEmailStanding(email)
  if (standing === "has_role") return { ok: false, code: "CONFLICT", message: ROLE_MIXING_MESSAGE }

  const state = read()
  const taken =
    state.links.filter((link) => link.athleteId === input.athleteId && link.status === "active").length +
    state.invites.filter((invite) => invite.athleteId === input.athleteId && invite.status === "pending" && invite.email !== email).length
  if (taken >= MAX_GUARDIANS_PER_ATHLETE) return { ok: false, code: "CONFLICT", message: `This athlete already has ${MAX_GUARDIANS_PER_ATHLETE} guardians or open invites. Remove one first.` }

  const relationship = input.relationship.trim().slice(0, 40) || "Guardian"
  const name = input.name?.trim().slice(0, 120) || null

  if (standing === "guardian") {
    const existing = state.links.find((link) => link.athleteId === input.athleteId && link.email === email)
    const knownName = state.links.find((link) => link.email === email && link.name)?.name ?? name
    let linkId: string
    if (existing) {
      existing.status = "active"
      existing.relationship = relationship
      linkId = existing.id
    } else {
      linkId = newId("gl")
      state.links.push({ id: linkId, athleteId: input.athleteId, email, name: knownName, relationship, status: "active", createdAt: new Date().toISOString() })
    }
    state.invites = state.invites.map((invite) => (invite.athleteId === input.athleteId && invite.email === email && invite.status === "pending" ? { ...invite, status: "revoked" } : invite))
    return write(state) ? { ok: true, outcome: "linked", linkId } : { ok: false, code: "UNKNOWN", message: "Could not save in this browser. Storage may be full or blocked." }
  }

  const open = state.invites.find((invite) => invite.athleteId === input.athleteId && invite.email === email && invite.status === "pending")
  let inviteId: string
  if (open) {
    open.name = name
    open.relationship = relationship
    open.expiresAt = isoDaysFromNow(14)
    inviteId = open.id
  } else {
    inviteId = newId("gi")
    state.invites.push({ id: inviteId, athleteId: input.athleteId, email, name, relationship, status: "pending", createdAt: new Date().toISOString(), expiresAt: isoDaysFromNow(14), lastEmailSentAt: null })
  }
  return write(state) ? { ok: true, outcome: "invited", inviteId } : { ok: false, code: "UNKNOWN", message: "Could not save in this browser. Storage may be full or blocked." }
}

export function markMockInviteEmailed(inviteId: string) {
  const state = read()
  const invite = state.invites.find((item) => item.id === inviteId)
  if (!invite) return
  invite.lastEmailSentAt = new Date().toISOString()
  write(state)
}

export function revokeMockGuardianLink(linkId: string): boolean {
  const state = read()
  const link = state.links.find((item) => item.id === linkId)
  if (!link || link.status !== "active") return false
  link.status = "revoked"
  return write(state)
}

export function cancelMockGuardianInvite(inviteId: string): boolean {
  const state = read()
  const invite = state.invites.find((item) => item.id === inviteId)
  if (!invite || invite.status !== "pending") return false
  invite.status = "revoked"
  return write(state)
}

export function getMockGuardianInvite(inviteId: string): MockGuardianInvite | null {
  return read().invites.find((invite) => invite.id === inviteId) ?? null
}

/** Demo claim: accepts every open invite sent to that email, as accept_guardian_invite does. */
export function acceptMockGuardianInvite(inviteId: string, name: string | null): { ok: true } | { ok: false; message: string } {
  const state = read()
  const invite = state.invites.find((item) => item.id === inviteId)
  if (!invite) return { ok: false, message: "Invite not found." }
  if (invite.status === "accepted") return { ok: true }
  if (invite.status !== "pending") return { ok: false, message: "This invite is no longer open. Ask the club for a new one." }
  if (invite.expiresAt < new Date().toISOString()) return { ok: false, message: "This invite has expired. Ask the club for a new one." }
  if (mockEmailStanding(invite.email) === "has_role") return { ok: false, message: ROLE_MIXING_MESSAGE }
  for (const open of state.invites.filter((item) => item.email === invite.email && item.status === "pending")) {
    open.status = "accepted"
    const existing = state.links.find((link) => link.athleteId === open.athleteId && link.email === open.email)
    if (existing) {
      existing.status = "active"
      existing.relationship = open.relationship
    } else {
      state.links.push({ id: newId("gl"), athleteId: open.athleteId, email: open.email, name: name?.trim() || open.name, relationship: open.relationship, status: "active", createdAt: new Date().toISOString() })
    }
  }
  return write(state) ? { ok: true } : { ok: false, message: "Could not save in this browser. Storage may be full or blocked." }
}

/** The guardian's own account is deleted: their links and the invites to their email go with it. */
export function removeMockGuardian(email: string) {
  const key = email.trim().toLowerCase()
  const state = read()
  state.links = state.links.filter((link) => link.email !== key)
  state.invites = state.invites.filter((invite) => invite.email !== key)
  write(state)
}
