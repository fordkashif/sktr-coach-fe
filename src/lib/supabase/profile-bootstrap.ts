import type { Session, SupabaseClient } from "@supabase/supabase-js"

const APP_ROLES = ["athlete", "coach", "club-admin"] as const
type AppRole = (typeof APP_ROLES)[number]

function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value)
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

type ProfileSeed = {
  tenantId: string | null
  role: AppRole | null
  displayName: string | null
}

function profileSeedFromSession(session: Session): ProfileSeed {
  const meta = session.user.user_metadata ?? {}

  const tenantId = firstString(meta.tenant_id, meta.tenantId, meta.org_id, meta.organization_id)
  const roleCandidate = firstString(meta.role, meta.app_role, meta.appRole)
  const role = isAppRole(roleCandidate) ? roleCandidate : null
  const displayName = firstString(meta.display_name, meta.full_name, meta.name)

  return { tenantId, role, displayName }
}

export async function ensureProfileForSession(supabase: SupabaseClient, session: Session) {
  const existing = await supabase
    .from("profiles")
    .select("user_id, tenant_id, role")
    .eq("user_id", session.user.id)
    .maybeSingle()

  if (existing.data) return existing.data

  const seed = profileSeedFromSession(session)
  if (!seed.tenantId || !seed.role) {
    console.warn("[supabase] Missing profile and insufficient metadata for bootstrap.", {
      userId: session.user.id,
      hasTenantId: Boolean(seed.tenantId),
      hasRole: Boolean(seed.role),
    })
    return null
  }

  const created = await supabase
    .from("profiles")
    .insert({
      user_id: session.user.id,
      tenant_id: seed.tenantId,
      role: seed.role,
      display_name: seed.displayName,
    })
    .select("user_id, tenant_id, role")
    .single()

  if (created.error) {
    console.warn("[supabase] Profile bootstrap failed.", {
      userId: session.user.id,
      message: created.error.message,
    })
    return null
  }

  return created.data
}
