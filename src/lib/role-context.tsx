"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { getBackendMode, isSupabaseEnabled } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { resolveSessionActor, type AppRole } from "@/lib/supabase/actor"
import { SESSION_UPDATED_EVENT } from "@/lib/auth-session"
import { MOCK_ROLE_STORAGE_KEY, MOCK_USER_EMAIL_STORAGE_KEY } from "@/lib/mock-auth"

interface RoleContextValue {
  role: AppRole
  userEmail: string | null
  setRole: (role: AppRole) => void
}

function isAppRole(value: unknown): value is AppRole {
  return value === "coach" || value === "athlete" || value === "club-admin" || value === "platform-admin" || value === "guardian"
}

const RoleContext = createContext<RoleContextValue>({
  role: "club-admin",
  userEmail: null,
  setRole: () => {},
})

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<AppRole>("club-admin")
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [, setSessionEpoch] = useState(0)

  useEffect(() => {
    if (getBackendMode() !== "supabase") {
      let cancelled = false

      const storedRole = window.localStorage.getItem(MOCK_ROLE_STORAGE_KEY)
      const storedEmail = window.localStorage.getItem(MOCK_USER_EMAIL_STORAGE_KEY)

      if (isAppRole(storedRole) && storedRole !== role) {
        const frameId = window.requestAnimationFrame(() => {
          if (cancelled) return
          setRole(storedRole)
          setUserEmail(storedEmail)
        })
        return () => {
          cancelled = true
          window.cancelAnimationFrame(frameId)
        }
      }

      setUserEmail(storedEmail)

      return () => {
        cancelled = true
      }
      return undefined
    }

    if (!isSupabaseEnabled()) return undefined

    const supabase = getBrowserSupabaseClient()
    if (!supabase) return undefined

    let active = true

    const syncFromSession = async () => {
      const { data } = await supabase.auth.getSession()
      const session = data.session

      if (!active) return
      if (!session) {
        setUserEmail(null)
        return
      }

      setUserEmail(session.user.email ?? null)
      const actor = await resolveSessionActor(supabase, session)
      if (!active || !actor || !isAppRole(actor.role)) return
      setRole(actor.role)
    }

    void syncFromSession()

    const handleWindowFocus = () => {
      void syncFromSession()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncFromSession()
      }
    }

    const handleSessionUpdated = () => {
      setSessionEpoch((value) => value + 1)
      void syncFromSession()
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void syncFromSession()
    })

    window.addEventListener("focus", handleWindowFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener(SESSION_UPDATED_EVENT, handleSessionUpdated as EventListener)

    return () => {
      active = false
      window.removeEventListener("focus", handleWindowFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener(SESSION_UPDATED_EVENT, handleSessionUpdated as EventListener)
      subscription.unsubscribe()
    }
  }, [role])

  const handleSetRole = (nextRole: AppRole) => {
    setRole(nextRole)
    if (getBackendMode() === "supabase") return
    window.localStorage.setItem(MOCK_ROLE_STORAGE_KEY, nextRole)
  }

  return (
    <RoleContext.Provider value={{ role, userEmail, setRole: handleSetRole }}>
      {children}
    </RoleContext.Provider>
  )
}

export function useRole() {
  return useContext(RoleContext)
}
