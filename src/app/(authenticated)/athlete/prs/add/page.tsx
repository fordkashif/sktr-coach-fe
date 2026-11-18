"use client"

import { useNavigate, useSearchParams } from "react-router-dom"
import AthletePrsPage from "@/app/(authenticated)/athlete/prs/page"
import { ResultForm } from "@/components/athlete/result-form"
import { eventHistoryPath } from "@/components/athlete/results-parts"
import { Sheet } from "@/components/sk"
import { findResultEvent } from "@/lib/data/pr/marks"

/** Adding a result: a sheet over the athlete's records. */
export default function AthleteAddResultPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const eventKey = params.get("event") ?? undefined
  const event = findResultEvent(eventKey)
  const backTo = event && event.kind !== "other" ? eventHistoryPath(`k:${event.key}`) : "/athlete/prs"

  return (
    <>
      <AthletePrsPage />
      <Sheet open onOpenChange={(open) => (open ? undefined : navigate(backTo))} title="Add a result" className="sm:max-w-lg">
        <ResultForm initialEventKey={eventKey} cancelTo={backTo} />
      </Sheet>
    </>
  )
}
