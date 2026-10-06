/**
 * Seasons: the pure rules, shared by the mock store, the screens and the unit tests.
 * The database enforces the same rules (supabase/migrations/20261014090000_seasons_and_rollover.sql).
 * Dates are ISO days (YYYY-MM-DD), compared as text.
 */

export type SeasonStatus = "upcoming" | "current" | "past"

export type ClubSeason = {
  id: string
  /** What the club calls it: "2026/27 outdoor". */
  name: string
  start: string
  end: string
  status: SeasonStatus
}

export type SeasonWindow = { start: string; end: string }

export type SeasonDraft = { name: string; start: string; end: string }

export const SEASON_NAME_MAX = 60

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function isDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** The day before or after an ISO day. */
export function addDays(day: string, amount: number): string {
  const [year, month, date] = day.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10)
}

/** Two date ranges share at least one day. */
export function rangesOverlap(a: SeasonWindow, b: SeasonWindow): boolean {
  return a.start <= b.end && b.start <= a.end
}

/** The first other season these dates would share a day with, or null. */
export function findOverlap(seasons: ClubSeason[], candidate: SeasonWindow, ignoreId?: string | null): ClubSeason | null {
  return (
    [...seasons]
      .sort((a, b) => a.start.localeCompare(b.start))
      .find((season) => season.id !== ignoreId && rangesOverlap(season, candidate)) ?? null
  )
}

/** The season a date falls in, or null when it is between seasons. */
export function seasonForDate(seasons: ClubSeason[], date: string): ClubSeason | null {
  const day = date.slice(0, 10)
  return seasons.find((season) => season.start <= day && day <= season.end) ?? null
}

export function currentSeason(seasons: ClubSeason[]): ClubSeason | null {
  return seasons.find((season) => season.status === "current") ?? null
}

function calendarYear(today: string): SeasonWindow {
  const year = today.slice(0, 4)
  return { start: `${year}-01-01`, end: `${year}-12-31` }
}

/**
 * The window season bests are counted in today: the club's current season from its first day until
 * its last day has passed, otherwise the calendar year. Right after a rollover that is the new
 * season, so season bests start again from its first day.
 */
export function seasonBestWindow(seasons: ClubSeason[], today: string): SeasonWindow {
  const current = currentSeason(seasons)
  if (current && today <= current.end) return { start: current.start, end: current.end }
  return calendarYear(today)
}

/** Newest first: upcoming seasons, then the current one, then past ones. */
export function sortSeasons(seasons: ClubSeason[]): ClubSeason[] {
  return [...seasons].sort((a, b) => b.start.localeCompare(a.start))
}

/** Seasons someone can look back through: the current one and past ones, newest first. */
export function pickableSeasons(seasons: ClubSeason[]): ClubSeason[] {
  return sortSeasons(seasons).filter((season) => season.status !== "upcoming")
}

export type SeasonDraftErrors = Partial<Record<keyof SeasonDraft, string>>

/** Checks a name and dates against the club's other seasons. */
export function validateSeasonDraft(
  draft: SeasonDraft,
  seasons: ClubSeason[],
  ignoreId?: string | null,
): { ok: true; data: SeasonDraft } | { ok: false; errors: SeasonDraftErrors } {
  const errors: SeasonDraftErrors = {}
  const name = draft.name.trim()
  if (!name) errors.name = "Give the season a name, like 2026/27 outdoor."
  else if (name.length > SEASON_NAME_MAX) errors.name = `Keep the name to ${SEASON_NAME_MAX} characters or fewer.`
  else if (seasons.some((season) => season.id !== ignoreId && season.name.trim().toLowerCase() === name.toLowerCase())) {
    errors.name = "Another season already has this name."
  }
  if (!isDay(draft.start)) errors.start = "Pick the first day of the season."
  if (!isDay(draft.end)) errors.end = "Pick the last day of the season."
  if (!errors.start && !errors.end) {
    if (draft.start > draft.end) errors.end = "The season must end on or after the day it starts."
    else {
      const clash = findOverlap(seasons, draft, ignoreId)
      if (clash) errors.start = `These dates overlap ${clash.name} (${clash.start} to ${clash.end}). Seasons cannot share a day.`
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, data: { name, start: draft.start, end: draft.end } }
}

/* ---------- Rollover ---------------------------------------------------------------------------- */

export type TeamChoice = "carry" | "archive"

export type RolloverTeam = { id: string; name: string; athleteCount: number }

export type RolloverPlan = {
  /** The season being started, with the confirmed name and dates. */
  seasonId: string
  draft: SeasonDraft
  /** Team id to choice. A team that is not listed carries on. */
  teamChoices: Record<string, TeamChoice>
  endPlans: boolean
}

export type RolloverSummary = {
  newSeason: SeasonDraft
  /** The season that ends, with the day it will end on. Null for a club's first season. */
  oldSeason: { name: string; start: string; end: string; endsEarly: boolean } | null
  archivedTeams: RolloverTeam[]
  carriedTeams: RolloverTeam[]
  athletesUnassigned: number
  plansEnded: number
  plansCarried: number
}

/**
 * Checks the first step of the rollover. Unlike a plain edit, the new season may overlap the
 * season that is ending (that one is cut short), but it has to start after that one started and it
 * cannot share a day with any other season.
 */
export function validateRolloverDraft(
  draft: SeasonDraft,
  seasons: ClubSeason[],
  seasonId: string,
): { ok: true; data: SeasonDraft } | { ok: false; errors: SeasonDraftErrors } {
  const old = currentSeason(seasons)
  const others = seasons.filter((season) => season.id !== old?.id)
  const checked = validateSeasonDraft(draft, others, seasonId)
  if (!checked.ok) return checked
  if (old && old.name.trim().toLowerCase() === checked.data.name.toLowerCase()) {
    return { ok: false, errors: { name: "Another season already has this name." } }
  }
  if (old && old.start >= checked.data.start) {
    return { ok: false, errors: { start: `The new season has to start after the first day of ${old.name} (${old.start}).` } }
  }
  return checked
}

/** Exactly what the rollover will change. The database does the same thing in one transaction. */
export function summarizeRollover(plan: RolloverPlan, seasons: ClubSeason[], teams: RolloverTeam[], publishedPlans: number): RolloverSummary {
  const old = currentSeason(seasons)
  const endsEarly = Boolean(old && old.end >= plan.draft.start)
  const archivedTeams = teams.filter((team) => plan.teamChoices[team.id] === "archive")
  const carriedTeams = teams.filter((team) => plan.teamChoices[team.id] !== "archive")
  return {
    newSeason: plan.draft,
    oldSeason: old ? { name: old.name, start: old.start, end: endsEarly ? addDays(plan.draft.start, -1) : old.end, endsEarly } : null,
    archivedTeams,
    carriedTeams,
    athletesUnassigned: archivedTeams.reduce((total, team) => total + team.athleteCount, 0),
    plansEnded: plan.endPlans ? publishedPlans : 0,
    plansCarried: plan.endPlans ? 0 : publishedPlans,
  }
}

/** The seasons after a rollover. Nothing is removed. */
export function applyRolloverToSeasons(seasons: ClubSeason[], plan: RolloverPlan): ClubSeason[] {
  const old = currentSeason(seasons)
  return seasons.map((season) => {
    if (season.id === plan.seasonId) return { ...season, name: plan.draft.name.trim(), start: plan.draft.start, end: plan.draft.end, status: "current" as const }
    if (old && season.id === old.id) return { ...season, status: "past" as const, end: season.end >= plan.draft.start ? addDays(plan.draft.start, -1) : season.end }
    return season
  })
}
