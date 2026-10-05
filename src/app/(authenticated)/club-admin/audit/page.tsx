import { useCallback, useEffect, useMemo, useState } from "react"
import { DownloadSimple } from "@phosphor-icons/react"
import { ActivityDays, type ActivityItem } from "@/components/ops/activity-list"
import { Button, DateRangeFields, EmptyState, Field, FormGrid, Notice, Screen, ScreenHeader, SearchInput, Section, Select, SkeletonRows, type DateRangeValue } from "@/components/sk"
import { ACTIVITY_GROUPS, clubActorRoleLabel, describeClubActivity, type ActivityGroup } from "@/lib/audit/club-activity"
import { getClubAdminAuditLog, insertAuditEvent } from "@/lib/data/club-admin/ops-data"
import { getBackendMode } from "@/lib/supabase/config"
import { csvFileName, downloadCsv, formatDateTime, localDayOf, localIsoDay, plural } from "../ops-format"

const PAGE_SIZE = 50

type Entry = ActivityItem & { action: string; group: ActivityGroup; target: string; rawDetail: string | null; haystack: string }

function daysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return localIsoDay(date)
}

function toEntry(raw: { id: string; at: string; action: string; who: string; role: string | null; userId: string | null; target: string; detail: string | null }): Entry {
  const described = describeClubActivity({ action: raw.action, target: raw.target, detail: raw.detail })
  return {
    id: raw.id,
    at: raw.at,
    day: localDayOf(raw.at),
    who: raw.who,
    role: raw.role,
    userId: raw.userId,
    title: described.title,
    detail: described.detail,
    action: raw.action,
    group: described.group,
    target: raw.target,
    rawDetail: raw.detail,
    haystack: [raw.action, described.title, described.detail ?? "", raw.who, raw.role ?? "", raw.target, raw.detail ?? ""].join(" ").toLowerCase(),
  }
}

/** Who did what in the club, newest first, grouped by day. */
export default function ClubAdminAuditPage() {
  const isSupabaseMode = getBackendMode() === "supabase"
  const today = localIsoDay()
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [groupFilter, setGroupFilter] = useState<"all" | ActivityGroup>("all")
  const [actorFilter, setActorFilter] = useState("all")
  /** Null means the whole log. */
  const [range, setRange] = useState<DateRangeValue | null>(null)
  const [visible, setVisible] = useState(PAGE_SIZE)

  const load = useCallback(async () => {
    if (isSupabaseMode) {
      const result = await getClubAdminAuditLog()
      if (!result.ok) {
        setLoadError(result.error.message)
        setEntries((current) => current ?? [])
        return
      }
      setEntries(
        result.data.entries.map((entry) =>
          toEntry({
            id: entry.id,
            at: entry.at,
            action: entry.action,
            who: entry.actorName ?? clubActorRoleLabel(entry.actorRole) ?? "System",
            role: entry.actorName ? clubActorRoleLabel(entry.actorRole) : null,
            userId: entry.actorUserId,
            target: entry.target,
            detail: entry.detail,
          }),
        ),
      )
      setTotal(result.data.total)
      setLoadError(null)
      return
    }

    const mockAudit = await import("@/lib/mock-audit")
    const logs = mockAudit.loadAuditLogs()
    setEntries(
      logs.map((entry) =>
        toEntry({ id: entry.id, at: entry.at, action: entry.action, who: clubActorRoleLabel(entry.actor) ?? entry.actor, role: null, userId: null, target: entry.target, detail: entry.detail ?? null }),
      ),
    )
    setTotal(logs.length)
  }, [isSupabaseMode])

  useEffect(() => {
    void load()
  }, [load])

  const all = useMemo(() => entries ?? [], [entries])
  const oldestDay = all.length > 0 ? all[all.length - 1].day || today : today
  const everything: DateRangeValue = { from: oldestDay < today ? oldestDay : today, to: today }
  const shownRange = range ?? everything

  const groups = useMemo(() => ACTIVITY_GROUPS.filter((group) => all.some((entry) => entry.group === group.key)), [all])
  const actors = useMemo(() => [...new Set(all.map((entry) => entry.who))].sort((left, right) => left.localeCompare(right)), [all])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return all.filter((entry) => {
      if (groupFilter !== "all" && entry.group !== groupFilter) return false
      if (actorFilter !== "all" && entry.who !== actorFilter) return false
      if (range && (entry.day < range.from || entry.day > range.to)) return false
      return !needle || entry.haystack.includes(needle)
    })
  }, [actorFilter, all, groupFilter, query, range])

  const hasFilters = Boolean(query.trim()) || groupFilter !== "all" || actorFilter !== "all" || range !== null
  const clearFilters = () => {
    setQuery("")
    setGroupFilter("all")
    setActorFilter("all")
    setRange(null)
  }

  // Any filter change starts again from the first page.
  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [query, groupFilter, actorFilter, range])

  const shown = filtered.slice(0, visible)
  const loading = entries === null

  const exportCsv = async () => {
    const filename = csvFileName("club activity", shownRange.from, "to", shownRange.to)
    downloadCsv(filename, [
      ["When", "Who", "Role", "What happened", "Detail", "Action code", "Stored target", "Stored detail"],
      ...filtered.map((entry) => [formatDateTime(entry.at), entry.who, entry.role ?? "", entry.title, entry.detail ?? "", entry.action, entry.target, entry.rawDetail ?? ""]),
    ])
    const detail = `${filename}, ${filtered.length} rows`
    if (isSupabaseMode) {
      const result = await insertAuditEvent({ action: "export_csv", target: "audit", detail })
      setExportError(result.ok ? null : result.error.message)
    } else {
      const mockAudit = await import("@/lib/mock-audit")
      mockAudit.logAuditEvent({ actor: "club-admin", action: "export_csv", target: "audit", detail })
    }
    await load()
  }

  const capped = isSupabaseMode && total > all.length
  const lede = loading
    ? "Who did what in your club, newest first."
    : all.length === 0
      ? "Who did what in your club. Nothing has been recorded yet."
      : capped
        ? `The latest ${all.length.toLocaleString()} of ${total.toLocaleString()} events, newest first. Older activity is kept but not listed here.`
        : `${plural(all.length, "event")}, newest first. Times are in your local time.`

  return (
    <Screen>
      <ScreenHeader
        title="Activity"
        lede={lede}
        actions={
          <Button variant="primary" onClick={() => void exportCsv()} disabled={filtered.length === 0}>
            <DownloadSimple className="size-5" weight="bold" aria-hidden />
            Activity CSV
          </Button>
        }
      />

      {loadError ? <Notice tone="error">We could not load the activity log. {loadError}</Notice> : null}
      {exportError ? <Notice tone="warning">Your file downloaded, but we could not add the export to the log. {exportError}</Notice> : null}

      {all.length > 0 ? (
        <FormGrid columns={4} className="items-start">
          <Field label="Search activity" className="sm:col-span-2">
            <SearchInput placeholder="Person, action or detail" value={query} onChange={(event) => setQuery(event.target.value)} />
          </Field>
          <Field label="What happened">
            <Select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value as "all" | ActivityGroup)}>
              <option value="all">Everything</option>
              {groups.map((group) => (
                <option key={group.key} value={group.key}>
                  {group.label}
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
      ) : all.length === 0 ? (
        loadError ? null : (
          <Section>
            <EmptyState
              title="No activity yet"
              body="When someone sends an invite, changes a role, moves an athlete, downloads a report or updates club settings, it shows up here with their name and the time."
            />
          </Section>
        )
      ) : filtered.length === 0 ? (
        <Section>
          <EmptyState
            title="No activity matches these filters"
            body={`There are ${plural(all.length, "event")} in the log, but none fit the current search and filters.`}
            action={
              <Button size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        </Section>
      ) : (
        <>
          <ActivityDays items={shown} people />
          <Section aria-label="More activity">
            <p className="sk-list-sub" aria-live="polite">
              Showing {shown.length.toLocaleString()} of {plural(filtered.length, "event")}
              {hasFilters ? `, filtered from ${all.length.toLocaleString()}` : ""}.
            </p>
            {filtered.length > shown.length ? (
              <Button className="mt-3 self-start" onClick={() => setVisible((current) => current + PAGE_SIZE)}>
                Load {Math.min(PAGE_SIZE, filtered.length - shown.length)} more
              </Button>
            ) : null}
          </Section>
        </>
      )}
    </Screen>
  )
}
