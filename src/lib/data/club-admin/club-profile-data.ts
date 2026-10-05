import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import type { PreparedAvatar } from "@/lib/image-resize"
import { loadClubProfile } from "@/lib/mock-club-admin"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * The club as its members see it (name, logo, colour) and the details only its admins see
 * (contact, location, website).
 *
 * Supabase mode (migration 20261010100000):
 *   - get_current_club_brand(): name, short name, colour and logo path for any active member.
 *   - The logo lives in the public "club-logos" bucket under "<club id>/<random>.jpg". Only the
 *     club's admins can upload there; set_current_club_logo(path) saves the path.
 *   - club_contact_details: one row per club, readable and writable by its admins only.
 * Mock mode keeps the same shapes in localStorage, per club.
 */

export const CLUB_LOGO_BUCKET = "club-logos"
export const DEFAULT_CLUB_COLOR = "#1368ff"

export type ClubBrand = {
  name: string
  /** A few letters shown when the club has no logo ("ETC"). */
  shortName: string | null
  /** Six digit hex. Only ever used behind the short name and as a rule on paper. */
  color: string
  logoUrl: string | null
}

export type ClubContactDetails = {
  contactEmail: string
  contactPhone: string
  city: string
  region: string
  country: string
  website: string
}

export const EMPTY_CLUB_CONTACT: ClubContactDetails = { contactEmail: "", contactPhone: "", city: "", region: "", country: "", website: "" }

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const MOCK_LOGO_KEY = "pacelab:club-logo"
const MOCK_CONTACT_KEY = "pacelab:club-contact"
const STORAGE_BLOCKED = "Could not save on this device. Check that storage is not blocked."

function supabaseClient(): SupabaseClient | null {
  return getBackendMode() === "supabase" ? getBrowserSupabaseClient() : null
}

function cleanColor(value: string | null | undefined) {
  return value && HEX_COLOR.test(value.trim()) ? value.trim().toLowerCase() : DEFAULT_CLUB_COLOR
}

function mockLogo(): string | null {
  try {
    return window.localStorage.getItem(tenantStorageKey(MOCK_LOGO_KEY)) || null
  } catch {
    return null
  }
}

/** The signed-in member's club. Null for someone with no club (a platform admin) or when it cannot be read. */
export async function getCurrentClubBrand(role: string): Promise<ClubBrand | null> {
  if (role === "platform-admin") return null

  if (getBackendMode() !== "supabase") {
    if (typeof window === "undefined") return null
    const profile = loadClubProfile()
    const name = profile.clubName?.trim()
    if (!name) return null
    return { name, shortName: profile.shortName?.trim() || null, color: cleanColor(profile.primaryColor), logoUrl: mockLogo() }
  }

  const client = supabaseClient()
  if (!client) return null
  try {
    const { data, error } = await client.rpc("get_current_club_brand")
    if (error) return null
    const row = (Array.isArray(data) ? data[0] : data) as
      | { club_name?: string | null; short_name?: string | null; primary_color?: string | null; logo_path?: string | null }
      | null
      | undefined
    const name = row?.club_name?.trim()
    if (!name) return null
    return {
      name,
      shortName: row?.short_name?.trim() || null,
      color: cleanColor(row?.primary_color),
      logoUrl: row?.logo_path ? client.storage.from(CLUB_LOGO_BUCKET).getPublicUrl(row.logo_path).data.publicUrl : null,
    }
  } catch {
    return null
  }
}

function randomFileName() {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`
  return `${id}.jpg`
}

async function currentTenantId(client: SupabaseClient): Promise<Result<string>> {
  const { data: sessionData } = await client.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "You are not signed in.")
  const { data, error } = await client.from("profiles").select("tenant_id, role").eq("user_id", userId).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.role !== "club-admin") return err("FORBIDDEN", "Only a club admin can change the club's details.")
  return ok(data.tenant_id as string)
}

function describeLogoError(message: string): string {
  const text = message.toLowerCase()
  if (text.includes("only active club-admin")) return "Only a club admin can change the club logo."
  if (text.includes("not valid for this club") || text.includes("has not been uploaded")) return "The logo did not upload properly. Try again."
  return message
}

/** Uploads a prepared logo (fitted into a square), makes it the club's logo and deletes the one it replaces. */
export async function uploadClubLogo(prepared: PreparedAvatar): Promise<Result<{ logoUrl: string }>> {
  if (getBackendMode() !== "supabase") {
    try {
      window.localStorage.setItem(tenantStorageKey(MOCK_LOGO_KEY), prepared.dataUrl)
      return ok({ logoUrl: prepared.dataUrl })
    } catch {
      return err("UNKNOWN", STORAGE_BLOCKED)
    }
  }

  const client = supabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const tenant = await currentTenantId(client)
  if (!tenant.ok) return tenant

  const bucket = client.storage.from(CLUB_LOGO_BUCKET)
  const path = `${tenant.data}/${randomFileName()}`
  const upload = await bucket.upload(path, prepared.blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false })
  if (upload.error) {
    const message = upload.error.message ?? ""
    if (/exceeded|too large|payload/i.test(message)) return err("VALIDATION", "That image is too large. Choose a smaller one.")
    if (/mime|type/i.test(message)) return err("VALIDATION", "That file type is not supported. Use a JPEG, PNG or WebP image.")
    if (/row-level security|unauthorized|not authorized|403/i.test(message)) {
      return err("FORBIDDEN", "Only a club admin can change the club logo. Reload the page and try again.")
    }
    if (/bucket not found|not found/i.test(message)) {
      return err("NOT_FOUND", "Club logos are not switched on for this workspace yet. Message the SKTR team and they will set it up.")
    }
    return err("UNKNOWN", "The logo did not upload. Check your connection and try again.", upload.error)
  }

  const { data: previous, error } = await client.rpc("set_current_club_logo", { p_logo_path: path })
  if (error) {
    await bucket.remove([path]).catch(() => undefined)
    if (error.code === "PGRST202") {
      return err("NOT_FOUND", "Club logos are not switched on for this workspace yet. Message the SKTR team and they will set it up.", error)
    }
    const mapped = mapPostgrestError(error)
    return { ok: false, error: { ...mapped, message: describeLogoError(mapped.message) } }
  }
  if (typeof previous === "string" && previous && previous !== path) {
    // The old file is no longer the club's logo. If this fails it only leaves an unused file behind.
    await bucket.remove([previous]).catch(() => undefined)
  }
  return ok({ logoUrl: bucket.getPublicUrl(path).data.publicUrl })
}

export async function removeClubLogo(): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") {
    try {
      window.localStorage.removeItem(tenantStorageKey(MOCK_LOGO_KEY))
      return ok(null)
    } catch {
      return err("UNKNOWN", STORAGE_BLOCKED)
    }
  }

  const client = supabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data: previous, error } = await client.rpc("set_current_club_logo", { p_logo_path: null })
  if (error) {
    const mapped = mapPostgrestError(error)
    return { ok: false, error: { ...mapped, message: describeLogoError(mapped.message) } }
  }
  if (typeof previous === "string" && previous) {
    await client.storage.from(CLUB_LOGO_BUCKET).remove([previous]).catch(() => undefined)
  }
  return ok(null)
}

/** Adds https:// to a bare address and refuses anything that is not a web address. Empty stays empty. */
export function normalizeWebsite(value: string): { ok: true; value: string } | { ok: false } {
  const raw = value.trim()
  if (!raw) return { ok: true, value: "" }
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false }
    if (!url.hostname.includes(".")) return { ok: false }
    return { ok: true, value: url.toString().replace(/\/$/, "") }
  } catch {
    return { ok: false }
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^[0-9+() .-]{5,40}$/

/** Checks and tidies what was typed. Every field is optional. */
export function validateClubContact(
  draft: ClubContactDetails,
): { ok: true; data: ClubContactDetails } | { ok: false; errors: Partial<Record<keyof ClubContactDetails, string>> } {
  const errors: Partial<Record<keyof ClubContactDetails, string>> = {}
  const contactEmail = draft.contactEmail.trim().toLowerCase()
  const contactPhone = draft.contactPhone.trim()
  const website = normalizeWebsite(draft.website)
  if (contactEmail && (!EMAIL.test(contactEmail) || contactEmail.length > 254)) errors.contactEmail = "That does not look like an email address."
  if (contactPhone && !PHONE.test(contactPhone)) errors.contactPhone = "Use digits, spaces and + ( ) - only, like +1 876 555 0100."
  if (!website.ok || (website.ok && website.value.length > 200)) errors.website = "Enter a web address, like yourclub.com."
  for (const key of ["city", "region", "country"] as const) {
    if (draft[key].trim().length > 80) errors[key] = "Keep this to 80 characters or fewer."
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    data: {
      contactEmail,
      contactPhone,
      city: draft.city.trim(),
      region: draft.region.trim(),
      country: draft.country.trim(),
      website: website.ok ? website.value : "",
    },
  }
}

/** The club's contact details and location. Empty strings for anything not added yet. */
export async function getClubContactDetails(): Promise<Result<ClubContactDetails>> {
  if (getBackendMode() !== "supabase") {
    try {
      const raw = window.localStorage.getItem(tenantStorageKey(MOCK_CONTACT_KEY))
      return ok({ ...EMPTY_CLUB_CONTACT, ...(raw ? (JSON.parse(raw) as Partial<ClubContactDetails>) : {}) })
    } catch {
      return ok(EMPTY_CLUB_CONTACT)
    }
  }

  const client = supabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const tenant = await currentTenantId(client)
  if (!tenant.ok) return tenant
  const { data, error } = await client
    .from("club_contact_details")
    .select("contact_email, contact_phone, city, region, country, website")
    .eq("tenant_id", tenant.data)
    .maybeSingle()
  if (error) {
    // The table arrives with migration 20261010100000. Until then there is simply nothing saved.
    if (error.code === "42P01" || error.code === "PGRST205") return ok(EMPTY_CLUB_CONTACT)
    return { ok: false, error: mapPostgrestError(error) }
  }
  const row = data as { contact_email: string | null; contact_phone: string | null; city: string | null; region: string | null; country: string | null; website: string | null } | null
  return ok({
    contactEmail: row?.contact_email ?? "",
    contactPhone: row?.contact_phone ?? "",
    city: row?.city ?? "",
    region: row?.region ?? "",
    country: row?.country ?? "",
    website: row?.website ?? "",
  })
}

export async function saveClubContactDetails(details: ClubContactDetails): Promise<Result<ClubContactDetails>> {
  const validation = validateClubContact(details)
  if (!validation.ok) return err("VALIDATION", Object.values(validation.errors)[0] ?? "Check the details and try again.")
  const next = validation.data

  if (getBackendMode() !== "supabase") {
    try {
      window.localStorage.setItem(tenantStorageKey(MOCK_CONTACT_KEY), JSON.stringify(next))
      return ok(next)
    } catch {
      return err("UNKNOWN", STORAGE_BLOCKED)
    }
  }

  const client = supabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const tenant = await currentTenantId(client)
  if (!tenant.ok) return tenant
  const { error } = await client.from("club_contact_details").upsert(
    {
      tenant_id: tenant.data,
      contact_email: next.contactEmail || null,
      contact_phone: next.contactPhone || null,
      city: next.city || null,
      region: next.region || null,
      country: next.country || null,
      website: next.website || null,
    },
    { onConflict: "tenant_id" },
  )
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return err("NOT_FOUND", "Contact details are not switched on for this workspace yet. Message the SKTR team and they will set it up.", error)
    }
    if (error.code === "23514") return err("VALIDATION", "One of these details is not in a form we can save. Check the email, phone and website.", error)
    return { ok: false, error: mapPostgrestError(error) }
  }
  return ok(next)
}

/** "Kingston, St Andrew, Jamaica" from whichever parts are there. Empty when none are. */
export function formatClubLocation(details: Pick<ClubContactDetails, "city" | "region" | "country">) {
  return [details.city, details.region, details.country].map((part) => part.trim()).filter(Boolean).join(", ")
}
