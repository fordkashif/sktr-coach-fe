"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react"
import { EmptyState, Initials, PageHeader, Panel } from "@/components/sk"
import { getPackageById } from "@/lib/billing/package-catalog"
import {
  getPlatformAdminRequestQueue,
  getPlatformAuditLog,
  logPlatformAdminExport,
  type PlatformAdminRequestRecord,
  type PlatformAuditEventRecord,
} from "@/lib/data/platform-admin/ops-data"
import { downloadCsv, formatDateTime, localIsoDay, parseLocalDay } from "@/lib/format/ops-format"
import { tenantLifecycleLabels, type TenantLifecycleStatus } from "@/lib/tenant/lifecycle"

const PAGE_SIZE = 50
const NO_CLUB = "__none__"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ActivityEntry = {
  id: string
  /** ISO timestamp. */
  at: string
  /** Local calendar day (YYYY-MM-DD) the event happened on. */
  day: string
  action: string
  who: string
  role: string | null
  /** The club this event is about, when one can be worked out. */
  club: string | null
  what: string
  note: string | null
  /** Everything searchable, lower case. */
  haystack: string
}

const ROLE_LABEL: Record<string, string> = {
  "platform-admin": "SKTR team",
  "club-admin": "Club admin",
  requestor: "Signed-in requester",
  "anonymous-requestor": "Sign-up form",
  "public-request": "Sign-up form",
  system: "System",
}

/** What happened, in plain words, for every action code written to platform_audit_events (migrations and mock mode). */
const ACTION_LABEL: Record<string, string> = {
  tenant_provision_request_submitted: "Asked for a club workspace",
  tenant_provision_request_reviewed: "Reviewed a club request",
  tenant_provision_request_provisioned: "Created the club workspace",
  tenant_request_lifecycle_updated: "Changed a club's status",
  tenant_mock_billing_completed: "Finished billing setup",
  tenant_package_upgrade_requested: "Asked for a package change",
  tenant_package_upgrade_reviewed: "Decided a package request",
  platform_audit_export_csv: "Downloaded a CSV",
  platform_audit_export_pdf: "Printed a report",
  club_admin_initial_access_invite_resent: "Resent the first sign-in invite",
  club_admin_initial_access_invite_previewed: "Copied the first sign-in link",
  notification_email_dispatched: "Sent a queued email",
}

const EXPORT_TARGET_LABEL: Record<string, string> = {
  "platform-audit": "Platform activity",
  "request-queue": "Club requests",
  tenants: "Clubs",
  billing: "Club billing",
}

function actionLabel(action: string) {
  if (ACTION_LABEL[action]) return ACTION_LABEL[action]
  const words = action.replaceAll("_", " ").replaceAll("-", " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Activity"
}

function roleLabel(role: string | null) {
  if (!role) return null
  return ROLE_LABEL[role] ?? role
}

function packageLabel(id: string | null) {
  return getPackageById(id)?.label ?? id ?? "another package"
}

/** First non-empty value among the given metadata keys. The database writes snake_case keys, mock mode camelCase. */
function meta(metadata: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number") return String(value)
  }
  return null
}

function isExport(action: string) {
  return action === "platform_audit_export_csv" || action === "platform_audit_export_pdf"
}

/** Works out which club an event is about. Targets are stored as a club name, a requester email or a club id depending on the action. */
function resolveClub(event: PlatformAuditEventRecord, requests: PlatformAdminRequestRecord[]) {
  if (isExport(event.action)) return null
  const requestId = meta(event.metadata, "tenant_provision_request_id", "request_id", "requestId")
  const tenantId = meta(event.metadata, "tenant_id", "tenantId") ?? (UUID.test(event.target) ? event.target : null)
  const byRequest = requestId ? requests.find((request) => request.id === requestId) : null
  if (byRequest) return byRequest.organizationName
  const byTenant = tenantId ? requests.find((request) => request.provisionedTenantId === tenantId) : null
  if (byTenant) return byTenant.organizationName
  const named = meta(event.metadata, "organization_name", "organizationName")
  if (named) return named
  if (UUID.test(event.target)) return null
  if (event.target.includes("@")) {
    const matches = requests.filter((request) => request.requestorEmail.toLowerCase() === event.target.toLowerCase())
    return matches.length === 1 ? matches[0].organizationName : null
  }
  return event.target || null
}

/** The sentence and the supporting line for one event. */
function describe(event: PlatformAuditEventRecord): { what: string; note: string | null } {
  const m = event.metadata
  const reviewNote = meta(m, "review_notes", "reviewNotes")
  const quoted = reviewNote ? `Note: ${reviewNote}` : null
  const requesterEmail = meta(m, "requestor_email", "requestorEmail") ?? (event.target.includes("@") ? event.target : null)
  const requester = requesterEmail && requesterEmail !== event.actorEmail ? `Requested by ${requesterEmail}` : null

  switch (event.action) {
    case "tenant_provision_request_submitted": {
      const plan = meta(m, "requested_plan", "requestedPlan")
      const seats = meta(m, "expected_seats", "expectedSeats")
      const parts = [plan ? `${packageLabel(plan)} package` : null, seats ? `${seats} people expected` : null].filter(Boolean)
      return { what: actionLabel(event.action), note: [parts.join(", "), requester].filter(Boolean).join(". ") || null }
    }
    case "tenant_provision_request_reviewed": {
      const status = meta(m, "to_status", "status")
      const what = status === "approved" ? "Approved a club request" : status === "rejected" ? "Declined a club request" : actionLabel(event.action)
      return { what, note: [requester, quoted].filter(Boolean).join(". ") || null }
    }
    case "tenant_request_lifecycle_updated": {
      const lifecycle = meta(m, "lifecycle_status", "lifecycleStatus")
      const label = lifecycle ? (tenantLifecycleLabels[lifecycle as TenantLifecycleStatus] ?? lifecycle) : null
      return { what: actionLabel(event.action), note: [label ? `Now: ${label}` : null, quoted].filter(Boolean).join(". ") || null }
    }
    case "tenant_mock_billing_completed": {
      const cycle = meta(m, "billing_cycle", "billingCycle")
      return {
        what: actionLabel(event.action),
        note: `${cycle === "annual" ? "Annual" : cycle === "monthly" ? "Monthly" : "Billing"} cycle chosen. No payment was taken.`,
      }
    }
    case "tenant_package_upgrade_requested":
    case "tenant_package_upgrade_reviewed": {
      const from = meta(m, "current_package", "currentPackage")
      const to = meta(m, "requested_package", "requestedPackage")
      const status = meta(m, "status")
      const change = from || to ? `${packageLabel(from)} to ${packageLabel(to)}` : null
      const what =
        event.action === "tenant_package_upgrade_requested"
          ? actionLabel(event.action)
          : status === "approved"
            ? "Approved a package change"
            : status === "rejected"
              ? "Declined a package change"
              : status === "cancelled"
                ? "Cancelled a package request"
                : actionLabel(event.action)
      return { what, note: [change, quoted].filter(Boolean).join(". ") || null }
    }
    case "platform_audit_export_csv":
    case "platform_audit_export_pdf": {
      const count = meta(m, "record_count", "recordCount")
      const list = EXPORT_TARGET_LABEL[event.target] ?? event.target
      return { what: actionLabel(event.action), note: count ? `${list}, ${count} ${count === "1" ? "row" : "rows"}` : list }
    }
    case "tenant_provision_request_provisioned":
      return {
        what: actionLabel(event.action),
        note: [requester, "The club still has to finish billing setup before it goes live"].filter(Boolean).join(". ") + ".",
      }
    case "club_admin_initial_access_invite_resent":
    case "club_admin_initial_access_invite_previewed":
    case "notification_email_dispatched": {
      return { what: actionLabel(event.action), note: requesterEmail ? `For ${requesterEmail}` : null }
    }
    default:
      return { what: actionLabel(event.action), note: event.detail }
  }
}

function toEntry(event: PlatformAuditEventRecord, requests: PlatformAdminRequestRecord[]): ActivityEntry {
  const parsed = new Date(event.occurredAt)
  const club = resolveClub(event, requests)
  const { what, note } = describe(event)
  const who = event.actorEmail ?? roleLabel(event.actorRole) ?? "System"
  return {
    id: event.id,
    at: event.occurredAt,
    day: Number.isNaN(parsed.getTime()) ? "" : localIsoDay(parsed),
    action: event.action,
    who,
    role: event.actorEmail ? event.actorRole : null,
    club,
    what,
    note,
    haystack: [event.action, actionLabel(event.action), what, note ?? "", who, event.actorRole, roleLabel(event.actorRole) ?? "", club ?? "", event.target, event.detail ?? "", JSON.stringify(event.metadata)]
      .join(" ")
      .toLowerCase(),
  }
}

function dayHeading(day: string) {
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (day === localIsoDay(today)) return "Today"
  if (day === localIsoDay(yesterday)) return "Yesterday"
  const parsed = parseLocalDay(day)
  return parsed ? parsed.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : day
}

function timeOfDay(at: string) {
  const parsed = new Date(at)
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

export default function PlatformAdminAuditPage() {
  const [events, setEvents] = useState<PlatformAuditEventRecord[]>([])
  const [requests, setRequests] = useState<PlatformAdminRequestRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [actionFilter, setActionFilter] = useState("all")
  const [actorFilter, setActorFilter] = useState("all")
  const [clubFilter, setClubFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [visible, setVisible] = useState(PAGE_SIZE)

  const load = useCallback(async () => {
    // Club names come from the request list. If that fails the log still shows, just without some club names.
    const [logResult, queueResult] = await Promise.all([getPlatformAuditLog(), getPlatformAdminRequestQueue()])
    if (queueResult.ok) setRequests(queueResult.data)
    if (!logResult.ok) {
      setLoadError(logResult.error.message)
      setLoading(false)
      return
    }
    setEvents(logResult.data.entries)
    setTotal(logResult.data.total)
    setLoadError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const entries = useMemo(() => events.map((event) => toEntry(event, requests)), [events, requests])

  const actions = useMemo(
    () => [...new Set(entries.map((entry) => entry.action))].sort((left, right) => actionLabel(left).localeCompare(actionLabel(right))),
    [entries],
  )
  const actors = useMemo(() => [...new Set(entries.map((entry) => entry.who))].sort(), [entries])
  const clubs = useMemo(() => [...new Set(entries.map((entry) => entry.club).filter((club): club is string => Boolean(club)))].sort(), [entries])
  const hasClubless = useMemo(() => entries.some((entry) => !entry.club), [entries])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (actionFilter !== "all" && entry.action !== actionFilter) return false
      if (actorFilter !== "all" && entry.who !== actorFilter) return false
      if (clubFilter === NO_CLUB ? Boolean(entry.club) : clubFilter !== "all" && entry.club !== clubFilter) return false
      if (dateFrom && entry.day < dateFrom) return false
      if (dateTo && entry.day > dateTo) return false
      return !needle || entry.haystack.includes(needle)
    })
  }, [actionFilter, actorFilter, clubFilter, dateFrom, dateTo, entries, query])

  const hasFilters =
    Boolean(query.trim()) || actionFilter !== "all" || actorFilter !== "all" || clubFilter !== "all" || Boolean(dateFrom || dateTo)
  const clearFilters = () => {
    setQuery("")
    setActionFilter("all")
    setActorFilter("all")
    setClubFilter("all")
    setDateFrom("")
    setDateTo("")
  }

  // Any filter change starts again from the first page.
  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [query, actionFilter, actorFilter, clubFilter, dateFrom, dateTo])

  const shown = filtered.slice(0, visible)
  const groups = shown.reduce<Array<{ day: string; items: ActivityEntry[] }>>((acc, entry) => {
    const last = acc[acc.length - 1]
    if (last && last.day === entry.day) last.items.push(entry)
    else acc.push({ day: entry.day, items: [entry] })
    return acc
  }, [])

  const exportCsv = async () => {
    downloadCsv("platform-activity.csv", [
      ["When", "Who", "Role", "What happened", "Club", "Detail", "Action code", "Stored target", "Stored detail"],
      ...filtered.map((entry) => {
        const event = events.find((item) => item.id === entry.id)
        return [
          formatDateTime(entry.at),
          entry.who,
          roleLabel(event?.actorRole ?? entry.role) ?? "",
          entry.what,
          entry.club ?? "",
          entry.note ?? "",
          entry.action,
          event?.target ?? "",
          event?.detail ?? "",
        ]
      }),
    ])
    const result = await logPlatformAdminExport({
      target: "platform-audit",
      format: "csv",
      recordCount: filtered.length,
      filters: {
        search: query.trim() || null,
        action: actionFilter,
        actor: actorFilter,
        club: clubFilter === NO_CLUB ? "none" : clubFilter,
        from: dateFrom || null,
        to: dateTo || null,
      },
    })
    if (!result.ok) {
      setLoadError(`Your file downloaded, but we could not add the export to the log. ${result.error.message}`)
      return
    }
    await load()
  }

  const exportButton = (className: string) => (
    <button type="button" className={`sk-btn sk-btn-primary ${className}`} onClick={() => void exportCsv()} disabled={filtered.length === 0}>
      <DownloadSimple className="size-5" weight="bold" aria-hidden />
      Activity CSV
    </button>
  )

  return (
    <div className="sk-page">
      {loadError ? (
        <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
          {events.length === 0 ? "We could not load platform activity. " : ""}
          {loadError}
        </p>
      ) : null}

      <PageHeader
        title="Platform activity"
        lede="What happened across every club, newest first. Sign-up requests, approvals, status changes, package decisions and exports all land here."
      />

      <Panel
        title={loading ? "Activity" : `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "event" : "events"}`}
        hint={
          total > events.length
            ? `Showing the latest ${events.length.toLocaleString()} of ${total.toLocaleString()} events. Older activity is kept but not listed here.`
            : hasFilters
              ? `Filtered from ${entries.length.toLocaleString()} in total.`
              : "Times are shown in your local time."
        }
        action={exportButton("hidden sm:inline-flex")}
      >
        <div className="space-y-5">
          {entries.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 lg:flex lg:flex-wrap lg:items-end">
              <label className="col-span-2 block lg:w-64">
                <span className="sk-label mb-1.5 block">Search activity</span>
                <span className="relative block">
                  <MagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-sk-mute" weight="bold" aria-hidden />
                  <input
                    type="search"
                    className="sk-field pl-11"
                    placeholder="Club, person or action"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </span>
              </label>
              <label className="col-span-2 block min-w-0 sm:col-span-1 lg:w-52">
                <span className="sk-label mb-1.5 block">What happened</span>
                <select className="sk-field" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
                  <option value="all">Everything</option>
                  {actions.map((action) => (
                    <option key={action} value={action}>
                      {actionLabel(action)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 block min-w-0 sm:col-span-1 lg:w-48">
                <span className="sk-label mb-1.5 block">Who</span>
                <select className="sk-field" value={actorFilter} onChange={(event) => setActorFilter(event.target.value)}>
                  <option value="all">Everyone</option>
                  {actors.map((actor) => (
                    <option key={actor} value={actor}>
                      {actor}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 block min-w-0 sm:col-span-1 lg:w-48">
                <span className="sk-label mb-1.5 block">Club</span>
                <select className="sk-field" value={clubFilter} onChange={(event) => setClubFilter(event.target.value)}>
                  <option value="all">Every club</option>
                  {clubs.map((club) => (
                    <option key={club} value={club}>
                      {club}
                    </option>
                  ))}
                  {hasClubless ? <option value={NO_CLUB}>Not about one club</option> : null}
                </select>
              </label>
              <label className="block min-w-0 lg:w-40">
                <span className="sk-label mb-1.5 block">From</span>
                <input type="date" className="sk-field" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} />
              </label>
              <label className="block min-w-0 lg:w-40">
                <span className="sk-label mb-1.5 block">To</span>
                <input type="date" className="sk-field" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} />
              </label>
              {hasFilters ? (
                <button type="button" className="sk-btn sk-btn-ghost col-span-2 justify-self-start" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : null}
              {exportButton("col-span-2 sm:hidden")}
            </div>
          ) : null}

          {loading ? (
            <p className="py-10 text-center text-sm font-semibold text-sk-mute" role="status">
              Loading activity
            </p>
          ) : entries.length === 0 ? (
            loadError ? null : (
              <EmptyState
                className="border-0 bg-sk-canvas"
                title="No platform activity yet"
                body="When a club asks for a workspace, or you approve a request, change a club's status, decide a package request or download a list, it shows up here with who did it and when."
              />
            )
          ) : filtered.length === 0 ? (
            <EmptyState
              className="border-0 bg-sk-canvas"
              title="No activity matches these filters"
              body={`There are ${entries.length.toLocaleString()} events in the log, but none fit the current search and filters.`}
              action={
                <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm" onClick={clearFilters}>
                  Clear filters
                </button>
              }
            />
          ) : (
            <>
              <div className="space-y-6">
                {groups.map((group) => (
                  <section key={group.day} aria-label={dayHeading(group.day)}>
                    <h3 className="sk-label border-b border-sk-line pb-2">{dayHeading(group.day)}</h3>
                    <ul>
                      {group.items.map((entry) => (
                        <li
                          key={entry.id}
                          className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-sk-line py-3.5 last:border-b-0 md:grid-cols-[5.5rem_17rem_minmax(0,1fr)] lg:grid-cols-[5.5rem_19rem_minmax(0,1fr)] md:items-start md:gap-x-5"
                        >
                          <time
                            dateTime={entry.at}
                            title={formatDateTime(entry.at)}
                            className="col-start-2 row-start-3 text-sm tabular-nums text-sk-mute md:col-start-1 md:row-start-1 md:pt-1.5 md:font-semibold"
                          >
                            {timeOfDay(entry.at)}
                          </time>
                          <div className="row-span-3 pt-0.5 md:hidden">
                            <Initials name={entry.who} size="sm" />
                          </div>
                          <div className="col-start-2 row-start-2 flex min-w-0 items-center gap-2.5 md:col-start-2 md:row-start-1">
                            <Initials name={entry.who} size="sm" className="hidden md:inline-flex" />
                            <p className="min-w-0 text-sm md:text-base">
                              <span className="block truncate font-semibold text-sk-ink-2 md:font-bold md:text-sk-ink" title={entry.who}>
                                {entry.who}
                              </span>
                              {entry.role ? <span className="hidden text-sm text-sk-mute md:block">{roleLabel(entry.role)}</span> : null}
                            </p>
                          </div>
                          <div className="col-start-2 row-start-1 min-w-0 md:col-start-3">
                            <p className="break-words font-bold text-sk-ink">
                              {entry.what}
                              {entry.club ? <span className="font-semibold text-sk-ink-2">{` · ${entry.club}`}</span> : null}
                            </p>
                            {entry.note ? <p className="break-words text-sm text-sk-ink-2">{entry.note}</p> : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-sk-mute" aria-live="polite">
                  Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()} {filtered.length === 1 ? "event" : "events"}.
                </p>
                {filtered.length > shown.length ? (
                  <button type="button" className="sk-btn sk-btn-quiet" onClick={() => setVisible((current) => current + PAGE_SIZE)}>
                    Load {Math.min(PAGE_SIZE, filtered.length - shown.length)} more
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </Panel>
    </div>
  )
}
