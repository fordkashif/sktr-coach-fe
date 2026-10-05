"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus, X } from "@phosphor-icons/react"
import { useNavigate, useParams } from "react-router-dom"
import { meetDatesText } from "@/components/athlete/results-parts"
import { competitionPath, plural } from "@/components/coach/competitions/competition-parts"
import { ActionBar, Button, EmptyState, Input, Notice, PersonPicker, Screen, ScreenHeader, Section, Select, SkeletonRows, StatusText, type PickerPerson } from "@/components/sk"
import { useAvatarLookup } from "@/lib/account-store"
import { useCoachTeamScope } from "@/lib/coach-teams"
import { availabilityCovers, describeAvailability, listAthleteAvailability, type AthleteAvailability } from "@/lib/data/athlete/availability-data"
import { enterAthletesInCompetition, getCompetitionForStaff } from "@/lib/data/competition/competition-data"
import { getStaffAthletes, primaryEventKey, type StaffAthlete } from "@/lib/data/competition/staff-roster"
import type { CompetitionWithEntries } from "@/lib/data/competition/types"
import { eventGroupKey, OTHER_EVENT_KEY, RESULT_EVENTS } from "@/lib/data/pr/marks"
import { localDayKey } from "@/lib/data/pr/pr-display"

const CATEGORY_GROUPS = [...new Set(RESULT_EVENTS.filter((event) => event.kind !== "other").map((event) => event.category))]

/** One event an athlete is being entered in. `other` is the name of an event that is not on the list. */
type EventChoice = { key: string; other: string }

function capital(text: string) {
  return text.replace(/^./, (letter) => letter.toUpperCase())
}

export default function CoachEnterAthletesPage() {
  const { competitionId = "" } = useParams()
  const navigate = useNavigate()
  const avatarOf = useAvatarLookup()
  const { coachTeamId, coachTeamsLoading } = useCoachTeamScope()
  const [competition, setCompetition] = useState<CompetitionWithEntries | null | undefined>(undefined)
  const [roster, setRoster] = useState<StaffAthlete[] | null>(null)
  const [availability, setAvailability] = useState<AthleteAvailability[]>([])
  const [chosen, setChosen] = useState<string[]>([])
  const [events, setEvents] = useState<Record<string, EventChoice[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const today = useMemo(() => localDayKey(new Date()), [])

  useEffect(() => {
    if (coachTeamsLoading) return
    let cancelled = false
    void (async () => {
      const competitionResult = await getCompetitionForStaff(competitionId)
      if (cancelled) return
      if (!competitionResult.ok) {
        setError(competitionResult.error.message)
        return
      }
      setCompetition(competitionResult.data)
      if (!competitionResult.data) return
      // A team's meet takes that team's athletes. A club wide meet, or an athlete's own, takes the selected team (a club admin: everyone).
      const teamId = competitionResult.data.scope === "team" ? competitionResult.data.teamId : coachTeamId
      const rosterResult = await getStaffAthletes({ teamId })
      if (cancelled) return
      if (!rosterResult.ok) {
        setError(rosterResult.error.message)
        return
      }
      setRoster(rosterResult.data)
      const availabilityResult = await listAthleteAvailability(
        rosterResult.data.map((athlete) => athlete.id),
        { from: competitionResult.data.startDate },
      )
      if (!cancelled && availabilityResult.ok) setAvailability(availabilityResult.data)
    })()
    return () => {
      cancelled = true
    }
  }, [competitionId, coachTeamId, coachTeamsLoading])

  const backTo = competitionPath(competitionId)

  /** Event groups each athlete is already entered in at this meet. */
  const taken = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const entry of competition?.entries ?? []) {
      const set = map.get(entry.athleteId) ?? new Set<string>()
      set.add(entry.eventGroup)
      map.set(entry.athleteId, set)
    }
    return map
  }, [competition])

  const awayOnTheDay = (athleteId: string) =>
    competition
      ? (availability.find(
          (period) => period.athleteId === athleteId && period.endedAt === null && (availabilityCovers(period, competition.startDate) || availabilityCovers(period, competition.endDate)),
        ) ?? null)
      : null

  const handleChosen = (ids: string[]) => {
    setFormError(null)
    setChosen(ids)
    setEvents((current) => {
      const next = { ...current }
      for (const id of ids) {
        if (next[id]) continue
        // Start from the athlete's primary event, unless they are already entered in it.
        const athlete = roster?.find((item) => item.id === id)
        const key = primaryEventKey(athlete?.primaryEvent)
        next[id] = [{ key: key && !taken.get(id)?.has(`k:${key}`) ? key : "", other: "" }]
      }
      return next
    })
  }

  const setChoice = (athleteId: string, index: number, patch: Partial<EventChoice>) =>
    setEvents((current) => ({ ...current, [athleteId]: (current[athleteId] ?? []).map((choice, at) => (at === index ? { ...choice, ...patch } : choice)) }))

  const chosenAthletes = (roster ?? []).filter((athlete) => chosen.includes(athlete.id))
  const eventCount = chosenAthletes.reduce((sum, athlete) => sum + (events[athlete.id] ?? []).filter((choice) => choice.key).length, 0)
  const away = chosenAthletes.flatMap((athlete) => {
    const period = awayOnTheDay(athlete.id)
    return period ? [`${athlete.name} is marked ${describeAvailability(period, today)}`] : []
  })

  const submit = async () => {
    setFormError(null)
    const payload: Array<{ athleteId: string; eventKey: string; eventLabel: string | null }> = []
    for (const athlete of chosenAthletes) {
      const picked = (events[athlete.id] ?? []).filter((choice) => choice.key)
      if (picked.length === 0) {
        setFormError(`Choose an event for ${athlete.name}, or untick them.`)
        return
      }
      const groups = new Set<string>()
      for (const choice of picked) {
        if (choice.key === OTHER_EVENT_KEY && !choice.other.trim()) {
          setFormError(`Name the other event for ${athlete.name}.`)
          return
        }
        const group = eventGroupKey(choice.key, choice.other)
        if (groups.has(group) || taken.get(athlete.id)?.has(group)) {
          setFormError(`${athlete.name} has the same event twice.`)
          return
        }
        groups.add(group)
        payload.push({ athleteId: athlete.id, eventKey: choice.key, eventLabel: choice.key === OTHER_EVENT_KEY ? choice.other : null })
      }
    }
    if (payload.length === 0) {
      setFormError("Tick at least one athlete.")
      return
    }
    setSaving(true)
    const result = await enterAthletesInCompetition(competitionId, payload)
    setSaving(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    navigate(backTo, {
      replace: true,
      state: { saved: { tone: "success", text: `${plural(chosenAthletes.length, "athlete", "athletes")} entered in ${plural(payload.length, "event", "events")}. Athletes with a login have been told.` } },
    })
  }

  const people: PickerPerson[] = (roster ?? []).map((athlete) => {
    const period = awayOnTheDay(athlete.id)
    const already = [...(competition?.entries ?? [])].filter((entry) => entry.athleteId === athlete.id).map((entry) => entry.eventLabel)
    return {
      id: athlete.id,
      name: athlete.name,
      avatarSrc: avatarOf({ athleteId: athlete.id }),
      detail: already.length > 0 ? `Already in: ${already.join(", ")}` : (athlete.primaryEvent ?? "No primary event set"),
      status: period ? <StatusText tone="amber">{capital(describeAvailability(period, today))}</StatusText> : <StatusText tone="green">Available</StatusText>,
    }
  })

  const loading = (competition === undefined || (competition && roster === null)) && !error

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: backTo, label: competition?.name ?? "Competition" }}
        title="Enter athletes"
        lede={competition ? `${competition.name}, ${meetDatesText(competition.startDate, competition.endDate)}. Tick the athletes, check their events, then enter them all at once.` : undefined}
      />

      {error ? <Notice tone="error">This could not be loaded. {error}</Notice> : null}
      {competition === null ? <Notice tone="info">This competition no longer exists.</Notice> : null}

      {loading ? (
        <Section title="Athletes">
          <SkeletonRows rows={5} leading label="Loading the roster" />
        </Section>
      ) : null}

      {competition && roster ? (
        <Section title="Athletes" meta={chosen.length > 0 ? `${chosen.length} chosen` : undefined} hint="Each athlete starts with their primary event. Add more events under their name.">
          {roster.length > 0 ? (
            <PersonPicker
              multiple
              label="Athletes to enter"
              people={people}
              value={chosen}
              onChange={handleChosen}
              renderChosen={(person) => {
                const choices = events[person.id] ?? []
                const entered = taken.get(person.id) ?? new Set<string>()
                return (
                  <div className="flex flex-col gap-2">
                    {choices.map((choice, index) => (
                      <div key={index} className="flex flex-wrap items-center gap-2">
                        <Select
                          aria-label={`Event ${index + 1} for ${person.name}`}
                          className="min-w-0 flex-1 basis-48"
                          value={choice.key}
                          onChange={(event) => setChoice(person.id, index, { key: event.target.value })}
                        >
                          <option value="">Choose an event</option>
                          {CATEGORY_GROUPS.map((category) => (
                            <optgroup key={category} label={category}>
                              {RESULT_EVENTS.filter((item) => item.category === category).map((item) => {
                                const used = entered.has(`k:${item.key}`) || choices.some((other, at) => at !== index && other.key === item.key)
                                return (
                                  <option key={item.key} value={item.key} disabled={used}>
                                    {item.name}
                                    {entered.has(`k:${item.key}`) ? " (entered)" : ""}
                                  </option>
                                )
                              })}
                            </optgroup>
                          ))}
                          <optgroup label="Something else">
                            <option value={OTHER_EVENT_KEY}>Another event</option>
                          </optgroup>
                        </Select>
                        {choice.key === OTHER_EVENT_KEY ? (
                          <Input
                            aria-label={`Name of the other event for ${person.name}`}
                            className="min-w-0 flex-1 basis-40"
                            value={choice.other}
                            maxLength={80}
                            placeholder="Medley relay"
                            onChange={(event) => setChoice(person.id, index, { other: event.target.value })}
                          />
                        ) : null}
                        {choices.length > 1 ? (
                          <button
                            type="button"
                            className="sk-icon-btn"
                            aria-label={`Remove event ${index + 1} for ${person.name}`}
                            onClick={() => setEvents((current) => ({ ...current, [person.id]: (current[person.id] ?? []).filter((_, at) => at !== index) }))}
                          >
                            <X className="size-5" weight="bold" aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    ))}
                    <Button
                      variant="quiet"
                      size="sm"
                      className="self-start"
                      aria-label={`Add another event for ${person.name}`}
                      onClick={() => setEvents((current) => ({ ...current, [person.id]: [...(current[person.id] ?? []), { key: "", other: "" }] }))}
                    >
                      <Plus className="size-[18px]" weight="bold" aria-hidden />
                      Add another event
                    </Button>
                  </div>
                )
              }}
            />
          ) : (
            <EmptyState title="No athletes on this roster" body="Invite athletes to the team first, then enter them here." />
          )}
        </Section>
      ) : null}

      {away.length > 0 ? <Notice tone="warning">{away.join(". ")}. You can still enter them.</Notice> : null}
      {formError ? <Notice tone="error">{formError}</Notice> : null}

      {competition && roster && roster.length > 0 ? (
        <ActionBar aria-label="Enter athletes">
          <p className="min-w-0 text-[0.9375rem] font-semibold text-sk-ink">{chosen.length === 0 ? "No athletes chosen" : `${plural(chosen.length, "athlete", "athletes")}, ${plural(eventCount, "event", "events")}`}</p>
          <Button variant="primary" disabled={saving || chosen.length === 0} onClick={() => void submit()}>
            {saving ? "Entering..." : chosen.length > 1 ? `Enter ${chosen.length} athletes` : "Enter athlete"}
          </Button>
        </ActionBar>
      ) : null}
    </Screen>
  )
}
