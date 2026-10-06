import type { AppRole } from "@/lib/supabase/actor"

export interface AccessInput {
  pathname: string
  isAuthenticated: boolean
  role: AppRole | null
  tenantId: string | null
  clubAdminOnboardingComplete?: boolean
  clubAdminLifecycleStatus?: string | null
  /** Lifecycle status of the member's club, for every tenant role. Null when unknown or when the club has no record. */
  tenantLifecycleStatus?: string | null
  /** False when the member's own access was turned off by a club admin (profiles.is_active). */
  memberActive?: boolean
}

/** Why a signed-in member is shown a notice instead of the app. The database blocks the same cases. */
export type AccessBlock = "club-suspended" | "club-cancelled" | "club-closed" | "member-inactive"

export interface AccessResult {
  allowed: boolean
  reason?:
    | "unauthenticated"
    | "missing-tenant"
    | "forbidden-role"
    | "onboarding-incomplete"
    | "billing-incomplete"
    | "club-blocked"
    | "member-inactive"
  redirectTo?: string
  /** Set with no redirectTo: the guard renders a full-page notice in place. */
  blocked?: AccessBlock
}

/** Screens every signed-in role can open: their own account. */
export function isAccountPath(pathname: string) {
  return pathname === "/account" || pathname.startsWith("/account/")
}

/** The full notification history. Every signed-in role has one. */
export function isNotificationsPath(pathname: string) {
  return pathname === "/notifications" || pathname.startsWith("/notifications/")
}

/** Not tied to one role: any signed-in person may open these (a club member still has to be active). */
function isAnyRolePath(pathname: string) {
  return isAccountPath(pathname) || isNotificationsPath(pathname)
}

export function isProtectedPath(pathname: string) {
  return (
    isAnyRolePath(pathname) ||
    pathname.startsWith("/athlete") ||
    pathname.startsWith("/coach") ||
    pathname.startsWith("/club-admin") ||
    pathname.startsWith("/platform-admin")
  )
}

export function evaluateAccess(input: AccessInput): AccessResult {
  const {
    pathname,
    isAuthenticated,
    role,
    tenantId,
    clubAdminOnboardingComplete = true,
    clubAdminLifecycleStatus = null,
    tenantLifecycleStatus = null,
    memberActive = true,
  } = input

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

  if (isAnyRolePath(pathname)) {
    if (!role) {
      return { allowed: false, reason: "forbidden-role", redirectTo: "/login" }
    }
    // A platform admin has no club. Everyone else falls through to the club and member checks below.
    if (role === "platform-admin") {
      return { allowed: true }
    }
  }

  if (!tenantId) {
    return { allowed: false, reason: "missing-tenant", redirectTo: "/login" }
  }

  // Checked before any role or onboarding redirect: a blocked member gets the same notice on every
  // tenant route, and is never bounced to setup screens whose data the database no longer returns.
  if (role === "athlete" || role === "coach" || role === "club-admin") {
    if (!memberActive) {
      return { allowed: false, reason: "member-inactive", blocked: "member-inactive" }
    }
    // Closed by its owner (a closure on top of the suspended lifecycle, see 20261014120000).
    if (tenantLifecycleStatus === "closed") {
      return { allowed: false, reason: "club-blocked", blocked: "club-closed" }
    }
    if (tenantLifecycleStatus === "suspended") {
      return { allowed: false, reason: "club-blocked", blocked: "club-suspended" }
    }
    if (tenantLifecycleStatus === "cancelled") {
      return { allowed: false, reason: "club-blocked", blocked: "club-cancelled" }
    }
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

  if (pathname.startsWith("/club-admin") && role === "club-admin") {
    const isBillingSetup = pathname === "/club-admin/setup/billing"
    const isGetStarted = pathname === "/club-admin/get-started"
    const requiresBillingSetup = clubAdminLifecycleStatus === "approved_pending_billing" || clubAdminLifecycleStatus === "billing_failed"
    if (requiresBillingSetup && !isBillingSetup) {
      return { allowed: false, reason: "billing-incomplete", redirectTo: "/club-admin/setup/billing" }
    }
    if (clubAdminLifecycleStatus !== null && !requiresBillingSetup && isBillingSetup) {
      return { allowed: false, reason: "forbidden-role", redirectTo: "/club-admin/get-started" }
    }
    if (clubAdminLifecycleStatus !== null && !requiresBillingSetup && !clubAdminOnboardingComplete && !isGetStarted) {
      return { allowed: false, reason: "onboarding-incomplete", redirectTo: "/club-admin/get-started" }
    }
    if (clubAdminLifecycleStatus !== null && !requiresBillingSetup && clubAdminOnboardingComplete && isGetStarted) {
      return { allowed: false, reason: "forbidden-role", redirectTo: "/club-admin/dashboard" }
    }
  }

  return { allowed: true }
}
