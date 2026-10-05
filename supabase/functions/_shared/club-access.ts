// Shared by the two public "create my account from an invite" functions.
//
// A club that is suspended or cancelled is closed to everyone (migration 20261005180000), and since
// 20261006180000 the database refuses to accept an invite of such a club. These functions run with the
// service role, which the database does not restrict, so they ask the same question themselves before
// creating a sign-in that could not be used for anything.

// The Supabase client is used structurally so tests can pass a small fake.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any

export const CLUB_ACCESS_PAUSED_CODE = "access_paused"

export const CLUB_ACCESS_PAUSED_MESSAGE =
  "This club's access to SKTR Coach is paused, so this invite cannot be used right now. Ask the person who invited you."

/**
 * True when the club's latest provisioning record is suspended or cancelled. The answer comes from the
 * database function tenant_access_blocked, which uses the same rule as the row policies.
 *
 * If the question cannot be answered (the function is missing because the migration has not run yet,
 * or the call fails), this returns false and the account is created as before. That is safe: creating
 * the sign-in grants nothing. accept_coach_invite / accept_athlete_invite in the database decide who
 * joins a club, and they make this check themselves.
 */
export async function isClubAccessPaused(serviceClient: LooseClient, tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return false
  try {
    const { data, error } = await serviceClient.rpc("tenant_access_blocked", { p_tenant_id: tenantId })
    return !error && data === true
  } catch {
    return false
  }
}

/** Escapes text for use inside an HTML email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
