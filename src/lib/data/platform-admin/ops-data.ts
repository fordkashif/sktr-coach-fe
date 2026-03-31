import {
  approveAndProvisionMockTenantRequest,
  dispatchMockPendingNotificationEmails,
  loadMockPlatformAdminRequests,
  loadMockPlatformAuditEvents,
  logMockPlatformAdminExport,
  previewMockInitialAccessInvite,
  resendMockInitialAccessInvite,
  reviewMockTenantProvisionRequest,
} from "@/lib/mock-platform-admin"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

export type PlatformAdminRequestRecord = {
  id: string
  organizationName: string
  requestorName: string
  requestorEmail: string
  jobTitle: string | null
  organizationType: string | null
  organizationWebsite: string | null
  region: string | null
  requestedPlan: "starter" | "pro" | "enterprise"
  expectedSeats: number
  expectedCoachCount: number | null
  expectedAthleteCount: number | null
  desiredStartDate: string | null
  notes: string | null
  status: "pending" | "approved" | "rejected" | "cancelled"
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
      "id, organization_name, requestor_name, requestor_email, job_title, organization_type, organization_website, region, requested_plan, expected_seats, expected_coach_count, expected_athlete_count, desired_start_date, notes, status, review_notes, reviewed_at, provisioned_tenant_id, access_invite_sent_at, access_invite_last_error, created_at",
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
      requested_plan: PlatformAdminRequestRecord["requestedPlan"]
      expected_seats: number
      expected_coach_count: number | null
      expected_athlete_count: number | null
      desired_start_date: string | null
      notes: string | null
      status: PlatformAdminRequestRecord["status"]
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

async function invokePlatformAdminInviteFunction(
  client: BrowserSupabaseClient,
  payload: {
    requestId: string
    requestorEmail: string
    requestorName: string
    tenantId: string
    appBaseUrl: string | null
  },
): Promise<Result<{ sentAt: string }>> {
  const { data, error } = await client.functions.invoke("platform-admin-send-club-admin-invite", {
    body: payload,
  })

  if (error) {
    const contextualMessage =
      typeof (error as { context?: { json?: { error?: string } } }).context?.json?.error === "string"
        ? (error as { context?: { json?: { error?: string } } }).context!.json!.error!
        : error.message
    return err("UNKNOWN", contextualMessage, error)
  }

  const response = (data ?? {}) as { sentAt?: string; error?: string }
  if (response.error) return err("UNKNOWN", response.error)
  if (!response.sentAt) return err("UNKNOWN", "Invite function did not return a sent timestamp.")
  return ok({ sentAt: response.sentAt })
}

export async function sendInitialClubAdminAccessInvite(params: {
  requestId: string
  requestorEmail: string
  requestorName: string
  tenantId: string
}): Promise<Result<{ sentAt: string }>> {
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

  return ok({ sentAt: inviteResult.data.sentAt })
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
    const contextualMessage =
      typeof (error as { context?: { json?: { error?: string } } }).context?.json?.error === "string"
        ? (error as { context?: { json?: { error?: string } } }).context!.json!.error!
        : error.message
    return err("UNKNOWN", contextualMessage, error)
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
}): Promise<Result<{ tenantId: string; accessInviteSentAt: string | null; accessInviteError: string | null }>> {
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
  })
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
}): Promise<Result<{ processed: number; results: Array<{ id: string; status: "sent" | "failed"; error?: string }> }>> {
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
    return err("UNKNOWN", error.message, error)
  }

  const payload = (data ?? {}) as {
    processed?: number
    results?: Array<{ id: string; status: "sent" | "failed"; error?: string }>
    error?: string
  }

  if (payload.error) return err("UNKNOWN", payload.error)

  return ok({
    processed: payload.processed ?? 0,
    results: payload.results ?? [],
  })
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
