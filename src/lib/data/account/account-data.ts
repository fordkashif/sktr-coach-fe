import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { MOCK_ATHLETE_ID, MOCK_COACH_NAME, loadMockAthleteProfileEdits } from "@/lib/data/athlete/profile-data"
import { MOCK_CREDENTIALS, MOCK_USER_EMAIL_STORAGE_KEY, changeMockPassword, getMockCredentialByEmail } from "@/lib/mock-auth"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import type { PreparedAvatar } from "@/lib/image-resize"

/**
 * The signed-in person's own account: name, photo, email and password.
 *
 * Supabase mode: names and photos are written through security definer functions
 * (update_current_display_name, set_current_avatar) because API roles cannot write profiles.
 * Photos live in the public "avatars" bucket under "<user id>/<random>.jpg"; see the migration
 * 20261007100000 for why the bucket is public and who can see whose photo.
 * Mock mode: everything is kept in localStorage so the screens can be demonstrated.
 */

export const AVATAR_BUCKET = "avatars"
export const DISPLAY_NAME_MAX_LENGTH = 120
export const MIN_PASSWORD_LENGTH = 8

export type AccountRole = "athlete" | "coach" | "club-admin" | "platform-admin" | "guardian"

export type CurrentAccount = {
  role: AccountRole | null
  email: string | null
  /** An address waiting for its confirmation link to be opened. */
  pendingEmail: string | null
  /** Null when the account has no name yet. Screens fall back to the email. */
  displayName: string | null
  avatarUrl: string | null
}

/** Photos the signed-in person may see, keyed by "a:<athlete id>", "u:<user id>" and "e:<email>". */
export type AvatarMap = Record<string, string>

function supabaseClient(): SupabaseClient | null {
  return getBackendMode() === "supabase" ? getBrowserSupabaseClient() : null
}

function publicAvatarUrl(client: SupabaseClient, path: string | null | undefined) {
  if (!path) return null
  return client.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl
}

function isAccountRole(value: unknown): value is AccountRole {
  return value === "athlete" || value === "coach" || value === "club-admin" || value === "platform-admin" || value === "guardian"
}

export function cleanDisplayName(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

export function validateDisplayName(value: string): string | null {
  const name = cleanDisplayName(value)
  if (!name) return "Enter your name."
  if (name.length > DISPLAY_NAME_MAX_LENGTH) return `Keep your name under ${DISPLAY_NAME_MAX_LENGTH} characters.`
  return null
}

/* ---------------------------------------------------------------------------
   Mock mode storage
--------------------------------------------------------------------------- */

const MOCK_ACCOUNTS_KEY = "pacelab:mock-accounts"
type MockAccountRecord = { displayName?: string; avatar?: string }

function readMockAccounts(): Record<string, MockAccountRecord> {
  if (typeof window === "undefined") return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MOCK_ACCOUNTS_KEY) ?? "{}") as Record<string, MockAccountRecord> | null
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeMockAccount(email: string, patch: MockAccountRecord): boolean {
  try {
    const accounts = readMockAccounts()
    const next = { ...accounts[email], ...patch }
    if (next.avatar === undefined) delete next.avatar
    accounts[email] = next
    window.localStorage.setItem(MOCK_ACCOUNTS_KEY, JSON.stringify(accounts))
    return true
  } catch {
    return false
  }
}

function mockEmail() {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(MOCK_USER_EMAIL_STORAGE_KEY)?.trim().toLowerCase() || null
}

function mockDefaultName(email: string): string | null {
  if (email === MOCK_CREDENTIALS.athlete.email) {
    const edits = loadMockAthleteProfileEdits()
    return `${edits.firstName ?? "Marcus"} ${edits.lastName ?? "Johnson"}`.trim()
  }
  if (email === MOCK_CREDENTIALS.coach.email) return MOCK_COACH_NAME
  if (email === MOCK_CREDENTIALS.guardian.email) return "Dana Anderson"
  return null
}

const STORAGE_BLOCKED = "Could not save on this device. Check that storage is not blocked."

/* ---------------------------------------------------------------------------
   Reads
--------------------------------------------------------------------------- */

export async function getCurrentAccount(): Promise<Result<CurrentAccount>> {
  if (getBackendMode() !== "supabase") {
    const email = mockEmail()
    if (!email) return err("UNAUTHORIZED", "You are not signed in.")
    const record = readMockAccounts()[email] ?? {}
    const isAthlete = email === MOCK_CREDENTIALS.athlete.email
    return ok({
      role: getMockCredentialByEmail(email)?.role ?? null,
      email,
      pendingEmail: null,
      // The mock athlete's name is owned by their athlete profile.
      displayName: (isAthlete ? null : record.displayName) ?? mockDefaultName(email),
      avatarUrl: record.avatar ?? null,
    })
  }

  const client = supabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data: sessionData } = await client.auth.getSession()
  const user = sessionData.session?.user
  if (!user) return err("UNAUTHORIZED", "You are not signed in.")

  const base = { email: user.email ?? null, pendingEmail: user.new_email ?? null }
  const { data, error } = await client.rpc("get_current_account")
  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as
      | { role?: string | null; display_name?: string | null; avatar_path?: string | null }
      | null
      | undefined
    return ok({
      ...base,
      role: isAccountRole(row?.role) ? row.role : null,
      displayName: row?.display_name?.trim() || null,
      avatarUrl: publicAvatarUrl(client, row?.avatar_path),
    })
  }

  // The function is not there yet (the migration has not been applied): the name still loads.
  const fallback = await client.from("profiles").select("role, display_name").eq("user_id", user.id).maybeSingle()
  if (fallback.error) return { ok: false, error: mapPostgrestError(error) }
  return ok({
    ...base,
    role: isAccountRole(fallback.data?.role) ? fallback.data.role : null,
    displayName: (fallback.data?.display_name as string | null | undefined)?.trim() || null,
    avatarUrl: null,
  })
}

/**
 * Photos of the people the caller may see. Never fails a screen: on any error the map is
 * empty and every avatar shows initials.
 */
export async function getVisibleAvatars(): Promise<AvatarMap> {
  const map: AvatarMap = {}

  if (getBackendMode() !== "supabase") {
    for (const [email, record] of Object.entries(readMockAccounts())) {
      if (!record.avatar) continue
      map[`e:${email}`] = record.avatar
      if (email === MOCK_CREDENTIALS.athlete.email) map[`a:${MOCK_ATHLETE_ID}`] = record.avatar
    }
    return map
  }

  const client = supabaseClient()
  if (!client) return map
  try {
    const { data, error } = await client.rpc("get_visible_avatars")
    if (error || !Array.isArray(data)) return map
    for (const row of data as Array<{ user_id?: string | null; athlete_id?: string | null; avatar_path?: string | null }>) {
      const url = publicAvatarUrl(client, row.avatar_path)
      if (!url) continue
      if (row.user_id) map[`u:${row.user_id}`] = url
      if (row.athlete_id) map[`a:${row.athlete_id}`] = url
    }
  } catch {
    // Initials everywhere.
  }
  return map
}

/* ---------------------------------------------------------------------------
   Name
--------------------------------------------------------------------------- */

/** Coaches, club admins and platform admins. Athletes change their name on their athlete profile. */
export async function updateDisplayName(input: string): Promise<Result<string>> {
  const problem = validateDisplayName(input)
  if (problem) return err("VALIDATION", problem)
  const name = cleanDisplayName(input)

  if (getBackendMode() !== "supabase") {
    const email = mockEmail()
    if (!email) return err("UNAUTHORIZED", "You are not signed in.")
    return writeMockAccount(email, { displayName: name }) ? ok(name) : err("UNKNOWN", STORAGE_BLOCKED)
  }

  const client = supabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.rpc("update_current_display_name", { p_display_name: name })
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(typeof data === "string" && data ? data : name)
}

/* ---------------------------------------------------------------------------
   Photo
--------------------------------------------------------------------------- */

function randomFileName() {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`
  return `${id}.jpg`
}

/** Uploads a prepared (cropped, resized) photo, makes it the caller's photo and deletes the one it replaces. */
export async function uploadAvatar(prepared: PreparedAvatar): Promise<Result<{ avatarUrl: string }>> {
  if (getBackendMode() !== "supabase") {
    const email = mockEmail()
    if (!email) return err("UNAUTHORIZED", "You are not signed in.")
    return writeMockAccount(email, { avatar: prepared.dataUrl }) ? ok({ avatarUrl: prepared.dataUrl }) : err("UNKNOWN", STORAGE_BLOCKED)
  }

  const client = supabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data: sessionData } = await client.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "You are not signed in.")

  const bucket = client.storage.from(AVATAR_BUCKET)
  const path = `${userId}/${randomFileName()}`
  const upload = await bucket.upload(path, prepared.blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false })
  if (upload.error) {
    const message = upload.error.message ?? ""
    if (/exceeded|too large|payload/i.test(message)) return err("VALIDATION", "That photo is too large. Choose a smaller one.")
    if (/mime|type/i.test(message)) return err("VALIDATION", "That file type is not supported. Use a JPEG, PNG or WebP photo.")
    if (/row-level security|unauthorized|not authorized|403/i.test(message)) {
      return err("FORBIDDEN", "You do not have access to change your photo right now. Reload the page and try again.")
    }
    return err("UNKNOWN", "The photo did not upload. Check your connection and try again.", upload.error)
  }

  const { data: previous, error } = await client.rpc("set_current_avatar", { p_avatar_path: path })
  if (error) {
    await bucket.remove([path]).catch(() => undefined)
    return { ok: false, error: mapPostgrestError(error) }
  }
  if (typeof previous === "string" && previous && previous !== path) {
    // The old file is no longer anyone's photo. If this fails it only leaves an unused file behind.
    await bucket.remove([previous]).catch(() => undefined)
  }
  return ok({ avatarUrl: bucket.getPublicUrl(path).data.publicUrl })
}

export async function removeAvatar(): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") {
    const email = mockEmail()
    if (!email) return err("UNAUTHORIZED", "You are not signed in.")
    return writeMockAccount(email, { avatar: undefined }) ? ok(null) : err("UNKNOWN", STORAGE_BLOCKED)
  }

  const client = supabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data: previous, error } = await client.rpc("set_current_avatar", { p_avatar_path: null })
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (typeof previous === "string" && previous) {
    await client.storage.from(AVATAR_BUCKET).remove([previous]).catch(() => undefined)
  }
  return ok(null)
}

/* ---------------------------------------------------------------------------
   Email, password, devices
--------------------------------------------------------------------------- */

type AuthErrorLike = { message?: string; code?: string; status?: number; name?: string }

function describeAccountAuthError(error: AuthErrorLike, fallback: string) {
  const message = error.message ?? ""
  const code = error.code ?? ""
  if (error.name === "AuthRetryableFetchError" || error.status === 0 || /failed to fetch|network|load failed/i.test(message)) {
    return "We could not reach SKTR Coach. Check your connection and try again."
  }
  if (error.status === 429 || /rate limit|too many|only request this after/i.test(message)) {
    return "Too many attempts. Wait a minute, then try again."
  }
  if (code === "email_exists" || /already (been )?registered|already exists|email address.*in use/i.test(message)) {
    return "That email already belongs to another SKTR Coach account."
  }
  if (code === "email_address_invalid" || /invalid.*email|unable to validate email/i.test(message)) {
    return "That does not look like an email address. Check for typos."
  }
  if (code === "same_password" || /different from the old password/i.test(message)) {
    return "Choose a password you have not used on this account before."
  }
  if (code === "weak_password" || /weak password|password should/i.test(message)) {
    return "That password is too easy to guess. Use at least 8 characters with a mix of letters and numbers."
  }
  if (code === "reauthentication_needed" || /reauthentication/i.test(message)) {
    return "For your security, sign out, sign in again and then retry."
  }
  return fallback
}

export function validateNewEmail(value: string, currentEmail: string | null): string | null {
  const email = value.trim().toLowerCase()
  if (!email) return "Enter your new email address."
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "That does not look like an email address. Check for typos."
  if (currentEmail && email === currentEmail.trim().toLowerCase()) return "That is already your email address."
  return null
}

/**
 * Asks for a new sign-in email. Nothing changes until the link sent to the NEW address is opened,
 * which is what proves the person owns it (invites and club requests are matched by email).
 */
export async function requestEmailChange(input: string, currentEmail: string | null): Promise<Result<{ pendingEmail: string }>> {
  const problem = validateNewEmail(input, currentEmail)
  if (problem) return err("VALIDATION", problem)
  const email = input.trim().toLowerCase()

  if (getBackendMode() !== "supabase") {
    if (getMockCredentialByEmail(email)) return err("CONFLICT", "That email already belongs to another SKTR Coach account.")
    // The preview sends no email, so the address never changes. The screen shows the same notice.
    return ok({ pendingEmail: email })
  }

  const client = supabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { error } = await client.auth.updateUser({ email }, { emailRedirectTo: `${window.location.origin}/account` })
  if (error) return err("UNKNOWN", describeAccountAuthError(error, "We could not start the email change. Try again in a moment."), error)
  return ok({ pendingEmail: email })
}

export function validateNewPassword(password: string, confirm: string): { password?: string; confirm?: string } {
  const errors: { password?: string; confirm?: string } = {}
  // Same rule as the reset page.
  if (password.trim().length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (password !== confirm) errors.confirm = "Passwords do not match."
  return errors
}

/** Changes the password after checking the current one by signing in with it again. */
export async function changePassword(currentPassword: string, nextPassword: string): Promise<Result<null>> {
  if (!currentPassword) return err("VALIDATION", "Enter your current password.")
  if (nextPassword.trim().length < MIN_PASSWORD_LENGTH) return err("VALIDATION", `Use at least ${MIN_PASSWORD_LENGTH} characters.`)

  if (getBackendMode() !== "supabase") {
    const email = mockEmail()
    if (!email) return err("UNAUTHORIZED", "You are not signed in.")
    const result = changeMockPassword(email, currentPassword, nextPassword)
    if (result.ok) return ok(null)
    return result.reason === "wrong-password"
      ? err("FORBIDDEN", "Your current password is not right. Check it and try again.")
      : err("NOT_FOUND", "This demo account cannot change its password.")
  }

  const client = supabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data: sessionData } = await client.auth.getSession()
  const email = sessionData.session?.user.email
  if (!email) return err("UNAUTHORIZED", "You are not signed in.")

  const check = await client.auth.signInWithPassword({ email, password: currentPassword })
  if (check.error) {
    const wrong = check.error.code === "invalid_credentials" || /invalid login credentials/i.test(check.error.message ?? "")
    return err(
      wrong ? "FORBIDDEN" : "UNKNOWN",
      wrong ? "Your current password is not right. Check it and try again." : describeAccountAuthError(check.error, "We could not check your current password. Try again in a moment."),
      check.error,
    )
  }

  const update = await client.auth.updateUser({ password: nextPassword })
  if (update.error) return err("UNKNOWN", describeAccountAuthError(update.error, "We could not change your password. Try again in a moment."), update.error)
  return ok(null)
}

/** Ends every other session of this account (other phones, other browsers). This device stays signed in. */
export async function signOutOtherDevices(): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") return ok(null)
  const client = supabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { error } = await client.auth.signOut({ scope: "others" })
  if (error) return err("UNKNOWN", describeAccountAuthError(error, "We could not sign out your other devices. Try again in a moment."), error)
  return ok(null)
}

/**
 * Ends every session of this account, this device included (a stolen password, a phone that is gone).
 * Supabase revokes all refresh tokens; another device stops working when its current access token
 * runs out (up to an hour) or the next time it talks to the sign-in service, whichever is first.
 */
export async function signOutEveryDevice(): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") return ok(null)
  const client = supabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { error } = await client.auth.signOut({ scope: "global" })
  if (error) return err("UNKNOWN", describeAccountAuthError(error, "We could not sign out every device. Try again in a moment."), error)
  return ok(null)
}
