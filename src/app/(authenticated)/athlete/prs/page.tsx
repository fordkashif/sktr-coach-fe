"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus } from "@phosphor-icons/react"
import { dayText, eventHistoryPath, markText, ProgressTabs, ResultMark } from "@/components/athlete/results-parts"
import { EmptyState, LinkButton, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { SeasonPicker } from "@/components/seasons/season-picker"
import { pickableSeasons, type ClubSeason } from "@/lib/data/club-admin/season-logic"
import { listClubSeasons } from "@/lib/data/club-admin/seasons-data"
import { formatWind, groupResultsByEvent, type EventHistory } from "@/lib/data/pr/marks"
import { getCurrentAthleteRecords, type AthleteRecords } from "@/lib/data/pr/results-data"

/** `pastSeason` is the name of a past season being looked at; without it the line is about the season now. */
function seasonLine(event: EventHistory, pastSeason: string | null): string {
  const { personalBest, seasonBest } = event.bests
  if (!seasonBest) return pastSeason ? `No mark in ${pastSeason}` : "No mark this season"
  if (personalBest && seasonBest.id === personalBest.id) return pastSeason ? `Set in ${pastSeason}` : "Also your season best"
  return `${pastSeason ? `${pastSeason} best` : "Season best"} ${markText(seasonBest)}, ${dayText(seasonBest.date)}`
}

function EventRow({ event, pastSeason }: { event: EventHistory; pastSeason: string | null }) {
  const { personalBest, windAssistedBest } = event.bests
  const lead = personalBest ?? windAssistedBest ?? event.results[0]
  return (
    <ListRow
      to={eventHistoryPath(event.group)}
      title={event.label}
      subtitle={
        <>
          {personalBest ? (
            <>
              Personal best {[dayText(personalBest.date), personalBest.location].filter(Boolean).join(", ")}
              {personalBest.wind !== null ? `, wind ${formatWind(personalBest.wind)}` : ""}
            </>
          ) : (
            "No wind legal mark yet"
          )}
          <span className="block">{seasonLine(event, pastSeason)}</span>
          {windAssistedBest ? <span className="block">Wind assisted {markText(windAssistedBest)}</span> : null}
        </>
      }
      trailing={
        <span className="flex flex-col items-end gap-1">
          <ResultMark result={lead} />
          <span className="text-sm font-normal text-sk-mute">
            {event.results.length} {event.results.length === 1 ? "result" : "results"}
          </span>
        </span>
      }
    />
  )
}

export default function AthleteRecordsPage() {
  const [records, setRecords] = useState<AthleteRecords | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seasons, setSeasons] = useState<ClubSeason[]>([])
  const [seasonId, setSeasonId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listClubSeasons().then((result) => {
      if (!cancelled && result.ok) setSeasons(pickableSeasons(result.data))
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void getCurrentAthleteRecords().then((result) => {
      if (cancelled) return
      if (result.ok) setRecords(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // A past season chosen in the picker. The current season (or none chosen) is what the records came with.
  const chosen = seasons.find((season) => season.id === seasonId && season.status === "past") ?? null
  const events = useMemo(
    () => (records ? (chosen ? groupResultsByEvent(records.results, { start: chosen.start, end: chosen.end }) : records.events) : []),
    [records, chosen],
  )
  const categories = [...new Set(events.map((event) => event.category))]
  const seasonYear = chosen ? chosen.name : records ? `${records.season.start.slice(0, 4)}${records.season.end.slice(0, 4) !== records.season.start.slice(0, 4) ? ` to ${records.season.end.slice(0, 4)}` : ""}` : ""

  return (
    <Screen>
      <ScreenHeader
        title="Records"
        lede={
          events.length > 0
            ? `Your personal best and ${seasonYear} season best in ${events.length} ${events.length === 1 ? "event" : "events"}, worked out from every result you have. Wind assisted marks (over +2.0) are listed apart.`
            : "Your personal best and season best in every event, worked out from your results."
        }
        actions={
          <LinkButton to="/athlete/prs/add" variant="primary">
            <Plus className="size-[18px]" weight="bold" aria-hidden />
            Add a result
          </LinkButton>
        }
      />
      <ProgressTabs />

      {records && events.length > 0 ? (
        <SeasonPicker
          className="sm:max-w-xs"
          label="Season bests for"
          seasons={seasons}
          value={chosen?.id ?? seasons.find((season) => season.status === "current")?.id ?? ""}
          onChange={setSeasonId}
        />
      ) : null}

      {error ? <Notice tone="error">Your records could not be loaded. {error}</Notice> : null}

      {records === null && !error ? (
        <Section title="Loading your records">
          <SkeletonRows rows={5} label="Loading your records" />
        </Section>
      ) : null}

      {records && events.length === 0 ? (
        <Section title="No records yet">
          <EmptyState
            title="Your first result in an event becomes your record"
            body="Results come in from test weeks and competitions, and you can add one yourself. Beat a mark and the new one takes its place here."
            action={
              <LinkButton to="/athlete/test-week" size="sm">
                Go to tests
              </LinkButton>
            }
          />
        </Section>
      ) : null}

      {categories.map((category) => {
        const inCategory = events.filter((event) => event.category === category)
        return (
          <Section key={category} title={category} meta={`${inCategory.length} ${inCategory.length === 1 ? "event" : "events"}`}>
            <List>
              {inCategory.map((event) => (
                <EventRow key={event.group} event={event} pastSeason={chosen?.name ?? null} />
              ))}
            </List>
          </Section>
        )
      })}

    </Screen>
  )
}
