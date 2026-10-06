import { useEffect } from "react"
import { clearSessionCookies, getCookieValue, COACH_TEAM_COOKIE, setSessionCookies } from "@/lib/auth-session"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { isSupabaseEnabled } from "@/lib/supabase/config"
import { resolveSessionAccess } from "@/lib/supabase/actor"

async function resolveCoachTeamId(
  supabase: NonNullable<ReturnType<typeof getBrowserSupabaseClient>>,
  userId: string,
  tenantId: string,
) {
  const existingCookieTeamId = getCookieValue(COACH_TEAM_COOKIE)
  const membershipQuery = supabase
    .from("team_coaches")
    .select("team_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)

  const membershipResult = await membershipQuery
  if (membershipResult.error) return undefined

  const teamIds = ((membershipResult.data as Array<{ team_id: string }> | null) ?? [])
    .map((row) => row.team_id)
    .filter(Boolean)

  if (teamIds.length === 0) return undefined
  if (existingCookieTeamId && teamIds.includes(existingCookieTeamId)) return existingCookieTeamId
  return teamIds[0]
}

export function SupabaseAuthSync() {
  useEffect(() => {
    if (!isSupabaseEnabled()) return

    const supabase = getBrowserSupabaseClient()
    if (!supabase) return

    let active = true

    // Coming back to the tab asks again at most once a minute. A real change of sign-in always asks.
    let lastSyncedAt = 0
    let lastSyncedUser: string | null = null

    const syncSession = async (force = false) => {
      let sessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>>
      try {
        sessionResult = await supabase.auth.getSession()
      } catch {
        return
      }
      const session = sessionResult.data.session

      if (!active) return

      if (session && !force && lastSyncedUser === session.user.id && Date.now() - lastSyncedAt < 60_000) return

      if (!session) {
        // No answer from the server is not a sign out. Leave everything as it is.
        if (sessionResult.error || (typeof navigator !== "undefined" && navigator.onLine === false)) return
        clearSessionCookies("expired")
        return
      }

      // The role and club come from the database (the profile row, or bootstrap_current_profile() for a
      // first sign-in). Nothing here reads them from the user's auth metadata, which the user can edit.
      const { actor, noAccessReason } = await resolveSessionAccess(supabase, session)

      if (!active) return
      if (!actor) {
        if (noAccessReason === "error") return
        // No club for this account (yet). Only the role cookies are cleared: the Supabase session stays,
        // because the invite claim pages sign a new user in first and accept the invite a moment later.
        // The login page is the place that signs such an account out and explains why.
        clearSessionCookies("expired")
        return
      }

      const coachTeamId =
        actor.role === "coach" && actor.tenantId ? await resolveCoachTeamId(supabase, session.user.id, actor.tenantId) : undefined

      if (!active) return

      // A platform admin has no club. The login page writes the same placeholder.
      setSessionCookies(actor.role, actor.tenantId ?? "platform-admin", session.user.email ?? session.user.id, coachTeamId)
      lastSyncedAt = Date.now()
      lastSyncedUser = session.user.id
    }

    void syncSession()

    const handleWindowFocus = () => {
      void syncSession()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncSession()
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      // A renewed token is the same sign-in. Everything else may be a different one.
      void syncSession(event !== "TOKEN_REFRESHED" && event !== "INITIAL_SESSION")
    })

    window.addEventListener("focus", handleWindowFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      active = false
      window.removeEventListener("focus", handleWindowFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      subscription.unsubscribe()
    }
  }, [])

  return null
}
