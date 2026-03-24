"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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

export default function PlatformAdminRequestsPage() {
  const [requests, setRequests] = useState<PlatformAdminRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<PlatformAdminRequestRecord["status"] | "all">("all")
  const isLocalPreviewEnabled =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")

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

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,rgba(7,17,34,0.96)_0%,rgba(10,24,44,0.9)_55%,rgba(20,67,160,0.72)_100%)] px-5 py-6 text-white shadow-[0_24px_80px_rgba(5,12,24,0.28)] sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#6fb6ff]">Platform Admin</p>
            <h1 className="max-w-[10ch] text-[clamp(2.2rem,5vw,4.75rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-white">
              Request intake with real review control.
            </h1>
            <p className="max-w-[60ch] text-sm leading-7 text-white/72 sm:text-base">
              New tenant creation now stops here first. Review the request, provision the tenant, and verify the initial access invite actually went out.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-2">
            {[
              { label: "Pending", value: summary.pending },
              { label: "Approved", value: summary.approved },
              { label: "Provisioned", value: summary.provisioned },
              { label: "Invite sent", value: summary.inviteReady },
            ].map((item) => (
              <div key={item.label} className="rounded-[24px] border border-white/12 bg-white/[0.08] px-4 py-4 backdrop-blur-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6fb6ff]">{item.label}</p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{item.value}</p>
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Queue filters</h2>
              <p className="text-sm text-slate-500">
                Search by organization, requestor, role, region, plan, or tenant id, then narrow the queue by status.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-full border-slate-200"
                onClick={() => void handleExportQueueCsv()}
              >
                Export CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-full border-slate-200"
                onClick={() => void handleExportQueuePdf()}
              >
                Export PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-full border-slate-200"
                disabled={submittingId === "dispatch-email-queue"}
                onClick={() => void handleDispatchPendingEmails()}
              >
                Dispatch pending notification emails
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search request queue"
              className="h-11 rounded-full border-slate-200 bg-slate-50 lg:max-w-md"
            />
            <div className="flex flex-wrap gap-2">
              {([
                ["all", "All"],
                ["pending", "Pending"],
                ["approved", "Approved"],
                ["rejected", "Rejected"],
                ["cancelled", "Cancelled"],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  className={cn(
                    "h-10 rounded-full border-slate-200 px-4",
                    statusFilter === value && "border-[#1368ff] bg-[#eef5ff] text-[#1368ff]",
                  )}
                  onClick={() => setStatusFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        {filteredRequests.map((request) => {
          const isPending = request.status === "pending"
          const isSubmitting = submittingId === request.id

          return (
            <article
              key={request.id}
              className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                      {request.requestedPlan}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
                        request.status === "pending" && "bg-amber-100 text-amber-700",
                        request.status === "approved" && "bg-emerald-100 text-emerald-700",
                        request.status === "rejected" && "bg-rose-100 text-rose-700",
                        request.status === "cancelled" && "bg-slate-100 text-slate-600",
                      )}
                    >
                      {request.status}
                    </span>
                    {request.accessInviteSentAt ? (
                      <span className="rounded-full bg-[#dbeafe] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1368ff]">
                        Invite sent
                      </span>
                    ) : null}
                  </div>

                  <div>
                    <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">{request.organizationName}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {request.requestorName} · {request.requestorEmail}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Expected seats</p>
                      <p className="mt-1 text-xl font-semibold tracking-[-0.04em] text-slate-950">{request.expectedSeats}</p>
                    </div>
                    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Roster mix</p>
                      <p className="mt-1 text-sm font-medium text-slate-950">
                        {request.expectedCoachCount ?? 0} coaches · {request.expectedAthleteCount ?? 0} athletes
                      </p>
                    </div>
                    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Submitted</p>
                      <p className="mt-1 text-sm font-medium text-slate-950">{formatDateLabel(request.createdAt, "Not submitted")}</p>
                    </div>
                    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Reviewed</p>
                      <p className="mt-1 text-sm font-medium text-slate-950">{formatDateLabel(request.reviewedAt)}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Job title</p>
                      <p className="mt-1 text-sm font-medium text-slate-950">{request.jobTitle ?? "Not provided"}</p>
                    </div>
                    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Organization type</p>
                      <p className="mt-1 text-sm font-medium text-slate-950">{request.organizationType ?? "Not provided"}</p>
                    </div>
                    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Region</p>
                      <p className="mt-1 text-sm font-medium text-slate-950">{request.region ?? "Not provided"}</p>
                    </div>
                    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Target start</p>
                      <p className="mt-1 text-sm font-medium text-slate-950">
                        {request.desiredStartDate ? new Date(request.desiredStartDate).toLocaleDateString() : "Flexible"}
                      </p>
                    </div>
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
                        request.accessInviteSentAt
                          ? "border-[#cfe2ff] bg-[#f6faff]"
                          : "border-amber-200 bg-amber-50",
                      )}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Initial access invite</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">
                        {request.accessInviteSentAt
                          ? `Sent ${formatDateLabel(request.accessInviteSentAt, "Unknown time")}`
                          : "Invite has not been confirmed as sent yet."}
                      </p>
                      {request.accessInviteLastError ? (
                        <p className="mt-2 text-sm text-rose-700">{request.accessInviteLastError}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {request.notes ? (
                    <div className="rounded-[22px] border border-slate-200 bg-[#f8fbff] px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Request notes</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{request.notes}</p>
                    </div>
                  ) : null}

                  {!isPending && request.reviewNotes ? (
                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Review notes</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{request.reviewNotes}</p>
                    </div>
                  ) : null}
                </div>

                <div className="w-full max-w-[360px] rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Decision</p>
                  <div className="mt-3 space-y-3">
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
                </div>
              </div>
            </article>
          )
        })}
      </section>
    </div>
  )
}
