import { useEffect, useState } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { AppSplash } from "@/components/app-splash"
import { homePathForRole } from "@/lib/role-home"
import { getCurrentGuardAuthContext, GuardCheckUnavailable } from "@/router/guard-auth-context"

/**
 * The app's front door ("/", where the installed app and the bare address open). Someone who is
 * already signed in goes straight to their first screen. Only someone with no sign-in sees the login
 * page. Before, everyone was sent to the login page first, which then bounced signed-in people on:
 * a flash of the sign-in form on every open.
 */
export function RootRedirectPage() {
  const location = useLocation()
  // Sign-in links from emails land here with their details in the address. The login page reads them.
  const hasAuthParams = location.search.length > 1 || location.hash.length > 1
  const [target, setTarget] = useState<string | null>(hasAuthParams ? `/login${location.search}${location.hash}` : null)
  const [unreachable, setUnreachable] = useState(false)

  useEffect(() => {
    if (hasAuthParams) return
    let cancelled = false
    let timer: number | undefined
    let attempts = 0

    const decide = async () => {
      try {
        const context = await getCurrentGuardAuthContext()
        if (cancelled) return
        setTarget(context.isAuthenticated && context.role ? homePathForRole(context.role) : "/login")
      } catch (error) {
        if (cancelled) return
        if (!(error instanceof GuardCheckUnavailable)) {
          setTarget("/login")
          return
        }
        attempts += 1
        setUnreachable(attempts >= 3)
        timer = window.setTimeout(() => void decide(), Math.min(1000 * 2 ** (attempts - 1), 15_000))
      }
    }

    void decide()
    const retryNow = () => void decide()
    window.addEventListener("online", retryNow)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener("online", retryNow)
    }
  }, [hasAuthParams])

  if (target) return <Navigate to={target} replace />
  return <AppSplash note={unreachable ? "Trying to reach SKTR Coach. You are still signed in." : undefined} />
}
