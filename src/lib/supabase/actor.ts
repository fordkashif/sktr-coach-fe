import type { Session, SupabaseClient } from "@supabase/supabase-js"
import { ensureProfileForSession, type ProfileBootstrapReason } from "@/lib/supabase/profile-bootstrap"

export type AppRole = "athlete" | "coach" | "club-admin" | "platform-admin" | "guardian"

export type SessionActor = {
  userId: string
  userEmail: string | null
  role: AppRole
  tenantId: string | null
}

function isProfileRole(value: unknown): value is Exclude<AppRole, "platform-admin"> {
  return value === "athlete" || value === "coach" || value === "club-admin" || value === "guardian"
}

/** The actor for a session, or the reason the signed-in account has nothing to open. */
export type SessionAccess =
  | { actor: SessionActor; noAccessReason: null }
  | { actor: null; noAccessReason: ProfileBootstrapReason }

export async function resolveSessionAccess(supabase: SupabaseClient, session: Session): Promise<SessionAccess> {
  // "error" means the check itself could not be made (no network, a server hiccup). Callers must not
  // treat that as "this account has no access": the person is still signed in.
  try {
    const { profile, reason } = await ensureProfileForSession(supabase, session)
    if (profile && isProfileRole(profile.role)) {
      return {
        actor: {
          userId: session.user.id,
          userEmail: session.user.email ?? null,
          role: profile.role,
          tenantId: profile.tenant_id,
        },
        noAccessReason: null,
      }
    }

    const platformAdmin = await resolvePlatformAdminActor(supabase, session)
    if (platformAdmin === "error") return { actor: null, noAccessReason: "error" }
    if (platformAdmin) return { actor: platformAdmin, noAccessReason: null }
    return { actor: null, noAccessReason: reason ?? "none" }
  } catch {
    return { actor: null, noAccessReason: "error" }
  }
}

export async function resolveSessionActor(
  supabase: SupabaseClient,
  session: Session,
): Promise<SessionActor | null> {
  return (await resolveSessionAccess(supabase, session)).actor
}

async function resolvePlatformAdminActor(supabase: SupabaseClient, session: Session): Promise<SessionActor | null | "error"> {
  const normalizedEmail = session.user.email?.trim().toLowerCase() ?? null
  if (!normalizedEmail) return null

  const [byUserId, byEmail] = await Promise.all([
    supabase
      .from("platform_admin_contacts")
      .select("id")
      .eq("is_active", true)
      .eq("user_id", session.user.id)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("platform_admin_contacts")
      .select("id")
      .eq("is_active", true)
      .eq("email", normalizedEmail)
      .limit(1)
      .maybeSingle(),
  ])

  if (byUserId.error || byEmail.error) return "error"
  if (!byUserId.data && !byEmail.data) return null

  return {
    userId: session.user.id,
    userEmail: normalizedEmail,
    role: "platform-admin",
    tenantId: null,
  }
}
