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

function isLikelyUuid(value: string | null): value is string {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

type ProfileSeed = {
  tenantId: string | null
  role: AppRole | null
  displayName: string | null
  teamId: string | null
}

function profileSeedFromSession(session: Session): ProfileSeed {
  const meta = session.user.user_metadata ?? {}

  const tenantId = firstString(meta.tenant_id, meta.tenantId, meta.org_id, meta.organization_id)
  const roleCandidate = firstString(meta.role, meta.app_role, meta.appRole)
  const role = isAppRole(roleCandidate) ? roleCandidate : null
  const displayName = firstString(meta.display_name, meta.full_name, meta.name)
  const teamIdCandidate = firstString(meta.team_id, meta.teamId)
  const teamId = isLikelyUuid(teamIdCandidate) ? teamIdCandidate : null

  return { tenantId, role, displayName, teamId }
}

function splitDisplayName(displayName: string | null) {
  if (!displayName) return { firstName: "Athlete", lastName: "User" }
  const parts = displayName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: "Athlete", lastName: "User" }
  if (parts.length === 1) return { firstName: parts[0], lastName: "User" }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") }
}

async function profileSeedFromApprovedTenantRequest(
  supabase: SupabaseClient,
  session: Session,
): Promise<ProfileSeed | null> {
  const normalizedEmail = session.user.email?.trim().toLowerCase()
  if (!normalizedEmail) return null

  const requestResult = await supabase
    .from("tenant_provision_requests")
    .select("provisioned_tenant_id, requestor_name")
    .eq("requestor_email", normalizedEmail)
    .eq("status", "approved")
    .not("provisioned_tenant_id", "is", null)
    .order("reviewed_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (requestResult.error || !requestResult.data) return null

  return {
    tenantId: requestResult.data.provisioned_tenant_id as string,
    role: "club-admin",
    displayName: (requestResult.data.requestor_name as string | null) ?? session.user.email ?? null,
    teamId: null,
  }
}

async function ensureAthleteForSession(supabase: SupabaseClient, session: Session, seed: ProfileSeed) {
  if (seed.role !== "athlete" || !seed.tenantId) return

  const existing = await supabase
    .from("athletes")
    .select("id")
    .eq("user_id", session.user.id)
    .maybeSingle()

  if (existing.data || existing.error) return

  const { firstName, lastName } = splitDisplayName(seed.displayName)
  const inserted = await supabase
    .from("athletes")
    .insert({
      tenant_id: seed.tenantId,
      user_id: session.user.id,
      team_id: seed.teamId,
      first_name: firstName,
      last_name: lastName,
      event_group: null,
      primary_event: null,
      readiness: "yellow",
      is_active: true,
    })
    .select("id")
    .single()

  if (inserted.error) {
    console.warn("[supabase] Athlete bootstrap failed.", {
      userId: session.user.id,
      message: inserted.error.message,
    })
  }
}

export async function ensureProfileForSession(supabase: SupabaseClient, session: Session) {
  const existing = await supabase
    .from("profiles")
    .select("user_id, tenant_id, role")
    .eq("user_id", session.user.id)
    .maybeSingle()

  if (existing.data) return existing.data

  let seed = profileSeedFromSession(session)
  if (!seed.tenantId || !seed.role) {
    const requestSeed = await profileSeedFromApprovedTenantRequest(supabase, session)
    if (requestSeed) {
      seed = requestSeed
    }
  }

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

  await ensureAthleteForSession(supabase, session, seed)
  return created.data
}
