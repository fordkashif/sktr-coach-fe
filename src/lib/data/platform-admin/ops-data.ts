import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

export type PlatformAdminRequestRecord = {
  id: string
  organizationName: string
  requestorName: string
  requestorEmail: string
  requestedPlan: "starter" | "pro" | "enterprise"
  expectedSeats: number
  notes: string | null
  status: "pending" | "approved" | "rejected" | "cancelled"
  reviewNotes: string | null
  reviewedAt: string | null
  provisionedTenantId: string | null
  accessInviteSentAt: string | null
  accessInviteLastError: string | null
  createdAt: string
}

type BrowserSupabaseClient = NonNullable<ReturnType<typeof getBrowserSupabaseClient>>

type ClientResolution =
  | { ok: true; client: NonNullable<ReturnType<typeof getBrowserSupabaseClient>> }
  | { ok: false; error: DataError }

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

export async function getPlatformAdminRequestQueue(): Promise<Result<PlatformAdminRequestRecord[]>> {
  const clientResult = requireSupabaseClient("getPlatformAdminRequestQueue")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client
    .from("tenant_provision_requests")
    .select(
      "id, organization_name, requestor_name, requestor_email, requested_plan, expected_seats, notes, status, review_notes, reviewed_at, provisioned_tenant_id, access_invite_sent_at, access_invite_last_error, created_at",
    )
    .order("created_at", { ascending: false })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
      id: string
      organization_name: string
      requestor_name: string
      requestor_email: string
      requested_plan: PlatformAdminRequestRecord["requestedPlan"]
      expected_seats: number
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
      requestedPlan: row.requested_plan,
      expectedSeats: row.expected_seats,
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

export async function reviewTenantProvisionRequest(params: {
  requestId: string
  status: "approved" | "rejected"
  reviewNotes?: string
}): Promise<Result<void>> {
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
  },
): Promise<Result<{ sentAt: string }>> {
  const { data, error } = await client.functions.invoke("platform-admin-send-club-admin-invite", {
    body: payload,
  })

  if (error) {
    return err("UNKNOWN", error.message, error)
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
  const clientResult = requireSupabaseClient("sendInitialClubAdminAccessInvite")
  if (!clientResult.ok) return clientResult

  const inviteResult = await invokePlatformAdminInviteFunction(clientResult.client, {
    requestId: params.requestId,
    requestorEmail: params.requestorEmail.trim().toLowerCase(),
    requestorName: params.requestorName.trim(),
    tenantId: params.tenantId,
  })

  if (!inviteResult.ok) return inviteResult

  return ok({ sentAt: inviteResult.data.sentAt })
}

export async function approveAndProvisionTenantRequest(params: {
  requestId: string
  requestorEmail: string
  requestorName: string
  reviewNotes?: string
}): Promise<Result<{ tenantId: string; accessInviteSentAt: string | null; accessInviteError: string | null }>> {
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
