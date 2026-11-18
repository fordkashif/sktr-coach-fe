"use client"

import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import CoachCompetitionDetailPage from "@/app/(authenticated)/coach/competitions/[competitionId]/page"
import { StaffCompetitionForm } from "@/components/coach/competitions/competition-form"
import { competitionPath } from "@/components/coach/competitions/competition-parts"
import { Notice, Sheet, SkeletonRows } from "@/components/sk"
import { getCompetitionForStaff } from "@/lib/data/competition/competition-data"
import type { CompetitionWithEntries } from "@/lib/data/competition/types"

/** Editing a meet: a sheet over the competition. Closing it goes back to the competition. */
export default function CoachEditCompetitionPage() {
  const { competitionId = "" } = useParams()
  const navigate = useNavigate()
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
    <>
      <CoachCompetitionDetailPage />
      <Sheet open onOpenChange={(open) => (open ? undefined : navigate(backTo))} title="Edit competition" className="sm:max-w-lg">
        {error ? <Notice tone="error">This competition could not be loaded. {error}</Notice> : null}
        {competition === undefined && !error ? <SkeletonRows rows={4} label="Loading the competition" /> : null}
        {competition === null ? <Notice tone="info">This competition no longer exists.</Notice> : null}
        {competition && !competition.canManage ? <Notice tone="info">{competition.ownerName ?? "An athlete"} added this competition for themselves, so only they can change it. You can still enter results.</Notice> : null}
        {competition && competition.canManage ? <StaffCompetitionForm key={competition.id} existing={competition} teamId={competition.teamId} cancelTo={backTo} /> : null}
      </Sheet>
    </>
  )
}
