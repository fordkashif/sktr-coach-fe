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
import { DataSurfaceToolbar } from "@/components/ui/data-surface-toolbar"
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
  getPlatformAdminPackageUpgradeRequests,
  getPlatformAdminRequestQueue,
  logPlatformAdminExport,
  previewInitialClubAdminAccessInvite,
  reviewTenantPackageUpgradeRequest,
  reviewTenantProvisionRequest,
  sendInitialClubAdminAccessInvite,
  setTenantRequestLifecycleState,
  type PlatformAdminPackageUpgradeRequestRecord,
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

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-950">{value}</p>
    </div>
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

function BillingBadge({ billingStatus }: { billingStatus: PlatformAdminRequestRecord["billingStatus"] }) {
  if (!billingStatus) {
    return (
      <span className="status-chip-neutral rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
        Billing unknown
      </span>
    )
  }

  return (
    <span
      className={cn(
        "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
        billingStatus === "pending" && "status-chip-warning",
        billingStatus === "mocked_complete" && "status-chip-info",
        billingStatus === "failed" && "status-chip-danger",
        billingStatus === "active" && "status-chip-success",
        billingStatus === "past_due" && "status-chip-warning",
        billingStatus === "cancelled" && "status-chip-neutral",
      )}
    >
      {billingLabels[billingStatus]}
    </span>
  )
}

function RequestMetaCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string | null
}) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-950">{value}</p>
      {detail ? <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p> : null}
    </div>
  )
}

export default function PlatformAdminRequestsPage() {
  const [requests, setRequests] = useState<PlatformAdminRequestRecord[]>([])
  const [upgradeRequests, setUpgradeRequests] = useState<PlatformAdminPackageUpgradeRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [localInviteLinks, setLocalInviteLinks] = useState<Record<string, string>>({})
  const [localNotificationLinks, setLocalNotificationLinks] = useState<
    Array<{ id: string; recipientEmail?: string; subject?: string; actionLink?: string }>
  >([])
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [upgradeReviewNotes, setUpgradeReviewNotes] = useState<Record<string, string>>({})
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
      const [requestResult, upgradeResult] = await Promise.all([
        getPlatformAdminRequestQueue(),
        getPlatformAdminPackageUpgradeRequests(),
      ])
      if (cancelled) return

      if (!requestResult.ok) {
        setError(requestResult.error.message)
        setInfo(null)
        setLoading(false)
        return
      }
      if (!upgradeResult.ok) {
        setError(upgradeResult.error.message)
        setInfo(null)
        setLoading(false)
        return
      }

      setRequests(requestResult.data)
      setUpgradeRequests(upgradeResult.data)
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
  const pendingUpgradeRequests = useMemo(
    () => upgradeRequests.filter((item) => item.status === "pending"),
    [upgradeRequests],
  )

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
      if (result.data.accessInviteActionLink) {
        setLocalInviteLinks((current) => ({
          ...current,
          [requestId]: result.data.accessInviteActionLink!,
        }))
      }
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
    if (result.data.actionLink) {
      setLocalInviteLinks((current) => ({
        ...current,
        [requestId]: result.data.actionLink!,
      }))
    }
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

  const handleOpenLocalInviteLink = (requestId: string) => {
    const actionLink = localInviteLinks[requestId]
    if (!actionLink) return
    window.open(actionLink, "_blank", "noopener,noreferrer")
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

  const handleUpgradeRequestReview = async (
    upgradeRequestId: string,
    status: PlatformAdminPackageUpgradeRequestRecord["status"],
  ) => {
    if (status === "pending") return

    setSubmittingId(`upgrade-${upgradeRequestId}`)
    const result = await reviewTenantPackageUpgradeRequest({
      upgradeRequestId,
      status,
      reviewNotes: upgradeReviewNotes[upgradeRequestId],
    })

    if (!result.ok) {
      setError(result.error.message)
      setInfo(null)
      setSubmittingId(null)
      return
    }

    const reviewedAt = new Date().toISOString()
    const target = upgradeRequests.find((item) => item.id === upgradeRequestId) ?? null
    setUpgradeRequests((current) =>
      current.map((item) =>
        item.id === upgradeRequestId
          ? {
              ...item,
              status,
              reviewNotes: upgradeReviewNotes[upgradeRequestId]?.trim() || null,
              reviewedAt,
            }
          : item,
      ),
    )

    if (status === "approved" && target) {
      setRequests((current) =>
        current.map((item) =>
          item.provisionedTenantId === target.tenantId
            ? {
                ...item,
                requestedPlan: target.requestedPackage,
              }
            : item,
        ),
      )
    }

    setError(null)
    setInfo(
      target
        ? `Package upgrade ${status} for ${target.organizationName}.`
        : "Package upgrade request updated.",
    )
    setSubmittingId(null)
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
                {request.lifecycleStatus === "approved_pending_billing" ? (
                  <Button
                    type="button"
                    disabled={isSubmitting}
                    variant="outline"
                    className="h-11 w-full rounded-full border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-700"
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
                    className="h-11 w-full rounded-full border-slate-200"
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
                    className="h-11 w-full rounded-full border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-700"
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
                    variant="outline"
                    className="h-11 w-full rounded-full border-slate-200"
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
        <InfoPill label="Lifecycle" value={request.lifecycleStatus ? lifecycleLabels[request.lifecycleStatus] : "Not set"} />
        <InfoPill label="Billing" value={request.billingStatus ? billingLabels[request.billingStatus] : "Not started"} />
        <InfoPill label="Billing provider" value={request.billingProvider ?? "Mock billing"} />
        <InfoPill label="Billing cycle" value={request.billingCycle ?? "Not selected"} />
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

      {(request.billingContactName || request.billingContactEmail || request.billingFailedAt) ? (
        <div className="rounded-[22px] border border-slate-200 bg-[#f8fbff] px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Billing contact state</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <InfoPill label="Contact name" value={request.billingContactName ?? "Not provided"} />
            <InfoPill label="Contact email" value={request.billingContactEmail ?? "Not provided"} />
            <InfoPill label="Failure recorded" value={formatDateLabel(request.billingFailedAt, "No failure logged")} />
          </div>
        </div>
      ) : null}

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
        <div className="status-panel-success px-4 py-4">
          <p className="status-text-success text-[11px] font-semibold uppercase tracking-[0.16em]">Provisioned tenant</p>
          <p className="status-text-success mt-2 break-all text-sm leading-6">{request.provisionedTenantId}</p>
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
          {localInviteLinks[request.id] ? (
            <div className="mt-3 space-y-3 rounded-[18px] border border-[#cfe2ff] bg-white px-3 py-3">
              <p className="text-xs font-medium text-slate-950">Local dev access link</p>
              <p className="break-all font-mono text-xs text-slate-600">{localInviteLinks[request.id]}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-full border-slate-200 px-4"
                  onClick={() => void handleCopyInviteLink(request.id)}
                >
                  Copy link
                </Button>
                <Button
                  type="button"
                  className="h-9 rounded-full px-4"
                  onClick={() => handleOpenLocalInviteLink(request.id)}
                >
                  Open link
                </Button>
              </div>
            </div>
          ) : null}
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
      <StandardPageHeader
        variant="admin"
        eyebrow="Platform admin requests"
        title="Request intake with real review control."
        description="New tenant creation now stops here first. Review the request, provision the tenant, and verify the initial access invite actually went out."
        stats={headerStats}
      />

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Commercial changes</p>
            <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">Package upgrade requests</h2>
            <p className="text-sm text-slate-500">Club-admin upgrade requests appear here when tenants hit package limits and ask for a higher tier.</p>
          </div>
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-500">
            Pending upgrades: <span className="ml-1 font-medium text-slate-700">{pendingUpgradeRequests.length}</span>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {upgradeRequests.length === 0 ? (
            <EmptyStateCard
              eyebrow="Upgrade queue"
              title="No package upgrade requests yet."
              description="Upgrade requests appear here when club-admins hit team, coach, or athlete package caps and ask for a higher tier."
              className="rounded-[20px] bg-slate-50 px-4 py-6 shadow-none"
              contentClassName="gap-3"
            />
          ) : (
            upgradeRequests.slice(0, 6).map((request) => (
              <article key={request.id} className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {request.status}
                      </span>
                      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {getPackageById(request.currentPackage)?.label ?? request.currentPackage} to {getPackageById(request.requestedPackage)?.label ?? request.requestedPackage}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-slate-950">{request.organizationName}</h3>
                      <p className="text-sm text-slate-500">Requested {new Date(request.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <RequestMetaCard
                        label="Current package"
                        value={getPackageById(request.currentPackage)?.label ?? request.currentPackage}
                        detail={`Requested package: ${getPackageById(request.requestedPackage)?.label ?? request.requestedPackage}`}
                      />
                      <RequestMetaCard
                        label="Reason"
                        value={request.reason?.trim() || "No reason provided"}
                        detail={request.reviewNotes ? `Review notes: ${request.reviewNotes}` : request.reviewedAt ? `Reviewed ${formatDateLabel(request.reviewedAt)}` : "Awaiting review"}
                      />
                    </div>
                  </div>
                  {request.status === "pending" ? (
                    <div className="w-full max-w-[360px] space-y-3 lg:justify-end">
                      <Textarea
                        value={upgradeReviewNotes[request.id] ?? ""}
                        onChange={(event) =>
                          setUpgradeReviewNotes((current) => ({
                            ...current,
                            [request.id]: event.target.value,
                          }))
                        }
                        placeholder="Optional review notes for the upgrade decision."
                        className="min-h-[96px] rounded-[18px] border-slate-200 bg-white"
                      />
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <Button
                          type="button"
                          className="h-10 rounded-full px-4"
                          disabled={submittingId === `upgrade-${request.id}`}
                          onClick={() => void handleUpgradeRequestReview(request.id, "approved")}
                        >
                          Approve upgrade
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 rounded-full border-slate-200 px-4"
                          disabled={submittingId === `upgrade-${request.id}`}
                          onClick={() => void handleUpgradeRequestReview(request.id, "rejected")}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            ))
          )}
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
        description="Search by organization, requestor, role, region, plan, or tenant id, then narrow the queue by status."
        status={
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-500">
            Status: <span className="ml-1 font-medium text-slate-700">{statusFilterLabels[statusFilter]}</span>
          </div>
        }
        controls={
          <>
            <div className="flex items-center justify-between gap-3 sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className={toolbarIconButtonClassName}
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
          </>
        }
        search={
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search request queue"
            className="h-12 rounded-full border-slate-200 bg-slate-50 px-5 text-base lg:max-w-2xl"
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
                setStatusFilter("all")
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : null}

      <section className={cn("space-y-4", (desktopViewMode === "table" || filteredRequests.length === 0) && "lg:hidden")}>
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
                      <LifecycleBadge lifecycleStatus={request.lifecycleStatus} />
                      <BillingBadge billingStatus={request.billingStatus} />
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

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <RequestMetaCard
                        label="Organization"
                        value={request.organizationType ?? "Not specified"}
                        detail={request.region ? `Region: ${request.region}` : "Region not provided"}
                      />
                      <RequestMetaCard
                        label="Requestor"
                        value={request.jobTitle ?? "Title not provided"}
                        detail={`Contact: ${request.requestorEmail}`}
                      />
                      <RequestMetaCard
                        label="Delivery"
                        value={request.accessInviteSentAt ? "Initial access sent" : "Awaiting invite"}
                        detail={request.provisionedTenantId ? `Tenant: ${request.provisionedTenantId}` : "Tenant not provisioned yet"}
                      />
                      <RequestMetaCard
                        label="Lifecycle"
                        value={request.lifecycleStatus ? lifecycleLabels[request.lifecycleStatus] : "Not set"}
                        detail={request.billingStatus ? `Billing: ${billingLabels[request.billingStatus]}` : "Billing not started"}
                      />
                      <RequestMetaCard
                        label="Requested package"
                        value={request.requestedPlan}
                        detail={`${request.expectedCoachCount ?? 0} coaches · ${request.expectedAthleteCount ?? 0} athletes`}
                      />
                    </div>

                    <div className={cn("grid gap-3 xl:grid-cols-4", isExpanded ? "grid-cols-1 sm:grid-cols-2" : "hidden sm:grid sm:grid-cols-2")}>
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

      <section className={cn("hidden", desktopViewMode === "table" && filteredRequests.length > 0 && "lg:block")}>
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
                      <div className="space-y-2">
                        <p className="font-semibold text-slate-950">{request.organizationName}</p>
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
                          <StatusBadge status={request.status} />
                          <LifecycleBadge lifecycleStatus={request.lifecycleStatus} />
                          <BillingBadge billingStatus={request.billingStatus} />
                          {request.accessInviteSentAt ? (
                            <span className="rounded-full bg-[#dbeafe] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1368ff]">
                              Invite sent
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-slate-500">
                          {request.provisionedTenantId ? `Tenant ${request.provisionedTenantId}` : "Provisioning not completed"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-4 align-top">
                      <div className="space-y-1.5">
                        <p className="text-sm font-medium text-slate-900">{request.requestedPlan}</p>
                        <p className="text-xs text-slate-500">
                          {request.lifecycleStatus ? lifecycleLabels[request.lifecycleStatus] : "Lifecycle not set"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-4 align-top">
                      <div className="space-y-1.5">
                        <p className="text-sm font-medium text-slate-900">{request.expectedCoachCount ?? 0} coaches</p>
                        <p className="text-xs text-slate-500">{request.expectedAthleteCount ?? 0} athletes</p>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-4 align-top">
                      <div className="space-y-1.5">
                        <p className="text-sm font-medium text-slate-900">{formatDateLabel(request.createdAt, "Not submitted")}</p>
                        <p className="text-xs text-slate-500">Request intake</p>
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
                          variant="outline"
                          className="h-10 rounded-full border-slate-200"
                          onClick={() => setExpandedRequestId(isExpanded ? null : request.id)}
                        >
                          {isExpanded ? "Collapse" : request.status === "pending" ? "Review" : "Details"}
                        </Button>
                        <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                          {isExpanded ? "Expanded" : "Closed"}
                        </p>
                      </div>
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




