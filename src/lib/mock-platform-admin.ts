import { getCookieValue, USER_COOKIE } from "@/lib/auth-session"
import type { PackageId } from "@/lib/billing/package-catalog"
import type { TenantBillingStatus, TenantLifecycleStatus } from "@/lib/tenant/lifecycle"

export type MockPlatformAdminRequest = {
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
  lifecycleStatus: TenantLifecycleStatus
  billingStatus: TenantBillingStatus
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

export type MockPackageUpgradeRequest = {
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
  requestedPlan: PackageId
  organizationWebsite: string
  region: string
  expectedCoachCount: number
  expectedAthleteCount: number
  desiredStartDate: string
  notes: string
}

const PLATFORM_ADMIN_REQUESTS_KEY = "pacelab:platform-admin:requests"
const PLATFORM_ADMIN_AUDIT_KEY = "pacelab:platform-admin:audit"
const PLATFORM_ADMIN_PACKAGE_UPGRADES_KEY = "pacelab:platform-admin:package-upgrades"

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

/** Writes one row to the demo platform activity log, as the signed-in demo platform admin. For the platform admin tools. */
export function recordMockPlatformAudit(input: { action: string; target: string; detail?: string | null; metadata?: Record<string, unknown> }) {
  insertAuditEvent({
    actorUserId: null,
    actorEmail: getCurrentActorEmail(),
    actorRole: "platform-admin",
    action: input.action,
    target: input.target,
    detail: input.detail ?? null,
    metadata: input.metadata ?? {},
  })
}

/** The email of whoever is signed in to the demo. */
export function getMockActorEmail() {
  return getCurrentActorEmail()
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

export function loadMockPackageUpgradeRequests(): MockPackageUpgradeRequest[] {
  const requests = loadStorage<MockPackageUpgradeRequest[]>(PLATFORM_ADMIN_PACKAGE_UPGRADES_KEY, [])
  return [...requests].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function saveMockPackageUpgradeRequests(requests: MockPackageUpgradeRequest[]) {
  saveStorage(PLATFORM_ADMIN_PACKAGE_UPGRADES_KEY, requests)
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
    requestedPlan: input.requestedPlan,
    expectedSeats: Math.max(0, input.expectedCoachCount) + Math.max(0, input.expectedAthleteCount),
    expectedCoachCount: Math.max(0, input.expectedCoachCount),
    expectedAthleteCount: Math.max(0, input.expectedAthleteCount),
    desiredStartDate: input.desiredStartDate || null,
    notes: input.notes.trim() || null,
    status: "pending",
    lifecycleStatus: "pending_review",
    billingStatus: "pending",
    billingProvider: "mock-billing",
    billingCustomerId: null,
    billingSubscriptionId: null,
    billingContactName: input.fullName.trim() || null,
    billingContactEmail: input.email.trim().toLowerCase() || null,
    billingCycle: "monthly",
    billingStartedAt: null,
    billingFailedAt: null,
    previousLifecycleStatus: null,
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
  // Same rule as the Supabase RPCs: only a pending request can be reviewed or provisioned.
  if (!target || target.status !== "pending") return null

  const reviewedAt = new Date().toISOString()
  const next = requests.map((item) =>
        item.id === params.requestId
          ? {
              ...item,
              status: params.status,
              lifecycleStatus: (params.status === "approved" ? "approved_pending_billing" : "cancelled") as TenantLifecycleStatus,
              billingStatus: (params.status === "approved" ? item.billingStatus : "cancelled") as TenantBillingStatus,
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
  // Same rule as the Supabase RPCs: only a pending request can be reviewed or provisioned.
  if (!target || target.status !== "pending") return null

  const reviewedAt = new Date().toISOString()
  const sentAt = new Date().toISOString()
  const tenantId = `${slugifyTenantId(target.organizationName)}-${target.id.slice(-6)}`

  const next = requests.map((item) =>
        item.id === params.requestId
          ? {
              ...item,
              status: "approved" as const,
              lifecycleStatus: "approved_pending_billing" as const,
              billingStatus: "pending" as const,
              reviewNotes: params.reviewNotes?.trim() || null,
              reviewedAt,
              previousLifecycleStatus: null,
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

export function setMockTenantRequestLifecycleState(params: {
  requestId: string
  lifecycleStatus: TenantLifecycleStatus
  billingStatus?: TenantBillingStatus | null
  reviewNotes?: string
}) {
  const requests = loadMockPlatformAdminRequests()
  const target = requests.find((item) => item.id === params.requestId)
  if (!target) return null

  const next = requests.map((item) =>
    item.id === params.requestId
      ? {
          ...item,
          lifecycleStatus: params.lifecycleStatus,
          billingStatus: params.billingStatus ?? item.billingStatus,
          billingFailedAt: params.lifecycleStatus === "billing_failed" ? new Date().toISOString() : item.billingFailedAt,
          previousLifecycleStatus:
            params.lifecycleStatus === "suspended" && item.lifecycleStatus !== "suspended"
              ? item.lifecycleStatus
              : item.lifecycleStatus === "suspended" && params.lifecycleStatus !== "suspended"
                ? null
                : item.previousLifecycleStatus,
          reviewNotes: params.reviewNotes?.trim() || item.reviewNotes,
          reviewedAt: item.reviewedAt ?? new Date().toISOString(),
        }
      : item,
  )

  saveMockPlatformAdminRequests(next)
  insertAuditEvent({
    actorUserId: null,
    actorEmail: getCurrentActorEmail(),
    actorRole: "platform-admin",
    action: "tenant_request_lifecycle_updated",
    target: target.organizationName,
    detail: `Lifecycle moved to ${params.lifecycleStatus}.`,
    metadata: {
      requestId: target.id,
      requestorEmail: target.requestorEmail,
      lifecycleStatus: params.lifecycleStatus,
      billingStatus: params.billingStatus ?? target.billingStatus,
      reviewNotes: params.reviewNotes?.trim() || null,
    },
  })

  return next.find((item) => item.id === params.requestId) ?? null
}

export function submitMockPackageUpgradeRequest(params: {
  tenantId: string
  organizationName: string
  requestedByUserId?: string | null
  requestedByEmail?: string | null
  currentPackage: PackageId
  requestedPackage: PackageId
  reason?: string | null
}) {
  const existing = loadMockPackageUpgradeRequests().find((item) => item.tenantId === params.tenantId && item.status === "pending")
  if (existing) return null

  const request: MockPackageUpgradeRequest = {
    id: createId("package-upgrade"),
    tenantId: params.tenantId,
    organizationName: params.organizationName,
    requestedByUserId: params.requestedByUserId ?? null,
    requestedByEmail: params.requestedByEmail ?? null,
    currentPackage: params.currentPackage,
    requestedPackage: params.requestedPackage,
    reason: params.reason?.trim() || null,
    status: "pending",
    reviewNotes: null,
    reviewedAt: null,
    createdAt: new Date().toISOString(),
  }

  saveMockPackageUpgradeRequests([request, ...loadMockPackageUpgradeRequests()])
  insertAuditEvent({
    actorUserId: params.requestedByUserId ?? null,
    actorEmail: params.requestedByEmail ?? null,
    actorRole: "club-admin",
    action: "tenant_package_upgrade_requested",
    target: params.organizationName,
    detail: `Package upgrade requested from ${params.currentPackage} to ${params.requestedPackage}.`,
    metadata: {
      upgradeRequestId: request.id,
      tenantId: params.tenantId,
      currentPackage: params.currentPackage,
      requestedPackage: params.requestedPackage,
    },
  })

  return request
}

export function reviewMockPackageUpgradeRequest(params: {
  upgradeRequestId: string
  status: "approved" | "rejected" | "cancelled"
  reviewNotes?: string
}) {
  const upgrades = loadMockPackageUpgradeRequests()
  const target = upgrades.find((item) => item.id === params.upgradeRequestId)
  if (!target || target.status !== "pending") return null

  const reviewedAt = new Date().toISOString()
  const nextUpgrades = upgrades.map((item) =>
    item.id === params.upgradeRequestId
      ? {
          ...item,
          status: params.status,
          reviewNotes: params.reviewNotes?.trim() || null,
          reviewedAt,
        }
      : item,
  )
  saveMockPackageUpgradeRequests(nextUpgrades)

  if (params.status === "approved") {
    const requests = loadMockPlatformAdminRequests()
    const nextRequests = requests.map((item) =>
      item.provisionedTenantId === target.tenantId
        ? {
            ...item,
            requestedPlan: target.requestedPackage,
          }
        : item,
    )
    saveMockPlatformAdminRequests(nextRequests)
  }

  insertAuditEvent({
    actorUserId: null,
    actorEmail: getCurrentActorEmail(),
    actorRole: "platform-admin",
    action: "tenant_package_upgrade_reviewed",
    target: target.organizationName,
    detail: `Package upgrade request moved to ${params.status}.`,
    metadata: {
      upgradeRequestId: target.id,
      tenantId: target.tenantId,
      currentPackage: target.currentPackage,
      requestedPackage: target.requestedPackage,
      status: params.status,
      reviewNotes: params.reviewNotes?.trim() || null,
    },
  })

  return nextUpgrades.find((item) => item.id === params.upgradeRequestId) ?? null
}

/**
 * Lifecycle status of a mock tenant, from the newest mock provisioning record that created it.
 * Null when no record matches (the built-in demo club has none), which callers treat as open.
 */
export function getMockTenantLifecycleStatus(tenantId: string | null): TenantLifecycleStatus | null {
  if (!tenantId) return null
  return loadMockPlatformAdminRequests().find((item) => item.provisionedTenantId === tenantId)?.lifecycleStatus ?? null
}

/**
 * Demo version of platform_admin_set_tenant_package: the platform admin moves a club to another
 * package with a reason. A waiting request from the club for that same package is closed as approved.
 * Returns the package the club was on before, or null when the club is not found or nothing changes.
 */
export function setMockTenantPackage(params: { requestId: string; packageId: PackageId; reason: string }) {
  const requests = loadMockPlatformAdminRequests()
  const target = requests.find((item) => item.id === params.requestId)
  const reason = params.reason.trim()
  if (!target || target.status !== "approved" || target.lifecycleStatus === "cancelled" || target.requestedPlan === params.packageId || reason.length < 3) return null

  const previous = target.requestedPlan
  saveMockPlatformAdminRequests(requests.map((item) => (item.id === target.id ? { ...item, requestedPlan: params.packageId } : item)))

  const upgrades = loadMockPackageUpgradeRequests()
  const closed = upgrades.find((item) => item.tenantId === target.provisionedTenantId && item.status === "pending" && item.requestedPackage === params.packageId)
  if (closed) {
    saveMockPackageUpgradeRequests(
      upgrades.map((item) => (item.id === closed.id ? { ...item, status: "approved" as const, reviewNotes: reason, reviewedAt: new Date().toISOString() } : item)),
    )
  }

  insertAuditEvent({
    actorUserId: null,
    actorEmail: getCurrentActorEmail(),
    actorRole: "platform-admin",
    action: "tenant_package_changed",
    target: target.organizationName,
    detail: `Package changed from ${previous} to ${params.packageId}.`,
    metadata: {
      requestId: target.id,
      tenantId: target.provisionedTenantId,
      previousPackage: previous,
      currentPackage: previous,
      requestedPackage: params.packageId,
      reviewNotes: reason,
    },
  })

  return previous
}

export type MockFailedNotificationEmail = {
  id: string
  tenantId: string | null
  tenantName: string | null
  recipientEmail: string | null
  eventType: string
  subject: string
  lastError: string | null
  attempts: number
  createdAt: string
  willRetry: boolean
  canRetry: boolean
}

const PLATFORM_ADMIN_FAILED_EMAILS_KEY = "pacelab:platform-admin:failed-emails"

/** Demo mode has no email queue. This list is empty unless a demo or a test put rows in it. */
export function loadMockFailedNotificationEmails(): MockFailedNotificationEmail[] {
  const rows = loadStorage<MockFailedNotificationEmail[]>(PLATFORM_ADMIN_FAILED_EMAILS_KEY, [])
  return Array.isArray(rows) ? rows : []
}

/** Demo version of "Try again": the email leaves the failed list as if it had been sent. */
export function retryMockFailedNotificationEmail(id: string) {
  const rows = loadMockFailedNotificationEmails()
  const target = rows.find((row) => row.id === id)
  if (!target || !target.canRetry) return false
  saveStorage(PLATFORM_ADMIN_FAILED_EMAILS_KEY, rows.filter((row) => row.id !== id))
  insertAuditEvent({
    actorUserId: null,
    actorEmail: getCurrentActorEmail(),
    actorRole: "platform-admin",
    action: "notification_email_retry_requested",
    target: target.tenantName ?? "platform",
    detail: "A failed notification email was put back in the queue.",
    metadata: { notificationEventId: target.id, tenantId: target.tenantId, eventType: target.eventType },
  })
  return true
}
