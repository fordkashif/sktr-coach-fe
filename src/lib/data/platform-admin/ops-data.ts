import {
  approveAndProvisionMockTenantRequest,
  dispatchMockPendingNotificationEmails,
  loadMockPlatformAdminRequests,
  loadMockPackageUpgradeRequests,
  loadMockPlatformAuditEvents,
  logMockPlatformAdminExport,
  previewMockInitialAccessInvite,
  resendMockInitialAccessInvite,
  reviewMockPackageUpgradeRequest,
  reviewMockTenantProvisionRequest,
  setMockTenantRequestLifecycleState,
} from "@/lib/mock-platform-admin"
import type { PackageId } from "@/lib/billing/package-catalog"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import type { TenantBillingStatus, TenantLifecycleStatus } from "@/lib/tenant/lifecycle"

export type PlatformAdminRequestRecord = {
  id: string
  organizationName: string
  requestorName: string
  requestorEmail: string
  jobTitle: string | null
  organizationType: string | null
  organizationWebsite: string | null
  region: string | null
  requestedPlan: PackageId
  expectedSeats: number
  expectedCoachCount: number | null
  expectedAthleteCount: number | null
  desiredStartDate: string | null
  notes: string | null
  status: "pending" | "approved" | "rejected" | "cancelled"
  lifecycleStatus: TenantLifecycleStatus | null
  billingStatus: TenantBillingStatus | null
  billingProvider: string | null
  billingCustomerId: string | null
  billingSubscriptionId: string | null
  billingContactName: string | null
  billingContactEmail: string | null
  billingCycle: "monthly" | "annual" | null
  billingStartedAt: string | null
  billingFailedAt: string | null
  previousLifecycleStatus: TenantLifecycleStatus | null
  reviewNotes: string | null
  reviewedAt: string | null
  provisionedTenantId: string | null
  accessInviteSentAt: string | null
  accessInviteLastError: string | null
  createdAt: string
}

export type PlatformAuditEventRecord = {
  id: string
  actorUserId: string | null
  actorEmail: string | null
  actorRole: string
  action: string
  target: string
  detail: string | null
  metadata: Record<string, unknown>
  occurredAt: string
  createdAt: string
}

export type PlatformAdminPackageUpgradeRequestRecord = {
  id: string
  tenantId: string
  organizationName: string
  requestedByUserId: string | null
  requestedByEmail: string | null
  currentPackage: PackageId
  requestedPackage: PackageId
  reason: string | null
  status: "pending" | "approved" | "rejected" | "cancelled"
  reviewNotes: string | null
  reviewedAt: string | null
  createdAt: string
}

type BrowserSupabaseClient = NonNullable<ReturnType<typeof getBrowserSupabaseClient>>

type ClientResolution =
  | { ok: true; client: NonNullable<ReturnType<typeof getBrowserSupabaseClient>> }
  | { ok: false; error: DataError }

function isMockMode() {
  return getBackendMode() !== "supabase"
}

function requireSupabaseClient(operation: string): ClientResolution {
  if (isMockMode()) {
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

export async function getPlatformAdminRequestQueue(): Promise<Result<PlatformAdminRequestRecord[]>> {
  if (isMockMode()) return ok(loadMockPlatformAdminRequests())

  const clientResult = requireSupabaseClient("getPlatformAdminRequestQueue")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client
    .from("tenant_provision_requests")
    .select(
      "id, organization_name, requestor_name, requestor_email, job_title, organization_type, organization_website, region, requested_plan, expected_seats, expected_coach_count, expected_athlete_count, desired_start_date, notes, status, lifecycle_status, billing_status, billing_provider, billing_customer_id, billing_subscription_id, billing_contact_name, billing_contact_email, billing_cycle, billing_started_at, billing_failed_at, previous_lifecycle_status, review_notes, reviewed_at, provisioned_tenant_id, access_invite_sent_at, access_invite_last_error, created_at",
    )
    .order("created_at", { ascending: false })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
      id: string
      organization_name: string
      requestor_name: string
      requestor_email: string
      job_title: string | null
      organization_type: string | null
      organization_website: string | null
      region: string | null
      requested_plan: PackageId
      expected_seats: number
      expected_coach_count: number | null
      expected_athlete_count: number | null
      desired_start_date: string | null
      notes: string | null
      status: PlatformAdminRequestRecord["status"]
      lifecycle_status: TenantLifecycleStatus | null
      billing_status: TenantBillingStatus | null
      billing_provider: string | null
      billing_customer_id: string | null
      billing_subscription_id: string | null
      billing_contact_name: string | null
      billing_contact_email: string | null
      billing_cycle: "monthly" | "annual" | null
      billing_started_at: string | null
      billing_failed_at: string | null
      previous_lifecycle_status: TenantLifecycleStatus | null
      review_notes: string | null
      reviewed_at: string | null
      provisioned_tenant_id: string | null
      access_invite_sent_at: string | null
      access_invite_last_error: string | null
      created_at: string
    }> | null) ?? []).map((row) => ({
      id: row.id,
      organizationName: row.organization_name,
      requestorName: row.requestor_name,
      requestorEmail: row.requestor_email,
      jobTitle: row.job_title,
      organizationType: row.organization_type,
      organizationWebsite: row.organization_website,
      region: row.region,
      requestedPlan: row.requested_plan,
      expectedSeats: row.expected_seats,
      expectedCoachCount: row.expected_coach_count,
      expectedAthleteCount: row.expected_athlete_count,
      desiredStartDate: row.desired_start_date,
      notes: row.notes,
      status: row.status,
      lifecycleStatus: row.lifecycle_status,
      billingStatus: row.billing_status,
      billingProvider: row.billing_provider,
      billingCustomerId: row.billing_customer_id,
      billingSubscriptionId: row.billing_subscription_id,
      billingContactName: row.billing_contact_name,
      billingContactEmail: row.billing_contact_email,
      billingCycle: row.billing_cycle,
      billingStartedAt: row.billing_started_at,
      billingFailedAt: row.billing_failed_at,
      previousLifecycleStatus: row.previous_lifecycle_status,
      reviewNotes: row.review_notes,
      reviewedAt: row.reviewed_at,
      provisionedTenantId: row.provisioned_tenant_id,
      accessInviteSentAt: row.access_invite_sent_at,
      accessInviteLastError: row.access_invite_last_error,
      createdAt: row.created_at,
    })),
  )
}

export async function getPlatformAuditEvents(limit = 100): Promise<Result<PlatformAuditEventRecord[]>> {
  if (isMockMode()) return ok(loadMockPlatformAuditEvents().slice(0, Math.max(1, Math.min(limit, 250))))

  const clientResult = requireSupabaseClient("getPlatformAuditEvents")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client
    .from("platform_audit_events")
    .select("id, actor_user_id, actor_email, actor_role, action, target, detail, metadata, occurred_at, created_at")
    .order("occurred_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 250)))

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
      id: string
      actor_user_id: string | null
      actor_email: string | null
      actor_role: string
      action: string
      target: string
      detail: string | null
      metadata: Record<string, unknown> | null
      occurred_at: string
      created_at: string
    }> | null) ?? []).map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actorEmail: row.actor_email,
      actorRole: row.actor_role,
      action: row.action,
      target: row.target,
      detail: row.detail,
      metadata: row.metadata ?? {},
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
    })),
  )
}

export async function getPlatformAdminPackageUpgradeRequests(): Promise<Result<PlatformAdminPackageUpgradeRequestRecord[]>> {
  if (isMockMode()) return ok(loadMockPackageUpgradeRequests())

  const clientResult = requireSupabaseClient("getPlatformAdminPackageUpgradeRequests")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client
    .from("tenant_package_upgrade_requests")
    .select(
      "id, tenant_id, current_package, requested_package, reason, status, review_notes, reviewed_at, created_at, requested_by_user_id, tenants(name)",
    )
    .order("created_at", { ascending: false })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
      id: string
      tenant_id: string
      current_package: PackageId
      requested_package: PackageId
      reason: string | null
      status: PlatformAdminPackageUpgradeRequestRecord["status"]
      review_notes: string | null
      reviewed_at: string | null
      created_at: string
      requested_by_user_id: string | null
      tenants: Array<{ name: string | null }> | { name: string | null } | null
    }> | null) ?? []).map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      organizationName: (Array.isArray(row.tenants) ? row.tenants[0]?.name : row.tenants?.name) ?? "Tenant",
      requestedByUserId: row.requested_by_user_id,
      requestedByEmail: null,
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

export async function reviewTenantProvisionRequest(params: {
  requestId: string
  status: "approved" | "rejected"
  reviewNotes?: string
}): Promise<Result<void>> {
  if (isMockMode()) {
    const updated = reviewMockTenantProvisionRequest(params)
    return updated ? ok(undefined) : err("NOT_FOUND", "Tenant provisioning request not found.")
  }

  const clientResult = requireSupabaseClient("reviewTenantProvisionRequest")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client.rpc("review_tenant_provision_request", {
    p_request_id: params.requestId,
    p_status: params.status,
    p_review_notes: params.reviewNotes?.trim() || null,
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

/**
 * supabase-js reports a non-2xx edge function reply as "Edge Function returned a non-2xx status code" and keeps
 * the real reply on error.context (a Response). Read the function's own { error } message out of it when there is one.
 */
async function readFunctionErrorMessage(error: { message: string; context?: unknown }): Promise<string> {
  const context = error.context as { json?: unknown; clone?: () => { json: () => Promise<unknown> } } | undefined
  try {
    if (context && typeof context.json === "function") {
      const body = (await (typeof context.clone === "function" ? context.clone() : (context as { json: () => Promise<unknown> })).json()) as {
        error?: unknown
      } | null
      if (body && typeof body.error === "string" && body.error.trim()) return body.error
    } else if (context && typeof (context.json as { error?: unknown } | undefined)?.error === "string") {
      return (context.json as { error: string }).error
    }
  } catch {
    // The reply was not JSON. Fall back to the generic message.
  }
  return error.message
}

async function invokePlatformAdminInviteFunction(
  client: BrowserSupabaseClient,
  payload: {
    requestId: string
    requestorEmail: string
    requestorName: string
    tenantId: string
    appBaseUrl: string | null
  },
): Promise<Result<{ sentAt: string; actionLink?: string }>> {
  const { data, error } = await client.functions.invoke("platform-admin-send-club-admin-invite", {
    body: payload,
  })

  if (error) {
    return err("UNKNOWN", await readFunctionErrorMessage(error), error)
  }

  const response = (data ?? {}) as { sentAt?: string; actionLink?: string; error?: string }
  if (response.error) return err("UNKNOWN", response.error)
  if (!response.sentAt) return err("UNKNOWN", "Invite function did not return a sent timestamp.")
  return ok({ sentAt: response.sentAt, actionLink: response.actionLink })
}

export async function sendInitialClubAdminAccessInvite(params: {
  requestId: string
  requestorEmail: string
  requestorName: string
  tenantId: string
}): Promise<Result<{ sentAt: string; actionLink?: string }>> {
  if (isMockMode()) {
    const preview = resendMockInitialAccessInvite({ requestId: params.requestId })
    return preview ? ok(preview) : err("NOT_FOUND", "Provisioned request not found.")
  }

  const clientResult = requireSupabaseClient("sendInitialClubAdminAccessInvite")
  if (!clientResult.ok) return clientResult

  const inviteResult = await invokePlatformAdminInviteFunction(clientResult.client, {
    requestId: params.requestId,
    requestorEmail: params.requestorEmail.trim().toLowerCase(),
    requestorName: params.requestorName.trim(),
    tenantId: params.tenantId,
    appBaseUrl: typeof window === "undefined" ? null : window.location.origin,
  })

  if (!inviteResult.ok) return inviteResult

  return ok({ sentAt: inviteResult.data.sentAt, actionLink: inviteResult.data.actionLink })
}

export async function previewInitialClubAdminAccessInvite(params: {
  requestId: string
  requestorEmail: string
  requestorName: string
  tenantId: string
}): Promise<Result<{ actionLink: string }>> {
  if (isMockMode()) {
    const preview = previewMockInitialAccessInvite({ requestId: params.requestId })
    return preview ? ok(preview) : err("NOT_FOUND", "Provisioned request not found.")
  }

  const clientResult = requireSupabaseClient("previewInitialClubAdminAccessInvite")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client.functions.invoke("platform-admin-preview-club-admin-invite", {
    body: {
      requestId: params.requestId,
      requestorEmail: params.requestorEmail.trim().toLowerCase(),
      requestorName: params.requestorName.trim(),
      tenantId: params.tenantId,
      appBaseUrl: typeof window === "undefined" ? null : window.location.origin,
    },
  })

  if (error) {
    return err("UNKNOWN", await readFunctionErrorMessage(error), error)
  }

  const response = (data ?? {}) as { actionLink?: string; error?: string }
  if (response.error) return err("UNKNOWN", response.error)
  if (!response.actionLink) return err("UNKNOWN", "Preview function did not return an action link.")

  return ok({ actionLink: response.actionLink })
}

export async function approveAndProvisionTenantRequest(params: {
  requestId: string
  requestorEmail: string
  requestorName: string
  reviewNotes?: string
}): Promise<Result<{ tenantId: string; accessInviteSentAt: string | null; accessInviteError: string | null; accessInviteActionLink?: string }>> {
  if (isMockMode()) {
    const provisioned = approveAndProvisionMockTenantRequest({
      requestId: params.requestId,
      requestorEmail: params.requestorEmail.trim().toLowerCase(),
      reviewNotes: params.reviewNotes,
    })
    return provisioned ? ok(provisioned) : err("NOT_FOUND", "Tenant provisioning request not found.")
  }

  const clientResult = requireSupabaseClient("approveAndProvisionTenantRequest")
  if (!clientResult.ok) return clientResult

  const provisionResult = await clientResult.client.rpc("approve_and_provision_tenant_request", {
    p_request_id: params.requestId,
    p_review_notes: params.reviewNotes?.trim() || null,
  })

  if (provisionResult.error) {
    return { ok: false, error: mapPostgrestError(provisionResult.error) }
  }

  const tenantId = provisionResult.data as string
  const inviteResult = await sendInitialClubAdminAccessInvite({
    requestId: params.requestId,
    requestorEmail: params.requestorEmail,
    requestorName: params.requestorName,
    tenantId,
  })

  if (!inviteResult.ok) {
    return ok({
      tenantId,
      accessInviteSentAt: null,
      accessInviteError: inviteResult.error.message,
    })
  }

  return ok({
    tenantId,
    accessInviteSentAt: inviteResult.data.sentAt,
    accessInviteError: null,
    accessInviteActionLink: inviteResult.data.actionLink,
  })
}

export async function setTenantRequestLifecycleState(params: {
  requestId: string
  lifecycleStatus: TenantLifecycleStatus
  billingStatus?: TenantBillingStatus | null
  reviewNotes?: string
}): Promise<Result<void>> {
  if (isMockMode()) {
    const updated = setMockTenantRequestLifecycleState(params)
    return updated ? ok(undefined) : err("NOT_FOUND", "Tenant provisioning request not found.")
  }

  const clientResult = requireSupabaseClient("setTenantRequestLifecycleState")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client.rpc("set_tenant_request_lifecycle_state", {
    p_request_id: params.requestId,
    p_lifecycle_status: params.lifecycleStatus,
    p_billing_status: params.billingStatus ?? null,
    p_review_notes: params.reviewNotes?.trim() || null,
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export async function reviewTenantPackageUpgradeRequest(params: {
  upgradeRequestId: string
  status: "approved" | "rejected" | "cancelled"
  reviewNotes?: string
}): Promise<Result<void>> {
  if (isMockMode()) {
    const updated = reviewMockPackageUpgradeRequest(params)
    return updated ? ok(undefined) : err("NOT_FOUND", "Package upgrade request not found.")
  }

  const clientResult = requireSupabaseClient("reviewTenantPackageUpgradeRequest")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client.rpc("review_tenant_package_upgrade_request", {
    p_upgrade_request_id: params.upgradeRequestId,
    p_status: params.status,
    p_review_notes: params.reviewNotes?.trim() || null,
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export async function getCurrentPlatformAdminIdentity(): Promise<Result<{ email: string }>> {
  if (isMockMode()) return ok({ email: "platformadmin@pacelab.local" })

  const clientResult = requireSupabaseClient("getCurrentPlatformAdminIdentity")
  if (!clientResult.ok) return clientResult

  const { data: authState } = await clientResult.client.auth.getSession()
  const session = authState.session
  if (!session) return err("UNAUTHORIZED", "No authenticated platform-admin session found.")
  const email = session?.user.email?.trim().toLowerCase() ?? null
  if (!email) return err("UNAUTHORIZED", "No authenticated platform-admin session found.")

  const [byUserId, byEmail] = await Promise.all([
    clientResult.client
      .from("platform_admin_contacts")
      .select("email")
      .eq("is_active", true)
      .eq("user_id", session.user.id)
      .limit(1)
      .maybeSingle(),
    clientResult.client
      .from("platform_admin_contacts")
      .select("email")
      .eq("is_active", true)
      .eq("email", email)
      .limit(1)
      .maybeSingle(),
  ])

  if (byUserId.error) return { ok: false, error: mapPostgrestError(byUserId.error) }
  if (byEmail.error) return { ok: false, error: mapPostgrestError(byEmail.error) }

  const data = byUserId.data ?? byEmail.data
  if (!data) return err("FORBIDDEN", "Current user is not an active platform admin.")

  return ok({ email: data.email })
}

export async function dispatchPendingNotificationEmails(params?: {
  limit?: number
  eventIds?: string[]
}): Promise<
  Result<{
    processed: number
    results: Array<{
      id: string
      status: "sent" | "failed"
      error?: string
      actionLink?: string
      recipientEmail?: string
      subject?: string
    }>
  }>
> {
  if (isMockMode()) return ok(dispatchMockPendingNotificationEmails(params))

  const clientResult = requireSupabaseClient("dispatchPendingNotificationEmails")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client.functions.invoke("dispatch-notification-emails", {
    body: {
      limit: params?.limit ?? 25,
      eventIds: params?.eventIds,
    },
  })

  if (error) {
    return err("UNKNOWN", await readFunctionErrorMessage(error), error)
  }

  const payload = (data ?? {}) as {
    processed?: number
    results?: Array<{
      id: string
      status: "sent" | "failed"
      error?: string
      actionLink?: string
      recipientEmail?: string
      subject?: string
    }>
    error?: string
  }

  if (payload.error) return err("UNKNOWN", payload.error)

  return ok({
    processed: payload.processed ?? 0,
    results: payload.results ?? [],
  })
}

export type PlatformTenantSize = {
  tenantId: string
  /** Teams that are not archived. */
  teams: number
  /** Coach profiles that are active. */
  coaches: number
  /** Every athlete on the club's roster. */
  athletes: number
}

/**
 * Live size of every club, keyed by tenant id, from the `get_platform_tenant_sizes` database
 * function (platform admins only; it returns counts and nothing else).
 * Null means live counts are not available: mock mode, the function is not deployed yet, or the
 * call failed. Screens then fall back to the numbers the club gave at sign-up and say so.
 */
export async function getPlatformTenantSizes(): Promise<Map<string, PlatformTenantSize> | null> {
  if (isMockMode()) return null

  const clientResult = requireSupabaseClient("getPlatformTenantSizes")
  if (!clientResult.ok) return null

  try {
    const { data, error } = await clientResult.client.rpc("get_platform_tenant_sizes")
    if (error || !Array.isArray(data)) return null

    const sizes = new Map<string, PlatformTenantSize>()
    for (const row of data as Array<{ tenant_id: string; team_count: number | null; coach_count: number | null; athlete_count: number | null }>) {
      if (!row?.tenant_id) continue
      sizes.set(row.tenant_id, {
        tenantId: row.tenant_id,
        teams: Number(row.team_count ?? 0),
        coaches: Number(row.coach_count ?? 0),
        athletes: Number(row.athlete_count ?? 0),
      })
    }
    return sizes
  } catch {
    return null
  }
}

export async function logPlatformAdminExport(params: {
  target: string
  format: "csv" | "pdf"
  recordCount: number
  filters?: Record<string, unknown>
}): Promise<Result<void>> {
  if (isMockMode()) {
    logMockPlatformAdminExport(params)
    return ok(undefined)
  }

  const clientResult = requireSupabaseClient("logPlatformAdminExport")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client.rpc("log_platform_admin_export", {
    p_target: params.target,
    p_format: params.format,
    p_record_count: Math.max(0, Math.floor(params.recordCount)),
    p_filters: params.filters ?? {},
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

/**
 * Everything the platform audit trail recorded about one club request, oldest first.
 * The RPCs disagree on the metadata key (tenant_provision_request_id, request_id) and mock mode uses requestId,
 * so all three are matched.
 */
export async function getPlatformAdminRequestHistory(requestId: string): Promise<Result<PlatformAuditEventRecord[]>> {
  if (isMockMode()) {
    return ok(
      loadMockPlatformAuditEvents()
        .filter((event) => event.metadata?.requestId === requestId)
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    )
  }

  const clientResult = requireSupabaseClient("getPlatformAdminRequestHistory")
  if (!clientResult.ok) return clientResult
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return ok([])

  const { data, error } = await clientResult.client
    .from("platform_audit_events")
    .select("id, actor_user_id, actor_email, actor_role, action, target, detail, metadata, occurred_at, created_at")
    .or(`metadata->>tenant_provision_request_id.eq.${requestId},metadata->>request_id.eq.${requestId}`)
    .order("occurred_at", { ascending: true })
    .limit(100)

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
      id: string
      actor_user_id: string | null
      actor_email: string | null
      actor_role: string
      action: string
      target: string
      detail: string | null
      metadata: Record<string, unknown> | null
      occurred_at: string
      created_at: string
    }> | null) ?? []).map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actorEmail: row.actor_email,
      actorRole: row.actor_role,
      action: row.action,
      target: row.target,
      detail: row.detail,
      metadata: row.metadata ?? {},
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
    })),
  )
}

/** Most recent platform audit rows the activity screen loads in one go. Older rows stay in the table. */
export const PLATFORM_AUDIT_LOG_CAP = 1000

/** The platform activity log: newest first, capped at PLATFORM_AUDIT_LOG_CAP, with the true total so the cap can be stated. */
export async function getPlatformAuditLog(): Promise<Result<{ entries: PlatformAuditEventRecord[]; total: number }>> {
  if (isMockMode()) {
    const events = loadMockPlatformAuditEvents()
    return ok({ entries: events.slice(0, PLATFORM_AUDIT_LOG_CAP), total: events.length })
  }

  const clientResult = requireSupabaseClient("getPlatformAuditLog")
  if (!clientResult.ok) return clientResult

  const { data, error, count } = await clientResult.client
    .from("platform_audit_events")
    .select("id, actor_user_id, actor_email, actor_role, action, target, detail, metadata, occurred_at, created_at", { count: "exact" })
    .order("occurred_at", { ascending: false })
    .limit(PLATFORM_AUDIT_LOG_CAP)

  if (error) return { ok: false, error: mapPostgrestError(error) }

  const rows =
    (data as Array<{
      id: string
      actor_user_id: string | null
      actor_email: string | null
      actor_role: string
      action: string
      target: string
      detail: string | null
      metadata: Record<string, unknown> | null
      occurred_at: string
      created_at: string
    }> | null) ?? []

  return ok({
    entries: rows.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actorEmail: row.actor_email,
      actorRole: row.actor_role,
      action: row.action,
      target: row.target,
      detail: row.detail,
      metadata: row.metadata ?? {},
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
    })),
    total: count ?? rows.length,
  })
}
