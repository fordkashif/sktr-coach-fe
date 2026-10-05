import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

export type AthleteInvitePreview = {
  inviteId: string
  tenantId: string
  teamId: string
  teamName: string
  organizationName: string
  eventGroup: string | null
  status: "pending" | "accepted" | "expired" | "revoked"
  email: string | null
  hasExistingAccount: boolean
}

export type AthleteOnboardingState = {
  displayName: string
  passwordSetAt?: string | null
  onboardingCompletedAt?: string | null
  setupGuideDismissedAt?: string | null
}

function requireSupabaseClient(operation: string) {
  if (getBackendMode() !== "supabase") {
    return err("UNKNOWN", `[${operation}] backend mode is not 'supabase'.`)
  }

  const client = getBrowserSupabaseClient()
  if (!client) {
    return err("UNKNOWN", `[${operation}] Supabase client is not configured.`)
  }

  return ok(client)
}

export async function getPublicAthleteInvitePreview(inviteId: string): Promise<Result<AthleteInvitePreview>> {
  const clientResult = requireSupabaseClient("getPublicAthleteInvitePreview")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.data.rpc("get_public_athlete_invite", {
    p_invite_id: inviteId,
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return err("NOT_FOUND", "Athlete invite not found.")

  return ok({
    inviteId: row.invite_id,
    tenantId: row.tenant_id,
    teamId: row.team_id,
    teamName: row.team_name,
    organizationName: row.organization_name,
    eventGroup: row.event_group ?? null,
    status: row.status,
    email: row.email ?? null,
    hasExistingAccount: Boolean(row.has_existing_account),
  })
}

export async function getCurrentAthleteOnboardingState(): Promise<Result<AthleteOnboardingState>> {
  const clientResult = requireSupabaseClient("getCurrentAthleteOnboardingState")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.data.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data, error } = await clientResult.data
    .from("profiles")
    .select("display_name, password_set_at, onboarding_completed_at, setup_guide_dismissed_at")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok({
    displayName: data?.display_name ?? "",
    passwordSetAt: data?.password_set_at ?? null,
    onboardingCompletedAt: data?.onboarding_completed_at ?? null,
    setupGuideDismissedAt: data?.setup_guide_dismissed_at ?? null,
  })
}

export async function completeCurrentAthleteOnboarding(params: {
  displayName: string
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("completeCurrentAthleteOnboarding")
  if (!clientResult.ok) return clientResult

  if (!params.displayName.trim()) {
    return err("VALIDATION", "Full name is required.")
  }

  const { error } = await clientResult.data.rpc("complete_current_athlete_onboarding", {
    p_display_name: params.displayName.trim(),
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export async function claimAthleteInviteAccount(params: {
  inviteId: string
  email: string
  password: string
  displayName: string
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("claimAthleteInviteAccount")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.data.functions.invoke("claim-athlete-invite-account", {
    body: {
      inviteId: params.inviteId,
      email: params.email.trim().toLowerCase(),
      password: params.password.trim(),
      displayName: params.displayName.trim(),
    },
  })

  if (error) return err("UNKNOWN", error.message, error)
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    return err("UNKNOWN", data.error)
  }

  return ok(undefined)
}

export async function setCurrentAthleteSetupGuideDismissed(dismissed: boolean): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("setCurrentAthleteSetupGuideDismissed")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.data.rpc("set_current_athlete_setup_guide_dismissed", {
    p_dismissed: dismissed,
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}
