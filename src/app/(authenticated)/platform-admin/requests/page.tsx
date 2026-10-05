import { ArrowCounterClockwise, ArrowSquareOut, Check, Copy, DownloadSimple, EnvelopeSimple, PaperPlaneTilt } from "@phosphor-icons/react"
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Button,
  DataTable,
  EmptyState,
  Fact,
  FactList,
  Field,
  Input,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  SearchInput,
  Section,
  Sheet,
  SkeletonRows,
  StatusDot,
  StatusText,
  SubSection,
  SubSections,
  TableSub,
  Tabs,
  Tag,
  Textarea,
  type DataTableColumn,
  type StateTone,
  type TagTone,
} from "@/components/sk"
import { doesPackageFitRollout, getPackageById, getRecommendedPackage } from "@/lib/billing/package-catalog"
import {
  approveAndProvisionTenantRequest,
  dispatchPendingNotificationEmails,
  getPlatformAdminRequestHistory,
  getPlatformAdminRequestQueue,
  logPlatformAdminExport,
  previewInitialClubAdminAccessInvite,
  reviewTenantProvisionRequest,
  sendInitialClubAdminAccessInvite,
  setTenantRequestLifecycleState,
  type PlatformAdminRequestRecord,
  type PlatformAuditEventRecord,
} from "@/lib/data/platform-admin/ops-data"
import { downloadCsv, plural } from "@/lib/format/ops-format"
import { getBackendMode } from "@/lib/supabase/config"
import type { TenantBillingStatus, TenantLifecycleStatus } from "@/lib/tenant/lifecycle"

type Request = PlatformAdminRequestRecord

/**
 * Stages group the request status and the tenant lifecycle (src/lib/tenant/lifecycle.ts) into the four
 * places a club can be from the owner's point of view.
 */
type Stage = "new" | "setup" | "active" | "closed"
type StageFilter = Stage | "all"
type ConfirmKind = "approve" | "decline" | "suspend" | "cancel"
type Feedback = { tone: "ok" | "warn" | "error"; text: string }

const STAGE_LABEL: Record<StageFilter, string> = {
  new: "New",
  setup: "Waiting on setup",
  active: "Active",
  closed: "Paused or closed",
  all: "All",
}

const BILLING_LABEL: Record<TenantBillingStatus, string> = {
  pending: "Not set up yet",
  mocked_complete: "Set up (test billing)",
  failed: "Failed",
  active: "Active",
  past_due: "Past due",
  cancelled: "Cancelled",
}

const LIFECYCLE_SENTENCE: Record<TenantLifecycleStatus, string> = {
  pending_review: "Back to waiting for review",
  approved_pending_billing: "Waiting on billing setup",
  billing_failed: "Billing marked as failed",
  active_onboarding: "Club is setting up",
  active: "Club is active",
  suspended: "Club suspended",
  cancelled: "Club cancelled",
}

const ORGANIZATION_TYPE_LABEL: Record<string, string> = {
  school: "School",
  club: "Club",
  university: "University",
  "private-coaching-group": "Private coaching group",
  federation: "Federation",
}

function stageOf(request: Request): Stage {
  if (request.status === "pending") return "new"
  if (request.status === "rejected" || request.status === "cancelled") return "closed"
  if (request.lifecycleStatus === "suspended" || request.lifecycleStatus === "cancelled") return "closed"
  if (request.lifecycleStatus === "active" || request.lifecycleStatus === "active_onboarding") return "active"
  return "setup"
}

/** Approved, a workspace exists, and the first club admin has never been sent a way in. */
function needsInvite(request: Request) {
  return (
    request.status === "approved" &&
    Boolean(request.provisionedTenantId) &&
    !request.accessInviteSentAt &&
    (request.lifecycleStatus === "approved_pending_billing" || request.lifecycleStatus === "billing_failed" || !request.lifecycleStatus)
  )
}

/** Approved without a workspace. The provisioning RPC only accepts pending requests, so this cannot be finished from here. */
function isStuckWithoutWorkspace(request: Request) {
  return request.status === "approved" && !request.provisionedTenantId && request.lifecycleStatus !== "cancelled"
}

const STATE_OF_TAG: Record<TagTone, StateTone> = { yellow: "amber", plain: "neutral", coral: "coral", green: "green", blue: "blue" }

/** `tone` is for the Tag in the table's status column. In the detail the status is a dot and text (STATE_OF_TAG). */
function statusOf(request: Request): { label: string; tone: TagTone } {
  if (request.status === "pending") return { label: "New", tone: "yellow" }
  if (request.status === "rejected") return { label: "Declined", tone: "plain" }
  if (request.status === "cancelled" || request.lifecycleStatus === "cancelled") return { label: "Cancelled", tone: "plain" }
  if (request.lifecycleStatus === "suspended") return { label: "Suspended", tone: "coral" }
  if (request.lifecycleStatus === "active") return { label: "Active", tone: "green" }
  if (request.lifecycleStatus === "active_onboarding") return { label: "Setting up", tone: "blue" }
  if (isStuckWithoutWorkspace(request)) return { label: "No workspace", tone: "coral" }
  if (request.lifecycleStatus === "billing_failed") return { label: "Billing failed", tone: "coral" }
  if (needsInvite(request)) return { label: "Invite not sent", tone: "coral" }
  return { label: "Waiting on billing", tone: "blue" }
}

function parseDate(value: string | null | undefined) {
  if (!value) return null
  // A bare date such as 2026-11-01 is a calendar day, not midnight UTC. Parsing it as UTC shows the day before in the Americas.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const parsed = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDay(value: string | null | undefined) {
  return parseDate(value)?.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) ?? null
}

function formatDateTime(value: string | null | undefined) {
  return (
    parseDate(value)?.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) ?? null
  )
}

function sizeOf(request: Request) {
  if (request.expectedCoachCount == null && request.expectedAthleteCount == null) return plural(request.expectedSeats, "seat", "seats")
  return `${plural(request.expectedCoachCount ?? 0, "coach", "coaches")}, ${plural(request.expectedAthleteCount ?? 0, "athlete", "athletes")}`
}

function organizationTypeOf(request: Request) {
  const raw = request.organizationType?.trim()
  if (!raw) return null
  return ORGANIZATION_TYPE_LABEL[raw] ?? raw.replaceAll("-", " ").replace(/^\w/, (letter) => letter.toUpperCase())
}

function packageLabelOf(request: Request) {
  return getPackageById(request.requestedPlan)?.label ?? request.requestedPlan
}

function limitLabel(value: number, one: string, many: string) {
  return Number.isFinite(value) ? plural(value, one, many) : `unlimited ${many}`
}

/** The website comes from a public form, so only ever link to http(s). */
function safeWebsite(value: string | null) {
  const raw = value?.trim()
  if (!raw) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

/** Turns backend wording into something the owner can act on. */
function friendlyError(message: string) {
  const text = message.toLowerCase()
  if (text.includes("only pending requests") || text.includes("request not found")) {
    return "This request is no longer waiting for review. Someone else may have decided it already. The list has been refreshed."
  }
  if (text.includes("missing invite email provider") || text.includes("missing notification email provider")) {
    return "email sending is not configured on the server (the Resend key or the sender address is missing)"
  }
  if (text.includes("only platform-admin") || text.includes("not an active platform admin") || text.includes("only active platform admins")) {
    return "Your account is not an active platform admin, so this was not allowed."
  }
  if (text.includes("duplicate key") && text.includes("tenant")) {
    return "A club with the same name or web address already exists. Nothing was created. Try again, and if it keeps failing rename the existing club first."
  }
  if (text.includes("non-2xx")) {
    return "the server function failed without giving a reason. Check the function logs, then try again"
  }
  if (text.includes("failed to fetch") || text.includes("failed to send a request") || text.includes("networkerror")) {
    return "The server could not be reached. Check your connection and try again."
  }
  if (text.includes("preview is only enabled from localhost")) {
    return "Access links can only be copied from a local build."
  }
  return message
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

type HistoryEntry = { id: string; at: string; title: string; detail?: string | null; tone: StateTone }

function buildHistory(request: Request, events: PlatformAuditEventRecord[] | undefined, inviteError: string | null): HistoryEntry[] {
  const entries: HistoryEntry[] = [
    { id: "received", at: request.createdAt, title: "Request received", detail: `Sent by ${request.requestorName}`, tone: "neutral" },
  ]
  const by = (event: PlatformAuditEventRecord) => (event.actorEmail ? `By ${event.actorEmail}` : null)
  let sawReview = false
  let sawLatestInvite = false
  const inviteAt = parseDate(request.accessInviteSentAt)?.getTime() ?? null

  for (const event of events ?? []) {
    const meta = event.metadata ?? {}
    switch (event.action) {
      case "tenant_provision_request_submitted":
        break
      case "tenant_provision_request_reviewed": {
        sawReview = true
        const outcome = String(meta.status ?? meta.to_status ?? "")
        const note = typeof meta.reviewNotes === "string" ? meta.reviewNotes : typeof meta.review_notes === "string" ? meta.review_notes : null
        entries.push({
          id: event.id,
          at: event.occurredAt,
          title: outcome === "rejected" ? "Declined" : "Approved",
          detail: [by(event), note ? `"${note}"` : null].filter(Boolean).join(". ") || null,
          tone: outcome === "rejected" ? "coral" : "green",
        })
        break
      }
      case "tenant_provision_request_provisioned":
        entries.push({ id: event.id, at: event.occurredAt, title: "Club workspace created", detail: by(event), tone: "green" })
        break
      case "club_admin_initial_access_invite_resent":
      case "notification_email_dispatched": {
        const at = parseDate(event.occurredAt)?.getTime() ?? 0
        if (inviteAt != null && Math.abs(at - inviteAt) < 5000) sawLatestInvite = true
        entries.push({ id: event.id, at: event.occurredAt, title: `Access invite sent to ${request.requestorEmail}`, detail: by(event), tone: "blue" })
        break
      }
      case "club_admin_initial_access_invite_previewed":
        entries.push({ id: event.id, at: event.occurredAt, title: "Access link copied", detail: by(event), tone: "neutral" })
        break
      case "tenant_request_lifecycle_updated": {
        const next = String(meta.lifecycleStatus ?? meta.lifecycle_status ?? "") as TenantLifecycleStatus
        entries.push({
          id: event.id,
          at: event.occurredAt,
          title: LIFECYCLE_SENTENCE[next] ?? "Lifecycle changed",
          detail: by(event),
          tone: next === "suspended" || next === "cancelled" || next === "billing_failed" ? "coral" : next === "active" ? "green" : "neutral",
        })
        break
      }
      default:
        entries.push({ id: event.id, at: event.occurredAt, title: event.detail ?? event.action.replaceAll("_", " "), detail: by(event), tone: "neutral" })
    }
  }

  // The row itself is the fallback when the audit trail has no entry (older requests, or steps the backend does not audit).
  if (!sawReview && request.reviewedAt && request.status !== "pending") {
    entries.push({
      id: "reviewed",
      at: request.reviewedAt,
      title: request.status === "rejected" ? "Declined" : "Approved",
      detail: request.reviewNotes ? `"${request.reviewNotes}"` : null,
      tone: request.status === "rejected" ? "coral" : "green",
    })
  }
  if (request.accessInviteSentAt && !sawLatestInvite) {
    entries.push({ id: "invite", at: request.accessInviteSentAt, title: `Access invite sent to ${request.requestorEmail}`, tone: "blue" })
  }
  if (request.billingStartedAt) entries.push({ id: "billing-started", at: request.billingStartedAt, title: "Billing set up by the club", tone: "green" })
  if (request.billingFailedAt && !(events ?? []).some((event) => event.action === "tenant_request_lifecycle_updated")) {
    entries.push({ id: "billing-failed", at: request.billingFailedAt, title: "Billing marked as failed", tone: "coral" })
  }

  // Approval, provisioning and the invite can share a timestamp, so ties fall back to the order they really happen in.
  const rank = (entry: HistoryEntry) =>
    entry.id === "received" ? 0 : entry.title === "Approved" || entry.title === "Declined" ? 1 : entry.title === "Club workspace created" ? 2 : 3
  const time = (entry: HistoryEntry) => Math.floor((parseDate(entry.at)?.getTime() ?? 0) / 1000)
  entries.sort((left, right) => time(left) - time(right) || rank(left) - rank(right))
  if (inviteError && !request.accessInviteSentAt) {
    entries.push({ id: "invite-error", at: "", title: "Last invite attempt failed", detail: inviteError, tone: "coral" })
  }
  return entries
}

export default function PlatformAdminRequestsPage() {
  const isSupabaseMode = getBackendMode() === "supabase"
  const isLocalPreviewEnabled =
    typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")

  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stage, setStage] = useState<StageFilter>("new")
  const [search, setSearch] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null)
  const [approveNote, setApproveNote] = useState("")
  const [declineReason, setDeclineReason] = useState("")
  const [declineError, setDeclineError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pageFeedback, setPageFeedback] = useState<Feedback | null>(null)
  const [detailFeedback, setDetailFeedback] = useState<Feedback | null>(null)
  const [history, setHistory] = useState<Record<string, PlatformAuditEventRecord[]>>({})
  // Invite failures the server did not get to write on the row (for example when the email provider is not configured).
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({})
  const [accessLinks, setAccessLinks] = useState<Record<string, string>>({})
  const [copiedLink, setCopiedLink] = useState<string | null>(null)
  const [emailPreviews, setEmailPreviews] = useState<Array<{ id: string; recipientEmail?: string; subject?: string; actionLink?: string }>>([])
  const pickedInitialStage = useRef(false)

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const result = await getPlatformAdminRequestQueue()
    if (!result.ok) {
      setLoadError(friendlyError(result.error.message))
      setLoading(false)
      return null
    }
    setRequests(result.data)
    setLoadError(null)
    setLoading(false)
    if (!pickedInitialStage.current) {
      pickedInitialStage.current = true
      // Open on the inbox. If nothing is waiting, show everything rather than an empty tab.
      if (result.data.length > 0 && !result.data.some((item) => stageOf(item) === "new")) setStage("all")
    }
    return result.data
  }, [])

  const loadHistory = useCallback(async (requestId: string) => {
    const result = await getPlatformAdminRequestHistory(requestId)
    if (result.ok) setHistory((current) => ({ ...current, [requestId]: result.data }))
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const counts = useMemo(() => {
    const next: Record<StageFilter, number> = { new: 0, setup: 0, active: 0, closed: 0, all: requests.length }
    for (const request of requests) next[stageOf(request)] += 1
    return next
  }, [requests])

  const invitesMissing = useMemo(() => requests.filter(needsInvite).length, [requests])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return requests.filter((item) => {
      if (stage !== "all" && stageOf(item) !== stage) return false
      if (!query) return true
      return [
        item.organizationName,
        item.requestorName,
        item.requestorEmail,
        item.jobTitle ?? "",
        organizationTypeOf(item) ?? "",
        item.organizationWebsite ?? "",
        item.region ?? "",
        packageLabelOf(item),
        statusOf(item).label,
        item.notes ?? "",
        item.reviewNotes ?? "",
        item.provisionedTenantId ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    })
  }, [requests, search, stage])

  const active = activeId ? requests.find((item) => item.id === activeId) ?? null : null

  const resetConfirm = () => {
    setConfirm(null)
    setApproveNote("")
    setDeclineReason("")
    setDeclineError(null)
  }

  const openRequest = (requestId: string) => {
    resetConfirm()
    setDetailFeedback(null)
    setCopiedLink(null)
    setActiveId(requestId)
    void loadHistory(requestId)
  }

  const closeRequest = () => {
    if (busy) return
    resetConfirm()
    setDetailFeedback(null)
    setActiveId(null)
  }

  /** After any action: pull the truth from the backend so the row, the counts and the history all agree. */
  const settle = async (requestId: string, feedback: Feedback, options?: { followStage?: boolean }) => {
    const fresh = await reload(true)
    await loadHistory(requestId)
    const updated = fresh?.find((item) => item.id === requestId)
    if (options?.followStage && updated && stage !== "all") setStage(stageOf(updated))
    resetConfirm()
    setDetailFeedback(feedback)
    setBusy(null)
  }

  const fail = async (requestId: string, message: string) => {
    const fresh = await reload(true)
    await loadHistory(requestId)
    // If the request moved on underneath us, the open confirm no longer applies.
    if (fresh?.find((item) => item.id === requestId)?.status !== "pending") resetConfirm()
    setDetailFeedback({ tone: "error", text: friendlyError(message) })
    setBusy(null)
  }

  const handleApprove = async (request: Request) => {
    setBusy("approve")
    setDetailFeedback(null)
    const result = await approveAndProvisionTenantRequest({
      requestId: request.id,
      requestorEmail: request.requestorEmail,
      requestorName: request.requestorName,
      reviewNotes: approveNote,
    })
    if (!result.ok) return fail(request.id, result.error.message)

    const { accessInviteError, accessInviteActionLink } = result.data
    if (accessInviteError) {
      setInviteErrors((current) => ({ ...current, [request.id]: accessInviteError }))
      return settle(
        request.id,
        {
          tone: "warn",
          text: `${request.organizationName} is approved and its workspace is ready, but the access invite did not go out: ${friendlyError(accessInviteError)}. Nothing is lost. Use Send access invite to try again.`,
        },
        { followStage: true },
      )
    }
    if (accessInviteActionLink) setAccessLinks((current) => ({ ...current, [request.id]: accessInviteActionLink }))
    return settle(
      request.id,
      {
        tone: "ok",
        text: accessInviteActionLink
          ? `${request.organizationName} is approved and its workspace is ready. This is a local build, so no email went out. Pass the access link below to ${request.requestorEmail}.`
          : `${request.organizationName} is approved and its workspace is ready. Access invite sent to ${request.requestorEmail}.`,
      },
      { followStage: true },
    )
  }

  const handleDecline = async (request: Request) => {
    const reason = declineReason.trim()
    if (reason.length < 5) {
      setDeclineError("Give a short reason. It is saved with the request and sent to the requester.")
      return
    }
    setBusy("decline")
    setDetailFeedback(null)
    const result = await reviewTenantProvisionRequest({ requestId: request.id, status: "rejected", reviewNotes: reason })
    if (!result.ok) return fail(request.id, result.error.message)
    return settle(
      request.id,
      {
        tone: "ok",
        text: isSupabaseMode
          ? `${request.organizationName} was declined. An email with your reason is queued for ${request.requestorEmail}.`
          : `${request.organizationName} was declined. Your reason is saved with the request.`,
      },
      { followStage: true },
    )
  }

  const handleSendInvite = async (request: Request) => {
    if (!request.provisionedTenantId) return
    const again = Boolean(request.accessInviteSentAt)
    setBusy("invite")
    setDetailFeedback(null)
    const result = await sendInitialClubAdminAccessInvite({
      requestId: request.id,
      requestorEmail: request.requestorEmail,
      requestorName: request.requestorName,
      tenantId: request.provisionedTenantId,
    })
    if (!result.ok) {
      setInviteErrors((current) => ({ ...current, [request.id]: result.error.message }))
      await reload(true)
      await loadHistory(request.id)
      setDetailFeedback({
        tone: "error",
        text: `The access invite did not go out: ${friendlyError(result.error.message)}. The club and its workspace are untouched. You can try again.`,
      })
      setBusy(null)
      return
    }
    setInviteErrors((current) => {
      const next = { ...current }
      delete next[request.id]
      return next
    })
    const link = result.data.actionLink
    if (link) setAccessLinks((current) => ({ ...current, [request.id]: link }))
    return settle(request.id, {
      tone: "ok",
      text: link
        ? `New access link created for ${request.requestorEmail}. This is a local build, so no email went out. Copy the link below.`
        : `Access invite ${again ? "sent again" : "sent"} to ${request.requestorEmail}.`,
    })
  }

  const handleCopyLink = async (request: Request) => {
    if (!request.provisionedTenantId) return
    setBusy("copy")
    setDetailFeedback(null)
    const result = await previewInitialClubAdminAccessInvite({
      requestId: request.id,
      requestorEmail: request.requestorEmail,
      requestorName: request.requestorName,
      tenantId: request.provisionedTenantId,
    })
    if (!result.ok) return fail(request.id, result.error.message)
    setAccessLinks((current) => ({ ...current, [request.id]: result.data.actionLink }))
    const copied = await copyText(result.data.actionLink)
    await loadHistory(request.id)
    setDetailFeedback(
      copied
        ? { tone: "ok", text: `Access link for ${request.requestorEmail} copied.` }
        : { tone: "warn", text: "The link was created but your browser blocked the copy. Select it below and copy it by hand." },
    )
    setBusy(null)
  }

  const handleLifecycle = async (
    request: Request,
    key: string,
    lifecycleStatus: TenantLifecycleStatus,
    billingStatus: TenantBillingStatus | null | undefined,
    message: string,
  ) => {
    setBusy(key)
    setDetailFeedback(null)
    const result = await setTenantRequestLifecycleState({ requestId: request.id, lifecycleStatus, billingStatus: billingStatus ?? undefined })
    if (!result.ok) return fail(request.id, result.error.message)
    return settle(request.id, { tone: "ok", text: message }, { followStage: true })
  }

  const handleExport = async () => {
    setBusy("export")
    downloadCsv("platform-admin-request-queue.csv", [
      [
        "Club",
        "Requester",
        "Email",
        "Job title",
        "Organisation type",
        "Website",
        "Country or region",
        "Package",
        "Coaches",
        "Athletes",
        "Seats",
        "Target start",
        "Status",
        "Request status",
        "Lifecycle",
        "Billing",
        "Received",
        "Reviewed",
        "Review note",
        "Workspace ID",
        "Invite sent",
        "Notes",
      ],
      ...visible.map((request) => [
        request.organizationName,
        request.requestorName,
        request.requestorEmail,
        request.jobTitle ?? "",
        organizationTypeOf(request) ?? "",
        request.organizationWebsite ?? "",
        request.region ?? "",
        packageLabelOf(request),
        request.expectedCoachCount?.toString() ?? "",
        request.expectedAthleteCount?.toString() ?? "",
        String(request.expectedSeats),
        request.desiredStartDate ?? "",
        statusOf(request).label,
        request.status,
        request.lifecycleStatus ?? "",
        request.billingStatus ?? "",
        request.createdAt,
        request.reviewedAt ?? "",
        request.reviewNotes ?? "",
        request.provisionedTenantId ?? "",
        request.accessInviteSentAt ?? "",
        request.notes ?? "",
      ]),
    ])
    const audit = await logPlatformAdminExport({
      target: "request-queue",
      format: "csv",
      recordCount: visible.length,
      filters: { search: search.trim() || null, stage },
    })
    setPageFeedback(
      audit.ok
        ? { tone: "ok", text: `Exported ${plural(visible.length, "request", "requests")} to CSV.` }
        : { tone: "warn", text: `The CSV downloaded, but the export could not be written to the audit trail: ${friendlyError(audit.error.message)}` },
    )
    setBusy(null)
  }

  const handleSendQueuedEmails = async () => {
    setBusy("emails")
    const result = await dispatchPendingNotificationEmails({ limit: 25 })
    if (!result.ok) {
      setPageFeedback({ tone: "error", text: `Queued emails were not sent: ${friendlyError(result.error.message)}. Nothing was lost, so you can try again.` })
      setBusy(null)
      return
    }
    const failed = result.data.results.filter((item) => item.status === "failed")
    const previews = result.data.results.filter((item) => item.actionLink || item.recipientEmail || item.subject)
    setEmailPreviews(previews.map((item) => ({ id: item.id, recipientEmail: item.recipientEmail, subject: item.subject, actionLink: item.actionLink })))
    await reload(true)
    if (failed.length > 0) {
      setPageFeedback({
        tone: "error",
        text: `${plural(failed.length, "email", "emails")} of ${result.data.processed} failed${failed[0]?.error ? `: ${failed[0].error}` : ""}. They stay in the queue, so you can try again.`,
      })
    } else if (result.data.processed === 0) {
      setPageFeedback({ tone: "ok", text: "No emails were waiting to go out." })
    } else {
      setPageFeedback({
        tone: "ok",
        text:
          previews.length > 0
            ? `Processed ${plural(result.data.processed, "queued email", "queued emails")}. This is a local build, so previews are shown instead of sending.`
            : `Sent ${plural(result.data.processed, "queued email", "queued emails")}.`,
      })
    }
    setBusy(null)
  }

  const lede = loading
    ? "Clubs that asked for access, and where each one is."
    : requests.length === 0
      ? "Clubs that ask for access land here for you to approve or decline."
      : [
          counts.new > 0
            ? `${plural(counts.new, "club is", "clubs are")} waiting for your decision.`
            : "Nothing is waiting for a decision.",
          invitesMissing > 0 ? `${plural(invitesMissing, "approved club still needs", "approved clubs still need")} an access invite.` : null,
        ]
          .filter(Boolean)
          .join(" ")

  const NOTICE_TONE = { ok: "success", warn: "warning", error: "error" } as const
  const feedbackNotice = (feedback: Feedback, onDismiss: () => void) => (
    <Notice
      tone={NOTICE_TONE[feedback.tone]}
      action={
        <Button variant="quiet" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      }
    >
      <span className="break-words">{feedback.text}</span>
    </Notice>
  )

  const notGiven = "Not given"

  /** Everything the sheet shows for one request, and the one main action its state calls for. */
  const detailOf = (request: Request) => {
    const status = statusOf(request)
    const requestStage = stageOf(request)
    const pkg = getPackageById(request.requestedPlan)
    const coaches = request.expectedCoachCount ?? 0
    const athletes = request.expectedAthleteCount ?? 0
    const fit = pkg ? doesPackageFitRollout({ packageId: pkg.id, coachCount: coaches, athleteCount: athletes }) : null
    const recommended = pkg && fit && !fit.fits ? getPackageById(getRecommendedPackage(coaches, athletes)) : null
    const website = safeWebsite(request.organizationWebsite)
    const inviteError = request.accessInviteSentAt ? null : (request.accessInviteLastError ?? inviteErrors[request.id] ?? null)
    const entries = buildHistory(request, history[request.id], inviteError)
    const link = accessLinks[request.id]
    const lifecycle = request.lifecycleStatus
    const provisioned = Boolean(request.provisionedTenantId)
    const cancelled = lifecycle === "cancelled" || request.status === "cancelled"
    const stuck = isStuckWithoutWorkspace(request)
    const canInvite = provisioned && request.status === "approved" && !cancelled && lifecycle !== "suspended"
    const inviteIsPrimary = canInvite && !request.accessInviteSentAt && requestStage === "setup"
    const canSuspend = lifecycle === "active" || lifecycle === "active_onboarding"
    const canCancel = request.status === "approved" && !cancelled
    const working = busy !== null

    const guidance =
      request.status === "pending"
        ? "Approving creates the club workspace and sends the first access link. Declining closes the request."
        : request.status === "rejected"
          ? "Declined requests stay closed. If things change, ask the club to send a new request."
          : stuck
            ? "This request was approved but no workspace was created, and provisioning only runs for requests that are still pending. It needs a database fix, or cancel it and ask the club to request again."
            : cancelled
              ? "This club is cancelled and its people are blocked from the app. Restoring it puts it back where it was with billing and gives access back."
              : lifecycle === "suspended"
                ? "The club is suspended and its people are blocked from the app. Reactivating returns it to where it was before and gives access back straight away."
                : inviteIsPrimary
                  ? `${request.requestorName} has no way in yet. Send the access invite so they can set a password and finish setup.`
                  : lifecycle === "billing_failed"
                    ? "Billing failed for this club. Retry puts it back to waiting on billing so the club admin can try again."
                    : lifecycle === "approved_pending_billing"
                      ? `Waiting for ${request.requestorName} to open the invite and set up billing.`
                      : lifecycle === "active_onboarding"
                        ? "Billing is done and the club admin is working through setup."
                        : "This club is up and running."

    const controls: Array<{ key: string; title: string; body: string; actions: ReactNode }> = []
    if (canInvite && !inviteIsPrimary) {
      controls.push({
        key: "invite",
        title: "First access invite",
        body: request.accessInviteSentAt ? `Sent to ${request.requestorEmail} on ${formatDateTime(request.accessInviteSentAt)}.` : `Not sent to ${request.requestorEmail} yet.`,
        actions: (
          <>
            <Button size="sm" disabled={working} onClick={() => void handleSendInvite(request)}>
              {busy === "invite" ? "Sending..." : request.accessInviteSentAt ? "Resend access invite" : "Send access invite"}
            </Button>
            {isLocalPreviewEnabled ? (
              <Button size="sm" variant="quiet" disabled={working} onClick={() => void handleCopyLink(request)}>
                {busy === "copy" ? "Copying..." : "Copy access link"}
              </Button>
            ) : null}
          </>
        ),
      })
    }
    if (lifecycle === "approved_pending_billing" && provisioned) {
      controls.push({
        key: "billing-failed",
        title: "Billing did not go through?",
        body: "Flag it so the club shows as needing attention.",
        actions: (
          <Button
            size="sm"
            disabled={working}
            onClick={() => void handleLifecycle(request, "billing-failed", "billing_failed", "failed", `Billing marked as failed for ${request.organizationName}.`)}
          >
            {busy === "billing-failed" ? "Saving..." : "Mark billing failed"}
          </Button>
        ),
      })
    }
    if (canSuspend) {
      controls.push({
        key: "suspend",
        title: "Suspend",
        body: "Pause the club. You can reactivate it at any time.",
        actions: (
          <Button size="sm" variant="danger" disabled={working} aria-expanded={confirm === "suspend"} onClick={() => setConfirm("suspend")}>
            Suspend club
          </Button>
        ),
      })
    }
    if (canCancel) {
      controls.push({
        key: "cancel",
        title: "Cancel",
        body: "Close the club. Its data is kept.",
        actions: (
          <Button size="sm" variant="danger" disabled={working} aria-expanded={confirm === "cancel"} onClick={() => setConfirm("cancel")}>
            Cancel club
          </Button>
        ),
      })
    }

    const body = (
      <SubSections>
        <StatusText tone={STATE_OF_TAG[status.tone]}>{status.label}</StatusText>

        {inviteError && canInvite ? <Notice tone="error">The last access invite failed: {friendlyError(inviteError)}. Use Send access invite to try again.</Notice> : null}

        {link && canInvite ? (
          <SubSection title="Access link" hint="Anyone with this link can claim the club admin account. Only share it with the requester.">
            <div className="flex items-end gap-2">
              <Field label={`Access link for ${request.requestorEmail}`} className="min-w-0 flex-1">
                <Input readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
              </Field>
              <Button
                onClick={async () => {
                  if (await copyText(link)) {
                    setCopiedLink(request.id)
                    window.setTimeout(() => setCopiedLink((current) => (current === request.id ? null : current)), 2000)
                  }
                }}
              >
                {copiedLink === request.id ? <Check className="size-5" weight="bold" aria-hidden /> : <Copy className="size-5" weight="bold" aria-hidden />}
                {copiedLink === request.id ? "Copied" : "Copy"}
              </Button>
            </div>
          </SubSection>
        ) : null}

        <SubSection title="About the requester">
          <FactList>
            <Fact label="Name">{request.requestorName}</Fact>
            <Fact label="Email">
              <a className="sk-link break-all" href={`mailto:${request.requestorEmail}`}>
                {request.requestorEmail}
              </a>
            </Fact>
            <Fact label="Job title" empty={notGiven}>
              {request.jobTitle}
            </Fact>
          </FactList>
        </SubSection>

        <SubSection title="The club">
          <FactList>
            <Fact label="Name">{request.organizationName}</Fact>
            <Fact label="Type" empty={notGiven}>
              {organizationTypeOf(request)}
            </Fact>
            <Fact label="Country or region" empty={notGiven}>
              {request.region}
            </Fact>
            <Fact label="Website" empty={notGiven}>
              {website ? (
                <a className="sk-link inline-flex items-center gap-1" href={website} target="_blank" rel="noreferrer noopener">
                  <span className="break-all">{request.organizationWebsite}</span>
                  <ArrowSquareOut className="size-4 shrink-0" weight="bold" aria-hidden />
                </a>
              ) : (
                request.organizationWebsite
              )}
            </Fact>
          </FactList>
        </SubSection>

        <SubSection title="Size and timing">
          <FactList>
            <Fact label="Coaches" empty={notGiven}>
              {request.expectedCoachCount}
            </Fact>
            <Fact label="Athletes" empty={notGiven}>
              {request.expectedAthleteCount}
            </Fact>
            <Fact label="Seats in total">{request.expectedSeats}</Fact>
            <Fact label="Wants to start" empty="Flexible">
              {formatDay(request.desiredStartDate)}
            </Fact>
          </FactList>
        </SubSection>

        <SubSection title="Package">
          <FactList>
            <Fact label="Asked for">{packageLabelOf(request)}</Fact>
            {pkg ? (
              <Fact label="Covers">
                {limitLabel(pkg.limits.teams, "team", "teams")}, {limitLabel(pkg.limits.coaches, "coach", "coaches")}, {limitLabel(pkg.limits.athletes, "athlete", "athletes")}
              </Fact>
            ) : null}
          </FactList>
          {fit && !fit.fits ? (
            <Notice tone="warning" className="mt-2">
              Their numbers are over this package. {recommended && recommended.id !== pkg?.id ? `${recommended.label} would fit ${sizeOf(request)}.` : "Check the size with them first."}
            </Notice>
          ) : null}
        </SubSection>

        <SubSection title="Notes">
          <FactList>
            <Fact label="From the requester" empty="They left no notes" stack>
              {request.notes}
            </Fact>
            {request.reviewNotes ? (
              <Fact label={request.status === "rejected" ? "Reason for declining" : "Your review note"} stack>
                {request.reviewNotes}
              </Fact>
            ) : null}
          </FactList>
        </SubSection>

        {request.status === "approved" ? (
          <SubSection title="Workspace and billing">
            <FactList>
              <Fact label="Workspace ID" empty="Not created">
                {request.provisionedTenantId ? <span className="break-all text-sm">{request.provisionedTenantId}</span> : null}
              </Fact>
              <Fact label="Access invite" empty="Not sent yet">
                {request.accessInviteSentAt ? `Sent ${formatDateTime(request.accessInviteSentAt)}` : null}
              </Fact>
              <Fact label="Billing" empty={notGiven}>
                {request.billingStatus ? BILLING_LABEL[request.billingStatus] : null}
              </Fact>
              <Fact label="Billing contact" empty={notGiven}>
                {request.billingContactName || request.billingContactEmail ? [request.billingContactName, request.billingContactEmail].filter(Boolean).join(", ") : null}
              </Fact>
              <Fact label="Billing cycle" empty={notGiven}>
                {request.billingCycle === "annual" ? "Annual" : request.billingCycle === "monthly" ? "Monthly" : null}
              </Fact>
            </FactList>
          </SubSection>
        ) : null}

        {controls.length > 0 ? (
          <SubSection title="Club controls">
            <List>
              {controls.map((control) => (
                <ListRow key={control.key} className="items-start">
                  <span className="sk-list-title">{control.title}</span>
                  <span className="sk-list-sub">{control.body}</span>
                  <span className="mt-2 flex flex-wrap gap-2">{control.actions}</span>
                </ListRow>
              ))}
            </List>
          </SubSection>
        ) : null}

        <SubSection title="History">
          <List ordered aria-label="History of this request">
            {entries.map((entry) => (
              <ListRow
                key={entry.id}
                className="items-start"
                leading={<StatusDot tone={entry.tone} className="mt-[7px]" />}
                title={entry.title}
                subtitle={[formatDateTime(entry.at), entry.detail].filter(Boolean).join(" · ") || undefined}
              />
            ))}
          </List>
        </SubSection>
      </SubSections>
    )

    const footer = (
      <div className="flex w-full min-w-0 flex-col gap-3">
        {detailFeedback ? feedbackNotice(detailFeedback, () => setDetailFeedback(null)) : null}
        {confirm === "approve" && request.status === "pending" ? (
          <>
            <p className="text-[0.9375rem] text-sk-ink">
              <span className="font-bold">Approve {request.organizationName}?</span> This creates the club workspace on {packageLabelOf(request)} and
              {isLocalPreviewEnabled ? " prepares the first access link for " : " emails the first access link to "}
              {request.requestorEmail}.
            </p>
            <Field label="Note for the record" optional>
              <Input maxLength={500} value={approveNote} disabled={working} onChange={(event) => setApproveNote(event.target.value)} />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="quiet" disabled={working} onClick={resetConfirm}>
                Not yet
              </Button>
              <Button variant="primary" disabled={working} onClick={() => void handleApprove(request)}>
                {busy === "approve" ? "Approving..." : "Yes, approve and provision"}
              </Button>
            </div>
          </>
        ) : confirm === "decline" && request.status === "pending" ? (
          <form
            className="flex flex-col gap-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void handleDecline(request)
            }}
          >
            <Field label={`Why are you declining ${request.organizationName}?`} error={declineError} hint={`${request.requestorName} is told this reason. Declining cannot be undone.`}>
              <Textarea
                rows={3}
                maxLength={1000}
                value={declineReason}
                disabled={working}
                onChange={(event) => {
                  setDeclineReason(event.target.value)
                  setDeclineError(null)
                }}
              />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="quiet" disabled={working} onClick={resetConfirm}>
                Keep request
              </Button>
              <Button type="submit" variant="danger" disabled={working}>
                {busy === "decline" ? "Declining..." : "Decline request"}
              </Button>
            </div>
          </form>
        ) : confirm === "suspend" || confirm === "cancel" ? (
          <>
            <p className="text-[0.9375rem] text-sk-ink">
              <span className="font-bold">{confirm === "suspend" ? `Suspend ${request.organizationName}?` : `Cancel ${request.organizationName}?`}</span>{" "}
              {confirm === "suspend"
                ? "The whole club is blocked straight away and it leaves your active list until you reactivate it. The club admin, coaches and athletes can still sign in, but they see a notice that the club's access is paused and cannot read or change anything. Its data is kept."
                : "The whole club is blocked straight away and it moves to closed. Its people can still sign in, but they see a notice that the club's access has ended and cannot read or change anything. Its data is kept and you can restore it later."}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="quiet" disabled={working} onClick={resetConfirm}>
                {confirm === "suspend" ? "Keep it running" : "Keep club"}
              </Button>
              <Button
                variant="danger"
                disabled={working}
                onClick={() =>
                  confirm === "suspend"
                    ? void handleLifecycle(request, "suspend", "suspended", request.billingStatus, `${request.organizationName} is suspended.`)
                    : void handleLifecycle(request, "cancel", "cancelled", undefined, `${request.organizationName} is cancelled.`)
                }
              >
                {confirm === "suspend" ? (busy === "suspend" ? "Suspending..." : "Yes, suspend club") : busy === "cancel" ? "Cancelling..." : "Yes, cancel club"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-sk-mute">{guidance}</p>
            {request.status === "pending" ? (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button variant="danger" disabled={working} onClick={() => setConfirm("decline")}>
                  Decline
                </Button>
                <Button variant="primary" disabled={working} onClick={() => setConfirm("approve")}>
                  <Check className="size-5" weight="bold" aria-hidden />
                  Approve and provision
                </Button>
              </div>
            ) : inviteIsPrimary ? (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {isLocalPreviewEnabled ? (
                  <Button disabled={working} onClick={() => void handleCopyLink(request)}>
                    <Copy className="size-5" weight="bold" aria-hidden />
                    {busy === "copy" ? "Copying..." : "Copy access link"}
                  </Button>
                ) : null}
                <Button variant="primary" disabled={working} onClick={() => void handleSendInvite(request)}>
                  <PaperPlaneTilt className="size-5" weight="bold" aria-hidden />
                  {busy === "invite" ? "Sending..." : "Send access invite"}
                </Button>
              </div>
            ) : lifecycle === "billing_failed" && provisioned && !cancelled ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="primary"
                  disabled={working}
                  onClick={() =>
                    void handleLifecycle(request, "retry-billing", "approved_pending_billing", "pending", `${request.organizationName} is back to waiting on billing. The club admin can try again.`)
                  }
                >
                  <ArrowCounterClockwise className="size-5" weight="bold" aria-hidden />
                  {busy === "retry-billing" ? "Saving..." : "Retry billing"}
                </Button>
              </div>
            ) : lifecycle === "suspended" && request.status === "approved" ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="primary"
                  disabled={working}
                  onClick={() =>
                    void handleLifecycle(
                      request,
                      "reactivate",
                      request.previousLifecycleStatus ?? "active",
                      request.billingStatus === "pending" ? "active" : request.billingStatus,
                      `${request.organizationName} is reactivated.`,
                    )
                  }
                >
                  <ArrowCounterClockwise className="size-5" weight="bold" aria-hidden />
                  {busy === "reactivate" ? "Reactivating..." : "Reactivate club"}
                </Button>
              </div>
            ) : lifecycle === "cancelled" && request.status === "approved" && provisioned ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  disabled={working}
                  onClick={() => {
                    const billingDone = request.billingStatus === "active" || request.billingStatus === "mocked_complete"
                    void handleLifecycle(request, "restore", billingDone ? "active" : "approved_pending_billing", billingDone ? request.billingStatus : "pending", `${request.organizationName} is restored.`)
                  }}
                >
                  <ArrowCounterClockwise className="size-5" weight="bold" aria-hidden />
                  {busy === "restore" ? "Restoring..." : "Restore club"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    )

    return { body, footer }
  }

  const columns: Array<DataTableColumn<Request>> = [
    {
      key: "club",
      header: "Club",
      cell: (request) => (
        <>
          <button
            type="button"
            className="cursor-pointer rounded-[6px] text-left font-bold text-sk-ink hover:text-sk-blue-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
            aria-label={`Open request from ${request.organizationName}`}
            onClick={(event) => {
              event.stopPropagation()
              openRequest(request.id)
            }}
          >
            <span className="break-words">{request.organizationName}</span>
          </button>
          {request.region ? <TableSub>{request.region}</TableSub> : null}
        </>
      ),
    },
    {
      key: "requester",
      header: "Requester",
      phone: "plain",
      cell: (request) => (
        <span className="min-w-0">
          <span className="block text-sk-ink">{request.requestorName}</span>
          <span className="block break-all text-sm text-sk-mute">{request.requestorEmail}</span>
        </span>
      ),
    },
    { key: "type", header: "Type", phone: "hide", cell: (request) => organizationTypeOf(request) ?? <span className="text-sk-mute">Not given</span> },
    { key: "size", header: "Size", cell: (request) => sizeOf(request) },
    { key: "package", header: "Package", cell: (request) => packageLabelOf(request) },
    { key: "received", header: "Received", cell: (request) => formatDateTime(request.createdAt) ?? "Unknown" },
    {
      key: "status",
      header: "Status",
      phone: "trailing",
      cell: (request) => {
        const status = statusOf(request)
        const inviteNote =
          request.status !== "approved" || !request.provisionedTenantId || stageOf(request) === "closed"
            ? null
            : request.accessInviteSentAt
              ? `Invite sent ${formatDay(request.accessInviteSentAt)}`
              : "Invite not sent"
        return (
          <span className="inline-flex flex-col items-start gap-1 max-sm:items-end">
            <Tag tone={status.tone} className="whitespace-nowrap">
              {status.label}
            </Tag>
            {inviteNote && status.label !== "Invite not sent" ? <span className="whitespace-nowrap text-sm text-sk-mute">{inviteNote}</span> : null}
          </span>
        )
      },
    },
  ]

  const activeDetail = active ? detailOf(active) : null

  return (
    <Screen>
      <ScreenHeader
        title="Club requests"
        lede={lede}
        actions={
          requests.length > 0 ? (
            <>
              <Button disabled={busy !== null} onClick={() => void handleSendQueuedEmails()}>
                <EnvelopeSimple className="size-5" weight="bold" aria-hidden />
                {busy === "emails" ? "Sending..." : "Send queued emails"}
              </Button>
              <Button disabled={busy !== null || visible.length === 0} onClick={() => void handleExport()}>
                <DownloadSimple className="size-5" weight="bold" aria-hidden />
                Export CSV
              </Button>
            </>
          ) : null
        }
      />

      {loadError ? (
        <Notice
          tone="error"
          action={
            <Button variant="quiet" size="sm" onClick={() => void reload()}>
              Try again
            </Button>
          }
        >
          Requests could not be loaded: {loadError}
        </Notice>
      ) : null}

      {pageFeedback ? feedbackNotice(pageFeedback, () => setPageFeedback(null)) : null}

      {isLocalPreviewEnabled && emailPreviews.length > 0 ? (
        <Section
          title="Email previews"
          hint="Local builds do not send email. These are the messages that would have gone out."
          action={
            <Button variant="quiet" size="sm" onClick={() => setEmailPreviews([])}>
              Hide
            </Button>
          }
        >
          <List aria-label="Email previews">
            {emailPreviews.map((preview) => (
              <ListRow key={preview.id} className="items-start">
                <span className="sk-list-title">{preview.subject ?? "Notification"}</span>
                <span className="sk-list-sub break-all">{[preview.recipientEmail, preview.actionLink].filter(Boolean).join(" · ") || "No link in this email"}</span>
                {preview.actionLink ? (
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={async () => {
                        const copied = await copyText(preview.actionLink!)
                        setPageFeedback(copied ? { tone: "ok", text: "Link copied." } : { tone: "warn", text: "Your browser blocked the copy. Select the link and copy it by hand." })
                      }}
                    >
                      Copy link
                    </Button>
                    <a className="sk-link px-2" href={preview.actionLink} target="_blank" rel="noreferrer noopener">
                      Open
                    </a>
                  </span>
                ) : null}
              </ListRow>
            ))}
          </List>
        </Section>
      ) : null}

      {loading ? (
        <Section title="Requests">
          <SkeletonRows rows={5} label="Loading requests" />
        </Section>
      ) : requests.length === 0 && !loadError ? (
        <Section>
          <EmptyState
            title="No club requests yet"
            body="When a club fills in the request form on the sign-in page, it shows up here. You review it, approve or decline, and the first club admin gets their access link."
          />
        </Section>
      ) : requests.length > 0 ? (
        <>
          <Tabs<StageFilter>
            label="Request stage"
            value={stage}
            onChange={setStage}
            options={(["new", "setup", "active", "closed", "all"] as const).map((value) => ({ value, label: STAGE_LABEL[value], count: counts[value] > 0 ? counts[value] : undefined }))}
          />

          <Field label="Search requests" className="sm:max-w-sm">
            <SearchInput placeholder="Club, person, email or country" value={search} onChange={(event) => setSearch(event.target.value)} />
          </Field>

          <Section title={stage === "all" ? "All requests" : STAGE_LABEL[stage]} meta={`${visible.length} of ${requests.length}`} aria-label="Requests">
            {visible.length === 0 ? (
              <EmptyState
                title={search.trim() ? "Nothing matches that search" : "Nothing in this stage"}
                body={
                  search.trim()
                    ? `Nothing in ${stage === "all" ? "any stage" : `"${STAGE_LABEL[stage]}"`} matches that search.`
                    : stage === "new"
                      ? "No new requests. Nothing is waiting for a decision."
                      : stage === "setup"
                        ? "No approved clubs are waiting on an invite or billing."
                        : stage === "active"
                          ? "No clubs are active yet."
                          : "No clubs are suspended, declined or cancelled."
                }
                action={
                  search.trim() || stage !== "all" ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setSearch("")
                        setStage("all")
                      }}
                    >
                      Show all requests
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <DataTable
                caption={`Club requests, ${STAGE_LABEL[stage]}${search.trim() ? ", filtered by search" : ""}`}
                columns={columns}
                rows={visible}
                rowKey={(request) => request.id}
                rowProps={(request) => ({ "data-request-row": request.organizationName, "data-selected": request.id === activeId, onClick: () => openRequest(request.id) })}
              />
            )}
          </Section>
        </>
      ) : null}

      <Sheet
        open={Boolean(active)}
        onOpenChange={(open) => (open ? null : closeRequest())}
        title={active?.organizationName ?? "Request"}
        description={active ? `${active.requestorName} asked for access on ${formatDateTime(active.createdAt) ?? "an unknown date"}` : undefined}
        className="sm:max-w-[560px]"
        footer={activeDetail?.footer}
      >
        {activeDetail?.body}
      </Sheet>
    </Screen>
  )
}
