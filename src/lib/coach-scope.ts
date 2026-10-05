import { COACH_TEAM_COOKIE, getCookieValue } from "@/lib/auth-session"
import {
  getMockCoachConfig,
  MOCK_COACH_TEAM_STORAGE_KEY,
  MOCK_COACH_TEAMS_STORAGE_KEY,
  MOCK_USER_EMAIL_STORAGE_KEY,
} from "@/lib/mock-auth"

/**
 * Mock mode: which demo teams the signed-in coach is assigned to, in order.
 *
 * 1. localStorage "pacelab:mock-coach-teams" (comma separated ids, for example "t1,t4") wins.
 * 2. A mock coach account with allowTeamSwitcher true is on every demo team.
 * 3. Otherwise the coach has one team: the stored or cookie team, else the account default.
 *
 * Ids that are not demo teams are dropped.
 */
export function resolveMockCoachTeamIds(allTeamIds: string[]): string[] {
  if (typeof window === "undefined") return []
  const known = new Set(allTeamIds)

  const listed = (window.localStorage.getItem(MOCK_COACH_TEAMS_STORAGE_KEY) ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id, index, all) => id && known.has(id) && all.indexOf(id) === index)
  if (listed.length > 0) return listed

  const config = getMockCoachConfig(window.localStorage.getItem(MOCK_USER_EMAIL_STORAGE_KEY))
  if (config?.allowTeamSwitcher) return allTeamIds

  const single =
    window.localStorage.getItem(MOCK_COACH_TEAM_STORAGE_KEY) || getCookieValue(COACH_TEAM_COOKIE) || config?.defaultTeamId || null
  if (single && known.has(single)) return [single]
  // An unknown stored id keeps the old behaviour: the team page says "Team not found".
  return single ? [] : allTeamIds.slice(0, 1)
}
