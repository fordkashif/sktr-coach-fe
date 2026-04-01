"use client"

import { ArrowDown01Icon, FilePasteIcon, FilterHorizontalIcon, TextCreationIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { EmptyStateCard } from "@/components/ui/empty-state-card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getPlatformAuditEvents, logPlatformAdminExport, type PlatformAuditEventRecord } from "@/lib/data/platform-admin/ops-data"
import { cn } from "@/lib/utils"

function formatDateLabel(value: string) {
  return new Date(value).toLocaleString()
}

function formatActionLabel(value: string) {
  return value.replaceAll("_", " ")
}

function metadataPreview(value: Record<string, unknown>) {
  const entries = Object.entries(value).filter(([, item]) => typeof item !== "object" || item === null)
  if (entries.length === 0) return []
  return entries.slice(0, 6).map(([key, item]) => ({
    label: key.replaceAll("_", " "),
    value: String(item ?? "None"),
  }))
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

const actionFilterLabels = {
  all: "All events",
  tenant_provision_request_submitted: "Submitted",
  tenant_provision_request_reviewed: "Reviewed",
  tenant_provision_request_provisioned: "Provisioned",
} as const

const toolbarIconButtonClassName =
  "size-11 rounded-2xl border-slate-200 bg-white text-slate-700 shadow-none hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"

function EventBadge({ action }: { action: PlatformAuditEventRecord["action"] }) {
  const label = formatActionLabel(action)
  const tone =
    action === "tenant_provision_request_submitted"
      ? "status-chip-warning"
      : action === "tenant_provision_request_reviewed"
        ? "status-chip-info"
        : "status-chip-success"

  return <span className={cn("rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]", tone)}>{label}</span>
}

export default function PlatformAdminAuditPage() {
  const [events, setEvents] = useState<PlatformAuditEventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState<
    "all" | "tenant_provision_request_submitted" | "tenant_provision_request_reviewed" | "tenant_provision_request_provisioned"
  >("all")

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
  const hasFilters = search.trim().length > 0 || actionFilter !== "all"

  useEffect(() => {
    if (filteredEvents.length === 0) {
      setExpandedEventId(null)
      return
    }

    if (expandedEventId && !filteredEvents.some((item) => item.id === expandedEventId)) {
      setExpandedEventId(null)
    }
  }, [expandedEventId, filteredEvents])

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
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 sm:block">
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Audit feed</h2>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className={cn("sm:hidden", toolbarIconButtonClassName)}
                      aria-label="Open audit actions"
                    >
                      <HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Audit actions</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => setActionFilter("all")}>Show all events</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setActionFilter("tenant_provision_request_submitted")}>Show submitted</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setActionFilter("tenant_provision_request_reviewed")}>Show reviewed</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setActionFilter("tenant_provision_request_provisioned")}>Show provisioned</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => void handleExportCsv()}>Export CSV</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void handleExportPdf()}>Export PDF</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="max-w-[64ch] text-sm text-slate-500">Search by action, email, target, or request metadata.</p>
              <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-500">
                Event: <span className="ml-1 font-medium text-slate-700">{actionFilterLabels[actionFilter]}</span>
              </div>
            </div>

            <div className="hidden items-center gap-2 sm:flex">
              <Tooltip>
                <DropdownMenu>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className={cn(
                          toolbarIconButtonClassName,
                          actionFilter !== "all" && "border-[#1368ff] bg-[#eef5ff] text-[#1368ff]",
                        )}
                        aria-label={`Filter audit events. Current filter: ${actionFilterLabels[actionFilter]}`}
                      >
                        <HugeiconsIcon icon={FilterHorizontalIcon} className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Event filter</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={actionFilter}
                      onValueChange={(value) =>
                        setActionFilter(
                          value as "all" | "tenant_provision_request_submitted" | "tenant_provision_request_reviewed" | "tenant_provision_request_provisioned",
                        )
                      }
                    >
                      <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="tenant_provision_request_submitted">Submitted</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="tenant_provision_request_reviewed">Reviewed</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="tenant_provision_request_provisioned">Provisioned</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <TooltipContent side="bottom">Filter events</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className={toolbarIconButtonClassName}
                    aria-label="Export audit feed as CSV"
                    onClick={() => void handleExportCsv()}
                  >
                    <HugeiconsIcon icon={FilePasteIcon} className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Export CSV</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className={toolbarIconButtonClassName}
                    aria-label="Open print or PDF export for audit feed"
                    onClick={() => void handleExportPdf()}
                  >
                    <HugeiconsIcon icon={TextCreationIcon} className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Export PDF</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="pt-1">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search audit trail"
              className="h-12 rounded-full border-slate-200 bg-slate-50 px-5 text-base lg:max-w-2xl"
            />
          </div>
        </div>
      </section>

      {loading ? (
        <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-8 text-sm text-slate-500 shadow-sm">
          Loading platform audit feed...
        </section>
      ) : null}

      {!loading && filteredEvents.length === 0 ? (
        <EmptyStateCard
          eyebrow="Audit feed"
          title={hasFilters ? "No platform audit events matched this filter." : "No platform audit events recorded yet."}
          description={
            hasFilters
              ? "No platform audit events matched the current filter. Adjust the event filter or search terms to inspect a different slice of platform activity."
              : "No platform audit events matched the current filter. New request submissions, reviews, and provisioning actions will appear here once the intake pipeline is used."
          }
          hint={
            hasFilters
              ? "This page should distinguish between no data and no results. Right now you are in the no-results branch."
              : "Use this feed to verify request intake and provisioning actions before tenant ownership exists."
          }
          icon={<HugeiconsIcon icon={FilterHorizontalIcon} className="size-5" />}
          actions={
            hasFilters ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-full border-slate-200 px-5"
                onClick={() => {
                  setSearch("")
                  setActionFilter("all")
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : null}

      <section className="space-y-4">
        {filteredEvents.map((event) => {
          const isExpanded = expandedEventId === event.id
          const metadataItems = metadataPreview(event.metadata)

          return (
            <article
              key={event.id}
              className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6"
            >
              <div className="space-y-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <EventBadge action={event.action} />
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                        {event.actorRole}
                      </span>
                    </div>

                    <div>
                      <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">{event.target}</h2>
                      <p className="mt-1 text-sm text-slate-500">{event.actorEmail ?? "System actor"} - {formatDateLabel(event.occurredAt)}</p>
                    </div>

                    <div className={cn("grid gap-3 xl:grid-cols-3", isExpanded ? "grid-cols-1 sm:grid-cols-2" : "hidden sm:grid sm:grid-cols-2")}>
                      <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Action</p>
                        <p className="mt-1 text-sm font-medium text-slate-950">{formatActionLabel(event.action)}</p>
                      </div>
                      <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Actor</p>
                        <p className="mt-1 text-sm font-medium text-slate-950">{event.actorEmail ?? "System actor"}</p>
                      </div>
                      <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Occurred</p>
                        <p className="mt-1 text-sm font-medium text-slate-950">{formatDateLabel(event.occurredAt)}</p>
                      </div>
                    </div>

                    {isExpanded && event.detail ? (
                      <div className="rounded-[22px] border border-slate-200 bg-[#f8fbff] px-4 py-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Detail</p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{event.detail}</p>
                      </div>
                    ) : null}

                    {isExpanded && metadataItems.length > 0 ? (
                      <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Metadata highlights</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {metadataItems.map((item) => (
                            <div key={item.label} className="rounded-[18px] border border-slate-200 bg-white px-4 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
                              <p className="mt-1 break-all text-sm text-slate-800">{item.value}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="w-full max-w-[320px] rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {isExpanded ? "Event detail" : "Quick review"}
                    </p>
                    {!isExpanded ? (
                      <div className="mt-3 space-y-3">
                        <p className="text-sm leading-6 text-slate-600">
                          {event.detail ?? (metadataItems.length > 0 ? `${metadataItems.length} metadata fields available.` : "Open this event to inspect its details.")}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 w-full rounded-full border-slate-200"
                          onClick={() => setExpandedEventId(event.id)}
                        >
                          View details
                          <HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 w-full rounded-full border-slate-200"
                          onClick={() => setExpandedEventId(null)}
                        >
                          Collapse event
                          <HugeiconsIcon icon={ArrowDown01Icon} className="size-4 rotate-180" />
                        </Button>
                        <div className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                          <p className="font-medium text-slate-950">Frontend rule</p>
                          <p className="mt-1 leading-6">Raw audit JSON is intentionally hidden here. Exports retain the full payload for controlled admin use.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </article>
          )
        })}
      </section>
    </div>
  )
}

