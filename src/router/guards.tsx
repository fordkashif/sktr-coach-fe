import { useEffect, useState } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { evaluateAccess, type AccessResult } from "@/lib/access-control"
import { ACCESS_PAUSED_EVENT } from "@/lib/access-paused"
import { SESSION_UPDATED_EVENT, signedOutOnPurpose } from "@/lib/auth-session"
import { loginPathWithReturn } from "@/lib/return-path"
import { AccessPausedPage } from "@/pages/access-paused"
import { getCurrentGuardAuthContext, GuardCheckUnavailable, type GuardAuthContext } from "@/router/guard-auth-context"

export function GuardedAuthenticatedLayout() {
  const location = useLocation()
  const [access, setAccess] = useState<AccessResult | null>(null)
  const [role, setRole] = useState<string | null>(null)
  // Only matters before the first answer: with a screen already showing, a failed check changes nothing.
  const [unreachable, setUnreachable] = useState(false)

  useEffect(() => {
    let cancelled = false

    let retryTimer: number | undefined
    let attempts = 0

    const resolveAccess = async () => {
      let authContext: GuardAuthContext
      try {
        authContext = await getCurrentGuardAuthContext()
        attempts = 0
      } catch (error) {
        if (!(error instanceof GuardCheckUnavailable)) throw error
        // The check could not be made (no network just after the phone woke, a server hiccup).
        // Nobody is signed out for that: keep the screen that is showing and look again shortly.
        if (cancelled) return
        attempts += 1
        setUnreachable(attempts >= 3)
        window.clearTimeout(retryTimer)
        retryTimer = window.setTimeout(() => void resolveAccess(), Math.min(1000 * 2 ** (attempts - 1), 15_000))
        return
      }
      if (!cancelled) setUnreachable(false)
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
    window.addEventListener("online", handleWindowFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener(SESSION_UPDATED_EVENT, handleSessionUpdated as EventListener)
    // The database refused a request because this member was deactivated or the club was paused
    // while the app was open: look again, which swaps the screen for the notice.
    window.addEventListener(ACCESS_PAUSED_EVENT, handleSessionUpdated)

    return () => {
      cancelled = true
      window.clearTimeout(retryTimer)
      window.removeEventListener("focus", handleWindowFocus)
      window.removeEventListener("online", handleWindowFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener(SESSION_UPDATED_EVENT, handleSessionUpdated as EventListener)
      window.removeEventListener(ACCESS_PAUSED_EVENT, handleSessionUpdated)
    }
  }, [location.pathname])

  if (!access) {
    if (!unreachable) return null
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-sk-ink">Trying to reach SKTR Coach</h1>
        <p className="text-base text-sk-ink-2">You are still signed in. This screen opens as soon as you are back online.</p>
      </main>
    )
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
