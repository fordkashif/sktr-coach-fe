"use client"

import { useEffect, useState } from "react"
import { Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@/components/ui/button"
import { EmptyStateCard } from "@/components/ui/empty-state-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useClubAdmin } from "@/lib/club-admin-context"
import {
  getClubAdminPackageUpgradeRequests,
  insertAuditEvent,
  upsertClubAdminBillingRecord,
  type ClubAdminPackageUpgradeRequest,
} from "@/lib/data/club-admin/ops-data"
import { getPackageById } from "@/lib/billing/package-catalog"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { cn } from "@/lib/utils"

const BILLING_KEY = "pacelab:billing-profile"

interface BillingProfile {
  plan: "starter" | "pro" | "enterprise"
  seats: number
  renewalDate: string
  paymentMethodLast4: string
}

function loadBilling(): BillingProfile {
  if (typeof window === "undefined") {
    return { plan: "pro", seats: 50, renewalDate: "2026-04-01", paymentMethodLast4: "4242" }
  }
  const raw = window.localStorage.getItem(tenantStorageKey(BILLING_KEY))
  if (!raw) return { plan: "pro", seats: 50, renewalDate: "2026-04-01", paymentMethodLast4: "4242" }
  try {
    return JSON.parse(raw) as BillingProfile
  } catch {
    return { plan: "pro", seats: 50, renewalDate: "2026-04-01", paymentMethodLast4: "4242" }
  }
}

function saveBilling(profile: BillingProfile) {
  window.localStorage.setItem(tenantStorageKey(BILLING_KEY), JSON.stringify(profile))
}

export default function ClubAdminBillingPage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const clubAdmin = useClubAdmin()

  const [billing, setBilling] = useState<BillingProfile>(() =>
    isSupabaseMode
      ? clubAdmin.billingRecord ?? { plan: "pro", seats: 50, renewalDate: "2026-04-01", paymentMethodLast4: "4242" }
      : loadBilling(),
  )
  const [saved, setSaved] = useState(false)
  const [backendLoading, setBackendLoading] = useState(isSupabaseMode && !clubAdmin.billingRecord)
  const [backendError, setBackendError] = useState<string | null>(clubAdmin.billingError)
  const [upgradeRequests, setUpgradeRequests] = useState<ClubAdminPackageUpgradeRequest[]>([])
  const [mockAuditLogger, setMockAuditLogger] = useState<((event: {
    actor: string
    action: string
    target: string
    detail?: string
  }) => void) | null>(null)

  useEffect(() => {
    if (!isSupabaseMode) return
    setBackendLoading(clubAdmin.billingLoading)
    setBackendError(clubAdmin.billingError)
    if (clubAdmin.billingRecord) setBilling(clubAdmin.billingRecord)
  }, [clubAdmin.billingError, clubAdmin.billingLoading, clubAdmin.billingRecord, isSupabaseMode])

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false

    void getClubAdminPackageUpgradeRequests().then((result) => {
      if (cancelled || !result.ok) return
      setUpgradeRequests(result.data)
    })

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  useEffect(() => {
    if (isSupabaseMode) return
    let cancelled = false

    void import("@/lib/mock-audit").then((module) => {
      if (!cancelled) {
        setMockAuditLogger(() => module.logAuditEvent)
      }
    })

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  const invoices = [
    { id: "INV-2026-003", amount: "$299.00", status: "Paid", date: "2026-03-01" },
    { id: "INV-2026-002", amount: "$299.00", status: "Paid", date: "2026-02-01" },
    { id: "INV-2026-001", amount: "$299.00", status: "Paid", date: "2026-01-01" },
  ]
  const hasPaymentMethod = billing.paymentMethodLast4.trim().length > 0
  const hasActivePlan = billing.plan.trim().length > 0

  return (
    <div className="mx-auto w-full max-w-8xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="px-1 py-1 sm:px-2 lg:px-3">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4">
            <h1 className="max-w-[16ch] text-[clamp(2.2rem,5vw,4.75rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-slate-950">
              Billing controls overview.
            </h1>
            <p className="max-w-[60ch] text-sm leading-7 text-slate-600 sm:text-base">
              Manage plan level, seats, payment details, and invoice history.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Plan", value: billing.plan },
              { label: "Seats", value: billing.seats },
              { label: "Renews", value: billing.renewalDate },
              { label: "Card", value: `**** ${billing.paymentMethodLast4}` },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] px-4 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)]"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#1368ff]">
                  {item.label}
                </p>
                <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950 capitalize sm:text-2xl">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {backendError ? (
        <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Backend sync issue: {backendError}
        </section>
      ) : null}
      {isSupabaseMode && backendLoading ? (
        <section className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          Loading billing profile...
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Current Subscription</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Billing Controls</h2>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Plan</Label>
              <Select value={billing.plan} onValueChange={(value) => setBilling((current) => ({ ...current, plan: value as BillingProfile["plan"] }))}>
                <SelectTrigger className="h-12 rounded-[16px] border-slate-200 bg-slate-50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Seats</Label>
              <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" type="number" min={1} value={billing.seats} onChange={(event) => setBilling((current) => ({ ...current, seats: Number(event.target.value) || 1 }))} />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Renewal date</Label>
              <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" type="date" value={billing.renewalDate} onChange={(event) => setBilling((current) => ({ ...current, renewalDate: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Payment method (last 4)</Label>
              <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" value={billing.paymentMethodLast4} maxLength={4} onChange={(event) => setBilling((current) => ({ ...current, paymentMethodLast4: event.target.value }))} />
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <Button
              type="button"
              className="h-12 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
              onClick={async () => {
                if (isSupabaseMode) {
                  const saveResult = await upsertClubAdminBillingRecord(billing)
                  if (!saveResult.ok) {
                    setBackendError(saveResult.error.message)
                    return
                  }
                  clubAdmin.updateCachedBillingRecord(billing)
                  const auditResult = await insertAuditEvent({
                    action: "billing_update",
                    target: "subscription",
                    detail: `${billing.plan} ${billing.seats} seats`,
                  })
                  if (!auditResult.ok) setBackendError((current) => current ?? auditResult.error.message)
                  setSaved(true)
                  return
                }

                saveBilling(billing)
                setSaved(true)
                mockAuditLogger?.({ actor: "club-admin", action: "billing_update", target: "subscription", detail: `${billing.plan} ${billing.seats} seats` })
              }}
            >
              Save billing settings
            </Button>
            {saved ? <p className="text-sm text-[#1f8cff]">Saved.</p> : null}
          </div>
        </div>

        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Subscription Summary</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Current Plan</h2>
          </div>
          <div className="mt-4 grid gap-2">
            {!hasActivePlan ? (
              <EmptyStateCard
                eyebrow="Subscription"
                title="No active billing plan is configured."
                description="This workspace does not currently show an active plan summary."
                hint="Select a plan and save the billing settings to establish the subscription baseline."
                icon={<HugeiconsIcon icon={Search01Icon} className="size-5" />}
                className="rounded-[18px] bg-slate-50 px-4 py-5 shadow-none"
                contentClassName="gap-2"
              />
            ) : (
              <>
                {[
                  { label: "Plan", value: billing.plan },
                  { label: "Seats", value: billing.seats },
                  { label: "Renews", value: billing.renewalDate },
                ].map((item) => (
                  <div key={item.label} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                    <p className="mt-1.5 text-lg font-semibold tracking-[-0.03em] text-slate-950 capitalize">{item.value}</p>
                  </div>
                ))}
              </>
            )}
            {hasPaymentMethod ? (
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Payment method</p>
                <p className="mt-1.5 text-lg font-semibold tracking-[-0.03em] text-slate-950">**** {billing.paymentMethodLast4}</p>
              </div>
            ) : (
              <EmptyStateCard
                eyebrow="Payment method"
                title="No payment method is stored."
                description="Billing is configured without a card reference or payment method summary."
                hint="Enter the card last four digits and save to make the billing record complete."
                icon={<HugeiconsIcon icon={Search01Icon} className="size-5" />}
                className="rounded-[18px] bg-slate-50 px-4 py-5 shadow-none"
                contentClassName="gap-2"
              />
            )}
          </div>
        </div>
      </section>

      <section className="mobile-card-primary">
        <div className="space-y-1 border-b border-slate-200 pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Invoices</p>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Billing History</h2>
        </div>
        <div className="mt-4 space-y-3">
          {invoices.length === 0 ? (
            <EmptyStateCard
              eyebrow="Invoices"
              title="No invoices have been generated yet."
              description="Invoice history will appear here after the first successful billing cycle."
              hint="This is normal for a newly provisioned club or a workspace that has not been billed yet."
              icon={<HugeiconsIcon icon={Search01Icon} className="size-5" />}
              className="rounded-[18px] bg-slate-50 px-4 py-5 shadow-none"
              contentClassName="gap-2"
            />
          ) : (
            invoices.map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div>
                  <p className="font-semibold text-slate-950">{invoice.id}</p>
                  <p className="text-sm text-slate-500">{invoice.date}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-slate-950">{invoice.amount}</p>
                  <span className={cn(invoice.status === "Paid" ? "status-chip-success" : "status-chip-warning")}>{invoice.status}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mobile-card-primary">
        <div className="space-y-1 border-b border-slate-200 pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Package changes</p>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Upgrade history</h2>
        </div>
        <div className="mt-4 space-y-3">
          {upgradeRequests.length === 0 ? (
            <EmptyStateCard
              eyebrow="Upgrades"
              title="No package upgrade requests yet."
              description="Commercial package changes and review decisions will appear here once this tenant requests more capacity."
              hint="This history becomes useful once the tenant grows beyond its current team, coach, or athlete limits."
              icon={<HugeiconsIcon icon={Search01Icon} className="size-5" />}
              className="rounded-[18px] bg-slate-50 px-4 py-5 shadow-none"
              contentClassName="gap-2"
            />
          ) : (
            upgradeRequests.map((request) => (
              <div key={request.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {request.status}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {getPackageById(request.currentPackage)?.label ?? request.currentPackage} to {getPackageById(request.requestedPackage)?.label ?? request.requestedPackage}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-slate-950">
                      Requested {new Date(request.createdAt).toLocaleString()}
                    </p>
                    {request.reason ? <p className="text-sm text-slate-600">{request.reason}</p> : null}
                    {request.reviewNotes ? <p className="text-sm text-slate-600">Review notes: {request.reviewNotes}</p> : null}
                  </div>
                  <div className="text-sm text-slate-500">
                    {request.reviewedAt ? `Reviewed ${new Date(request.reviewedAt).toLocaleString()}` : "Awaiting platform review"}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}



