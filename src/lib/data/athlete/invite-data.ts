import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { buildPackageLimitError, getTenantPackageUsage } from "@/lib/tenant/package-enforcement"

type ClientResolution =
  | { ok: true; client: SupabaseClient }
  | { ok: false; error: DataError }

type InvitePreview = {
  inviteId: string
  teamId: string
  teamName: string
  eventGroup: string | null
  status: "pending" | "accepted" | "expired" | "revoked"
}

function requireSupabaseClient(operation: string): ClientResolution {
  if (getBackendMode() !== "supabase") {
    return {
      ok: false,
      error: { code: "UNKNOWN", message: `[${operation}] backend mode is not 'supabase'.` },
    }
  }

  const client = getBrowserSupabaseClient()
  if (!client) {
    return {
      ok: false,
      error: { code: "UNKNOWN", message: `[${operation}] Supabase client is not configured.` },
    }
  }

  return { ok: true, client }
}

export async function createAthleteInviteForCurrentCoach(params: {
  teamId: string
  email: string
  expiresInDays?: number
}): Promise<Result<{ inviteId: string; invitePath: string }>> {
  const clientResult = requireSupabaseClient("createAthleteInviteForCurrentCoach")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const expiryDays = Math.max(1, Math.min(params.expiresInDays ?? 7, 30))
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()
  const inviteEmail = params.email.trim().toLowerCase()

  if (!inviteEmail) return err("VALIDATION", "Athlete email is required.")

  const { data: profile, error: profileError } = await clientResult.client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()

  if (profileError) return { ok: false, error: mapPostgrestError(profileError) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "coach" && profile.role !== "club-admin") {
    return err("FORBIDDEN", "Only coach or club-admin users can create athlete invites.")
  }

  const packageUsageResult = await getTenantPackageUsage(clientResult.client, profile.tenant_id as string)
  if (!packageUsageResult.ok) return packageUsageResult
  if (
    packageUsageResult.data.packageDefinition &&
    packageUsageResult.data.usage.athletes >= packageUsageResult.data.packageDefinition.limits.athletes
  ) {
    return buildPackageLimitError({
      packageDefinition: packageUsageResult.data.packageDefinition,
      resourceLabel: "athletes",
    })
  }

  const { data, error } = await clientResult.client
    .from("athlete_invites")
    .insert({
      tenant_id: profile.tenant_id,
      team_id: params.teamId,
      email: inviteEmail,
      invited_by_user_id: userId,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok({
    inviteId: data.id,
    invitePath: `/athlete/claim/${data.id}`,
  })
}

export async function getAthleteInvitePreviewForCurrentUser(inviteId: string): Promise<Result<InvitePreview>> {
  const clientResult = requireSupabaseClient("getAthleteInvitePreviewForCurrentUser")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: profile, error: profileError } = await clientResult.client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()

  if (profileError) return { ok: false, error: mapPostgrestError(profileError) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")

  const { data, error } = await clientResult.client
    .from("athlete_invites")
    .select("id, team_id, status, teams(name, event_group)")
    .eq("id", inviteId)
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return err("NOT_FOUND", "Invite not found.")

  const team = Array.isArray(data.teams) ? data.teams[0] : data.teams
  return ok({
    inviteId: data.id,
    teamId: data.team_id,
    teamName: team?.name ?? "Team",
    eventGroup: team?.event_group ?? null,
    status: data.status,
  })
}

export async function acceptAthleteInviteForCurrentUser(inviteId: string): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("acceptAthleteInviteForCurrentUser")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client.rpc("accept_athlete_invite", {
    p_invite_id: inviteId,
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export type AthleteInviteStatus = "pending" | "accepted" | "expired" | "revoked"

export type TeamAthleteInvite = {
  id: string
  email: string
  status: AthleteInviteStatus
  createdAt: string
  expiresAt: string | null
  invitePath: string
}

/** Invites issued for one team, newest first. Pending invites past their expiry are reported as expired. */
export async function getAthleteInvitesForTeam(teamId: string): Promise<Result<TeamAthleteInvite[]>> {
  const clientResult = requireSupabaseClient("getAthleteInvitesForTeam")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client
    .from("athlete_invites")
    .select("id, email, status, created_at, expires_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  const now = Date.now()
  return ok(
    ((data as Array<{
      id: string
      email: string | null
      status: AthleteInviteStatus
      created_at: string
      expires_at: string | null
    }> | null) ?? []).map((row) => ({
      id: row.id,
      email: row.email ?? "",
      status:
        row.status === "pending" && row.expires_at && new Date(row.expires_at).getTime() < now ? "expired" : row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      invitePath: `/athlete/claim/${row.id}`,
    })),
  )
}

/** Cancels a pending invite so its link stops working. */
export async function revokeAthleteInviteForCurrentCoach(inviteId: string): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("revokeAthleteInviteForCurrentCoach")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client
    .from("athlete_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("status", "pending")
    .select("id")

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) return err("NOT_FOUND", "This invite is no longer pending.")
  return ok(undefined)
}
