"use client"

import {
  ArrowDown01Icon,
  FilePasteIcon,
  FilterHorizontalIcon,
  MoreHorizontalIcon,
  Notification01Icon,
  SquareIcon,
  TableIcon,
  TextCreationIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { DataSurfaceToolbar } from "@/components/ui/data-surface-toolbar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { EmptyStateCard } from "@/components/ui/empty-state-card"
import { StandardPageHeader } from "@/components/ui/standard-page-header"
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
  setTenantRequestLifecycleState,
  type PlatformAdminRequestRecord,
} from "@/lib/data/platform-admin/ops-data"
import { getPackageById } from "@/lib/billing/package-catalog"
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

const lifecycleLabels: Record<NonNullable<PlatformAdminRequestRecord["lifecycleStatus"]>, string> = {
  pending_review: "Pending review",
  approved_pending_billing: "Billing pending",
  billing_failed: "Billing failed",
  active_onboarding: "Onboarding",
  active: "Active",
  suspended: "Suspended",
  cancelled: "Cancelled",
}

const billingLabels: Record<NonNullable<PlatformAdminRequestRecord["billingStatus"]>, string> = {
  pending: "Pending",
  mocked_complete: "Mocked complete",
  failed: "Failed",
  active: "Active",
  past_due: "Past due",
  cancelled: "Cancelled",
}

const toolbarIconButtonClassName =
  "size-11 rounded-2xl border-slate-200 bg-white text-slate-700 shadow-none hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"

function StatusBadge({ status }: { status: PlatformAdminRequestRecord["status"] }) {
  return (
    <span
      className={cn(
        "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
        status === "pending" && "status-chip-warning",
        status === "approved" && "status-chip-success",
        status === "rejected" && "status-chip-danger",
        status === "cancelled" && "status-chip-neutral",
      )}
    >
      {status}
    </span>
  )
}

function LifecycleBadge({ lifecycleStatus }: { lifecycleStatus: PlatformAdminRequestRecord["lifecycleStatus"] }) {
  if (!lifecycleStatus) {
    return (
      <span className="status-chip-neutral rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
        Lifecycle unknown
      </span>
    )
  }

  return (
    <span
      className={cn(
        "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
        lifecycleStatus === "pending_review" && "status-chip-warning",
        lifecycleStatus === "approved_pending_billing" && "status-chip-info",
        lifecycleStatus === "billing_failed" && "status-chip-danger",
        lifecycleStatus === "active_onboarding" && "status-chip-info",
        lifecycleStatus === "active" && "status-chip-success",
        lifecycleStatus === "suspended" && "status-chip-danger",
        lifecycleStatus === "cancelled" && "status-chip-neutral",
      )}
    >
      {lifecycleLabels[lifecycleStatus]}
    </span>
  )
}

function TablePrimaryStatus({ request }: { request: PlatformAdminRequestRecord }) {
  if (request.status === "pending") return <StatusBadge status="pending" />
  if (request.status === "rejected") return <StatusBadge status="rejected" />
  if (request.status === "cancelled") return <StatusBadge status="cancelled" />
  if (request.lifecycleStatus) return <LifecycleBadge lifecycleStatus={request.lifecycleStatus} />
  return <StatusBadge status={request.status} />
}

function toTitleCaseLabel(value: string | null | undefined, fallback: string) {
  if (!value?.trim()) return fallback
  return value
    .replaceAll("-", " ")
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
}

function RequestSummaryRow({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode
  label: string
  value: string
  detail?: string | null
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-slate-400">{icon}</div>
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-medium leading-5 text-slate-950">{value}</p>
        {detail ? <p className="text-xs leading-5 text-slate-500">{detail}</p> : null}
      </div>
    </div>
  )
}

export default function PlatformAdminRequestsPage() {
  const [requests, setRequests] = useState<PlatformAdminRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [localNotificationLinks, setLocalNotificationLinks] = useState<
    Array<{ id: string; recipientEmail?: string; subject?: string; actionLink?: string }>
  >([])
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<PlatformAdminRequestRecord["status"] | "all">("pending")
  const [desktopViewMode, setDesktopViewMode] = useState<"cards" | "table">("cards")
  const [useDesktopReviewDialog, setUseDesktopReviewDialog] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia("(min-width: 1024px)").matches
  })
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
    if (typeof window === "undefined") return
    const mediaQuery = window.matchMedia("(min-width: 1024px)")
    const sync = (event?: MediaQueryListEvent) => setUseDesktopReviewDialog(event ? event.matches : mediaQuery.matches)
    sync()
    mediaQuery.addEventListener("change", sync)
    return () => mediaQuery.removeEventListener("change", sync)
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadQueue = async () => {
      setLoading(true)
      const requestResult = await getPlatformAdminRequestQueue()
      if (cancelled) return

      if (!requestResult.ok) {
        setError(requestResult.error.message)
        setInfo(null)
        setLoading(false)
        return
      }

      setRequests(requestResult.data)
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
    const billingPending = requests.filter((item) => item.lifecycleStatus === "approved_pending_billing").length
    const onboarding = requests.filter((item) => item.lifecycleStatus === "active_onboarding").length
    const active = requests.filter((item) => item.lifecycleStatus === "active").length
    return { pending, billingPending, onboarding, active }
  }, [requests])
  const headerStats = [
    { label: "Pending", value: summary.pending },
    { label: "Billing pending", value: summary.billingPending },
    { label: "Onboarding", value: summary.onboarding },
    { label: "Active", value: summary.active },
  ]

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
        item.lifecycleStatus ?? "",
        item.billingStatus ?? "",
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
      setActiveRequestId(null)
      return
    }

    if (activeRequestId && !filteredRequests.some((item) => item.id === activeRequestId)) {
      setActiveRequestId(null)
    }
  }, [activeRequestId, filteredRequests])

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
                lifecycleStatus: "approved_pending_billing",
                billingStatus: "pending",
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
          ? `Tenant approved and provisioned for billing setup, but initial invite delivery still needs attention for ${target.requestorEmail}.`
          : result.data.accessInviteActionLink
            ? `Tenant approved for ${target.requestorEmail}. Local dev generated a clickable billing/setup access link instead of sending email.`
            : `Tenant approved and initial billing/setup access invite sent to ${target.requestorEmail}.`,
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
    setInfo(
      result.data.actionLink
        ? `Local dev generated a fresh initial access link for ${target.requestorEmail}.`
        : `Initial access invite re-sent to ${target.requestorEmail}.`,
    )
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
    const localPreviewResults = result.data.results.filter(
      (item) => item.actionLink || item.recipientEmail || item.subject,
    )
    setLocalNotificationLinks(
      localPreviewResults.map((item) => ({
        id: item.id,
        recipientEmail: item.recipientEmail,
        subject: item.subject,
        actionLink: item.actionLink,
      })),
    )
    setError(failedCount > 0 ? `${failedCount} email notification deliveries failed. Review function logs and event rows.` : null)
    setInfo(
      localPreviewResults.length > 0
        ? `Processed ${result.data.processed} pending email notification event(s). Local dev generated previews instead of sending email.`
        : `Processed ${result.data.processed} pending email notification event(s).`,
    )
    setSubmittingId(null)
  }

  const handleCopyNotificationLink = async (actionLink: string) => {
    try {
      await navigator.clipboard.writeText(actionLink)
      setError(null)
      setInfo("Copied notification action link.")
    } catch {
      setError("Notification preview generated, but clipboard copy failed.")
      setInfo(actionLink)
    }
  }

  const handleOpenNotificationLink = (actionLink: string) => {
    window.open(actionLink, "_blank", "noopener,noreferrer")
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

  const handleLifecycleTransition = async (
    requestId: string,
    lifecycleStatus: PlatformAdminRequestRecord["lifecycleStatus"],
    billingStatus?: PlatformAdminRequestRecord["billingStatus"],
    successMessage?: string,
  ) => {
    if (!lifecycleStatus) return
    const target = requests.find((item) => item.id === requestId)
    if (!target) return

    setSubmittingId(requestId)
    const result = await setTenantRequestLifecycleState({
      requestId,
      lifecycleStatus,
      billingStatus: billingStatus ?? undefined,
      reviewNotes: reviewNotes[requestId],
    })

    if (!result.ok) {
      setError(result.error.message)
      setInfo(null)
      setSubmittingId(null)
      return
    }

    setRequests((current) =>
      current.map((item) =>
        item.id === requestId
          ? {
              ...item,
              lifecycleStatus,
              billingStatus: billingStatus ?? item.billingStatus,
              billingFailedAt: lifecycleStatus === "billing_failed" ? new Date().toISOString() : item.billingFailedAt,
              previousLifecycleStatus:
                lifecycleStatus === "suspended" && item.lifecycleStatus !== "suspended"
                  ? item.lifecycleStatus
                  : item.lifecycleStatus === "suspended" && lifecycleStatus !== "suspended"
                    ? null
                    : item.previousLifecycleStatus,
            }
          : item,
      ),
    )
    setError(null)
    setInfo(successMessage ?? `${target.organizationName} moved to ${lifecycleLabels[lifecycleStatus]}.`)
    setSubmittingId(null)
  }

  const activeRequest = activeRequestId ? requests.find((item) => item.id === activeRequestId) ?? null : null

  const renderReviewDecisionContent = (request: PlatformAdminRequestRecord) => {
    const isPending = request.status === "pending"
    const isSubmitting = submittingId === request.id
    const packageLabel = getPackageById(request.requestedPlan)?.label ?? toTitleCaseLabel(request.requestedPlan, "Package")
    const organizationTypeLabel = toTitleCaseLabel(request.organizationType, "Not specified")
    const detailRows: Array<Array<{ label: string; value: string; detail?: string }>> = [
      [
        {
          label: "Organization",
          value: organizationTypeLabel,
          detail: request.region ? `Region: ${request.region}` : undefined,
        },
        {
          label: "Requestor",
          value: request.jobTitle ?? "Title not provided",
          detail: `Contact: ${request.requestorEmail}`,
        },
        {
          label: "Requested package",
          value: packageLabel,
          detail: `${request.expectedCoachCount ?? 0} coaches · ${request.expectedAthleteCount ?? 0} athletes`,
        },
      ],
      [
        { label: "Expected seats", value: String(request.expectedSeats), detail: undefined },
        {
          label: "Roster mix",
          value: `${request.expectedCoachCount ?? 0} coaches - ${request.expectedAthleteCount ?? 0} athletes`,
          detail: undefined,
        },
        { label: "Submitted", value: formatDateLabel(request.createdAt, "Not submitted"), detail: undefined },
        { label: "Reviewed", value: formatDateLabel(request.reviewedAt), detail: undefined },
      ],
      [
        { label: "Lifecycle", value: request.lifecycleStatus ? lifecycleLabels[request.lifecycleStatus] : "Not set", detail: undefined },
        { label: "Billing", value: request.billingStatus ? billingLabels[request.billingStatus] : "Not started", detail: undefined },
        { label: "Billing provider", value: request.billingProvider ?? "mock-billing", detail: undefined },
        { label: "Billing cycle", value: request.billingCycle ?? "Not selected", detail: undefined },
      ],
      [
        { label: "Job title", value: request.jobTitle ?? "Not provided", detail: undefined },
        { label: "Organization type", value: organizationTypeLabel, detail: undefined },
        { label: "Region", value: request.region ?? "Not provided", detail: undefined },
        {
          label: "Target start",
          value: request.desiredStartDate ? new Date(request.desiredStartDate).toLocaleDateString() : "Flexible",
          detail: undefined,
        },
      ],
    ]

    return (
      <div className="space-y-5">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
              {packageLabel}
            </span>
            <TablePrimaryStatus request={request} />
          </div>
          <div className="space-y-1">
            <h3 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">{request.organizationName}</h3>
            <p className="text-sm text-slate-500">{request.requestorName} - {request.requestorEmail}</p>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-5">
            {detailRows.map((row, rowIndex) => (
              <div
                key={`row-${rowIndex}`}
                className={cn(
                  "grid gap-5 py-5",
                  row.length === 3 ? "md:grid-cols-3" : "md:grid-cols-4",
                  rowIndex === 0 && "pt-0",
                  rowIndex === detailRows.length - 1 && "pb-0",
                  rowIndex < detailRows.length - 1 && "border-b border-slate-200",
                )}
              >
                {row.map((item) => (
                  <div key={item.label} className="space-y-1">
                    <p className="text-sm text-slate-500">{item.label}</p>
                    <p className="text-sm font-semibold leading-6 text-slate-950">{item.value}</p>
                    {item.detail ? <p className="text-sm leading-6 text-slate-500">{item.detail}</p> : null}
                  </div>
                ))}
              </div>
            ))}

            {request.organizationWebsite ? (
              <div className="border-t border-slate-200 pt-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Organization website</p>
                <a
                  href={request.organizationWebsite}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 block break-all text-base text-[#1368ff] underline-offset-4 hover:underline"
                >
                  {request.organizationWebsite}
                </a>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 border-t border-slate-200 pt-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Decision</p>
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
              className="h-11 rounded-full bg-[linear-gradient(135deg,#1368ff_0%,#3f8cff_100%)] text-white hover:opacity-95"
              onClick={() => void handleReview(request.id, "approved")}
            >
              Approve and provision
            </Button>
            <Button
              type="button"
              disabled={!isPending || isSubmitting}
              variant="outline"
              className="h-11 rounded-full border-rose-200 bg-white text-rose-700 hover:bg-rose-50 hover:text-rose-700"
              onClick={() => void handleReview(request.id, "rejected")}
            >
              Reject
            </Button>
          </div>

          {request.provisionedTenantId ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                type="button"
                disabled={isSubmitting}
                variant="outline"
                className="h-11 rounded-full border-slate-200 bg-white text-slate-900 hover:border-[#cfe2ff] hover:bg-[#eef5ff] hover:text-[#1553b7]"
                onClick={() => void handleResendInvite(request.id)}
              >
                Resend initial access invite
              </Button>
              {isLocalPreviewEnabled ? (
                <Button
                  type="button"
                  disabled={isSubmitting}
                  variant="outline"
                  className="h-11 rounded-full border-slate-200 bg-white text-slate-900 hover:border-[#cfe2ff] hover:bg-[#eef5ff] hover:text-[#1553b7]"
                  onClick={() => void handleCopyInviteLink(request.id)}
                >
                  Copy initial access link
                </Button>
              ) : null}
              {request.lifecycleStatus === "approved_pending_billing" ? (
                <Button
                  type="button"
                  disabled={isSubmitting}
                  variant="outline"
                  className="h-11 rounded-full border-amber-200 bg-white text-amber-700 hover:bg-amber-50 hover:text-amber-700"
                  onClick={() =>
                    void handleLifecycleTransition(
                      request.id,
                      "billing_failed",
                      "failed",
                      `Billing marked as failed for ${request.organizationName}.`,
                    )
                  }
                >
                  Mark billing failed
                </Button>
              ) : null}
              {request.lifecycleStatus === "billing_failed" ? (
                <Button
                  type="button"
                  disabled={isSubmitting}
                  variant="outline"
                  className="h-11 rounded-full border-slate-200 bg-white text-slate-900 hover:border-[#cfe2ff] hover:bg-[#eef5ff] hover:text-[#1553b7]"
                  onClick={() =>
                    void handleLifecycleTransition(
                      request.id,
                      "approved_pending_billing",
                      "pending",
                      `Billing reset to pending for ${request.organizationName}.`,
                    )
                  }
                >
                  Retry billing
                </Button>
              ) : null}
              {(request.lifecycleStatus === "active_onboarding" || request.lifecycleStatus === "active") ? (
                <Button
                  type="button"
                  disabled={isSubmitting}
                  variant="outline"
                  className="h-11 rounded-full border-rose-200 bg-white text-rose-700 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() =>
                    void handleLifecycleTransition(
                      request.id,
                      "suspended",
                      request.billingStatus,
                      `Tenant suspended for ${request.organizationName}.`,
                    )
                  }
                >
                  Suspend tenant
                </Button>
              ) : null}
              {request.lifecycleStatus === "suspended" ? (
                <Button
                  type="button"
                  disabled={isSubmitting}
                  className="h-11 rounded-full bg-[linear-gradient(135deg,#1368ff_0%,#3f8cff_100%)] text-white hover:opacity-95"
                  onClick={() =>
                    void handleLifecycleTransition(
                      request.id,
                      request.previousLifecycleStatus ?? "active",
                      request.billingStatus === "pending" ? "active" : request.billingStatus,
                      `Tenant reactivated for ${request.organizationName}.`,
                    )
                  }
                >
                  Reactivate tenant
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
      <StandardPageHeader
        variant="admin"
        eyebrow="Platform admin requests"
        title="Request intake with real review control."
        description="New tenant creation now stops here first. Review the request, provision the tenant, and verify the initial access invite actually went out."
        stats={headerStats}
        statsClassName="hidden md:grid"
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
      {isLocalPreviewEnabled && localNotificationLinks.length > 0 ? (
        <section className="rounded-[24px] border border-[#cfe2ff] bg-[#f8fbff] p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1553b7]">
                Local notification previews
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Local development does not send notification email. Use these generated previews instead.
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {localNotificationLinks.map((preview) => (
              <div key={preview.id} className="rounded-[20px] border border-slate-200 bg-white px-4 py-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {preview.recipientEmail ?? "Notification preview"}
                    </p>
                    {preview.subject ? <p className="text-sm font-medium text-slate-950">{preview.subject}</p> : null}
                    {preview.actionLink ? (
                      <p className="break-all font-mono text-xs text-slate-600">{preview.actionLink}</p>
                    ) : (
                      <p className="text-sm text-slate-500">This notification has no actionable link in the body.</p>
                    )}
                  </div>
                  {preview.actionLink ? (
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-full border-slate-200 px-4"
                        onClick={() => void handleCopyNotificationLink(preview.actionLink!)}
                      >
                        Copy link
                      </Button>
                      <Button
                        type="button"
                        className="h-9 rounded-full px-4"
                        onClick={() => handleOpenNotificationLink(preview.actionLink!)}
                      >
                        Open link
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {loading ? (
        <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-8 text-sm text-slate-500 shadow-sm">
          Loading request queue...
        </section>
      ) : null}

      {!loading && requests.length === 0 ? (
        <EmptyStateCard
          eyebrow="Request queue"
          title="No tenant provisioning requests yet."
          description="No tenant provisioning requests have been submitted yet. This queue will populate when an organization completes the public request intake flow."
          hint="Use this page to review, approve, provision, and resend initial access once the first intake arrives."
          icon={<HugeiconsIcon icon={Notification01Icon} className="size-5" />}
        />
      ) : null}

      <DataSurfaceToolbar
        eyebrow="Queue controls"
        title="Queue filters"
        controls={
          <>
            <div className="flex w-full items-center gap-3">
              <div className="flex min-w-0 flex-1 items-center rounded-full border border-slate-200 bg-white px-3 py-2 shadow-[0_8px_20px_rgba(15,23,42,0.06)]">
                <div className="flex items-center gap-3">
                  <HugeiconsIcon
                    icon={SquareIcon}
                    className={cn("size-4", desktopViewMode === "cards" ? "text-[#1368ff]" : "text-slate-400")}
                  />
                  <Switch
                    checked={desktopViewMode === "table"}
                    onCheckedChange={(checked) => setDesktopViewMode(checked ? "table" : "cards")}
                    aria-label="Switch between card and table views for the request queue"
                  />
                  <HugeiconsIcon
                    icon={TableIcon}
                    className={cn("size-4", desktopViewMode === "table" ? "text-[#1368ff]" : "text-slate-400")}
                  />
                </div>
                <div className="mx-4 h-6 w-px bg-slate-200" />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-10 rounded-full px-4 text-sm font-medium text-slate-700 hover:bg-[#eef5ff] hover:text-[#1553b7]"
                      aria-label={`Filter requests by status. Current filter: ${statusFilterLabels[statusFilter]}`}
                    >
                      <HugeiconsIcon icon={FilterHorizontalIcon} className="mr-2 size-4" />
                      Status: {statusFilterLabels[statusFilter]}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52 border-slate-200 bg-white text-slate-900">
                    <DropdownMenuLabel>Status filter</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={statusFilter}
                      onValueChange={(value) => setStatusFilter(value as PlatformAdminRequestRecord["status"] | "all")}
                    >
                      <DropdownMenuRadioItem className="focus:bg-[#eef5ff] focus:text-[#1553b7]" value="all">All</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem className="focus:bg-[#eef5ff] focus:text-[#1553b7]" value="pending">Pending</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem className="focus:bg-[#eef5ff] focus:text-[#1553b7]" value="approved">Approved</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem className="focus:bg-[#eef5ff] focus:text-[#1553b7]" value="rejected">Rejected</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem className="focus:bg-[#eef5ff] focus:text-[#1553b7]" value="cancelled">Cancelled</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="hidden items-center gap-2 sm:flex">
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
                    className={cn(toolbarIconButtonClassName, "sm:hidden")}
                    aria-label="Open queue actions"
                  >
                    <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 border-slate-200 bg-white text-slate-900">
                  <DropdownMenuLabel>Queue actions</DropdownMenuLabel>
                  <DropdownMenuItem className="focus:bg-[#eef5ff] focus:text-[#1553b7]" onClick={() => void handleExportQueueCsv()}>
                    Export CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem className="focus:bg-[#eef5ff] focus:text-[#1553b7]" onClick={() => void handleExportQueuePdf()}>
                    Export PDF
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="focus:bg-[#eef5ff] focus:text-[#1553b7]"
                    disabled={submittingId === "dispatch-email-queue"}
                    onClick={() => void handleDispatchPendingEmails()}
                  >
                    Dispatch pending emails
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        }
        search={
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search request queue"
            className="h-14 rounded-full border-slate-200 bg-slate-50 px-5 text-base"
          />
        }
      />

      {!loading && requests.length > 0 && filteredRequests.length === 0 ? (
        <EmptyStateCard
          eyebrow="Request queue"
          title="No requests match the current filters."
          description="Your queue has data, but the current search or status filter returned zero matches."
          hint="Clear the search box or switch the status filter back to all statuses."
          icon={<HugeiconsIcon icon={FilterHorizontalIcon} className="size-5" />}
          actions={
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-full border-slate-200 px-5"
              onClick={() => {
                setSearch("")
                setStatusFilter("pending")
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : null}

      <section className={cn("grid gap-4 lg:grid-cols-3", (desktopViewMode === "table" || filteredRequests.length === 0) && "lg:hidden")}>
        {filteredRequests.map((request) => {
          const packageLabel = getPackageById(request.requestedPlan)?.label ?? toTitleCaseLabel(request.requestedPlan, "Package")
          const organizationTypeLabel = toTitleCaseLabel(request.organizationType, "Not specified")
          const expectedSeatSummary = `${request.expectedCoachCount ?? 0} coaches • ${request.expectedAthleteCount ?? 0} athletes`

          return (
            <article
              key={request.id}
              className="flex h-full flex-col rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6"
            >
              <div className="flex h-full flex-col">
                <div className="min-w-0 flex-1 space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                      {packageLabel}
                    </span>
                    <TablePrimaryStatus request={request} />
                  </div>

                  <div className="space-y-1">
                    <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">{request.organizationName}</h2>
                    <p className="text-sm text-slate-500">{request.requestorName} - {request.requestorEmail}</p>
                  </div>

                  <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                    <div className="space-y-4">
                      <RequestSummaryRow
                        icon={<HugeiconsIcon icon={SquareIcon} className="size-4" />}
                        label="Organization:"
                        value={organizationTypeLabel}
                        detail={request.region ? `Region: ${request.region}` : "Region not provided"}
                      />
                      <RequestSummaryRow
                        icon={<HugeiconsIcon icon={TextCreationIcon} className="size-4" />}
                        label="Role:"
                        value={request.jobTitle ?? "Title not provided"}
                        detail={
                          request.desiredStartDate
                            ? `Target start: ${new Date(request.desiredStartDate).toLocaleDateString()}`
                            : "Target start is flexible"
                        }
                      />
                      <RequestSummaryRow
                        icon={<HugeiconsIcon icon={Notification01Icon} className="size-4" />}
                        label="Seat-mail:"
                        value={request.accessInviteSentAt ? "Initial access sent" : "Awaiting invite"}
                        detail={request.provisionedTenantId ? `Tenant: ${request.provisionedTenantId}` : "Tenant not provisioned yet"}
                      />
                    </div>
                    <div className="space-y-4">
                      <RequestSummaryRow
                        icon={<HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />}
                        label="Plan-history:"
                        value={request.lifecycleStatus ? lifecycleLabels[request.lifecycleStatus] : "Not set"}
                        detail={request.billingStatus ? `Billing: ${billingLabels[request.billingStatus]}` : "Billing not started"}
                      />
                      <RequestSummaryRow
                        icon={<HugeiconsIcon icon={FilePasteIcon} className="size-4" />}
                        label="Package:"
                        value={packageLabel}
                        detail={expectedSeatSummary}
                      />
                      <RequestSummaryRow
                        icon={<HugeiconsIcon icon={TableIcon} className="size-4" />}
                        label="Expected seats"
                        value={String(request.expectedSeats)}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <Button
                    type="button"
                    className="h-11 w-full rounded-full bg-[linear-gradient(135deg,#1368ff_0%,#3f8cff_100%)] px-5 text-white hover:opacity-95"
                    onClick={() => setActiveRequestId(request.id)}
                  >
                    {request.status === "pending" ? "Review request" : "Open request"}
                  </Button>
                </div>
              </div>
            </article>
          )
        })}
      </section>

      <section className={cn("hidden", desktopViewMode === "table" && filteredRequests.length > 0 && "lg:block")}>
        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white px-4 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] xl:px-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-5 py-4 text-xs uppercase tracking-[0.16em] text-slate-500">Organization</TableHead>
                <TableHead className="px-5 py-4 text-xs uppercase tracking-[0.16em] text-slate-500">Requestor</TableHead>
                <TableHead className="px-5 py-4 text-xs uppercase tracking-[0.16em] text-slate-500">Status</TableHead>
                <TableHead className="px-5 py-4 text-xs uppercase tracking-[0.16em] text-slate-500">Plan</TableHead>
                <TableHead className="px-5 py-4 text-xs uppercase tracking-[0.16em] text-slate-500">Target start</TableHead>
                <TableHead className="px-5 py-4 text-right text-xs uppercase tracking-[0.16em] text-slate-500">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRequests.flatMap((request) => {
                return [
                  <TableRow key={request.id}>
                    <TableCell className="px-5 py-4 align-top">
                      <div className="space-y-2">
                        <p className="font-semibold text-slate-950">{request.organizationName}</p>
                        <p className="text-xs text-slate-500">{formatDateLabel(request.createdAt, "Not submitted")}</p>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {request.organizationType ?? "Organization"}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {request.region ?? "No region"}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-4 align-top">
                      <div className="space-y-1.5">
                        <p className="font-medium text-slate-900">{request.requestorName}</p>
                        <p className="text-xs text-slate-500">{request.requestorEmail}</p>
                        <p className="text-xs text-slate-500">{request.jobTitle ?? "Job title not provided"}</p>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-4 align-top">
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <TablePrimaryStatus request={request} />
                        </div>
                        <p className="text-xs text-slate-500">
                          {request.status === "approved" && request.billingStatus
                            ? `Billing: ${billingLabels[request.billingStatus]}`
                            : request.provisionedTenantId
                              ? `Tenant ${request.provisionedTenantId}`
                              : "Provisioning not completed"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {request.accessInviteSentAt
                            ? `Invite sent ${formatDateLabel(request.accessInviteSentAt, "recently")}`
                            : "Invite not sent yet"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-4 align-top">
                      <div className="space-y-1.5">
                        <p className="text-sm font-medium text-slate-900">
                          {getPackageById(request.requestedPlan)?.label ?? toTitleCaseLabel(request.requestedPlan, "Package")}
                        </p>
                        <p className="text-xs text-slate-500">
                          {request.expectedSeats} projected seats
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-4 align-top">
                      <div className="space-y-1.5">
                        <p className="text-sm font-medium text-slate-900">
                          {request.desiredStartDate ? new Date(request.desiredStartDate).toLocaleDateString() : "Flexible"}
                        </p>
                        <p className="text-xs text-slate-500">Preferred start</p>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-4 align-top text-right">
                      <div className="flex flex-col items-end gap-2">
                        <Button
                          type="button"
                          className="h-10 rounded-full bg-[linear-gradient(135deg,#1368ff_0%,#3f8cff_100%)] px-4 text-white hover:opacity-95"
                          onClick={() => setActiveRequestId(request.id)}
                        >
                          {request.status === "pending" ? "Review" : "Details"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>,
                ]
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      {useDesktopReviewDialog ? (
        <Dialog open={Boolean(activeRequest)} onOpenChange={(open) => (!open ? setActiveRequestId(null) : null)}>
          <DialogContent className="max-h-[88vh] overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-0 sm:max-w-[960px]" showCloseButton={false}>
            {activeRequest ? (
              <>
                <DialogHeader className="border-b border-slate-200 px-6 py-5 text-left">
                  <DialogTitle className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
                    Review request
                  </DialogTitle>
                  <DialogDescription className="text-sm text-slate-500">
                    Review the organization details and decide whether to provision access.
                  </DialogDescription>
                </DialogHeader>
                <div className="px-6 py-6">{renderReviewDecisionContent(activeRequest)}</div>
                <DialogFooter className="border-t border-slate-200 px-6 py-4 sm:justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-full border-slate-200 bg-white text-slate-900 hover:border-[#cfe2ff] hover:bg-[#eef5ff] hover:text-[#1553b7]"
                    onClick={() => setActiveRequestId(null)}
                  >
                    Close
                  </Button>
                </DialogFooter>
              </>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer open={Boolean(activeRequest)} onOpenChange={(open) => (!open ? setActiveRequestId(null) : null)}>
          <DrawerContent className="max-h-[88vh] rounded-t-[28px] border-slate-200 bg-white">
            {activeRequest ? (
              <>
                <DrawerHeader className="px-5 pt-5 text-left">
                  <DrawerTitle className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
                    Review request
                  </DrawerTitle>
                  <DrawerDescription className="text-sm text-slate-500">
                    Review the organization details and decide whether to provision access.
                  </DrawerDescription>
                </DrawerHeader>
                <div className="overflow-y-auto px-5 pb-4">{renderReviewDecisionContent(activeRequest)}</div>
                <DrawerFooter className="border-t border-slate-200 bg-white px-5 pb-5">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-full border-slate-200 bg-white text-slate-900 hover:border-[#cfe2ff] hover:bg-[#eef5ff] hover:text-[#1553b7]"
                    onClick={() => setActiveRequestId(null)}
                  >
                    Close
                  </Button>
                </DrawerFooter>
              </>
            ) : null}
          </DrawerContent>
        </Drawer>
      )}
    </div>
  )
}





