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

export type ClubAdminTeamRecord = {
  id: string
  name: string
  eventGroup: string | null
  status: "active" | "archived"
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

export type ClubAdminAuditEvent = {
  id: string
  action: string
  actor: string
  target: string
  detail?: string
  at: string
}

export type ClubAdminProfileRecord = {
  clubName: string
  shortName: string
  primaryColor: string
  seasonYear: string
  seasonStart: string
  seasonEnd: string
}

export type ClubAdminBillingRecord = {
  plan: "starter" | "pro" | "enterprise"
  seats: number
  renewalDate: string
  paymentMethodLast4: string
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

export async function getClubAdminAuditEvents(): Promise<Result<ClubAdminAuditEvent[]>> {
  const clientResult = requireSupabaseClient("getClubAdminAuditEvents")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { data, error } = await clientResult.client
    .from("audit_events")
    .select("id, action, actor_role, actor_user_id, target, detail, created_at")
    .eq("tenant_id", contextResult.data.tenantId)
    .order("created_at", { ascending: false })
    .limit(500)

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
      id: string
      action: string
      actor_role: string | null
      actor_user_id: string | null
      target: string
      detail: string | null
      created_at: string
    }> | null) ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      actor: row.actor_role ?? row.actor_user_id ?? "system",
      target: row.target,
      detail: row.detail ?? undefined,
      at: new Date(row.created_at).toLocaleString(),
    })),
  )
}

export async function getClubAdminProfileRecord(): Promise<Result<ClubAdminProfileRecord>> {
  const clientResult = requireSupabaseClient("getClubAdminProfileRecord")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const [tenantResult, profileResult] = await Promise.all([
    clientResult.client
      .from("tenants")
      .select("name")
      .eq("id", contextResult.data.tenantId)
      .maybeSingle(),
    clientResult.client
      .from("club_profiles")
      .select(
        "club_name, short_name, primary_color, season_year, season_start, season_end",
      )
      .eq("tenant_id", contextResult.data.tenantId)
      .maybeSingle(),
  ])

  if (tenantResult.error) return { ok: false, error: mapPostgrestError(tenantResult.error) }
  if (profileResult.error) return { ok: false, error: mapPostgrestError(profileResult.error) }

  const nowYear = new Date().getFullYear().toString()
  const row = profileResult.data as {
    club_name: string
    short_name: string
    primary_color: string
    season_year: string
    season_start: string
    season_end: string
  } | null

  return ok({
    clubName: row?.club_name ?? tenantResult.data?.name ?? "Club",
    shortName: row?.short_name ?? "CLUB",
    primaryColor: row?.primary_color ?? "#16a34a",
    seasonYear: row?.season_year ?? nowYear,
    seasonStart: row?.season_start ?? `${nowYear}-01-10`,
    seasonEnd: row?.season_end ?? `${nowYear}-10-30`,
  })
}

export async function upsertClubAdminProfileRecord(
  profile: ClubAdminProfileRecord,
): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("upsertClubAdminProfileRecord")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  if (!profile.clubName.trim()) return err("VALIDATION", "Club name is required.")
  if (!profile.shortName.trim()) return err("VALIDATION", "Short name is required.")

  const { error } = await clientResult.client.from("club_profiles").upsert(
    {
      tenant_id: contextResult.data.tenantId,
      club_name: profile.clubName.trim(),
      short_name: profile.shortName.trim(),
      primary_color: profile.primaryColor.trim() || "#16a34a",
      season_year: profile.seasonYear.trim(),
      season_start: profile.seasonStart,
      season_end: profile.seasonEnd,
    },
    { onConflict: "tenant_id" },
  )

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export async function getClubAdminBillingRecord(): Promise<Result<ClubAdminBillingRecord>> {
  const clientResult = requireSupabaseClient("getClubAdminBillingRecord")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { data, error } = await clientResult.client
    .from("billing_profiles")
    .select("plan, seats, renewal_date, payment_method_last4")
    .eq("tenant_id", contextResult.data.tenantId)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }

  const row = data as {
    plan: ClubAdminBillingRecord["plan"]
    seats: number
    renewal_date: string
    payment_method_last4: string
  } | null

  return ok({
    plan: row?.plan ?? "pro",
    seats: row?.seats ?? 50,
    renewalDate: row?.renewal_date ?? "2026-04-01",
    paymentMethodLast4: row?.payment_method_last4 ?? "4242",
  })
}

export async function upsertClubAdminBillingRecord(
  billing: ClubAdminBillingRecord,
): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("upsertClubAdminBillingRecord")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { error } = await clientResult.client.from("billing_profiles").upsert(
    {
      tenant_id: contextResult.data.tenantId,
      plan: billing.plan,
      seats: Math.max(1, billing.seats),
      renewal_date: billing.renewalDate,
      payment_method_last4: billing.paymentMethodLast4.trim().slice(0, 4),
    },
    { onConflict: "tenant_id" },
  )

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export async function getClubAdminTeamsSnapshot(): Promise<Result<ClubAdminTeamRecord[]>> {
  const clientResult = requireSupabaseClient("getClubAdminTeamsSnapshot")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { data, error } = await clientResult.client
    .from("teams")
    .select("id, name, event_group, is_archived")
    .eq("tenant_id", contextResult.data.tenantId)
    .order("created_at", { ascending: false })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
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
  )
}

export async function createClubAdminTeam(params: {
  name: string
  eventGroup?: string | null
}): Promise<Result<ClubAdminTeamRecord>> {
  const clientResult = requireSupabaseClient("createClubAdminTeam")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const teamName = params.name.trim()
  if (!teamName) return err("VALIDATION", "Team name is required.")

  const { data, error } = await clientResult.client
    .from("teams")
    .insert({
      tenant_id: contextResult.data.tenantId,
      name: teamName,
      event_group: params.eventGroup ?? null,
      is_archived: false,
    })
    .select("id, name, event_group, is_archived")
    .single()

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok({
    id: data.id,
    name: data.name,
    eventGroup: data.event_group,
    status: data.is_archived ? "archived" : "active",
  })
}

export async function updateClubAdminTeam(params: {
  teamId: string
  name: string
  eventGroup?: string | null
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("updateClubAdminTeam")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const teamName = params.name.trim()
  if (!teamName) return err("VALIDATION", "Team name is required.")

  const { error } = await clientResult.client
    .from("teams")
    .update({
      name: teamName,
      event_group: params.eventGroup ?? null,
    })
    .eq("id", params.teamId)
    .eq("tenant_id", contextResult.data.tenantId)

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export async function setClubAdminTeamArchived(params: {
  teamId: string
  archived: boolean
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("setClubAdminTeamArchived")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { error } = await clientResult.client
    .from("teams")
    .update({
      is_archived: params.archived,
      archived_at: params.archived ? new Date().toISOString() : null,
    })
    .eq("id", params.teamId)
    .eq("tenant_id", contextResult.data.tenantId)

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}
