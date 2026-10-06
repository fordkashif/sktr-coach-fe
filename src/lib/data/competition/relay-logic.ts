/**
 * Relays: the pure rules, shared by the screens, the mock store and the unit tests. The database
 * applies the same rules in save_relay_entry()
 * (supabase/migrations/20261016100000_result_detail_splits_attempts_relays_rounds.sql).
 *
 * Only relative runtime imports: this file is compiled on its own for the unit tests.
 */
import type { RelayEntry, RelayInput, RelayLeg } from "@/lib/data/competition/types"
import { describeRound, formatMark, inSeason, RESULT_EVENTS, roundSlot, type ResultEvent, type Season } from "../pr/marks"

/** The relay events on the event list: 4x100m, 4x200m, 4x400m. */
export const RELAY_EVENTS: ResultEvent[] = RESULT_EVENTS.filter((event) => event.category === "Relays")

export const RELAY_LEGS = [1, 2, 3, 4] as const

/** Leg splits taken by hand rarely add up exactly: this many seconds either way is accepted. */
export const RELAY_SPLIT_TOLERANCE = 1

/**
 * What the coach typed for a relay. Returns a message in plain words, or null when fine.
 * `emptyLegs` are the legs that may stay without an athlete (an athlete whose data was deleted).
 */
export function validateRelayInput(input: RelayInput, options: { today: string; startDate: string; endDate: string; emptyLegs?: number[] }): string | null {
  if (!RELAY_EVENTS.some((event) => event.key === input.eventKey)) return "Choose a relay event."
  if (!input.teamId) return "Choose the team the relay runs for."
  if ((input.teamLabel ?? "").trim().length > 60) return "Keep the relay team's name to 60 characters."
  if (input.legs.length !== 4 || RELAY_LEGS.some((leg) => input.legs.filter((item) => item.leg === leg).length !== 1)) {
    return "A relay has four legs. Choose an athlete for each."
  }
  const legs = [...input.legs].sort((a, b) => a.leg - b.leg)
  for (const leg of legs) {
    if (!leg.athleteId && !(options.emptyLegs ?? []).includes(leg.leg)) return `Choose an athlete for leg ${leg.leg}.`
  }
  const named = legs.map((leg) => leg.athleteId).filter((id): id is string => Boolean(id))
  if (new Set(named).size !== named.length) return "An athlete can run one leg of a relay. Choose four different athletes."

  const value = input.value ?? null
  if (value !== null && !(value > 0)) return "The time must be more than 0."
  const date = input.date || options.startDate
  if (date < options.startDate || date > options.endDate) return "The date must be a day of the competition."
  if (value !== null && date > options.today) return "This competition has not happened yet, so the relay has no time."

  const splits = legs.map((leg) => leg.split ?? null)
  for (const leg of legs) {
    const split = leg.split ?? null
    if (split === null) continue
    if (!(split > 0)) return `The split of leg ${leg.leg} must be more than 0.`
    if (value !== null && split >= value) return `The split of leg ${leg.leg} (${formatMark(split, "s")}) is larger than the relay's time (${formatMark(value, "s")}).`
  }
  const given = splits.filter((split): split is number => split !== null)
  const sum = Math.round(given.reduce((total, split) => total + split, 0) * 100) / 100
  if (value !== null && given.length > 0 && sum > value + RELAY_SPLIT_TOLERANCE) {
    return `The leg splits add up to ${formatMark(sum, "s")}, more than the relay's time (${formatMark(value, "s")}). Check the splits or the time.`
  }
  if (value !== null && given.length === 4 && Math.abs(sum - value) > RELAY_SPLIT_TOLERANCE) {
    return `The four leg splits add up to ${formatMark(sum, "s")}, but the relay's time is ${formatMark(value, "s")}. Check the splits or the time.`
  }

  const whole = (number: number | null | undefined, max: number) => number === null || number === undefined || (Number.isInteger(number) && number >= 1 && number <= max)
  if (!whole(input.heat, 99)) return "The heat is a whole number, like 2."
  if (!whole(input.lane, 20)) return "The lane is a whole number, like 4."
  if (!whole(input.place, 999)) return "Place must be a whole number from 1 to 999."
  if ((input.notes ?? "").length > 1000) return "Keep the note to 1000 characters."
  return null
}

/** True when two relays would be the same team in the same round of the same event at one competition. */
export function sameRelaySlot(
  a: Pick<RelayEntry, "competitionId" | "eventKey" | "teamLabel" | "round">,
  b: Pick<RelayEntry, "competitionId" | "eventKey" | "teamLabel" | "round">,
): boolean {
  return (
    a.competitionId !== null &&
    a.competitionId === b.competitionId &&
    a.eventKey === b.eventKey &&
    a.teamLabel.trim().toLowerCase() === b.teamLabel.trim().toLowerCase() &&
    roundSlot(a.round) === roundSlot(b.round)
  )
}

/** The leg an athlete ran in a relay. Null when they were not in it. */
export function relayLegOf(relay: Pick<RelayEntry, "legs">, athleteId: string | null | undefined): RelayLeg | null {
  if (!athleteId) return null
  return relay.legs.find((leg) => leg.athleteId === athleteId) ?? null
}

/** "1 Sarah Chen, 2 Marcus Johnson, 3 Sophia Kim, 4 David Okafor" */
export function relayLegsText(relay: Pick<RelayEntry, "legs">, withSplits = false): string {
  return [...relay.legs]
    .sort((a, b) => a.leg - b.leg)
    .map((leg) => `${leg.leg} ${leg.name}${withSplits && leg.split !== null ? ` (${formatMark(leg.split, "s")})` : ""}`)
    .join(withSplits ? "; " : ", ")
}

/** "Final, lane 5, 2nd" without the place: round, heat and lane of a relay. */
export function relayRoundText(relay: Pick<RelayEntry, "round" | "heat" | "lane" | "qualifier">): string {
  return describeRound(relay)
}

/** Negative when `a` is the faster relay. Ties go to the one run first. */
export function compareRelays(a: RelayEntry, b: RelayEntry): number {
  const av = a.compareValue ?? Number.POSITIVE_INFINITY
  const bv = b.compareValue ?? Number.POSITIVE_INFINITY
  if (av !== bv) return av - bv
  if (a.date !== b.date) return a.date.localeCompare(b.date)
  return a.createdAt.localeCompare(b.createdAt)
}

export type RelayTeamRecord = {
  teamId: string
  teamName: string
  eventKey: string
  eventLabel: string
  /** The team's fastest relay in this event. */
  best: RelayEntry
  /** The fastest of the season, when it is not the best ever. Null when it is, or when the team has not run this season. */
  seasonBest: RelayEntry | null
  /** How many times the team has run this relay. */
  count: number
}

/**
 * The relay record list: for each team and relay event, the fastest time ever and of the season.
 * Relays with no time yet, or whose team was deleted, are left out. In event list order, then by team name.
 */
export function relayTeamRecords(relays: RelayEntry[], season: Season): RelayTeamRecord[] {
  const groups = new Map<string, RelayEntry[]>()
  for (const relay of relays) {
    if (relay.value === null || relay.compareValue === null || !relay.teamId) continue
    const key = `${relay.teamId}|${relay.eventKey}`
    groups.set(key, [...(groups.get(key) ?? []), relay])
  }
  const order = (eventKey: string) => RELAY_EVENTS.findIndex((event) => event.key === eventKey)
  return [...groups.values()]
    .map((list) => {
      const sorted = [...list].sort(compareRelays)
      const best = sorted[0]
      const seasonBest = sorted.find((relay) => inSeason(relay.date, season)) ?? null
      return {
        teamId: best.teamId as string,
        teamName: best.teamName ?? best.teamLabel,
        eventKey: best.eventKey,
        eventLabel: best.eventLabel,
        best,
        seasonBest: seasonBest && seasonBest.id !== best.id ? seasonBest : null,
        count: list.length,
      }
    })
    .sort((a, b) => order(a.eventKey) - order(b.eventKey) || a.teamName.localeCompare(b.teamName))
}
