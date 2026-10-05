"use client"

import { useEffect, useMemo, useState } from "react"
import {
  DataTable,
  EmptyState,
  LinkButton,
  List,
  ListRow,
  Notice,
  ReadinessText,
  Screen,
  ScreenHeader,
  Section,
  Segmented,
  SkeletonRows,
  Sparkline,
  Stat,
  StatStrip,
  StatusDot,
  type DataTableColumn,
} from "@/components/sk"
import { getCurrentAthletePainReports } from "@/lib/data/wellness/pain-report-data"
import { bodyAreasSummary, type PainReport } from "@/lib/data/wellness/pain-report-types"
import { loadCurrentAthleteWellnessEntries, localWellnessDate } from "@/lib/data/wellness/wellness-data"
import type { WellnessEntry } from "@/lib/data/wellness/types"
import { WELLNESS_SCALES, formatHours, painReportSummary, painTone, parseLocalDate, shiftDate, shortDate } from "../wellness-shared"

type Range = "4" | "12"

type HistoryRow = { entry: WellnessEntry; pain: PainReport[] }

function scaleWord(key: (typeof WELLNESS_SCALES)[number]["key"], value: number) {
  return WELLNESS_SCALES.find((scale) => scale.key === key)?.words[value - 1] ?? String(value)
}

/** The last weeks of check-ins as a table, a readiness trend and every pain report. */
export default function AthleteWellnessHistoryPage() {
  const today = localWellnessDate()
  const [range, setRange] = useState<Range>("4")
  const [entries, setEntries] = useState<WellnessEntry[] | null>(null)
  const [painReports, setPainReports] = useState<PainReport[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [entriesResult, painResult] = await Promise.all([loadCurrentAthleteWellnessEntries(), getCurrentAthletePainReports()])
      if (cancelled) return
      if (entriesResult.ok) setEntries(entriesResult.data)
      else {
        setEntries([])
        setLoadError(entriesResult.error.message)
      }
      if (painResult.ok) setPainReports(painResult.data)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const days = Number(range) * 7
  const firstDay = shiftDate(today, -(days - 1))

  const inRange = useMemo(() => (entries ?? []).filter((entry) => entry.entryDate >= firstDay && entry.entryDate <= today), [entries, firstDay, today])

  /** One value per day, oldest first, with gaps where there was no check-in. */
  const trend = useMemo(() => {
    const byDate = new Map(inRange.map((entry) => [entry.entryDate, entry.readinessScore]))
    return Array.from({ length: days }, (_, index) => byDate.get(shiftDate(firstDay, index)) ?? null)
  }, [inRange, days, firstDay])

  const rows = useMemo<HistoryRow[]>(
    () =>
      [...inRange]
        .sort((a, b) => b.entryDate.localeCompare(a.entryDate))
        .map((entry) => ({ entry, pain: painReports.filter((report) => localWellnessDate(new Date(report.createdAt)) === entry.entryDate) })),
    [inRange, painReports],
  )

  const average = (values: number[]) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null)
  const averageReadiness = average(inRange.map((entry) => entry.readinessScore))
  const averageSleep = average(inRange.map((entry) => entry.sleepHours))
  const first = inRange[0]
  const last = inRange[inRange.length - 1]
  const trendLabel =
    inRange.length === 0
      ? `No check-ins in the last ${range} weeks`
      : `Readiness over the last ${range} weeks: ${inRange.length} check-ins, from ${first.readinessScore} on ${shortDate(first.entryDate)} to ${last.readinessScore} on ${shortDate(last.entryDate)}`

  const columns: Array<DataTableColumn<HistoryRow>> = [
    { key: "date", header: "Day", cell: (row) => (row.entry.entryDate === today ? "Today" : shortDate(row.entry.entryDate)) },
    {
      key: "readiness",
      header: "Readiness",
      phone: "trailing",
      cell: (row) => <ReadinessText status={row.entry.readiness} detail={String(row.entry.readinessScore)} />,
    },
    { key: "sleep", header: "Sleep", align: "right", cell: (row) => `${formatHours(row.entry.sleepHours)} h` },
    { key: "soreness", header: "Soreness", phone: "hide", cell: (row) => scaleWord("soreness", row.entry.soreness) },
    { key: "fatigue", header: "Fatigue", phone: "hide", cell: (row) => scaleWord("fatigue", row.entry.fatigue) },
    { key: "mood", header: "Mood", phone: "hide", cell: (row) => scaleWord("mood", row.entry.mood) },
    { key: "stress", header: "Stress", phone: "hide", cell: (row) => scaleWord("stress", row.entry.stress) },
    {
      key: "pain",
      header: "Pain reported",
      // On a phone the reports are listed under the table instead.
      phone: "hide",
      cell: (row) => (row.pain.length > 0 ? row.pain.map((report) => bodyAreasSummary(report.bodyAreas)).join("; ") : "None"),
    },
  ]

  const loading = entries === null

  return (
    <Screen>
      <ScreenHeader
        back={{ to: "/athlete/wellness", label: "Wellness" }}
        title="Wellness history"
        lede="Your check-ins and pain reports. Your coaches see the same."
        actions={<Segmented label="Period" value={range} onChange={setRange} options={[{ value: "4", label: "4 weeks" }, { value: "12", label: "12 weeks" }]} />}
      />

      {loadError ? <Notice tone="error">We could not load your history. {loadError}</Notice> : null}

      {loading ? (
        <Section title="Readiness trend">
          <SkeletonRows rows={6} label="Loading your history" />
        </Section>
      ) : inRange.length === 0 ? (
        <Section title="Readiness trend">
          <EmptyState
            title={`No check-ins in the last ${range} weeks`}
            body="Each daily check-in adds a row here and a point on your readiness trend."
            action={
              <LinkButton to="/athlete/wellness" size="sm">
                Do today&apos;s check-in
              </LinkButton>
            }
          />
        </Section>
      ) : (
        <>
          <StatStrip aria-label={`The last ${range} weeks in numbers`}>
            <Stat label="Check-ins" value={inRange.length} of={days} />
            <Stat label="Average readiness" value={averageReadiness === null ? "0" : Math.round(averageReadiness)} />
            <Stat label="Average sleep" value={averageSleep === null ? "0" : formatHours(Math.round(averageSleep * 10) / 10)} unit=" h" />
            <Stat label="Low days" value={inRange.filter((entry) => entry.readiness === "red").length} hint="Readiness in review" />
          </StatStrip>

          <Section title="Readiness trend" meta={`${parseLocalDate(firstDay).toLocaleDateString(undefined, { day: "numeric", month: "short" })} to today`}>
            <Sparkline values={trend} min={0} max={100} label={trendLabel} className="mt-2" />
          </Section>

          <Section title="Check-ins" meta={`${inRange.length} in ${range} weeks`}>
            <DataTable caption={`Wellness check-ins in the last ${range} weeks, newest first`} columns={columns} rows={rows} rowKey={(row) => row.entry.entryDate} />
          </Section>
        </>
      )}

      {!loading ? (
        <Section
          title="Pain and injury reports"
          meta={painReports.length > 0 ? `${painReports.filter((report) => report.status === "open").length} open` : undefined}
        >
          {painReports.length === 0 ? (
            <EmptyState
              title="No pain reports"
              body="When something hurts, report it so your coach can adjust your training. It shows up here with the date."
              action={
                <LinkButton to="/athlete/wellness/pain" size="sm">
                  Report pain or an injury
                </LinkButton>
              }
            />
          ) : (
            <List>
              {painReports.map((report) => (
                <ListRow
                  key={report.id}
                  leading={<StatusDot tone={painTone(report)} />}
                  title={bodyAreasSummary(report.bodyAreas)}
                  subtitle={
                    <>
                      {painReportSummary(report)}
                      {report.note ? ` "${report.note}"` : ""}
                    </>
                  }
                  trailing={
                    <span className={report.status === "open" ? undefined : "font-normal text-sk-mute"}>
                      {report.status === "open" ? "Open" : `Resolved ${shortDate(localWellnessDate(new Date(report.resolvedAt ?? report.createdAt)))}`}
                    </span>
                  }
                />
              ))}
            </List>
          )}
        </Section>
      ) : null}
    </Screen>
  )
}
