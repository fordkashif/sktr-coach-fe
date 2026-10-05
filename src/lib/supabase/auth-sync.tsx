import { useEffect } from "react"
import { clearSessionCookies, getCookieValue, COACH_TEAM_COOKIE, setSessionCookies } from "@/lib/auth-session"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { isSupabaseEnabled } from "@/lib/supabase/config"
import { resolveSessionActor } from "@/lib/supabase/actor"

function isTenantRole(value: string): value is "athlete" | "coach" | "club-admin" {
  return value === "athlete" || value === "coach" || value === "club-admin"
}

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

    const syncSession = async () => {
      const { data } = await supabase.auth.getSession()
      const session = data.session

      if (!active) return

      if (!session) {
        clearSessionCookies()
        return
      }

      // The role and club come from the database (the profile row, or bootstrap_current_profile() for a
      // first sign-in). Nothing here reads them from the user's auth metadata, which the user can edit.
      const actor = await resolveSessionActor(supabase, session)

      if (!active) return
      if (!actor || !isTenantRole(actor.role) || !actor.tenantId) {
        // No club for this account (yet). Only the role cookies are cleared: the Supabase session stays,
        // because the invite claim pages sign a new user in first and accept the invite a moment later.
        // The login page is the place that signs such an account out and explains why.
        clearSessionCookies()
        return
      }

      const coachTeamId =
        actor.role === "coach" ? await resolveCoachTeamId(supabase, session.user.id, actor.tenantId) : undefined

      if (!active) return

      setSessionCookies(actor.role, actor.tenantId, session.user.email ?? session.user.id, coachTeamId)
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
    } = supabase.auth.onAuthStateChange(() => {
      void syncSession()
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
