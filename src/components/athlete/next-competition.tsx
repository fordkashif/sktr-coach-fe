"use client"

import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { meetDatesText } from "@/components/athlete/results-parts"
import { DayLabel, List, ListRow, Section } from "@/components/sk"
import { getNextCompetitionForCurrentAthlete } from "@/lib/data/competition/competition-data"
import type { CompetitionWithEntries } from "@/lib/data/competition/types"
import { parseLocalDay } from "@/lib/data/pr/pr-display"

/**
 * "Coming up" on the athlete home: the next competition the athlete is entered in, with the date,
 * the name and their events. Renders nothing when there is none (or while it loads), so the home
 * screen does not grow a section it has nothing to put in.
 */
export function NextCompetitionSection() {
  const [competition, setCompetition] = useState<CompetitionWithEntries | null>(null)

  useEffect(() => {
    let cancelled = false
    void getNextCompetitionForCurrentAthlete().then((result) => {
      if (!cancelled && result.ok) setCompetition(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!competition) return null

  const start = parseLocalDay(competition.startDate) ?? new Date()
  const now = new Date()
  const days = Math.round((start.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000)
  const when = days <= 0 ? "on now" : days === 1 ? "tomorrow" : `in ${days} days`
  const events = competition.entries.filter((entry) => entry.status === "entered").map((entry) => entry.eventLabel)

  return (
    <Section
      title="Coming up"
      action={
        <Link className="sk-link" to="/athlete/competitions">
          Competitions
        </Link>
      }
    >
      <List>
        <ListRow
          to={`/athlete/competitions/${competition.id}`}
          leading={<DayLabel weekday={start.toLocaleDateString(undefined, { month: "short" })} number={start.getDate()} />}
          title={competition.name}
          subtitle={
            <>
              Next competition, {meetDatesText(competition.startDate, competition.endDate)} ({when})
              <span className="block">{events.join(", ")}</span>
            </>
          }
        />
      </List>
    </Section>
  )
}
