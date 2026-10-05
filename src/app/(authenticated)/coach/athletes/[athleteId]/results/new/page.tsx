"use client"

import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { ResultForm } from "@/components/athlete/result-form"
import { Notice, Screen, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { loadCoachAthleteDetail } from "@/lib/data/coach/athlete-detail-data"

/** A coach or club admin adds a result for one of their athletes, with the form the athlete uses. */
export default function CoachAddAthleteResultPage() {
  const { athleteId = "" } = useParams()
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const backTo = `/coach/athletes/${athleteId}?tab=results`

  useEffect(() => {
    let cancelled = false
    void loadCoachAthleteDetail(athleteId).then((result) => {
      if (cancelled) return
      if (result.ok) setName(result.data.athlete.name)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [athleteId])

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: backTo, label: name ?? "Athlete" }}
        title="Add a result"
        lede={name ? `A mark from a meet or from training, for ${name}. It joins their history and counts for their personal and season bests.` : undefined}
      />
      {error ? <Notice tone="error">This athlete could not be loaded. {error}</Notice> : null}
      {name === null && !error ? (
        <Section aria-label="Loading">
          <SkeletonRows rows={4} label="Loading the athlete" />
        </Section>
      ) : null}
      {name ? <ResultForm cancelTo={backTo} forAthlete={{ id: athleteId, name, returnTo: backTo }} /> : null}
    </Screen>
  )
}
