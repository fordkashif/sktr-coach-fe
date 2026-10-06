import test from "node:test"
import assert from "node:assert/strict"
import {
  athleteSessionItems,
  athleteSessionState,
  buildAgenda,
  buildMonthGrid,
  canManageEvent,
  clockLabel,
  clubEventItem,
  dayAriaLabel,
  eventVisibleTo,
  gridBounds,
  icsEventForItem,
  itemSubtitle,
  itemsOnDay,
  monthBounds,
  monthLabel,
  rangeLabel,
  sessionCountItems,
  shiftMonth,
  teamSessionItems,
  timeRangeLabel,
  unavailableItems,
  validateClubEvent,
  weekdayIndex,
  type CalendarItem,
  type ClubEvent,
  type ClubEventInput,
} from "../src/lib/data/calendar/model"
import { icsFileForItem } from "../src/lib/data/calendar/ics-download"

const item = (over: Partial<CalendarItem> & Pick<CalendarItem, "key" | "kind" | "startsOn">): CalendarItem => ({ title: over.key, endsOn: over.startsOn, ...over })

/* ---------- months ---------- */

test("month bounds, leap years and moving between months", () => {
  assert.deepEqual(monthBounds("2026-10"), { from: "2026-10-01", to: "2026-10-31" })
  assert.deepEqual(monthBounds("2026-02"), { from: "2026-02-01", to: "2026-02-28" })
  assert.deepEqual(monthBounds("2028-02"), { from: "2028-02-01", to: "2028-02-29" })
  assert.equal(shiftMonth("2026-12", 1), "2027-01")
  assert.equal(shiftMonth("2026-01", -1), "2025-12")
  assert.equal(shiftMonth("2026-10", 0), "2026-10")
  assert.equal(monthLabel("2026-10"), "October 2026")
  assert.equal(weekdayIndex("2026-10-05"), 0)
  assert.equal(weekdayIndex("2026-10-11"), 6)
})

test("the grid shows whole weeks, Monday first", () => {
  // 1 October 2026 is a Thursday, 31 October a Saturday.
  assert.deepEqual(gridBounds("2026-10"), { from: "2026-09-28", to: "2026-11-01" })
  const grid = buildMonthGrid("2026-10", [], "2026-10-05")
  assert.equal(grid.weeks.length, 5)
  assert.ok(grid.weeks.every((week) => week.length === 7))
  assert.ok(grid.weeks.every((week) => weekdayIndex(week[0].date) === 0))
  assert.equal(grid.weeks[0][0].date, "2026-09-28")
  assert.equal(grid.weeks[0][0].inMonth, false)
  assert.equal(grid.weeks[0][3].date, "2026-10-01")
  assert.equal(grid.weeks[0][3].inMonth, true)
  assert.equal(grid.weeks[4][6].date, "2026-11-01")
  assert.equal(grid.weeks.flat().filter((cell) => cell.isToday).map((cell) => cell.date).join(), "2026-10-05")
  assert.equal(grid.weeks.flat().filter((cell) => cell.inMonth).length, 31)
})

test("grids of four, five and six weeks", () => {
  // February 2027 starts on a Monday and has 28 days.
  assert.equal(buildMonthGrid("2027-02", [], "2026-10-05").weeks.length, 4)
  assert.equal(buildMonthGrid("2026-10", [], "2026-10-05").weeks.length, 5)
  // August 2026 starts on a Saturday and has 31 days.
  assert.equal(buildMonthGrid("2026-08", [], "2026-10-05").weeks.length, 6)
  assert.equal(buildMonthGrid("2026-08", [], "2026-10-05").weeks.flat().some((cell) => cell.isToday), false)
})

test("each day gets what is on it, with one dot per tone", () => {
  const items = [
    item({ key: "s1", kind: "session", startsOn: "2026-10-06", title: "Acceleration" }),
    item({ key: "s2", kind: "session", startsOn: "2026-10-06", title: "Gym" }),
    item({ key: "c1", kind: "competition", startsOn: "2026-10-06", title: "Open" }),
    item({ key: "u1", kind: "unavailable", startsOn: "2026-10-06", endsOn: "2026-10-08", title: "1 athlete unavailable" }),
    item({ key: "old", kind: "session", startsOn: "2026-08-01" }),
  ]
  const grid = buildMonthGrid("2026-10", items, "2026-10-05")
  const day = grid.weeks.flat().find((cell) => cell.date === "2026-10-06")!
  assert.deepEqual(day.items.map((entry) => entry.key), ["c1", "s1", "s2", "u1"])
  assert.deepEqual(day.dots, ["blue", "amber", "neutral"])
  assert.equal(day.spans.length, 0, "an unavailable stretch is a dot, not a bar")
  assert.equal(day.singles.length, 4)
  assert.deepEqual(grid.weeks.flat().find((cell) => cell.date === "2026-10-08")!.items.map((entry) => entry.key), ["u1"])
  assert.equal(grid.weeks.flat().find((cell) => cell.date === "2026-10-09")!.items.length, 0)
  assert.equal(dayAriaLabel(day), "Tuesday 6 October, 4 things")
  assert.equal(dayAriaLabel(grid.weeks.flat().find((cell) => cell.date === "2026-10-05")!), "Monday 5 October, today, nothing on")
})

test("a test week is a bar across its days, in the same row every day, named again at the start of a week", () => {
  const items = [
    item({ key: "tw", kind: "test-week", startsOn: "2026-10-08", endsOn: "2026-10-13", title: "October testing" }),
    item({ key: "camp", kind: "event", startsOn: "2026-10-10", endsOn: "2026-10-12", title: "Camp" }),
    item({ key: "late", kind: "competition", startsOn: "2026-10-14", endsOn: "2026-10-15", title: "Champs" }),
  ]
  const cells = new Map(buildMonthGrid("2026-10", items, "2026-10-05").weeks.flat().map((cell) => [cell.date, cell]))
  const lane = (date: string, key: string) => cells.get(date)!.spans.findIndex((span) => span?.item.key === key)
  for (const date of ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"]) assert.equal(lane(date, "tw"), 0, date)
  for (const date of ["2026-10-10", "2026-10-11", "2026-10-12"]) assert.equal(lane(date, "camp"), 1, date)
  // The competition starts after the test week ends, so it reuses the top row.
  assert.equal(lane("2026-10-14", "late"), 0)
  const start = cells.get("2026-10-08")!.spans[0]!
  assert.deepEqual([start.isStart, start.isEnd, start.showTitle], [true, false, true])
  assert.equal(cells.get("2026-10-09")!.spans[0]!.showTitle, false)
  // Monday 12 October starts a new row of the grid.
  assert.equal(cells.get("2026-10-12")!.spans[0]!.showTitle, true)
  const end = cells.get("2026-10-13")!.spans[0]!
  assert.deepEqual([end.isStart, end.isEnd], [false, true])
  // A day with only the lower bar keeps the empty top row, so bars line up.
  assert.equal(cells.get("2026-10-13")!.spans.length, 1)
  assert.equal(cells.get("2026-10-07")!.spans.length, 0)
  assert.equal(cells.get("2026-10-10")!.singles.length, 0)
})

test("a span that began in the month before is named on the first day of the grid", () => {
  const cells = buildMonthGrid("2026-10", [item({ key: "tw", kind: "test-week", startsOn: "2026-09-20", endsOn: "2026-10-02" })], "2026-10-05").weeks.flat()
  assert.equal(cells[0].date, "2026-09-28")
  assert.equal(cells[0].spans[0]!.showTitle, true)
  assert.equal(cells[0].spans[0]!.isStart, false)
})

/* ---------- agenda ---------- */

test("the agenda groups by day, oldest first, timed things first", () => {
  const items = [
    item({ key: "b", kind: "session", startsOn: "2026-10-07", title: "Bounding" }),
    item({ key: "meeting", kind: "event", startsOn: "2026-10-06", startTime: "18:00", title: "Parents' meeting" }),
    item({ key: "a", kind: "session", startsOn: "2026-10-06", title: "Acceleration" }),
    item({ key: "early", kind: "event", startsOn: "2026-10-06", startTime: "07:00", title: "Kit hand out" }),
    item({ key: "comp", kind: "competition", startsOn: "2026-10-06", title: "Open" }),
    item({ key: "sept", kind: "session", startsOn: "2026-09-30" }),
    item({ key: "nov", kind: "session", startsOn: "2026-11-01" }),
  ]
  const agenda = buildAgenda(items, "2026-10-01", "2026-10-31")
  assert.deepEqual(agenda.map((day) => day.date), ["2026-10-06", "2026-10-07"])
  assert.deepEqual(agenda[0].items.map((entry) => entry.key), ["early", "meeting", "comp", "a"])
  assert.deepEqual(itemsOnDay(items, "2026-10-06").map((entry) => entry.key), ["early", "meeting", "comp", "a"])
})

test("something lasting several days is listed once in the agenda, on its first day in the range", () => {
  const items = [
    item({ key: "camp", kind: "event", startsOn: "2026-10-10", endsOn: "2026-10-19", title: "Camp" }),
    item({ key: "carry", kind: "test-week", startsOn: "2026-09-28", endsOn: "2026-10-02", title: "Testing" }),
    item({ key: "out", kind: "unavailable", startsOn: "2026-10-12", endsOn: "2026-10-30", title: "2 athletes unavailable" }),
  ]
  const agenda = buildAgenda(items, "2026-10-01", "2026-10-31")
  assert.deepEqual(agenda.map((day) => [day.date, day.items.map((entry) => entry.key).join()]), [
    ["2026-10-01", "carry"],
    ["2026-10-10", "camp"],
    ["2026-10-12", "out"],
  ])
  assert.equal(agenda.flatMap((day) => day.items).length, 3)
  assert.equal(itemSubtitle(items[0]), "10 to 19 Oct")
})

test("dates and times in words", () => {
  assert.equal(rangeLabel("2026-10-14", "2026-10-14"), "14 Oct")
  assert.equal(rangeLabel("2026-10-14", "2026-10-16"), "14 to 16 Oct")
  assert.equal(rangeLabel("2026-10-30", "2026-11-02"), "30 Oct to 2 Nov")
  assert.equal(clockLabel("18:00"), "6:00 pm")
  assert.equal(clockLabel("00:05"), "12:05 am")
  assert.equal(clockLabel("12:00:00"), "12:00 pm")
  assert.equal(clockLabel("25:00"), "")
  assert.equal(timeRangeLabel("18:00", "19:30"), "6:00 pm to 7:30 pm")
  assert.equal(timeRangeLabel("09:00", null), "9:00 am")
  assert.equal(timeRangeLabel(null, null), "")
  assert.equal(itemSubtitle(item({ key: "e", kind: "event", startsOn: "2026-10-08", startTime: "18:00", endTime: "19:30", place: "Club house", detail: "Whole club" })), "6:00 pm to 7:30 pm, Club house, Whole club")
})

/* ---------- team sessions and counts ---------- */

test("a team's sessions: one entry per day and title, not per athlete or plan", () => {
  const items = teamSessionItems([
    { date: "2026-10-06", title: "Acceleration", planId: "p1", teamId: "t1" },
    { date: "2026-10-06", title: "acceleration ", planId: "p2", teamId: "t1" },
    { date: "2026-10-06T00:00:00", title: "Acceleration", planId: "p1", teamId: "t1" },
    { date: "2026-10-06", title: "Gym", planId: "p1", teamId: "t1" },
    { date: "2026-10-07", title: "Acceleration", planId: "p1", teamId: "t1" },
    { date: "2026-10-06", title: "Acceleration", planId: "p9", teamId: "t2" },
    { date: "bad", title: "Nope" },
    { date: "2026-10-08", title: "   " },
  ])
  assert.deepEqual(items.map((entry) => `${entry.teamId}:${entry.startsOn}:${entry.title}`), ["t1:2026-10-06:Acceleration", "t1:2026-10-06:Gym", "t1:2026-10-07:Acceleration", "t2:2026-10-06:Acceleration"])
  assert.equal(items[0].sourceId, "p1")
})

test("the club calendar counts sessions per day and team and never lists them", () => {
  const counts = sessionCountItems([
    { date: "2026-10-06", title: "Acceleration", teamId: "t1", teamName: "Sprint Group" },
    { date: "2026-10-06", title: "Gym", teamId: "t1", teamName: "Sprint Group" },
    { date: "2026-10-06", title: "Gym", teamId: "t1", teamName: "Sprint Group" },
    { date: "2026-10-06", title: "Bounding", teamId: "t3", teamName: "Jumps Group" },
    { date: "2026-10-07", title: "Tempo", teamId: "t1", teamName: "Sprint Group" },
  ])
  assert.deepEqual(counts.map((entry) => `${entry.startsOn} ${entry.title}: ${entry.detail}`), ["2026-10-06 Sprint Group: 2 sessions", "2026-10-06 Jumps Group: 1 session", "2026-10-07 Sprint Group: 1 session"])
  assert.ok(counts.every((entry) => entry.kind === "session-count" && !/Acceleration|Gym|Bounding|Tempo/.test(JSON.stringify(entry))))
})

/* ---------- unavailable ---------- */

const ROSTER = [
  { id: "a1", name: "Marcus Johnson" },
  { id: "a2", name: "Sarah Chen" },
]
const TEAM = { teamId: "t1", to: (day: string) => `/coach/teams/t1/attendance?date=${day}` }

test("athletes unavailable: a count per stretch of days with the same people, names kept for the opened entry", () => {
  const items = unavailableItems(
    ROSTER,
    [
      { athleteId: "a1", startsOn: "2026-10-05", endsOn: "2026-10-09" },
      { athleteId: "a2", startsOn: "2026-10-08", endsOn: null },
      { athleteId: "stranger", startsOn: "2026-10-01", endsOn: "2026-10-31" },
    ],
    { from: "2026-10-01", to: "2026-10-12" },
    TEAM,
  )
  assert.deepEqual(items.map((entry) => [entry.startsOn, entry.endsOn, entry.count, entry.title]), [
    ["2026-10-05", "2026-10-07", 1, "1 athlete unavailable"],
    ["2026-10-08", "2026-10-09", 2, "2 athletes unavailable"],
    ["2026-10-10", "2026-10-12", 1, "1 athlete unavailable"],
  ])
  assert.deepEqual(items[1].names, ["Marcus Johnson", "Sarah Chen"])
  assert.deepEqual(items[2].names, ["Sarah Chen"])
  assert.equal(items[0].to, "/coach/teams/t1/attendance?date=2026-10-05")
  assert.ok(items.every((entry) => !/Marcus|Sarah/.test(entry.title)), "no name in the line itself")
  assert.ok(!/injur|sick|away/i.test(JSON.stringify(items)), "the reason is never carried")
})

test("two periods of one athlete count once, and nobody out means no entry", () => {
  const twice = unavailableItems(ROSTER, [{ athleteId: "a1", startsOn: "2026-10-05", endsOn: "2026-10-06" }, { athleteId: "a1", startsOn: "2026-10-06", endsOn: "2026-10-07" }], { from: "2026-10-01", to: "2026-10-31" }, TEAM)
  assert.deepEqual(twice.map((entry) => [entry.startsOn, entry.endsOn, entry.count]), [["2026-10-05", "2026-10-07", 1]])
  assert.deepEqual(unavailableItems(ROSTER, [], { from: "2026-10-01", to: "2026-10-31" }, TEAM), [])
})

/* ---------- athlete sessions ---------- */

test("where an athlete's session stands", () => {
  const base = { today: "2026-10-05", excused: false, planned: true }
  const ref = (status: "scheduled" | "in-progress" | "completed" | "skipped", origin: "plan" | "athlete" = "plan") => ({ date: "", title: "", origin, status })
  assert.deepEqual(athleteSessionState({ ...base, date: "2026-10-01", refs: [ref("completed")] }), { tone: "green", label: "Done" })
  assert.deepEqual(athleteSessionState({ ...base, date: "2026-10-01", refs: [ref("skipped")] }), { tone: "neutral", label: "Skipped" })
  assert.deepEqual(athleteSessionState({ ...base, date: "2026-10-01", refs: [ref("scheduled")] }), { tone: "coral", label: "Missed" })
  assert.deepEqual(athleteSessionState({ ...base, date: "2026-10-01", refs: [ref("scheduled")], excused: true }), { tone: "neutral", label: "Excused" })
  assert.equal(athleteSessionState({ ...base, date: "2026-10-01", refs: [] }), null, "joined later: never due")
  assert.deepEqual(athleteSessionState({ ...base, date: "2026-10-05", refs: [ref("scheduled")] }), { tone: "blue", label: "Today" })
  assert.deepEqual(athleteSessionState({ ...base, date: "2026-10-05", refs: [ref("in-progress")] }), { tone: "blue", label: "Started" })
  assert.equal(athleteSessionState({ ...base, date: "2026-10-09", refs: [ref("scheduled")] }), null)
  assert.deepEqual(athleteSessionState({ ...base, date: "2026-10-09", refs: [], excused: true }), { tone: "neutral", label: "Excused" })
  assert.equal(athleteSessionState({ ...base, date: "2026-10-01", refs: [ref("scheduled", "athlete")], planned: false }), null, "an unfinished session they added is not missed")
})

test("the athlete's sessions: planned days joined with what they did, plus the ones they added", () => {
  const items = athleteSessionItems({
    planned: [
      { date: "2026-10-01", title: "Acceleration" },
      { date: "2026-10-02", title: "Gym" },
      { date: "2026-10-06", title: "Tempo" },
    ],
    refs: [
      { id: "r1", date: "2026-10-01", title: "Acceleration", origin: "plan", status: "completed" },
      { id: "r2", date: "2026-10-02", title: "Gym", origin: "plan", status: "scheduled" },
      { id: "r3", date: "2026-10-03", title: "Easy jog", origin: "athlete", status: "completed" },
    ],
    excusedOn: () => false,
    today: "2026-10-05",
    to: (day, own) => (own ? `/log/${own.id}` : `/plan/${day}`),
  })
  assert.deepEqual(
    items.map((entry) => [entry.startsOn, entry.title, entry.state?.label ?? null, entry.to, entry.detail ?? null]),
    [
      ["2026-10-01", "Acceleration", "Done", "/plan/2026-10-01", null],
      ["2026-10-02", "Gym", "Missed", "/plan/2026-10-02", null],
      ["2026-10-06", "Tempo", null, "/plan/2026-10-06", null],
      ["2026-10-03", "Easy jog", "Done", "/log/r3", "Added by you"],
    ],
  )
  assert.equal(new Set(items.map((entry) => entry.key)).size, items.length)
})

/* ---------- club events ---------- */

const event = (over: Partial<ClubEvent> = {}): ClubEvent => ({ id: "e1", title: "Parents' meeting", startsOn: "2026-10-08", endsOn: "2026-10-08", startTime: "18:00", endTime: "19:30", place: "Club house", note: "Bring forms", audience: "club", teamIds: [], createdByRole: "club-admin", ...over })
const ADMIN = { role: "club-admin" as const, teamIds: [] }
const COACH_T1 = { role: "coach" as const, teamIds: ["t1"] }
const ATHLETE_T1 = { role: "athlete" as const, teamIds: ["t1"] }

test("who sees an event: the same rule as the row policy", () => {
  const club = event()
  const t1 = event({ audience: "teams", teamIds: ["t1"] })
  const t2 = event({ audience: "teams", teamIds: ["t2"] })
  const both = event({ audience: "teams", teamIds: ["t1", "t2"] })
  for (const viewer of [ADMIN, COACH_T1, ATHLETE_T1]) assert.ok(eventVisibleTo(club, viewer))
  assert.deepEqual([t1, t2, both].map((entry) => eventVisibleTo(entry, ADMIN)), [true, true, true])
  assert.deepEqual([t1, t2, both].map((entry) => eventVisibleTo(entry, COACH_T1)), [true, false, true])
  assert.deepEqual([t1, t2, both].map((entry) => eventVisibleTo(entry, ATHLETE_T1)), [true, false, true])
  assert.equal(eventVisibleTo(t1, { role: "athlete", teamIds: [] }), false)
})

test("who may change an event: admins all, a coach only when every team of it is theirs, athletes never", () => {
  const club = event()
  const t1 = event({ audience: "teams", teamIds: ["t1"] })
  const both = event({ audience: "teams", teamIds: ["t1", "t2"] })
  assert.deepEqual([club, t1, both].map((entry) => canManageEvent(entry, ADMIN)), [true, true, true])
  assert.deepEqual([club, t1, both].map((entry) => canManageEvent(entry, COACH_T1)), [false, true, false])
  assert.deepEqual([club, t1, both].map((entry) => canManageEvent(entry, { role: "coach", teamIds: ["t1", "t2"] })), [false, true, true])
  assert.deepEqual([club, t1, both].map((entry) => canManageEvent(entry, ATHLETE_T1)), [false, false, false])
  assert.equal(canManageEvent(event({ audience: "teams", teamIds: [] }), COACH_T1), false)
})

test("an event is checked before it is saved", () => {
  const input = (over: Partial<ClubEventInput> = {}): ClubEventInput => ({ ...event(), ...over })
  assert.equal(validateClubEvent(input(), ADMIN), null)
  assert.match(validateClubEvent(input({ title: "  " }), ADMIN) ?? "", /title/)
  assert.match(validateClubEvent(input({ title: "x".repeat(121) }), ADMIN) ?? "", /120/)
  assert.match(validateClubEvent(input({ endsOn: "2026-10-07" }), ADMIN) ?? "", /last day/)
  assert.match(validateClubEvent(input({ endsOn: "2026-12-31" }), ADMIN) ?? "", /60 days/)
  assert.match(validateClubEvent(input({ startTime: null }), ADMIN) ?? "", /start time/)
  assert.match(validateClubEvent(input({ endTime: "17:00" }), ADMIN) ?? "", /after the start/)
  assert.equal(validateClubEvent(input({ endsOn: "2026-10-09", endTime: "08:00" }), ADMIN), null, "an overnight event may end earlier on the clock")
  assert.match(validateClubEvent(input({ audience: "teams", teamIds: [] }), ADMIN) ?? "", /at least one team/)
  assert.match(validateClubEvent(input(), COACH_T1) ?? "", /teams you coach/)
  assert.match(validateClubEvent(input({ audience: "teams", teamIds: ["t2"] }), COACH_T1) ?? "", /teams you coach/)
  assert.equal(validateClubEvent(input({ audience: "teams", teamIds: ["t1"] }), COACH_T1), null)
  assert.match(validateClubEvent(input(), ATHLETE_T1) ?? "", /coach or a club admin/)
})

/* ---------- add to calendar ---------- */

test("only competitions, test weeks and club events can be added to a phone calendar", () => {
  assert.equal(icsEventForItem(item({ key: "s", kind: "session", startsOn: "2026-10-06", sourceId: "p1" })), null)
  assert.equal(icsEventForItem(item({ key: "u", kind: "unavailable", startsOn: "2026-10-06", sourceId: "x", names: ["Marcus Johnson"] })), null)
  assert.equal(icsEventForItem(item({ key: "n", kind: "session-count", startsOn: "2026-10-06", sourceId: "x" })), null)
  assert.equal(icsEventForItem(item({ key: "c", kind: "competition", startsOn: "2026-10-06" })), null, "nothing without an id")
})

test("the file for a competition: all day, stable UID, place, and none of the in-app detail", () => {
  const competition = item({ key: "competition:c1", kind: "competition", startsOn: "2026-10-24", endsOn: "2026-10-25", title: "Club Championships", place: "National Stadium, Kingston", detail: "Whole club, 3 athletes entered", sourceId: "c1" })
  const file = icsFileForItem(competition, "America/Jamaica", new Date("2026-10-05T12:00:00Z"))!
  assert.equal(file.filename, "club-championships.ics")
  const lines = file.content.replace(/\r\n /g, "").split("\r\n")
  assert.ok(lines.includes("UID:competition-c1@sktr-coach"))
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20261024"))
  assert.ok(lines.includes("DTEND;VALUE=DATE:20261026"))
  assert.ok(lines.includes("LOCATION:National Stadium\\, Kingston"))
  assert.ok(!file.content.includes("athletes entered"))
  assert.equal(icsFileForItem(competition, "America/Jamaica", new Date("2026-12-01T00:00:00Z"))!.content.match(/UID:.*/)?.[0], file.content.match(/UID:.*/)?.[0])
})

test("the file for a test week and for a timed club event in the club's time zone", () => {
  const week = icsFileForItem(item({ key: "test-week:w1", kind: "test-week", startsOn: "2026-10-12", endsOn: "2026-10-14", title: "October testing", detail: "Test week, Sprint Group", sourceId: "w1" }), "America/Jamaica")!
  assert.ok(week.content.includes("SUMMARY:Test week: October testing\r\n"))
  assert.ok(week.content.includes("DTEND;VALUE=DATE:20261015\r\n"))
  const meeting = clubEventItem(event(), { t1: "Sprint Group" })
  assert.equal(meeting.detail, "Whole club")
  assert.equal(clubEventItem(event({ audience: "teams", teamIds: ["t1"] }), { t1: "Sprint Group" }).detail, "Sprint Group")
  const file = icsFileForItem(meeting, "America/Jamaica")!
  const lines = file.content.replace(/\r\n /g, "").split("\r\n")
  assert.ok(lines.includes("UID:event-e1@sktr-coach"))
  assert.ok(lines.includes("DTSTART:20261008T230000Z"))
  assert.ok(lines.includes("DTEND:20261009T003000Z"))
  assert.ok(lines.includes("SUMMARY:Parents' meeting"))
  assert.ok(lines.includes("LOCATION:Club house"))
  assert.ok(lines.includes("DESCRIPTION:Bring forms"))
  // The same meeting for a club in London is an hour earlier in UTC (summer time).
  assert.ok(icsFileForItem(meeting, "Europe/London")!.content.includes("DTSTART:20261008T170000Z"))
})
