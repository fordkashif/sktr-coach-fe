// The club's time zone: pure helpers, no DOM and no network.
// Reminders are timed in it (supabase/migrations/20261011120000_reminders.sql). The database
// refuses a name it does not know; these helpers keep the picker to names a browser knows.

export const DEFAULT_CLUB_TIMEZONE = "America/Jamaica"

/** Shown first in the picker: where the clubs using the app are most likely to be. */
const COMMON_TIMEZONES = [
  "America/Jamaica",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Port_of_Spain",
  "America/Barbados",
  "America/Nassau",
  "Europe/London",
  "UTC",
]

/** True for an IANA name this runtime can format dates in. */
export function isKnownTimezone(value: string | null | undefined): value is string {
  const name = value?.trim()
  if (!name || name.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(name)) return false
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: name })
    return true
  } catch {
    return false
  }
}

/** The name to use: the given one when it is known, otherwise the default. */
export function cleanClubTimezone(value: string | null | undefined): string {
  return isKnownTimezone(value) ? value.trim() : DEFAULT_CLUB_TIMEZONE
}

/** "America/Port_of_Spain" reads as "Port of Spain (America)". */
export function timezoneLabel(name: string): string {
  if (name === "UTC") return "UTC"
  const parts = name.split("/")
  const city = parts[parts.length - 1].replace(/_/g, " ")
  const area = parts.slice(0, -1).join(", ").replace(/_/g, " ")
  return area ? `${city} (${area})` : city
}

/** "UTC-5", "UTC+5:30", "UTC" at the given moment. Empty when the zone is not known. */
export function timezoneOffsetLabel(name: string, at: Date = new Date()): string {
  const minutes = timezoneOffsetMinutes(name, at)
  if (minutes === null) return ""
  if (minutes === 0) return "UTC"
  const sign = minutes > 0 ? "+" : "-"
  const hours = Math.floor(Math.abs(minutes) / 60)
  const rest = Math.abs(minutes) % 60
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`
}

/** Minutes east of UTC at the given moment, or null when the zone is not known. */
export function timezoneOffsetMinutes(name: string, at: Date = new Date()): number | null {
  const parts = localParts(name, at)
  if (!parts) return null
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  const exact = Math.floor(at.getTime() / 60_000) * 60_000
  return Math.round((asUtc - exact) / 60_000)
}

/** The clock in that zone, "07:05" (24 hour). Empty when the zone is not known. */
export function localClockIn(name: string, at: Date = new Date()): string {
  const parts = localParts(name, at)
  return parts ? `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}` : ""
}

/** The calendar day in that zone, "2026-10-13". Empty when the zone is not known. */
export function localDayIn(name: string, at: Date = new Date()): string {
  const parts = localParts(name, at)
  return parts ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` : ""
}

function localParts(name: string, at: Date) {
  if (!isKnownTimezone(name) || Number.isNaN(at.getTime())) return null
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: name,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at)
  const read = (type: string) => Number(formatted.find((part) => part.type === type)?.value)
  const result = { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute") }
  return Object.values(result).some((value) => Number.isNaN(value)) ? null : result
}

export type TimezoneOption = { value: string; label: string }

/**
 * The picker's options: the common ones first, then every zone the browser knows, by name.
 * `current` is always in the list, so a saved value is never dropped from the picker.
 */
export function timezoneOptions(current?: string | null, all?: string[]): { common: TimezoneOption[]; others: TimezoneOption[] } {
  const supported = all ?? supportedTimezones()
  const known = new Set(supported)
  const common = COMMON_TIMEZONES.filter((name) => isKnownTimezone(name))
  const commonSet = new Set(common)
  const others = supported.filter((name) => !commonSet.has(name))
  const saved = current?.trim()
  if (saved && isKnownTimezone(saved) && !commonSet.has(saved) && !known.has(saved)) others.unshift(saved)
  const option = (name: string): TimezoneOption => ({ value: name, label: timezoneLabel(name) })
  return { common: common.map(option), others: others.sort((a, b) => a.localeCompare(b)).map(option) }
}

function supportedTimezones(): string[] {
  try {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
    return intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : []
  } catch {
    return []
  }
}
