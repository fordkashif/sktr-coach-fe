"use client"

import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { ResultForm } from "@/components/athlete/result-form"
import { dayText, eventHistoryPath, markText } from "@/components/athlete/results-parts"
import { EmptyState, LinkButton, Notice, Screen, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { canViewerEditResult, getCurrentAthleteRecords, type AthleteRecords } from "@/lib/data/pr/results-data"

export default function AthleteEditResultPage() {
  const { resultId = "" } = useParams()
  const [records, setRecords] = useState<AthleteRecords | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getCurrentAthleteRecords().then((result) => {
      if (cancelled) return
      if (result.ok) setRecords(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [resultId])

  const result = records?.results.find((item) => item.id === resultId) ?? null
  const backTo = result ? eventHistoryPath(result.eventGroup) : "/athlete/prs"
  const editable = result ? canViewerEditResult(result, records?.viewerUserId ?? null) && !result.competitionEntryId : false

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: backTo, label: result ? result.eventLabel : "Records" }}
        title="Edit result"
        lede={result ? `${result.eventLabel}, ${markText(result)} on ${dayText(result.date)}.` : undefined}
      />
      {error ? <Notice tone="error">This result could not be loaded. {error}</Notice> : null}
      {records === null && !error ? (
        <Section aria-label="Loading">
          <SkeletonRows rows={4} label="Loading the result" />
        </Section>
      ) : null}
      {records && !result ? (
        <Section title="This result is gone">
          <EmptyState
            title="It may have been deleted"
            body="Go back to your records to see what is there."
            action={
              <LinkButton to="/athlete/prs" size="sm">
                Back to records
              </LinkButton>
            }
          />
        </Section>
      ) : null}
      {result && !editable ? (
        <Notice tone="info">
          {result.source === "test_week"
            ? "This mark came from a test week. Change it in the test week while it is open, or ask your coach."
            : result.competitionEntryId
              ? "This is a competition result. Change it from the competition."
              : "Only the person who entered this result, or your coach, can change it."}
        </Notice>
      ) : null}
      {result && editable ? <ResultForm key={result.id} existing={result} cancelTo={backTo} /> : null}
    </Screen>
  )
}
