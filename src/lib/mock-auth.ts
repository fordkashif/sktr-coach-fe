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

export function resolveMockLogin(email: string, password: string) {
  const normalized = email.trim().toLowerCase()

  const entries = Object.values(MOCK_CREDENTIALS)
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
