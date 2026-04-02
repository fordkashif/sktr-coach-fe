"use client"

import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { HugeiconsIcon } from "@hugeicons/react"
import { Invoice03Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { EmptyStateCard } from "@/components/ui/empty-state-card"
import { StandardPageHeader } from "@/components/ui/standard-page-header"
import { getPackageById } from "@/lib/billing/package-catalog"
import {
  getPlatformAdminRequestQueue,
  setTenantRequestLifecycleState,
  type PlatformAdminRequestRecord,
} from "@/lib/data/platform-admin/ops-data"
import type { TenantBillingStatus } from "@/lib/tenant/lifecycle"

function formatDateLabel(value: string | null, emptyLabel = "Not available") {
  if (!value) return emptyLabel
  return new Date(value).toLocaleString()
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

export default function PlatformAdminBillingPage() {
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

  const billingRecords = useMemo(
    () =>
      requests.filter(
        (item) =>
          item.billingStatus !== null ||
          item.lifecycleStatus === "approved_pending_billing" ||
          item.lifecycleStatus === "billing_failed" ||
          Boolean(item.provisionedTenantId),
      ),
    [requests],
  )

  const summary = useMemo(
    () => ({
      pending: billingRecords.filter((item) => item.billingStatus === "pending").length,
      active: billingRecords.filter((item) => item.billingStatus === "active" || item.billingStatus === "mocked_complete").length,
      failed: billingRecords.filter((item) => item.billingStatus === "failed" || item.lifecycleStatus === "billing_failed").length,
      annual: billingRecords.filter((item) => item.billingCycle === "annual").length,
    }),
    [billingRecords],
  )

  const handleBillingStatusChange = async (
    request: PlatformAdminRequestRecord,
    lifecycleStatus: PlatformAdminRequestRecord["lifecycleStatus"],
    billingStatus: TenantBillingStatus,
  ) => {
    if (!lifecycleStatus) return
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
              lifecycleStatus,
              billingStatus,
              billingFailedAt: billingStatus === "failed" ? new Date().toISOString() : null,
            }
          : item,
      ),
    )
    setError(null)
    setInfo(`${request.organizationName} billing updated to ${getBillingLabel(billingStatus)}.`)
    setSubmittingId(null)
  }

  return (
    <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
      <StandardPageHeader
        variant="admin"
        eyebrow="Platform admin billing"
        title="Billing and subscription state, without burying it in requests."
        description="Track mocked subscription status, billing contacts, plan cycle, and failure state here. This is the operator view of tenant commercial health."
        stats={[
          { label: "Pending", value: summary.pending },
          { label: "Active", value: summary.active },
          { label: "Failed", value: summary.failed },
          { label: "Annual", value: summary.annual },
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
          Loading billing records...
        </section>
      ) : null}

      {!loading && billingRecords.length === 0 ? (
        <EmptyStateCard
          eyebrow="Billing"
          title="No billing records are in the system yet."
          description="Billing setup starts after request approval. Once tenants enter billing, their package and subscription state will appear here."
          icon={<HugeiconsIcon icon={Invoice03Icon} className="size-5" />}
          actions={
            <Link
              to="/platform-admin/requests"
              className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
            >
              Open request queue
            </Link>
          }
        />
      ) : null}

      {!loading && billingRecords.length > 0 ? (
        <section className="space-y-4">
          {billingRecords.map((request) => {
            const packageInfo = getPackageById(request.requestedPlan)
            const canMarkFailed =
              request.lifecycleStatus === "approved_pending_billing" ||
              request.lifecycleStatus === "active_onboarding" ||
              request.lifecycleStatus === "active"
            const canRetry = request.lifecycleStatus === "billing_failed"

            return (
              <article
                key={request.id}
                className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`${getBillingChipClass(request.billingStatus)} rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]`}>
                        {getBillingLabel(request.billingStatus)}
                      </span>
                      <span className="status-chip-info rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
                        {packageInfo?.label ?? request.requestedPlan}
                      </span>
                      {request.billingCycle ? (
                        <span className="status-chip-neutral rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
                          {request.billingCycle}
                        </span>
                      ) : null}
                    </div>

                    <div>
                      <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">{request.organizationName}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Billing owner: {request.billingContactName?.trim() || "Not set"} · {request.billingContactEmail ?? "No billing email"}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <MetaCard
                        label="Subscription"
                        value={request.billingSubscriptionId ?? "Mocked billing"}
                        detail={request.billingProvider ?? "No external billing provider yet"}
                      />
                      <MetaCard
                        label="Licenses"
                        value={`${request.expectedSeats} seats requested`}
                        detail={`${request.expectedCoachCount ?? 0} coaches · ${request.expectedAthleteCount ?? 0} athletes`}
                      />
                      <MetaCard
                        label="Started"
                        value={formatDateLabel(request.billingStartedAt, "Not started")}
                        detail={request.billingFailedAt ? `Failed ${formatDateLabel(request.billingFailedAt)}` : null}
                      />
                      <MetaCard
                        label="Tenant"
                        value={request.provisionedTenantId ?? "Not provisioned"}
                        detail={request.lifecycleStatus ? `Lifecycle: ${request.lifecycleStatus}` : "Lifecycle not set"}
                      />
                    </div>
                  </div>

                  <div className="flex w-full max-w-[380px] flex-wrap gap-2 lg:justify-end">
                    <Link
                      to="/platform-admin/commercial"
                      className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
                    >
                      Open commercial
                    </Link>
                    <Link
                      to="/platform-admin/tenants"
                      className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700"
                    >
                      Open tenants
                    </Link>
                    {canMarkFailed ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-full border-slate-200 px-4"
                        disabled={submittingId === request.id}
                        onClick={() => void handleBillingStatusChange(request, "billing_failed", "failed")}
                      >
                        Mark billing failed
                      </Button>
                    ) : null}
                    {canRetry ? (
                      <Button
                        type="button"
                        className="h-10 rounded-full px-4"
                        disabled={submittingId === request.id}
                        onClick={() => void handleBillingStatusChange(request, "approved_pending_billing", "pending")}
                      >
                        Retry billing
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
