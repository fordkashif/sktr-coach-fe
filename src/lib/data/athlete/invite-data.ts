import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

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
  expiresInDays?: number
}): Promise<Result<{ inviteId: string; invitePath: string }>> {
  const clientResult = requireSupabaseClient("createAthleteInviteForCurrentCoach")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const expiryDays = Math.max(1, Math.min(params.expiresInDays ?? 7, 30))
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()

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

  const { data, error } = await clientResult.client
    .from("athlete_invites")
    .insert({
      tenant_id: profile.tenant_id,
      team_id: params.teamId,
      invited_by_user_id: userId,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok({
    inviteId: data.id,
    invitePath: `/athlete/join/${data.id}`,
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
