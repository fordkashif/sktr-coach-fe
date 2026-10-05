"use client"

import { useSearchParams } from "react-router-dom"
import { ResultForm } from "@/components/athlete/result-form"
import { eventHistoryPath } from "@/components/athlete/results-parts"
import { Screen, ScreenHeader } from "@/components/sk"
import { findResultEvent } from "@/lib/data/pr/marks"

export default function AthleteAddResultPage() {
  const [params] = useSearchParams()
  const eventKey = params.get("event") ?? undefined
  const event = findResultEvent(eventKey)
  const backTo = event && event.kind !== "other" ? eventHistoryPath(`k:${event.key}`) : "/athlete/prs"

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: backTo, label: event && event.kind !== "other" ? event.name : "Records" }}
        title="Add a result"
        lede="A mark from a meet or from training. It joins your history and counts for your personal and season bests."
      />
      <ResultForm initialEventKey={eventKey} cancelTo={backTo} />
    </Screen>
  )
}
