"use client"

import { useNavigate } from "react-router-dom"
import AthleteCompetitionsPage from "@/app/(authenticated)/athlete/competitions/page"
import { CompetitionForm } from "@/components/athlete/competition-form"
import { Sheet } from "@/components/sk"

/** Adding a meet of their own: a sheet over the athlete's competitions. */
export default function AthleteNewCompetitionPage() {
  const navigate = useNavigate()
  return (
    <>
      <AthleteCompetitionsPage />
      <Sheet open onOpenChange={(open) => (open ? undefined : navigate("/athlete/competitions"))} title="Add a competition" description="Only you and your coach see it." className="sm:max-w-lg">
        <CompetitionForm cancelTo="/athlete/competitions" />
      </Sheet>
    </>
  )
}
