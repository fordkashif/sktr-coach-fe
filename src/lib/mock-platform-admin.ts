import { getCookieValue, USER_COOKIE } from "@/lib/auth-session"

export type MockPlatformAdminRequest = {
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

export type MockPlatformAuditEvent = {
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

type SubmitMockTenantProvisionRequestInput = {
  fullName: string
  email: string
  jobTitle: string
  organization: string
  organizationType: string
  organizationWebsite: string
  region: string
  expectedCoachCount: number
  expectedAthleteCount: number
  desiredStartDate: string
  notes: string
}

const PLATFORM_ADMIN_REQUESTS_KEY = "pacelab:platform-admin:requests"
const PLATFORM_ADMIN_AUDIT_KEY = "pacelab:platform-admin:audit"

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function loadStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  return safeParse(window.localStorage.getItem(key), fallback)
}

function saveStorage<T>(key: string, value: T) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(key, JSON.stringify(value))
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

function slugifyTenantId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return normalized || `tenant-${Date.now()}`
}

function getCurrentActorEmail() {
  return getCookieValue(USER_COOKIE) ?? (typeof window === "undefined" ? null : window.localStorage.getItem("pacelab:mock-user-email"))
}

function insertAuditEvent(input: Omit<MockPlatformAuditEvent, "id" | "occurredAt" | "createdAt">) {
  const events = loadMockPlatformAuditEvents()
  const timestamp = new Date().toISOString()
  const nextEvent: MockPlatformAuditEvent = {
    id: createId("platform-audit"),
    occurredAt: timestamp,
    createdAt: timestamp,
    ...input,
  }
  saveStorage(PLATFORM_ADMIN_AUDIT_KEY, [nextEvent, ...events].slice(0, 500))
}

export function loadMockPlatformAdminRequests(): MockPlatformAdminRequest[] {
  const requests = loadStorage<MockPlatformAdminRequest[]>(PLATFORM_ADMIN_REQUESTS_KEY, [])
  return [...requests].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function saveMockPlatformAdminRequests(requests: MockPlatformAdminRequest[]) {
  saveStorage(PLATFORM_ADMIN_REQUESTS_KEY, requests)
}

export function loadMockPlatformAuditEvents(): MockPlatformAuditEvent[] {
  const events = loadStorage<MockPlatformAuditEvent[]>(PLATFORM_ADMIN_AUDIT_KEY, [])
  return [...events].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
}

export function submitMockTenantProvisionRequest(input: SubmitMockTenantProvisionRequestInput): MockPlatformAdminRequest {
  const now = new Date().toISOString()
  const request: MockPlatformAdminRequest = {
    id: createId("platform-request"),
    organizationName: input.organization.trim(),
    requestorName: input.fullName.trim(),
    requestorEmail: input.email.trim().toLowerCase(),
    jobTitle: input.jobTitle.trim() || null,
    organizationType: input.organizationType.trim() || null,
    organizationWebsite: input.organizationWebsite.trim() || null,
    region: input.region.trim() || null,
    requestedPlan: "starter",
    expectedSeats: Math.max(0, input.expectedCoachCount) + Math.max(0, input.expectedAthleteCount),
    expectedCoachCount: Math.max(0, input.expectedCoachCount),
    expectedAthleteCount: Math.max(0, input.expectedAthleteCount),
    desiredStartDate: input.desiredStartDate || null,
    notes: input.notes.trim() || null,
    status: "pending",
    reviewNotes: null,
    reviewedAt: null,
    provisionedTenantId: null,
    accessInviteSentAt: null,
    accessInviteLastError: null,
    createdAt: now,
  }

  saveMockPlatformAdminRequests([request, ...loadMockPlatformAdminRequests()])
  insertAuditEvent({
    actorUserId: null,
    actorEmail: request.requestorEmail,
    actorRole: "public-request",
    action: "tenant_provision_request_submitted",
    target: request.organizationName,
    detail: `Tenant provisioning request submitted by ${request.requestorEmail}.`,
    metadata: {
      requestId: request.id,
      requestorEmail: request.requestorEmail,
      requestedPlan: request.requestedPlan,
      expectedSeats: request.expectedSeats,
    },
  })

  return request
}

export function reviewMockTenantProvisionRequest(params: {
  requestId: string
  status: "approved" | "rejected"
  reviewNotes?: string
}) {
  const requests = loadMockPlatformAdminRequests()
  const target = requests.find((item) => item.id === params.requestId)
  if (!target) return null

  const reviewedAt = new Date().toISOString()
  const next = requests.map((item) =>
    item.id === params.requestId
      ? {
          ...item,
          status: params.status,
          reviewNotes: params.reviewNotes?.trim() || null,
          reviewedAt,
        }
      : item,
  )
  saveMockPlatformAdminRequests(next)

  insertAuditEvent({
    actorUserId: null,
    actorEmail: getCurrentActorEmail(),
    actorRole: "platform-admin",
    action: "tenant_provision_request_reviewed",
    target: target.organizationName,
    detail: `Request ${params.status} for ${target.requestorEmail}.`,
    metadata: {
      requestId: target.id,
      requestorEmail: target.requestorEmail,
      status: params.status,
      reviewNotes: params.reviewNotes?.trim() || null,
    },
  })

  return next.find((item) => item.id === params.requestId) ?? null
}

export function approveAndProvisionMockTenantRequest(params: {
  requestId: string
  requestorEmail: string
  reviewNotes?: string
}) {
  const requests = loadMockPlatformAdminRequests()
  const target = requests.find((item) => item.id === params.requestId)
  if (!target) return null

  const reviewedAt = new Date().toISOString()
  const sentAt = new Date().toISOString()
  const tenantId = `${slugifyTenantId(target.organizationName)}-${target.id.slice(-6)}`

  const next = requests.map((item) =>
    item.id === params.requestId
      ? {
          ...item,
          status: "approved" as const,
          reviewNotes: params.reviewNotes?.trim() || null,
          reviewedAt,
          provisionedTenantId: tenantId,
          accessInviteSentAt: sentAt,
          accessInviteLastError: null,
        }
      : item,
  )
  saveMockPlatformAdminRequests(next)

  insertAuditEvent({
    actorUserId: null,
    actorEmail: getCurrentActorEmail(),
    actorRole: "platform-admin",
    action: "tenant_provision_request_reviewed",
    target: target.organizationName,
    detail: `Request approved for ${params.requestorEmail}.`,
    metadata: {
      requestId: target.id,
      requestorEmail: params.requestorEmail,
      status: "approved",
      reviewNotes: params.reviewNotes?.trim() || null,
    },
  })
  insertAuditEvent({
    actorUserId: null,
    actorEmail: getCurrentActorEmail(),
    actorRole: "platform-admin",
    action: "tenant_provision_request_provisioned",
    target: target.organizationName,
    detail: `Tenant ${tenantId} provisioned and initial access invite sent to ${params.requestorEmail}.`,
    metadata: {
      requestId: target.id,
      tenantId,
      requestorEmail: params.requestorEmail,
      accessInviteSentAt: sentAt,
    },
  })

  return {
    tenantId,
    accessInviteSentAt: sentAt,
    accessInviteError: null,
  }
}

export function resendMockInitialAccessInvite(params: { requestId: string }) {
  const requests = loadMockPlatformAdminRequests()
  const target = requests.find((item) => item.id === params.requestId)
  if (!target || !target.provisionedTenantId) return null

  const sentAt = new Date().toISOString()
  const next = requests.map((item) =>
    item.id === params.requestId
      ? {
          ...item,
          accessInviteSentAt: sentAt,
          accessInviteLastError: null,
        }
      : item,
  )
  saveMockPlatformAdminRequests(next)

  insertAuditEvent({
    actorUserId: null,
    actorEmail: getCurrentActorEmail(),
    actorRole: "platform-admin",
    action: "club_admin_initial_access_invite_resent",
    target: target.organizationName,
    detail: `Initial access invite resent to ${target.requestorEmail}.`,
    metadata: {
      requestId: target.id,
      tenantId: target.provisionedTenantId,
      requestorEmail: target.requestorEmail,
      accessInviteSentAt: sentAt,
    },
  })

  return { sentAt }
}

export function previewMockInitialAccessInvite(params: { requestId: string }) {
  const requests = loadMockPlatformAdminRequests()
  const target = requests.find((item) => item.id === params.requestId)
  if (!target || !target.provisionedTenantId) return null

  const baseUrl = typeof window === "undefined" ? "http://127.0.0.1:3007" : window.location.origin
  const actionLink = `${baseUrl}/club-admin/claim?mock_request=${encodeURIComponent(target.id)}&email=${encodeURIComponent(target.requestorEmail)}`

  insertAuditEvent({
    actorUserId: null,
    actorEmail: getCurrentActorEmail(),
    actorRole: "platform-admin",
    action: "club_admin_initial_access_invite_previewed",
    target: target.organizationName,
    detail: `Initial access link previewed for ${target.requestorEmail}.`,
    metadata: {
      requestId: target.id,
      tenantId: target.provisionedTenantId,
      requestorEmail: target.requestorEmail,
    },
  })

  return { actionLink }
}

export function dispatchMockPendingNotificationEmails(params?: { limit?: number; eventIds?: string[] }) {
  const requests = loadMockPlatformAdminRequests()
  const candidates = requests
    .filter((item) => item.status === "approved" && item.provisionedTenantId && !item.accessInviteSentAt)
    .slice(0, Math.max(1, params?.limit ?? 25))

  if (candidates.length === 0) {
    return { processed: 0, results: [] as Array<{ id: string; status: "sent" | "failed"; error?: string }> }
  }

  const sentAt = new Date().toISOString()
  const candidateIds = new Set(candidates.map((item) => item.id))
  const next = requests.map((item) =>
    candidateIds.has(item.id)
      ? {
          ...item,
          accessInviteSentAt: sentAt,
          accessInviteLastError: null,
        }
      : item,
  )
  saveMockPlatformAdminRequests(next)

  candidates.forEach((candidate) => {
    insertAuditEvent({
      actorUserId: null,
      actorEmail: getCurrentActorEmail(),
      actorRole: "platform-admin",
      action: "notification_email_dispatched",
      target: candidate.organizationName,
      detail: `Notification email dispatched to ${candidate.requestorEmail}.`,
      metadata: {
        requestId: candidate.id,
        tenantId: candidate.provisionedTenantId,
        requestorEmail: candidate.requestorEmail,
      },
    })
  })

  return {
    processed: candidates.length,
    results: candidates.map((candidate) => ({ id: candidate.id, status: "sent" as const })),
  }
}

export function logMockPlatformAdminExport(params: {
  target: string
  format: "csv" | "pdf"
  recordCount: number
  filters?: Record<string, unknown>
}) {
  insertAuditEvent({
    actorUserId: null,
    actorEmail: getCurrentActorEmail(),
    actorRole: "platform-admin",
    action: `platform_audit_export_${params.format}`,
    target: params.target,
    detail: `Exported ${params.recordCount} record(s) from ${params.target}.`,
    metadata: {
      target: params.target,
      format: params.format,
      recordCount: params.recordCount,
      filters: params.filters ?? {},
    },
  })
}
