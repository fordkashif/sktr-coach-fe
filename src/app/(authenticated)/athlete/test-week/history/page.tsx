"use client"

import { useEffect, useMemo, useState } from "react"
import { DataTable, EmptyState, Field, FormGrid, LinkButton, Notice, Screen, ScreenHeader, Section, Select, SkeletonRows, Stat, StatStrip, StatusText, TrendLine, type DataTableColumn } from "@/components/sk"
import { formatMark, formatMarkWithUnit, type MarkUnit } from "@/lib/data/pr/marks"
import { formatFullDay, parseLocalDay } from "@/lib/data/pr/pr-display"
import { buildTestSeries, testSeriesKey, type TestSeries } from "@/lib/data/test-week/test-history"
import { describeTestChange, getCurrentAthleteTestWeekHistory } from "@/lib/data/test-week/test-week-data"
import type { AthleteTestWeekHistoryItem, TestDefinitionUnit } from "@/lib/data/test-week/types"

type HistoryResult = AthleteTestWeekHistoryItem["results"][number] & { testWeekId: string; best: TestSeries["best"] }

const MARK_UNIT: Record<TestDefinitionUnit, MarkUnit> = { time: "s", distance: "m", weight: "kg", height: "cm", score: "pts" }

function valueText(value: number, unit: TestDefinitionUnit) {
  return formatMarkWithUnit(formatMark(value, MARK_UNIT[unit]), MARK_UNIT[unit])
}

/** One test followed across every test week it was in: latest, change, best ever, and the line. */
function TestOverTime({ series }: { series: TestSeries[] }) {
  // Start on the first test that has been done at least twice, so there is something to compare.
  const [chosenKey, setChosenKey] = useState(() => (series.find((item) => item.points.length > 1) ?? series[0]).key)
  const chosen = series.find((item) => item.key === chosenKey) ?? series[0]
  const numbered = chosen.points.filter((point) => point.valueNumeric !== null)
  const change =
    chosen.previous && chosen.latest.valueNumeric !== null && chosen.previous.valueNumeric !== null
      ? describeTestChange(chosen.unit, chosen.latest.valueNumeric, chosen.previous.valueNumeric)
      : null
  const direction = chosen.lowerIsBetter ? "Lower is better." : "Higher is better."
  const latestIsBest = chosen.best !== null && chosen.best.testWeekId === chosen.latest.testWeekId

  return (
    <Section title="One test over time" hint={`Pick a test to see every time you did it. ${direction}`}>
      <FormGrid>
      <Field label="Test">
        <Select value={chosen.key} onChange={(event) => setChosenKey(event.target.value)}>
          {series.map((item) => (
            <option key={item.key} value={item.key}>
              {item.name}
            </option>
          ))}
        </Select>
      </Field>
      </FormGrid>
      <StatStrip aria-label={`${chosen.name} in numbers`} className="mt-4">
        <Stat label="Latest" value={chosen.latest.valueText} hint={chosen.latest.weekName} />
        <Stat
          label="Against last time"
          value={chosen.previous ? (change ? change.text : "No change") : "First result"}
          hint={
            chosen.previous ? (
              <>
                {change ? <StatusText tone={change.improved ? "green" : "coral"}>{change.improved ? "Better" : "Worse"}</StatusText> : null}
                <span className="block">
                  Was {chosen.previous.valueText} in {chosen.previous.weekName}
                </span>
              </>
            ) : (
              "Nothing earlier to compare with"
            )
          }
        />
        <Stat label="Best ever" value={chosen.best ? chosen.best.valueText : "None"} hint={chosen.best ? (latestIsBest ? "Your latest result" : chosen.best.weekName) : "No result with a number"} />
      </StatStrip>
      {numbered.length >= 2 ? (
        <TrendLine
          className="mt-4"
          points={numbered.map((point) => ({ x: parseLocalDay(point.date) ?? new Date(point.date), y: point.valueNumeric }))}
          seriesName={chosen.name}
          formatValue={(value) => valueText(value, chosen.unit)}
          label={`${chosen.name} over ${numbered.length} test weeks, from ${numbered[0].valueText} in ${numbered[0].weekName} to ${numbered[numbered.length - 1].valueText} in ${numbered[numbered.length - 1].weekName}. ${direction}`}
        />
      ) : (
        <p className="sk-list-sub mt-3">The line appears once you have done this test in two test weeks.</p>
      )}
    </Section>
  )
}

const COLUMNS: Array<DataTableColumn<HistoryResult>> = [
  { key: "test", header: "Test", cell: (result) => result.name },
  { key: "result", header: "Result", align: "right", strong: true, phone: "trailing", cell: (result) => result.valueText },
  {
    key: "change",
    header: "Change",
    phone: "plain",
    cell: (result) =>
      result.change ? (
        <StatusText tone={result.change.improved ? "green" : "coral"}>{result.change.text}</StatusText>
      ) : result.previousValueText ? (
        "No change"
      ) : (
        "First result"
      ),
  },
  { key: "previous", header: "Last time", align: "right", cell: (result) => result.previousValueText ?? "No earlier result" },
  {
    key: "best",
    header: "Best ever",
    align: "right",
    cell: (result) => (!result.best ? "No number" : result.best.testWeekId === result.testWeekId ? <StatusText tone="green">This one</StatusText> : result.best.valueText),
  },
]

export default function AthleteTestWeekHistoryPage() {
  const [weeks, setWeeks] = useState<AthleteTestWeekHistoryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getCurrentAthleteTestWeekHistory().then((result) => {
      if (cancelled) return
      if (result.ok) setWeeks(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const series = useMemo(() => buildTestSeries(weeks ?? []), [weeks])
  const bestByTest = useMemo(() => new Map(series.map((item) => [item.key, item.best])), [series])

  return (
    <Screen>
      <ScreenHeader
        back={{ to: "/athlete/test-week", label: "Test week" }}
        title="Test week history"
        lede="Every test week you have results in, newest first. Each result is compared with the last time you did that test, and with your best ever."
      />

      {error ? <Notice tone="error">Your test history could not be loaded. {error}</Notice> : null}

      {weeks === null && !error ? (
        <Section title="Loading test weeks">
          <SkeletonRows rows={5} label="Loading your test history" />
        </Section>
      ) : null}

      {weeks && weeks.length === 0 ? (
        <Section title="No test weeks yet">
          <EmptyState
            title="Your results will collect here"
            body="After you submit results in a test week, it is kept here so you can see how each test moves from one test week to the next."
            action={
              <LinkButton to="/athlete/test-week" size="sm">
                Go to the test week
              </LinkButton>
            }
          />
        </Section>
      ) : null}

      {series.length > 0 ? <TestOverTime series={series} /> : null}

      {(weeks ?? []).map((week) => {
        const better = week.results.filter((result) => result.change?.improved).length
        const compared = week.results.filter((result) => result.change || result.previousValueText).length
        return (
          <Section
            key={week.testWeekId}
            id={week.testWeekId}
            title={week.name}
            hint={`${week.startDate === week.endDate ? formatFullDay(week.startDate) : `${formatFullDay(week.startDate)} to ${formatFullDay(week.endDate)}`}${week.status === "published" ? ". Still open." : ""}`}
            meta={compared > 0 ? `${better} of ${compared} better` : undefined}
          >
            <DataTable caption={`Your results in ${week.name}`} columns={COLUMNS} rows={week.results.map((result) => ({ ...result, testWeekId: week.testWeekId, best: bestByTest.get(testSeriesKey(result.name, result.unit)) ?? null }))} rowKey={(result) => result.testDefinitionId} />
          </Section>
        )
      })}
    </Screen>
  )
}
