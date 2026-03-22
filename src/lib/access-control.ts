import type { AppRole } from "@/lib/supabase/actor"

export interface AccessInput {
  pathname: string
  isAuthenticated: boolean
  role: AppRole | null
  tenantId: string | null
}

export interface AccessResult {
  allowed: boolean
  reason?: "unauthenticated" | "missing-tenant" | "forbidden-role"
  redirectTo?: string
}

export function isProtectedPath(pathname: string) {
  return (
    pathname.startsWith("/athlete") ||
    pathname.startsWith("/coach") ||
    pathname.startsWith("/club-admin") ||
    pathname.startsWith("/platform-admin")
  )
}

export function evaluateAccess(input: AccessInput): AccessResult {
  const { pathname, isAuthenticated, role, tenantId } = input

  if (!isProtectedPath(pathname)) {
    return { allowed: true }
  }

  if (!isAuthenticated) {
    return { allowed: false, reason: "unauthenticated", redirectTo: "/login" }
  }

  if (pathname.startsWith("/platform-admin")) {
    if (role !== "platform-admin") {
      return { allowed: false, reason: "forbidden-role", redirectTo: "/login" }
    }

    return { allowed: true }
  }

  if (!tenantId) {
    return { allowed: false, reason: "missing-tenant", redirectTo: "/login" }
  }

  if (pathname.startsWith("/athlete") && role !== "athlete") {
    return { allowed: false, reason: "forbidden-role", redirectTo: "/login" }
  }

  if (pathname.startsWith("/coach") && role !== "coach" && role !== "club-admin") {
    return { allowed: false, reason: "forbidden-role", redirectTo: "/login" }
  }

  if (pathname.startsWith("/club-admin") && role !== "club-admin") {
    return { allowed: false, reason: "forbidden-role", redirectTo: "/login" }
  }

  return { allowed: true }
}
