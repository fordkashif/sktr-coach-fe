import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import {
  insertAuditEvent,
  updateCurrentClubAdminOnboardingStep,
  type ClubAdminProfileRecord,
} from "@/lib/data/club-admin/ops-data"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * First access for a club admin, split so each step persists on its own:
 * the password is saved the moment it is set (so a lost claim link never locks
 * anyone out), and onboarding is completed separately at the end of the wizard.
 * Route guards read club_profiles.password_set_at and onboarding_completed_at.
 */

async function resolveClubAdmin(operation: string): Promise<Result<{ client: SupabaseClient; userId: string; tenantId: string }>> {
  if (getBackendMode() !== "supabase") return err("UNKNOWN", `[${operation}] backend mode is not 'supabase'.`)
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", `[${operation}] Supabase client is not configured.`)

  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "Your session has ended. Open your claim link again or sign in.")

  const { data: profile, error } = await client.from("profiles").select("tenant_id, role").eq("user_id", userId).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "club-admin") return err("FORBIDDEN", "Only club-admin users can perform this operation.")

  return ok({ client, userId, tenantId: profile.tenant_id as string })
}

function suggestShortName(clubName: string) {
  const initials = clubName
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase())
    .join("")
    .slice(0, 5)
  return initials.length >= 2 ? initials : clubName.trim().slice(0, 4).toUpperCase() || "CLUB"
}

/** Step 1 of first access. Saves the password and stamps password_set_at. Safe to repeat. */
export async function setClubAdminFirstAccessPassword(rawPassword: string): Promise<Result<void>> {
  const context = await resolveClubAdmin("setClubAdminFirstAccessPassword")
  if (!context.ok) return context
  const { client, tenantId } = context.data

  if (rawPassword.length < 8) return err("VALIDATION", "Password must be at least 8 characters.")

  const passwordResult = await client.auth.updateUser({ password: rawPassword })
  // Retrying with the password that was already saved is not a failure.
  if (passwordResult.error && passwordResult.error.code !== "same_password") {
    return err("UNKNOWN", passwordResult.error.message, passwordResult.error)
  }

  const now = new Date().toISOString()
  const existing = await client.from("club_profiles").select("tenant_id").eq("tenant_id", tenantId).maybeSingle()
  if (existing.error) return { ok: false, error: mapPostgrestError(existing.error) }

  if (existing.data) {
    const { error } = await client.from("club_profiles").update({ password_set_at: now }).eq("tenant_id", tenantId)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(undefined)
  }

  // No club profile row yet: create one from the approved club name so the stamp has somewhere to live.
  const tenantResult = await client.from("tenants").select("name").eq("id", tenantId).maybeSingle()
  if (tenantResult.error) return { ok: false, error: mapPostgrestError(tenantResult.error) }
  const clubName = (tenantResult.data?.name as string | undefined)?.trim() || "Club"
  const year = new Date().getFullYear().toString()

  const { error } = await client.from("club_profiles").upsert(
    {
      tenant_id: tenantId,
      club_name: clubName,
      short_name: suggestShortName(clubName),
      primary_color: "#1368ff",
      season_year: year,
      season_start: `${year}-01-10`,
      season_end: `${year}-10-30`,
      password_set_at: now,
    },
    { onConflict: "tenant_id" },
  )
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

/** Last step of first access. Requires the password step to have been saved. Safe to repeat. */
export async function completeClubAdminOnboarding(profile: ClubAdminProfileRecord): Promise<Result<void>> {
  const context = await resolveClubAdmin("completeClubAdminOnboarding")
  if (!context.ok) return context
  const { client, userId, tenantId } = context.data

  if (!profile.clubName.trim()) return err("VALIDATION", "Club name is required.")
  if (!profile.shortName.trim()) return err("VALIDATION", "Short name is required.")
  if (profile.seasonStart && profile.seasonEnd && profile.seasonStart > profile.seasonEnd) {
    return err("VALIDATION", "Season end must be after season start.")
  }

  const existing = await client.from("club_profiles").select("password_set_at").eq("tenant_id", tenantId).maybeSingle()
  if (existing.error) return { ok: false, error: mapPostgrestError(existing.error) }
  if (!(existing.data as { password_set_at: string | null } | null)?.password_set_at) {
    return err("VALIDATION", "Set your password before finishing setup.")
  }

  const { error } = await client.from("club_profiles").upsert(
    {
      tenant_id: tenantId,
      club_name: profile.clubName.trim(),
      short_name: profile.shortName.trim(),
      primary_color: profile.primaryColor.trim() || "#1368ff",
      season_year: profile.seasonYear.trim(),
      season_start: profile.seasonStart,
      season_end: profile.seasonEnd,
      onboarding_completed_at: new Date().toISOString(),
      onboarding_completed_by_user_id: userId,
      setup_guide_dismissed_at: null,
    },
    { onConflict: "tenant_id" },
  )
  if (error) return { ok: false, error: mapPostgrestError(error) }

  // The club is set up at this point. Bookkeeping failures must not hold the admin on the wizard.
  await updateCurrentClubAdminOnboardingStep("complete")
  await insertAuditEvent({
    action: "first_access_setup_complete",
    target: "club-admin-onboarding",
    detail: profile.clubName.trim(),
  })

  return ok(undefined)
}
