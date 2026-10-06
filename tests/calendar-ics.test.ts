import test from "node:test"
import assert from "node:assert/strict"
import {
  addDaysToDay,
  buildFeedCalendar,
  buildIcsCalendar,
  calendarFeedUrl,
  calendarUid,
  escapeIcsText,
  FEED_CACHE_SECONDS,
  feedCalendarName,
  feedEvents,
  feedTokenFromUrl,
  foldIcsLine,
  handleCalendarFeed,
  hashFeedToken,
  icsFileName,
  isFeedPayload,
  isFeedTokenShape,
  toWebcalUrl,
  zonedTimeToUtc,
  type FeedPayload,
} from "../supabase/functions/_shared/calendar-feed"

const NOW = new Date("2026-10-05T12:00:00.000Z")
const bytes = (value: string) => new TextEncoder().encode(value).length
const unfold = (ics: string) => ics.replace(/\r\n /g, "")
const linesOf = (ics: string) => unfold(ics).split("\r\n")

test("text is escaped: backslash, semicolon, comma and line breaks", () => {
  assert.equal(escapeIcsText("Bring forms; tea, coffee"), "Bring forms\\; tea\\, coffee")
  assert.equal(escapeIcsText("a\\b"), "a\\\\b")
  assert.equal(escapeIcsText("line one\r\nline two\nline three\rline four"), "line one\\nline two\\nline three\\nline four")
  assert.equal(escapeIcsText("tab\tand\u0000null"), "tabandnull")
  assert.equal(escapeIcsText(null), "")
})

test("a title cannot smuggle in a second property or event", () => {
  const ics = buildIcsCalendar({ name: "x", events: [{ uid: "u1", title: "Meet\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Injected", startsOn: "2026-10-14" }], now: NOW })
  assert.equal(linesOf(ics).filter((line) => line === "BEGIN:VEVENT").length, 1)
  assert.equal(linesOf(ics).filter((line) => line.startsWith("SUMMARY")).length, 1)
  assert.ok(linesOf(ics).includes("SUMMARY:Meet\\nEND:VEVENT\\nBEGIN:VEVENT\\nSUMMARY:Injected"))
})

test("lines are folded at 75 octets with CRLF and one space", () => {
  const folded = foldIcsLine(`SUMMARY:${"a".repeat(200)}`)
  const parts = folded.split("\r\n")
  assert.equal(parts.length, 3)
  assert.equal(bytes(parts[0]), 75)
  assert.ok(parts.slice(1).every((part) => part.startsWith(" ") && bytes(part) <= 75))
  assert.equal(folded.replace(/\r\n /g, ""), `SUMMARY:${"a".repeat(200)}`)
  assert.equal(foldIcsLine("SHORT:line"), "SHORT:line")
  assert.equal(foldIcsLine("a".repeat(75)), "a".repeat(75))
})

test("folding counts bytes, not characters, and never cuts a character in two", () => {
  const line = `SUMMARY:${"é".repeat(60)}${"😀".repeat(20)}`
  const folded = foldIcsLine(line)
  for (const part of folded.split("\r\n")) {
    assert.ok(bytes(part) <= 75, `${bytes(part)} octets`)
    assert.ok(!part.includes("�"))
  }
  assert.equal(folded.replace(/\r\n /g, ""), line)
})

test("every line of a file ends with CRLF and none is over 75 octets", () => {
  const ics = buildIcsCalendar({
    name: "Kingston Track Club",
    timezone: "America/Jamaica",
    events: [{ uid: "u1", title: "A very long title ".repeat(12), startsOn: "2026-10-14", place: "National Stadium, Kingston", description: "Line one\nLine two; with, punctuation ".repeat(6) }],
    now: NOW,
  })
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"))
  assert.ok(!/[^\r]\n/.test(ics), "a bare line feed")
  for (const line of ics.split("\r\n")) assert.ok(bytes(line) <= 75)
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:"))
})

test("an all day event ends the day after its last day (the end is not included)", () => {
  const one = linesOf(buildIcsCalendar({ name: "x", events: [{ uid: "u1", title: "Closure", startsOn: "2026-10-14" }], now: NOW }))
  assert.ok(one.includes("DTSTART;VALUE=DATE:20261014"))
  assert.ok(one.includes("DTEND;VALUE=DATE:20261015"))
  const span = linesOf(buildIcsCalendar({ name: "x", events: [{ uid: "u2", title: "Camp", startsOn: "2026-10-30", endsOn: "2026-11-01" }], now: NOW }))
  assert.ok(span.includes("DTSTART;VALUE=DATE:20261030"))
  assert.ok(span.includes("DTEND;VALUE=DATE:20261102"))
  const yearEnd = linesOf(buildIcsCalendar({ name: "x", events: [{ uid: "u3", title: "Break", startsOn: "2026-12-31", endsOn: "2026-12-31" }], now: NOW }))
  assert.ok(yearEnd.includes("DTEND;VALUE=DATE:20270101"))
  assert.equal(addDaysToDay("2028-02-28", 1), "2028-02-29")
})

test("an end before the start is treated as a one day event", () => {
  const lines = linesOf(buildIcsCalendar({ name: "x", events: [{ uid: "u1", title: "Odd", startsOn: "2026-10-14", endsOn: "2026-10-10" }], now: NOW }))
  assert.ok(lines.includes("DTEND;VALUE=DATE:20261015"))
})

test("a timed event is written in UTC from the club's time zone", () => {
  // Jamaica is UTC-5 all year.
  const jamaica = linesOf(buildIcsCalendar({ name: "x", timezone: "America/Jamaica", events: [{ uid: "u1", title: "Meeting", startsOn: "2026-10-14", startTime: "18:00", endTime: "19:30" }], now: NOW }))
  assert.ok(jamaica.includes("DTSTART:20261014T230000Z"))
  assert.ok(jamaica.includes("DTEND:20261015T003000Z"))
  assert.ok(jamaica.includes("X-WR-TIMEZONE:America/Jamaica"))
  assert.ok(!jamaica.some((line) => line.startsWith("TRANSP")))
})

test("summer time is respected: the same clock time is a different UTC hour in July and January", () => {
  assert.equal(zonedTimeToUtc("2026-07-01", "18:00", "Europe/London").toISOString(), "2026-07-01T17:00:00.000Z")
  assert.equal(zonedTimeToUtc("2026-01-15", "18:00", "Europe/London").toISOString(), "2026-01-15T18:00:00.000Z")
  assert.equal(zonedTimeToUtc("2026-07-01", "09:00", "America/New_York").toISOString(), "2026-07-01T13:00:00.000Z")
  assert.equal(zonedTimeToUtc("2026-12-01", "09:00", "America/New_York").toISOString(), "2026-12-01T14:00:00.000Z")
  assert.equal(zonedTimeToUtc("2026-10-14", "07:30", "Asia/Kolkata").toISOString(), "2026-10-14T02:00:00.000Z")
  // The night the clocks change in New York (1 November 2026, 02:00 back to 01:00).
  assert.equal(zonedTimeToUtc("2026-11-01", "12:00", "America/New_York").toISOString(), "2026-11-01T17:00:00.000Z")
})

test("an unknown time zone falls back to the default instead of failing", () => {
  assert.equal(zonedTimeToUtc("2026-10-14", "18:00", "Mars/Olympus").toISOString(), "2026-10-14T23:00:00.000Z")
  const lines = linesOf(buildIcsCalendar({ name: "x", timezone: "nope\r\nX-EVIL:1", events: [], now: NOW }))
  assert.ok(lines.includes("X-WR-TIMEZONE:America/Jamaica"))
  assert.ok(!lines.some((line) => line.startsWith("X-EVIL")))
})

test("a timed event with no end time lasts an hour, and one over several days ends on its last day", () => {
  const open = linesOf(buildIcsCalendar({ name: "x", timezone: "UTC", events: [{ uid: "u1", title: "Briefing", startsOn: "2026-10-14", startTime: "09:00" }], now: NOW }))
  assert.ok(open.includes("DTSTART:20261014T090000Z"))
  assert.ok(open.includes("DTEND:20261014T100000Z"))
  const camp = linesOf(buildIcsCalendar({ name: "x", timezone: "UTC", events: [{ uid: "u2", title: "Camp", startsOn: "2026-10-14", endsOn: "2026-10-16", startTime: "08:00", endTime: "16:00" }], now: NOW }))
  assert.ok(camp.includes("DTEND:20261016T160000Z"))
})

test("the UID is stable and the file does not change between two builds", () => {
  assert.equal(calendarUid("competition", "0f8fad5b-d9cb-469f-a165-70867728950e"), "competition-0f8fad5b-d9cb-469f-a165-70867728950e@sktr-coach")
  assert.equal(calendarUid("event", "a\r\nb;c"), "event-abc@sktr-coach")
  const event = { uid: calendarUid("event", "e1"), title: "Meeting", startsOn: "2026-10-14", updatedAt: "2026-10-01T08:00:00.000Z" }
  const first = buildIcsCalendar({ name: "x", events: [event], now: new Date("2026-10-05T00:00:00Z") })
  const second = buildIcsCalendar({ name: "x", events: [event], now: new Date("2026-11-20T00:00:00Z") })
  assert.equal(first, second)
  assert.ok(linesOf(first).includes("DTSTAMP:20261001T080000Z"))
  assert.ok(linesOf(first).includes("UID:event-e1@sktr-coach"))
})

test("an event with no valid day is left out, and file names are safe", () => {
  const ics = buildIcsCalendar({ name: "x", events: [{ uid: "u1", title: "Bad", startsOn: "2026-13-45" }, { uid: "u2", title: "Bad", startsOn: "tomorrow" }], now: NOW })
  assert.ok(!ics.includes("BEGIN:VEVENT"))
  assert.equal(icsFileName("Club Championships 2026!"), "club-championships-2026.ics")
  assert.equal(icsFileName("../../etc/passwd"), "etc-passwd.ics")
  assert.equal(icsFileName("   "), "event.ics")
})

/* ---------- feed contents per role ---------- */

const ATHLETE: FeedPayload = {
  role: "athlete",
  club_name: "Kingston Track Club",
  timezone: "America/Jamaica",
  items: [
    { kind: "session", id: "s1", title: "Acceleration", starts_on: "2026-10-06", ends_on: "2026-10-06", team: "Sprint Group" },
    { kind: "test_week", id: "t1", title: "October testing", starts_on: "2026-10-12", ends_on: "2026-10-14" },
    { kind: "competition", id: "c1", title: "Club Championships", starts_on: "2026-10-24", ends_on: "2026-10-25", place: "National Stadium, Kingston", entered_count: 14 },
    { kind: "event", id: "e1", title: "Parents' meeting", starts_on: "2026-10-08", ends_on: "2026-10-08", start_time: "18:00", end_time: "19:30", place: "Club house", note: "Bring forms" },
  ],
}

const COACH: FeedPayload = {
  role: "coach",
  club_name: "Kingston Track Club",
  timezone: "America/Jamaica",
  items: [
    { kind: "session", id: "abc", title: "Acceleration", starts_on: "2026-10-06", ends_on: "2026-10-06", team: "Sprint Group" },
    { kind: "test_week", id: "t1", title: "October testing", starts_on: "2026-10-12", ends_on: "2026-10-14", team: "Sprint Group" },
    { kind: "competition", id: "c1", title: "Club Championships", starts_on: "2026-10-24", ends_on: "2026-10-25", place: "National Stadium", entered_count: 3 },
    { kind: "competition", id: "c2", title: "Sprint Open", starts_on: "2026-10-30", ends_on: "2026-10-30", team: "Sprint Group", entered_count: 1 },
    { kind: "event", id: "e1", title: "Sprint camp", starts_on: "2026-10-16", ends_on: "2026-10-18", place: "Mandeville" },
  ],
}

test("athlete feed: own session titles, test weeks, competitions and events, no team prefix and no entry counts", () => {
  const events = feedEvents(ATHLETE)
  assert.deepEqual(events.map((event) => event.title), ["Acceleration", "Test week: October testing", "Club Championships", "Parents' meeting"])
  assert.equal(events[2].description, null)
  assert.equal(events[2].place, "National Stadium, Kingston")
  assert.deepEqual([events[3].startTime, events[3].endTime, events[3].description], ["18:00", "19:30", "Bring forms"])
  assert.equal(feedCalendarName(ATHLETE), "Kingston Track Club: My training")
  assert.deepEqual(events.map((event) => event.uid), ["session-s1@sktr-coach", "test-week-t1@sktr-coach", "competition-c1@sktr-coach", "event-e1@sktr-coach"])
})

test("coach feed: team in the title, a count of athletes entered and nothing else about athletes", () => {
  const events = feedEvents(COACH)
  assert.deepEqual(events.map((event) => event.title), ["Sprint Group: Acceleration", "Test week: October testing (Sprint Group)", "Club Championships", "Sprint Open (Sprint Group)", "Sprint camp"])
  assert.equal(events[2].description, "3 athletes entered.")
  assert.equal(events[3].description, "1 athlete entered.")
  assert.equal(feedCalendarName(COACH), "Kingston Track Club: Team calendar")
  assert.equal(feedCalendarName({ ...COACH, role: "club-admin", club_name: null }), "SKTR Coach: Club calendar")
})

test("only known fields reach a feed: names, health and availability added to the payload by mistake are dropped", () => {
  const leaky = {
    role: "coach",
    timezone: "America/Jamaica",
    items: [
      { kind: "session", id: "s1", title: "Acceleration", starts_on: "2026-10-06", note: "Maya Chen has a hamstring strain", athlete_name: "Maya Chen", names: ["Maya Chen"], availability: "injured" },
      { kind: "unavailable", id: "u1", title: "Maya Chen injured", starts_on: "2026-10-06" },
      { kind: "availability", id: "u2", title: "2 athletes unavailable", starts_on: "2026-10-06" },
      { kind: "competition", id: "c1", title: "Open", starts_on: "2026-10-07", notes: "Jon is carrying a knee injury", entries: [{ athlete: "Jon Jumper" }], entered_count: 2 },
      null,
      "junk",
      { kind: "event", id: "", title: "No id", starts_on: "2026-10-07" },
      { kind: "event", id: "e9", title: "Bad day", starts_on: "soon" },
    ],
  } as unknown as FeedPayload
  const ics = buildFeedCalendar(leaky, NOW)
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2)
  assert.ok(!/Maya|Chen|Jon|Jumper|hamstring|knee|injur|unavailable/i.test(ics))
  assert.ok(unfold(ics).includes("DESCRIPTION:2 athletes entered."))
})

test("an athlete's feed never shows a count of other athletes or a team label", () => {
  const ics = unfold(buildFeedCalendar(ATHLETE, NOW))
  assert.ok(!/entered|Sprint Group/.test(ics))
  assert.ok(ics.includes("REFRESH-INTERVAL;VALUE=DURATION:PT60M"))
  assert.ok(ics.includes("X-WR-CALNAME:Kingston Track Club: My training"))
})

test("payload shape check", () => {
  assert.ok(isFeedPayload(ATHLETE))
  for (const bad of [null, undefined, "x", 3, {}, { role: "athlete" }, { role: "platform-admin", items: [] }, { role: "coach", items: "no" }]) assert.equal(isFeedPayload(bad), false)
})

/* ---------- token and link ---------- */

const TOKEN = "0123456789abcdef".repeat(4)

test("a token is 64 lower case hex characters and is stored only as its SHA-256", async () => {
  assert.ok(isFeedTokenShape(TOKEN))
  for (const bad of ["", "abc", TOKEN.toUpperCase(), `${TOKEN}0`, TOKEN.slice(1), `${TOKEN.slice(0, 63)}g`, null, undefined]) assert.equal(isFeedTokenShape(bad), false)
  assert.equal(await hashFeedToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  assert.equal(await hashFeedToken(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  const hash = await hashFeedToken(TOKEN)
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.notEqual(hash, TOKEN)
  assert.equal(hash, await hashFeedToken(TOKEN))
})

test("the link carries the token in the path and can be read back", () => {
  const url = calendarFeedUrl("https://abc.supabase.co/functions/v1/", TOKEN)
  assert.equal(url, `https://abc.supabase.co/functions/v1/calendar-feed/${TOKEN}.ics`)
  assert.equal(toWebcalUrl(url), `webcal://abc.supabase.co/functions/v1/calendar-feed/${TOKEN}.ics`)
  assert.equal(feedTokenFromUrl(url), TOKEN)
  assert.equal(feedTokenFromUrl(`https://x.test/functions/v1/calendar-feed?t=${TOKEN}`), TOKEN)
  assert.equal(feedTokenFromUrl(`https://x.test/calendar-feed/${TOKEN}`), TOKEN)
  assert.equal(feedTokenFromUrl("https://x.test/functions/v1/calendar-feed"), null)
  assert.equal(feedTokenFromUrl("https://x.test/functions/v1/calendar-feed/"), null)
  assert.equal(feedTokenFromUrl("not a url"), null)
  assert.equal(feedTokenFromUrl(`https://x.test/calendar-feed/${"a".repeat(5000)}.ics`)?.length, 128)
})

/* ---------- the HTTP handler ---------- */

function world(payloadByHash: Record<string, unknown> = {}, options: { fail?: boolean } = {}) {
  const lookups: string[] = []
  return {
    lookups,
    deps: {
      now: () => NOW,
      loadPayload: async (hash: string) => {
        lookups.push(hash)
        if (options.fail) throw new Error("database is down")
        return payloadByHash[hash] ?? null
      },
    },
  }
}

const feedRequest = (token: string, init?: RequestInit) => new Request(`https://abc.supabase.co/functions/v1/calendar-feed/${token}.ics`, init)

async function describe(response: Response) {
  return { status: response.status, body: await response.text(), headers: [...response.headers.entries()].sort() }
}

test("a valid token gets the calendar with calendar headers and a private cache", async () => {
  const { deps, lookups } = world({ [await hashFeedToken(TOKEN)]: ATHLETE })
  const response = await handleCalendarFeed(feedRequest(TOKEN), deps)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "text/calendar; charset=utf-8")
  assert.equal(response.headers.get("cache-control"), `private, max-age=${FEED_CACHE_SECONDS}`)
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow")
  const body = await response.text()
  assert.ok(body.startsWith("BEGIN:VCALENDAR\r\n"))
  assert.equal((body.match(/BEGIN:VEVENT/g) ?? []).length, 4)
  assert.deepEqual(lookups, [await hashFeedToken(TOKEN)])
  assert.ok(!lookups.includes(TOKEN), "the raw token is never sent to the database")
})

test("the query form of the link works too, and HEAD has no body", async () => {
  const { deps } = world({ [await hashFeedToken(TOKEN)]: COACH })
  const viaQuery = await handleCalendarFeed(new Request(`https://abc.supabase.co/functions/v1/calendar-feed?t=${TOKEN}`), deps)
  assert.equal(viaQuery.status, 200)
  const head = await handleCalendarFeed(feedRequest(TOKEN, { method: "HEAD" }), deps)
  assert.equal(head.status, 200)
  assert.equal(await head.text(), "")
})

test("everything that cannot be served gets one and the same 404, and the same single lookup", async () => {
  const goodHash = await hashFeedToken(TOKEN)
  const other = "f".repeat(64)
  const cases: Array<[string, Promise<Response>, number]> = []
  const run = (name: string, request: Request, payloads: Record<string, unknown>, options?: { fail?: boolean }, expectedLookups = 1) => {
    const w = world(payloads, options)
    cases.push([name, handleCalendarFeed(request, w.deps).then((response) => Object.assign(response, { lookups: w.lookups })), expectedLookups])
  }
  run("unknown token", feedRequest(other), { [goodHash]: ATHLETE })
  run("link turned off, deactivated member or paused club (the database returns null)", feedRequest(TOKEN), {})
  run("no token", new Request("https://abc.supabase.co/functions/v1/calendar-feed"), { [goodHash]: ATHLETE })
  run("token too short", feedRequest("abc"), { [goodHash]: ATHLETE })
  run("token in upper case", feedRequest(TOKEN.toUpperCase()), { [goodHash]: ATHLETE })
  run("sql in the token", feedRequest("%27%20or%201%3D1--"), { [goodHash]: ATHLETE })
  run("database failure", feedRequest(TOKEN), { [goodHash]: ATHLETE }, { fail: true })
  run("a payload of the wrong shape", feedRequest(TOKEN), { [goodHash]: { role: "platform-admin", items: [] } })
  run("POST", feedRequest(TOKEN, { method: "POST", body: "{}" }), { [goodHash]: ATHLETE }, undefined, 0)
  run("DELETE", feedRequest(TOKEN, { method: "DELETE" }), { [goodHash]: ATHLETE }, undefined, 0)

  const seen = new Set<string>()
  for (const [name, pending, expectedLookups] of cases) {
    const response = (await pending) as Response & { lookups: string[] }
    assert.equal(response.status, 404, name)
    assert.equal(response.lookups.length, expectedLookups, `${name}: lookups`)
    for (const hash of response.lookups) assert.match(hash, /^[0-9a-f]{64}$/, `${name}: only a hash reaches the database`)
    seen.add(JSON.stringify(await describe(response)))
  }
  assert.equal(seen.size, 1, "every refusal looks exactly the same")
  const [only] = [...seen]
  assert.ok(only.includes("no-store"))
  assert.ok(!only.includes("VCALENDAR"))
})

test("a token of the wrong shape never matches, even if the database had a row for its hash", async () => {
  const odd = "ABC"
  const { deps } = world({ [await hashFeedToken(odd)]: ATHLETE })
  assert.equal((await handleCalendarFeed(feedRequest(odd), deps)).status, 404)
})
