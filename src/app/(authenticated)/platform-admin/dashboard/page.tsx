"use client"

import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { CreditCardIcon, Notification01Icon, Search01Icon, UserGroupIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { EmptyStateCard } from "@/components/ui/empty-state-card"
import { StandardPageHeader } from "@/components/ui/standard-page-header"
import {
  getPlatformAdminPackageUpgradeRequests,
  getPlatformAdminRequestQueue,
  getPlatformAuditEvents,
  type PlatformAdminPackageUpgradeRequestRecord,
  type PlatformAdminRequestRecord,
  type PlatformAuditEventRecord,
} from "@/lib/data/platform-admin/ops-data"
import type { TenantBillingStatus, TenantLifecycleStatus } from "@/lib/tenant/lifecycle"

function formatDateLabel(value: string | null, fallback = "Not available") {
  if (!value) return fallback
  return new Date(value).toLocaleString()
}

function getLifecycleLabel(value: TenantLifecycleStatus | null) {
  switch (value) {
    case "approved_pending_billing":
      return "Billing pending"
    case "billing_failed":
      return "Billing failed"
    case "active_onboarding":
      return "Onboarding"
    case "active":
      return "Active"
    case "suspended":
      return "Suspended"
    case "cancelled":
      return "Cancelled"
    case "pending_review":
    default:
      return "Pending review"
  }
}

function getLifecycleChipClass(value: TenantLifecycleStatus | null) {
  if (value === "active") return "status-chip-success"
  if (value === "active_onboarding") return "status-chip-info"
  if (value === "approved_pending_billing") return "status-chip-warning"
  if (value === "billing_failed" || value === "suspended" || value === "cancelled") return "status-chip-danger"
  return "status-chip-neutral"
}

function getBillingLabel(value: TenantBillingStatus | null) {
  switch (value) {
    case "mocked_complete":
      return "Mocked complete"
    case "active":
      return "Active"
    case "past_due":
      return "Past due"
    case "failed":
      return "Failed"
    case "cancelled":
      return "Cancelled"
    case "pending":
    default:
      return "Pending"
  }
}

function getBillingChipClass(value: TenantBillingStatus | null) {
  if (value === "active" || value === "mocked_complete") return "status-chip-success"
  if (value === "pending") return "status-chip-warning"
  if (value === "failed" || value === "past_due" || value === "cancelled") return "status-chip-danger"
  return "status-chip-neutral"
}

export default function PlatformAdminDashboardPage() {
  const [requests, setRequests] = useState<PlatformAdminRequestRecord[]>([])
  const [auditEvents, setAuditEvents] = useState<PlatformAuditEventRecord[]>([])
  const [upgradeRequests, setUpgradeRequests] = useState<PlatformAdminPackageUpgradeRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      const [requestsResult, auditResult, upgradesResult] = await Promise.all([
        getPlatformAdminRequestQueue(),
        getPlatformAuditEvents(12),
        getPlatformAdminPackageUpgradeRequests(),
      ])

      if (cancelled) return

      if (!requestsResult.ok) {
        setError(requestsResult.error.message)
        setLoading(false)
        return
      }

      if (!auditResult.ok) {
        setError(auditResult.error.message)
        setLoading(false)
        return
      }

      if (!upgradesResult.ok) {
        setError(upgradesResult.error.message)
        setLoading(false)
        return
      }

      setRequests(requestsResult.data)
      setAuditEvents(auditResult.data)
      setUpgradeRequests(upgradesResult.data)
      setError(null)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const summary = useMemo(() => {
    const pending = requests.filter((item) => item.status === "pending").length
    const billingPending = requests.filter((item) => item.lifecycleStatus === "approved_pending_billing").length
    const active = requests.filter((item) => item.lifecycleStatus === "active").length
    const upgradeQueue = upgradeRequests.filter((item) => item.status === "pending").length

    return { pending, billingPending, active, upgradeQueue }
  }, [requests, upgradeRequests])

  const recentPending = useMemo(() => requests.filter((item) => item.status === "pending").slice(0, 4), [requests])
  const tenantRecords = useMemo(
    () =>
      requests
        .filter(
          (item) =>
            Boolean(item.provisionedTenantId) ||
            item.lifecycleStatus === "approved_pending_billing" ||
            item.lifecycleStatus === "billing_failed" ||
            item.lifecycleStatus === "active_onboarding" ||
            item.lifecycleStatus === "active" ||
            item.lifecycleStatus === "suspended",
        )
        .slice(0, 4),
    [requests],
  )
  const billingRecords = useMemo(
    () =>
      requests
        .filter(
          (item) =>
            item.billingStatus !== null ||
            item.lifecycleStatus === "approved_pending_billing" ||
            item.lifecycleStatus === "billing_failed" ||
            Boolean(item.provisionedTenantId),
        )
        .slice(0, 4),
    [requests],
  )
  const recentUpgradeRequests = useMemo(() => upgradeRequests.slice(0, 4), [upgradeRequests])
  const recentAudit = useMemo(() => auditEvents.slice(0, 5), [auditEvents])
  const headerStats = [
    { label: "Pending", value: summary.pending },
    { label: "Billing pending", value: summary.billingPending },
    { label: "Active", value: summary.active },
    { label: "Upgrade queue", value: summary.upgradeQueue },
  ]

  return (
    <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
      <StandardPageHeader
        variant="admin"
        eyebrow="Platform admin dashboard"
        title="System control, without tenant leakage."
        description="This surface tracks new organization intake, provisioning progress, and the platform-level audit trail before tenant ownership even exists."
        stats={headerStats}
      />

      {error ? (
        <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </section>
      ) : null}

      {loading ? (
        <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-8 text-sm text-slate-500 shadow-sm">
          Loading platform dashboard...
        </section>
      ) : null}

      {!loading ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Request queue</h2>
                <p className="text-sm text-slate-500">The latest org requests still awaiting action.</p>
              </div>
              <Link
                to="/platform-admin/requests"
                className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Open queue
              </Link>
            </div>

            <div className="mt-5 space-y-3">
              {recentPending.length === 0 ? (
                <EmptyStateCard
                  eyebrow="Request queue"
                  title="No pending tenant requests right now."
                  description="The intake queue is clear. New organization requests will appear here before a tenant is provisioned."
                  hint="Check the full queue for approved or rejected history, or wait for the next public request submission."
                  icon={<HugeiconsIcon icon={Notification01Icon} className="size-5" />}
                  className="rounded-[22px] bg-slate-50 px-4 py-5 shadow-none"
                  contentClassName="gap-3"
                  actions={
                    <Link
                      to="/platform-admin/requests"
                      className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
                    >
                      Open full queue
                    </Link>
                  }
                />
              ) : (
                recentPending.map((request) => (
                  <div key={request.id} className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold tracking-[-0.03em] text-slate-950">{request.organizationName}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {request.requestorName} · {request.requestorEmail}
                        </p>
                      </div>
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">
                        Pending
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Plan / Seats</p>
                        <p className="mt-1 text-sm font-medium text-slate-950">
                          {request.requestedPlan} / {request.expectedSeats}
                        </p>
                      </div>
                      <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Submitted</p>
                        <p className="mt-1 text-sm font-medium text-slate-950">{formatDateLabel(request.createdAt)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Tenants</h2>
                <p className="text-sm text-slate-500">Live tenant state after approval and provisioning.</p>
              </div>
              <Link
                to="/platform-admin/tenants"
                className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Open tenants
              </Link>
            </div>

            <div className="mt-5 space-y-3">
              {tenantRecords.length === 0 ? (
                <EmptyStateCard
                  eyebrow="Tenants"
                  title="No active tenant operations yet."
                  description="Once an organization leaves intake and enters billing, onboarding, or active service, it will appear here."
                  icon={<HugeiconsIcon icon={UserGroupIcon} className="size-5" />}
                  className="rounded-[22px] bg-slate-50 px-4 py-5 shadow-none"
                  contentClassName="gap-3"
                  actions={
                    <Link
                      to="/platform-admin/tenants"
                      className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
                    >
                      Open tenant operations
                    </Link>
                  }
                />
              ) : (
                tenantRecords.map((request) => (
                  <div key={request.id} className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold tracking-[-0.03em] text-slate-950">{request.organizationName}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {request.provisionedTenantId ?? "Tenant pending"} · {request.requestorEmail}
                        </p>
                      </div>
                      <span className={`${getLifecycleChipClass(request.lifecycleStatus)} rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]`}>
                        {getLifecycleLabel(request.lifecycleStatus)}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Billing</p>
                        <p className="mt-1 text-sm font-medium text-slate-950">{getBillingLabel(request.billingStatus)}</p>
                      </div>
                      <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Package</p>
                        <p className="mt-1 text-sm font-medium text-slate-950">{request.requestedPlan}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Billing</h2>
                <p className="text-sm text-slate-500">Mocked subscription and billing-state snapshot.</p>
              </div>
              <Link
                to="/platform-admin/billing"
                className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Open billing
              </Link>
            </div>

            <div className="mt-5 space-y-3">
              {billingRecords.length === 0 ? (
                <EmptyStateCard
                  eyebrow="Billing"
                  title="No billing records to review yet."
                  description="Approved organizations enter billing before activation. Once that happens, subscription state will be visible here."
                  icon={<HugeiconsIcon icon={CreditCardIcon} className="size-5" />}
                  className="rounded-[22px] bg-slate-50 px-4 py-5 shadow-none"
                  contentClassName="gap-3"
                  actions={
                    <Link
                      to="/platform-admin/billing"
                      className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
                    >
                      Open billing records
                    </Link>
                  }
                />
              ) : (
                billingRecords.map((request) => (
                  <div key={request.id} className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold tracking-[-0.03em] text-slate-950">{request.organizationName}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {request.billingContactEmail ?? "No billing email"} · {request.billingCycle ?? "cycle not set"}
                        </p>
                      </div>
                      <span className={`${getBillingChipClass(request.billingStatus)} rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]`}>
                        {getBillingLabel(request.billingStatus)}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Seats</p>
                        <p className="mt-1 text-sm font-medium text-slate-950">{request.expectedSeats}</p>
                      </div>
                      <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Started</p>
                        <p className="mt-1 text-sm font-medium text-slate-950">{formatDateLabel(request.billingStartedAt)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Commercial</h2>
                <p className="text-sm text-slate-500">Package upgrades and account expansion requests.</p>
              </div>
              <Link
                to="/platform-admin/commercial"
                className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Open commercial
              </Link>
            </div>

            <div className="mt-5 space-y-3">
              {recentUpgradeRequests.length === 0 ? (
                <EmptyStateCard
                  eyebrow="Commercial"
                  title="No package upgrade requests yet."
                  description="Club-admin package expansion requests will appear here once tenants hit package caps."
                  icon={<HugeiconsIcon icon={Notification01Icon} className="size-5" />}
                  className="rounded-[22px] bg-slate-50 px-4 py-5 shadow-none"
                  contentClassName="gap-3"
                  actions={
                    <Link
                      to="/platform-admin/commercial"
                      className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
                    >
                      Open commercial queue
                    </Link>
                  }
                />
              ) : (
                recentUpgradeRequests.map((request) => (
                  <div key={request.id} className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold tracking-[-0.03em] text-slate-950">{request.organizationName}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {request.currentPackage} to {request.requestedPackage}
                        </p>
                      </div>
                      <span className="status-chip-info rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
                        {request.status}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">{request.reason?.trim() || "No reason provided."}</p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Platform audit</h2>
                <p className="text-sm text-slate-500">System-level request actions across submission, review, and provisioning.</p>
              </div>
              <Link
                to="/platform-admin/audit"
                className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Open audit
              </Link>
            </div>

            <div className="mt-5 space-y-3">
              {recentAudit.length === 0 ? (
                <EmptyStateCard
                  eyebrow="Platform audit"
                  title="No platform audit events recorded yet."
                  description="System-level request submission, review, and provisioning actions will show up here once the intake flow is used."
                  hint="This feed is the pre-tenant audit trail. It should stay separate from club-admin audit history."
                  icon={<HugeiconsIcon icon={Search01Icon} className="size-5" />}
                  className="rounded-[22px] bg-slate-50 px-4 py-5 shadow-none"
                  contentClassName="gap-3"
                  actions={
                    <Link
                      to="/platform-admin/audit"
                      className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
                    >
                      Open audit feed
                    </Link>
                  }
                />
              ) : (
                recentAudit.map((event) => (
                  <div key={event.id} className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold tracking-[-0.03em] text-slate-950">{event.action.replaceAll("_", " ")}</p>
                        <p className="mt-1 text-sm text-slate-500">{event.target}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                        {event.actorRole}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">{event.detail ?? "No detail recorded."}</p>
                    <p className="mt-3 text-xs text-slate-500">{formatDateLabel(event.occurredAt)}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
