import { useEffect, useMemo, useState } from "react"
import { DownloadSimple, Printer } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import {
  Button,
  DataTable,
  DateRangeFields,
  EmptyState,
  Field,
  FormGrid,
  LinkButton,
  Mark,
  Notice,
  ReadinessText,
  Screen,
  ScreenHeader,
  SearchInput,
  Section,
  Select,
  SkeletonRows,
  Stat,
  StatStrip,
  StatusText,
  TableSub,
  Tabs,
  Tag,
  type DataTableColumn,
} from "@/components/sk"
import { PersonAvatar } from "@/components/account/person-avatar"
import { useCoachTeamScope } from "@/lib/coach-teams"
import { csvFileName, downloadCsv } from "@/lib/csv"
import { describeAvailability } from "@/lib/data/athlete/availability-data"
import {
  DEFAULT_REPORT_DAYS,
  describeReportRange,
  getCoachReports,
  reportRangeForLastDays,
  type AdherenceReportRow,
  type CoachReports,
  type RecordsReportRow,
  type ReportMark,
  type ReportRange,
  type WellnessReportRow,
} from "@/lib/data/coach/reports-data"
import { markUnitLabel } from "@/lib/data/pr/marks"
import { averageAdherence, NO_SESSIONS_DUE } from "@/lib/data/session/adherence"
import { todayIso } from "@/lib/data/training-plan/plan-builder-model"

type ReportKey = "adherence" | "wellness" | "records"
type ReadinessFilter = "all" | "green" | "yellow" | "red"

const READINESS_LABEL = { green: "Ready", yellow: "Watch", red: "Review" } as const
const WELLNESS_PAGE = 60

function shortDay(isoDate: string) {
  const parsed = new Date(`${isoDate}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? isoDate : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

function average(values: number[]) {
  return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : null
}

function sentenceCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function markText(mark: ReportMark | null) {
  if (!mark) return ""
  return `${mark.display}${markUnitLabel(mark.display, mark.unit)}${mark.wind ? ` (${mark.wind})` : ""}`
}

/** One best in the records table: the mark with its wind, the day it was set, and "New" when that was inside the period. */
function BestCell({ mark, assisted = false }: { mark: ReportMark | null; assisted?: boolean }) {
  if (!mark) return <span className="text-sk-faint">-</span>
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="inline-flex items-center gap-2">
        {mark.inRange ? <Tag tone={assisted ? "yellow" : "green"}>New</Tag> : null}
        <Mark size="sm" value={mark.display} unit={markUnitLabel(mark.display, mark.unit).trim() || undefined} qualifier={mark.wind ? `${mark.wind}${assisted ? " w" : ""}` : assisted ? "w" : undefined} />
      </span>
      <span className="text-sm text-sk-mute">{shortDay(mark.date)}</span>
    </span>
  )
}

export default function CoachReportsPage() {
  const { role, coachTeamId } = useCoachTeamScope()
  // One report screen per team: switching team reloads the data and clears the filters.
  return <CoachReports key={coachTeamId ?? "all"} scopeTeamId={role === "coach" ? coachTeamId : null} />
}

function CoachReports({ scopeTeamId }: { scopeTeamId: string | null }) {
  const today = todayIso()
  const [range, setRange] = useState<ReportRange>(() => reportRangeForLastDays(DEFAULT_REPORT_DAYS))
  const [data, setData] = useState<CoachReports | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingRange, setLoadingRange] = useState(true)
  const [report, setReport] = useState<ReportKey>("adherence")
  const [search, setSearch] = useState("")
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>("all")
  const [wellnessLimit, setWellnessLimit] = useState(WELLNESS_PAGE)

  useEffect(() => {
    let cancelled = false
    setLoadingRange(true)
    void getCoachReports({ scopeTeamId, range }).then((result) => {
      if (cancelled) return
      setLoadingRange(false)
      if (!result.ok) return setError(result.error.message)
      setError(null)
      setData(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [range, scopeTeamId])

  const query = search.trim().toLowerCase()
  const matches = (...texts: string[]) => !query || texts.some((text) => text.toLowerCase().includes(query))

  const adherenceRows = useMemo(
    () =>
      (data?.adherence ?? [])
        .filter((row) => (!query || row.name.toLowerCase().includes(query)) && (readinessFilter === "all" || row.readiness === readinessFilter))
        .sort((left, right) => (left.adherence ?? 101) - (right.adherence ?? 101) || left.name.localeCompare(right.name)),
    [data, query, readinessFilter],
  )
  const wellnessRows = (data?.wellness ?? []).filter((row) => matches(row.athleteName) && (readinessFilter === "all" || row.readiness === readinessFilter))
  const recordRows = (data?.records ?? []).filter((row) => matches(row.athleteName, row.eventLabel))

  const loading = data === null && !error
  const rangeText = describeReportRange(range)
  const teamLabel = data?.teamName ?? "All teams"
  const filtersActive = Boolean(query) || (report !== "records" && readinessFilter !== "all")
  const clearFilters = () => {
    setSearch("")
    setReadinessFilter("all")
  }

  /** Every export starts with the same three lines, so a file says what it is without its name. */
  const exportCsv = (kind: string, title: string, columns: string[], rows: Array<Array<string | number>>) =>
    downloadCsv(csvFileName(data?.teamName ?? "all teams", kind, range.from, "to", range.to), [["Report", title], ["Team", teamLabel], ["Period", `${range.from} to ${range.to}`], [], columns, ...rows])

  const reports = {
    adherence: {
      title: "Plan adherence",
      hint: "Sessions done out of sessions due in this period. Lowest first, so you can see who to follow up with.",
      count: adherenceRows.length,
      total: data?.adherence.length ?? 0,
      noun: "athletes",
      exportLabel: "Adherence CSV",
      onExport: () =>
        exportCsv(
          "adherence",
          "Plan adherence",
          ["Athlete", "Event group", "Primary event", "Sessions due", "Sessions done", "Excused", "Plan adherence (%)", "Readiness", "Last check-in", "Availability"],
          adherenceRows.map((row) => [
            row.name,
            row.eventGroup,
            row.primaryEvent,
            row.due,
            row.done,
            row.excused,
            row.adherence === null ? NO_SESSIONS_DUE : row.adherence,
            row.readiness ? READINESS_LABEL[row.readiness] : "",
            row.lastCheckIn ?? "",
            row.availability ? sentenceCase(describeAvailability(row.availability)) : "",
          ]),
        ),
    },
    wellness: {
      title: "Wellness check-ins",
      hint: "Every check-in in this period, newest first. Soreness, fatigue, mood and stress are scored 1 to 5.",
      count: wellnessRows.length,
      total: data?.wellness.length ?? 0,
      noun: "check-ins",
      exportLabel: "Wellness CSV",
      onExport: () =>
        exportCsv(
          "wellness",
          "Wellness check-ins",
          ["Athlete", "Date", "Sleep (hours)", "Soreness (1-5)", "Fatigue (1-5)", "Mood (1-5)", "Stress (1-5)", "Readiness", "Notes"],
          wellnessRows.map((row) => [row.athleteName, row.date, row.sleep, row.soreness, row.fatigue, row.mood, row.stress, READINESS_LABEL[row.readiness], row.notes ?? ""]),
        ),
    },
    records: {
      title: "Records",
      hint: "Events where a best was set in this period, with the athlete's personal best and season best. Wind assisted marks (w) never count as records.",
      count: recordRows.length,
      total: data?.records.length ?? 0,
      noun: "events",
      exportLabel: "Records CSV",
      onExport: () =>
        exportCsv(
          "records",
          "Records",
          ["Athlete", "Event", "Personal best", "Personal best date", "Season best", "Season best date", "Wind assisted best", "Wind assisted date"],
          recordRows.map((row) => [
            row.athleteName,
            row.eventLabel,
            markText(row.personalBest),
            row.personalBest?.date ?? "",
            markText(row.seasonBest),
            row.seasonBest?.date ?? "",
            markText(row.windAssisted),
            row.windAssisted?.date ?? "",
          ]),
        ),
    },
  }
  const active = reports[report]

  const athleteCell = (athleteId: string, name: string, sub?: string) => (
    <Link to={`/coach/athletes/${athleteId}`} className="flex items-center gap-3 hover:text-sk-blue-link">
      <PersonAvatar name={name} athleteId={athleteId} size="sm" />
      <span className="min-w-0">
        {name}
        {sub ? <TableSub>{sub}</TableSub> : null}
      </span>
    </Link>
  )

  const adherenceColumns: Array<DataTableColumn<AdherenceReportRow>> = [
    { key: "athlete", header: "Athlete", cell: (row) => athleteCell(row.athleteId, row.name, row.primaryEvent) },
    {
      key: "state",
      header: "Readiness",
      phone: "plain",
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          {row.readiness ? <ReadinessText status={row.readiness} /> : <span className="text-sk-mute">No check-in</span>}
          {row.availability ? <StatusText tone="amber">{sentenceCase(describeAvailability(row.availability))}</StatusText> : null}
        </span>
      ),
    },
    { key: "checkin", header: "Last check-in", phone: "hide", cell: (row) => (row.lastCheckIn ? shortDay(row.lastCheckIn) : "None") },
    {
      key: "sessions",
      header: "Sessions",
      align: "right",
      cell: (row) => (row.due === 0 ? (row.excused > 0 ? `${row.excused} excused` : "None due") : `${row.done} of ${row.due}${row.excused > 0 ? `, ${row.excused} excused` : ""}`),
    },
    {
      key: "adherence",
      header: "Adherence",
      align: "right",
      strong: true,
      phone: "trailing",
      cell: (row) => (row.adherence === null ? <span className="font-normal text-sk-mute">{NO_SESSIONS_DUE}</span> : `${row.adherence}%`),
    },
  ]

  const wellnessColumns: Array<DataTableColumn<WellnessReportRow>> = [
    { key: "athlete", header: "Athlete", cell: (row) => athleteCell(row.athleteId, row.athleteName, shortDay(row.date)) },
    { key: "readiness", header: "Readiness", phone: "trailing", cell: (row) => <ReadinessText status={row.readiness} /> },
    { key: "sleep", header: "Sleep (h)", align: "right", strong: true, cell: (row) => row.sleep },
    { key: "soreness", header: "Soreness", align: "right", cell: (row) => row.soreness },
    { key: "fatigue", header: "Fatigue", align: "right", cell: (row) => row.fatigue },
    { key: "mood", header: "Mood", align: "right", cell: (row) => row.mood },
    { key: "stress", header: "Stress", align: "right", cell: (row) => row.stress },
    { key: "notes", header: "Notes", className: "max-w-[16rem]", cell: (row) => row.notes ?? "" },
  ]

  const recordColumns: Array<DataTableColumn<RecordsReportRow>> = [
    { key: "athlete", header: "Athlete", cell: (row) => athleteCell(row.athleteId, row.athleteName, row.eventLabel) },
    { key: "pb", header: "Personal best", align: "right", cell: (row) => <BestCell mark={row.personalBest} /> },
    { key: "sb", header: "Season best", align: "right", cell: (row) => <BestCell mark={row.seasonBest} /> },
    { key: "wa", header: "Wind assisted", align: "right", cell: (row) => <BestCell mark={row.windAssisted} assisted /> },
  ]

  const dueTotal = adherenceRows.reduce((sum, row) => sum + row.due, 0)
  const doneTotal = adherenceRows.reduce((sum, row) => sum + row.done, 0)
  const adherenceAverage = averageAdherence(adherenceRows.map((row) => row.adherence))

  return (
    <Screen>
      <ScreenHeader
        title="Reports"
        lede={`${data?.teamName ? `${data.teamName}, ` : ""}${rangeText}. What you see in the table is what you download.`}
        actions={
          <span className="contents print:hidden">
            <Button onClick={() => window.print()}>
              <Printer className="size-5" weight="bold" aria-hidden />
              Print / PDF
            </Button>
            <Button variant="primary" onClick={active.onExport} disabled={!data || active.count === 0}>
              <DownloadSimple className="size-5" weight="bold" aria-hidden />
              {active.exportLabel}
            </Button>
          </span>
        }
      />

      {error ? <Notice tone="error">We could not load your reports. {error}</Notice> : null}

      <Tabs<ReportKey>
        label="Choose a report"
        className="print:hidden"
        value={report}
        onChange={(next) => {
          setReport(next)
          setWellnessLimit(WELLNESS_PAGE)
        }}
        options={[
          { value: "adherence", label: "Adherence" },
          { value: "wellness", label: "Wellness" },
          { value: "records", label: "Records" },
        ]}
      />

      <FormGrid columns={4} className="items-start print:hidden">
        <DateRangeFields
          className="sm:col-span-2"
          value={range}
          max={today}
          onChange={(next) => {
            setRange(next)
            setWellnessLimit(WELLNESS_PAGE)
          }}
          presets={[
            { label: "Last 28 days", range: reportRangeForLastDays(28, today) },
            { label: "Last 90 days", range: reportRangeForLastDays(90, today) },
            { label: "This year", range: { from: `${today.slice(0, 4)}-01-01`, to: today } },
          ]}
        />
        <Field label={report === "records" ? "Search athlete or event" : "Search athlete"}>
          <SearchInput placeholder={report === "records" ? "Name or event" : "Name"} value={search} onChange={(event) => setSearch(event.target.value)} />
        </Field>
        {report === "records" ? null : (
          <Field label="Readiness">
            <Select value={readinessFilter} onChange={(event) => setReadinessFilter(event.target.value as ReadinessFilter)}>
              <option value="all">All</option>
              <option value="green">Ready</option>
              <option value="yellow">Watch</option>
              <option value="red">Review</option>
            </Select>
          </Field>
        )}
      </FormGrid>

      {report === "adherence" ? (
        <StatStrip aria-label="Adherence in this period">
          {adherenceAverage === null ? <Stat label="Average adherence" value="None" hint={NO_SESSIONS_DUE} /> : <Stat label="Average adherence" value={adherenceAverage} unit="%" />}
          <Stat label="Sessions done" value={doneTotal} of={dueTotal} />
          <Stat label="Excused" value={adherenceRows.reduce((sum, row) => sum + row.excused, 0)} />
          <Stat label="Under 75%" value={adherenceRows.filter((row) => row.adherence !== null && row.adherence < 75).length} />
        </StatStrip>
      ) : report === "wellness" ? (
        <StatStrip aria-label="Wellness in this period">
          <Stat label="Check-ins" value={wellnessRows.length} />
          <Stat label="Average sleep" value={average(wellnessRows.map((row) => row.sleep)) ?? "None"} unit={wellnessRows.length ? "h" : undefined} />
          <Stat label="Watch or review" value={wellnessRows.filter((row) => row.readiness !== "green").length} />
          <Stat label="Athletes checking in" value={new Set(wellnessRows.map((row) => row.athleteId)).size} of={data?.athleteCount ?? 0} />
        </StatStrip>
      ) : (
        <StatStrip aria-label="Records in this period">
          <Stat label="Events with a new best" value={recordRows.length} />
          <Stat label="Personal bests" value={recordRows.filter((row) => row.personalBest?.inRange).length} />
          <Stat label="Season bests" value={recordRows.filter((row) => row.seasonBest?.inRange).length} />
          <Stat label="Wind assisted" value={recordRows.filter((row) => row.windAssisted?.inRange).length} />
        </StatStrip>
      )}

      <Section
        title={active.title}
        hint={active.hint}
        meta={loading ? undefined : loadingRange ? "Updating..." : `${active.count} of ${active.total} ${active.noun}`}
        aria-label={active.title}
      >
        {loading ? (
          <SkeletonRows rows={4} leading label="Loading report" />
        ) : (data?.athleteCount ?? 0) === 0 ? (
          <EmptyState
            title="No athletes on your roster yet"
            body="Once athletes are on your team, their sessions, check-ins and records show up here."
            action={
              <LinkButton to="/coach/teams" size="sm">
                Go to teams
              </LinkButton>
            }
          />
        ) : active.total === 0 ? (
          <EmptyState
            title={report === "wellness" ? "No check-ins in this period" : report === "records" ? "No new bests in this period" : "No athletes"}
            body={`Nothing between ${rangeText}. Choose earlier dates to see more.`}
            action={
              <Button size="sm" onClick={() => setRange(reportRangeForLastDays(90, today))}>
                Show the last 90 days
              </Button>
            }
          />
        ) : active.count === 0 ? (
          <EmptyState
            title="Nothing matches these filters"
            body={`There are ${active.total} ${active.noun} in this period, but none fit the search${filtersActive && report !== "records" ? " and readiness filter" : ""}.`}
            action={
              <Button size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : report === "adherence" ? (
          <DataTable caption={`Plan adherence by athlete, ${rangeText}`} columns={adherenceColumns} rows={adherenceRows} rowKey={(row) => row.athleteId} />
        ) : report === "wellness" ? (
          <>
            <DataTable caption={`Wellness check-ins, ${rangeText}`} columns={wellnessColumns} rows={wellnessRows.slice(0, wellnessLimit)} rowKey={(row) => row.id} />
            {wellnessRows.length > wellnessLimit ? (
              <div className="-ml-2.5 mt-1 print:hidden">
                <Button variant="quiet" size="sm" onClick={() => setWellnessLimit(wellnessRows.length)}>
                  Show all {wellnessRows.length} check-ins
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <DataTable caption={`Personal and season bests set, ${rangeText}`} columns={recordColumns} rows={recordRows} rowKey={(row) => row.key} />
        )}
      </Section>
    </Screen>
  )
}
