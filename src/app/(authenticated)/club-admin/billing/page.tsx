"use client"

import { useEffect, useState } from "react"
import { ClubAdminNav } from "@/components/club-admin/admin-nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  getClubAdminBillingRecord,
  insertAuditEvent,
  upsertClubAdminBillingRecord,
} from "@/lib/data/club-admin/ops-data"
import { logAuditEvent } from "@/lib/mock-audit"
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

  const [billing, setBilling] = useState<BillingProfile>(() =>
    isSupabaseMode
      ? { plan: "pro", seats: 50, renewalDate: "2026-04-01", paymentMethodLast4: "4242" }
      : loadBilling(),
  )
  const [saved, setSaved] = useState(false)
  const [backendLoading, setBackendLoading] = useState(isSupabaseMode)
  const [backendError, setBackendError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false

    const load = async () => {
      setBackendLoading(true)
      const result = await getClubAdminBillingRecord()
      if (cancelled) return
      if (!result.ok) {
        setBackendError(result.error.message)
        setBackendLoading(false)
        return
      }
      setBilling(result.data)
      setBackendError(null)
      setBackendLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  const invoices = [
    { id: "INV-2026-003", amount: "$299.00", status: "Paid", date: "2026-03-01" },
    { id: "INV-2026-002", amount: "$299.00", status: "Paid", date: "2026-02-01" },
    { id: "INV-2026-001", amount: "$299.00", status: "Paid", date: "2026-01-01" },
  ]

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="page-intro">
        <div className="space-y-3">
          <div>
            <h1 className="page-intro-title">Subscription & Billing</h1>
            <p className="page-intro-copy">Manage plan level, seats, payment details, and invoice history.</p>
          </div>
          <ClubAdminNav />
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
                logAuditEvent({ actor: "club-admin", action: "billing_update", target: "subscription", detail: `${billing.plan} ${billing.seats} seats` })
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
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Payment method</p>
              <p className="mt-1.5 text-lg font-semibold tracking-[-0.03em] text-slate-950">•••• {billing.paymentMethodLast4}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mobile-card-primary">
        <div className="space-y-1 border-b border-slate-200 pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Invoices</p>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Billing History</h2>
        </div>
        <div className="mt-4 space-y-3">
          {invoices.map((invoice) => (
            <div key={invoice.id} className="flex items-center justify-between rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div>
                <p className="font-semibold text-slate-950">{invoice.id}</p>
                <p className="text-sm text-slate-500">{invoice.date}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-slate-950">{invoice.amount}</p>
                <p className={cn("text-sm font-medium", invoice.status === "Paid" ? "text-emerald-600" : "text-amber-600")}>{invoice.status}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
