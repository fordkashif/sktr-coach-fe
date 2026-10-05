"use client"

import { useEffect, useId, useMemo, useState, type ReactNode } from "react"
import {
  ArrowDown,
  ArrowUp,
  ChatText,
  ClipboardText,
  Heartbeat,
  Minus,
  PencilSimple,
  Timer,
  Trophy,
  UsersThree,
} from "@phosphor-icons/react"
import { LineChart } from "@mui/x-charts"
import { Link } from "react-router-dom"
import { EmptyState, Initials, PageHeader, Panel, ReadinessTag, Segmented, Stat, Tag, type TagTone, type Tone } from "@/components/sk"
import {
  type Athlete,
  type LogEntry,
  type PR,
  type TestWeekResult,
  type TrendPoint,
  type WellnessEntry,
} from "@/lib/mock-data"

const logTypes = ["All", "Strength", "Run", "Splits", "Jumps", "Throws"] as const
type LogTypeFilter = (typeof logTypes)[number]

const dateRanges = ["All time", "Last 30 days", "Last 7 days"] as const

const ROW_LIMIT = 6

const chartSx = {
  "& .MuiChartsAxis-line, & .MuiChartsAxis-tick": { stroke: "transparent" },
  "& .MuiChartsAxis-tickLabel": { fill: "#6a7385", fontSize: 12, fontFamily: "inherit", fontWeight: 600 },
  "& .MuiChartsGrid-line": { stroke: "#e3e6ee" },
  "& .MuiMarkElement-root": { strokeWidth: 2, fill: "#ffffff" },
  "& .MuiLineElement-root": { strokeLinecap: "round", strokeWidth: 3 },
  "& .MuiChartsLegend-root, & .MuiChartsLegend-label": { fontFamily: "inherit", fontWeight: 600, color: "#3a4252" },
}

const ageGroupFor = (age: number) => {
  if (age <= 18) return "U20"
  if (age <= 22) return "U23"
  return "Senior"
}

/** Date-only strings are parsed as local days so a check-in never shows up a day early. */
function parseDay(value: string): Date | null {
  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const parsed = dayOnly ? new Date(Number(dayOnly[1]), Number(dayOnly[2]) - 1, Number(dayOnly[3])) : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDay(value: string, withYear = false) {
  const parsed = parseDay(value)
  if (!parsed) return value
  const sameYear = parsed.getFullYear() === new Date().getFullYear()
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(withYear || !sameYear ? { year: "numeric" } : {}),
  })
}

function ageFromDateOfBirth(value: string | null | undefined) {
  if (!value) return null
  const born = parseDay(value)
  if (!born) return null
  const today = new Date()
  let age = today.getFullYear() - born.getFullYear()
  const hadBirthday =
    today.getMonth() > born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() >= born.getDate())
  if (!hadBirthday) age -= 1
  return age > 0 && age < 120 ? age : null
}

type SessionStatus = "scheduled" | "in-progress" | "completed"

/** A session row. Mock logs only carry the base LogEntry fields; the backend adds the rest. */
export type AthleteDetailLog = LogEntry & {
  isoDate?: string
  status?: SessionStatus
  coachNote?: string | null
  completedOn?: string | null
  durationMinutes?: number | null
}

export type AthleteDetailWellness = WellnessEntry & {
  readinessScore?: number
  trainingLoad?: number
}

export type AthleteDetailPr = PR & {
  isoDate?: string
  note?: string | null
  source?: "manual" | "test-week" | "import"
}

export type AthleteDetailTest = {
  id: string
  testName: string
  value: string
  previousValue: string | null
  change: "up" | "down" | "same" | null
  submittedAt?: string
  testWeekName?: string | null
}

export type AthleteDetailData = {
  prs: AthleteDetailPr[]
  logs: AthleteDetailLog[]
  testWeek: TestWeekResult | null
  trend: TrendPoint[]
  /** Full check-ins, newest first. When present the chart and table are built from these. */
  wellness?: AthleteDetailWellness[]
  /** Latest result per test, with the one before it. When present it replaces `testWeek`. */
  tests?: AthleteDetailTest[]
  dateOfBirth?: string | null
  /** False when the backend has neither a check-in nor a readiness flag for this athlete. Defaults to true. */
  hasReadiness?: boolean
}

type CoachAthleteDetailContentProps = {
  athlete: Athlete
  data?: AthleteDetailData
  teamName?: string
  banner?: ReactNode
  /** Saves the coach note on a session. Resolves with an error message, or null when saved. */
  onSaveSessionNote?: (sessionId: string, note: string) => Promise<string | null>
}

function Change({ change }: { change: "up" | "down" | "same" | null | undefined }) {
  if (change === "up") {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-bold text-[#07673f]">
        <ArrowUp className="size-4" weight="bold" aria-hidden />
        Improved
      </span>
    )
  }
  if (change === "down") {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-bold text-[#b32a0c]">
        <ArrowDown className="size-4" weight="bold" aria-hidden />
        Dropped
      </span>
    )
  }
  if (change === "same") {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-sk-mute">
        <Minus className="size-4" weight="bold" aria-hidden />
        No change
      </span>
    )
  }
  return null
}

function sessionState(log: AthleteDetailLog): { label: string; tone: TagTone } | null {
  if (!log.status) return null
  if (log.status === "completed") return { label: "Done", tone: "green" }
  if (log.status === "in-progress") return { label: "In progress", tone: "blue" }
  const day = log.isoDate ? parseDay(log.isoDate) : null
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  if (day && day < startOfToday) return { label: "Not done", tone: "coral" }
  return { label: "Scheduled", tone: "plain" }
}

function ShowAllButton({ expanded, total, noun, onToggle }: { expanded: boolean; total: number; noun: string; onToggle: () => void }) {
  return (
    <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm mt-3" aria-expanded={expanded} onClick={onToggle}>
      {expanded ? "Show fewer" : `Show all ${total} ${noun}`}
    </button>
  )
}

export function CoachAthleteDetailContent({ athlete, data, teamName, banner, onSaveSessionNote }: CoachAthleteDetailContentProps) {
  const [logType, setLogType] = useState<LogTypeFilter>("All")
  const [dateRange, setDateRange] = useState<string>("All time")
  const [showAllSessions, setShowAllSessions] = useState(false)
  const [showAllWellness, setShowAllWellness] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState("")
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const filterId = useId()
  const [mockData, setMockData] = useState<{
    logs: LogEntry[]
    prs: PR[]
    tests: TestWeekResult[]
    trendSeries: Record<string, TrendPoint[]>
    wellness: WellnessEntry[]
  }>({ logs: [], prs: [], tests: [], trendSeries: {}, wellness: [] })

  useEffect(() => {
    ;(window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }).__PACELAB_MOBILE_DETAIL_MODE = true
    window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: true } }))
    return () => {
      ;(window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }).__PACELAB_MOBILE_DETAIL_MODE = false
      window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: false } }))
    }
  }, [])

  useEffect(() => {
    if (data) return
    let cancelled = false

    void import("@/lib/mock-data").then((module) => {
      if (!cancelled) {
        setMockData({
          logs: module.mockLogs,
          prs: module.mockPRs,
          tests: module.mockTestWeekResults,
          trendSeries: module.mockTrendSeries,
          wellness: module.mockWellness,
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [data])

  const isBackend = Boolean(data)
  const athletePrs: AthleteDetailPr[] = data?.prs ?? mockData.prs.filter((pr) => pr.athleteId === athlete.id)
  const athleteLogs: AthleteDetailLog[] = useMemo(
    () => data?.logs ?? mockData.logs.filter((log) => log.athleteId === athlete.id),
    [athlete.id, data?.logs, mockData.logs],
  )

  const filteredLogs = useMemo(() => {
    const days = dateRange === "Last 7 days" ? 7 : dateRange === "Last 30 days" ? 30 : null
    const cutoff = days === null ? null : Date.now() - days * 24 * 60 * 60 * 1000
    return athleteLogs.filter((log) => {
      if (logType !== "All" && log.type !== logType) return false
      if (cutoff === null) return true
      const day = parseDay(log.isoDate ?? log.date)
      return day ? day.getTime() >= cutoff : false
    })
  }, [athleteLogs, dateRange, logType])

  const testWeek = data?.testWeek ?? mockData.tests.find((row) => row.athleteId === athlete.id) ?? null
  const trend = data?.trend ?? mockData.trendSeries[athlete.id] ?? []
  const wellnessRows: AthleteDetailWellness[] =
    data?.wellness ?? (data ? [] : mockData.wellness.filter((entry) => entry.athleteId === athlete.id))

  // Chart points, oldest first. Backend check-ins carry their own score and load; mock uses the trend series.
  const scoredWellness = wellnessRows.filter((entry) => typeof entry.readinessScore === "number")
  const chartPoints =
    scoredWellness.length > 0
      ? [...scoredWellness]
          .reverse()
          .slice(-14)
          .map((entry) => ({ date: entry.date, readiness: entry.readinessScore ?? 0, load: entry.trainingLoad ?? 0 }))
      : trend.map((point) => ({ date: point.date, readiness: point.readiness, load: point.trainingLoad }))
  // Only the mock trend series has fatigue on a 0 to 100 scale. Backend fatigue is 1 to 5 and lives in the table.
  const showFatigueLine = !isBackend && scoredWellness.length === 0 && trend.length > 0
  const latestPoint = chartPoints.at(-1)

  const testRows: AthleteDetailTest[] =
    data?.tests ??
    (testWeek
      ? [
          { label: "30m", result: testWeek.thirtyM },
          { label: "Flying 30m", result: testWeek.flyingThirtyM },
          { label: "150m", result: testWeek.oneHundredFiftyM },
          { label: "Squat 1RM", result: testWeek.squat1RM },
          { label: "CMJ", result: testWeek.cmj },
        ]
          .filter((item) => item.result)
          .map((item) => ({
            id: item.label,
            testName: item.label,
            value: item.result?.value ?? "",
            previousValue: null,
            change: item.result?.change ?? null,
          }))
      : [])

  // Adherence: sessions due in the last 28 days that were done. Mock athletes carry a ready-made figure.
  const datedLogs = athleteLogs.filter((log) => log.status && log.isoDate)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const windowStart = startOfToday.getTime() - 27 * 24 * 60 * 60 * 1000
  const dueLogs = datedLogs.filter((log) => {
    const day = parseDay(log.isoDate as string)
    return day ? day.getTime() >= windowStart && day.getTime() <= startOfToday.getTime() : false
  })
  const doneCount = dueLogs.filter((log) => log.status === "completed").length
  const adherence = isBackend ? (dueLogs.length > 0 ? Math.round((doneCount / dueLogs.length) * 100) : null) : athlete.adherence

  const age = isBackend ? ageFromDateOfBirth(data?.dateOfBirth) : athlete.age > 0 ? athlete.age : null
  const ledeParts = [athlete.primaryEvent, teamName ?? `${athlete.eventGroup} group`, age ? ageGroupFor(age) : null].filter(Boolean)
  const lastCheckIn = wellnessRows[0]?.date ?? latestPoint?.date ?? null
  const readinessKnown = data?.hasReadiness ?? true
  const readinessLabel = athlete.readiness === "green" ? "Ready" : athlete.readiness === "yellow" ? "Watch" : "Review"
  const readinessTone: Tone = athlete.readiness === "green" ? "green" : athlete.readiness === "yellow" ? "yellow" : "coral"

  const visibleLogs = showAllSessions ? filteredLogs : filteredLogs.slice(0, ROW_LIMIT)
  const visibleWellness = showAllWellness ? wellnessRows : wellnessRows.slice(0, ROW_LIMIT)
  const filtersActive = logType !== "All" || dateRange !== "All time"

  const startEditingNote = (log: AthleteDetailLog) => {
    setEditingNoteId(log.id)
    setNoteDraft(log.coachNote ?? "")
    setNoteError(null)
  }

  const saveNote = async (sessionId: string) => {
    if (!onSaveSessionNote) return
    setNoteSaving(true)
    setNoteError(null)
    const failure = await onSaveSessionNote(sessionId, noteDraft)
    setNoteSaving(false)
    if (failure) {
      setNoteError(failure)
      return
    }
    setEditingNoteId(null)
  }

  return (
    <div className="sk-page">
      {banner}

      <PageHeader
        title={
          <span className="flex items-center gap-3 sm:gap-4">
            <Initials name={athlete.name} size="lg" />
            <span className="min-w-0">{athlete.name}</span>
          </span>
        }
        lede={ledeParts.join(", ")}
        actions={
          <Link to={`/coach/teams/${athlete.teamId}`} className="sk-btn sk-btn-quiet">
            <UsersThree className="size-5" weight="bold" />
            Team roster
          </Link>
        }
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {readinessKnown ? <ReadinessTag status={athlete.readiness} /> : <Tag>No readiness yet</Tag>}
          <span className="text-sm font-semibold text-sk-mute">
            {lastCheckIn ? `Last check-in ${formatDay(lastCheckIn)}` : isBackend ? "No check-ins yet" : `Last check-in ${athlete.lastWellness}`}
          </span>
        </div>
      </PageHeader>

      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {latestPoint ? (
          <Stat tone={readinessTone} label="Readiness" value={latestPoint.readiness} unit="/100" hint={`Checked in ${formatDay(latestPoint.date)}`} />
        ) : readinessKnown ? (
          <Stat
            tone={readinessTone}
            label="Readiness"
            value={readinessLabel}
            hint={isBackend ? "Set on the roster, no check-ins yet" : `Last check-in ${athlete.lastWellness}`}
          />
        ) : (
          <Stat tone="plain" label="Readiness" value="None" hint="No check-ins yet" />
        )}
        {adherence === null ? (
          <Stat tone="plain" label="Plan adherence" value="None" hint="No sessions due in the last 28 days" />
        ) : (
          <Stat
            tone="blue"
            label="Plan adherence"
            value={adherence}
            unit="%"
            hint={isBackend ? `${doneCount} of ${dueLogs.length} sessions, last 28 days` : "Of planned sessions"}
          />
        )}
        <Stat
          tone="plain"
          label={isBackend ? "Sessions on record" : "Sessions logged"}
          value={athleteLogs.length}
          hint={athleteLogs[0] ? `Latest: ${athleteLogs[0].title}` : "None yet"}
        />
        <Stat tone="yellow" label="Personal records" value={athletePrs.length} hint={athletePrs[0] ? `Latest: ${athletePrs[0].event}` : "None yet"} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Wellness" hint="Readiness and training load from daily check-ins." className="min-w-0">
          {chartPoints.length === 0 && wellnessRows.length === 0 ? (
            <EmptyState
              icon={<Heartbeat className="size-6" weight="fill" />}
              title="No check-ins yet"
              body={`When ${athlete.name.split(" ")[0]} fills in a daily wellness check-in, sleep, soreness, fatigue, mood and stress show up here.`}
              className="border-0 bg-sk-canvas"
            />
          ) : null}

          {chartPoints.length > 1 ? (
            <div className="-mx-2 overflow-hidden">
              <LineChart
                xAxis={[{ scaleType: "point", data: chartPoints.map((point) => formatDay(point.date)), disableLine: true, disableTicks: true }]}
                yAxis={[{ min: 0, max: 100, width: 36, disableLine: true, disableTicks: true }]}
                series={[
                  { data: chartPoints.map((point) => point.readiness), label: "Readiness", color: "#2152ff", curve: "monotoneX" },
                  { data: chartPoints.map((point) => point.load), label: "Training load", color: "#0e1320", curve: "monotoneX" },
                  ...(showFatigueLine
                    ? [{ data: trend.map((point) => point.fatigue), label: "Fatigue", color: "#ff5c39", curve: "monotoneX" as const }]
                    : []),
                ]}
                grid={{ horizontal: true }}
                margin={{ left: 0, right: 32, top: 12, bottom: 0 }}
                height={260}
                sx={chartSx}
              />
            </div>
          ) : null}

          {wellnessRows.length > 0 ? (
            <>
              <h3 className="sk-h3 mt-5">Recent check-ins</h3>
              <p className="mt-0.5 text-sm text-sk-mute">Soreness, fatigue, mood and stress are scored 1 to 5.</p>
              <div className="-mx-5 mt-3 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-sk-line text-sk-mute">
                      <th scope="col" className="py-2.5 pr-4 font-semibold">Date</th>
                      <th scope="col" className="py-2.5 pr-4 font-semibold">Readiness</th>
                      <th scope="col" className="py-2.5 pr-4 text-right font-semibold">Sleep</th>
                      <th scope="col" className="py-2.5 pr-4 text-right font-semibold">Soreness</th>
                      <th scope="col" className="py-2.5 pr-4 text-right font-semibold">Fatigue</th>
                      <th scope="col" className="py-2.5 pr-4 text-right font-semibold">Mood</th>
                      <th scope="col" className="py-2.5 text-right font-semibold">Stress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleWellness.map((entry) => (
                      <tr key={entry.id} className="border-b border-sk-line align-top last:border-b-0">
                        <th scope="row" className="py-3 pr-4 font-bold whitespace-nowrap text-sk-ink">
                          {formatDay(entry.date)}
                          {entry.notes ? (
                            <span className="mt-1 flex max-w-[30ch] items-start gap-1.5 font-normal whitespace-normal text-sk-ink-2">
                              <ChatText className="mt-0.5 size-4 shrink-0 text-sk-mute" weight="bold" aria-hidden />
                              <span>{entry.notes}</span>
                            </span>
                          ) : null}
                        </th>
                        <td className="py-3 pr-4">
                          <span className="flex items-center gap-2">
                            <ReadinessTag status={entry.readiness} />
                            {typeof entry.readinessScore === "number" ? (
                              <span className="font-bold tabular-nums text-sk-ink">{entry.readinessScore}</span>
                            ) : null}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-right font-semibold tabular-nums text-sk-ink">{entry.sleep}h</td>
                        <td className="py-3 pr-4 text-right font-semibold tabular-nums text-sk-ink">{entry.soreness}</td>
                        <td className="py-3 pr-4 text-right font-semibold tabular-nums text-sk-ink">{entry.fatigue}</td>
                        <td className="py-3 pr-4 text-right font-semibold tabular-nums text-sk-ink">{entry.mood}</td>
                        <td className="py-3 text-right font-semibold tabular-nums text-sk-ink">{entry.stress}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {wellnessRows.length > ROW_LIMIT ? (
                <ShowAllButton
                  expanded={showAllWellness}
                  total={wellnessRows.length}
                  noun="check-ins"
                  onToggle={() => setShowAllWellness((current) => !current)}
                />
              ) : null}
            </>
          ) : null}
        </Panel>

        <Panel title="Test results" hint="Latest result for each test." className="min-w-0">
          {testRows.length > 0 ? (
            <ul>
              {testRows.map((row) => (
                <li key={row.id} className="sk-row">
                  <div className="min-w-0">
                    <p className="font-bold text-sk-ink">{row.testName}</p>
                    {row.submittedAt || row.testWeekName ? (
                      <p className="text-sm text-sk-mute">
                        {[row.testWeekName, row.submittedAt ? formatDay(row.submittedAt) : null].filter(Boolean).join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="sk-num text-2xl">{row.value}</p>
                    <div className="mt-1 flex items-center justify-end gap-2">
                      {row.previousValue ? <span className="text-sm text-sk-mute">was {row.previousValue}</span> : null}
                      <Change change={row.change} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<Timer className="size-6" weight="fill" />}
              title="No test results yet"
              body="Results show up here once this athlete submits a test week."
              action={
                <Link to="/coach/test-week" className="sk-btn sk-btn-quiet sk-btn-sm">
                  Open test weeks
                </Link>
              }
              className="border-0 bg-sk-canvas"
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel
          title="Session history"
          hint={
            isBackend
              ? onSaveSessionNote
                ? "Planned and completed sessions. Notes you add are shown to the athlete in that session."
                : "Planned and completed sessions."
              : "What this athlete has logged."
          }
          className="min-w-0"
        >
          {athleteLogs.length > 0 ? (
            <>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <Segmented
                  label="Session type"
                  value={logType}
                  onChange={setLogType}
                  options={logTypes.map((type) => ({ value: type, label: type }))}
                  className="hidden md:inline-flex"
                />
                <div className="grid grid-cols-2 gap-3 md:block">
                  <div className="md:hidden">
                    <label htmlFor={`${filterId}-type`} className="sk-label mb-1.5 block">
                      Session type
                    </label>
                    <select
                      id={`${filterId}-type`}
                      className="sk-field"
                      value={logType}
                      onChange={(event) => setLogType(event.target.value as LogTypeFilter)}
                    >
                      {logTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`${filterId}-range`} className="sk-label mb-1.5 block md:sr-only">
                      Date range
                    </label>
                    <select
                      id={`${filterId}-range`}
                      className="sk-field md:w-40"
                      value={dateRange}
                      onChange={(event) => setDateRange(event.target.value)}
                    >
                      {dateRanges.map((range) => (
                        <option key={range} value={range}>
                          {range}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {filteredLogs.length > 0 ? (
                <ul className="mt-2">
                  {visibleLogs.map((log) => {
                    const state = sessionState(log)
                    const editing = editingNoteId === log.id
                    const meta = [
                      log.type,
                      log.isoDate ? formatDay(log.isoDate) : log.date,
                      log.durationMinutes ? `${log.durationMinutes} min` : null,
                      log.status === "completed" && log.completedOn && log.completedOn !== log.isoDate
                        ? `done ${formatDay(log.completedOn)}`
                        : null,
                    ].filter(Boolean)
                    return (
                      <li key={log.id} className="border-b border-sk-line py-4 last:border-b-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-sk-ink">{log.title}</p>
                            <p className="text-sm text-sk-mute">{meta.join(", ")}</p>
                          </div>
                          {state ? <Tag tone={state.tone} className="shrink-0">{state.label}</Tag> : null}
                        </div>
                        {!log.status && log.details ? <p className="mt-2 text-sm leading-relaxed text-sk-ink-2">{log.details}</p> : null}

                        {editing ? (
                          <div className="mt-3">
                            <label htmlFor={`${filterId}-note-${log.id}`} className="sk-label mb-1.5 block">
                              Note for this session
                            </label>
                            <textarea
                              id={`${filterId}-note-${log.id}`}
                              className="sk-field h-auto min-h-[88px] py-2.5"
                              rows={3}
                              maxLength={1000}
                              value={noteDraft}
                              onChange={(event) => setNoteDraft(event.target.value)}
                            />
                            {noteError ? (
                              <p role="alert" className="mt-2 text-sm font-semibold text-[#b32a0c]">
                                Could not save the note: {noteError}
                              </p>
                            ) : null}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button type="button" className="sk-btn sk-btn-ink sk-btn-sm" disabled={noteSaving} onClick={() => void saveNote(log.id)}>
                                {noteSaving ? "Saving..." : "Save note"}
                              </button>
                              <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm" disabled={noteSaving} onClick={() => setEditingNoteId(null)}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {log.coachNote ? (
                              <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-sk-ink-2">
                                <ChatText className="mt-0.5 size-4 shrink-0 text-sk-mute" weight="bold" aria-hidden />
                                <span>
                                  <span className="font-semibold text-sk-ink">Your note:</span> {log.coachNote}
                                </span>
                              </p>
                            ) : null}
                            {onSaveSessionNote && log.status ? (
                              <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm -ml-3 mt-1.5" onClick={() => startEditingNote(log)}>
                                <PencilSimple className="size-4" weight="bold" />
                                {log.coachNote ? "Edit note" : "Add a note"}
                              </button>
                            ) : null}
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <div className="sk-well mt-4 flex flex-col items-start gap-3">
                  <p className="text-sm text-sk-ink-2">No sessions match these filters.</p>
                  {filtersActive ? (
                    <button
                      type="button"
                      className="sk-btn sk-btn-quiet sk-btn-sm"
                      onClick={() => {
                        setDateRange("All time")
                        setLogType("All")
                      }}
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
              )}
              {filteredLogs.length > ROW_LIMIT ? (
                <ShowAllButton
                  expanded={showAllSessions}
                  total={filteredLogs.length}
                  noun="sessions"
                  onToggle={() => setShowAllSessions((current) => !current)}
                />
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={<ClipboardText className="size-6" weight="fill" />}
              title="No sessions yet"
              body="Sessions appear here once a training plan is published to this athlete."
              action={
                <Link to="/coach/training-plan" className="sk-btn sk-btn-quiet sk-btn-sm">
                  Open training plans
                </Link>
              }
              className="border-0 bg-sk-canvas"
            />
          )}
        </Panel>

        <Panel title="Personal records" hint="Best mark for each event." className="min-w-0">
          {athletePrs.length > 0 ? (
            <ul>
              {athletePrs.map((pr) => {
                const source = pr.source === "test-week" ? "Test week" : pr.source === "import" ? "Imported" : pr.source === "manual" ? "Logged by hand" : pr.type
                const conditions = pr.wind ? `wind ${pr.wind}` : null
                return (
                  <li key={pr.id} className="sk-row items-start">
                    <div className="min-w-0">
                      <p className="font-bold text-sk-ink">{pr.event}</p>
                      <p className="text-sm text-sk-mute">
                        {[pr.isoDate ? formatDay(pr.isoDate, true) : pr.date, source, conditions].filter(Boolean).join(", ")}
                      </p>
                      {pr.note ? <p className="mt-1 text-sm text-sk-ink-2">{pr.note}</p> : null}
                      {!pr.legal ? <Tag tone="coral" className="mt-1.5">Not a legal mark</Tag> : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="sk-num text-2xl">{pr.bestValue}</p>
                      {pr.previousValue ? <p className="mt-1 text-sm text-sk-mute">was {pr.previousValue}</p> : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState
              icon={<Trophy className="size-6" weight="fill" />}
              title="No PRs yet"
              body="Personal records are added from test weeks and logged marks. The best mark for each event shows here."
              className="border-0 bg-sk-canvas"
            />
          )}
        </Panel>
      </div>
    </div>
  )
}
