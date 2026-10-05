"use client"

import { useParams } from "react-router-dom"
import { OpenThread } from "@/components/messages/open-thread"

/** "Message this coach": see messageCoachHref in src/lib/data/messages/links.ts. */
export default function AthleteMessageCoachPage() {
  const { coachUserId = "" } = useParams()
  return <OpenThread key={coachUserId} role="athlete" target={{ coachUserId }} />
}
