"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { EmptyStateCard } from "@/components/ui/empty-state-card"
import { StandardPageHeader } from "@/components/ui/standard-page-header"
import { Textarea } from "@/components/ui/textarea"
import {
  getPlatformAdminPackageUpgradeRequests,
  reviewTenantPackageUpgradeRequest,
  type PlatformAdminPackageUpgradeRequestRecord,
} from "@/lib/data/platform-admin/ops-data"
import { getPackageById } from "@/lib/billing/package-catalog"

function formatDateLabel(value: string | null, emptyLabel = "Not reviewed") {
  if (!value) return emptyLabel
  return new Date(value).toLocaleString()
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

export default function PlatformAdminCommercialPage() {
  const [upgradeRequests, setUpgradeRequests] = useState<PlatformAdminPackageUpgradeRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false

    const loadUpgradeQueue = async () => {
      setLoading(true)
      const result = await getPlatformAdminPackageUpgradeRequests()
      if (cancelled) return

      if (!result.ok) {
        setError(result.error.message)
        setInfo(null)
        setLoading(false)
        return
      }

      setUpgradeRequests(result.data)
      setError(null)
      setInfo(null)
      setLoading(false)
    }

    void loadUpgradeQueue()
    return () => {
      cancelled = true
    }
  }, [])

  const pendingUpgradeRequests = useMemo(
    () => upgradeRequests.filter((item) => item.status === "pending").length,
    [upgradeRequests],
  )

  const reviewedUpgradeRequests = useMemo(
    () => upgradeRequests.filter((item) => item.status !== "pending").length,
    [upgradeRequests],
  )

  const handleUpgradeRequestReview = async (
    upgradeRequestId: string,
    status: Exclude<PlatformAdminPackageUpgradeRequestRecord["status"], "pending">,
  ) => {
    setSubmittingId(upgradeRequestId)
    const result = await reviewTenantPackageUpgradeRequest({
      upgradeRequestId,
      status,
      reviewNotes: reviewNotes[upgradeRequestId],
    })

    if (!result.ok) {
      setError(result.error.message)
      setInfo(null)
      setSubmittingId(null)
      return
    }

    const reviewedAt = new Date().toISOString()
    const target = upgradeRequests.find((item) => item.id === upgradeRequestId)

    setUpgradeRequests((current) =>
      current.map((item) =>
        item.id === upgradeRequestId
          ? {
              ...item,
              status,
              reviewNotes: reviewNotes[upgradeRequestId]?.trim() || null,
              reviewedAt,
            }
          : item,
      ),
    )
    setError(null)
    setInfo(target ? `Package upgrade ${status} for ${target.organizationName}.` : "Package upgrade request updated.")
    setSubmittingId(null)
  }

  return (
    <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
      <StandardPageHeader
        variant="admin"
        eyebrow="Platform admin commercial"
        title="Commercial changes without request-queue noise."
        description="Keep commercial upgrade decisions separate from tenant intake. Review package expansion requests here without mixing them into account provisioning."
        stats={[
          { label: "Pending upgrades", value: pendingUpgradeRequests },
          { label: "Reviewed", value: reviewedUpgradeRequests },
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
          Loading commercial queue...
        </section>
      ) : null}

      {!loading && upgradeRequests.length === 0 ? (
        <EmptyStateCard
          eyebrow="Commercial queue"
          title="No package upgrade requests yet."
          description="Upgrade requests appear here when club-admins hit package caps and ask for a higher tier."
        />
      ) : null}

      {!loading && upgradeRequests.length > 0 ? (
        <section className="space-y-4">
          {upgradeRequests.map((request) => (
            <article
              key={request.id}
              className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:p-6"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="status-chip-neutral rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
                      {request.status}
                    </span>
                    <span className="status-chip-info rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
                      {getPackageById(request.currentPackage)?.label ?? request.currentPackage} to{" "}
                      {getPackageById(request.requestedPackage)?.label ?? request.requestedPackage}
                    </span>
                  </div>

                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">{request.organizationName}</h2>
                    <p className="mt-1 text-sm text-slate-500">Requested {new Date(request.createdAt).toLocaleString()}</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <MetaCard
                      label="Current package"
                      value={getPackageById(request.currentPackage)?.label ?? request.currentPackage}
                      detail={`Requested package: ${getPackageById(request.requestedPackage)?.label ?? request.requestedPackage}`}
                    />
                    <MetaCard
                      label="Reason"
                      value={request.reason?.trim() || "No reason provided"}
                      detail={
                        request.reviewNotes
                          ? `Review notes: ${request.reviewNotes}`
                          : request.reviewedAt
                            ? `Reviewed ${formatDateLabel(request.reviewedAt)}`
                            : "Awaiting review"
                      }
                    />
                  </div>
                </div>

                {request.status === "pending" ? (
                  <div className="w-full max-w-[360px] space-y-3">
                    <Textarea
                      value={reviewNotes[request.id] ?? ""}
                      onChange={(event) =>
                        setReviewNotes((current) => ({
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
                        disabled={submittingId === request.id}
                        onClick={() => void handleUpgradeRequestReview(request.id, "approved")}
                      >
                        Approve upgrade
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-full border-slate-200 px-4"
                        disabled={submittingId === request.id}
                        onClick={() => void handleUpgradeRequestReview(request.id, "rejected")}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  )
}
