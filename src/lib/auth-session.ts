export const SESSION_COOKIE = "pacelab_session"
export const ROLE_COOKIE = "pacelab_role"
export const TENANT_COOKIE = "pacelab_tenant"
export const USER_COOKIE = "pacelab_user"
export const COACH_TEAM_COOKIE = "pacelab_coach_team"

export function setSessionCookies(
  role: "athlete" | "coach" | "club-admin" | "platform-admin",
  tenantId: string,
  userEmail: string,
  coachTeamId?: string
) {
  const maxAge = 60 * 60 * 8
  document.cookie = `${SESSION_COOKIE}=1; Path=/; Max-Age=${maxAge}; SameSite=Lax`
  document.cookie = `${ROLE_COOKIE}=${role}; Path=/; Max-Age=${maxAge}; SameSite=Lax`
  document.cookie = `${TENANT_COOKIE}=${tenantId}; Path=/; Max-Age=${maxAge}; SameSite=Lax`
  document.cookie = `${USER_COOKIE}=${encodeURIComponent(userEmail)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`
  if (coachTeamId) {
    document.cookie = `${COACH_TEAM_COOKIE}=${coachTeamId}; Path=/; Max-Age=${maxAge}; SameSite=Lax`
  } else {
    document.cookie = `${COACH_TEAM_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  }
}

export function clearSessionCookies() {
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  document.cookie = `${ROLE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  document.cookie = `${TENANT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  document.cookie = `${USER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  document.cookie = `${COACH_TEAM_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
}

export function getCookieValue(name: string) {
  if (typeof document === "undefined") return null
  const match = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))

  return match ? decodeURIComponent(match.split("=")[1] ?? "") : null
}

export function getTenantIdFromCookie() {
  return getCookieValue(TENANT_COOKIE)
}
