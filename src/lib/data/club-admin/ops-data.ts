import type { SupabaseClient } from "@supabase/supabase-js"
import { normaliseTeamCoachRole, type TeamCoachRole } from "@/lib/coach-permissions"
import { listAthleteAvailability } from "@/lib/data/athlete/availability-data"
import { kickNotificationEmails } from "@/lib/data/notifications-data"
import { adherenceCounts, adherencePercent, type AdherenceSession } from "@/lib/data/session/adherence"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { INVITE_EMAIL_COLUMNS, isMissingInviteEmailColumns } from "@/lib/data/invites/invite-email-data"
import { buildPackageLimitError, getTenantPackageUsage } from "@/lib/tenant/package-enforcement"

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
  /** What the person becomes when they accept. Missing on rows read before the role was selected: treat as coach. */
  role?: "coach" | "club-admin"
  teamId?: string
  status: "pending" | "accepted" | "expired" | "revoked"
  createdAt: string
  expiresAt?: string
  inviteUrl?: string
  /** When the invite email last went out. Missing means it has not been emailed. */
  emailSentAt?: string
  emailSendCount?: number
  /** Machine code of the last failed email attempt. */
  emailError?: string
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

export type ClubAdminAssignableCoachOption = {
  userId: string
  name: string
  email?: string
  label: string
  isSelf: boolean
}

export type ClubAdminTeamRecord = {
  id: string
  name: string
  eventGroup: string | null
  status: "draft" | "active" | "archived"
  leadCoachUserId?: string
  leadCoachLabel?: string
  currentUserAssignedAsCoach?: boolean
  /** Assistant coaches of this team may message its athletes. */
  assistantsCanMessage?: boolean
  /** Assistant coaches of this team may see health information. */
  assistantsSeeHealth?: boolean
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
    status: "draft" | "active" | "archived"
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
  passwordSetAt?: string | null
  onboardingCompletedAt?: string | null
  setupGuideDismissedAt?: string | null
}

export type ClubAdminBillingRecord = {
  plan: "starter" | "pro" | "enterprise"
  seats: number
  renewalDate: string
  paymentMethodLast4: string
}

export type ClubAdminActivationState = {
  tenantId: string
  lifecycleStatus: string | null
  billingStatus: string | null
  billingProvider: string | null
  billingContactName: string | null
  billingContactEmail: string | null
  billingCycle: "monthly" | "annual" | null
  requestedPlan: "starter" | "pro" | "enterprise" | null
  organizationName: string | null
  onboardingStep: string | null
}

export type ClubAdminPackageUpgradeRequest = {
  id: string
  tenantId: string
  currentPackage: "starter" | "pro" | "enterprise"
  requestedPackage: "starter" | "pro" | "enterprise"
  reason: string | null
  status: "pending" | "approved" | "rejected" | "cancelled"
  reviewNotes: string | null
  reviewedAt: string | null
  createdAt: string
}

export async function getClubAdminOpsSnapshot(): Promise<Result<ClubAdminOpsSnapshot>> {
  const clientResult = requireSupabaseClient("getClubAdminOpsSnapshot")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const selectInvites = (columns: string) =>
    clientResult.client
      .from("coach_invites")
      .select(columns)
      .eq("tenant_id", contextResult.data.tenantId)
      .order("created_at", { ascending: false })
  const inviteColumns = "id, email, role, team_id, status, created_at, expires_at"

  const [profilesResult, teamsResult, invitesWithEmailResult, requestsResult] = await Promise.all([
    clientResult.client
      .from("profiles")
      .select("user_id, role, display_name, is_active")
      .eq("tenant_id", contextResult.data.tenantId)
      .order("created_at", { ascending: false }),
    clientResult.client
      .from("teams")
      .select("id, name")
      .eq("tenant_id", contextResult.data.tenantId)
      .eq("status", "active"),
    selectInvites(`${inviteColumns}, ${INVITE_EMAIL_COLUMNS}`),
    clientResult.client
      .from("account_requests")
      .select("id, full_name, email, organization, desired_role, notes, status, created_at, reviewed_at")
      .eq("tenant_id", contextResult.data.tenantId)
      .order("created_at", { ascending: false }),
  ])

  // The email columns arrive with a migration. Until it has run, still show the invites.
  const invitesResult = isMissingInviteEmailColumns(invitesWithEmailResult.error)
    ? await selectInvites(inviteColumns)
    : invitesWithEmailResult

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

  const invites: ClubAdminInvite[] = ((invitesResult.data as unknown as Array<{
    id: string
    email: string
    role?: string | null
    team_id: string | null
    status: ClubAdminInvite["status"]
    created_at: string
    expires_at: string | null
    last_email_sent_at?: string | null
    email_send_count?: number | null
    last_email_error?: string | null
  }> | null) ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role === "club-admin" ? "club-admin" : "coach",
    teamId: row.team_id ?? undefined,
    // A pending invite past its expiry can no longer be accepted, so report it as expired.
    status:
      row.status === "pending" && row.expires_at && new Date(row.expires_at).getTime() < Date.now()
        ? "expired"
        : row.status,
    createdAt: row.created_at.slice(0, 10),
    expiresAt: row.expires_at ?? undefined,
    inviteUrl: `/invite/coach/${row.id}`,
    emailSentAt: row.last_email_sent_at ?? undefined,
    emailSendCount: row.email_send_count ?? 0,
    emailError: row.last_email_error ?? undefined,
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

/** Coach invite links stop working after this many days. */
export const COACH_INVITE_VALID_DAYS = 14

/**
 * Invites someone onto the staff of the club. `role` is what they become when they accept: a coach
 * (the default) or a club admin. Only a club admin can create either (row policy on coach_invites),
 * and a club admin invite is also checked and audited by the database
 * (20261010090000_club_admin_invite_role_and_member_removal.sql).
 */
export async function createCoachInvite(params: {
  email: string
  teamId?: string
  role?: "coach" | "club-admin"
}): Promise<Result<ClubAdminInvite>> {
  const clientResult = requireSupabaseClient("createCoachInvite")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const role = params.role === "club-admin" ? "club-admin" : "coach"

  // The package counts coaches. A club admin does not take a coach place.
  if (role === "coach") {
    const packageUsageResult = await getTenantPackageUsage(clientResult.client, contextResult.data.tenantId)
    if (!packageUsageResult.ok) return packageUsageResult
    if (
      packageUsageResult.data.packageDefinition &&
      packageUsageResult.data.usage.coaches >= packageUsageResult.data.packageDefinition.limits.coaches
    ) {
      return buildPackageLimitError({
        packageDefinition: packageUsageResult.data.packageDefinition,
        resourceLabel: "coaches",
      })
    }
  }

  const { data, error } = await clientResult.client
    .from("coach_invites")
    .insert({
      tenant_id: contextResult.data.tenantId,
      email: params.email.trim().toLowerCase(),
      team_id: params.teamId ?? null,
      role,
      status: "pending",
      invited_by_user_id: contextResult.data.userId,
      expires_at: new Date(Date.now() + COACH_INVITE_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id, email, team_id, status, created_at, expires_at")
    .single()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok({
    id: data.id,
    email: data.email,
    role,
    teamId: data.team_id ?? undefined,
    status: data.status,
    createdAt: data.created_at.slice(0, 10),
    expiresAt: data.expires_at ?? undefined,
    inviteUrl: `/invite/coach/${data.id}`,
  })
}

export async function acceptCoachInviteForCurrentUser(inviteId: string): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("acceptCoachInviteForCurrentUser")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client.rpc("accept_coach_invite", {
    p_invite_id: inviteId,
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export async function reviewAccountRequest(params: {
  requestId: string
  status: "approved" | "declined"
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("reviewAccountRequest")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { data, error } = await clientResult.client
    .from("account_requests")
    .update({
      status: params.status,
      reviewed_by_user_id: contextResult.data.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", params.requestId)
    .eq("tenant_id", contextResult.data.tenantId)
    .select("id")

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) return err("NOT_FOUND", "This request could not be updated. It may have been removed.")
  return ok(undefined)
}

/** Turns the errors raised by `set_tenant_member_access` into messages a club admin can act on. */
function mapMemberAccessError(error: { code?: string; message: string }): DataError {
  const message = error.message.toLowerCase()
  if (error.code === "PGRST202") {
    return {
      code: "NOT_FOUND",
      message: "Changing member access is not switched on for this workspace yet. The latest database update still needs to be applied.",
      cause: error,
    }
  }
  if (message.includes("at least one active club-admin")) {
    return { code: "CONFLICT", message: "Your club needs at least one active club admin. Make someone else a club admin first.", cause: error }
  }
  if (message.includes("your own role")) {
    return { code: "FORBIDDEN", message: "You cannot change your own role or deactivate your own account. Ask another club admin to do it.", cause: error }
  }
  if (message.includes("member not found")) {
    return { code: "NOT_FOUND", message: "This person is no longer part of your club. Refresh the page and try again.", cause: error }
  }
  if (message.includes("only active club-admin")) {
    return { code: "FORBIDDEN", message: "Only an active club admin can change member access. Your own access may have changed, so sign in again.", cause: error }
  }
  if (message.includes("role must be")) {
    return { code: "VALIDATION", message: "That role cannot be assigned here. Choose athlete, coach or club admin.", cause: error }
  }
  if (message.includes("authentication required")) {
    return { code: "UNAUTHORIZED", message: "Your session has ended. Sign in again and retry.", cause: error }
  }
  return { code: "UNKNOWN", message: error.message, cause: error }
}

/**
 * Changes a member's role and active flag through the `set_tenant_member_access` database function,
 * which enforces the rules (same club only, no self changes, never remove the last active club admin).
 * Moving someone to the athlete role also removes their coach team assignments.
 */
export async function updateProfileRoleAndStatus(params: {
  userId: string
  role: ClubAdminUser["role"]
  status: ClubAdminUser["status"]
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("updateProfileRoleAndStatus")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client.rpc("set_tenant_member_access", {
    p_user_id: params.userId,
    p_role: params.role,
    p_is_active: params.status === "active",
  })

  if (error) return { ok: false, error: mapMemberAccessError(error) }
  const row = (Array.isArray(data) ? data[0] : data) as { user_id?: string } | null
  if (!row?.user_id) return err("NOT_FOUND", "This change was not saved. Refresh the page and try again.")
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
    clientResult.client.from("teams").select("id, name, event_group, status").eq("tenant_id", contextResult.data.tenantId),
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
      status: ClubAdminReportSnapshot["teams"][number]["status"]
    }> | null) ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      eventGroup: row.event_group,
      status: row.status,
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
        "club_name, short_name, primary_color, season_year, season_start, season_end, password_set_at, onboarding_completed_at, setup_guide_dismissed_at",
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
    password_set_at: string | null
    onboarding_completed_at: string | null
    setup_guide_dismissed_at: string | null
  } | null

  return ok({
    clubName: row?.club_name ?? tenantResult.data?.name ?? "Club",
    shortName: row?.short_name ?? "CLUB",
    primaryColor: row?.primary_color ?? "#1368ff",
    seasonYear: row?.season_year ?? nowYear,
    seasonStart: row?.season_start ?? `${nowYear}-01-10`,
    seasonEnd: row?.season_end ?? `${nowYear}-10-30`,
    passwordSetAt: row?.password_set_at ?? null,
    onboardingCompletedAt: row?.onboarding_completed_at ?? null,
    setupGuideDismissedAt: row?.setup_guide_dismissed_at ?? null,
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
      primary_color: profile.primaryColor.trim() || "#1368ff",
      season_year: profile.seasonYear.trim(),
      season_start: profile.seasonStart,
      season_end: profile.seasonEnd,
    },
    { onConflict: "tenant_id" },
  )

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export async function completeClubAdminFirstAccessSetup(params: {
  password: string
  profile: ClubAdminProfileRecord
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("completeClubAdminFirstAccessSetup")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const password = params.password.trim()
  if (password.length < 8) return err("VALIDATION", "Password must be at least 8 characters.")
  if (!params.profile.clubName.trim()) return err("VALIDATION", "Club name is required.")
  if (!params.profile.shortName.trim()) return err("VALIDATION", "Short name is required.")

  const passwordResult = await clientResult.client.auth.updateUser({ password })
  if (passwordResult.error) return err("UNKNOWN", passwordResult.error.message, passwordResult.error)

  const completedAt = new Date().toISOString()
  const { error } = await clientResult.client.from("club_profiles").upsert(
    {
      tenant_id: contextResult.data.tenantId,
      club_name: params.profile.clubName.trim(),
      short_name: params.profile.shortName.trim(),
      primary_color: params.profile.primaryColor.trim() || "#1368ff",
      season_year: params.profile.seasonYear.trim(),
      season_start: params.profile.seasonStart,
      season_end: params.profile.seasonEnd,
      password_set_at: completedAt,
      onboarding_completed_at: completedAt,
      onboarding_completed_by_user_id: contextResult.data.userId,
      setup_guide_dismissed_at: null,
    },
    { onConflict: "tenant_id" },
  )

  if (error) return { ok: false, error: mapPostgrestError(error) }

  const auditResult = await insertAuditEvent({
    action: "first_access_setup_complete",
    target: "club-admin-onboarding",
    detail: params.profile.clubName.trim(),
  })
  if (!auditResult.ok) return auditResult

  return ok(undefined)
}

export async function setClubAdminSetupGuideDismissed(dismissed: boolean): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("setClubAdminSetupGuideDismissed")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { error } = await clientResult.client
    .from("club_profiles")
    .update({
      setup_guide_dismissed_at: dismissed ? new Date().toISOString() : null,
    })
    .eq("tenant_id", contextResult.data.tenantId)

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

  const { data: authSession } = await clientResult.client.auth.getSession()
  const currentUser = authSession.session?.user
  const currentUserEmail = currentUser?.email?.trim().toLowerCase()

  const [teamsResult, membershipsResult] = await Promise.all([
    clientResult.client
      .from("teams")
      .select("*")
      .eq("tenant_id", contextResult.data.tenantId)
      .order("created_at", { ascending: false }),
    clientResult.client
      .from("team_coaches")
      .select("team_id, user_id, is_primary, created_at")
      .eq("tenant_id", contextResult.data.tenantId),
  ])

  if (teamsResult.error) return { ok: false, error: mapPostgrestError(teamsResult.error) }
  if (membershipsResult.error) return { ok: false, error: mapPostgrestError(membershipsResult.error) }

  const memberships =
    ((membershipsResult.data as Array<{
      team_id: string
      user_id: string
      is_primary: boolean
      created_at: string
    }> | null) ?? [])

  const assignedTeamIds = new Set(
    memberships
      .filter((row) => row.user_id === contextResult.data.userId)
      .map((row) => row.team_id),
  )

  const leadMembershipByTeamId = new Map<
    string,
    { userId: string; isPrimary: boolean; createdAt: string }
  >()
  for (const membership of memberships) {
    if (!membership.is_primary) continue
    const existing = leadMembershipByTeamId.get(membership.team_id)
    if (
      !existing ||
      membership.created_at < existing.createdAt
    ) {
      leadMembershipByTeamId.set(membership.team_id, {
        userId: membership.user_id,
        isPrimary: membership.is_primary,
        createdAt: membership.created_at,
      })
    }
  }

  const leadCoachUserIds = Array.from(new Set(Array.from(leadMembershipByTeamId.values()).map((row) => row.userId)))
  const leadProfilesByUserId = new Map<string, { name: string | null }>()

  if (leadCoachUserIds.length > 0) {
    const profilesResult = await clientResult.client
      .from("profiles")
      .select("user_id, display_name")
      .eq("tenant_id", contextResult.data.tenantId)
      .in("user_id", leadCoachUserIds)

    if (profilesResult.error) return { ok: false, error: mapPostgrestError(profilesResult.error) }

    for (const row of (profilesResult.data as Array<{ user_id: string; display_name: string | null }> | null) ?? []) {
      leadProfilesByUserId.set(row.user_id, { name: row.display_name })
    }
  }

  return ok(
    ((teamsResult.data as Array<{
      id: string
      name: string
      event_group: string | null
      status: ClubAdminTeamRecord["status"]
      assistants_can_message?: boolean | null
      assistants_see_health?: boolean | null
    }> | null) ?? []).map((row) => ({
      ...(function () {
        const leadMembership = leadMembershipByTeamId.get(row.id)
        if (!leadMembership) {
          return {
            leadCoachUserId: undefined,
            leadCoachLabel: undefined,
          }
        }

        const isSelf = leadMembership.userId === contextResult.data.userId
        const leadProfile = leadProfilesByUserId.get(leadMembership.userId)
        const leadCoachLabel = isSelf
          ? `${leadProfile?.name || "You"}${currentUserEmail ? ` (${currentUserEmail})` : ""}`
          : leadProfile?.name || "Assigned coach"

        return {
          leadCoachUserId: leadMembership.userId,
          leadCoachLabel,
        }
      })(),
      id: row.id,
      name: row.name,
      eventGroup: row.event_group,
      status: row.status,
      currentUserAssignedAsCoach: assignedTeamIds.has(row.id),
      assistantsCanMessage: row.assistants_can_message === true,
      assistantsSeeHealth: row.assistants_see_health === true,
    })),
  )
}

export async function getCurrentClubAdminActivationState(): Promise<Result<ClubAdminActivationState>> {
  const clientResult = requireSupabaseClient("getCurrentClubAdminActivationState")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const [activationResult, requestResult, tenantResult] = await Promise.all([
    clientResult.client.rpc("get_current_club_admin_activation_state"),
    clientResult.client
      .from("tenant_provision_requests")
      .select("requested_plan, organization_name")
      .eq("provisioned_tenant_id", contextResult.data.tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    clientResult.client.from("tenants").select("name").eq("id", contextResult.data.tenantId).maybeSingle(),
  ])

  if (activationResult.error) return err("UNKNOWN", activationResult.error.message, activationResult.error)
  if (requestResult.error) return { ok: false, error: mapPostgrestError(requestResult.error) }
  if (tenantResult.error) return { ok: false, error: mapPostgrestError(tenantResult.error) }

  const activationRow = (Array.isArray(activationResult.data) ? activationResult.data[0] : activationResult.data) as
    | {
        tenant_id: string
        lifecycle_status: string | null
        billing_status: string | null
        billing_provider: string | null
        billing_contact_name: string | null
        billing_contact_email: string | null
        billing_cycle: "monthly" | "annual" | null
        onboarding_step: string | null
      }
    | null

  if (!activationRow?.tenant_id) return err("NOT_FOUND", "No activation state was found for the current club-admin account.")

  return ok({
    tenantId: activationRow.tenant_id,
    lifecycleStatus: activationRow.lifecycle_status,
    billingStatus: activationRow.billing_status,
    billingProvider: activationRow.billing_provider,
    billingContactName: activationRow.billing_contact_name,
    billingContactEmail: activationRow.billing_contact_email,
    billingCycle: activationRow.billing_cycle,
    requestedPlan: (requestResult.data?.requested_plan as ClubAdminActivationState["requestedPlan"]) ?? null,
    organizationName: requestResult.data?.organization_name ?? tenantResult.data?.name ?? null,
    onboardingStep: activationRow.onboarding_step,
  })
}

export async function completeCurrentClubAdminMockBillingSetup(params: {
  billingContactName: string
  billingContactEmail: string
  billingCycle: "monthly" | "annual"
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("completeCurrentClubAdminMockBillingSetup")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client.rpc("complete_current_club_admin_mock_billing_setup", {
    p_billing_contact_name: params.billingContactName.trim(),
    p_billing_contact_email: params.billingContactEmail.trim().toLowerCase(),
    p_billing_cycle: params.billingCycle,
  })

  if (error) return err("UNKNOWN", error.message, error)
  return ok(undefined)
}

export async function updateCurrentClubAdminOnboardingStep(step: "club_profile" | "branding" | "first_team" | "coach_access" | "review" | "complete"): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("updateCurrentClubAdminOnboardingStep")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client.rpc("update_current_club_admin_onboarding_step", {
    p_step: step,
  })

  if (error) return err("UNKNOWN", error.message, error)
  return ok(undefined)
}

export async function getClubAdminPackageUpgradeRequests(): Promise<Result<ClubAdminPackageUpgradeRequest[]>> {
  const clientResult = requireSupabaseClient("getClubAdminPackageUpgradeRequests")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { data, error } = await clientResult.client
    .from("tenant_package_upgrade_requests")
    .select("id, tenant_id, current_package, requested_package, reason, status, review_notes, reviewed_at, created_at")
    .eq("tenant_id", contextResult.data.tenantId)
    .order("created_at", { ascending: false })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
      id: string
      tenant_id: string
      current_package: ClubAdminPackageUpgradeRequest["currentPackage"]
      requested_package: ClubAdminPackageUpgradeRequest["requestedPackage"]
      reason: string | null
      status: ClubAdminPackageUpgradeRequest["status"]
      review_notes: string | null
      reviewed_at: string | null
      created_at: string
    }> | null) ?? []).map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      currentPackage: row.current_package,
      requestedPackage: row.requested_package,
      reason: row.reason,
      status: row.status,
      reviewNotes: row.review_notes,
      reviewedAt: row.reviewed_at,
      createdAt: row.created_at,
    })),
  )
}

export async function submitClubAdminPackageUpgradeRequest(params: {
  requestedPackage: "starter" | "pro" | "enterprise"
  reason?: string
}): Promise<Result<string>> {
  const clientResult = requireSupabaseClient("submitClubAdminPackageUpgradeRequest")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client.rpc("submit_tenant_package_upgrade_request", {
    p_requested_package: params.requestedPackage,
    p_reason: params.reason?.trim() || null,
  })

  if (error) return err("UNKNOWN", error.message, error)
  if (!data) return err("UNKNOWN", "Package upgrade request did not return an id.")
  return ok(data as string)
}

export async function getClubAdminAssignableCoachOptions(): Promise<Result<ClubAdminAssignableCoachOption[]>> {
  const clientResult = requireSupabaseClient("getClubAdminAssignableCoachOptions")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const currentUser = authSession.session?.user
  if (!currentUser) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data, error } = await clientResult.client
    .from("profiles")
    .select("user_id, role, display_name, is_active")
    .eq("tenant_id", contextResult.data.tenantId)
    .eq("is_active", true)
    .in("role", ["club-admin", "coach"])
    .order("display_name", { ascending: true })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  const rows =
    ((data as Array<{
      user_id: string
      role: "club-admin" | "coach"
      display_name: string | null
      is_active: boolean
    }> | null) ?? [])

  const currentUserEmail = currentUser.email?.trim().toLowerCase()
  const selfRow = rows.find((row) => row.user_id === contextResult.data.userId)
  const otherCoachOptions = rows
    .filter((row) => row.user_id !== contextResult.data.userId && row.role === "coach")
    .map((row) => ({
      userId: row.user_id,
      name: row.display_name || "Coach",
      email: undefined,
      label: row.display_name || "Coach",
      isSelf: false,
    }))

  const selfName = selfRow?.display_name || currentUser.user_metadata?.display_name || currentUser.email || "You"
  return ok([
    ...otherCoachOptions,
    {
      userId: contextResult.data.userId,
      name: selfName,
      email: currentUserEmail,
      label: `Assign self${currentUserEmail ? ` (${currentUserEmail})` : ""}`,
      isSelf: true,
    },
  ])
}

export async function createClubAdminTeam(params: {
  name: string
  eventGroup?: string | null
  leadCoachUserId?: string | null
  leadCoachLabel?: string | null
}): Promise<Result<ClubAdminTeamRecord>> {
  const clientResult = requireSupabaseClient("createClubAdminTeam")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const teamName = params.name.trim()
  if (!teamName) return err("VALIDATION", "Team name is required.")

  const packageUsageResult = await getTenantPackageUsage(clientResult.client, contextResult.data.tenantId)
  if (!packageUsageResult.ok) return packageUsageResult
  if (
    packageUsageResult.data.packageDefinition &&
    packageUsageResult.data.usage.teams >= packageUsageResult.data.packageDefinition.limits.teams
  ) {
    return buildPackageLimitError({
      packageDefinition: packageUsageResult.data.packageDefinition,
      resourceLabel: "teams",
    })
  }

  const { data, error } = await clientResult.client
    .from("teams")
    .insert({
      tenant_id: contextResult.data.tenantId,
      name: teamName,
      event_group: params.eventGroup ?? null,
      status: "active",
      is_archived: false,
    })
    .select("id, name, event_group, status")
    .single()

  if (error) return { ok: false, error: mapPostgrestError(error) }

  const assignedLeadCoachUserId = params.leadCoachUserId?.trim() || null
  if (assignedLeadCoachUserId) {
    const { error: membershipError } = await clientResult.client.from("team_coaches").upsert(
      {
        tenant_id: contextResult.data.tenantId,
        team_id: data.id,
        user_id: assignedLeadCoachUserId,
        is_primary: true,
        created_by_user_id: contextResult.data.userId,
      },
      { onConflict: "team_id,user_id" },
    )

    if (membershipError) return { ok: false, error: mapPostgrestError(membershipError) }
  }

  return ok({
    id: data.id,
    name: data.name,
    eventGroup: data.event_group,
    status: data.status,
    leadCoachUserId: assignedLeadCoachUserId ?? undefined,
    leadCoachLabel: params.leadCoachLabel ?? undefined,
    currentUserAssignedAsCoach: assignedLeadCoachUserId === contextResult.data.userId,
  })
}

export async function updateClubAdminTeam(params: {
  teamId: string
  name: string
  eventGroup?: string | null
  status: ClubAdminTeamRecord["status"]
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
      status: params.status,
      is_archived: params.status === "archived",
      archived_at: params.status === "archived" ? new Date().toISOString() : null,
    })
    .eq("id", params.teamId)
    .eq("tenant_id", contextResult.data.tenantId)

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export async function setClubAdminTeamLeadCoach(params: {
  teamId: string
  leadCoachUserId?: string | null
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("setClubAdminTeamLeadCoach")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const teamId = params.teamId.trim()
  if (!teamId) return err("VALIDATION", "Team id is required.")

  const clearExistingResult = await clientResult.client
    .from("team_coaches")
    .update({ is_primary: false })
    .eq("tenant_id", contextResult.data.tenantId)
    .eq("team_id", teamId)

  if (clearExistingResult.error) {
    return { ok: false, error: mapPostgrestError(clearExistingResult.error) }
  }

  const leadCoachUserId = params.leadCoachUserId?.trim() || null
  if (!leadCoachUserId) return ok(undefined)

  const { error } = await clientResult.client.from("team_coaches").upsert(
    {
      tenant_id: contextResult.data.tenantId,
      team_id: teamId,
      user_id: leadCoachUserId,
      is_primary: true,
      created_by_user_id: contextResult.data.userId,
    },
    { onConflict: "team_id,user_id" },
  )

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
      status: params.archived ? "archived" : "active",
      is_archived: params.archived,
      archived_at: params.archived ? new Date().toISOString() : null,
    })
    .eq("id", params.teamId)
    .eq("tenant_id", contextResult.data.tenantId)

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

/* ---------------------------------------------------------------------------
   People and teams screens (club admin)
--------------------------------------------------------------------------- */

/** Cancels a pending coach invite so its link stops working. */
export async function revokeCoachInvite(inviteId: string): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("revokeCoachInvite")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { data, error } = await clientResult.client
    .from("coach_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("tenant_id", contextResult.data.tenantId)
    .eq("status", "pending")
    .select("id")

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) return err("NOT_FOUND", "This invite is no longer pending.")
  return ok(undefined)
}

export type ClubAdminPeopleDirectory = {
  currentUserId: string
  /** Every team in the club, including draft and archived ones, for labels. */
  teams: ClubAdminTeamOption[]
  /** Keyed by user id. Email is the account email when the database can supply it, otherwise own account and accepted invites only. */
  members: Record<string, { email?: string; teamIds: string[] }>
}

/**
 * Team assignments and emails for the people table. Profiles do not store an email, so emails come
 * from the `get_tenant_member_emails` database function, with the signed-in session and accepted
 * coach and athlete invites as the fallback when that function is not available.
 */
export async function getClubAdminPeopleDirectory(): Promise<Result<ClubAdminPeopleDirectory>> {
  const clientResult = requireSupabaseClient("getClubAdminPeopleDirectory")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult
  const { tenantId, userId } = contextResult.data

  const { data: authSession } = await clientResult.client.auth.getSession()
  const currentUserEmail = authSession.session?.user.email?.trim().toLowerCase()

  const [teamsResult, coachesResult, athletesResult, coachInvitesResult, athleteInvitesResult] = await Promise.all([
    clientResult.client.from("teams").select("id, name").eq("tenant_id", tenantId),
    clientResult.client.from("team_coaches").select("team_id, user_id").eq("tenant_id", tenantId),
    clientResult.client.from("athletes").select("user_id, team_id").eq("tenant_id", tenantId).not("user_id", "is", null),
    clientResult.client.from("coach_invites").select("email, metadata").eq("tenant_id", tenantId).eq("status", "accepted"),
    clientResult.client
      .from("athlete_invites")
      .select("email, accepted_by_user_id")
      .eq("tenant_id", tenantId)
      .eq("status", "accepted"),
  ])

  if (teamsResult.error) return { ok: false, error: mapPostgrestError(teamsResult.error) }
  if (coachesResult.error) return { ok: false, error: mapPostgrestError(coachesResult.error) }
  if (athletesResult.error) return { ok: false, error: mapPostgrestError(athletesResult.error) }
  if (coachInvitesResult.error) return { ok: false, error: mapPostgrestError(coachInvitesResult.error) }
  if (athleteInvitesResult.error) return { ok: false, error: mapPostgrestError(athleteInvitesResult.error) }

  const members: ClubAdminPeopleDirectory["members"] = {}
  const entry = (id: string) => (members[id] ??= { teamIds: [] })
  const addTeam = (id: string, teamId: string | null) => {
    if (!teamId) return
    const member = entry(id)
    if (!member.teamIds.includes(teamId)) member.teamIds.push(teamId)
  }

  for (const row of (coachesResult.data as Array<{ team_id: string; user_id: string }> | null) ?? []) {
    addTeam(row.user_id, row.team_id)
  }
  for (const row of (athletesResult.data as Array<{ user_id: string | null; team_id: string | null }> | null) ?? []) {
    if (row.user_id) addTeam(row.user_id, row.team_id)
  }
  for (const row of (coachInvitesResult.data as Array<{ email: string; metadata: Record<string, unknown> | null }> | null) ?? []) {
    const acceptedUserId = row.metadata?.accepted_user_id
    if (typeof acceptedUserId === "string" && row.email) entry(acceptedUserId).email = row.email.toLowerCase()
  }
  for (const row of (athleteInvitesResult.data as Array<{ email: string | null; accepted_by_user_id: string | null }> | null) ?? []) {
    if (row.accepted_by_user_id && row.email) entry(row.accepted_by_user_id).email = row.email.toLowerCase()
  }
  if (currentUserEmail) entry(userId).email = currentUserEmail

  // Account emails for everyone in the club, from the `get_tenant_member_emails` database function.
  // Optional: if the function is missing or fails, the invite based emails above still show.
  try {
    const emailsResult = await clientResult.client.rpc("get_tenant_member_emails")
    if (!emailsResult.error) {
      for (const row of (emailsResult.data as Array<{ user_id: string | null; email: string | null }> | null) ?? []) {
        if (row.user_id && row.email) entry(row.user_id).email = row.email.toLowerCase()
      }
    }
  } catch {
    // Keep the emails already collected.
  }

  return ok({
    currentUserId: userId,
    teams: ((teamsResult.data as Array<{ id: string; name: string }> | null) ?? []).map((row) => ({ id: row.id, name: row.name })),
    members,
  })
}

export type ClubAdminTeamMembers = {
  coaches: Array<{ userId: string; name: string; isPrimary: boolean; isSelf: boolean; role: TeamCoachRole; active: boolean }>
  athletes: Array<{ id: string; name: string; primaryEvent: string | null; hasLogin: boolean }>
}

/** Coaches and active athletes on every team in the club (any status), keyed by team id. */
export async function getClubAdminTeamMembers(): Promise<Result<Record<string, ClubAdminTeamMembers>>> {
  const clientResult = requireSupabaseClient("getClubAdminTeamMembers")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult
  const { tenantId, userId } = contextResult.data

  const [coachesResult, profilesResult, athletesResult] = await Promise.all([
    clientResult.client
      .from("team_coaches")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
    clientResult.client.from("profiles").select("user_id, display_name, is_active").eq("tenant_id", tenantId),
    clientResult.client
      .from("athletes")
      .select("id, team_id, user_id, first_name, last_name, primary_event")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .not("team_id", "is", null)
      .order("first_name", { ascending: true }),
  ])

  if (coachesResult.error) return { ok: false, error: mapPostgrestError(coachesResult.error) }
  if (profilesResult.error) return { ok: false, error: mapPostgrestError(profilesResult.error) }
  if (athletesResult.error) return { ok: false, error: mapPostgrestError(athletesResult.error) }

  const nameByUserId = new Map<string, string>()
  const inactiveUserIds = new Set<string>()
  for (const row of (profilesResult.data as Array<{ user_id: string; display_name: string | null; is_active: boolean | null }> | null) ?? []) {
    if (row.display_name) nameByUserId.set(row.user_id, row.display_name)
    if (row.is_active === false) inactiveUserIds.add(row.user_id)
  }

  const byTeam: Record<string, ClubAdminTeamMembers> = {}
  const entry = (teamId: string) => (byTeam[teamId] ??= { coaches: [], athletes: [] })

  for (const row of (coachesResult.data as Array<{ team_id: string; user_id: string; is_primary: boolean; role?: string | null }> | null) ?? []) {
    const team = entry(row.team_id)
    // Only the earliest primary row counts as lead, matching getClubAdminTeamsSnapshot.
    const isPrimary = row.is_primary && !team.coaches.some((coach) => coach.isPrimary)
    const stored = normaliseTeamCoachRole(row.role, row.is_primary)
    team.coaches.push({
      userId: row.user_id,
      name: nameByUserId.get(row.user_id) ?? (row.user_id === userId ? "You" : "Coach"),
      isPrimary,
      isSelf: row.user_id === userId,
      role: stored === "lead" && !isPrimary ? "coach" : stored,
      active: !inactiveUserIds.has(row.user_id),
    })
  }

  for (const row of (athletesResult.data as Array<{
    id: string
    team_id: string
    user_id: string | null
    first_name: string
    last_name: string
    primary_event: string | null
  }> | null) ?? []) {
    entry(row.team_id).athletes.push({
      id: row.id,
      name: `${row.first_name} ${row.last_name}`.trim(),
      primaryEvent: row.primary_event,
      hasLogin: row.user_id !== null,
    })
  }

  return ok(byTeam)
}

/**
 * Sets the full coaching staff for a team: one optional lead plus any number of additional coaches.
 * Coaches not listed are taken off the team.
 */
export async function setClubAdminTeamCoaches(params: {
  teamId: string
  leadCoachUserId?: string | null
  coachUserIds: string[]
  /** Role of each additional coach by user id. Missing means coach. The lead is always lead. */
  roles?: Record<string, "coach" | "assistant">
}): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("setClubAdminTeamCoaches")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult
  const { tenantId, userId } = contextResult.data

  const teamId = params.teamId.trim()
  if (!teamId) return err("VALIDATION", "Team id is required.")

  const leadCoachUserId = params.leadCoachUserId?.trim() || null
  const desired = new Set(params.coachUserIds.map((id) => id.trim()).filter(Boolean))
  if (leadCoachUserId) desired.add(leadCoachUserId)

  const existingResult = await clientResult.client
    .from("team_coaches")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("team_id", teamId)

  if (existingResult.error) return { ok: false, error: mapPostgrestError(existingResult.error) }

  const toRemove = ((existingResult.data as Array<{ user_id: string }> | null) ?? [])
    .map((row) => row.user_id)
    .filter((id) => !desired.has(id))

  if (toRemove.length > 0) {
    const removeResult = await clientResult.client
      .from("team_coaches")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("team_id", teamId)
      .in("user_id", toRemove)

    if (removeResult.error) return { ok: false, error: mapPostgrestError(removeResult.error) }
  }

  if (desired.size === 0) return ok(undefined)

  const { data, error } = await clientResult.client
    .from("team_coaches")
    .upsert(
      Array.from(desired).map((coachUserId) => ({
        tenant_id: tenantId,
        team_id: teamId,
        user_id: coachUserId,
        is_primary: coachUserId === leadCoachUserId,
        // Only sent when the screen chose roles, so a database without the role column still saves.
        ...(params.roles ? { role: coachUserId === leadCoachUserId ? "lead" : (params.roles[coachUserId] ?? "coach") } : {}),
        created_by_user_id: userId,
      })),
      { onConflict: "team_id,user_id" },
    )
    .select("user_id")

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length < desired.size) return err("UNKNOWN", "Not every coach assignment was saved. Reload and check the team.")
  kickNotificationEmails()
  return ok(undefined)
}

/** Takes one coach off a team. Their account and other teams are untouched. */
export async function removeClubAdminTeamCoach(params: { teamId: string; userId: string }): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("removeClubAdminTeamCoach")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { data, error } = await clientResult.client
    .from("team_coaches")
    .delete()
    .eq("tenant_id", contextResult.data.tenantId)
    .eq("team_id", params.teamId)
    .eq("user_id", params.userId)
    .select("user_id")

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) return err("NOT_FOUND", "This coach is no longer on the team.")
  kickNotificationEmails()
  return ok(undefined)
}

// ---------------------------------------------------------------------------
// Club admin reports, activity log, package usage and billing contact.
// Read-only helpers for the reports, audit and billing screens, plus the
// billing contact update. Appended; nothing above depends on these.
// ---------------------------------------------------------------------------

const CLUB_REPORT_PAGE_SIZE = 1000
const CLUB_REPORT_MAX_PAGES = 20
export const CLUB_REPORT_ROW_CAP = 1000
export const CLUB_REPORT_WINDOW_DAYS = 28

type ClubPageResult = { data: unknown; error: Parameters<typeof mapPostgrestError>[0] | null }

/** YYYY-MM-DD for the user's own calendar day (never UTC). */
function clubLocalIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/** Pages through a query 1,000 rows at a time so counts are not cut off by the API row limit. */
async function fetchAllClubRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<ClubPageResult>,
): Promise<Result<{ rows: T[]; complete: boolean }>> {
  const rows: T[] = []
  for (let page = 0; page < CLUB_REPORT_MAX_PAGES; page += 1) {
    const from = page * CLUB_REPORT_PAGE_SIZE
    const { data, error } = await buildPage(from, from + CLUB_REPORT_PAGE_SIZE - 1)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    const batch = (data as T[] | null) ?? []
    rows.push(...batch)
    if (batch.length < CLUB_REPORT_PAGE_SIZE) return ok({ rows, complete: true })
  }
  return ok({ rows, complete: false })
}

export type ClubAdminPerformanceReport = {
  /** Days counted for adherence and current readiness, ending today (local). */
  windowDays: number
  teams: Array<{
    id: string
    name: string
    eventGroup: string | null
    status: "draft" | "active" | "archived"
    leadCoach: string | null
  }>
  athletes: Array<{
    id: string
    teamId: string | null
    name: string
    eventGroup: string | null
    primaryEvent: string | null
    readiness: "green" | "yellow" | "red" | null
    /** Sessions that were due in the window up to today (skipped and excused ones left out), and how many of those were completed. */
    sessionsPlanned: number
    sessionsDone: number
    /** Null when no sessions were due in the window. */
    adherence: number | null
    /** Date (YYYY-MM-DD) of the latest check-in among the loaded rows. */
    lastCheckIn: string | null
  }>
  prs: Array<{
    id: string
    athleteId: string
    event: string
    category: string
    bestValue: string
    previousValue: string | null
    measuredOn: string
    legal: boolean
    wind: string | null
  }>
  wellness: Array<{
    id: string
    athleteId: string
    date: string
    sleep: number
    soreness: number
    fatigue: number
    mood: number
    stress: number
    readiness: "green" | "yellow" | "red"
    notes: string | null
  }>
  /** Rows in the database for the club. Greater than the loaded rows when the cap applied. */
  prTotal: number
  wellnessTotal: number
  /** False if the session history was too large to count in full. */
  adherenceComplete: boolean
}

export async function getClubAdminPerformanceReport(): Promise<Result<ClubAdminPerformanceReport>> {
  const clientResult = requireSupabaseClient("getClubAdminPerformanceReport")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const client = clientResult.client
  const tenantId = contextResult.data.tenantId
  const today = new Date()
  const since = new Date(today)
  since.setDate(since.getDate() - (CLUB_REPORT_WINDOW_DAYS - 1))
  const todayIso = clubLocalIsoDate(today)
  const sinceIso = clubLocalIsoDate(since)

  const [teamsResult, athletesResult, coachLinksResult, prsResult, wellnessResult, sessionsResult, completionsResult] =
    await Promise.all([
      client.from("teams").select("id, name, event_group, status").eq("tenant_id", tenantId).neq("status", "archived").order("name"),
      fetchAllClubRows<{
        id: string
        team_id: string | null
        first_name: string
        last_name: string
        event_group: string | null
        primary_event: string | null
        readiness: "green" | "yellow" | "red" | null
      }>((from, to) =>
        client
          .from("athletes")
          .select("id, team_id, first_name, last_name, event_group, primary_event, readiness")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("id")
          .range(from, to),
      ),
      client.from("team_coaches").select("team_id, user_id, is_primary, created_at").eq("tenant_id", tenantId).eq("is_primary", true),
      client
        .from("pr_records")
        .select("id, athlete_id, event, category, best_value, previous_value, measured_on, is_legal, wind", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("measured_on", { ascending: false })
        .order("id")
        .limit(CLUB_REPORT_ROW_CAP),
      client
        .from("wellness_entries")
        .select("id, athlete_id, entry_date, sleep_hours, soreness, fatigue, mood, stress, notes, readiness", { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("entry_date", { ascending: false })
        .order("id")
        .limit(CLUB_REPORT_ROW_CAP),
      fetchAllClubRows<{ id: string; athlete_id: string; scheduled_for: string; status: string; origin: string | null }>((from, to) =>
        client
          .from("sessions")
          .select("id, athlete_id, scheduled_for, status, origin")
          .eq("tenant_id", tenantId)
          .gte("scheduled_for", sinceIso)
          .lte("scheduled_for", todayIso)
          .order("id")
          .range(from, to),
      ),
      fetchAllClubRows<{ session_id: string; athlete_id: string }>((from, to) =>
        client
          .from("session_completions")
          .select("session_id, athlete_id")
          .eq("tenant_id", tenantId)
          .gte("completion_date", sinceIso)
          .order("id")
          .range(from, to),
      ),
    ])

  if (teamsResult.error) return { ok: false, error: mapPostgrestError(teamsResult.error) }
  if (!athletesResult.ok) return athletesResult
  if (coachLinksResult.error) return { ok: false, error: mapPostgrestError(coachLinksResult.error) }
  if (prsResult.error) return { ok: false, error: mapPostgrestError(prsResult.error) }
  if (wellnessResult.error) return { ok: false, error: mapPostgrestError(wellnessResult.error) }
  if (!sessionsResult.ok) return sessionsResult
  if (!completionsResult.ok) return completionsResult

  const leadByTeamId = new Map<string, { userId: string; createdAt: string }>()
  for (const link of (coachLinksResult.data as Array<{ team_id: string; user_id: string; created_at: string }> | null) ?? []) {
    const existing = leadByTeamId.get(link.team_id)
    if (!existing || link.created_at < existing.createdAt) {
      leadByTeamId.set(link.team_id, { userId: link.user_id, createdAt: link.created_at })
    }
  }

  const leadUserIds = Array.from(new Set(Array.from(leadByTeamId.values()).map((lead) => lead.userId)))
  const coachNameByUserId = new Map<string, string>()
  if (leadUserIds.length > 0) {
    const profilesResult = await client
      .from("profiles")
      .select("user_id, display_name")
      .eq("tenant_id", tenantId)
      .in("user_id", leadUserIds)
    if (profilesResult.error) return { ok: false, error: mapPostgrestError(profilesResult.error) }
    for (const row of (profilesResult.data as Array<{ user_id: string; display_name: string | null }> | null) ?? []) {
      if (row.display_name) coachNameByUserId.set(row.user_id, row.display_name)
    }
  }

  const activeAthleteIds = new Set(athletesResult.data.rows.map((row) => row.id))

  const wellness = ((wellnessResult.data as Array<{
    id: string
    athlete_id: string
    entry_date: string
    sleep_hours: number
    soreness: number
    fatigue: number
    mood: number
    stress: number
    notes: string | null
    readiness: "green" | "yellow" | "red"
  }> | null) ?? [])
    .filter((row) => activeAthleteIds.has(row.athlete_id))
    .map((row) => ({
      id: row.id,
      athleteId: row.athlete_id,
      date: row.entry_date,
      sleep: Number(row.sleep_hours),
      soreness: row.soreness,
      fatigue: row.fatigue,
      mood: row.mood,
      stress: row.stress,
      readiness: row.readiness,
      notes: row.notes,
    }))

  // Rows arrive newest first, so the first one seen per athlete is their latest check-in.
  const latestCheckInByAthlete = new Map<string, { date: string; readiness: "green" | "yellow" | "red" }>()
  for (const entry of wellness) {
    if (!latestCheckInByAthlete.has(entry.athleteId)) {
      latestCheckInByAthlete.set(entry.athleteId, { date: entry.date, readiness: entry.readiness })
    }
  }

  // Adherence is done over due and not excused (see src/lib/data/session/adherence.ts).
  const availabilityResult = await listAthleteAvailability([...activeAthleteIds], { from: sinceIso })
  if (!availabilityResult.ok) console.warn("[club-admin] could not read athlete availability", availabilityResult.error)
  const adherenceByAthlete = adherenceCounts(
    sessionsResult.data.rows.map((row): AdherenceSession => ({ id: row.id, athleteId: row.athlete_id, scheduledFor: row.scheduled_for, status: row.status, origin: row.origin })),
    new Set(completionsResult.data.rows.map((row) => row.session_id)),
    availabilityResult.ok ? availabilityResult.data : [],
    { from: sinceIso, to: todayIso },
  )

  return ok({
    windowDays: CLUB_REPORT_WINDOW_DAYS,
    teams: ((teamsResult.data as Array<{
      id: string
      name: string
      event_group: string | null
      status: "draft" | "active" | "archived"
    }> | null) ?? []).map((row) => {
      const lead = leadByTeamId.get(row.id)
      return {
        id: row.id,
        name: row.name,
        eventGroup: row.event_group,
        status: row.status,
        leadCoach: lead ? coachNameByUserId.get(lead.userId) ?? null : null,
      }
    }),
    athletes: athletesResult.data.rows.map((row) => {
      const counted = adherenceByAthlete.get(row.id)
      const sessionsPlanned = counted?.due ?? 0
      const sessionsDone = counted?.done ?? 0
      const latest = latestCheckInByAthlete.get(row.id)
      return {
        id: row.id,
        teamId: row.team_id,
        name: `${row.first_name} ${row.last_name}`.trim(),
        eventGroup: row.event_group,
        primaryEvent: row.primary_event,
        readiness: latest && latest.date >= sinceIso ? latest.readiness : row.readiness,
        sessionsPlanned,
        sessionsDone,
        adherence: adherencePercent(counted),
        lastCheckIn: latest?.date ?? null,
      }
    }),
    prs: ((prsResult.data as Array<{
      id: string
      athlete_id: string
      event: string
      category: string
      best_value: string
      previous_value: string | null
      measured_on: string
      is_legal: boolean
      wind: string | null
    }> | null) ?? [])
      .filter((row) => activeAthleteIds.has(row.athlete_id))
      .map((row) => ({
        id: row.id,
        athleteId: row.athlete_id,
        event: row.event,
        category: row.category,
        bestValue: row.best_value,
        previousValue: row.previous_value,
        measuredOn: row.measured_on,
        legal: row.is_legal,
        wind: row.wind,
      })),
    wellness,
    prTotal: prsResult.count ?? prsResult.data?.length ?? 0,
    wellnessTotal: wellnessResult.count ?? wellnessResult.data?.length ?? 0,
    adherenceComplete: sessionsResult.data.complete && completionsResult.data.complete && athletesResult.data.complete,
  })
}

export type ClubAdminAuditLogEntry = {
  id: string
  action: string
  actorUserId: string | null
  actorRole: string | null
  /** Display name from the actor's profile, when one exists. */
  actorName: string | null
  target: string
  detail: string | null
  /** ISO timestamp. Format it in the viewer's local time. */
  at: string
}

export const CLUB_AUDIT_LOG_CAP = 500

export async function getClubAdminAuditLog(): Promise<Result<{ entries: ClubAdminAuditLogEntry[]; total: number }>> {
  const clientResult = requireSupabaseClient("getClubAdminAuditLog")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const { data, error, count } = await clientResult.client
    .from("audit_events")
    .select("id, action, actor_role, actor_user_id, target, detail, created_at", { count: "exact" })
    .eq("tenant_id", contextResult.data.tenantId)
    .order("created_at", { ascending: false })
    .limit(CLUB_AUDIT_LOG_CAP)

  if (error) return { ok: false, error: mapPostgrestError(error) }

  const rows =
    (data as Array<{
      id: string
      action: string
      actor_role: string | null
      actor_user_id: string | null
      target: string
      detail: string | null
      created_at: string
    }> | null) ?? []

  const actorIds = Array.from(new Set(rows.map((row) => row.actor_user_id).filter((id): id is string => Boolean(id))))
  const nameByUserId = new Map<string, string>()
  if (actorIds.length > 0) {
    // Names are a nicety: if profiles cannot be read the log still shows roles.
    const profilesResult = await clientResult.client
      .from("profiles")
      .select("user_id, display_name")
      .eq("tenant_id", contextResult.data.tenantId)
      .in("user_id", actorIds)
    if (!profilesResult.error) {
      for (const row of (profilesResult.data as Array<{ user_id: string; display_name: string | null }> | null) ?? []) {
        if (row.display_name) nameByUserId.set(row.user_id, row.display_name)
      }
    }
  }

  return ok({
    entries: rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorUserId: row.actor_user_id,
      actorRole: row.actor_role,
      actorName: row.actor_user_id ? nameByUserId.get(row.actor_user_id) ?? null : null,
      target: row.target,
      detail: row.detail,
      at: row.created_at,
    })),
    total: count ?? rows.length,
  })
}

export type ClubAdminPackageUsage = {
  /** The package the club is held to (from its provisioning record). Null when none is on record. */
  packageId: "starter" | "pro" | "enterprise" | null
  usage: { teams: number; coaches: number; athletes: number }
}

/** Same counts the package limits are enforced against when adding teams, coaches and athletes. */
export async function getClubAdminPackageUsage(): Promise<Result<ClubAdminPackageUsage>> {
  const clientResult = requireSupabaseClient("getClubAdminPackageUsage")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentClubAdminContext(clientResult.client)
  if (!contextResult.ok) return contextResult

  const usageResult = await getTenantPackageUsage(clientResult.client, contextResult.data.tenantId)
  if (!usageResult.ok) return usageResult

  return ok({ packageId: usageResult.data.packageId, usage: usageResult.data.usage })
}

/**
 * Updates the billing contact on the club's provisioning record.
 * Uses the `update_current_club_admin_billing_contact(p_billing_contact_name text, p_billing_contact_email text)`
 * database function. Returns NOT_FOUND when a database has not had that migration applied yet.
 */
export async function updateClubAdminBillingContact(params: { name: string; email: string }): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("updateClubAdminBillingContact")
  if (!clientResult.ok) return clientResult

  const name = params.name.trim()
  const email = params.email.trim().toLowerCase()
  if (!name) return err("VALIDATION", "Billing contact name is required.")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("VALIDATION", "Enter a valid billing contact email.")

  const { error } = await clientResult.client.rpc("update_current_club_admin_billing_contact", {
    p_billing_contact_name: name,
    p_billing_contact_email: email,
  })

  if (error) {
    if (error.code === "PGRST202") {
      return err("NOT_FOUND", "Changing the billing contact is not switched on for this workspace yet.", error)
    }
    const message = error.message.toLowerCase()
    if (message.includes("only active club-admin")) {
      return err("FORBIDDEN", "Only an active club admin can change the billing contact.", error)
    }
    if (message.includes("is required") || message.includes("not valid") || message.includes("characters or fewer")) {
      return err("VALIDATION", `${error.message}.`, error)
    }
    if (message.includes("cancelled workspace")) {
      return err("CONFLICT", "The billing contact cannot be changed because this workspace has been cancelled.", error)
    }
    if (message.includes("no tenant request found")) {
      return err("CONFLICT", "There is no billing record for this club yet. Message the SKTR team and they will set it up.", error)
    }
    return err("UNKNOWN", error.message, error)
  }
  return ok(undefined)
}
