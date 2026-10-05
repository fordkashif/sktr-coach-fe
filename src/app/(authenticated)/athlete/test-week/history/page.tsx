"use client"

import { useEffect, useState } from "react"
import { DataTable, EmptyState, LinkButton, Notice, Screen, ScreenHeader, Section, SkeletonRows, StatusText, type DataTableColumn } from "@/components/sk"
import { formatFullDay } from "@/lib/data/pr/pr-display"
import { getCurrentAthleteTestWeekHistory } from "@/lib/data/test-week/test-week-data"
import type { AthleteTestWeekHistoryItem } from "@/lib/data/test-week/types"

type HistoryResult = AthleteTestWeekHistoryItem["results"][number]

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

  return (
    <Screen>
      <ScreenHeader
        back={{ to: "/athlete/test-week", label: "Test week" }}
        title="Test week history"
        lede="Every test week you have results in, newest first. Each result is compared with the same test in the test week before."
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
            <DataTable caption={`Your results in ${week.name}`} columns={COLUMNS} rows={week.results} rowKey={(result) => result.testDefinitionId} />
          </Section>
        )
      })}
    </Screen>
  )
}
