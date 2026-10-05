"use client"

import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, CheckCircle, Info, WarningCircle } from "@phosphor-icons/react"
import { EmptyState, PageHeader, Panel, Tag, type TagTone } from "@/components/sk"
import { getPackageById, type PackageDefinition } from "@/lib/billing/package-catalog"
import {
  getPlatformAdminPackageUpgradeRequests,
  getPlatformAdminRequestQueue,
  getPlatformTenantSizes,
  reviewTenantPackageUpgradeRequest,
  type PlatformAdminPackageUpgradeRequestRecord,
  type PlatformAdminRequestRecord,
  type PlatformTenantSize,
} from "@/lib/data/platform-admin/ops-data"
import { formatDateTime } from "@/lib/format/ops-format"

type Resource = "teams" | "coaches" | "athletes"
type Decision = "approved" | "rejected"
type UpgradeRequest = PlatformAdminPackageUpgradeRequestRecord

const RESOURCES: Array<{ key: Resource; label: string }> = [
  { key: "teams", label: "Teams" },
  { key: "coaches", label: "Coaches" },
  { key: "athletes", label: "Athletes" },
]

const STATUS: Record<UpgradeRequest["status"], { label: string; tone: TagTone }> = {
  pending: { label: "Waiting", tone: "yellow" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Declined", tone: "coral" },
  cancelled: { label: "Cancelled", tone: "plain" },
}

const HISTORY_PAGE = 20

function packageLabel(id: string | null | undefined) {
  return getPackageById(id)?.label ?? (id ? id : "Unknown")
}

function limitText(definition: PackageDefinition | null, resource: Resource) {
  if (!definition) return "Unknown"
  const limit = definition.limits[resource]
  return Number.isFinite(limit) ? limit.toLocaleString() : "No limit"
}

export default function PlatformAdminCommercialPage() {
  const formId = useId()
  const [upgradeRequests, setUpgradeRequests] = useState<UpgradeRequest[]>([])
  const [clubs, setClubs] = useState<PlatformAdminRequestRecord[]>([])
  /** Live club sizes by tenant id. Null when they cannot be read, and sign-up estimates are shown instead. */
  const [sizes, setSizes] = useState<Map<string, PlatformTenantSize> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clubsError, setClubsError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<{ id: string; decision: Decision } | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [historyVisible, setHistoryVisible] = useState(HISTORY_PAGE)

  const load = useCallback(async () => {
    const [upgradeResult, clubResult, sizesResult] = await Promise.all([
      getPlatformAdminPackageUpgradeRequests(),
      getPlatformAdminRequestQueue(),
      getPlatformTenantSizes(),
    ])
    setSizes(sizesResult)
    if (clubResult.ok) {
      setClubs(clubResult.data)
      setClubsError(null)
    } else {
      setClubsError(clubResult.error.message)
    }
    if (upgradeResult.ok) {
      setUpgradeRequests(upgradeResult.data)
      setLoadError(null)
    } else {
      setLoadError(upgradeResult.error.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** The club's own record (newest first), which holds its real name, package in force and billing contact. */
  const clubByTenant = useMemo(() => {
    const map = new Map<string, PlatformAdminRequestRecord>()
    for (const club of clubs) {
      if (club.provisionedTenantId && !map.has(club.provisionedTenantId)) map.set(club.provisionedTenantId, club)
    }
    return map
  }, [clubs])

  const clubName = (request: UpgradeRequest) => clubByTenant.get(request.tenantId)?.organizationName ?? request.organizationName

  const pending = upgradeRequests.filter((request) => request.status === "pending")
  const decided = upgradeRequests
    .filter((request) => request.status !== "pending")
    .sort((left, right) => (right.reviewedAt ?? right.createdAt).localeCompare(left.reviewedAt ?? left.createdAt))

  const openConfirm = (request: UpgradeRequest, decision: Decision) => {
    setDone(null)
    if (decision === "rejected" && !(notes[request.id] ?? "").trim()) {
      setConfirm(null)
      setRowError({ id: request.id, message: "Write a note before you decline. The club sees it on their billing screen." })
      return
    }
    setRowError(null)
    setConfirm(confirm?.id === request.id && confirm.decision === decision ? null : { id: request.id, decision })
  }

  const decide = async (request: UpgradeRequest, decision: Decision) => {
    if (busyId) return
    const note = (notes[request.id] ?? "").trim()
    if (decision === "rejected" && !note) return
    setBusyId(request.id)
    setRowError(null)
    const result = await reviewTenantPackageUpgradeRequest({ upgradeRequestId: request.id, status: decision, reviewNotes: note })
    if (!result.ok) {
      setBusyId(null)
      setRowError({ id: request.id, message: `Could not save your decision. ${result.error.message}` })
      return
    }
    const name = clubName(request)
    setDone(
      decision === "approved"
        ? `${name} is now on ${packageLabel(request.requestedPackage)}. The new limits apply straight away.`
        : `Declined the request from ${name}. They will see your note on their billing screen.`,
    )
    setConfirm(null)
    setNotes((current) => {
      const next = { ...current }
      delete next[request.id]
      return next
    })
    await load()
    setBusyId(null)
  }

  return (
    <div className="sk-page">
      {loadError ? (
        <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
          We could not load package requests. {loadError}
        </p>
      ) : null}

      <PageHeader
        title="Package requests"
        lede="Clubs ask here when they want a different package. Approving changes their limits straight away. Declining sends your note back to them."
      />

      {done ? (
        <p role="status" className="flex items-start gap-2 rounded-2xl bg-sk-green-tint px-4 py-3 text-sm font-bold text-[#07673f]">
          <CheckCircle className="mt-0.5 size-5 shrink-0" weight="fill" aria-hidden />
          {done}
        </p>
      ) : null}

      {clubsError ? (
        <p role="alert" className="rounded-2xl bg-sk-yellow-tint px-4 py-3 text-sm font-semibold text-[#7a5600]">
          Club details could not be loaded, so club names and current packages may be missing below. {clubsError}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sk-mute" role="status">
          Loading package requests...
        </p>
      ) : (
        <>
          <Panel
            title={pending.length === 0 ? "Waiting for you" : `${pending.length.toLocaleString()} waiting for you`}
            hint={
              sizes
                ? "Limits come from the package list. In use now counts each club's teams that are not archived, active coaches and athletes."
                : "Limits come from the package list. Live counts of each club's teams, coaches and athletes could not be loaded, so the numbers a club gave at sign-up are shown instead."
            }
          >
            {pending.length === 0 ? (
              loadError ? null : (
                <EmptyState
                  className="border-0 bg-sk-canvas"
                  title="Nothing to review"
                  body="When a club admin asks for a different package from their billing screen, the request lands here with their reason."
                />
              )
            ) : (
              <ul>
                {pending.map((request) => {
                  const club = clubByTenant.get(request.tenantId) ?? null
                  const usage = sizes?.get(request.tenantId) ?? null
                  const fromPackage = getPackageById(request.currentPackage)
                  const toPackage = getPackageById(request.requestedPackage)
                  const packageNow = club?.requestedPlan ?? null
                  const stale = packageNow !== null && packageNow !== request.currentPackage
                  const confirming = confirm?.id === request.id ? confirm.decision : null
                  const busy = busyId === request.id
                  const noteId = `${formId}-note-${request.id}`
                  const error = rowError?.id === request.id ? rowError.message : null
                  const asker = request.requestedByEmail ?? null
                  return (
                    <li key={request.id} className="border-b border-sk-line py-6 first:pt-0 last:border-b-0 last:pb-0">
                      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-10">
                        <div className="min-w-0 space-y-4">
                          <div>
                            <h3 className="sk-h2 break-words">{clubName(request)}</h3>
                            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold text-sk-ink">
                              {packageLabel(request.currentPackage)}
                              <ArrowRight className="size-5 text-sk-blue" weight="bold" aria-label="to" />
                              <span className="text-sk-blue">{packageLabel(request.requestedPackage)}</span>
                            </p>
                            <p className="mt-1 text-sm text-sk-mute">
                              Asked {formatDateTime(request.createdAt)}
                              {asker ? ` by ${asker}` : ""}
                            </p>
                          </div>

                          <div>
                            <p className="sk-label">Their reason</p>
                            <p className={`mt-1 break-words ${request.reason ? "text-sk-ink" : "text-sk-mute"}`}>
                              {request.reason?.trim() || "They did not give a reason."}
                            </p>
                          </div>

                          {stale ? (
                            <p className="flex items-start gap-2 rounded-2xl bg-sk-yellow-tint px-4 py-3 text-sm font-semibold text-[#7a5600]">
                              <WarningCircle className="mt-0.5 size-5 shrink-0" weight="fill" aria-hidden />
                              This club is on {packageLabel(packageNow)} now, not {packageLabel(request.currentPackage)} as it was when they asked.
                              {packageNow === request.requestedPackage ? " Approving will not change anything." : ""}
                            </p>
                          ) : null}

                          <div className="relative -mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
                            <table className="w-full min-w-[300px] text-left">
                              <caption className="sr-only">Package limits now and after the change</caption>
                              <thead>
                                <tr className="border-b border-sk-line text-sm text-sk-mute">
                                  <th scope="col" className="py-2 pr-3 font-semibold">Limit</th>
                                  {usage ? <th scope="col" className="px-3 py-2 text-right font-semibold">In use now</th> : null}
                                  <th scope="col" className="px-3 py-2 text-right font-semibold">{packageLabel(request.currentPackage)}</th>
                                  <th scope="col" className="py-2 pl-3 text-right font-semibold">{packageLabel(request.requestedPackage)}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {RESOURCES.map((resource) => (
                                  <tr key={resource.key} className="border-b border-sk-line last:border-b-0">
                                    <th scope="row" className="py-2.5 pr-3 font-semibold text-sk-ink-2">{resource.label}</th>
                                    {usage ? <td className="px-3 py-2.5 text-right tabular-nums text-sk-ink-2">{usage[resource.key].toLocaleString()}</td> : null}
                                    <td className="px-3 py-2.5 text-right tabular-nums text-sk-ink-2">{limitText(fromPackage, resource.key)}</td>
                                    <td className="py-2.5 pl-3 text-right font-bold tabular-nums text-sk-ink">{limitText(toPackage, resource.key)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {club && usage ? (
                            <p className="text-sm text-sk-mute">
                              {club.billingContactEmail
                                ? `Billing contact: ${club.billingContactName?.trim() || club.billingContactEmail} (${club.billingContactEmail}).`
                                : "No billing contact on record."}
                            </p>
                          ) : club ? (
                            <p className="text-sm text-sk-mute">
                              At sign-up they expected {(club.expectedCoachCount ?? 0).toLocaleString()} coaches and{" "}
                              {(club.expectedAthleteCount ?? 0).toLocaleString()} athletes.
                              {club.billingContactEmail ? ` Billing contact: ${club.billingContactName?.trim() || club.billingContactEmail} (${club.billingContactEmail}).` : ""}
                            </p>
                          ) : null}
                        </div>

                        <div className="min-w-0 space-y-3">
                          <div>
                            <label htmlFor={noteId} className="sk-label mb-1.5 block">
                              Note to the club
                            </label>
                            <textarea
                              id={noteId}
                              className="sk-field h-auto min-h-28 py-2.5"
                              maxLength={500}
                              placeholder="Needed to decline, optional to approve"
                              aria-invalid={error && !(notes[request.id] ?? "").trim() ? true : undefined}
                              value={notes[request.id] ?? ""}
                              disabled={busy}
                              onChange={(event) => {
                                setNotes((current) => ({ ...current, [request.id]: event.target.value }))
                                if (rowError?.id === request.id) setRowError(null)
                              }}
                            />
                            <p className="mt-1.5 text-sm text-sk-mute">The club admin sees this note next to the decision on their billing screen.</p>
                          </div>

                          {error ? (
                            <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
                              {error}
                            </p>
                          ) : null}

                          {confirming ? (
                            <div className="sk-well" role="group" aria-label="Confirm your decision">
                              <p className="font-bold text-sk-ink">
                                {confirming === "approved"
                                  ? `Move ${clubName(request)} to ${packageLabel(request.requestedPackage)}?`
                                  : `Decline this request from ${clubName(request)}?`}
                              </p>
                              <p className="mt-1 text-sm text-sk-ink-2">
                                {confirming === "approved"
                                  ? "Their package limits change as soon as you confirm. Nothing is charged, because payments are not collected in the app."
                                  : "They stay on their current package and see your note. They can send a new request afterwards."}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className={`sk-btn ${confirming === "approved" ? "sk-btn-primary" : "sk-btn-danger"}`}
                                  disabled={busy}
                                  onClick={() => void decide(request, confirming)}
                                >
                                  {busy ? "Saving..." : confirming === "approved" ? "Yes, change package" : "Yes, decline"}
                                </button>
                                <button type="button" className="sk-btn sk-btn-ghost" disabled={busy} onClick={() => setConfirm(null)}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <button type="button" className="sk-btn sk-btn-ink" disabled={Boolean(busyId)} onClick={() => openConfirm(request, "approved")}>
                                Approve
                              </button>
                              <button type="button" className="sk-btn sk-btn-quiet" disabled={Boolean(busyId)} onClick={() => openConfirm(request, "rejected")}>
                                Decline
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          <Panel
            title="Decided"
            hint={decided.length > 0 ? `${decided.length.toLocaleString()} ${decided.length === 1 ? "request" : "requests"}, newest decision first.` : undefined}
          >
            {decided.length === 0 ? (
              <p className="text-sk-mute">No decisions yet. Approved and declined requests are kept here with your note.</p>
            ) : (
              <>
                <ul>
                  {decided.slice(0, historyVisible).map((request) => (
                    <li
                      key={request.id}
                      className="grid gap-x-6 gap-y-1 border-b border-sk-line py-4 first:pt-0 last:border-b-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-start"
                    >
                      <div className="min-w-0">
                        <p className="break-words font-bold text-sk-ink">{clubName(request)}</p>
                        <p className="text-sm text-sk-ink-2">
                          {packageLabel(request.currentPackage)} to {packageLabel(request.requestedPackage)}
                        </p>
                      </div>
                      <div className="min-w-0 text-sm">
                        <p className="text-sk-mute">
                          Asked {formatDateTime(request.createdAt)}
                          {request.reviewedAt ? `. Decided ${formatDateTime(request.reviewedAt)}` : ""}
                        </p>
                        {request.reason ? <p className="mt-1 break-words text-sk-ink-2">Their reason: {request.reason}</p> : null}
                        <p className={`mt-1 break-words ${request.reviewNotes ? "text-sk-ink-2" : "text-sk-mute"}`}>
                          {request.reviewNotes ? `Your note: ${request.reviewNotes}` : "No note was sent."}
                        </p>
                      </div>
                      <div className="mt-1 md:mt-0 md:justify-self-end">
                        <Tag tone={STATUS[request.status]?.tone ?? "plain"}>{STATUS[request.status]?.label ?? request.status}</Tag>
                      </div>
                    </li>
                  ))}
                </ul>
                {decided.length > historyVisible ? (
                  <button type="button" className="sk-btn sk-btn-quiet mt-4" onClick={() => setHistoryVisible((current) => current + HISTORY_PAGE)}>
                    Load {Math.min(HISTORY_PAGE, decided.length - historyVisible)} more
                  </button>
                ) : null}
              </>
            )}
          </Panel>

          <div className="flex items-start gap-3 rounded-2xl bg-sk-blue-tint p-4">
            <Info className="mt-0.5 size-5 shrink-0 text-[#1638b8]" weight="fill" aria-hidden />
            <p className="text-sm leading-relaxed text-sk-ink-2">
              Every decision is written to{" "}
              <Link to="/platform-admin/audit" className="font-bold text-sk-ink underline underline-offset-2">
                Platform activity
              </Link>
              . To see each club&apos;s package and billing state, open{" "}
              <Link to="/platform-admin/billing" className="font-bold text-sk-ink underline underline-offset-2">
                Club billing
              </Link>
              .
            </p>
          </div>
        </>
      )}
    </div>
  )
}
