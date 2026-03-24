"use client"

import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  getPlatformAdminRequestQueue,
  getPlatformAuditEvents,
  type PlatformAdminRequestRecord,
  type PlatformAuditEventRecord,
} from "@/lib/data/platform-admin/ops-data"

function formatDateLabel(value: string | null, fallback = "Not available") {
  if (!value) return fallback
  return new Date(value).toLocaleString()
}

export default function PlatformAdminDashboardPage() {
  const [requests, setRequests] = useState<PlatformAdminRequestRecord[]>([])
  const [auditEvents, setAuditEvents] = useState<PlatformAuditEventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      const [requestsResult, auditResult] = await Promise.all([getPlatformAdminRequestQueue(), getPlatformAuditEvents(12)])

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

      setRequests(requestsResult.data)
      setAuditEvents(auditResult.data)
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
    const approved = requests.filter((item) => item.status === "approved").length
    const rejected = requests.filter((item) => item.status === "rejected").length
    const provisioned = requests.filter((item) => Boolean(item.provisionedTenantId)).length

    return { pending, approved, rejected, provisioned }
  }, [requests])

  const recentPending = useMemo(() => requests.filter((item) => item.status === "pending").slice(0, 4), [requests])
  const recentAudit = useMemo(() => auditEvents.slice(0, 5), [auditEvents])

  return (
    <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
      <section className="px-1 py-1 sm:px-2 lg:px-3">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-4">
            <h1 className="max-w-[10ch] text-[clamp(2.2rem,5vw,4.75rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-slate-950">
              System control, without tenant leakage.
            </h1>
            <p className="max-w-[60ch] text-sm leading-7 text-slate-600 sm:text-base">
              This surface tracks new organization intake, provisioning progress, and the platform-level audit trail before tenant ownership even exists.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Pending", value: summary.pending },
              { label: "Approved", value: summary.approved },
              { label: "Rejected", value: summary.rejected },
              { label: "Provisioned", value: summary.provisioned },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] px-4 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)]"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#1368ff]">{item.label}</p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

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
                <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                  No pending tenant requests right now.
                </div>
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
                <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                  No platform audit events recorded yet.
                </div>
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
