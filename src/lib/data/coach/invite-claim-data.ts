import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

export type CoachInvitePreview = {
  inviteId: string
  email: string
  status: "pending" | "accepted" | "expired" | "revoked"
  tenantId: string
  organizationName: string
  teamId?: string
  teamName?: string
  hasExistingAccount: boolean
}

export type CoachOnboardingState = {
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

export async function getPublicCoachInvitePreview(inviteId: string): Promise<Result<CoachInvitePreview>> {
  const clientResult = requireSupabaseClient("getPublicCoachInvitePreview")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.data.rpc("get_public_coach_invite", {
    p_invite_id: inviteId,
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return err("NOT_FOUND", "Coach invite not found.")

  return ok({
    inviteId: row.invite_id,
    email: row.email,
    status: row.status,
    tenantId: row.tenant_id,
    organizationName: row.organization_name,
    teamId: row.team_id ?? undefined,
    teamName: row.team_name ?? undefined,
    hasExistingAccount: Boolean(row.has_existing_account),
  })
}

export async function getCurrentCoachOnboardingState(): Promise<Result<CoachOnboardingState>> {
  const clientResult = requireSupabaseClient("getCurrentCoachOnboardingState")
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

export async function completeCurrentCoachOnboarding(params: {
  displayName: string
  password?: string
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("completeCurrentCoachOnboarding")
  if (!clientResult.ok) return clientResult

  if (params.password && params.password.trim().length < 8) {
    return err("VALIDATION", "Password must be at least 8 characters.")
  }

  if (!params.displayName.trim()) {
    return err("VALIDATION", "Full name is required.")
  }

  if (params.password) {
    const passwordResult = await clientResult.data.auth.updateUser({ password: params.password.trim() })
    if (passwordResult.error) return err("UNKNOWN", passwordResult.error.message, passwordResult.error)
  }

  const { error } = await clientResult.data.rpc("complete_current_coach_onboarding", {
    p_display_name: params.displayName.trim(),
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export async function claimCoachInviteAccount(params: {
  inviteId: string
  email: string
  password: string
  displayName: string
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("claimCoachInviteAccount")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.data.functions.invoke("claim-coach-invite-account", {
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

export async function setCurrentCoachSetupGuideDismissed(dismissed: boolean): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("setCurrentCoachSetupGuideDismissed")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.data.rpc("set_current_coach_setup_guide_dismissed", {
    p_dismissed: dismissed,
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}
