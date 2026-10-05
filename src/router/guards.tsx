import { useEffect, useState } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { evaluateAccess, type AccessResult } from "@/lib/access-control"
import { SESSION_UPDATED_EVENT } from "@/lib/auth-session"
import { AccessPausedPage } from "@/pages/access-paused"
import { getCurrentGuardAuthContext } from "@/router/guard-auth-context"

export function GuardedAuthenticatedLayout() {
  const location = useLocation()
  const [access, setAccess] = useState<AccessResult | null>(null)
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const resolveAccess = async () => {
      const authContext = await getCurrentGuardAuthContext()
      const nextAccess = evaluateAccess({
        pathname: location.pathname,
        ...authContext,
      })

      if (!cancelled) {
        setAccess(nextAccess)
        setRole(authContext.role)
      }
    }

    void resolveAccess()

    const handleWindowFocus = () => {
      void resolveAccess()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void resolveAccess()
      }
    }

    const handleSessionUpdated = () => {
      void resolveAccess()
    }

    window.addEventListener("focus", handleWindowFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener(SESSION_UPDATED_EVENT, handleSessionUpdated as EventListener)

    return () => {
      cancelled = true
      window.removeEventListener("focus", handleWindowFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener(SESSION_UPDATED_EVENT, handleSessionUpdated as EventListener)
    }
  }, [location.pathname])

  if (!access) {
    return null
  }

  if (!access.allowed && access.blocked) {
    return <AccessPausedPage block={access.blocked} isClubAdmin={role === "club-admin"} />
  }

  if (!access.allowed) {
    return <Navigate to={access.redirectTo ?? "/login"} replace state={{ from: location }} />
  }

  return <Outlet />
}
