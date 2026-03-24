"use client"

import {
  ArrowDown01Icon,
  FilePasteIcon,
  FilterHorizontalIcon,
  Notification01Icon,
  SquareIcon,
  TableIcon,
  TextCreationIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
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
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  approveAndProvisionTenantRequest,
  dispatchPendingNotificationEmails,
  getPlatformAdminRequestQueue,
  logPlatformAdminExport,
  previewInitialClubAdminAccessInvite,
  reviewTenantProvisionRequest,
  sendInitialClubAdminAccessInvite,
  type PlatformAdminRequestRecord,
} from "@/lib/data/platform-admin/ops-data"
import { cn } from "@/lib/utils"

function formatDateLabel(value: string | null, emptyLabel = "Not reviewed") {
  if (!value) return emptyLabel
  return new Date(value).toLocaleString()
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

const statusFilterLabels: Record<PlatformAdminRequestRecord["status"] | "all", string> = {
  all: "All statuses",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
}

const toolbarIconButtonClassName =
  "size-11 rounded-2xl border-slate-200 bg-white text-slate-700 shadow-none hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"

function StatusBadge({ status }: { status: PlatformAdminRequestRecord["status"] }) {
  return (
    <span
      className={cn(
        "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
        status === "pending" && "bg-amber-100 text-amber-700",
        status === "approved" && "bg-emerald-100 text-emerald-700",
        status === "rejected" && "bg-rose-100 text-rose-700",
        status === "cancelled" && "bg-slate-100 text-slate-600",
      )}
    >
      {status}
    </span>
  )
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-950">{value}</p>
    </div>
  )
}

export default function PlatformAdminRequestsPage() {
  const [requests, setRequests] = useState<PlatformAdminRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<PlatformAdminRequestRecord["status"] | "all">("all")
  const [desktopViewMode, setDesktopViewMode] = useState<"cards" | "table">("cards")
  const isLocalPreviewEnabled =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")

  useEffect(() => {
    if (typeof window === "undefined") return
    const stored = window.localStorage.getItem("platform-admin-requests-view")
    if (stored === "cards" || stored === "table") setDesktopViewMode(stored)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("platform-admin-requests-view", desktopViewMode)
  }, [desktopViewMode])

  useEffect(() => {
    let cancelled = false

    const loadQueue = async () => {
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

    void loadQueue()
    return () => {
      cancelled = true
    }
  }, [])

  const summary = useMemo(() => {
    const pending = requests.filter((item) => item.status === "pending").length
    const approved = requests.filter((item) => item.status === "approved").length
    const provisioned = requests.filter((item) => Boolean(item.provisionedTenantId)).length
    const inviteReady = requests.filter((item) => Boolean(item.accessInviteSentAt)).length
    return { pending, approved, provisioned, inviteReady }
  }, [requests])

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase()

    return requests.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false
      if (!query) return true

      return [
        item.organizationName,
        item.requestorName,
        item.requestorEmail,
        item.jobTitle ?? "",
        item.organizationType ?? "",
        item.organizationWebsite ?? "",
        item.region ?? "",
        item.requestedPlan,
        item.expectedCoachCount?.toString() ?? "",
        item.expectedAthleteCount?.toString() ?? "",
        item.desiredStartDate ?? "",
        item.notes ?? "",
        item.reviewNotes ?? "",
        item.provisionedTenantId ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    })
  }, [requests, search, statusFilter])

  useEffect(() => {
    if (filteredRequests.length === 0) {
      setExpandedRequestId(null)
      return
    }

    if (expandedRequestId && !filteredRequests.some((item) => item.id === expandedRequestId)) {
      setExpandedRequestId(null)
    }
  }, [expandedRequestId, filteredRequests])

  const handleReview = async (requestId: string, status: "approved" | "rejected") => {
    const target = requests.find((item) => item.id === requestId)
    if (!target) return

    setSubmittingId(requestId)

    if (status === "approved") {
      const result = await approveAndProvisionTenantRequest({
        requestId,
        requestorEmail: target.requestorEmail,
        requestorName: target.requestorName,
        reviewNotes: reviewNotes[requestId],
      })

      if (!result.ok) {
        setError(result.error.message)
        setInfo(null)
        setSubmittingId(null)
        return
      }

      const reviewedAt = new Date().toISOString()
      setRequests((current) =>
        current.map((item) =>
          item.id === requestId
            ? {
                ...item,
                status: "approved",
                reviewNotes: reviewNotes[requestId]?.trim() || null,
                reviewedAt,
                provisionedTenantId: result.data.tenantId,
                accessInviteSentAt: result.data.accessInviteSentAt,
                accessInviteLastError: result.data.accessInviteError,
              }
            : item,
        ),
      )
      setError(result.data.accessInviteError)
      setInfo(
        result.data.accessInviteError
          ? `Tenant provisioned, but initial invite delivery still needs attention for ${target.requestorEmail}.`
          : `Tenant provisioned and initial access invite sent to ${target.requestorEmail}.`,
      )
      setSubmittingId(null)
      return
    }

    const result = await reviewTenantProvisionRequest({
      requestId,
      status,
      reviewNotes: reviewNotes[requestId],
    })

    if (!result.ok) {
      setError(result.error.message)
      setInfo(null)
      setSubmittingId(null)
      return
    }

    const reviewedAt = new Date().toISOString()
    setRequests((current) =>
      current.map((item) =>
        item.id === requestId
          ? {
              ...item,
              status,
              reviewNotes: reviewNotes[requestId]?.trim() || null,
              reviewedAt,
            }
          : item,
      ),
    )
    setError(null)
    setInfo(`Request ${status} for ${target.requestorEmail}.`)
    setSubmittingId(null)
  }

  const handleResendInvite = async (requestId: string) => {
    const target = requests.find((item) => item.id === requestId)
    if (!target || !target.provisionedTenantId) return

    setSubmittingId(requestId)
    const result = await sendInitialClubAdminAccessInvite({
      requestId,
      requestorEmail: target.requestorEmail,
      requestorName: target.requestorName,
      tenantId: target.provisionedTenantId,
    })

    if (!result.ok) {
      setError(result.error.message)
      setInfo(null)
      setRequests((current) =>
        current.map((item) =>
          item.id === requestId
            ? {
                ...item,
                accessInviteLastError: result.error.message,
              }
            : item,
        ),
      )
      setSubmittingId(null)
      return
    }

    setRequests((current) =>
      current.map((item) =>
        item.id === requestId
          ? {
              ...item,
              accessInviteSentAt: result.data.sentAt,
              accessInviteLastError: null,
            }
          : item,
      ),
    )
    setError(null)
    setInfo(`Initial access invite re-sent to ${target.requestorEmail}.`)
    setSubmittingId(null)
  }

  const handleCopyInviteLink = async (requestId: string) => {
    const target = requests.find((item) => item.id === requestId)
    if (!target || !target.provisionedTenantId) return

    setSubmittingId(requestId)
    const result = await previewInitialClubAdminAccessInvite({
      requestId,
      requestorEmail: target.requestorEmail,
      requestorName: target.requestorName,
      tenantId: target.provisionedTenantId,
    })

    if (!result.ok) {
      setError(result.error.message)
      setInfo(null)
      setSubmittingId(null)
      return
    }

    try {
      await navigator.clipboard.writeText(result.data.actionLink)
      setError(null)
      setInfo(`Copied initial access link for ${target.requestorEmail}.`)
    } catch {
      setError("Invite preview generated, but clipboard copy failed.")
      setInfo(result.data.actionLink)
    }

    setSubmittingId(null)
  }

  const handleDispatchPendingEmails = async () => {
    setSubmittingId("dispatch-email-queue")
    const result = await dispatchPendingNotificationEmails({ limit: 25 })

    if (!result.ok) {
      setError(result.error.message)
      setInfo(null)
      setSubmittingId(null)
      return
    }

    const failedCount = result.data.results.filter((item) => item.status === "failed").length
    setError(failedCount > 0 ? `${failedCount} email notification deliveries failed. Review function logs and event rows.` : null)
    setInfo(`Processed ${result.data.processed} pending email notification event(s).`)
    setSubmittingId(null)
  }

  const handleExportQueueCsv = async () => {
    const rows = [
      [
        "Organization",
        "Requestor",
        "Email",
        "Job Title",
        "Organization Type",
        "Website",
        "Region",
        "Plan",
        "Coaches",
        "Athletes",
        "Seats",
        "Target Start",
        "Status",
        "Submitted",
        "Reviewed",
        "Provisioned Tenant",
        "Invite Sent",
      ],
      ...filteredRequests.map((request) => [
        request.organizationName,
        request.requestorName,
        request.requestorEmail,
        request.jobTitle ?? "",
        request.organizationType ?? "",
        request.organizationWebsite ?? "",
        request.region ?? "",
        request.requestedPlan,
        request.expectedCoachCount?.toString() ?? "",
        request.expectedAthleteCount?.toString() ?? "",
        String(request.expectedSeats),
        request.desiredStartDate ?? "",
        request.status,
        request.createdAt,
        request.reviewedAt ?? "",
        request.provisionedTenantId ?? "",
        request.accessInviteSentAt ?? "",
      ]),
    ]
    downloadCsv("platform-admin-request-queue.csv", rows)

    const auditResult = await logPlatformAdminExport({
      target: "request-queue",
      format: "csv",
      recordCount: filteredRequests.length,
      filters: {
        search: search.trim() || null,
        status: statusFilter,
      },
    })
    if (!auditResult.ok) setError((current) => current ?? auditResult.error.message)
    else setInfo(`Exported ${filteredRequests.length} request row(s) to CSV.`)
  }

  const handleExportQueuePdf = async () => {
    window.print()
    const auditResult = await logPlatformAdminExport({
      target: "request-queue",
      format: "pdf",
      recordCount: filteredRequests.length,
      filters: {
        search: search.trim() || null,
        status: statusFilter,
      },
    })
    if (!auditResult.ok) setError((current) => current ?? auditResult.error.message)
    else setInfo(`Opened print/PDF flow for ${filteredRequests.length} request row(s).`)
  }

  const renderRequestActionPanel = (request: PlatformAdminRequestRecord, isExpanded: boolean) => {
    const isPending = request.status === "pending"
    const isSubmitting = submittingId === request.id

    return (
      <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {isExpanded ? "Decision" : "Quick review"}
        </p>
        {!isExpanded ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm leading-6 text-slate-600">
              {isPending ? "Open this request to review and decide." : "Open this request to inspect the full lifecycle."}
            </p>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-full border-slate-200"
              onClick={() => setExpandedRequestId(request.id)}
            >
              {isPending ? "Review request" : "View details"}
              <HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full rounded-full border-slate-200"
              onClick={() => setExpandedRequestId(null)}
            >
              Collapse request
              <HugeiconsIcon icon={ArrowDown01Icon} className="size-4 rotate-180" />
            </Button>
            <Textarea
              rows={5}
              value={reviewNotes[request.id] ?? request.reviewNotes ?? ""}
              onChange={(event) =>
                setReviewNotes((current) => ({
                  ...current,
                  [request.id]: event.target.value,
                }))
              }
              disabled={!isPending || isSubmitting}
              placeholder="Add the review note or provisioning instruction."
              className="rounded-[20px] border-slate-200 bg-white"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                type="button"
                disabled={!isPending || isSubmitting}
                className="h-11 rounded-full bg-[linear-gradient(135deg,#0f9b63_0%,#18b977_100%)] text-white hover:opacity-95"
                onClick={() => void handleReview(request.id, "approved")}
              >
                Approve and provision
              </Button>
              <Button
                type="button"
                disabled={!isPending || isSubmitting}
                variant="outline"
                className="h-11 rounded-full border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-700"
                onClick={() => void handleReview(request.id, "rejected")}
              >
                Reject
              </Button>
            </div>

            {request.provisionedTenantId ? (
              <div className="grid gap-3">
                <Button
                  type="button"
                  disabled={isSubmitting}
                  variant="outline"
                  className="h-11 w-full rounded-full border-slate-200"
                  onClick={() => void handleResendInvite(request.id)}
                >
                  Resend initial access invite
                </Button>
                {isLocalPreviewEnabled ? (
                  <Button
                    type="button"
                    disabled={isSubmitting}
                    variant="outline"
                    className="h-11 w-full rounded-full border-slate-200"
                    onClick={() => void handleCopyInviteLink(request.id)}
                  >
                    Copy initial access link
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  const renderExpandedRequestDetails = (request: PlatformAdminRequestRecord) => (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoPill label="Expected seats" value={String(request.expectedSeats)} />
        <InfoPill
          label="Roster mix"
          value={`${request.expectedCoachCount ?? 0} coaches - ${request.expectedAthleteCount ?? 0} athletes`}
        />
        <InfoPill label="Submitted" value={formatDateLabel(request.createdAt, "Not submitted")} />
        <InfoPill label="Reviewed" value={formatDateLabel(request.reviewedAt)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoPill label="Job title" value={request.jobTitle ?? "Not provided"} />
        <InfoPill label="Organization type" value={request.organizationType ?? "Not provided"} />
        <InfoPill label="Region" value={request.region ?? "Not provided"} />
        <InfoPill
          label="Target start"
          value={request.desiredStartDate ? new Date(request.desiredStartDate).toLocaleDateString() : "Flexible"}
        />
      </div>

      {request.organizationWebsite ? (
        <div className="rounded-[22px] border border-slate-200 bg-[#f8fbff] px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Organization website</p>
          <a
            href={request.organizationWebsite}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block break-all text-sm leading-6 text-[#1368ff] underline-offset-4 hover:underline"
          >
            {request.organizationWebsite}
          </a>
        </div>
      ) : null}

      {request.provisionedTenantId ? (
        <div className="rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Provisioned tenant</p>
          <p className="mt-2 break-all text-sm leading-6 text-emerald-800">{request.provisionedTenantId}</p>
        </div>
      ) : null}

      {request.provisionedTenantId ? (
        <div
          className={cn(
            "rounded-[22px] border px-4 py-4",
            request.accessInviteSentAt ? "border-[#cfe2ff] bg-[#f6faff]" : "border-amber-200 bg-amber-50",
          )}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Initial access invite</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {request.accessInviteSentAt
              ? `Sent ${formatDateLabel(request.accessInviteSentAt, "Unknown time")}`
              : "Invite has not been confirmed as sent yet."}
          </p>
          {request.accessInviteLastError ? <p className="mt-2 text-sm text-rose-700">{request.accessInviteLastError}</p> : null}
        </div>
      ) : null}

      {request.notes ? (
        <div className="rounded-[22px] border border-slate-200 bg-[#f8fbff] px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Request notes</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{request.notes}</p>
        </div>
      ) : null}

      {request.status !== "pending" && request.reviewNotes ? (
        <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Review notes</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{request.reviewNotes}</p>
        </div>
      ) : null}
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
      <section className="px-1 py-1 sm:px-2 lg:px-3">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4">
            <h1 className="max-w-[10ch] text-[clamp(2.2rem,5vw,4.75rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-slate-950">
              Request intake with real review control.
            </h1>
            <p className="max-w-[60ch] text-sm leading-7 text-slate-600 sm:text-base">
              New tenant creation now stops here first. Review the request, provision the tenant, and verify the initial access invite actually went out.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Pending", value: summary.pending },
              { label: "Approved", value: summary.approved },
              { label: "Provisioned", value: summary.provisioned },
              { label: "Invite sent", value: summary.inviteReady },
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
      {info ? (
        <section className="rounded-[22px] border border-[#cfe2ff] bg-[#f6faff] px-4 py-3 text-sm text-[#1553b7]">
          {info}
        </section>
      ) : null}

      {loading ? (
        <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-8 text-sm text-slate-500 shadow-sm">
          Loading request queue...
        </section>
      ) : null}

      {!loading && requests.length === 0 ? (
        <section className="rounded-[28px] border border-dashed border-slate-300 bg-white px-5 py-8 text-sm text-slate-500 shadow-sm">
          No tenant provisioning requests have been submitted yet.
        </section>
      ) : null}

      <section className="flex justify-end">
        <div className="flex w-full flex-col gap-3 rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Queue filters</h2>
              <p className="text-sm text-slate-500">
                Search by organization, requestor, role, region, plan, or tenant id, then narrow the queue by status.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start">
              <div className="hidden items-center gap-3 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 lg:flex">
                <HugeiconsIcon icon={SquareIcon} className={cn("size-4", desktopViewMode === "cards" ? "text-[#1368ff]" : "text-slate-400")} />
                <Switch
                  checked={desktopViewMode === "table"}
                  onCheckedChange={(checked) => setDesktopViewMode(checked ? "table" : "cards")}
                  aria-label="Switch between card and table views for the request queue"
                />
                <HugeiconsIcon icon={TableIcon} className={cn("size-4", desktopViewMode === "table" ? "text-[#1368ff]" : "text-slate-400")} />
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
                            statusFilter !== "all" && "border-[#1368ff] bg-[#eef5ff] text-[#1368ff]",
                          )}
                          aria-label={`Filter requests by status. Current filter: ${statusFilterLabels[statusFilter]}`}
                        >
                          <HugeiconsIcon icon={FilterHorizontalIcon} className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuLabel>Status filter</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={statusFilter}
                        onValueChange={(value) => setStatusFilter(value as PlatformAdminRequestRecord["status"] | "all")}
                      >
                        <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="pending">Pending</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="approved">Approved</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="rejected">Rejected</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="cancelled">Cancelled</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <TooltipContent side="bottom">Filter requests</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className={toolbarIconButtonClassName}
                      aria-label="Export request queue as CSV"
                      onClick={() => void handleExportQueueCsv()}
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
                      aria-label="Open print or PDF export for request queue"
                      onClick={() => void handleExportQueuePdf()}
                    >
                      <HugeiconsIcon icon={TextCreationIcon} className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Export PDF</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className={toolbarIconButtonClassName}
                      disabled={submittingId === "dispatch-email-queue"}
                      aria-label="Dispatch pending notification emails"
                      onClick={() => void handleDispatchPendingEmails()}
                    >
                      <HugeiconsIcon icon={Notification01Icon} className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Dispatch pending emails</TooltipContent>
                </Tooltip>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className={cn("sm:hidden", toolbarIconButtonClassName)}
                    aria-label="Open request queue actions"
                  >
                    <HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Queue actions</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setStatusFilter("all")}>Show all requests</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter("pending")}>Show pending only</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void handleExportQueueCsv()}>Export CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void handleExportQueuePdf()}>Export PDF</DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={submittingId === "dispatch-email-queue"}
                    onClick={() => void handleDispatchPendingEmails()}
                  >
                    Dispatch pending emails
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search request queue"
              className="h-12 rounded-full border-slate-200 bg-slate-50 px-5 text-base lg:max-w-xl lg:flex-1"
            />
            <p className="text-sm text-slate-500">
              Status: <span className="font-medium text-slate-700">{statusFilterLabels[statusFilter]}</span>
            </p>
          </div>
        </div>
      </section>

      <section className={cn("space-y-4", desktopViewMode === "table" && "lg:hidden")}>
        {filteredRequests.map((request) => {
          const isExpanded = expandedRequestId === request.id

          return (
            <article
              key={request.id}
              className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6"
            >
              <div className="space-y-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                        {request.requestedPlan}
                      </span>
                      <StatusBadge status={request.status} />
                      {request.accessInviteSentAt ? (
                        <span className="rounded-full bg-[#dbeafe] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1368ff]">
                          Invite sent
                        </span>
                      ) : null}
                    </div>

                    <div>
                      <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">{request.organizationName}</h2>
                      <p className="mt-1 text-sm text-slate-500">{request.requestorName} - {request.requestorEmail}</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <InfoPill label="Expected seats" value={String(request.expectedSeats)} />
                      <InfoPill
                        label="Roster mix"
                        value={`${request.expectedCoachCount ?? 0} coaches - ${request.expectedAthleteCount ?? 0} athletes`}
                      />
                      <InfoPill label="Submitted" value={formatDateLabel(request.createdAt, "Not submitted")} />
                      <InfoPill
                        label="Target start"
                        value={request.desiredStartDate ? new Date(request.desiredStartDate).toLocaleDateString() : "Flexible"}
                      />
                    </div>

                    {isExpanded ? renderExpandedRequestDetails(request) : null}
                  </div>

                  <div className="w-full max-w-[360px] xl:sticky xl:top-24">{renderRequestActionPanel(request, isExpanded)}</div>
                </div>
              </div>
            </article>
          )
        })}
      </section>

      <section className={cn("hidden", desktopViewMode === "table" && "lg:block")}>
        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white px-4 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] xl:px-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-5 py-4 text-xs uppercase tracking-[0.16em] text-slate-500">Organization</TableHead>
                <TableHead className="px-5 py-4 text-xs uppercase tracking-[0.16em] text-slate-500">Requestor</TableHead>
                <TableHead className="px-5 py-4 text-xs uppercase tracking-[0.16em] text-slate-500">Status</TableHead>
                <TableHead className="px-5 py-4 text-xs uppercase tracking-[0.16em] text-slate-500">Plan</TableHead>
                <TableHead className="px-5 py-4 text-xs uppercase tracking-[0.16em] text-slate-500">Roster</TableHead>
                <TableHead className="px-5 py-4 text-xs uppercase tracking-[0.16em] text-slate-500">Submitted</TableHead>
                <TableHead className="px-5 py-4 text-xs uppercase tracking-[0.16em] text-slate-500">Target start</TableHead>
                <TableHead className="px-5 py-4 text-right text-xs uppercase tracking-[0.16em] text-slate-500">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRequests.flatMap((request) => {
                const isExpanded = expandedRequestId === request.id
                return [
                  <TableRow key={request.id}>
                    <TableCell className="px-5 py-4 align-top">
                      <div className="space-y-1">
                        <p className="font-semibold text-slate-950">{request.organizationName}</p>
                        <p className="text-xs text-slate-500">
                          {request.organizationType ?? "Organization"} - {request.region ?? "No region"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-4 align-top">
                      <div className="space-y-1">
                        <p className="font-medium text-slate-900">{request.requestorName}</p>
                        <p className="text-xs text-slate-500">{request.requestorEmail}</p>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-4 align-top">
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge status={request.status} />
                        {request.accessInviteSentAt ? (
                          <span className="rounded-full bg-[#dbeafe] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1368ff]">
                            Invite sent
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-4 align-top text-sm text-slate-700">{request.requestedPlan}</TableCell>
                    <TableCell className="px-5 py-4 align-top text-sm text-slate-700">
                      {(request.expectedCoachCount ?? 0).toString()} coaches - {(request.expectedAthleteCount ?? 0).toString()} athletes
                    </TableCell>
                    <TableCell className="px-5 py-4 align-top text-sm text-slate-700">{formatDateLabel(request.createdAt, "Not submitted")}</TableCell>
                    <TableCell className="px-5 py-4 align-top text-sm text-slate-700">
                      {request.desiredStartDate ? new Date(request.desiredStartDate).toLocaleDateString() : "Flexible"}
                    </TableCell>
                    <TableCell className="px-5 py-4 align-top text-right">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-full border-slate-200"
                        onClick={() => setExpandedRequestId(isExpanded ? null : request.id)}
                      >
                        {isExpanded ? "Collapse" : request.status === "pending" ? "Review" : "Details"}
                      </Button>
                    </TableCell>
                  </TableRow>,
                  ...(isExpanded
                    ? [
                        <TableRow key={`${request.id}-expanded`} className="bg-slate-50/60">
                          <TableCell colSpan={8} className="px-5 py-5">
                            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                              {renderExpandedRequestDetails(request)}
                              <div>{renderRequestActionPanel(request, true)}</div>
                            </div>
                          </TableCell>
                        </TableRow>,
                      ]
                    : []),
                ]
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}


