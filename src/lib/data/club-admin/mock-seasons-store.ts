import { addDays, currentSeason, findOverlap, type ClubSeason } from "@/lib/data/club-admin/season-logic"
import { loadClubProfile, saveClubProfile } from "@/lib/mock-club-admin"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Mock mode: the club's seasons, kept in this browser per club.
 *
 * The club profile's season fields always mirror the current season, as they do in the database:
 * a change made through the profile (the setup steps) is picked up here on the next read, and a
 * change made here is written back to the profile.
 */

const SEASONS_KEY = "pacelab:club-seasons"

function shiftYear(day: string, years: number): string {
  const shifted = `${Number(day.slice(0, 4)) + years}${day.slice(4)}`
  // 29 February in a year without one becomes the 28th.
  return shifted.endsWith("-02-29") && addDays(addDays(shifted, 1), -1) !== shifted ? `${shifted.slice(0, 8)}28` : shifted
}

function seedFromProfile(): ClubSeason[] {
  const profile = loadClubProfile()
  const current: ClubSeason = {
    id: "season-current",
    name: profile.seasonYear.trim() || profile.seasonStart.slice(0, 4),
    start: profile.seasonStart,
    end: profile.seasonEnd,
    status: "current",
  }
  // A demo season before it, so history has something to look back on.
  const previous: ClubSeason = {
    id: "season-previous",
    name: /^\d{4}$/.test(current.name) ? String(Number(current.name) - 1) : `${Number(current.start.slice(0, 4)) - 1} season`,
    start: shiftYear(current.start, -1),
    end: shiftYear(current.end, -1),
    status: "past",
  }
  return previous.end < current.start && previous.name !== current.name ? [current, previous] : [current]
}

function readStored(): ClubSeason[] | null {
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(SEASONS_KEY))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const seasons = parsed.filter(
      (item): item is ClubSeason =>
        Boolean(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.start === "string" &&
        typeof item.end === "string" &&
        (item.status === "upcoming" || item.status === "current" || item.status === "past"),
    )
    return seasons.length > 0 ? seasons : null
  } catch {
    return null
  }
}

function write(seasons: ClubSeason[]) {
  window.localStorage.setItem(tenantStorageKey(SEASONS_KEY), JSON.stringify(seasons))
}

export function loadMockSeasons(): ClubSeason[] {
  if (typeof window === "undefined") return []
  const stored = readStored()
  if (!stored) {
    const seeded = seedFromProfile()
    try {
      write(seeded)
    } catch {
      // Storage is blocked: the demo seasons still show, they are just not kept.
    }
    return seeded
  }
  // The profile was changed somewhere else (the setup steps): the current season follows it.
  const profile = loadClubProfile()
  const current = currentSeason(stored)
  if (current && profile.seasonStart && profile.seasonEnd && profile.seasonStart <= profile.seasonEnd) {
    const name = profile.seasonYear.trim() || current.name
    const changed = current.name !== name || current.start !== profile.seasonStart || current.end !== profile.seasonEnd
    if (changed && !findOverlap(stored, { start: profile.seasonStart, end: profile.seasonEnd }, current.id)) {
      const next = stored.map((season) => (season.id === current.id ? { ...season, name, start: profile.seasonStart, end: profile.seasonEnd } : season))
      try {
        write(next)
      } catch {
        // Nothing to do: the next read tries again.
      }
      return next
    }
  }
  return stored
}

/** Saves the seasons and copies the current one onto the club profile. Throws when storage is blocked. */
export function saveMockSeasons(seasons: ClubSeason[]) {
  write(seasons)
  const current = currentSeason(seasons)
  if (!current) return
  const profile = loadClubProfile()
  if (profile.seasonYear !== current.name || profile.seasonStart !== current.start || profile.seasonEnd !== current.end) {
    saveClubProfile({ ...profile, seasonYear: current.name, seasonStart: current.start, seasonEnd: current.end })
  }
}
