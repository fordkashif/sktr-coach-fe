import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { MOCK_USER_EMAIL_STORAGE_KEY } from "@/lib/mock-auth"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { DEFAULT_UNITS, isHeightUnit, isWeightUnit, type HeightUnit, type UnitPreferences, type WeightUnit } from "@/lib/units"

/**
 * Which units a person reads and types in: kilograms or pounds, centimetres or feet and inches.
 * Stored values never change; this is only a preference (see src/lib/units.ts).
 *
 * A person's own choice wins. Where they have not chosen, the club's default applies, and where
 * the club has not chosen either, kilograms and centimetres.
 *
 * Supabase mode (migration 20261017090000): unit_preferences holds one row per person (own row
 * only), club_unit_defaults one row per club (every member reads it, set_club_unit_defaults()
 * changes it, club admins only).
 * Mock mode: the person's choice sits in the mock account store, the club default in localStorage
 * per club.
 */

export type OwnUnits = { weight: WeightUnit | null; height: HeightUnit | null }
export type UnitSettings = {
  /** What the person chose themselves. Null means "same as the club". */
  own: OwnUnits
  club: UnitPreferences
  /** What the screens use. */
  effective: UnitPreferences
}

const STORAGE_BLOCKED = "Could not save on this device. Check that storage is not blocked."

function settings(own: OwnUnits, club: UnitPreferences): UnitSettings {
  return { own, club, effective: { weight: own.weight ?? club.weight, height: own.height ?? club.height } }
}

function cleanClub(value: { weight?: unknown; height?: unknown } | null | undefined): UnitPreferences {
  return { weight: isWeightUnit(value?.weight) ? value.weight : DEFAULT_UNITS.weight, height: isHeightUnit(value?.height) ? value.height : DEFAULT_UNITS.height }
}

function cleanOwn(value: { weight?: unknown; height?: unknown } | null | undefined): OwnUnits {
  return { weight: isWeightUnit(value?.weight) ? value.weight : null, height: isHeightUnit(value?.height) ? value.height : null }
}

/* ---------- Mock mode ------------------------------------------------------------------------ */

// The same store as the mock account's name and photo (account-data.ts), one more field per person.
const MOCK_ACCOUNTS_KEY = "pacelab:mock-accounts"
const MOCK_CLUB_KEY = "pacelab:club-unit-defaults"

function mockEmail() {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(MOCK_USER_EMAIL_STORAGE_KEY)?.trim().toLowerCase() || null
}

function readJson(key: string): Record<string, unknown> {
  if (typeof window === "undefined") return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}") as unknown
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function readMockOwn(email: string | null): OwnUnits {
  if (!email) return { weight: null, height: null }
  const record = readJson(MOCK_ACCOUNTS_KEY)[email] as { units?: { weight?: unknown; height?: unknown } } | undefined
  return cleanOwn(record?.units)
}

function readMockClub(): UnitPreferences {
  return cleanClub(readJson(tenantStorageKey(MOCK_CLUB_KEY)))
}

/* ---------- Reads ---------------------------------------------------------------------------- */

export async function getUnitSettings(): Promise<Result<UnitSettings>> {
  if (getBackendMode() !== "supabase") return ok(settings(readMockOwn(mockEmail()), readMockClub()))

  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data: sessionData } = await client.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "You are not signed in.")

  // Row policies return the caller's own row and the caller's own club only.
  const [own, club] = await Promise.all([
    client.from("unit_preferences").select("weight_unit, height_unit").eq("user_id", userId).maybeSingle(),
    client.from("club_unit_defaults").select("weight_unit, height_unit").limit(1).maybeSingle(),
  ])
  // A database without these tables yet behaves as "nobody has chosen": kilograms and centimetres.
  const ownRow = own.error ? null : (own.data as { weight_unit?: unknown; height_unit?: unknown } | null)
  const clubRow = club.error ? null : (club.data as { weight_unit?: unknown; height_unit?: unknown } | null)
  return ok(settings(cleanOwn({ weight: ownRow?.weight_unit, height: ownRow?.height_unit }), cleanClub({ weight: clubRow?.weight_unit, height: clubRow?.height_unit })))
}

/* ---------- Writes --------------------------------------------------------------------------- */

/** The person's own choice. Null for a unit means "same as the club". */
export async function saveOwnUnits(next: OwnUnits): Promise<Result<UnitSettings>> {
  const own = cleanOwn(next)

  if (getBackendMode() !== "supabase") {
    const email = mockEmail()
    if (!email) return err("UNAUTHORIZED", "You are not signed in.")
    try {
      const accounts = readJson(MOCK_ACCOUNTS_KEY)
      accounts[email] = { ...(accounts[email] as Record<string, unknown> | undefined), units: own }
      window.localStorage.setItem(MOCK_ACCOUNTS_KEY, JSON.stringify(accounts))
    } catch {
      return err("UNKNOWN", STORAGE_BLOCKED)
    }
    return ok(settings(own, readMockClub()))
  }

  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data: sessionData } = await client.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "You are not signed in.")
  // tenant_id is filled in by the database from the caller's club.
  const { error } = await client.from("unit_preferences").upsert({ user_id: userId, weight_unit: own.weight, height_unit: own.height }, { onConflict: "user_id" })
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return getUnitSettings()
}

/** The club's default, for members who have not chosen. Club admins only. */
export async function saveClubUnitDefaults(next: UnitPreferences): Promise<Result<UnitPreferences>> {
  if (!isWeightUnit(next.weight) || !isHeightUnit(next.height)) return err("VALIDATION", "Choose a unit from the list.")

  if (getBackendMode() !== "supabase") {
    try {
      window.localStorage.setItem(tenantStorageKey(MOCK_CLUB_KEY), JSON.stringify(next))
      return ok(next)
    } catch {
      return err("UNKNOWN", STORAGE_BLOCKED)
    }
  }

  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { error } = await client.rpc("set_club_unit_defaults", { p_weight_unit: next.weight, p_height_unit: next.height })
  if (error) {
    if ((error.message ?? "").toLowerCase().includes("only active club-admin")) return err("FORBIDDEN", "Only a club admin can change the club's units.")
    return { ok: false, error: mapPostgrestError(error) }
  }
  return ok(next)
}
