"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react"
import { EmptyState, Initials, PageHeader, Panel } from "@/components/sk"
import { getClubAdminAuditLog, insertAuditEvent } from "@/lib/data/club-admin/ops-data"
import { getBackendMode } from "@/lib/supabase/config"
import { downloadCsv, formatDateTime, localIsoDay, parseLocalDay } from "../ops-format"

const PAGE_SIZE = 50

type ActivityEntry = {
  id: string
  /** ISO timestamp. */
  at: string
  /** Local calendar day (YYYY-MM-DD) the event happened on. */
  day: string
  action: string
  who: string
  role: string | null
  target: string
  detail: string | null
}

const ROLE_LABEL: Record<string, string> = {
  "club-admin": "Club admin",
  coach: "Coach",
  athlete: "Athlete",
  "platform-admin": "SKTR team",
  system: "System",
}

/** What happened, in plain words, for each action code the app writes. */
const ACTION_LABEL: Record<string, string> = {
  export_csv: "Downloaded a CSV",
  export_pdf: "Printed a report",
  role_assign: "Changed a role",
  user_disable: "Turned off an account",
  user_enable: "Turned an account back on",
  coach_invite_send: "Invited a coach",
  coach_invite_accept: "Accepted a coach invite",
  athlete_invite_accept: "Joined with an athlete invite",
  profile_update: "Updated the club profile",
  billing_update: "Updated billing details",
  package_upgrade_requested: "Asked for a package change",
  first_access_setup_complete: "Finished first-time setup",
  tenant_provisioned: "Club workspace created",
}

const EXPORT_TARGET_LABEL: Record<string, string> = {
  teams: "Team summary report",
  adherence: "Plan adherence report",
  wellness: "Wellness check-ins report",
  prs: "Personal records report",
  users: "People list",
  performance: "Performance report",
  audit: "Activity log",
  reports: "Reports",
}

const TARGET_LABEL: Record<string, string> = {
  "club-profile": "Club profile",
  subscription: "Billing",
  "billing-contact": "Billing contact",
  "club-admin-onboarding": "Club setup",
  reports: "Reports",
}

function actionLabel(action: string) {
  if (ACTION_LABEL[action]) return ACTION_LABEL[action]
  const words = action.replaceAll("_", " ").replaceAll("-", " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Activity"
}

function targetLabel(entry: Pick<ActivityEntry, "action" | "target">) {
  if (entry.action === "export_csv" || entry.action === "export_pdf") return EXPORT_TARGET_LABEL[entry.target] ?? entry.target
  if (entry.action === "package_upgrade_requested") return `${entry.target.charAt(0).toUpperCase()}${entry.target.slice(1)} package`
  return TARGET_LABEL[entry.target] ?? entry.target
}

function roleLabel(role: string | null) {
  if (!role) return null
  return ROLE_LABEL[role] ?? role
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

function toEntry(raw: { id: string; at: string; action: string; who: string; role: string | null; target: string; detail: string | null }): ActivityEntry {
  const parsed = new Date(raw.at)
  return { ...raw, day: Number.isNaN(parsed.getTime()) ? "" : localIsoDay(parsed) }
}

export default function ClubAdminAuditPage() {
  const isSupabaseMode = getBackendMode() === "supabase"
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [actionFilter, setActionFilter] = useState("all")
  const [actorFilter, setActorFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [visible, setVisible] = useState(PAGE_SIZE)

  const load = useCallback(async () => {
    if (isSupabaseMode) {
      const result = await getClubAdminAuditLog()
      if (!result.ok) {
        setLoadError(result.error.message)
        setLoading(false)
        return
      }
      setEntries(
        result.data.entries.map((entry) =>
          toEntry({
            id: entry.id,
            at: entry.at,
            action: entry.action,
            who: entry.actorName ?? roleLabel(entry.actorRole) ?? "System",
            role: entry.actorName ? entry.actorRole : null,
            target: entry.target,
            detail: entry.detail,
          }),
        ),
      )
      setTotal(result.data.total)
      setLoadError(null)
      setLoading(false)
      return
    }

    const mockAudit = await import("@/lib/mock-audit")
    const logs = mockAudit.loadAuditLogs()
    setEntries(
      logs.map((entry) =>
        toEntry({
          id: entry.id,
          at: entry.at,
          action: entry.action,
          who: roleLabel(entry.actor) ?? entry.actor,
          role: null,
          target: entry.target,
          detail: entry.detail ?? null,
        }),
      ),
    )
    setTotal(logs.length)
    setLoading(false)
  }, [isSupabaseMode])

  useEffect(() => {
    void load()
  }, [load])

  const actions = useMemo(
    () => [...new Set(entries.map((entry) => entry.action))].sort((left, right) => actionLabel(left).localeCompare(actionLabel(right))),
    [entries],
  )
  const actors = useMemo(() => [...new Set(entries.map((entry) => entry.who))].sort(), [entries])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (actionFilter !== "all" && entry.action !== actionFilter) return false
      if (actorFilter !== "all" && entry.who !== actorFilter) return false
      if (dateFrom && entry.day < dateFrom) return false
      if (dateTo && entry.day > dateTo) return false
      if (!needle) return true
      return [entry.action, actionLabel(entry.action), entry.who, entry.role ?? "", entry.target, targetLabel(entry), entry.detail ?? ""].some((value) =>
        value.toLowerCase().includes(needle),
      )
    })
  }, [actionFilter, actorFilter, dateFrom, dateTo, entries, query])

  const hasFilters = Boolean(query.trim()) || actionFilter !== "all" || actorFilter !== "all" || Boolean(dateFrom || dateTo)
  const clearFilters = () => {
    setQuery("")
    setActionFilter("all")
    setActorFilter("all")
    setDateFrom("")
    setDateTo("")
  }

  // Any filter change starts again from the first page.
  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [query, actionFilter, actorFilter, dateFrom, dateTo])

  const shown = filtered.slice(0, visible)
  const groups = shown.reduce<Array<{ day: string; items: ActivityEntry[] }>>((acc, entry) => {
    const last = acc[acc.length - 1]
    if (last && last.day === entry.day) last.items.push(entry)
    else acc.push({ day: entry.day, items: [entry] })
    return acc
  }, [])

  const exportCsv = async () => {
    const filename = "club-activity-log.csv"
    downloadCsv(filename, [
      ["When", "Who", "Role", "What happened", "About", "Detail", "Action code"],
      ...filtered.map((entry) => [
        formatDateTime(entry.at),
        entry.who,
        roleLabel(entry.role) ?? "",
        actionLabel(entry.action),
        targetLabel(entry),
        entry.detail ?? "",
        entry.action,
      ]),
    ])
    const detail = `${filename}, ${filtered.length} rows`
    if (isSupabaseMode) {
      const result = await insertAuditEvent({ action: "export_csv", target: "audit", detail })
      if (!result.ok) setLoadError(`Your file downloaded, but we could not add the export to the log. ${result.error.message}`)
    } else {
      const mockAudit = await import("@/lib/mock-audit")
      mockAudit.logAuditEvent({ actor: "club-admin", action: "export_csv", target: "audit", detail })
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
          {entries.length === 0 ? "We could not load the activity log. " : ""}
          {loadError}
        </p>
      ) : null}

      <PageHeader
        title="Activity log"
        lede="Who did what in your club, newest first. Invites, role changes, exports and settings updates all land here."
      />

      <Panel
        title={loading ? "Activity" : `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "event" : "events"}`}
        hint={
          isSupabaseMode && total > entries.length
            ? `Showing the latest ${entries.length.toLocaleString()} of ${total.toLocaleString()} events. Older activity is kept but not listed here.`
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
                    placeholder="Person, action or detail"
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
              <label className="col-span-2 block min-w-0 sm:col-span-1 lg:w-44">
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
                title="No activity yet"
                body="When someone sends an invite, changes a role, downloads a report or updates club settings, it shows up here with their name and the time."
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
                          className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-sk-line py-3.5 last:border-b-0 md:grid-cols-[5.5rem_14rem_minmax(0,1fr)] md:items-start md:gap-x-5"
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
                              <span className="block truncate font-semibold text-sk-ink-2 md:font-bold md:text-sk-ink">{entry.who}</span>
                              {entry.role ? <span className="hidden text-sm text-sk-mute md:block">{roleLabel(entry.role)}</span> : null}
                            </p>
                          </div>
                          <div className="col-start-2 row-start-1 min-w-0 md:col-start-3">
                            <p className="font-bold text-sk-ink">{actionLabel(entry.action)}</p>
                            <p className="break-words text-sm text-sk-ink-2">
                              {targetLabel(entry)}
                              {entry.detail ? <span className="text-sk-mute">{` (${entry.detail})`}</span> : null}
                            </p>
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
