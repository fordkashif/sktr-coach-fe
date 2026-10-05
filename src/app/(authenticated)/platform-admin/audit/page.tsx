import { useCallback, useEffect, useMemo, useState } from "react"
import { DownloadSimple } from "@phosphor-icons/react"
import { useSearchParams } from "react-router-dom"
import { ActivityDays, type ActivityItem } from "@/components/ops/activity-list"
import {
  Button,
  DataTable,
  DateRangeFields,
  EmptyState,
  Field,
  FormGrid,
  Notice,
  Screen,
  ScreenHeader,
  SearchInput,
  Section,
  Select,
  SkeletonRows,
  TableSub,
  Tabs,
  Tag,
  type DataTableColumn,
  type DateRangeValue,
} from "@/components/sk"
import { describePlatformAudit, platformActionLabel, platformRoleLabel, resolveAuditClub } from "@/lib/data/platform-admin/audit-format"
import {
  getPlatformAdminRequestQueue,
  getPlatformAuditLog,
  getPlatformFailedNotificationEmails,
  logPlatformAdminExport,
  retryPlatformNotificationEmail,
  type PlatformAdminRequestRecord,
  type PlatformAuditEventRecord,
  type PlatformFailedNotificationEmail,
} from "@/lib/data/platform-admin/ops-data"
import { csvFileName, downloadCsv, formatDateTime, localDayOf, localIsoDay, plural } from "@/lib/format/ops-format"
import { getBackendMode } from "@/lib/supabase/config"

const PAGE_SIZE = 50
const NO_CLUB = "__none__"
type View = "activity" | "emails"

type Entry = ActivityItem & { action: string; club: string | null; haystack: string }

function daysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return localIsoDay(date)
}

function toEntry(event: PlatformAuditEventRecord, requests: PlatformAdminRequestRecord[]): Entry {
  const club = resolveAuditClub(event, requests)
  const { what, note } = describePlatformAudit(event)
  const who = event.actorEmail ?? platformRoleLabel(event.actorRole) ?? "System"
  return {
    id: event.id,
    at: event.occurredAt,
    day: localDayOf(event.occurredAt),
    who,
    role: event.actorEmail ? platformRoleLabel(event.actorRole) : null,
    title: what,
    detail: note,
    about: club,
    action: event.action,
    club,
    haystack: [event.action, platformActionLabel(event.action), what, note ?? "", who, event.actorRole, platformRoleLabel(event.actorRole) ?? "", club ?? "", event.target, event.detail ?? "", JSON.stringify(event.metadata)]
      .join(" ")
      .toLowerCase(),
  }
}

function kindLabel(eventType: string) {
  const words = eventType.replaceAll("_", " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Notification"
}

/** What happened across every club, and the notification emails that failed. */
export default function PlatformAdminAuditPage() {
  const isSupabaseMode = getBackendMode() === "supabase"
  const today = localIsoDay()
  const [searchParams, setSearchParams] = useSearchParams()
  const view: View = searchParams.get("view") === "emails" ? "emails" : "activity"

  const [events, setEvents] = useState<PlatformAuditEventRecord[] | null>(null)
  const [requests, setRequests] = useState<PlatformAdminRequestRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [actionFilter, setActionFilter] = useState("all")
  const [actorFilter, setActorFilter] = useState("all")
  const [clubFilter, setClubFilter] = useState("all")
  /** Null means the whole log. */
  const [range, setRange] = useState<DateRangeValue | null>(null)
  const [visible, setVisible] = useState(PAGE_SIZE)

  /** Undefined while loading, null when the list cannot be read. */
  const [failedEmails, setFailedEmails] = useState<PlatformFailedNotificationEmail[] | null | undefined>(undefined)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [emailNotice, setEmailNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null)

  const load = useCallback(async () => {
    // Club names come from the request list. If that fails the log still shows, just without some club names.
    const [logResult, queueResult] = await Promise.all([getPlatformAuditLog(), getPlatformAdminRequestQueue()])
    if (queueResult.ok) setRequests(queueResult.data)
    if (!logResult.ok) {
      setLoadError(logResult.error.message)
      setEvents((current) => current ?? [])
      return
    }
    setEvents(logResult.data.entries)
    setTotal(logResult.data.total)
    setLoadError(null)
  }, [])

  const loadEmails = useCallback(async () => {
    setFailedEmails(await getPlatformFailedNotificationEmails(50))
  }, [])

  useEffect(() => {
    void load()
    void loadEmails()
  }, [load, loadEmails])

  const entries = useMemo(() => (events ?? []).map((event) => toEntry(event, requests)), [events, requests])
  const oldestDay = entries.length > 0 ? entries[entries.length - 1].day || today : today
  const everything: DateRangeValue = { from: oldestDay < today ? oldestDay : today, to: today }
  const shownRange = range ?? everything

  const actions = useMemo(
    () => [...new Set(entries.map((entry) => entry.action))].sort((left, right) => platformActionLabel(left).localeCompare(platformActionLabel(right))),
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
      if (range && (entry.day < range.from || entry.day > range.to)) return false
      return !needle || entry.haystack.includes(needle)
    })
  }, [actionFilter, actorFilter, clubFilter, entries, query, range])

  const hasFilters = Boolean(query.trim()) || actionFilter !== "all" || actorFilter !== "all" || clubFilter !== "all" || range !== null
  const clearFilters = () => {
    setQuery("")
    setActionFilter("all")
    setActorFilter("all")
    setClubFilter("all")
    setRange(null)
  }

  // Any filter change starts again from the first page.
  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [query, actionFilter, actorFilter, clubFilter, range])

  const shown = filtered.slice(0, visible)
  const loading = events === null

  const exportCsv = async () => {
    const stored = new Map((events ?? []).map((event) => [event.id, event]))
    downloadCsv(csvFileName("platform activity", shownRange.from, "to", shownRange.to), [
      ["When", "Who", "Role", "What happened", "Club", "Detail", "Action code", "Stored target", "Stored detail"],
      ...filtered.map((entry) => {
        const event = stored.get(entry.id)
        return [formatDateTime(entry.at), entry.who, platformRoleLabel(event?.actorRole ?? null) ?? "", entry.title, entry.club ?? "", entry.detail ?? "", entry.action, event?.target ?? "", event?.detail ?? ""]
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
        from: range?.from ?? null,
        to: range?.to ?? null,
      },
    })
    if (!result.ok) {
      setExportError(result.error.message)
      return
    }
    setExportError(null)
    await load()
  }

  const retryEmail = async (email: PlatformFailedNotificationEmail) => {
    if (retryingId) return
    setRetryingId(email.id)
    setEmailNotice(null)
    const result = await retryPlatformNotificationEmail(email.id)
    if (!result.ok) {
      setEmailNotice({ tone: "error", text: `Could not send it again. ${result.error.message}` })
    } else if (result.data.sent) {
      setEmailNotice({ tone: "success", text: `Sent "${email.subject}" to ${email.recipientEmail ?? "the recipient"}.` })
    } else {
      setEmailNotice({
        tone: "warning",
        text: result.data.error
          ? `It is back in the queue, but this try failed again: ${result.data.error}`
          : "It is back in the queue and will go out with the next delivery run.",
      })
    }
    await Promise.all([loadEmails(), load()])
    setRetryingId(null)
  }

  const emailColumns: Array<DataTableColumn<PlatformFailedNotificationEmail>> = [
    {
      key: "email",
      header: "Email",
      cell: (email) => (
        <>
          <span className="break-words">{email.subject || "Notification"}</span>
          <TableSub>{kindLabel(email.eventType)}</TableSub>
        </>
      ),
    },
    { key: "to", header: "To", cell: (email) => (email.recipientEmail ? <span className="break-all">{email.recipientEmail}</span> : <span className="text-sk-mute">No address</span>) },
    { key: "club", header: "Club", cell: (email) => email.tenantName ?? <span className="text-sk-mute">Not about one club</span> },
    { key: "queued", header: "Queued", cell: (email) => formatDateTime(email.createdAt) },
    { key: "error", header: "What went wrong", className: "max-w-[18rem]", cell: (email) => <span className="break-words">{email.lastError ?? "No reason was recorded"}</span> },
    {
      key: "state",
      header: "State",
      phone: "trailing",
      cell: (email) =>
        email.willRetry ? (
          <Tag tone="yellow" className="whitespace-nowrap">{`Try ${email.attempts} of 5`}</Tag>
        ) : email.canRetry ? (
          <Tag tone="coral" className="whitespace-nowrap">Gave up</Tag>
        ) : (
          <Tag tone="plain" className="whitespace-nowrap">Too old</Tag>
        ),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      phone: "plain",
      cell: (email) =>
        email.canRetry ? (
          <Button size="sm" disabled={retryingId !== null} onClick={() => void retryEmail(email)} aria-label={`Try again: ${email.subject} to ${email.recipientEmail ?? "the recipient"}`}>
            {retryingId === email.id ? "Sending..." : "Try again"}
          </Button>
        ) : null,
    },
  ]

  const capped = total > entries.length
  const failedCount = failedEmails?.length ?? 0
  const lede =
    view === "emails"
      ? "Notification emails that failed in the last 8 days, newest first. The message itself is never shown here."
      : loading
        ? "What happened across every club, newest first."
        : entries.length === 0
          ? "What happened across every club. Nothing has been recorded yet."
          : capped
            ? `The latest ${entries.length.toLocaleString()} of ${total.toLocaleString()} events, newest first. Older activity is kept but not listed here.`
            : `${plural(entries.length, "event")} across every club, newest first. Times are in your local time.`

  return (
    <Screen>
      <ScreenHeader
        title="Platform activity"
        lede={lede}
        actions={
          view === "activity" ? (
            <Button variant="primary" onClick={() => void exportCsv()} disabled={filtered.length === 0}>
              <DownloadSimple className="size-5" weight="bold" aria-hidden />
              Activity CSV
            </Button>
          ) : undefined
        }
      />

      <Tabs<View>
        label="Choose a view"
        value={view}
        onChange={(next) => setSearchParams(next === "emails" ? { view: "emails" } : {}, { replace: true })}
        options={[
          { value: "activity", label: "Activity" },
          { value: "emails", label: "Failed emails", count: failedCount > 0 ? failedCount : undefined },
        ]}
      />

      {view === "activity" ? (
        <>
          {loadError ? <Notice tone="error">We could not load platform activity. {loadError}</Notice> : null}
          {exportError ? <Notice tone="warning">Your file downloaded, but we could not add the export to the log. {exportError}</Notice> : null}

          {entries.length > 0 ? (
            <FormGrid columns={4} className="items-start">
              <Field label="Search activity">
                <SearchInput placeholder="Club, person or action" value={query} onChange={(event) => setQuery(event.target.value)} />
              </Field>
              <Field label="What happened">
                <Select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
                  <option value="all">Everything</option>
                  {actions.map((action) => (
                    <option key={action} value={action}>
                      {platformActionLabel(action)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Who">
                <Select value={actorFilter} onChange={(event) => setActorFilter(event.target.value)}>
                  <option value="all">Everyone</option>
                  {actors.map((actor) => (
                    <option key={actor} value={actor}>
                      {actor}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Club">
                <Select value={clubFilter} onChange={(event) => setClubFilter(event.target.value)}>
                  <option value="all">Every club</option>
                  {clubs.map((club) => (
                    <option key={club} value={club}>
                      {club}
                    </option>
                  ))}
                  {hasClubless ? <option value={NO_CLUB}>Not about one club</option> : null}
                </Select>
              </Field>
              <DateRangeFields
                className="sm:col-span-2"
                value={shownRange}
                max={today}
                onChange={(next) => setRange(next.from === everything.from && next.to === everything.to ? null : next)}
                presets={[
                  { label: "Everything", range: everything },
                  { label: "Last 7 days", range: { from: daysAgo(6), to: today } },
                  { label: "Last 28 days", range: { from: daysAgo(27), to: today } },
                ]}
              />
            </FormGrid>
          ) : null}

          {loading ? (
            <Section title="Today">
              <SkeletonRows rows={5} leading label="Loading activity" />
            </Section>
          ) : entries.length === 0 ? (
            loadError ? null : (
              <Section>
                <EmptyState
                  title="No platform activity yet"
                  body="When a club asks for a workspace, or you approve a request, change a club's status or package, decide a package request or download a list, it shows up here with who did it and when."
                />
              </Section>
            )
          ) : filtered.length === 0 ? (
            <Section>
              <EmptyState
                title="No activity matches these filters"
                body={`There are ${plural(entries.length, "event")} in the log, but none fit the current search and filters.`}
                action={
                  <Button size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            </Section>
          ) : (
            <>
              <ActivityDays items={shown} />
              <Section aria-label="More activity">
                <p className="sk-list-sub" aria-live="polite">
                  Showing {shown.length.toLocaleString()} of {plural(filtered.length, "event")}
                  {hasFilters ? `, filtered from ${entries.length.toLocaleString()}` : ""}.
                </p>
                {filtered.length > shown.length ? (
                  <Button className="mt-3 self-start" onClick={() => setVisible((current) => current + PAGE_SIZE)}>
                    Load {Math.min(PAGE_SIZE, filtered.length - shown.length)} more
                  </Button>
                ) : null}
              </Section>
            </>
          )}
        </>
      ) : (
        <>
          {emailNotice ? <Notice tone={emailNotice.tone}>{emailNotice.text}</Notice> : null}
          <Section
            title="Emails that failed"
            hint="An email is tried five times with a growing wait. After that, or straight away when the provider will never accept it, it stops. Try again puts it back in the queue and sends it now. An email more than 72 hours old is not sent."
            meta={failedEmails && failedEmails.length > 0 ? plural(failedEmails.length, "email") : undefined}
          >
            {failedEmails === undefined ? (
              <SkeletonRows rows={3} label="Loading failed emails" />
            ) : failedEmails === null ? (
              <EmptyState
                title="The list of failed emails is not available"
                body="This database does not have the function that lists them yet, or the read failed. The dashboard still shows how many failed in the last 24 hours."
              />
            ) : failedEmails.length === 0 ? (
              <EmptyState
                title="No emails have failed"
                body={isSupabaseMode ? "Notification emails that could not be delivered in the last 8 days show up here with the reason." : "This is the demo, which has no email queue. On the live platform, emails that could not be delivered show up here with the reason."}
              />
            ) : (
              <DataTable caption="Notification emails that failed" columns={emailColumns} rows={failedEmails} rowKey={(email) => email.id} rowProps={(email) => ({ "data-failed-email": email.id })} />
            )}
          </Section>
        </>
      )}
    </Screen>
  )
}
