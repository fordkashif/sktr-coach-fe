"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus } from "@phosphor-icons/react"
import { meetDatesText, ordinal, ProgressTabs } from "@/components/athlete/results-parts"
import { DayLabel, EmptyState, LinkButton, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows, StatusText } from "@/components/sk"
import { getCompetitionsForCurrentAthlete, splitCompetitions } from "@/lib/data/competition/competition-data"
import type { CompetitionWithEntries } from "@/lib/data/competition/types"
import { formatMarkWithUnit } from "@/lib/data/pr/marks"
import { parseLocalDay } from "@/lib/data/pr/pr-display"

function dayLabel(date: string) {
  const day = parseLocalDay(date) ?? new Date()
  return <DayLabel weekday={day.toLocaleDateString(undefined, { month: "short" })} number={day.getDate()} />
}

function whereText(competition: CompetitionWithEntries): string {
  return [competition.venue, competition.location].filter(Boolean).join(", ")
}

function countdown(date: string, today: Date): string {
  const day = parseLocalDay(date)
  if (!day) return ""
  const days = Math.round((day.getTime() - today.getTime()) / 86_400_000)
  if (days <= 0) return "On now"
  if (days === 1) return "Tomorrow"
  if (days < 14) return `In ${days} days`
  return `In ${Math.round(days / 7)} weeks`
}

export default function AthleteCompetitionsPage() {
  const [competitions, setCompetitions] = useState<CompetitionWithEntries[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])

  useEffect(() => {
    let cancelled = false
    void getCompetitionsForCurrentAthlete().then((result) => {
      if (cancelled) return
      if (result.ok) setCompetitions(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const { upcoming, past } = splitCompetitions(competitions ?? [])
  const loading = competitions === null && !error

  return (
    <Screen>
      <ScreenHeader
        title="Competitions"
        lede="Your season calendar: what is coming up, what you are entered in and how past meets went."
        actions={
          <LinkButton to="/athlete/competitions/new" variant="primary">
            <Plus className="size-[18px]" weight="bold" aria-hidden />
            Add a competition
          </LinkButton>
        }
      />
      <ProgressTabs />

      {error ? <Notice tone="error">Your competitions could not be loaded. {error}</Notice> : null}

      <Section title="Coming up" meta={upcoming.length > 0 ? `${upcoming.length} ${upcoming.length === 1 ? "meet" : "meets"}` : undefined}>
        {loading ? (
          <SkeletonRows rows={2} leading label="Loading competitions" />
        ) : upcoming.length > 0 ? (
          <List>
            {upcoming.map((competition) => {
              const entered = competition.entries.filter((entry) => entry.status === "entered")
              return (
                <ListRow
                  key={competition.id}
                  to={`/athlete/competitions/${competition.id}`}
                  leading={dayLabel(competition.startDate)}
                  title={competition.name}
                  subtitle={
                    <>
                      {[meetDatesText(competition.startDate, competition.endDate), whereText(competition)].filter(Boolean).join(", ")}
                      <span className="block">{entered.length > 0 ? entered.map((entry) => entry.eventLabel).join(", ") : "You are not entered yet"}</span>
                    </>
                  }
                  trailing={<span className="font-normal text-sk-mute">{countdown(competition.startDate, today)}</span>}
                />
              )
            })}
          </List>
        ) : (
          <EmptyState
            title="Nothing coming up"
            body="Meets your coach enters you in appear here. If you have entered an open meet yourself, add it so your results have a home."
            action={
              <LinkButton to="/athlete/competitions/new" size="sm">
                Add a competition
              </LinkButton>
            }
          />
        )}
      </Section>

      <Section title="Past" meta={past.length > 0 ? `${past.length} ${past.length === 1 ? "meet" : "meets"}` : undefined}>
        {loading ? (
          <SkeletonRows rows={3} leading label="Loading past competitions" />
        ) : past.length > 0 ? (
          <List>
            {past.map((competition) => {
              const competed = competition.entries.filter((entry) => entry.status === "entered")
              const missing = competed.filter((entry) => !entry.result).length
              const marks = competed
                .filter((entry) => entry.result)
                .map((entry) => `${entry.eventLabel} ${formatMarkWithUnit(entry.result!.display, entry.result!.unit)}${entry.result!.place ? ` (${ordinal(entry.result!.place)})` : ""}`)
              return (
                <ListRow
                  key={competition.id}
                  to={`/athlete/competitions/${competition.id}`}
                  leading={dayLabel(competition.startDate)}
                  title={competition.name}
                  subtitle={
                    <>
                      {[meetDatesText(competition.startDate, competition.endDate), whereText(competition)].filter(Boolean).join(", ")}
                      <span className="block">{marks.length > 0 ? marks.join(", ") : competed.length > 0 ? "No results entered yet" : "You were not entered"}</span>
                      {missing > 0 ? (
                        <span className="mt-0.5 block">
                          <StatusText tone="amber">
                            {missing} {missing === 1 ? "result" : "results"} to enter
                          </StatusText>
                        </span>
                      ) : null}
                    </>
                  }
                />
              )
            })}
          </List>
        ) : (
          <EmptyState title="No past competitions" body="Once a meet is over it moves here with your results." />
        )}
      </Section>
    </Screen>
  )
}
