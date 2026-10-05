"use client"

import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { CompetitionForm } from "@/components/athlete/competition-form"
import { Notice, Screen, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { getCompetitionForCurrentAthlete } from "@/lib/data/competition/competition-data"
import type { CompetitionWithEntries } from "@/lib/data/competition/types"

export default function AthleteEditCompetitionPage() {
  const { competitionId = "" } = useParams()
  const [competition, setCompetition] = useState<CompetitionWithEntries | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getCompetitionForCurrentAthlete(competitionId).then((result) => {
      if (cancelled) return
      if (result.ok) setCompetition(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [competitionId])

  const backTo = `/athlete/competitions/${competitionId}`

  return (
    <Screen width="narrow">
      <ScreenHeader back={{ to: backTo, label: competition?.name ?? "Competition" }} title="Edit competition" />
      {error ? <Notice tone="error">This competition could not be loaded. {error}</Notice> : null}
      {competition === undefined && !error ? (
        <Section aria-label="Loading">
          <SkeletonRows rows={4} label="Loading the competition" />
        </Section>
      ) : null}
      {competition === null ? <Notice tone="info">This competition no longer exists.</Notice> : null}
      {competition && !competition.canManage ? <Notice tone="info">Your coach or club set up this competition, so only they can change it.</Notice> : null}
      {competition && competition.canManage ? <CompetitionForm key={competition.id} existing={competition} cancelTo={backTo} /> : null}
    </Screen>
  )
}
