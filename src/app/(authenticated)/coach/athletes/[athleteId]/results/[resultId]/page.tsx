"use client"

import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { ResultForm } from "@/components/athlete/result-form"
import { dayText, markText } from "@/components/athlete/results-parts"
import { EmptyState, LinkButton, Notice, Screen, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { loadCoachAthleteDetail } from "@/lib/data/coach/athlete-detail-data"
import type { AthleteResult } from "@/lib/data/pr/marks"
import { getAthleteResults } from "@/lib/data/pr/results-data"

/** A coach or club admin corrects (or deletes) a result of one of their athletes. */
export default function CoachEditAthleteResultPage() {
  const { athleteId = "", resultId = "" } = useParams()
  const [name, setName] = useState<string | null>(null)
  const [results, setResults] = useState<AthleteResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const backTo = `/coach/athletes/${athleteId}?tab=results`

  useEffect(() => {
    let cancelled = false
    void Promise.all([loadCoachAthleteDetail(athleteId), getAthleteResults(athleteId)]).then(([detail, list]) => {
      if (cancelled) return
      if (!detail.ok) {
        setError(detail.error.message)
        return
      }
      if (!list.ok) {
        setError(list.error.message)
        return
      }
      setName(detail.data.athlete.name)
      setResults(list.data)
    })
    return () => {
      cancelled = true
    }
  }, [athleteId, resultId])

  const result = results?.find((item) => item.id === resultId) ?? null
  // A test week result is corrected in the test week, a competition result from the competition.
  const editable = result ? result.source !== "test_week" && result.source !== "imported" && !result.competitionEntryId : false

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: backTo, label: name ?? "Athlete" }}
        title="Correct a result"
        lede={result && name ? `${name}, ${result.eventLabel}, ${markText(result)} on ${dayText(result.date)}.` : undefined}
      />
      {error ? <Notice tone="error">This result could not be loaded. {error}</Notice> : null}
      {results === null && !error ? (
        <Section aria-label="Loading">
          <SkeletonRows rows={4} label="Loading the result" />
        </Section>
      ) : null}
      {results && !result ? (
        <Section title="This result is gone">
          <EmptyState
            title="It may have been deleted"
            body="Go back to the athlete to see what is there."
            action={
              <LinkButton to={backTo} size="sm">
                Back to results
              </LinkButton>
            }
          />
        </Section>
      ) : null}
      {result && !editable ? (
        <Notice tone="info">
          {result.source === "test_week"
            ? "This mark came from a test week. Correct it in the test week."
            : result.competitionEntryId
              ? "This is a competition result. Correct it from the competition."
              : "This result was imported and cannot be changed here."}
        </Notice>
      ) : null}
      {result && editable && name ? <ResultForm key={result.id} existing={result} cancelTo={backTo} forAthlete={{ id: athleteId, name, returnTo: backTo }} /> : null}
    </Screen>
  )
}
