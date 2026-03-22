"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { MOCK_ROLE_STORAGE_KEY, MOCK_USER_EMAIL_STORAGE_KEY } from "@/lib/mock-auth"
import { getBackendMode, isSupabaseEnabled } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { resolveSessionActor, type AppRole } from "@/lib/supabase/actor"

interface RoleContextValue {
  role: AppRole
  userEmail: string | null
  setRole: (role: AppRole) => void
}

function isAppRole(value: unknown): value is AppRole {
  return value === "coach" || value === "athlete" || value === "club-admin" || value === "platform-admin"
}

const RoleContext = createContext<RoleContextValue>({
  role: "club-admin",
  userEmail: null,
  setRole: () => {},
})

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<AppRole>("club-admin")
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    if (getBackendMode() !== "supabase") {
      const storedRole = window.localStorage.getItem(MOCK_ROLE_STORAGE_KEY)
      const storedEmail = window.localStorage.getItem(MOCK_USER_EMAIL_STORAGE_KEY)

      if (isAppRole(storedRole) && storedRole !== role) {
        const frameId = window.requestAnimationFrame(() => {
          setRole(storedRole)
          setUserEmail(storedEmail)
        })
        return () => window.cancelAnimationFrame(frameId)
      }

      setUserEmail(storedEmail)
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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void syncFromSession()
    })

    return () => {
      active = false
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
