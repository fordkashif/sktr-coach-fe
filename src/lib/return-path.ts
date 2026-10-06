// Where to go back to after signing in again (a sign-in that ran out, or an invite link).
// Only paths inside the app are ever accepted: this is what stops an open redirect.
import { evaluateAccess, isProtectedPath } from "./access-control"

export type ReturnRole = "athlete" | "coach" | "club-admin" | "platform-admin" | "guardian"

/** Public screens that send a person to sign in and want them back (invite and join links). */
const PUBLIC_RETURN_PREFIXES = ["/athlete/claim/", "/guardian/claim/", "/invite/coach/", "/join/", "/club-admin/claim"]

const MAX_LENGTH = 512

/**
 * The path when it is safe in shape: one leading slash, no host, no scheme, nothing a browser
 * could read as another site. Null otherwise. Says nothing about who may open it.
 */
export function cleanReturnPath(candidate: string | null | undefined): string | null {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > MAX_LENGTH) return null
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null
  // Browsers treat a backslash like a slash, and drop tabs and new lines, so "/\\evil.com" leaves the site.
  for (let index = 0; index < candidate.length; index += 1) {
    const code = candidate.charCodeAt(index)
    if (code === 92 || code < 32 || code === 127) return null
  }
  let url: URL
  try {
    url = new URL(candidate, "https://app.invalid")
  } catch {
    return null
  }
  if (url.origin !== "https://app.invalid") return null
  if (url.pathname.startsWith("//")) return null
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * The path to open after sign-in, or null to use the role's home screen.
 * It must be safe in shape and be a screen this role can open: their own area, the screens every
 * signed-in person has (account, notifications), or an invite link.
 */
export function safeReturnPath(candidate: string | null | undefined, role: ReturnRole | null | undefined): string | null {
  const path = cleanReturnPath(candidate)
  if (!path) return null
  const pathname = path.split(/[?#]/)[0]
  if (PUBLIC_RETURN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return path
  if (!role || !isProtectedPath(pathname)) return null
  const access = evaluateAccess({ pathname, isAuthenticated: true, role, tenantId: role === "platform-admin" ? null : "club" })
  return access.allowed ? path : null
}

/** The login address that brings the person back to where they were. */
export function loginPathWithReturn(pathname: string, search = ""): string {
  const path = cleanReturnPath(`${pathname}${search}`)
  return path ? `/login?redirect=${encodeURIComponent(path)}` : "/login"
}
