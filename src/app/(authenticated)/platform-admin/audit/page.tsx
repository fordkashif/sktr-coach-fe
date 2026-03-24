"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getPlatformAuditEvents, logPlatformAdminExport, type PlatformAuditEventRecord } from "@/lib/data/platform-admin/ops-data"

function formatDateLabel(value: string) {
  return new Date(value).toLocaleString()
}

function formatActionLabel(value: string) {
  return value.replaceAll("_", " ")
}

function metadataPreview(value: Record<string, unknown>) {
  const entries = Object.entries(value)
  if (entries.length === 0) return "No metadata"
  return entries
    .slice(0, 3)
    .map(([key, item]) => `${key}: ${String(item)}`)
    .join(" | ")
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function PlatformAdminAuditPage() {
  const [events, setEvents] = useState<PlatformAuditEventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [actionFilter, setActionFilter] = useState<"all" | "tenant_provision_request_submitted" | "tenant_provision_request_reviewed" | "tenant_provision_request_provisioned">("all")

  useEffect(() => {
    let cancelled = false

    const loadEvents = async () => {
      setLoading(true)
      const result = await getPlatformAuditEvents(150)
      if (cancelled) return

      if (!result.ok) {
        setError(result.error.message)
        setLoading(false)
        return
      }

      setEvents(result.data)
      setError(null)
      setLoading(false)
    }

    void loadEvents()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase()

    return events.filter((event) => {
      if (actionFilter !== "all" && event.action !== actionFilter) return false
      if (!query) return true

      return [
        event.action,
        event.target,
        event.actorEmail ?? "",
        event.actorRole,
        event.detail ?? "",
        JSON.stringify(event.metadata),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    })
  }, [events, search, actionFilter])

  const summary = useMemo(() => {
    return {
      total: events.length,
      submissions: events.filter((item) => item.action === "tenant_provision_request_submitted").length,
      reviews: events.filter((item) => item.action === "tenant_provision_request_reviewed").length,
      provisioned: events.filter((item) => item.action === "tenant_provision_request_provisioned").length,
    }
  }, [events])

  const handleExportCsv = async () => {
    const rows = [
      ["Occurred At", "Action", "Target", "Actor Role", "Actor Email", "Detail", "Metadata"],
      ...filteredEvents.map((event) => [
        event.occurredAt,
        event.action,
        event.target,
        event.actorRole,
        event.actorEmail ?? "",
        event.detail ?? "",
        JSON.stringify(event.metadata),
      ]),
    ]
    downloadCsv("platform-admin-audit.csv", rows)

    const auditResult = await logPlatformAdminExport({
      target: "platform-audit",
      format: "csv",
      recordCount: filteredEvents.length,
      filters: {
        search: search.trim() || null,
        action: actionFilter,
      },
    })
    if (!auditResult.ok) setError((current) => current ?? auditResult.error.message)
  }

  const handleExportPdf = async () => {
    window.print()
    const auditResult = await logPlatformAdminExport({
      target: "platform-audit",
      format: "pdf",
      recordCount: filteredEvents.length,
      filters: {
        search: search.trim() || null,
        action: actionFilter,
      },
    })
    if (!auditResult.ok) setError((current) => current ?? auditResult.error.message)
  }

  return (
    <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
      <section className="px-1 py-1 sm:px-2 lg:px-3">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4">
            <h1 className="max-w-[10ch] text-[clamp(2.2rem,5vw,4.75rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-slate-950">
              Platform audit, not tenant guesswork.
            </h1>
            <p className="max-w-[60ch] text-sm leading-7 text-slate-600 sm:text-base">
              This is the system-level trail for request intake, review, and provisioning before a tenant exists. Use it to verify exactly who did what and when.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Events", value: summary.total },
              { label: "Submitted", value: summary.submissions },
              { label: "Reviewed", value: summary.reviews },
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

      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Audit feed</h2>
            <p className="text-sm text-slate-500">Search by action, email, target, or request metadata.</p>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search audit trail"
              className="h-11 w-full rounded-full border-slate-200 bg-slate-50 lg:max-w-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-10 rounded-full border-slate-200 px-4" onClick={() => void handleExportCsv()}>
                Export CSV
              </Button>
              <Button type="button" variant="outline" className="h-10 rounded-full border-slate-200 px-4" onClick={() => void handleExportPdf()}>
                Export PDF
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ["all", "All"],
                ["tenant_provision_request_submitted", "Submitted"],
                ["tenant_provision_request_reviewed", "Reviewed"],
                ["tenant_provision_request_provisioned", "Provisioned"],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  className={
                    actionFilter === value
                      ? "h-10 rounded-full border-[#0f9b63] bg-emerald-50 px-4 text-emerald-700"
                      : "h-10 rounded-full border-slate-200 px-4"
                  }
                  onClick={() => setActionFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-8 text-sm text-slate-500 shadow-sm">
          Loading platform audit feed...
        </section>
      ) : null}

      {!loading && filteredEvents.length === 0 ? (
        <section className="rounded-[28px] border border-dashed border-slate-300 bg-white px-5 py-8 text-sm text-slate-500 shadow-sm">
          No platform audit events matched the current filter.
        </section>
      ) : null}

      <section className="space-y-4">
        {filteredEvents.map((event) => (
          <article
            key={event.id}
            className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                    {formatActionLabel(event.action)}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                    {event.actorRole}
                  </span>
                </div>

                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">{event.target}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {event.actorEmail ?? "System actor"} · {formatDateLabel(event.occurredAt)}
                  </p>
                </div>

                {event.detail ? (
                  <div className="rounded-[22px] border border-slate-200 bg-[#f8fbff] px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Detail</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{event.detail}</p>
                  </div>
                ) : null}
              </div>

              <div className="w-full max-w-[360px] rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Metadata</p>
                <p className="mt-3 text-sm leading-6 text-slate-700">{metadataPreview(event.metadata)}</p>
                <pre className="mt-4 overflow-x-auto rounded-[18px] bg-slate-950/95 px-4 py-3 text-xs leading-6 text-slate-100">
                  {JSON.stringify(event.metadata, null, 2)}
                </pre>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
