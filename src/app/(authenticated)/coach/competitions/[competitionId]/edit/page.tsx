"use client"

import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { StaffCompetitionForm } from "@/components/coach/competitions/competition-form"
import { competitionPath } from "@/components/coach/competitions/competition-parts"
import { Notice, Screen, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { getCompetitionForStaff } from "@/lib/data/competition/competition-data"
import type { CompetitionWithEntries } from "@/lib/data/competition/types"

export default function CoachEditCompetitionPage() {
  const { competitionId = "" } = useParams()
  const [competition, setCompetition] = useState<CompetitionWithEntries | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getCompetitionForStaff(competitionId).then((result) => {
      if (cancelled) return
      if (result.ok) setCompetition(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [competitionId])

  const backTo = competitionPath(competitionId)

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
      {competition && !competition.canManage ? <Notice tone="info">{competition.ownerName ?? "An athlete"} added this competition for themselves, so only they can change it. You can still enter results.</Notice> : null}
      {competition && competition.canManage ? <StaffCompetitionForm key={competition.id} existing={competition} teamId={competition.teamId} cancelTo={backTo} /> : null}
    </Screen>
  )
}
