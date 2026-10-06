import { getCookieValue, ROLE_COOKIE, SESSION_COOKIE, TENANT_COOKIE } from "@/lib/auth-session"
import type { AppRole } from "@/lib/supabase/actor"
import { getBackendMode } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { resolveSessionAccess } from "@/lib/supabase/actor"
import { isTransientAuthError } from "@/lib/supabase/transient-auth-error"
import { getMockClubClosure } from "@/lib/mock-data-rights"
import { getMockTenantLifecycleStatus } from "@/lib/mock-platform-admin"

export type GuardAuthContext = {
  isAuthenticated: boolean
  role: AppRole | null
  tenantId: string | null
  clubAdminOnboardingComplete: boolean
  clubAdminLifecycleStatus: string | null
  /** Lifecycle status of the member's club (any tenant role). Null when unknown or no record. */
  tenantLifecycleStatus: string | null
  /** False when a club admin turned this member's access off. */
  memberActive: boolean
}

/**
 * Thrown when the sign-in could not be checked at all: the phone has just woken up with no network,
 * or the server did not answer. It says nothing about whether the person is signed in, so the guard
 * keeps the screen they are on and tries again instead of sending them to the login page.
 */
export class GuardCheckUnavailable extends Error {
  constructor() {
    super("The sign-in could not be checked right now.")
    this.name = "GuardCheckUnavailable"
  }
}

const SIGNED_OUT: GuardAuthContext = {
  isAuthenticated: false,
  role: null,
  tenantId: null,
  clubAdminOnboardingComplete: true,
  clubAdminLifecycleStatus: null,
  tenantLifecycleStatus: null,
  memberActive: true,
}

function isAppRole(value: unknown): value is AppRole {
  return value === "athlete" || value === "coach" || value === "club-admin" || value === "platform-admin" || value === "guardian"
}

function getRoleFromCookie() {
  const role = getCookieValue(ROLE_COOKIE)
  return isAppRole(role) ? role : null
}

async function getMockGuardAuthContext(): Promise<GuardAuthContext> {
  const role = getRoleFromCookie()
  const tenantId = getCookieValue(TENANT_COOKIE)
  return {
    isAuthenticated: Boolean(getCookieValue(SESSION_COOKIE)),
    role,
    tenantId,
    clubAdminOnboardingComplete: true,
    clubAdminLifecycleStatus: null,
    // Only clubs created through the mock platform admin have a status. The demo club has none.
    tenantLifecycleStatus: role && role !== "platform-admin" ? (getMockClubClosure(tenantId) ? "closed" : getMockTenantLifecycleStatus(tenantId)) : null,
    memberActive: true,
  }
}

/*
 * Working out who someone is takes several requests to the server, and the guard asks on every
 * screen change. For a member in good standing the answer is remembered for a short while, so
 * moving between screens costs nothing. Anything unsettled (setup not finished, access paused, a
 * closed club) is never remembered: those states are meant to change under the person's feet.
 * A request the database refuses still fires the access paused event, which asks afresh.
 */
const SETTLED_FOR_MS = 60_000
let settled: { userId: string; at: number; context: GuardAuthContext } | null = null

export function isSettledContext(context: GuardAuthContext): boolean {
  if (!context.isAuthenticated || !context.role || !context.memberActive) return false
  if (!context.clubAdminOnboardingComplete) return false
  const blocked = ["closed", "suspended", "cancelled", "approved_pending_billing", "billing_failed"]
  if (context.tenantLifecycleStatus && blocked.includes(context.tenantLifecycleStatus)) return false
  if (context.clubAdminLifecycleStatus && blocked.includes(context.clubAdminLifecycleStatus)) return false
  return true
}

function recallSettled(userId: string, fresh: boolean, now: number = Date.now()): GuardAuthContext | null {
  if (fresh || !settled || settled.userId !== userId || now - settled.at > SETTLED_FOR_MS) return null
  return settled.context
}

function rememberIfSettled(userId: string, context: GuardAuthContext) {
  settled = isSettledContext(context) ? { userId, at: Date.now(), context } : null
}

/** Forget the remembered answer, for example after a sign out. */
export function forgetGuardAuthContext() {
  settled = null
}

async function getSupabaseGuardAuthContext(options?: { fresh?: boolean }): Promise<GuardAuthContext> {
  const supabase = getBrowserSupabaseClient()
  if (!supabase) {
    return SIGNED_OUT
  }

  let sessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>>
  try {
    sessionResult = await supabase.auth.getSession()
  } catch {
    throw new GuardCheckUnavailable()
  }
  const session = sessionResult.data.session
  if (!session) settled = null
  if (!session) {
    // An expired token that could not be renewed because the network was down still has its
    // sign-in stored. Only a clear answer counts as signed out.
    if (isTransientAuthError(sessionResult.error) || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      throw new GuardCheckUnavailable()
    }
    return SIGNED_OUT
  }

  const remembered = recallSettled(session.user.id, options?.fresh === true)
  if (remembered) return remembered

  const { actor, noAccessReason } = await resolveSessionAccess(supabase, session)
  if (!actor && noAccessReason === "error") throw new GuardCheckUnavailable()
  if (!actor || !isAppRole(actor.role)) {
    return { ...SIGNED_OUT, isAuthenticated: true }
  }

  let clubAdminOnboardingComplete = true
  let clubAdminLifecycleStatus: string | null = null
  if (actor.role === "club-admin" && actor.tenantId) {
    const [onboardingResult, activationResult] = await Promise.all([
      supabase.from("club_profiles").select("password_set_at, onboarding_completed_at").eq("tenant_id", actor.tenantId).maybeSingle(),
      supabase.rpc("get_current_club_admin_activation_state"),
    ])

    if (!onboardingResult.error) {
      const row = onboardingResult.data as {
        password_set_at: string | null
        onboarding_completed_at: string | null
      } | null

      clubAdminOnboardingComplete = Boolean(row?.password_set_at && row?.onboarding_completed_at)
    }

    if (!activationResult.error) {
      const row = Array.isArray(activationResult.data) ? activationResult.data[0] : activationResult.data
      clubAdminLifecycleStatus = (row?.lifecycle_status as string | null) ?? null
    }
  }

  // The database returns nothing to a deactivated member or to a member of a suspended or cancelled
  // club. These two reads stay open to them (own profile row, and the package function, which answers
  // for the caller's own club), so the guard can show a notice instead of empty screens.
  let tenantLifecycleStatus: string | null = clubAdminLifecycleStatus
  let memberActive = true
  if (actor.role !== "platform-admin" && actor.tenantId) {
    const [profileResult, packageResult] = await Promise.all([
      supabase.from("profiles").select("is_active").eq("user_id", actor.userId).maybeSingle(),
      // Club admins already have the status from the activation state above.
      actor.role === "club-admin" && clubAdminLifecycleStatus !== null
        ? Promise.resolve(null)
        : supabase.rpc("get_current_tenant_package"),
    ])

    if (!profileResult.error && profileResult.data) {
      memberActive = (profileResult.data as { is_active: boolean | null }).is_active !== false
    }

    // A missing function or an error leaves the status unknown, which does not block anyone here.
    if (packageResult && !packageResult.error) {
      const row = (Array.isArray(packageResult.data) ? packageResult.data[0] : packageResult.data) as
        | { lifecycle_status?: string | null }
        | null
      tenantLifecycleStatus = row?.lifecycle_status ?? null
    }
  }

  // A club closed by its owner is suspended with a closure on top: the notice says "closed".
  if (tenantLifecycleStatus === "suspended" && actor.role !== "platform-admin") {
    try {
      const closure = await supabase.rpc("get_current_club_closure")
      if (!closure.error && closure.data) tenantLifecycleStatus = "closed"
    } catch {
      // The plain "paused" notice is shown.
    }
  }

  const context: GuardAuthContext = {
    isAuthenticated: true,
    role: actor.role,
    tenantId: actor.tenantId,
    clubAdminOnboardingComplete,
    clubAdminLifecycleStatus,
    tenantLifecycleStatus,
    memberActive,
  }
  rememberIfSettled(session.user.id, context)
  return context
}

export async function getCurrentGuardAuthContext(options?: { fresh?: boolean }): Promise<GuardAuthContext> {
  return getBackendMode() === "supabase" ? getSupabaseGuardAuthContext(options) : getMockGuardAuthContext()
}
