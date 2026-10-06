// "Today" for a club is the calendar day in the club's time zone, not the device's.
// A coach travelling abroad, or an athlete at an away meet, sees the club's day: the day the
// plan, attendance and reminders are written for.
//
// Reading it has to be instant (screens compute "today" while rendering), so the club's zone is
// kept on the device and refreshed in the background whenever it is read from the server.
// Relative imports: this file is also loaded by the unit tests, outside the bundler.
import { getTenantIdFromCookie } from "./auth-session"
import { DEFAULT_CLUB_TIMEZONE, cleanClubTimezone, isKnownTimezone, localDayIn } from "./club-timezone"

/** The same per-club key as tenantStorageKey (src/lib/tenant-storage.ts). */
function tenantStorageKey(baseKey: string) {
  return `${baseKey}:${getTenantIdFromCookie() ?? "public"}`
}

/** Same key the mock club profile writes, so mock mode needs no second copy. */
const MOCK_KEY = "pacelab:club-timezone"
const CACHE_KEY = "pacelab:club-timezone-cache"

export const CLUB_DAY_CHANGED_EVENT = "pacelab:club-day-changed"

function deviceDay(at: Date): string {
  const month = `${at.getMonth() + 1}`.padStart(2, "0")
  const day = `${at.getDate()}`.padStart(2, "0")
  return `${at.getFullYear()}-${month}-${day}`
}

/** The calendar day "YYYY-MM-DD" in `timezone` at `at`. Falls back to the device's day for a zone this runtime does not know. */
export function clubDayAt(timezone: string | null | undefined, at: Date = new Date()): string {
  if (!isKnownTimezone(timezone)) return deviceDay(at)
  return localDayIn(timezone, at) || deviceDay(at)
}

/** "Mon", "Tue" ... for a calendar day, the same in every time zone. */
export function weekdayShortOf(isoDay: string): string {
  return new Date(`${isoDay}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })
}

/** The club's zone as last seen on this device. Null when it has never been read (signed out, first visit). */
export function rememberedClubTimezone(): string | null {
  if (typeof window === "undefined") return null
  try {
    const stored = window.localStorage.getItem(tenantStorageKey(CACHE_KEY)) ?? window.localStorage.getItem(tenantStorageKey(MOCK_KEY))
    return isKnownTimezone(stored) ? stored.trim() : null
  } catch {
    return null
  }
}

/** Called by the data layer whenever the club's zone is read or saved. */
export function rememberClubTimezone(timezone: string | null | undefined) {
  if (typeof window === "undefined") return
  const name = cleanClubTimezone(timezone)
  try {
    const key = tenantStorageKey(CACHE_KEY)
    if (window.localStorage.getItem(key) === name) return
    window.localStorage.setItem(key, name)
  } catch {
    return
  }
  window.dispatchEvent(new CustomEvent(CLUB_DAY_CHANGED_EVENT))
}

/**
 * Today in the club's time zone. Before the zone is known on this device it is the device's own
 * day, which is right for everyone who is where their club is.
 */
export function clubToday(at: Date = new Date()): string {
  const timezone = rememberedClubTimezone()
  return timezone ? clubDayAt(timezone, at) : deviceDay(at)
}

export { DEFAULT_CLUB_TIMEZONE }
