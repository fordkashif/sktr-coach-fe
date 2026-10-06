// Calendar files (.ics) and the private calendar feed.
//
// This file has no imports on purpose. It is used by three things:
//   - the calendar-feed server function (Deno), for the subscription feed,
//   - the app (Vite), for the "Add to calendar" downloads and the feed link,
//   - the unit tests (node), tests/calendar-ics.test.ts.
//
// What may be in a calendar file: titles, dates, clock times and places of sessions, test weeks,
// competitions and club events, plus the note of a club event. Never availability, injury,
// wellness, pain reports, results or notes about an athlete, and never athlete names in a coach's
// or club admin's feed (a number of athletes entered is the most it says).

export const DEFAULT_FEED_TIMEZONE = "America/Jamaica"
export const ICS_PRODUCT_ID = "-//SKTR Coach//Calendar//EN"
const UID_DOMAIN = "sktr-coach"
const CRLF = "\r\n"
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)/

export type IcsEvent = {
  /** Stable for the life of the thing, so a calendar app updates the entry instead of adding a second one. */
  uid: string
  title: string
  /** First day, YYYY-MM-DD. */
  startsOn: string
  /** Last day, inclusive. Left out for a one day event. */
  endsOn?: string | null
  /** Clock time in the club's time zone, HH:MM. Left out for an all day event. */
  startTime?: string | null
  endTime?: string | null
  place?: string | null
  description?: string | null
  /** ISO time the thing last changed. Used for DTSTAMP so the file is the same until something changes. */
  updatedAt?: string | null
}

/* ---------- Text ---------------------------------------------------------------------------- */

/** Escapes a text value (RFC 5545 3.3.11): backslash, semicolon, comma and line breaks. Other control characters are dropped. */
export function escapeIcsText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\r\n|\r|\n/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
}

function utf8Length(character: string): number {
  const code = character.codePointAt(0) ?? 0
  if (code < 0x80) return 1
  if (code < 0x800) return 2
  if (code < 0x10000) return 3
  return 4
}

/**
 * Folds one content line so no line is longer than 75 octets (RFC 5545 3.1). Continuation lines
 * start with one space, which counts towards their 75. A character of several bytes is never cut.
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = []
  let current = ""
  let octets = 0
  for (const character of line) {
    const size = utf8Length(character)
    if (octets + size > 75) {
      parts.push(current)
      current = " "
      octets = 1
    }
    current += character
    octets += size
  }
  parts.push(current)
  return parts.join(CRLF)
}

/* ---------- Dates --------------------------------------------------------------------------- */

function isDay(value: string | null | undefined): value is string {
  if (!value || !DAY_PATTERN.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function cleanTime(value: string | null | undefined): string | null {
  const match = value ? TIME_PATTERN.exec(value.trim()) : null
  return match ? `${match[1]}:${match[2]}` : null
}

/** The day `amount` days after `day` (YYYY-MM-DD). */
export function addDaysToDay(day: string, amount: number): string {
  const [year, month, date] = day.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10)
}

function compactDay(day: string) {
  return day.replace(/-/g, "")
}

/** 20261014T230000Z */
export function icsUtcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

function knownTimezone(name: string | null | undefined): string {
  const value = (name ?? "").trim()
  if (!value || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return DEFAULT_FEED_TIMEZONE
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value })
    return value
  } catch {
    return DEFAULT_FEED_TIMEZONE
  }
}

/** Minutes east of UTC in that zone at that moment. */
function offsetMinutes(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at)
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"))
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000)
}

/**
 * The moment a wall clock in `timezone` shows `day` `time`. Summer time is handled; for an hour that
 * does not exist (clocks go forward) the result is the same moment an hour later on the clock.
 */
export function zonedTimeToUtc(day: string, time: string, timezone: string): Date {
  const zone = knownTimezone(timezone)
  const [year, month, date] = day.split("-").map(Number)
  const [hour, minute] = (cleanTime(time) ?? "00:00").split(":").map(Number)
  const wall = Date.UTC(year, month - 1, date, hour, minute)
  const first = wall - offsetMinutes(zone, new Date(wall)) * 60_000
  const second = wall - offsetMinutes(zone, new Date(first)) * 60_000
  return new Date(second)
}

/* ---------- Building a file ----------------------------------------------------------------- */

/** "competition", "a1b2" gives "competition-a1b2@sktr-coach". Anything that could break a line is removed. */
export function calendarUid(kind: string, id: string): string {
  const clean = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "")
  return `${clean(kind)}-${clean(id)}@${UID_DOMAIN}`
}

function eventLines(event: IcsEvent, timezone: string, now: Date): string[] {
  if (!isDay(event.startsOn)) return []
  const lastDay = isDay(event.endsOn) && event.endsOn >= event.startsOn ? event.endsOn : event.startsOn
  const changed = event.updatedAt ? new Date(event.updatedAt) : null
  const stamp = changed && !Number.isNaN(changed.getTime()) ? changed : now
  const lines = ["BEGIN:VEVENT", `UID:${escapeIcsText(event.uid)}`, `DTSTAMP:${icsUtcStamp(stamp)}`]

  const startTime = cleanTime(event.startTime)
  if (startTime) {
    const start = zonedTimeToUtc(event.startsOn, startTime, timezone)
    const endTime = cleanTime(event.endTime)
    let end = endTime ? zonedTimeToUtc(lastDay, endTime, timezone) : new Date(zonedTimeToUtc(lastDay, startTime, timezone).getTime() + 3_600_000)
    if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + 3_600_000)
    lines.push(`DTSTART:${icsUtcStamp(start)}`, `DTEND:${icsUtcStamp(end)}`)
  } else {
    // An all day DTEND is the day after the last day (it is not included).
    lines.push(`DTSTART;VALUE=DATE:${compactDay(event.startsOn)}`, `DTEND;VALUE=DATE:${compactDay(addDaysToDay(lastDay, 1))}`, "TRANSP:TRANSPARENT")
  }

  lines.push(`SUMMARY:${escapeIcsText(event.title.trim() || "Untitled")}`)
  if (event.place?.trim()) lines.push(`LOCATION:${escapeIcsText(event.place.trim())}`)
  if (event.description?.trim()) lines.push(`DESCRIPTION:${escapeIcsText(event.description.trim())}`)
  lines.push("END:VEVENT")
  return lines
}

/**
 * A whole .ics file. Lines end with CRLF and are folded at 75 octets. Timed events are written in
 * UTC, worked out from the club's time zone, so every calendar app shows the right hour without
 * needing a time zone table in the file. `refreshMinutes` is for a subscription feed only.
 */
export function buildIcsCalendar(input: { name: string; timezone?: string | null; events: IcsEvent[]; now?: Date; refreshMinutes?: number }): string {
  const timezone = knownTimezone(input.timezone)
  const now = input.now ?? new Date()
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${ICS_PRODUCT_ID}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeIcsText(input.name)}`, `X-WR-TIMEZONE:${timezone}`]
  if (input.refreshMinutes && input.refreshMinutes > 0) {
    const minutes = Math.round(input.refreshMinutes)
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${minutes}M`, `X-PUBLISHED-TTL:PT${minutes}M`)
  }
  for (const event of input.events) lines.push(...eventLines(event, timezone, now))
  lines.push("END:VCALENDAR")
  return lines.map(foldIcsLine).join(CRLF) + CRLF
}

/** A file name that is safe everywhere: "Club Championships" gives "club-championships.ics". */
export function icsFileName(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return `${base || "event"}.ics`
}

/* ---------- The feed: what each person's link shows ------------------------------------------- */

export type FeedRole = "athlete" | "coach" | "club-admin"

/** One dated thing, as the database function calendar_feed_payload hands it over. */
export type FeedItem = {
  kind: "session" | "test_week" | "competition" | "event"
  id: string
  title: string
  starts_on: string
  ends_on?: string | null
  start_time?: string | null
  end_time?: string | null
  place?: string | null
  note?: string | null
  team?: string | null
  entered_count?: number | null
  updated_at?: string | null
}

export type FeedPayload = { role: FeedRole; club_name?: string | null; timezone?: string | null; items: FeedItem[] }

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/** True for something shaped like the database payload. Anything else is treated as "no feed". */
export function isFeedPayload(value: unknown): value is FeedPayload {
  if (!value || typeof value !== "object") return false
  const candidate = value as { role?: unknown; items?: unknown }
  return (candidate.role === "athlete" || candidate.role === "coach" || candidate.role === "club-admin") && Array.isArray(candidate.items)
}

/**
 * Turns the payload into calendar events. Only the fields named here are ever copied, so a field
 * added to the payload by mistake (a name, a note about an athlete) cannot reach a calendar file.
 */
export function feedEvents(payload: FeedPayload): IcsEvent[] {
  const staff = payload.role !== "athlete"
  const events: IcsEvent[] = []
  for (const raw of payload.items) {
    if (!raw || typeof raw !== "object") continue
    const item = raw as FeedItem
    const id = text(item.id)
    const title = text(item.title)
    if (!id || !title || !isDay(item.starts_on)) continue
    const team = staff ? text(item.team) : null
    const base = { startsOn: item.starts_on, endsOn: isDay(item.ends_on) ? item.ends_on : null, updatedAt: text(item.updated_at) }

    if (item.kind === "session") {
      events.push({ ...base, endsOn: null, uid: calendarUid("session", id), title: team ? `${team}: ${title}` : title })
    } else if (item.kind === "test_week") {
      events.push({ ...base, uid: calendarUid("test-week", id), title: team ? `Test week: ${title} (${team})` : `Test week: ${title}` })
    } else if (item.kind === "competition") {
      const entered = staff && typeof item.entered_count === "number" && item.entered_count > 0 ? Math.floor(item.entered_count) : 0
      events.push({
        ...base,
        uid: calendarUid("competition", id),
        title: team ? `${title} (${team})` : title,
        place: text(item.place),
        description: entered > 0 ? `${entered} ${entered === 1 ? "athlete" : "athletes"} entered.` : null,
      })
    } else if (item.kind === "event") {
      events.push({ ...base, uid: calendarUid("event", id), title, startTime: cleanTime(item.start_time), endTime: cleanTime(item.end_time), place: text(item.place), description: text(item.note) })
    }
  }
  return events
}

export function feedCalendarName(payload: FeedPayload): string {
  const club = text(payload.club_name)
  const what = payload.role === "athlete" ? "My training" : payload.role === "coach" ? "Team calendar" : "Club calendar"
  return club ? `${club}: ${what}` : `SKTR Coach: ${what}`
}

/** The whole feed file for one person. */
export function buildFeedCalendar(payload: FeedPayload, now: Date = new Date()): string {
  return buildIcsCalendar({ name: feedCalendarName(payload), timezone: payload.timezone, events: feedEvents(payload), now, refreshMinutes: 60 })
}

/* ---------- The feed: token and link ---------------------------------------------------------- */

/** A feed token: 64 lower case hex characters (244 random bits, made by the database). */
export const FEED_TOKEN_PATTERN = /^[0-9a-f]{64}$/

export function isFeedTokenShape(value: string | null | undefined): value is string {
  return typeof value === "string" && FEED_TOKEN_PATTERN.test(value)
}

/** SHA-256 of the token as lower case hex: the only form of it the database keeps. */
export async function hashFeedToken(token: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** The token in a feed address: ".../calendar-feed/<token>.ics" or ".../calendar-feed?t=<token>". Null when there is none. */
export function feedTokenFromUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const fromQuery = parsed.searchParams.get("t")
  if (fromQuery) return fromQuery.slice(0, 128)
  const last = parsed.pathname.split("/").filter(Boolean).pop() ?? ""
  const name = last.replace(/\.ics$/i, "")
  return name && name !== "calendar-feed" ? name.slice(0, 128) : null
}

/** The https address of a feed. `functionsBaseUrl` is "<project url>/functions/v1". */
export function calendarFeedUrl(functionsBaseUrl: string, token: string): string {
  return `${functionsBaseUrl.replace(/\/+$/, "")}/calendar-feed/${encodeURIComponent(token)}.ics`
}

/** The same address with the webcal scheme, which makes a phone offer to subscribe. */
export function toWebcalUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "webcal://")
}

/* ---------- The feed: HTTP handler ------------------------------------------------------------- */

export type CalendarFeedDeps = {
  /** Looks a token hash up. Returns the payload, or null when there is nothing to serve. */
  loadPayload: (tokenHash: string) => Promise<unknown>
  now: () => Date
}

/** How long a calendar app or a proxy on the person's own device may reuse the file. */
export const FEED_CACHE_SECONDS = 900

const NOT_FOUND_BODY = "Not found"

function notFound(): Response {
  return new Response(NOT_FOUND_BODY, {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" },
  })
}

/**
 * Serves one person's calendar feed. Nobody signs in: the long random token in the address is the
 * key. Every request that cannot be served gets the same 404 with the same body and headers,
 * whatever the reason (no token, wrong shape, unknown token, link turned off, deactivated member,
 * paused club, a failure behind the scenes), and every request does the same work (one hash, one
 * lookup), so an answer says nothing about which tokens exist.
 */
export async function handleCalendarFeed(request: Request, deps: CalendarFeedDeps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return notFound()

  const candidate = feedTokenFromUrl(request.url) ?? ""
  let payload: unknown = null
  try {
    // A token of the wrong shape is hashed and looked up like any other: it simply matches nothing.
    const hash = await hashFeedToken(candidate)
    payload = await deps.loadPayload(hash)
  } catch {
    return notFound()
  }
  if (!isFeedTokenShape(candidate) || !isFeedPayload(payload)) return notFound()

  const body = buildFeedCalendar(payload, deps.now())
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="sktr-coach.ics"',
      // Private: the file is one person's. Calendar apps poll; 15 minutes keeps that cheap.
      "Cache-Control": `private, max-age=${FEED_CACHE_SECONDS}`,
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
