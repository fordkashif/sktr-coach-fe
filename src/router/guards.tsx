import { useEffect, useState } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { evaluateAccess, type AccessResult } from "@/lib/access-control"
import { getCurrentGuardAuthContext } from "@/router/guard-auth-context"

export function GuardedAuthenticatedLayout() {
  const location = useLocation()
  const [access, setAccess] = useState<AccessResult | null>(null)

  useEffect(() => {
    let cancelled = false

    const resolveAccess = async () => {
      const authContext = await getCurrentGuardAuthContext()
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
