"use client"

import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import CoachAthleteDetailPage from "@/app/(authenticated)/coach/athletes/[athleteId]/page"
import { ResultForm } from "@/components/athlete/result-form"
import { dayText, markText } from "@/components/athlete/results-parts"
import { EmptyState, LinkButton, Notice, Sheet, SkeletonRows } from "@/components/sk"
import { loadCoachAthleteDetail } from "@/lib/data/coach/athlete-detail-data"
import type { AthleteResult } from "@/lib/data/pr/marks"
import { getAthleteResults } from "@/lib/data/pr/results-data"

/** A coach or club admin corrects (or deletes) a result of one of their athletes. */
export default function CoachEditAthleteResultPage() {
  const { athleteId = "", resultId = "" } = useParams()
  const navigate = useNavigate()
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
    <>
      <CoachAthleteDetailPage />
      <Sheet
        open
        onOpenChange={(open) => (open ? undefined : navigate(backTo))}
        title="Correct a result"
        description={result && name ? `${name}, ${result.eventLabel}, ${markText(result)} on ${dayText(result.date)}.` : undefined}
        className="sm:max-w-lg"
      >
        <div className="flex flex-col gap-4">
          {error ? <Notice tone="error">This result could not be loaded. {error}</Notice> : null}
          {results === null && !error ? <SkeletonRows rows={4} label="Loading the result" /> : null}
          {results && !result ? (
            <EmptyState
              title="This result is gone"
              action={
                <LinkButton to={backTo} size="sm">
                  Back to results
                </LinkButton>
              }
            />
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
        </div>
      </Sheet>
    </>
  )
}
