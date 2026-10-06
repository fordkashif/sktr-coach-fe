import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { rememberClubTimezone } from "@/lib/club-day"
import { cleanClubTimezone, DEFAULT_CLUB_TIMEZONE, isKnownTimezone } from "@/lib/club-timezone"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * The club's time zone. Reminders are timed in it.
 *
 * Supabase mode (migration 20261011120000): club_profiles.timezone, readable by every member of
 * the club; set_current_club_timezone(name) changes it, club admins only.
 * Mock mode keeps it in localStorage, per club.
 */

const MOCK_KEY = "pacelab:club-timezone"

export async function getClubTimezone(): Promise<Result<string>> {
  if (getBackendMode() !== "supabase") {
    try {
      return ok(cleanClubTimezone(window.localStorage.getItem(tenantStorageKey(MOCK_KEY))))
    } catch {
      return ok(DEFAULT_CLUB_TIMEZONE)
    }
  }

  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  // Row policies return the caller's own club only.
  const { data, error } = await client.from("club_profiles").select("timezone").limit(1).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  const timezone = cleanClubTimezone((data as { timezone?: string | null } | null)?.timezone)
  // "Today" follows the club's zone on every screen (src/lib/club-day.ts).
  rememberClubTimezone(timezone)
  return ok(timezone)
}

export async function saveClubTimezone(timezone: string): Promise<Result<string>> {
  const name = timezone.trim()
  if (!isKnownTimezone(name)) return err("VALIDATION", "Choose a time zone from the list.")

  if (getBackendMode() !== "supabase") {
    try {
      window.localStorage.setItem(tenantStorageKey(MOCK_KEY), name)
      rememberClubTimezone(name)
      return ok(name)
    } catch {
      return err("UNKNOWN", "Could not save on this device. Check that storage is not blocked.")
    }
  }

  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.rpc("set_current_club_timezone", { p_timezone: name })
  if (error) {
    const message = (error.message ?? "").toLowerCase()
    if (message.includes("unknown time zone")) return err("VALIDATION", "That time zone is not available. Choose another one.")
    if (message.includes("only active club-admin")) return err("FORBIDDEN", "Only a club admin can change the club's time zone.")
    if (message.includes("club profile not found")) return err("VALIDATION", "Save the club's name and season first, then set the time zone.")
    return { ok: false, error: mapPostgrestError(error) }
  }
  const saved = typeof data === "string" && data ? data : name
  rememberClubTimezone(saved)
  return ok(saved)
}
