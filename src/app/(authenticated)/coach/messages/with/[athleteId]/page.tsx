"use client"

import { useParams } from "react-router-dom"
import { OpenThread } from "@/components/messages/open-thread"

/** "Message this athlete": see messageAthleteHref in src/lib/data/messages/links.ts. */
export default function CoachMessageAthletePage() {
  const { athleteId = "" } = useParams()
  return <OpenThread key={athleteId} role="coach" target={{ athleteId }} />
}
