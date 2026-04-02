"use client"

import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { HugeiconsIcon } from "@hugeicons/react"
import { Building06Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { EmptyStateCard } from "@/components/ui/empty-state-card"
import { StandardPageHeader } from "@/components/ui/standard-page-header"
import { getPackageById } from "@/lib/billing/package-catalog"
import {
  getPlatformAdminRequestQueue,
  setTenantRequestLifecycleState,
  type PlatformAdminRequestRecord,
} from "@/lib/data/platform-admin/ops-data"
import type { TenantBillingStatus, TenantLifecycleStatus } from "@/lib/tenant/lifecycle"

function formatDateLabel(value: string | null, emptyLabel = "Not available") {
  if (!value) return emptyLabel
  return new Date(value).toLocaleString()
}

function getLifecycleLabel(status: TenantLifecycleStatus | null) {
  switch (status) {
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

function getBillingLabel(status: TenantBillingStatus | null) {
  switch (status) {
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

function getLifecycleChipClass(status: TenantLifecycleStatus | null) {
  if (status === "active") return "status-chip-success"
  if (status === "active_onboarding") return "status-chip-info"
  if (status === "approved_pending_billing") return "status-chip-warning"
  if (status === "billing_failed" || status === "suspended" || status === "cancelled") return "status-chip-danger"
  return "status-chip-neutral"
}

function getBillingChipClass(status: TenantBillingStatus | null) {
  if (status === "active" || status === "mocked_complete") return "status-chip-success"
  if (status === "pending") return "status-chip-warning"
  if (status === "failed" || status === "past_due" || status === "cancelled") return "status-chip-danger"
  return "status-chip-neutral"
}

function MetaCard({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-950">{value}</p>
      {detail ? <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p> : null}
    </div>
  )
}

export default function PlatformAdminTenantsPage() {
  const [requests, setRequests] = useState<PlatformAdminRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      const result = await getPlatformAdminRequestQueue()
      if (cancelled) return

      if (!result.ok) {
        setError(result.error.message)
        setInfo(null)
        setLoading(false)
        return
      }

      setRequests(result.data)
      setError(null)
      setInfo(null)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const tenantRecords = useMemo(
    () =>
      requests.filter(
        (item) =>
          Boolean(item.provisionedTenantId) ||
          item.lifecycleStatus === "approved_pending_billing" ||
          item.lifecycleStatus === "billing_failed" ||
          item.lifecycleStatus === "active_onboarding" ||
          item.lifecycleStatus === "active" ||
          item.lifecycleStatus === "suspended" ||
          item.lifecycleStatus === "cancelled",
      ),
    [requests],
  )

  const summary = useMemo(
    () => ({
      billingPending: tenantRecords.filter((item) => item.lifecycleStatus === "approved_pending_billing").length,
      onboarding: tenantRecords.filter((item) => item.lifecycleStatus === "active_onboarding").length,
      active: tenantRecords.filter((item) => item.lifecycleStatus === "active").length,
      suspended: tenantRecords.filter((item) => item.lifecycleStatus === "suspended").length,
    }),
    [tenantRecords],
  )

  const handleLifecycleChange = async (
    request: PlatformAdminRequestRecord,
    lifecycleStatus: TenantLifecycleStatus,
    billingStatus?: TenantBillingStatus | null,
  ) => {
    setSubmittingId(request.id)
    const result = await setTenantRequestLifecycleState({
      requestId: request.id,
      lifecycleStatus,
      billingStatus,
    })

    if (!result.ok) {
      setError(result.error.message)
      setInfo(null)
      setSubmittingId(null)
      return
    }

    setRequests((current) =>
      current.map((item) =>
        item.id === request.id
          ? {
              ...item,
              previousLifecycleStatus: lifecycleStatus === "suspended" ? item.lifecycleStatus : item.previousLifecycleStatus,
              lifecycleStatus,
              billingStatus: billingStatus ?? item.billingStatus,
            }
          : item,
      ),
    )
    setError(null)
    setInfo(`${request.organizationName} updated to ${getLifecycleLabel(lifecycleStatus)}.`)
    setSubmittingId(null)
  }

  return (
    <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
      <StandardPageHeader
        variant="admin"
        eyebrow="Platform admin tenants"
        title="Operate live tenants after intake is done."
        description="This page is for provisioned and post-approval tenants. Keep intake on Requests. Use this surface to track activation, onboarding, billing gates, and suspension state."
        stats={[
          { label: "Billing pending", value: summary.billingPending },
          { label: "Onboarding", value: summary.onboarding },
          { label: "Active", value: summary.active },
          { label: "Suspended", value: summary.suspended },
        ]}
      />

      {error ? (
        <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </section>
      ) : null}
      {info ? (
        <section className="rounded-[22px] border border-[#cfe2ff] bg-[#f6faff] px-4 py-3 text-sm text-[#1553b7]">
          {info}
        </section>
      ) : null}

      {loading ? (
        <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-8 text-sm text-slate-500 shadow-sm">
          Loading tenant operations...
        </section>
      ) : null}

      {!loading && tenantRecords.length === 0 ? (
        <EmptyStateCard
          eyebrow="Provisioned tenants"
          title="No tenant records are in the post-intake state yet."
          description="Approved and provisioned organizations will appear here after they leave the request-review stage."
          icon={<HugeiconsIcon icon={Building06Icon} className="size-5" />}
          actions={
            <Link
              to="/platform-admin/requests"
              className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
            >
              Open requests
            </Link>
          }
        />
      ) : null}

      {!loading && tenantRecords.length > 0 ? (
        <section className="space-y-4">
          {tenantRecords.map((request) => {
            const packageInfo = getPackageById(request.requestedPlan)
            const isSuspended = request.lifecycleStatus === "suspended"
            const canSuspend =
              request.lifecycleStatus === "active" || request.lifecycleStatus === "active_onboarding"
            const canReactivate = request.lifecycleStatus === "suspended"

            return (
              <article
                key={request.id}
                className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`${getLifecycleChipClass(request.lifecycleStatus)} rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]`}>
                        {getLifecycleLabel(request.lifecycleStatus)}
                      </span>
                      <span className={`${getBillingChipClass(request.billingStatus)} rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]`}>
                        Billing: {getBillingLabel(request.billingStatus)}
                      </span>
                      {request.provisionedTenantId ? (
                        <span className="status-chip-neutral rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
                          Tenant ready
                        </span>
                      ) : null}
                    </div>

                    <div>
                      <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">{request.organizationName}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {request.requestorName} · {request.requestorEmail}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <MetaCard
                        label="Package"
                        value={packageInfo?.label ?? request.requestedPlan}
                        detail={`${request.expectedSeats} projected seats`}
                      />
                      <MetaCard
                        label="Tenant"
                        value={request.provisionedTenantId ?? "Not provisioned yet"}
                        detail={request.provisionedTenantId ? "Provisioning record exists." : "Awaiting or retrying provisioning."}
                      />
                      <MetaCard
                        label="Billing contact"
                        value={request.billingContactName?.trim() || "Not captured yet"}
                        detail={request.billingContactEmail ?? "No billing contact email yet"}
                      />
                      <MetaCard
                        label="Started"
                        value={formatDateLabel(request.billingStartedAt, formatDateLabel(request.accessInviteSentAt, "Not started"))}
                        detail={
                          isSuspended
                            ? `Previously ${getLifecycleLabel(request.previousLifecycleStatus)}`
                            : `Created ${formatDateLabel(request.createdAt)}`
                        }
                      />
                    </div>
                  </div>

                  <div className="flex w-full max-w-[360px] flex-wrap gap-2 lg:justify-end">
                    <Link
                      to="/platform-admin/billing"
                      className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
                    >
                      Open billing
                    </Link>
                    <Link
                      to="/platform-admin/commercial"
                      className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
                    >
                      Open commercial
                    </Link>
                    {canSuspend ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-full border-slate-200 px-4"
                        disabled={submittingId === request.id}
                        onClick={() =>
                          void handleLifecycleChange(
                            request,
                            "suspended",
                            request.billingStatus ?? (request.lifecycleStatus === "active" ? "active" : "mocked_complete"),
                          )
                        }
                      >
                        Suspend tenant
                      </Button>
                    ) : null}
                    {canReactivate ? (
                      <Button
                        type="button"
                        className="h-10 rounded-full px-4"
                        disabled={submittingId === request.id}
                        onClick={() =>
                          void handleLifecycleChange(
                            request,
                            request.previousLifecycleStatus ?? "active",
                            request.billingStatus ?? "active",
                          )
                        }
                      >
                        Reactivate tenant
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      ) : null}
    </div>
  )
}
