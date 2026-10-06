export const SESSION_COOKIE = "pacelab_session"
export const ROLE_COOKIE = "pacelab_role"
export const TENANT_COOKIE = "pacelab_tenant"
export const USER_COOKIE = "pacelab_user"
export const COACH_TEAM_COOKIE = "pacelab_coach_team"
export const SESSION_UPDATED_EVENT = "pacelab:session-cookies-updated"

function notifySessionUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_UPDATED_EVENT))
  }
}

export function setSessionCookies(
  role: "athlete" | "coach" | "club-admin" | "platform-admin" | "guardian",
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
  noteSignedOutOnPurpose(false)
  notifySessionUpdated()
}

export function setCoachTeamCookie(coachTeamId?: string) {
  const maxAge = 60 * 60 * 8
  if (coachTeamId) {
    document.cookie = `${COACH_TEAM_COOKIE}=${coachTeamId}; Path=/; Max-Age=${maxAge}; SameSite=Lax`
  } else {
    document.cookie = `${COACH_TEAM_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  }
  notifySessionUpdated()
}

const SIGNED_OUT_ON_PURPOSE_KEY = "pacelab:signed-out-on-purpose"

function noteSignedOutOnPurpose(on: boolean) {
  try {
    if (on) window.sessionStorage.setItem(SIGNED_OUT_ON_PURPOSE_KEY, String(Date.now()))
    else window.sessionStorage.removeItem(SIGNED_OUT_ON_PURPOSE_KEY)
  } catch {
    // Without storage the login page simply offers the way back, which is harmless.
  }
}

/**
 * True for a few seconds after the person signed out themselves. The route guard reads it so a
 * deliberate sign out lands on the plain login page, while a sign-in that ran out keeps the
 * screen to come back to.
 */
export function signedOutOnPurpose(now: number = Date.now()): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(SIGNED_OUT_ON_PURPOSE_KEY))
    return Number.isFinite(at) && at > 0 && now - at < 15_000
  } catch {
    return false
  }
}

/** `reason` "expired": the sign-in ran out by itself (the default is a sign out the person chose). */
export function clearSessionCookies(reason?: "expired") {
  if (reason !== "expired") noteSignedOutOnPurpose(true)
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  document.cookie = `${ROLE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  document.cookie = `${TENANT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  document.cookie = `${USER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  document.cookie = `${COACH_TEAM_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  notifySessionUpdated()
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
