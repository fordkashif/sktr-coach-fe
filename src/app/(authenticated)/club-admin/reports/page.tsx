import { useEffect, useMemo, useState } from "react"
import { DownloadSimple, Printer } from "@phosphor-icons/react"
import {
  Button,
  DataTable,
  DateRangeFields,
  EmptyState,
  Field,
  FilterChips,
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
import { describeAvailability } from "@/lib/data/athlete/availability-data"
import { insertAuditEvent } from "@/lib/data/club-admin/ops-data"
import {
  getClubReports,
  type ClubAdherenceRow,
  type ClubCompetitionRow,
  type ClubRecordsRow,
  type ClubReports,
  type ClubWellnessRow,
} from "@/lib/data/club-admin/reports-data"
import { pickableSeasons, type ClubSeason } from "@/lib/data/club-admin/season-logic"
import { listClubSeasons } from "@/lib/data/club-admin/seasons-data"
import { DEFAULT_REPORT_DAYS, describeReportRange, reportRangeForLastDays, type ReportMark, type ReportRange } from "@/lib/data/coach/reports-data"
import { markUnitLabel } from "@/lib/data/pr/marks"
import { averageAdherence, NO_SESSIONS_DUE } from "@/lib/data/session/adherence"
import { todayIso } from "@/lib/data/training-plan/plan-builder-model"
import { getBackendMode } from "@/lib/supabase/config"
import { csvFileName, downloadCsv } from "../ops-format"

type ReportKey = "teams" | "adherence" | "wellness" | "records" | "competitions"
type ReadinessFilter = "all" | "green" | "yellow" | "red"

const NO_TEAM = "__none__"
const READINESS_LABEL = { green: "Ready", yellow: "Watch", red: "Review" } as const
const PAGE = 60

type TeamSummary = {
  key: string
  name: string
  sub: string
  athletes: number
  adherence: number | null
  due: number
  done: number
  ready: number
  watch: number
  review: number
  checkedIn: number
  newBests: number
}

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

/** The club's reports: the coach reports across every team, plus a row per team and competition results. */
export default function ClubAdminReportsPage() {
  const isSupabaseMode = getBackendMode() === "supabase"
  const today = todayIso()
  const [range, setRange] = useState<ReportRange>(() => reportRangeForLastDays(DEFAULT_REPORT_DAYS))
  const [data, setData] = useState<ClubReports | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [loadingRange, setLoadingRange] = useState(true)
  const [report, setReport] = useState<ReportKey>("teams")
  const [search, setSearch] = useState("")
  const [teamFilter, setTeamFilter] = useState("all")
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>("all")
  const [limit, setLimit] = useState(PAGE)
  const [seasons, setSeasons] = useState<ClubSeason[]>([])

  useEffect(() => {
    let cancelled = false
    void listClubSeasons().then((result) => {
      if (!cancelled && result.ok) setSeasons(pickableSeasons(result.data))
    })
    return () => {
      cancelled = true
    }
  }, [])
  // One quick range per season that has started: the current season up to today, and each past season.
  const seasonPresets = seasons
    .filter((season) => season.start <= today)
    .map((season) => ({
      label: season.status === "current" ? `This season (${season.name})` : `${season.name} season`,
      range: { from: season.start, to: season.end < today ? season.end : today },
    }))

  useEffect(() => {
    let cancelled = false
    setLoadingRange(true)
    void getClubReports({ range }).then((result) => {
      if (cancelled) return
      setLoadingRange(false)
      if (!result.ok) return setError(result.error.message)
      setError(null)
      setData(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [range])

  const emitAudit = async (action: string, target: string, detail?: string) => {
    if (isSupabaseMode) {
      const result = await insertAuditEvent({ action, target, detail })
      setAuditError(result.ok ? null : result.error.message)
      return
    }
    const mockAudit = await import("@/lib/mock-audit")
    mockAudit.logAuditEvent({ actor: "club-admin", action, target, detail })
  }

  const teamById = useMemo(() => new Map((data?.teams ?? []).map((team) => [team.id, team])), [data])
  const teamKey = (teamId: string | null) => (teamId && teamById.has(teamId) ? teamId : NO_TEAM)
  const teamName = (teamId: string | null) => (teamId ? (teamById.get(teamId)?.name ?? "No team") : "No team")
  const hasUnassigned = (data?.adherence ?? []).some((row) => teamKey(row.teamId) === NO_TEAM)
  const inTeam = (teamId: string | null) => teamFilter === "all" || teamKey(teamId) === teamFilter

  const query = search.trim().toLowerCase()
  const matches = (...texts: Array<string | null | undefined>) => !query || texts.some((text) => (text ?? "").toLowerCase().includes(query))
  const readinessOk = (readiness: "green" | "yellow" | "red" | null) => readinessFilter === "all" || readiness === readinessFilter

  const teamSummaries: TeamSummary[] = useMemo(() => {
    if (!data) return []
    const keyOf = (teamId: string | null) => (teamId && data.teams.some((team) => team.id === teamId) ? teamId : NO_TEAM)
    const unassigned = data.adherence.some((row) => keyOf(row.teamId) === NO_TEAM)
    return [
      ...data.teams.map((team) => ({ key: team.id, name: team.name, sub: [team.eventGroup, team.leadCoach ? `Lead coach ${team.leadCoach}` : "No lead coach"].filter(Boolean).join(", ") })),
      ...(unassigned ? [{ key: NO_TEAM, name: "No team", sub: "Athletes not on a team" }] : []),
    ].map((team) => {
      const athletes = data.adherence.filter((row) => keyOf(row.teamId) === team.key)
      return {
        ...team,
        athletes: athletes.length,
        adherence: averageAdherence(athletes.map((row) => row.adherence)),
        due: athletes.reduce((sum, row) => sum + row.due, 0),
        done: athletes.reduce((sum, row) => sum + row.done, 0),
        ready: athletes.filter((row) => row.readiness === "green").length,
        watch: athletes.filter((row) => row.readiness === "yellow").length,
        review: athletes.filter((row) => row.readiness === "red").length,
        checkedIn: athletes.filter((row) => row.checkIns > 0).length,
        newBests: data.records.filter((row) => keyOf(row.teamId) === team.key).length,
      }
    })
  }, [data])

  const teamRows = teamSummaries.filter((team) => (teamFilter === "all" || team.key === teamFilter) && matches(team.name, team.sub))
  const adherenceRows = (data?.adherence ?? [])
    .filter((row) => inTeam(row.teamId) && matches(row.name, row.primaryEvent) && readinessOk(row.readiness))
    .sort((left, right) => (left.adherence ?? 101) - (right.adherence ?? 101) || left.name.localeCompare(right.name))
  const wellnessRows = (data?.wellness ?? []).filter((row) => inTeam(row.teamId) && matches(row.athleteName) && readinessOk(row.readiness))
  const recordRows = (data?.records ?? []).filter((row) => inTeam(row.teamId) && matches(row.athleteName, row.eventLabel))
  const competitionRows = (data?.competitions ?? []).filter((row) => inTeam(row.teamId) && matches(row.athleteName, row.eventLabel, row.competitionName))

  const hasReadiness = report === "adherence" || report === "wellness"
  const loading = data === null && !error
  const rangeText = describeReportRange(range)
  const teamLabel = teamFilter === "all" ? "All teams" : teamFilter === NO_TEAM ? "No team" : (teamById.get(teamFilter)?.name ?? "All teams")
  const filtersActive = Boolean(query) || teamFilter !== "all" || (hasReadiness && readinessFilter !== "all")
  const clearFilters = () => {
    setSearch("")
    setTeamFilter("all")
    setReadinessFilter("all")
  }

  /** Every export starts with the same three lines, so a file says what it is without its name. */
  const exportCsv = async (kind: ReportKey, slug: string, title: string, columns: string[], rows: Array<Array<string | number>>) => {
    const filename = csvFileName(teamFilter === "all" ? "club" : teamLabel, slug, range.from, "to", range.to)
    downloadCsv(filename, [["Report", title], ["Team", teamLabel], ["Period", `${range.from} to ${range.to}`], [], columns, ...rows])
    await emitAudit("export_csv", kind, `${filename}, ${rows.length} rows`)
  }

  const reports = {
    teams: {
      title: "Team summary",
      hint: "One row per team for this period. Readiness is from each athlete's latest check-in in the period.",
      count: teamRows.length,
      total: teamSummaries.length,
      noun: "teams",
      exportLabel: "Teams CSV",
      searchLabel: "Search team or coach",
      searchPlaceholder: "Team or coach",
      onExport: () =>
        exportCsv(
          "teams",
          "teams",
          "Team summary",
          ["Team", "Detail", "Athletes", "Average plan adherence (%)", "Sessions due", "Sessions done", "Ready", "Watch", "Review", "Athletes who checked in", "Events with a new best"],
          teamRows.map((team) => [team.name, team.sub, team.athletes, team.adherence === null ? NO_SESSIONS_DUE : team.adherence, team.due, team.done, team.ready, team.watch, team.review, team.checkedIn, team.newBests]),
        ),
    },
    adherence: {
      title: "Plan adherence",
      hint: "Sessions done out of sessions due in this period. Lowest first, so you can see where to follow up.",
      count: adherenceRows.length,
      total: data?.adherence.length ?? 0,
      noun: "athletes",
      exportLabel: "Adherence CSV",
      searchLabel: "Search athlete",
      searchPlaceholder: "Name or event",
      onExport: () =>
        exportCsv(
          "adherence",
          "adherence",
          "Plan adherence",
          ["Athlete", "Team", "Event group", "Primary event", "Sessions due", "Sessions done", "Excused", "Plan adherence (%)", "Readiness", "Last check-in", "Availability"],
          adherenceRows.map((row) => [
            row.name,
            teamName(row.teamId),
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
      searchLabel: "Search athlete",
      searchPlaceholder: "Name",
      onExport: () =>
        exportCsv(
          "wellness",
          "wellness",
          "Wellness check-ins",
          ["Athlete", "Team", "Date", "Sleep (hours)", "Soreness (1-5)", "Fatigue (1-5)", "Mood (1-5)", "Stress (1-5)", "Readiness", "Notes"],
          wellnessRows.map((row) => [row.athleteName, teamName(row.teamId), row.date, row.sleep, row.soreness, row.fatigue, row.mood, row.stress, READINESS_LABEL[row.readiness], row.notes ?? ""]),
        ),
    },
    records: {
      title: "Records",
      hint: "Events where a best was set in this period, with the athlete's personal best and season best. Wind assisted marks (w) never count as records.",
      count: recordRows.length,
      total: data?.records.length ?? 0,
      noun: "events",
      exportLabel: "Records CSV",
      searchLabel: "Search athlete or event",
      searchPlaceholder: "Name or event",
      onExport: () =>
        exportCsv(
          "records",
          "records",
          "Records",
          ["Athlete", "Team", "Event", "Personal best", "Personal best date", "Season best", "Season best date", "Wind assisted best", "Wind assisted date"],
          recordRows.map((row) => [
            row.athleteName,
            teamName(row.teamId),
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
    competitions: {
      title: "Competition results",
      hint: "Every result entered for a meet in this period, newest meet first. A mark with too much following wind is shown with a w.",
      count: competitionRows.length,
      total: data?.competitions.length ?? 0,
      noun: "results",
      exportLabel: "Competitions CSV",
      searchLabel: "Search athlete, event or meet",
      searchPlaceholder: "Name, event or meet",
      onExport: () =>
        exportCsv(
          "competitions",
          "competitions",
          "Competition results",
          ["Competition", "Date", "Athlete", "Team", "Event", "Mark", "Wind", "Wind legal", "Place"],
          competitionRows.map((row) => [
            row.competitionName,
            row.date,
            row.athleteName,
            teamName(row.teamId),
            row.eventLabel,
            `${row.display}${markUnitLabel(row.display, row.unit)}`,
            row.wind,
            row.windLegal ? "Yes" : "No",
            row.place ?? "",
          ]),
        ),
    },
  }
  const active = reports[report]

  const athleteCell = (athleteId: string, name: string, sub?: string) => (
    <span className="flex items-center gap-3">
      <PersonAvatar name={name} athleteId={athleteId} size="sm" />
      <span className="min-w-0">
        {name}
        {sub ? <TableSub>{sub}</TableSub> : null}
      </span>
    </span>
  )

  const teamColumns: Array<DataTableColumn<TeamSummary>> = [
    {
      key: "team",
      header: "Team",
      cell: (team) => (
        <>
          {team.name}
          <TableSub>{team.sub}</TableSub>
        </>
      ),
    },
    { key: "athletes", header: "Athletes", align: "right", cell: (team) => team.athletes },
    {
      key: "readiness",
      header: "Readiness",
      phone: "plain",
      cell: (team) =>
        team.ready + team.watch + team.review === 0 ? (
          <span className="text-sk-mute">No check-ins</span>
        ) : (
          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
            {team.ready > 0 ? <StatusText tone="green">{team.ready} ready</StatusText> : null}
            {team.watch > 0 ? <StatusText tone="amber">{team.watch} watch</StatusText> : null}
            {team.review > 0 ? <StatusText tone="coral">{team.review} review</StatusText> : null}
          </span>
        ),
    },
    { key: "checked", header: "Checked in", align: "right", cell: (team) => `${team.checkedIn} of ${team.athletes}` },
    { key: "sessions", header: "Sessions", align: "right", cell: (team) => (team.due === 0 ? "None due" : `${team.done} of ${team.due}`) },
    { key: "bests", header: "New bests", align: "right", cell: (team) => team.newBests },
    {
      key: "adherence",
      header: "Adherence",
      align: "right",
      strong: true,
      phone: "trailing",
      cell: (team) => (team.adherence === null ? <span className="font-normal text-sk-mute">{NO_SESSIONS_DUE}</span> : `${team.adherence}%`),
    },
  ]

  const adherenceColumns: Array<DataTableColumn<ClubAdherenceRow>> = [
    { key: "athlete", header: "Athlete", cell: (row) => athleteCell(row.athleteId, row.name, row.primaryEvent) },
    { key: "team", header: "Team", cell: (row) => teamName(row.teamId) },
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

  const wellnessColumns: Array<DataTableColumn<ClubWellnessRow>> = [
    { key: "athlete", header: "Athlete", cell: (row) => athleteCell(row.athleteId, row.athleteName, `${shortDay(row.date)}, ${teamName(row.teamId)}`) },
    { key: "readiness", header: "Readiness", phone: "trailing", cell: (row) => <ReadinessText status={row.readiness} /> },
    { key: "sleep", header: "Sleep (h)", align: "right", strong: true, cell: (row) => row.sleep },
    { key: "soreness", header: "Soreness", align: "right", cell: (row) => row.soreness },
    { key: "fatigue", header: "Fatigue", align: "right", cell: (row) => row.fatigue },
    { key: "mood", header: "Mood", align: "right", cell: (row) => row.mood },
    { key: "stress", header: "Stress", align: "right", cell: (row) => row.stress },
    { key: "notes", header: "Notes", className: "max-w-[16rem]", cell: (row) => row.notes ?? "" },
  ]

  const recordColumns: Array<DataTableColumn<ClubRecordsRow>> = [
    { key: "athlete", header: "Athlete", cell: (row) => athleteCell(row.athleteId, row.athleteName, `${row.eventLabel}, ${teamName(row.teamId)}`) },
    { key: "pb", header: "Personal best", align: "right", cell: (row) => <BestCell mark={row.personalBest} /> },
    { key: "sb", header: "Season best", align: "right", cell: (row) => <BestCell mark={row.seasonBest} /> },
    { key: "wa", header: "Wind assisted", align: "right", cell: (row) => <BestCell mark={row.windAssisted} assisted /> },
  ]

  const competitionColumns: Array<DataTableColumn<ClubCompetitionRow>> = [
    { key: "athlete", header: "Athlete", cell: (row) => athleteCell(row.athleteId, row.athleteName, row.eventLabel) },
    { key: "meet", header: "Competition", phone: "plain", cell: (row) => row.competitionName },
    { key: "team", header: "Team", cell: (row) => teamName(row.teamId) },
    { key: "date", header: "Date", cell: (row) => shortDay(row.date) },
    { key: "place", header: "Place", align: "right", cell: (row) => row.place ?? <span className="text-sk-faint">-</span> },
    {
      key: "mark",
      header: "Mark",
      align: "right",
      phone: "trailing",
      cell: (row) => (
        <Mark size="sm" value={row.display} unit={markUnitLabel(row.display, row.unit).trim() || undefined} qualifier={row.wind ? `${row.wind}${row.windLegal ? "" : " w"}` : row.windLegal ? undefined : "w"} />
      ),
    },
  ]

  const dueTotal = adherenceRows.reduce((sum, row) => sum + row.due, 0)
  const doneTotal = adherenceRows.reduce((sum, row) => sum + row.done, 0)
  const adherenceAverage = averageAdherence(adherenceRows.map((row) => row.adherence))
  const clubAdherence = averageAdherence((data?.adherence ?? []).filter((row) => inTeam(row.teamId)).map((row) => row.adherence))
  const athletesInScope = (data?.adherence ?? []).filter((row) => inTeam(row.teamId)).length

  const showMore = (rows: number, noun: string) =>
    rows > limit ? (
      <div className="-ml-2.5 mt-1 print:hidden">
        <Button variant="quiet" size="sm" onClick={() => setLimit(rows)}>
          Show all {rows.toLocaleString()} {noun}
        </Button>
      </div>
    ) : null

  return (
    <Screen>
      <ScreenHeader
        title="Reports"
        lede={`${teamLabel}, ${rangeText}. What you see in the table is what you download.`}
        actions={
          <span className="contents print:hidden">
            <Button
              onClick={() => {
                window.print()
                void emitAudit("export_pdf", report === "teams" ? "teams" : report, active.title)
              }}
            >
              <Printer className="size-5" weight="bold" aria-hidden />
              Print / PDF
            </Button>
            <Button variant="primary" onClick={() => void active.onExport()} disabled={!data || active.count === 0}>
              <DownloadSimple className="size-5" weight="bold" aria-hidden />
              {active.exportLabel}
            </Button>
          </span>
        }
      />

      {error ? <Notice tone="error">We could not load the club reports. {error}</Notice> : null}
      {auditError ? <Notice tone="warning">Your file downloaded, but we could not add the export to the activity log. {auditError}</Notice> : null}
      {data && !data.complete ? <Notice tone="warning">This club has more history in this period than we can count here, so some figures may be understated. Choose a shorter period for exact numbers.</Notice> : null}
      {data?.competitionsError && report === "competitions" ? <Notice tone="error">We could not load competition results. {data.competitionsError}</Notice> : null}

      <Tabs<ReportKey>
        label="Choose a report"
        className="print:hidden"
        value={report}
        onChange={(next) => {
          setReport(next)
          setLimit(PAGE)
        }}
        options={[
          { value: "teams", label: "Teams" },
          { value: "adherence", label: "Adherence" },
          { value: "wellness", label: "Wellness" },
          { value: "records", label: "Records" },
          { value: "competitions", label: "Competitions" },
        ]}
      />

      <FormGrid columns={4} className="items-start print:hidden">
        <DateRangeFields
          className="sm:col-span-2"
          value={range}
          max={today}
          onChange={(next) => {
            setRange(next)
            setLimit(PAGE)
          }}
          presets={[
            { label: "Last 28 days", range: reportRangeForLastDays(28, today) },
            { label: "Last 90 days", range: reportRangeForLastDays(90, today) },
            { label: "This year", range: { from: `${today.slice(0, 4)}-01-01`, to: today } },
            ...seasonPresets,
          ]}
        />
        <Field label={active.searchLabel}>
          <SearchInput placeholder={active.searchPlaceholder} value={search} onChange={(event) => setSearch(event.target.value)} />
        </Field>
        <Field label="Team">
          <Select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
            <option value="all">All teams</option>
            {(data?.teams ?? []).map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
            {hasUnassigned ? <option value={NO_TEAM}>No team</option> : null}
          </Select>
        </Field>
      </FormGrid>

      {hasReadiness ? (
        <FilterChips<ReadinessFilter>
          className="print:hidden"
          label="Readiness"
          value={readinessFilter}
          onChange={setReadinessFilter}
          options={[
            { value: "all", label: "All" },
            { value: "green", label: "Ready" },
            { value: "yellow", label: "Watch" },
            { value: "red", label: "Review" },
          ]}
        />
      ) : null}

      {report === "teams" ? (
        <StatStrip aria-label="The club in this period">
          <Stat label="Teams" value={teamRows.filter((team) => team.key !== NO_TEAM).length} />
          <Stat label="Athletes" value={athletesInScope} />
          {clubAdherence === null ? <Stat label="Average adherence" value="None" hint={NO_SESSIONS_DUE} /> : <Stat label="Average adherence" value={clubAdherence} unit="%" />}
          <Stat label="Events with a new best" value={(data?.records ?? []).filter((row) => inTeam(row.teamId)).length} />
        </StatStrip>
      ) : report === "adherence" ? (
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
          <Stat label="Athletes checking in" value={new Set(wellnessRows.map((row) => row.athleteId)).size} of={athletesInScope} />
        </StatStrip>
      ) : report === "records" ? (
        <StatStrip aria-label="Records in this period">
          <Stat label="Events with a new best" value={recordRows.length} />
          <Stat label="Personal bests" value={recordRows.filter((row) => row.personalBest?.inRange).length} />
          <Stat label="Season bests" value={recordRows.filter((row) => row.seasonBest?.inRange).length} />
          <Stat label="Wind assisted" value={recordRows.filter((row) => row.windAssisted?.inRange).length} />
        </StatStrip>
      ) : (
        <StatStrip aria-label="Competition results in this period">
          <Stat label="Results" value={competitionRows.length} />
          <Stat label="Competitions" value={new Set(competitionRows.map((row) => row.competitionId)).size} />
          <Stat label="Athletes competing" value={new Set(competitionRows.map((row) => row.athleteId)).size} />
          <Stat label="Podium places" value={competitionRows.filter((row) => row.place !== null && row.place <= 3).length} />
        </StatStrip>
      )}

      <Section
        title={active.title}
        hint={active.hint}
        meta={loading ? undefined : loadingRange ? "Updating..." : `${active.count.toLocaleString()} of ${active.total.toLocaleString()} ${active.noun}`}
        aria-label={active.title}
      >
        {loading ? (
          <SkeletonRows rows={4} leading={report !== "teams"} label="Loading report" />
        ) : !data ? null : data.teams.length === 0 && data.athleteCount === 0 ? (
          <EmptyState
            title="No teams yet"
            body="Create a team and add athletes. Their sessions, check-ins, records and competition results show up here."
            action={
              <LinkButton to="/club-admin/teams" size="sm">
                Go to teams
              </LinkButton>
            }
          />
        ) : active.total === 0 ? (
          <EmptyState
            title={
              report === "wellness"
                ? "No check-ins in this period"
                : report === "records"
                  ? "No new bests in this period"
                  : report === "competitions"
                    ? "No competition results in this period"
                    : report === "teams"
                      ? "No teams yet"
                      : "No athletes yet"
            }
            body={report === "teams" || report === "adherence" ? "Once athletes are on a team they are listed here." : `Nothing between ${rangeText}. Choose earlier dates to see more.`}
            action={
              report === "teams" || report === "adherence" ? (
                <LinkButton to="/club-admin/teams" size="sm">
                  Go to teams
                </LinkButton>
              ) : (
                <Button size="sm" onClick={() => setRange(reportRangeForLastDays(90, today))}>
                  Show the last 90 days
                </Button>
              )
            }
          />
        ) : active.count === 0 ? (
          <EmptyState
            title="Nothing matches these filters"
            body={`There are ${active.total.toLocaleString()} ${active.noun} in this period, but none fit the ${filtersActive ? "search and filters" : "search"}.`}
            action={
              <Button size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : report === "teams" ? (
          <DataTable caption={`Team summary, ${rangeText}`} columns={teamColumns} rows={teamRows} rowKey={(team) => team.key} />
        ) : report === "adherence" ? (
          <>
            <DataTable caption={`Plan adherence by athlete, ${rangeText}`} columns={adherenceColumns} rows={adherenceRows.slice(0, limit)} rowKey={(row) => row.athleteId} />
            {showMore(adherenceRows.length, "athletes")}
          </>
        ) : report === "wellness" ? (
          <>
            <DataTable caption={`Wellness check-ins, ${rangeText}`} columns={wellnessColumns} rows={wellnessRows.slice(0, limit)} rowKey={(row) => row.id} />
            {showMore(wellnessRows.length, "check-ins")}
          </>
        ) : report === "records" ? (
          <>
            <DataTable caption={`Personal and season bests set, ${rangeText}`} columns={recordColumns} rows={recordRows.slice(0, limit)} rowKey={(row) => row.key} />
            {showMore(recordRows.length, "events")}
          </>
        ) : (
          <>
            <DataTable caption={`Competition results, ${rangeText}`} columns={competitionColumns} rows={competitionRows.slice(0, limit)} rowKey={(row) => row.key} />
            {showMore(competitionRows.length, "results")}
          </>
        )}
      </Section>
    </Screen>
  )
}
