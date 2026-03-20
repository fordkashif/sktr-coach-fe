import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

export type ClubAdminUser = {
  id: string
  name: string
  email: string
  role: "club-admin" | "coach" | "athlete"
  status: "active" | "disabled"
  teamId?: string
}

export type ClubAdminInvite = {
  id: string
  email: string
  teamId?: string
  status: "pending" | "accepted" | "expired" | "revoked"
  createdAt: string
}

export type ClubAdminAccountRequest = {
  id: string
  fullName: string
  email: string
  organization: string
  role: "club-admin" | "coach" | "athlete"
  notes?: string
  status: "pending" | "approved" | "declined"
  createdAt: string
  reviewedAt?: string
}

export type ClubAdminTeamOption = {
  id: string
  name: string
}

type ClientResolution =
  | { ok: true; client: SupabaseClient }
  | { ok: false; error: DataError }

type ClubAdminContext = {
  userId: string
  tenantId: string
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

async function getCurrentClubAdminContext(client: SupabaseClient): Promise<Result<ClubAdminContext>> {
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: profile, error } = await client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "club-admin") return err("FORBIDDEN", "Only club-admin users can perform this operation.")

  return ok({
    userId,
    tenantId: profile.tenant_id as string,
  })
}

export type ClubAdminOpsSnapshot = {
  users: ClubAdminUser[]
  invites: ClubAdminInvite[]
  accountRequests: ClubAdminAccountRequest[]
  teams: ClubAdminTeamOption[]
}

export type ClubAdminReportSnapshot = {
  teams: Array<{
    id: string
    name: string
    eventGroup: string | null
    status: "active" | "archived"
  }>
  athletes: Array<{
    id: string
    name: string
    readiness: "green" | "yellow" | "red"
  }>
  prRows: Array<{
    athleteId: string
    event: string
    bestValue: string
    category: string
    measuredOn: string
  }>
}

export async function getClubAdminOpsSnapshot(): Promise<Result<ClubAdminOpsSnapshot>> {
  const clientResult = requireSupabaseClient("getClubAdminOpsSnapshot")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const [profilesResult, teamsResult, invitesResult, requestsResult] = await Promise.all([
    clientResult.client
      .from("profiles")
      .select("user_id, role, display_name, is_active")
      .eq("tenant_id", contextResult.data.tenantId)
      .order("created_at", { ascending: false }),
    clientResult.client.from("teams").select("id, name").eq("tenant_id", contextResult.data.tenantId).eq("is_archived", false),
    clientResult.client
      .from("coach_invites")
      .select("id, email, team_id, status, created_at")
      .eq("tenant_id", contextResult.data.tenantId)
      .order("created_at", { ascending: false }),
    clientResult.client
      .from("account_requests")
      .select("id, full_name, email, organization, desired_role, notes, status, created_at, reviewed_at")
      .eq("tenant_id", contextResult.data.tenantId)
      .order("created_at", { ascending: false }),
  ])

  if (profilesResult.error) return { ok: false, error: mapPostgrestError(profilesResult.error) }
  if (teamsResult.error) return { ok: false, error: mapPostgrestError(teamsResult.error) }
  if (invitesResult.error) return { ok: false, error: mapPostgrestError(invitesResult.error) }
  if (requestsResult.error) return { ok: false, error: mapPostgrestError(requestsResult.error) }

  const users: ClubAdminUser[] = ((profilesResult.data as Array<{
    user_id: string
    role: ClubAdminUser["role"]
    display_name: string | null
    is_active: boolean
  }> | null) ?? []).map((row) => ({
    id: row.user_id,
    name: row.display_name || "User",
    email: row.user_id,
    role: row.role,
    status: row.is_active ? "active" : "disabled",
  }))

  const teams: ClubAdminTeamOption[] = ((teamsResult.data as Array<{ id: string; name: string }> | null) ?? []).map((row) => ({
    id: row.id,
    name: row.name,
  }))

  const invites: ClubAdminInvite[] = ((invitesResult.data as Array<{
    id: string
    email: string
    team_id: string | null
    status: ClubAdminInvite["status"]
    created_at: string
  }> | null) ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    teamId: row.team_id ?? undefined,
    status: row.status,
    createdAt: row.created_at.slice(0, 10),
  }))

  const accountRequests: ClubAdminAccountRequest[] = ((requestsResult.data as Array<{
    id: string
    full_name: string
    email: string
    organization: string | null
    desired_role: ClubAdminAccountRequest["role"]
    notes: string | null
    status: ClubAdminAccountRequest["status"]
    created_at: string
    reviewed_at: string | null
  }> | null) ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    organization: row.organization ?? "",
    role: row.desired_role,
    notes: row.notes ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at ?? undefined,
  }))

  return ok({ users, invites, accountRequests, teams })
}

export async function createCoachInvite(params: {
  email: string
  teamId?: string
}): Promise<Result<ClubAdminInvite>> {
  const clientResult = requireSupabaseClient("createCoachInvite")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { data, error } = await clientResult.client
    .from("coach_invites")
    .insert({
      tenant_id: contextResult.data.tenantId,
      email: params.email.trim().toLowerCase(),
      team_id: params.teamId ?? null,
      role: "coach",
      status: "pending",
      invited_by_user_id: contextResult.data.userId,
    })
    .select("id, email, team_id, status, created_at")
    .single()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok({
    id: data.id,
    email: data.email,
    teamId: data.team_id ?? undefined,
    status: data.status,
    createdAt: data.created_at.slice(0, 10),
  })
}

export async function createUserProvisioningInvite(params: {
  email: string
  role: ClubAdminUser["role"]
  displayName: string
  teamId?: string
}): Promise<Result<ClubAdminInvite>> {
  const clientResult = requireSupabaseClient("createUserProvisioningInvite")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const inviteEmail = params.email.trim().toLowerCase()
  const displayName = params.displayName.trim()
  if (!inviteEmail || !displayName) return err("VALIDATION", "Name and email are required.")

  const otpResult = await clientResult.client.auth.signInWithOtp({
    email: inviteEmail,
    options: {
      data: {
        tenant_id: contextResult.data.tenantId,
        role: params.role,
        display_name: displayName,
        team_id: params.teamId ?? null,
      },
    },
  })

  if (otpResult.error) return err("UNKNOWN", otpResult.error.message, otpResult.error)

  const { data, error } = await clientResult.client
    .from("coach_invites")
    .insert({
      tenant_id: contextResult.data.tenantId,
      email: inviteEmail,
      team_id: params.teamId ?? null,
      role: params.role,
      status: "pending",
      invited_by_user_id: contextResult.data.userId,
      metadata: { display_name: displayName },
    })
    .select("id, email, team_id, status, created_at")
    .single()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok({
    id: data.id,
    email: data.email,
    teamId: data.team_id ?? undefined,
    status: data.status,
    createdAt: data.created_at.slice(0, 10),
  })
}

export async function reviewAccountRequest(params: {
  requestId: string
  status: "approved" | "declined"
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("reviewAccountRequest")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { error } = await clientResult.client
    .from("account_requests")
    .update({
      status: params.status,
      reviewed_by_user_id: contextResult.data.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", params.requestId)
    .eq("tenant_id", contextResult.data.tenantId)

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export async function updateProfileRoleAndStatus(params: {
  userId: string
  role: ClubAdminUser["role"]
  status: ClubAdminUser["status"]
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("updateProfileRoleAndStatus")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { error } = await clientResult.client
    .from("profiles")
    .update({
      role: params.role,
      is_active: params.status === "active",
    })
    .eq("user_id", params.userId)
    .eq("tenant_id", contextResult.data.tenantId)

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export async function insertAuditEvent(params: {
  action: string
  target: string
  detail?: string
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("insertAuditEvent")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { error } = await clientResult.client.from("audit_events").insert({
    tenant_id: contextResult.data.tenantId,
    actor_user_id: contextResult.data.userId,
    actor_role: "club-admin",
    action: params.action,
    target: params.target,
    detail: params.detail ?? null,
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export async function getClubAdminReportSnapshot(): Promise<Result<ClubAdminReportSnapshot>> {
  const clientResult = requireSupabaseClient("getClubAdminReportSnapshot")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const [teamsResult, athletesResult, prsResult] = await Promise.all([
    clientResult.client.from("teams").select("id, name, event_group, is_archived").eq("tenant_id", contextResult.data.tenantId),
    clientResult.client.from("athletes").select("id, first_name, last_name, readiness").eq("tenant_id", contextResult.data.tenantId),
    clientResult.client
      .from("pr_records")
      .select("athlete_id, event, best_value, category, measured_on")
      .eq("tenant_id", contextResult.data.tenantId)
      .order("measured_on", { ascending: false }),
  ])

  if (teamsResult.error) return { ok: false, error: mapPostgrestError(teamsResult.error) }
  if (athletesResult.error) return { ok: false, error: mapPostgrestError(athletesResult.error) }
  if (prsResult.error) return { ok: false, error: mapPostgrestError(prsResult.error) }

  return ok({
    teams: ((teamsResult.data as Array<{
      id: string
      name: string
      event_group: string | null
      is_archived: boolean
    }> | null) ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      eventGroup: row.event_group,
      status: row.is_archived ? "archived" : "active",
    })),
    athletes: ((athletesResult.data as Array<{
      id: string
      first_name: string
      last_name: string
      readiness: "green" | "yellow" | "red" | null
    }> | null) ?? []).map((row) => ({
      id: row.id,
      name: `${row.first_name} ${row.last_name}`.trim(),
      readiness: row.readiness ?? "yellow",
    })),
    prRows: ((prsResult.data as Array<{
      athlete_id: string
      event: string
      best_value: string
      category: string
      measured_on: string
    }> | null) ?? []).map((row) => ({
      athleteId: row.athlete_id,
      event: row.event,
      bestValue: row.best_value,
      category: row.category,
      measuredOn: row.measured_on,
    })),
  })
}
