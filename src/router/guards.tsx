import { useEffect, useState } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { evaluateAccess, type AccessResult } from "@/lib/access-control"
import { ACCESS_PAUSED_EVENT } from "@/lib/access-paused"
import { SESSION_UPDATED_EVENT, signedOutOnPurpose } from "@/lib/auth-session"
import { loginPathWithReturn } from "@/lib/return-path"
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
    // The database refused a request because this member was deactivated or the club was paused
    // while the app was open: look again, which swaps the screen for the notice.
    window.addEventListener(ACCESS_PAUSED_EVENT, handleSessionUpdated)

    return () => {
      cancelled = true
      window.removeEventListener("focus", handleWindowFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener(SESSION_UPDATED_EVENT, handleSessionUpdated as EventListener)
      window.removeEventListener(ACCESS_PAUSED_EVENT, handleSessionUpdated)
    }
  }, [location.pathname])

  if (!access) {
    return null
  }

  if (!access.allowed && access.blocked) {
    return <AccessPausedPage block={access.blocked} isClubAdmin={role === "club-admin"} />
  }

  if (!access.allowed) {
    // A sign-in that ran out: the login page brings the person back to this screen afterwards.
    // Not after a sign out the person chose: that lands on the plain login page.
    const to = access.reason === "unauthenticated" && !signedOutOnPurpose() ? loginPathWithReturn(location.pathname, location.search) : (access.redirectTo ?? "/login")
    return <Navigate to={to} replace state={{ from: location }} />
  }

  return <Outlet />
}
