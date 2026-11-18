"use client"

import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import CoachAthleteDetailPage from "@/app/(authenticated)/coach/athletes/[athleteId]/page"
import { ResultForm } from "@/components/athlete/result-form"
import { Notice, Sheet, SkeletonRows } from "@/components/sk"
import { loadCoachAthleteDetail } from "@/lib/data/coach/athlete-detail-data"

/** A coach or club admin adds a result for one of their athletes, with the form the athlete uses. */
export default function CoachAddAthleteResultPage() {
  const { athleteId = "" } = useParams()
  const navigate = useNavigate()
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
    <>
      <CoachAthleteDetailPage />
      <Sheet open onOpenChange={(open) => (open ? undefined : navigate(backTo))} title="Add a result" description={name ?? undefined} className="sm:max-w-lg">
        {error ? <Notice tone="error">This athlete could not be loaded. {error}</Notice> : null}
        {name === null && !error ? <SkeletonRows rows={4} label="Loading the athlete" /> : null}
        {name ? <ResultForm cancelTo={backTo} forAthlete={{ id: athleteId, name, returnTo: backTo }} /> : null}
      </Sheet>
    </>
  )
}
