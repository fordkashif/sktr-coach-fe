import type { Session, SupabaseClient } from "@supabase/supabase-js"

/**
 * Why a signed-in user has no profile. Comes from the database, never from the browser.
 * - invite_pending: an invite is waiting for this email and has to be accepted through its own link.
 * - none: there is nothing this account is entitled to.
 * - error: the lookup itself failed (network, or the database function is missing).
 */
export type ProfileBootstrapReason = "invite_pending" | "none" | "error"

export type SessionProfile = {
  user_id: string
  tenant_id: string
  role: string
}

export type ProfileBootstrapResult =
  | { profile: SessionProfile; reason: null }
  | { profile: null; reason: ProfileBootstrapReason }

type BootstrapRow = {
  user_id: string | null
  tenant_id: string | null
  role: string | null
  status: string | null
}

/**
 * Returns the signed-in user's profile, asking the database to create it when the user is entitled to one.
 *
 * The browser never chooses a club or a role. `bootstrap_current_profile()` takes no arguments and works
 * only from what the database knows about the signed-in user (today: an approved club request for their
 * email, which makes them that club's admin). Coach and athlete profiles are created by
 * `accept_coach_invite` / `accept_athlete_invite` when the invite link is opened.
 */
export async function ensureProfileForSession(
  supabase: SupabaseClient,
  session: Session,
): Promise<ProfileBootstrapResult> {
  const existing = await supabase
    .from("profiles")
    .select("user_id, tenant_id, role")
    .eq("user_id", session.user.id)
    .maybeSingle()

  if (existing.data) return { profile: existing.data as SessionProfile, reason: null }

  const bootstrap = await supabase.rpc("bootstrap_current_profile")
  if (bootstrap.error) {
    console.warn("[supabase] Profile bootstrap failed.", {
      userId: session.user.id,
      message: bootstrap.error.message,
    })
    return { profile: null, reason: "error" }
  }

  const row = (Array.isArray(bootstrap.data) ? bootstrap.data[0] : bootstrap.data) as BootstrapRow | null
  if (row?.user_id && row.tenant_id && row.role) {
    return { profile: { user_id: row.user_id, tenant_id: row.tenant_id, role: row.role }, reason: null }
  }

  return { profile: null, reason: row?.status === "invite_pending" ? "invite_pending" : "none" }
}
