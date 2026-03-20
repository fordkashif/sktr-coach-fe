import { useEffect, useState } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { evaluateAccess, type AccessResult } from "@/lib/access-control"
import { getCookieValue, ROLE_COOKIE, SESSION_COOKIE, TENANT_COOKIE } from "@/lib/auth-session"
import type { AppRole } from "@/lib/access-control"
import { getBackendMode } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { ensureProfileForSession } from "@/lib/supabase/profile-bootstrap"

function getRoleFromCookie() {
  const role = getCookieValue(ROLE_COOKIE)
  if (role === "athlete" || role === "coach" || role === "club-admin") {
    return role as AppRole
  }
  return null
}

type GuardAuthContext = {
  isAuthenticated: boolean
  role: AppRole | null
  tenantId: string | null
}

function isAppRole(value: unknown): value is AppRole {
  return value === "athlete" || value === "coach" || value === "club-admin"
}

function getMockAuthContext(): GuardAuthContext {
  return {
    isAuthenticated: Boolean(getCookieValue(SESSION_COOKIE)),
    role: getRoleFromCookie(),
    tenantId: getCookieValue(TENANT_COOKIE),
  }
}

async function getSupabaseAuthContext(): Promise<GuardAuthContext> {
  const supabase = getBrowserSupabaseClient()
  if (!supabase) {
    return {
      isAuthenticated: false,
      role: null,
      tenantId: null,
    }
  }

  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) {
    return {
      isAuthenticated: false,
      role: null,
      tenantId: null,
    }
  }

  const profile = await ensureProfileForSession(supabase, session)
  if (!profile || !isAppRole(profile.role) || !profile.tenant_id) {
    return {
      isAuthenticated: true,
      role: null,
      tenantId: null,
    }
  }

  return {
    isAuthenticated: true,
    role: profile.role,
    tenantId: profile.tenant_id,
  }
}

export function GuardedAuthenticatedLayout() {
  const location = useLocation()
  const [access, setAccess] = useState<AccessResult | null>(null)

  useEffect(() => {
    let cancelled = false

    const resolveAccess = async () => {
      const authContext =
        getBackendMode() === "supabase" ? await getSupabaseAuthContext() : getMockAuthContext()

      const nextAccess = evaluateAccess({
        pathname: location.pathname,
        ...authContext,
      })

      if (!cancelled) setAccess(nextAccess)
    }

    void resolveAccess()
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  if (!access) {
    return null
  }

  if (!access.allowed) {
    return <Navigate to={access.redirectTo ?? "/login"} replace state={{ from: location }} />
  }

  return <Outlet />
}
