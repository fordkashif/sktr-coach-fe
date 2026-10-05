export type TenantLifecycleStatus =
  | "pending_review"
  | "approved_pending_billing"
  | "billing_failed"
  | "active_onboarding"
  | "active"
  | "suspended"
  | "cancelled"

export type TenantBillingStatus =
  | "pending"
  | "mocked_complete"
  | "failed"
  | "active"
  | "past_due"
  | "cancelled"

export type TenantOnboardingStep =
  | "club_profile"
  | "branding"
  | "first_team"
  | "coach_access"
  | "review"
  | "complete"

export const tenantLifecycleLabels: Record<TenantLifecycleStatus, string> = {
  pending_review: "Pending review",
  approved_pending_billing: "Approved pending billing",
  billing_failed: "Billing failed",
  active_onboarding: "Active onboarding",
  active: "Active",
  suspended: "Suspended",
  cancelled: "Cancelled",
}

/**
 * A suspended or cancelled club is blocked in the database: current_tenant_id() answers null for
 * its members, so every tenant-scoped read and write returns nothing. The app shows a notice
 * instead of empty screens. Any other status, and a club with no provisioning record, is open.
 */
export function isTenantAccessBlocked(status: string | null | undefined): status is "suspended" | "cancelled" {
  return status === "suspended" || status === "cancelled"
}
