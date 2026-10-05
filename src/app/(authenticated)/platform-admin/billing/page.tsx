"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { CheckCircle, Info, MagnifyingGlass } from "@phosphor-icons/react"
import { EmptyState, PageHeader, Panel, Stat, Tag, type TagTone } from "@/components/sk"
import { getPackageById, packageOptions } from "@/lib/billing/package-catalog"
import {
  getPlatformAdminRequestQueue,
  setTenantRequestLifecycleState,
  type PlatformAdminRequestRecord,
} from "@/lib/data/platform-admin/ops-data"
import { formatDateTime } from "@/lib/format/ops-format"
import { tenantLifecycleLabels, type TenantBillingStatus, type TenantLifecycleStatus } from "@/lib/tenant/lifecycle"

type BillingAction = "fail" | "reopen"

const PAGE_SIZE = 50

/** Lifecycle states that mean the request became (or is becoming) a club with a billing record. */
const CLUB_LIFECYCLES: TenantLifecycleStatus[] = ["approved_pending_billing", "billing_failed", "active_onboarding", "active", "suspended"]

const BILLING_STATUS: Record<TenantBillingStatus, { label: string; tone: TagTone; meaning: string }> = {
  pending: {
    label: "Setup not done",
    tone: "yellow",
    meaning: "The club is approved but its admin has not confirmed a billing contact and cycle yet. The club cannot go live until they do.",
  },
  mocked_complete: {
    label: "Setup done",
    tone: "green",
    meaning: "The club admin confirmed a billing contact and a billing cycle. No card was entered and no payment was taken.",
  },
  failed: {
    label: "Marked failed",
    tone: "coral",
    meaning: "Someone on the SKTR team marked billing as failed from this screen. The club admin is sent back to billing setup the next time they open the app.",
  },
  active: {
    label: "Active",
    tone: "green",
    meaning: "Reserved for when a payment provider is connected. Nothing in the app sets this on its own today.",
  },
  past_due: {
    label: "Past due",
    tone: "coral",
    meaning: "Reserved for when a payment provider is connected. Nothing in the app sets this on its own today.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "plain",
    meaning: "Reserved for when a payment provider is connected. Nothing in the app sets this on its own today.",
  },
}

function statusOf(record: PlatformAdminRequestRecord): TenantBillingStatus {
  return record.billingStatus ?? "pending"
}

function packageLabel(id: string | null | undefined) {
  return getPackageById(id)?.label ?? (id ? id : "Unknown")
}

function cycleLabel(cycle: PlatformAdminRequestRecord["billingCycle"]) {
  return cycle === "annual" ? "Annual" : cycle === "monthly" ? "Monthly" : "Not chosen"
}

/** A provider name worth showing. The database default "mock-billing" is a placeholder, not a provider. */
function realProvider(record: PlatformAdminRequestRecord) {
  const provider = record.billingProvider?.trim()
  return provider && provider !== "mock-billing" ? provider : null
}

const th = "whitespace-nowrap px-3 py-3 font-semibold"
const td = "block min-w-0 lg:table-cell lg:px-3 lg:py-4 lg:align-top"
const cellLabel = "sk-label mb-0.5 block lg:hidden"

export default function PlatformAdminBillingPage() {
  const [records, setRecords] = useState<PlatformAdminRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | TenantBillingStatus>("all")
  const [packageFilter, setPackageFilter] = useState("all")
  const [cycleFilter, setCycleFilter] = useState("all")
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [confirm, setConfirm] = useState<{ id: string; action: BillingAction } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  const load = useCallback(async () => {
    const result = await getPlatformAdminRequestQueue()
    if (!result.ok) {
      setLoadError(result.error.message)
      setLoading(false)
      return
    }
    setRecords(result.data)
    setLoadError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const clubs = useMemo(
    () =>
      records
        .filter((record) => Boolean(record.provisionedTenantId) || (record.lifecycleStatus !== null && CLUB_LIFECYCLES.includes(record.lifecycleStatus)))
        .sort((left, right) => left.organizationName.localeCompare(right.organizationName)),
    [records],
  )

  const summary = useMemo(
    () => ({
      total: clubs.length,
      done: clubs.filter((club) => statusOf(club) === "mocked_complete" || statusOf(club) === "active").length,
      waiting: clubs.filter((club) => statusOf(club) === "pending").length,
      failed: clubs.filter((club) => statusOf(club) === "failed" || statusOf(club) === "past_due").length,
    }),
    [clubs],
  )

  const statusesInUse = useMemo(() => [...new Set(clubs.map(statusOf))], [clubs])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return clubs.filter((club) => {
      if (statusFilter !== "all" && statusOf(club) !== statusFilter) return false
      if (packageFilter !== "all" && club.requestedPlan !== packageFilter) return false
      if (cycleFilter !== "all" && (club.billingCycle ?? "none") !== cycleFilter) return false
      if (!needle) return true
      return [club.organizationName, club.billingContactName ?? "", club.billingContactEmail ?? "", club.requestorEmail, packageLabel(club.requestedPlan)].some(
        (value) => value.toLowerCase().includes(needle),
      )
    })
  }, [clubs, cycleFilter, packageFilter, query, statusFilter])

  const hasFilters = Boolean(query.trim()) || statusFilter !== "all" || packageFilter !== "all" || cycleFilter !== "all"
  const clearFilters = () => {
    setQuery("")
    setStatusFilter("all")
    setPackageFilter("all")
    setCycleFilter("all")
  }

  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [query, statusFilter, packageFilter, cycleFilter])

  const shown = filtered.slice(0, visible)

  const runAction = async (club: PlatformAdminRequestRecord, action: BillingAction) => {
    if (busyId) return
    setBusyId(club.id)
    setRowError(null)
    setDone(null)
    const result = await setTenantRequestLifecycleState(
      action === "fail"
        ? { requestId: club.id, lifecycleStatus: "billing_failed", billingStatus: "failed" }
        : { requestId: club.id, lifecycleStatus: "approved_pending_billing", billingStatus: "pending" },
    )
    if (!result.ok) {
      setBusyId(null)
      setRowError({ id: club.id, message: `Could not save the change. ${result.error.message}` })
      return
    }
    setConfirm(null)
    setDone(
      action === "fail"
        ? `Billing for ${club.organizationName} is marked failed. Their admin will be asked to redo billing setup.`
        : `Billing setup is open again for ${club.organizationName}. Their admin can complete it the next time they sign in.`,
    )
    await load()
    setBusyId(null)
  }

  return (
    <div className="sk-page">
      {loadError ? (
        <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
          {records.length === 0 ? "We could not load club billing. " : ""}
          {loadError}
        </p>
      ) : null}

      <PageHeader title="Club billing" lede="Every club's package, billing setup, cycle and billing contact, exactly as stored." />

      <div className="flex items-start gap-3 rounded-2xl bg-sk-blue-tint p-4">
        <Info className="mt-0.5 size-5 shrink-0 text-[#1638b8]" weight="fill" aria-hidden />
        <p className="text-sm leading-relaxed text-sk-ink-2">
          <span className="font-bold text-sk-ink">Payments are not collected in the app yet.</span> There is no payment provider connected, so there are no
          charges, invoices or revenue figures to show, and packages have no prices on record. The billing status below only tells you whether a club has
          finished the billing setup step, or whether you marked it failed by hand.
        </p>
      </div>

      {done ? (
        <p role="status" className="flex items-start gap-2 rounded-2xl bg-sk-green-tint px-4 py-3 text-sm font-bold text-[#07673f]">
          <CheckCircle className="mt-0.5 size-5 shrink-0" weight="fill" aria-hidden />
          {done}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sk-mute" role="status">
          Loading club billing...
        </p>
      ) : clubs.length === 0 ? (
        loadError ? null : (
          <EmptyState
            title="No clubs to bill yet"
            body="A club appears here once you approve its request. You will see its package, whether billing setup is done, and who to contact."
            action={
              <Link to="/platform-admin/requests" className="sk-btn sk-btn-quiet sk-btn-sm">
                Open club requests
              </Link>
            }
          />
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Stat label="Clubs" value={summary.total.toLocaleString()} hint="Approved or live" />
            <Stat label="Setup done" value={summary.done.toLocaleString()} hint="Contact and cycle confirmed" />
            <Stat label="Setup not done" value={summary.waiting.toLocaleString()} hint="Waiting on the club admin" />
            <Stat label="Marked failed" value={summary.failed.toLocaleString()} hint="Sent back to billing setup" tone={summary.failed > 0 ? "coral" : "plain"} />
          </div>

          <Panel
            flush
            className="min-w-0 max-w-full overflow-hidden"
            title={`${filtered.length.toLocaleString()} ${filtered.length === 1 ? "club" : "clubs"}`}
            hint={hasFilters ? `Filtered from ${clubs.length.toLocaleString()} in total.` : "Dates are shown in your local time."}
          >
            <div className="grid grid-cols-2 gap-3 px-5 pb-5 pt-4 sm:px-6 lg:flex lg:flex-wrap lg:items-end">
              <label className="col-span-2 block lg:w-72">
                <span className="sk-label mb-1.5 block">Search clubs</span>
                <span className="relative block">
                  <MagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-sk-mute" weight="bold" aria-hidden />
                  <input
                    type="search"
                    className="sk-field pl-11"
                    placeholder="Club or billing contact"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </span>
              </label>
              <label className="col-span-2 block min-w-0 sm:col-span-1 lg:w-48">
                <span className="sk-label mb-1.5 block">Billing status</span>
                <select className="sk-field" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | TenantBillingStatus)}>
                  <option value="all">Any status</option>
                  {statusesInUse.map((status) => (
                    <option key={status} value={status}>
                      {BILLING_STATUS[status]?.label ?? status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-0 lg:w-40">
                <span className="sk-label mb-1.5 block">Package</span>
                <select className="sk-field" value={packageFilter} onChange={(event) => setPackageFilter(event.target.value)}>
                  <option value="all">Any package</option>
                  {packageOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-0 lg:w-40">
                <span className="sk-label mb-1.5 block">Cycle</span>
                <select className="sk-field" value={cycleFilter} onChange={(event) => setCycleFilter(event.target.value)}>
                  <option value="all">Any cycle</option>
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                  <option value="none">Not chosen</option>
                </select>
              </label>
              {hasFilters ? (
                <button type="button" className="sk-btn sk-btn-ghost col-span-2 justify-self-start" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : null}
            </div>

            {filtered.length === 0 ? (
              <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                <EmptyState
                  className="border-0 bg-sk-canvas"
                  title="No clubs match these filters"
                  body={`There are ${clubs.length.toLocaleString()} clubs, but none fit the current search and filters.`}
                  action={
                    <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm" onClick={clearFilters}>
                      Clear filters
                    </button>
                  }
                />
              </div>
            ) : (
              <>
                <div className="relative overflow-x-auto border-t border-sk-line">
                  <table className="block w-full text-left lg:table lg:min-w-[940px]">
                    <caption className="sr-only">Billing state for each club{hasFilters ? ", filtered" : ""}</caption>
                    <thead className="hidden lg:table-header-group">
                      <tr className="border-b border-sk-line text-sm text-sk-mute">
                        <th scope="col" className={`${th} pl-5 sm:pl-6`}>Club</th>
                        <th scope="col" className={th}>Package</th>
                        <th scope="col" className={th}>Billing status</th>
                        <th scope="col" className={th}>Cycle</th>
                        <th scope="col" className={th}>Billing contact</th>
                        <th scope="col" className={th}>Setup done on</th>
                        <th scope="col" className={`${th} pr-5 text-right sm:pr-6`}>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="block lg:table-row-group">
                      {shown.map((club) => {
                        const status = statusOf(club)
                        const statusInfo = BILLING_STATUS[status]
                        const canFail =
                          club.lifecycleStatus === "approved_pending_billing" || club.lifecycleStatus === "active_onboarding" || club.lifecycleStatus === "active"
                        const canReopen = club.lifecycleStatus === "billing_failed"
                        const confirming = confirm?.id === club.id ? confirm.action : null
                        const busy = busyId === club.id
                        const error = rowError?.id === club.id ? rowError.message : null
                        const provider = realProvider(club)
                        return (
                          <Fragment key={club.id}>
                            <tr
                              className={`grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 sm:px-6 lg:table-row lg:p-0 ${confirming || error ? "" : "border-b border-sk-line last:border-b-0"}`}
                            >
                              <th scope="row" className={`${td} col-span-2 font-normal lg:max-w-[16rem] lg:pl-6`}>
                                <span className="block break-words text-lg font-bold text-sk-ink lg:text-base">{club.organizationName}</span>
                                <span className="block text-sm font-normal text-sk-mute">
                                  {club.lifecycleStatus ? tenantLifecycleLabels[club.lifecycleStatus] ?? club.lifecycleStatus : "Status not set"}
                                </span>
                              </th>
                              <td className={`${td} whitespace-nowrap font-semibold text-sk-ink`}>
                                <span className={cellLabel}>Package</span>
                                {packageLabel(club.requestedPlan)}
                              </td>
                              <td className={td}>
                                <span className={cellLabel}>Billing status</span>
                                <Tag tone={statusInfo?.tone ?? "plain"}>{statusInfo?.label ?? status}</Tag>
                                {club.billingFailedAt && (status === "failed" || club.lifecycleStatus === "billing_failed") ? (
                                  <span className="mt-1 block whitespace-nowrap text-sm text-sk-mute">{formatDateTime(club.billingFailedAt)}</span>
                                ) : null}
                                {provider ? <span className="mt-1 block text-sm text-sk-mute">Provider: {provider}</span> : null}
                              </td>
                              <td className={`${td} whitespace-nowrap ${club.billingCycle ? "text-sk-ink-2" : "text-sk-mute"}`}>
                                <span className={cellLabel}>Cycle</span>
                                {cycleLabel(club.billingCycle)}
                              </td>
                              <td className={`${td} order-last col-span-2 lg:max-w-[16rem]`}>
                                <span className={cellLabel}>Billing contact</span>
                                {club.billingContactName?.trim() || club.billingContactEmail ? (
                                  <>
                                    <span className="block break-words font-semibold text-sk-ink">{club.billingContactName?.trim() || "No name"}</span>
                                    {club.billingContactEmail ? (
                                      <a href={`mailto:${club.billingContactEmail}`} className="block break-all text-sm text-sk-blue hover:underline">
                                        {club.billingContactEmail}
                                      </a>
                                    ) : (
                                      <span className="block text-sm text-sk-mute">No email</span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-sk-mute">Not added yet</span>
                                )}
                              </td>
                              <td className={`${td} lg:whitespace-nowrap ${club.billingStartedAt ? "text-sk-ink-2" : "text-sk-mute"}`}>
                                <span className={cellLabel}>Setup done on</span>
                                {club.billingStartedAt ? formatDateTime(club.billingStartedAt) : "Not yet"}
                              </td>
                              <td className={`${canFail || canReopen ? td : "hidden lg:table-cell"} order-last col-span-2 whitespace-nowrap lg:pr-6 lg:text-right`}>
                                {canFail ? (
                                  <button
                                    type="button"
                                    className="sk-btn sk-btn-quiet sk-btn-sm lg:border-transparent"
                                    aria-expanded={confirming === "fail"}
                                    disabled={Boolean(busyId)}
                                    onClick={() => {
                                      setRowError(null)
                                      setConfirm(confirming === "fail" ? null : { id: club.id, action: "fail" })
                                    }}
                                  >
                                    Mark failed
                                  </button>
                                ) : canReopen ? (
                                  <button
                                    type="button"
                                    className="sk-btn sk-btn-quiet sk-btn-sm"
                                    aria-expanded={confirming === "reopen"}
                                    disabled={Boolean(busyId)}
                                    onClick={() => {
                                      setRowError(null)
                                      setConfirm(confirming === "reopen" ? null : { id: club.id, action: "reopen" })
                                    }}
                                  >
                                    Reopen setup
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                            {confirming || error ? (
                              <tr className="block border-b border-sk-line last:border-b-0 lg:table-row">
                                <td colSpan={7} className="block px-5 pb-4 sm:px-6 lg:table-cell">
                                  <div className="sk-well max-w-[46rem]">
                                    {error ? (
                                      <p role="alert" className="mb-2 text-sm font-semibold text-[#b32a0c]">
                                        {error}
                                      </p>
                                    ) : null}
                                    {confirming ? (
                                      <>
                                        <p className="font-bold text-sk-ink">
                                          {confirming === "fail"
                                            ? `Mark billing as failed for ${club.organizationName}?`
                                            : `Reopen billing setup for ${club.organizationName}?`}
                                        </p>
                                        <p className="mt-1 text-sm text-sk-ink-2">
                                          {confirming === "fail"
                                            ? "The club is locked out of the app until its admin completes billing setup again. No payment is involved. The change is written to Platform activity."
                                            : "The status goes back to setup not done, and the club admin can complete billing setup the next time they sign in. The change is written to Platform activity."}
                                        </p>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            className={`sk-btn sk-btn-sm ${confirming === "fail" ? "sk-btn-danger" : "sk-btn-ink"}`}
                                            disabled={busy}
                                            onClick={() => void runAction(club, confirming)}
                                          >
                                            {busy ? "Saving..." : confirming === "fail" ? "Yes, mark failed" : "Yes, reopen setup"}
                                          </button>
                                          <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm" disabled={busy} onClick={() => setConfirm(null)}>
                                            Cancel
                                          </button>
                                        </div>
                                      </>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sk-line px-5 py-4 sm:px-6">
                  <p className="text-sm text-sk-mute" aria-live="polite">
                    Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()} {filtered.length === 1 ? "club" : "clubs"}.
                  </p>
                  {filtered.length > shown.length ? (
                    <button type="button" className="sk-btn sk-btn-quiet" onClick={() => setVisible((current) => current + PAGE_SIZE)}>
                      Load {Math.min(PAGE_SIZE, filtered.length - shown.length)} more
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </Panel>

          <Panel title="What each billing status means" hint="These are stored labels, not payment results.">
            <dl>
              {(Object.keys(BILLING_STATUS) as TenantBillingStatus[]).map((status) => (
                <div
                  key={status}
                  className="grid gap-x-6 gap-y-1 border-b border-sk-line py-3.5 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start"
                >
                  <dt>
                    <Tag tone={BILLING_STATUS[status].tone}>{BILLING_STATUS[status].label}</Tag>
                  </dt>
                  <dd className="text-sm leading-relaxed text-sk-ink-2">{BILLING_STATUS[status].meaning}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-sk-mute">
              Package changes are handled in{" "}
              <Link to="/platform-admin/commercial" className="font-semibold text-sk-blue hover:underline">
                Package requests
              </Link>
              .
            </p>
          </Panel>
        </>
      )}
    </div>
  )
}
