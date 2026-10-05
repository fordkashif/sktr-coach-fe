import { getCookieValue, ROLE_COOKIE, SESSION_COOKIE, TENANT_COOKIE } from "@/lib/auth-session"
import type { AppRole } from "@/lib/supabase/actor"
import { getBackendMode } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { resolveSessionActor } from "@/lib/supabase/actor"
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
  return value === "athlete" || value === "coach" || value === "club-admin" || value === "platform-admin"
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
    tenantLifecycleStatus: role && role !== "platform-admin" ? getMockTenantLifecycleStatus(tenantId) : null,
    memberActive: true,
  }
}

async function getSupabaseGuardAuthContext(): Promise<GuardAuthContext> {
  const supabase = getBrowserSupabaseClient()
  if (!supabase) {
    return SIGNED_OUT
  }

  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) {
    return SIGNED_OUT
  }

  const actor = await resolveSessionActor(supabase, session)
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

  return {
    isAuthenticated: true,
    role: actor.role,
    tenantId: actor.tenantId,
    clubAdminOnboardingComplete,
    clubAdminLifecycleStatus,
    tenantLifecycleStatus,
    memberActive,
  }
}

export async function getCurrentGuardAuthContext(): Promise<GuardAuthContext> {
  return getBackendMode() === "supabase" ? getSupabaseGuardAuthContext() : getMockGuardAuthContext()
}
