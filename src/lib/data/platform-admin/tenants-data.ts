import type { TagTone } from "@/components/sk"
import { getPackageById } from "@/lib/billing/package-catalog"
import {
  getPlatformAdminRequestQueue,
  type PlatformAdminRequestRecord,
  type PlatformAuditEventRecord,
} from "@/lib/data/platform-admin/ops-data"
import { ok, type Result } from "@/lib/data/result"
import type { TenantLifecycleStatus } from "@/lib/tenant/lifecycle"

/**
 * Read helpers for the platform admin "Platform" and "Clubs" screens.
 *
 * What a platform admin can read (both modes go through ops-data):
 * - tenant_provision_requests: every row (policy tenant_provision_requests_platform_admin_select).
 * - platform_audit_events: every row.
 * - tenant_package_upgrade_requests: every row.
 * Not readable: tenants, profiles, teams, athletes, club_profiles, notification_events of other
 * people. Those policies are scoped by current_tenant_id() and a platform admin has no profile.
 * So a club here is its provisioning record. Live team, coach and athlete counts come from the
 * get_platform_tenant_sizes() database function (counts only, platform admins only), read through
 * getPlatformTenantSizes() in ops-data. When it is unavailable the sign-up estimates are shown.
 */

export type PlatformClubRecord = PlatformAdminRequestRecord

/** A club is a request that was approved or already has a tenant. Declined requests are not clubs. */
export function isClubRecord(record: PlatformAdminRequestRecord) {
  return Boolean(record.provisionedTenantId) || record.status === "approved"
}

export const LIFECYCLE_ORDER: TenantLifecycleStatus[] = [
  "active",
  "active_onboarding",
  "approved_pending_billing",
  "billing_failed",
  "suspended",
  "cancelled",
  "pending_review",
]

export const LIFECYCLE_META: Record<TenantLifecycleStatus, { label: string; tone: TagTone }> = {
  pending_review: { label: "Waiting for review", tone: "yellow" },
  approved_pending_billing: { label: "Waiting on billing", tone: "yellow" },
  billing_failed: { label: "Billing failed", tone: "coral" },
  active_onboarding: { label: "Onboarding", tone: "yellow" },
  active: { label: "Active", tone: "green" },
  suspended: { label: "Suspended", tone: "coral" },
  cancelled: { label: "Cancelled", tone: "plain" },
}

/** Approved rows written before lifecycle existed have no status: they are waiting on billing. */
export function lifecycleOf(record: PlatformAdminRequestRecord): TenantLifecycleStatus {
  return record.lifecycleStatus ?? (record.status === "approved" ? "approved_pending_billing" : "pending_review")
}

export function lifecycleLabel(status: TenantLifecycleStatus | string | null | undefined) {
  if (!status) return "Unknown"
  return LIFECYCLE_META[status as TenantLifecycleStatus]?.label ?? status.replaceAll("_", " ")
}

export function packageLabel(packageId: string | null | undefined) {
  return getPackageById(packageId)?.label ?? packageId ?? "No package"
}

export async function getPlatformAdminClubs(): Promise<Result<PlatformClubRecord[]>> {
  const result = await getPlatformAdminRequestQueue()
  if (!result.ok) return result
  return ok(result.data.filter(isClubRecord))
}

/** Date with year, in the viewer's own time zone. */
export function formatLocalDate(value: string | null | undefined, fallback = "Not recorded") {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

/** Date with year and time, in the viewer's own time zone. */
export function formatLocalDateTime(value: string | null | undefined, fallback = "Not recorded") {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
}

/** Mock mode writes camelCase metadata keys, the database functions write snake_case. */
function meta(event: PlatformAuditEventRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = event.metadata?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number") return String(value)
  }
  return null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Events of one club, newest first, matched by request id, tenant id or (last resort) name. */
export function clubHistory(events: PlatformAuditEventRecord[], club: PlatformClubRecord) {
  return events.filter((event) => {
    const requestId = meta(event, "requestId", "request_id", "tenant_provision_request_id")
    if (requestId) return requestId === club.id
    const tenantId = meta(event, "tenantId", "tenant_id") ?? (UUID_PATTERN.test(event.target) ? event.target : null)
    if (tenantId) return tenantId === club.provisionedTenantId
    return event.target === club.organizationName
  })
}

/**
 * One plain sentence per audit event. `clubNames` maps tenant id to club name, because some
 * database functions record the tenant id as the target instead of the club name.
 */
export function auditSentence(event: PlatformAuditEventRecord, clubNames?: Map<string, string>) {
  const name = clubNames?.get(event.target) ?? (UUID_PATTERN.test(event.target) ? "A club" : event.target)
  const status = meta(event, "status")

  switch (event.action) {
    case "tenant_provision_request_submitted":
      return `${name} asked to join as a new club.`
    case "tenant_provision_request_reviewed":
      if (status === "approved") return `${name} was approved.`
      if (status === "rejected") return `The request from ${name} was declined.`
      return `The request from ${name} was reviewed.`
    case "tenant_provision_request_provisioned":
      return `${name} was set up as a club.`
    case "club_admin_initial_access_invite_resent":
      return `The club admin invite for ${name} was sent again.`
    case "club_admin_initial_access_invite_previewed":
      return `The club admin invite link for ${name} was previewed.`
    case "notification_email_dispatched":
      return `A notification email was sent for ${name}.`
    case "tenant_mock_billing_completed":
      return `${name} finished billing setup.`
    case "tenant_request_lifecycle_updated": {
      const next = meta(event, "lifecycleStatus", "lifecycle_status")
      return next ? `${name} was moved to ${lifecycleLabel(next).toLowerCase()}.` : `The status of ${name} was changed.`
    }
    case "tenant_package_upgrade_requested": {
      const to = meta(event, "requestedPackage", "requested_package")
      return to ? `${name} asked to move to the ${packageLabel(to)} package.` : `${name} asked for a package change.`
    }
    case "tenant_package_upgrade_reviewed": {
      const to = meta(event, "requestedPackage", "requested_package")
      const what = to ? `The move to ${packageLabel(to)} for ${name}` : `The package change for ${name}`
      if (status === "approved") return `${what} was approved.`
      if (status === "rejected") return `${what} was declined.`
      if (status === "cancelled") return `${what} was cancelled.`
      return `${what} was reviewed.`
    }
    default: {
      if (event.action.startsWith("platform_audit_export_")) {
        const count = meta(event, "recordCount", "record_count")
        const format = event.action.replace("platform_audit_export_", "").toUpperCase()
        return `A ${format} export of ${name.replaceAll("-", " ")} was downloaded${count ? ` (${count} rows)` : ""}.`
      }
      const action = event.action.replaceAll("_", " ")
      return `${action.charAt(0).toUpperCase()}${action.slice(1)}: ${name}.`
    }
  }
}

/** The reason typed with a lifecycle change, when one was recorded. */
export function auditReason(event: PlatformAuditEventRecord) {
  return meta(event, "reviewNotes", "review_notes")
}
