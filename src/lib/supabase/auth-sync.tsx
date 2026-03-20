import { useEffect } from "react"
import { clearSessionCookies, setSessionCookies } from "@/lib/auth-session"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { isSupabaseEnabled } from "@/lib/supabase/config"
import { ensureProfileForSession } from "@/lib/supabase/profile-bootstrap"

function isAppRole(value: string): value is "athlete" | "coach" | "club-admin" {
  return value === "athlete" || value === "coach" || value === "club-admin"
}

export function SupabaseAuthSync() {
  useEffect(() => {
    if (!isSupabaseEnabled()) return

    const supabase = getBrowserSupabaseClient()
    if (!supabase) return

    let active = true

    const syncSession = async () => {
      const { data } = await supabase.auth.getSession()
      const session = data.session

      if (!active) return

      if (!session) {
        clearSessionCookies()
        return
      }

      const profile = await ensureProfileForSession(supabase, session)

      if (!active) return
      if (!profile || !isAppRole(profile.role) || !profile.tenant_id) return

      setSessionCookies(profile.role, profile.tenant_id, session.user.email ?? session.user.id)
    }

    void syncSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void syncSession()
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  return null
}
