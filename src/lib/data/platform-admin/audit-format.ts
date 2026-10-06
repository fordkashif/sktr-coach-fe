import { getPackageById } from "@/lib/billing/package-catalog"
import type { PlatformAdminRequestRecord, PlatformAuditEventRecord } from "@/lib/data/platform-admin/ops-data"
import { tenantLifecycleLabels, type TenantLifecycleStatus } from "@/lib/tenant/lifecycle"

/**
 * Plain words for the platform activity log (platform_audit_events and the mock log).
 * Every action code the database functions, the edge functions and mock mode write is in
 * PLATFORM_ACTION_LABEL. A code that is not listed still shows, as its own words.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ROLE_LABEL: Record<string, string> = {
  "platform-admin": "SKTR team",
  "club-admin": "Club admin",
  requestor: "Signed-in requester",
  "anonymous-requestor": "Sign-up form",
  "public-request": "Sign-up form",
  system: "System",
}

export const PLATFORM_ACTION_LABEL: Record<string, string> = {
  tenant_provision_request_submitted: "Asked for a club workspace",
  tenant_provision_request_reviewed: "Reviewed a club request",
  tenant_provision_request_provisioned: "Created the club workspace",
  tenant_request_lifecycle_updated: "Changed a club's status",
  club_closed: "Closed their club",
  club_reopened: "Reopened a closed club",
  club_deleted: "Deleted a closed club for good",
  club_delete_failed: "Could not delete a closed club",
  personal_data_exported: "Downloaded a copy of their own data",
  tenant_mock_billing_completed: "Finished billing setup",
  tenant_package_upgrade_requested: "Asked for a package change",
  tenant_package_upgrade_reviewed: "Decided a package request",
  tenant_package_changed: "Changed a club's package",
  platform_audit_export_csv: "Downloaded a CSV",
  platform_audit_export_pdf: "Printed a report",
  club_admin_initial_access_invite_resent: "Resent the first sign-in invite",
  club_admin_initial_access_invite_previewed: "Copied the first sign-in link",
  notification_email_dispatched: "Sent a queued email",
  notification_email_retry_requested: "Sent a failed email again",
}

const EXPORT_TARGET_LABEL: Record<string, string> = {
  "platform-audit": "Platform activity",
  "request-queue": "Club requests",
  tenants: "Clubs",
  clubs: "Clubs",
  billing: "Club billing",
}

export function platformActionLabel(action: string) {
  if (PLATFORM_ACTION_LABEL[action]) return PLATFORM_ACTION_LABEL[action]
  const words = action.replaceAll("_", " ").replaceAll("-", " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Activity"
}

export function platformRoleLabel(role: string | null) {
  if (!role) return null
  return ROLE_LABEL[role] ?? role
}

function packageLabel(id: string | null) {
  return getPackageById(id)?.label ?? id ?? "another package"
}

/** First non-empty value among the given metadata keys. The database writes snake_case keys, mock mode camelCase. */
function meta(metadata: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number") return String(value)
  }
  return null
}

function isExport(action: string) {
  return action === "platform_audit_export_csv" || action === "platform_audit_export_pdf"
}

/** Works out which club an event is about. Targets are stored as a club name, a requester email or a club id depending on the action. */
export function resolveAuditClub(event: PlatformAuditEventRecord, requests: PlatformAdminRequestRecord[]) {
  if (isExport(event.action)) return null
  const requestId = meta(event.metadata, "tenant_provision_request_id", "request_id", "requestId")
  const tenantId = meta(event.metadata, "tenant_id", "tenantId") ?? (UUID.test(event.target) ? event.target : null)
  const byRequest = requestId ? requests.find((request) => request.id === requestId) : null
  if (byRequest) return byRequest.organizationName
  const byTenant = tenantId ? requests.find((request) => request.provisionedTenantId === tenantId) : null
  if (byTenant) return byTenant.organizationName
  const named = meta(event.metadata, "organization_name", "organizationName")
  if (named) return named
  if (UUID.test(event.target)) return null
  if (event.target.includes("@")) {
    const matches = requests.filter((request) => request.requestorEmail.toLowerCase() === event.target.toLowerCase())
    return matches.length === 1 ? matches[0].organizationName : null
  }
  if (event.target === "platform") return null
  return event.target || null
}

/** The sentence and the supporting line for one event. */
export function describePlatformAudit(event: PlatformAuditEventRecord): { what: string; note: string | null } {
  const m = event.metadata
  const reviewNote = meta(m, "review_notes", "reviewNotes")
  const quoted = reviewNote ? `Note: ${reviewNote}` : null
  const requesterEmail = meta(m, "requestor_email", "requestorEmail") ?? (event.target.includes("@") ? event.target : null)
  const requester = requesterEmail && requesterEmail !== event.actorEmail ? `Requested by ${requesterEmail}` : null

  switch (event.action) {
    case "tenant_provision_request_submitted": {
      const plan = meta(m, "requested_plan", "requestedPlan")
      const seats = meta(m, "expected_seats", "expectedSeats")
      const parts = [plan ? `${packageLabel(plan)} package` : null, seats ? `${seats} people expected` : null].filter(Boolean)
      return { what: platformActionLabel(event.action), note: [parts.join(", "), requester].filter(Boolean).join(". ") || null }
    }
    case "tenant_provision_request_reviewed": {
      const status = meta(m, "to_status", "status")
      const what = status === "approved" ? "Approved a club request" : status === "rejected" ? "Declined a club request" : platformActionLabel(event.action)
      return { what, note: [requester, quoted].filter(Boolean).join(". ") || null }
    }
    case "tenant_request_lifecycle_updated": {
      const lifecycle = meta(m, "lifecycle_status", "lifecycleStatus")
      const label = lifecycle ? (tenantLifecycleLabels[lifecycle as TenantLifecycleStatus] ?? lifecycle) : null
      return { what: platformActionLabel(event.action), note: [label ? `Now: ${label}` : null, quoted].filter(Boolean).join(". ") || null }
    }
    case "tenant_mock_billing_completed": {
      const cycle = meta(m, "billing_cycle", "billingCycle")
      return {
        what: platformActionLabel(event.action),
        note: `${cycle === "annual" ? "Annual" : cycle === "monthly" ? "Monthly" : "Billing"} cycle chosen. No payment was taken.`,
      }
    }
    case "tenant_package_upgrade_requested":
    case "tenant_package_upgrade_reviewed":
    case "tenant_package_changed": {
      const from = meta(m, "previous_package", "previousPackage", "current_package", "currentPackage")
      const to = meta(m, "requested_package", "requestedPackage")
      const status = meta(m, "status")
      const change = from || to ? `${packageLabel(from)} to ${packageLabel(to)}` : null
      const what =
        event.action === "tenant_package_upgrade_requested" || event.action === "tenant_package_changed"
          ? platformActionLabel(event.action)
          : status === "approved"
            ? "Approved a package change"
            : status === "rejected"
              ? "Declined a package change"
              : status === "cancelled"
                ? "Cancelled a package request"
                : platformActionLabel(event.action)
      const reason = event.action === "tenant_package_changed" && reviewNote ? `Reason: ${reviewNote}` : quoted
      return { what, note: [change, reason].filter(Boolean).join(". ") || null }
    }
    case "platform_audit_export_csv":
    case "platform_audit_export_pdf": {
      const count = meta(m, "record_count", "recordCount")
      const list = EXPORT_TARGET_LABEL[event.target] ?? event.target
      return { what: platformActionLabel(event.action), note: count ? `${list}, ${count} ${count === "1" ? "row" : "rows"}` : list }
    }
    case "tenant_provision_request_provisioned":
      return {
        what: platformActionLabel(event.action),
        note: [requester, "The club still has to finish billing setup before it goes live"].filter(Boolean).join(". ") + ".",
      }
    case "club_admin_initial_access_invite_resent":
    case "club_admin_initial_access_invite_previewed":
    case "notification_email_dispatched":
      return { what: platformActionLabel(event.action), note: requesterEmail ? `For ${requesterEmail}` : null }
    case "notification_email_retry_requested": {
      const kind = meta(m, "event_type", "eventType")
      return { what: platformActionLabel(event.action), note: kind ? `Kind of update: ${kind.replaceAll("_", " ")}` : null }
    }
    default:
      return { what: platformActionLabel(event.action), note: event.detail }
  }
}
