"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus } from "@phosphor-icons/react"
import { RelayList } from "@/components/athlete/relay-parts"
import { dayText, eventHistoryPath, markText, ProgressTabs } from "@/components/athlete/results-parts"
import { EmptyState, LinkButton, Notice, Screen, ScreenHeader, Section, SkeletonRows, TileGrid } from "@/components/sk"
import { Link } from "react-router-dom"
import { SeasonPicker } from "@/components/seasons/season-picker"
import { pickableSeasons, type ClubSeason } from "@/lib/data/club-admin/season-logic"
import { listClubSeasons } from "@/lib/data/club-admin/seasons-data"
import { getRelaysForCurrentAthlete, type AthleteRelays } from "@/lib/data/competition/relay-data"
import { formatWind, groupResultsByEvent, type EventHistory } from "@/lib/data/pr/marks"
import { getCurrentAthleteRecords, type AthleteRecords } from "@/lib/data/pr/results-data"

/** `pastSeason` is the name of a past season being looked at; without it the line is about the season now. */
function seasonLine(event: EventHistory, pastSeason: string | null): string {
  const { personalBest, seasonBest } = event.bests
  if (!seasonBest) return pastSeason ? `No mark in ${pastSeason}` : "No mark this season"
  if (personalBest && seasonBest.id === personalBest.id) return pastSeason ? `Set in ${pastSeason}` : "Also your season best"
  return `${pastSeason ? `${pastSeason} best` : "Season best"} ${markText(seasonBest)}, ${dayText(seasonBest.date)}`
}

/** One event as a scoreboard tile: the best mark big, where and when it was set, the season line under it. */
function EventTile({ event, pastSeason, index }: { event: EventHistory; pastSeason: string | null; index: number }) {
  const { personalBest, windAssistedBest } = event.bests
  const lead = personalBest ?? windAssistedBest ?? event.results[0]
  const seasonIsBest = Boolean(personalBest && event.bests.seasonBest && event.bests.seasonBest.id === personalBest.id)
  return (
    <li className="sk-tile-item" style={{ animationDelay: `${index * 60}ms` }}>
      <Link to={eventHistoryPath(event.group)} className="sk-tile flex h-full flex-col gap-2 p-4 text-sk-ink" data-record-event={event.label}>
        <span className="flex items-start justify-between gap-2">
          <span className="font-display text-[1.375rem] font-black uppercase leading-none">{event.label}</span>
          <span className="shrink-0 text-[0.75rem] font-bold text-sk-mute">
            {event.results.length} {event.results.length === 1 ? "result" : "results"}
          </span>
        </span>
        <span className="flex flex-wrap items-end gap-2">
          <span className="font-display text-[2.75rem] font-black leading-[0.9] tabular-nums">{markText(lead).replace(/ \(.*\)$/, "")}</span>
          {seasonIsBest && !pastSeason ? <span className="mb-1 rounded-full bg-sk-accent px-2 py-0.5 text-[0.6875rem] font-extrabold uppercase tracking-[0.04em] text-sk-on-accent">PB this season</span> : null}
        </span>
        <span className="mt-auto block text-[0.8125rem] leading-snug text-sk-mute">
          {personalBest ? (
            <>
              Personal best {[dayText(personalBest.date), personalBest.location].filter(Boolean).join(", ")}
              {personalBest.wind !== null ? `, wind ${formatWind(personalBest.wind)}` : ""}
            </>
          ) : (
            "No wind legal mark yet"
          )}
          <span className="block font-semibold">{seasonLine(event, pastSeason)}</span>
          {windAssistedBest ? <span className="block">Wind assisted {markText(windAssistedBest)}</span> : null}
        </span>
      </Link>
    </li>
  )
}

export default function AthleteRecordsPage() {
  const [records, setRecords] = useState<AthleteRecords | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seasons, setSeasons] = useState<ClubSeason[]>([])
  const [seasonId, setSeasonId] = useState<string | null>(null)
  const [relays, setRelays] = useState<AthleteRelays | null>(null)

  useEffect(() => {
    let cancelled = false
    void getRelaysForCurrentAthlete().then((result) => {
      if (!cancelled && result.ok) setRelays(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

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
  // Relays that were run. A team that is entered and has no time yet shows on the competition's own screen.
  const relaysRun = (relays?.relays ?? []).filter((relay) => relay.value !== null)
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
            <TileGrid label={`${category} records`}>
              {inCategory.map((event, index) => (
                <EventTile key={event.group} event={event} pastSeason={chosen?.name ?? null} index={index} />
              ))}
            </TileGrid>
          </Section>
        )
      })}

      {relaysRun.length > 0 ? (
        <Section
          title="Relay teams"
          meta={`${relaysRun.length} ${relaysRun.length === 1 ? "relay" : "relays"}`}
        >
          <RelayList aria-label="Relays you ran in" relays={relaysRun} ownAthleteId={relays?.athleteId} showMeet />
        </Section>
      ) : null}
    </Screen>
  )
}
