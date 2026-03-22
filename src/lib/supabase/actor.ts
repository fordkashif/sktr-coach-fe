import type { Session, SupabaseClient } from "@supabase/supabase-js"
import { ensureProfileForSession } from "@/lib/supabase/profile-bootstrap"

export type AppRole = "athlete" | "coach" | "club-admin" | "platform-admin"

export type SessionActor = {
  userId: string
  userEmail: string | null
  role: AppRole
  tenantId: string | null
}

function isProfileRole(value: unknown): value is Exclude<AppRole, "platform-admin"> {
  return value === "athlete" || value === "coach" || value === "club-admin"
}

export async function resolveSessionActor(
  supabase: SupabaseClient,
  session: Session,
): Promise<SessionActor | null> {
  const profile = await ensureProfileForSession(supabase, session)
  if (profile && isProfileRole(profile.role)) {
    return {
      userId: session.user.id,
      userEmail: session.user.email ?? null,
      role: profile.role,
      tenantId: profile.tenant_id,
    }
  }

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

  if (byUserId.error || byEmail.error) return null
  if (!byUserId.data && !byEmail.data) return null

  return {
    userId: session.user.id,
    userEmail: normalizedEmail,
    role: "platform-admin",
    tenantId: null,
  }
}
