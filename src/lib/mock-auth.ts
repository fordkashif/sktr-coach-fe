import type { Role } from "@/lib/mock-data"

export type TeamScope = "all-teams" | "single-team"

export const MOCK_CREDENTIALS = {
  athlete: {
    email: "athlete@pacelab.local",
    password: "Password123!",
    role: "athlete" as Role,
    redirectTo: "/athlete/home",
    tenantId: "elite-track-club",
    teamScope: "single-team" as TeamScope,
    defaultTeamId: "t1",
  },
  coach: {
    email: "coach@pacelab.local",
    password: "Password123!",
    role: "coach" as Role,
    redirectTo: "/coach/dashboard",
    tenantId: "elite-track-club",
    teamScope: "single-team" as TeamScope,
    defaultTeamId: "t4",
    allowTeamSwitcher: false,
  },
  clubAdmin: {
    email: "clubadmin@pacelab.local",
    password: "Password123!",
    role: "club-admin" as Role,
    redirectTo: "/club-admin/dashboard",
    tenantId: "elite-track-club",
    teamScope: "all-teams" as TeamScope,
  },
  platformAdmin: {
    email: "platformadmin@pacelab.local",
    password: "Password123!",
    role: "platform-admin" as Role,
    redirectTo: "/platform-admin/dashboard",
    tenantId: "platform",
    teamScope: "all-teams" as TeamScope,
  },
} as const

export const MOCK_ROLE_STORAGE_KEY = "pacelab:mock-role"
export const MOCK_USER_EMAIL_STORAGE_KEY = "pacelab:mock-user-email"
export const MOCK_COACH_TEAM_STORAGE_KEY = "pacelab:mock-coach-team"
const MOCK_PASSWORD_OVERRIDES_KEY = "pacelab:mock-password-overrides"
const MOCK_PASSWORD_RESET_TOKENS_KEY = "pacelab:mock-password-reset-tokens"

type MockCredentialEntry = {
  email: string
  password: string
  role: Role
  redirectTo: string
  tenantId: string
  teamScope: TeamScope
  defaultTeamId?: string
  allowTeamSwitcher?: boolean
}
type MockPasswordOverrideMap = Record<string, string>
type MockPasswordResetTokenRecord = {
  email: string
  expiresAt: number
}

function getMockPasswordOverrides(): MockPasswordOverrideMap {
  if (typeof window === "undefined") return {}
  try {
    return JSON.parse(window.localStorage.getItem(MOCK_PASSWORD_OVERRIDES_KEY) ?? "{}") as MockPasswordOverrideMap
  } catch {
    return {}
  }
}

function setMockPasswordOverrides(value: MockPasswordOverrideMap) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(MOCK_PASSWORD_OVERRIDES_KEY, JSON.stringify(value))
}

function getMockPasswordResetTokens(): Record<string, MockPasswordResetTokenRecord> {
  if (typeof window === "undefined") return {}
  try {
    return JSON.parse(window.localStorage.getItem(MOCK_PASSWORD_RESET_TOKENS_KEY) ?? "{}") as Record<string, MockPasswordResetTokenRecord>
  } catch {
    return {}
  }
}

function setMockPasswordResetTokens(value: Record<string, MockPasswordResetTokenRecord>) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(MOCK_PASSWORD_RESET_TOKENS_KEY, JSON.stringify(value))
}

function getResolvedMockCredentials(): MockCredentialEntry[] {
  const overrides = getMockPasswordOverrides()
  return Object.values(MOCK_CREDENTIALS).map((item) => ({
    ...item,
    password: overrides[item.email] ?? item.password,
  }))
}

export function resolveMockLogin(email: string, password: string) {
  const normalized = email.trim().toLowerCase()
  const entries = getResolvedMockCredentials()
  const match = entries.find(
    (item) => item.email === normalized && item.password === password
  )

  return match ?? null
}

export function getMockCoachConfig(email: string | null | undefined) {
  if (!email) return null
  const normalized = email.trim().toLowerCase()
  const match = Object.values(MOCK_CREDENTIALS).find((item) => item.email === normalized && item.role === "coach")
  if (!match) return null

  return {
    defaultTeamId: "defaultTeamId" in match ? match.defaultTeamId : undefined,
    allowTeamSwitcher: "allowTeamSwitcher" in match ? Boolean(match.allowTeamSwitcher) : false,
    teamScope: match.teamScope,
  }
}

export function getMockCredentialByEmail(email: string | null | undefined) {
  if (!email) return null
  const normalized = email.trim().toLowerCase()
  return getResolvedMockCredentials().find((item) => item.email === normalized) ?? null
}

export function createMockPasswordResetToken(email: string) {
  const account = getMockCredentialByEmail(email)
  if (!account) return null

  const tokens = getMockPasswordResetTokens()
  const token = `mock-reset-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  tokens[token] = {
    email: account.email,
    expiresAt: Date.now() + 1000 * 60 * 30,
  }
  setMockPasswordResetTokens(tokens)
  return token
}

export function getMockPasswordResetEmail(token: string) {
  const tokens = getMockPasswordResetTokens()
  const record = tokens[token]
  if (!record) return null
  if (record.expiresAt < Date.now()) {
    delete tokens[token]
    setMockPasswordResetTokens(tokens)
    return null
  }
  return record.email
}

export function completeMockPasswordReset(token: string, password: string) {
  const email = getMockPasswordResetEmail(token)
  if (!email) {
    return { ok: false as const, message: "Reset link is invalid or expired." }
  }

  const overrides = getMockPasswordOverrides()
  overrides[email] = password
  setMockPasswordOverrides(overrides)

  const tokens = getMockPasswordResetTokens()
  delete tokens[token]
  setMockPasswordResetTokens(tokens)

  const account = getMockCredentialByEmail(email)
  return {
    ok: true as const,
    email,
    role: account?.role ?? null,
  }
}
