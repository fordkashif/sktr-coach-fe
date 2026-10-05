"use client"

import { CompetitionForm } from "@/components/athlete/competition-form"
import { Screen, ScreenHeader } from "@/components/sk"

export default function AthleteNewCompetitionPage() {
  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: "/athlete/competitions", label: "Competitions" }}
        title="Add a competition"
        lede="For a meet you entered yourself. Only you and your coach see it. Meets your coach sets up appear on their own."
      />
      <CompetitionForm cancelTo="/athlete/competitions" />
    </Screen>
  )
}
