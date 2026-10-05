"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus } from "@phosphor-icons/react"
import { meetDatesText } from "@/components/athlete/results-parts"
import { COMPETITIONS_PATH, competitionPath, countdownText, plural, scopeText, whereText } from "@/components/coach/competitions/competition-parts"
import { DayLabel, EmptyState, LinkButton, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows, StatusText } from "@/components/sk"
import { useCoachTeamScope } from "@/lib/coach-teams"
import { getCompetitionsForStaff, splitCompetitions } from "@/lib/data/competition/competition-data"
import type { CompetitionWithEntries } from "@/lib/data/competition/types"
import { parseLocalDay } from "@/lib/data/pr/pr-display"

function dayLabel(date: string) {
  const day = parseLocalDay(date) ?? new Date()
  return <DayLabel weekday={day.toLocaleDateString(undefined, { month: "short" })} number={day.getDate()} />
}

function entriesLine(competition: CompetitionWithEntries): string {
  const entered = competition.entries.filter((entry) => entry.status === "entered")
  if (entered.length === 0) return "No one entered yet"
  const athletes = new Set(entered.map((entry) => entry.athleteId)).size
  return `${plural(athletes, "athlete", "athletes")} in ${plural(entered.length, "event", "events")}`
}

export default function CoachCompetitionsPage() {
  const { coachTeamId, coachTeams, coachTeamsLoading } = useCoachTeamScope()
  // One calendar per team: switching team starts clean, never the last team's meets.
  return <Calendar key={coachTeamId ?? "all"} teamId={coachTeamId} teamName={coachTeams.find((team) => team.id === coachTeamId)?.name ?? null} waiting={coachTeamsLoading} />
}

function Calendar({ teamId, teamName, waiting }: { teamId: string | null; teamName: string | null; waiting: boolean }) {
  const [competitions, setCompetitions] = useState<CompetitionWithEntries[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])

  useEffect(() => {
    if (waiting) return
    let cancelled = false
    void getCompetitionsForStaff({ teamId }).then((result) => {
      if (cancelled) return
      if (result.ok) setCompetitions(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [teamId, waiting])

  const { upcoming, past } = splitCompetitions(competitions ?? [])
  const loading = competitions === null && !error
  const toEnter = past.reduce((sum, competition) => sum + competition.entries.filter((entry) => entry.status === "entered" && !entry.result).length, 0)
  const lede = loading
    ? "Getting the season calendar..."
    : upcoming.length === 0 && past.length === 0
      ? `No meets on ${teamName ? `the ${teamName} calendar` : "the calendar"} yet. Add the first one and enter your athletes.`
      : `${teamName ? `${teamName}: ` : ""}${plural(upcoming.length, "meet", "meets")} coming up${toEnter > 0 ? `, ${plural(toEnter, "result", "results")} still to enter` : ""}.`

  return (
    <Screen>
      <ScreenHeader
        title="Competitions"
        lede={lede}
        actions={
          <LinkButton to={`${COMPETITIONS_PATH}/new`} variant="primary">
            <Plus className="size-[18px]" weight="bold" aria-hidden />
            Add competition
          </LinkButton>
        }
      />

      {error ? <Notice tone="error">The calendar could not be loaded. {error}</Notice> : null}

      <Section title="Coming up" meta={upcoming.length > 0 ? plural(upcoming.length, "meet", "meets") : undefined}>
        {loading ? (
          <SkeletonRows rows={2} leading label="Loading competitions" />
        ) : upcoming.length > 0 ? (
          <List>
            {upcoming.map((competition) => (
              <ListRow
                key={competition.id}
                to={competitionPath(competition.id)}
                leading={dayLabel(competition.startDate)}
                title={competition.name}
                subtitle={
                  <>
                    {[meetDatesText(competition.startDate, competition.endDate), whereText(competition), scopeText(competition)].filter(Boolean).join(", ")}
                    <span className="block">{entriesLine(competition)}</span>
                  </>
                }
                trailing={<span className="font-normal text-sk-mute">{countdownText(competition.startDate, today)}</span>}
              />
            ))}
          </List>
        ) : (
          <EmptyState
            title="Nothing coming up"
            body="Add a meet, then enter your athletes in their events. They are told straight away, and meets they add themselves show up here too."
            action={
              <LinkButton to={`${COMPETITIONS_PATH}/new`} size="sm">
                Add competition
              </LinkButton>
            }
          />
        )}
      </Section>

      <Section title="Past" meta={past.length > 0 ? plural(past.length, "meet", "meets") : undefined}>
        {loading ? (
          <SkeletonRows rows={3} leading label="Loading past competitions" />
        ) : past.length > 0 ? (
          <List>
            {past.map((competition) => {
              const competed = competition.entries.filter((entry) => entry.status === "entered")
              const missing = competed.filter((entry) => !entry.result).length
              const done = competed.length - missing
              return (
                <ListRow
                  key={competition.id}
                  to={competitionPath(competition.id)}
                  leading={dayLabel(competition.startDate)}
                  title={competition.name}
                  subtitle={
                    <>
                      {[meetDatesText(competition.startDate, competition.endDate), whereText(competition), scopeText(competition)].filter(Boolean).join(", ")}
                      <span className="block">{competed.length === 0 ? "No one was entered" : `${done} of ${plural(competed.length, "result", "results")} in`}</span>
                      {missing > 0 ? (
                        <span className="mt-0.5 block">
                          <StatusText tone="amber">{plural(missing, "result", "results")} to enter</StatusText>
                        </span>
                      ) : null}
                    </>
                  }
                />
              )
            })}
          </List>
        ) : (
          <EmptyState title="No past competitions" body="Once a meet is over it moves here, ready for you to type in the results." />
        )}
      </Section>
    </Screen>
  )
}
