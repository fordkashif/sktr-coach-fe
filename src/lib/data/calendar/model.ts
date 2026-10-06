// The calendar's pure logic: no DOM, no network, no storage. Unit tested in tests/calendar.test.ts.
//
// A calendar is a flat list of CalendarItem. The month grid and the agenda are two ways of
// laying the same list out. Days are ISO strings (YYYY-MM-DD) and months are "YYYY-MM".

import { addDaysToDay, calendarUid, type IcsEvent } from "../../../../supabase/functions/_shared/calendar-feed"

export type CalendarItemKind = "session" | "session-count" | "test-week" | "competition" | "event" | "unavailable"

/** Same tones as the kit's StatusDot. */
export type CalendarTone = "green" | "amber" | "coral" | "blue" | "neutral"

export type ClubEventAudience = "club" | "teams"

export type ClubEvent = {
  id: string
  title: string
  startsOn: string
  /** Last day, inclusive. */
  endsOn: string
  /** HH:MM in the club's time zone, or null for all day. */
  startTime: string | null
  endTime: string | null
  place: string | null
  note: string | null
  audience: ClubEventAudience
  teamIds: string[]
  createdByRole: string | null
}

export type ClubEventInput = Omit<ClubEvent, "id" | "createdByRole"> & { id?: string | null }

export type CalendarItem = {
  /** Unique within one calendar. */
  key: string
  kind: CalendarItemKind
  title: string
  startsOn: string
  /** Last day, inclusive. */
  endsOn: string
  startTime?: string | null
  endTime?: string | null
  /** One plain line under the title. */
  detail?: string | null
  place?: string | null
  /** Where a tap goes. Null for an item that opens in place (a club event). */
  to?: string | null
  teamId?: string | null
  teamName?: string | null
  /** An athlete's own session: done, skipped, missed and so on. */
  state?: { tone: CalendarTone; label: string } | null
  /** kind "unavailable": who, shown only after the entry is opened. */
  names?: string[]
  /** kind "unavailable" and "session-count". */
  count?: number
  /** The id of the competition, test week or event behind the item. */
  sourceId?: string | null
  event?: ClubEvent
}

/* ---------- Days and months ------------------------------------------------------------------ */

export function isDayKey(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

export function isMonthKey(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

export const addDays = addDaysToDay

export function monthOf(day: string): string {
  return day.slice(0, 7)
}

export function shiftMonth(month: string, amount: number): string {
  const [year, index] = month.split("-").map(Number)
  const date = new Date(Date.UTC(year, index - 1 + amount, 1))
  return date.toISOString().slice(0, 7)
}

/** First and last day of a month. */
export function monthBounds(month: string): { from: string; to: string } {
  const [year, index] = month.split("-").map(Number)
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` }
}

/** 0 for Monday to 6 for Sunday. */
export function weekdayIndex(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
}

/** The days the month grid shows: whole weeks, Monday first, so it can start in the month before and end in the one after. */
export function gridBounds(month: string): { from: string; to: string } {
  const { from, to } = monthBounds(month)
  return { from: addDays(from, -weekdayIndex(from)), to: addDays(to, 6 - weekdayIndex(to)) }
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to && days.length < 800; day = addDays(day, 1)) days.push(day)
  return days
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

/** "October 2026" */
export function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number)
  return `${MONTHS[index - 1]} ${year}`
}

/** "Wednesday 14 October" */
export function longDayLabel(day: string): string {
  const [, month, date] = day.split("-").map(Number)
  return `${WEEKDAYS[weekdayIndex(day)]} ${date} ${MONTHS[month - 1]}`
}

/** "14 Oct" */
export function shortDayLabel(day: string): string {
  const [, month, date] = day.split("-").map(Number)
  return `${date} ${MONTHS[month - 1].slice(0, 3)}`
}

export function weekdayShort(day: string): string {
  return WEEKDAYS[weekdayIndex(day)].slice(0, 3)
}

/** "14 Oct" for one day, "14 to 16 Oct" inside a month, "30 Oct to 2 Nov" across months. */
export function rangeLabel(startsOn: string, endsOn: string): string {
  if (endsOn <= startsOn) return shortDayLabel(startsOn)
  if (monthOf(startsOn) === monthOf(endsOn)) return `${Number(startsOn.slice(8))} to ${shortDayLabel(endsOn)}`
  return `${shortDayLabel(startsOn)} to ${shortDayLabel(endsOn)}`
}

/** "18:00" reads as "6:00 pm". Empty for anything that is not a clock time. */
export function clockLabel(time: string | null | undefined): string {
  const match = time ? /^([01]\d|2[0-3]):([0-5]\d)/.exec(time) : null
  if (!match) return ""
  const hour = Number(match[1])
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${hour < 12 ? "am" : "pm"}`
}

/** "6:00 pm to 7:30 pm", "6:00 pm", or "" for all day. */
export function timeRangeLabel(startTime: string | null | undefined, endTime: string | null | undefined): string {
  const start = clockLabel(startTime)
  const end = clockLabel(endTime)
  return start && end ? `${start} to ${end}` : start
}

/* ---------- Reading a list of items ------------------------------------------------------------ */

const KIND_ORDER: Record<CalendarItemKind, number> = { event: 0, competition: 1, "test-week": 2, session: 3, "session-count": 4, unavailable: 5 }

export function itemCovers(item: Pick<CalendarItem, "startsOn" | "endsOn">, day: string): boolean {
  return item.startsOn <= day && day <= item.endsOn
}

function compareItems(left: CalendarItem, right: CalendarItem): number {
  // Timed things first, by the clock; then by kind; then by name.
  const leftTime = left.startTime ?? "99:99"
  const rightTime = right.startTime ?? "99:99"
  return leftTime.localeCompare(rightTime) || KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.title.localeCompare(right.title) || left.key.localeCompare(right.key)
}

/** Everything on one day, in the order it is listed. */
export function itemsOnDay(items: CalendarItem[], day: string): CalendarItem[] {
  return items.filter((item) => itemCovers(item, day)).sort(compareItems)
}

export function isSpan(item: Pick<CalendarItem, "startsOn" | "endsOn">): boolean {
  return item.endsOn > item.startsOn
}

/** The dot a day gets for an item in the month grid. Colour is state: blue is on, amber is watch. */
export function itemTone(item: CalendarItem): CalendarTone {
  if (item.kind === "unavailable") return "amber"
  if (item.kind === "session") return item.state?.tone ?? "neutral"
  if (item.kind === "session-count") return "neutral"
  return "blue"
}

/* ---------- Month grid ---------------------------------------------------------------------- */

export type MonthSpan = {
  item: CalendarItem
  /** Row of the bar inside the cell, the same on every day of the span. */
  lane: number
  isStart: boolean
  isEnd: boolean
  /** The name is written on the first day and again at the start of each week row. */
  showTitle: boolean
}

export type MonthCell = {
  date: string
  dayNumber: number
  inMonth: boolean
  isToday: boolean
  /** Everything on the day, spans included (what the day sheet lists). */
  items: CalendarItem[]
  /** Things lasting more than one day that are drawn as a bar: test weeks, competitions, events. */
  spans: Array<MonthSpan | null>
  /** One day things, written in the cell on desktop. */
  singles: CalendarItem[]
  /** At most four dots for the phone grid, most important first, one per tone. */
  dots: CalendarTone[]
}

export type MonthGrid = { month: string; weeks: MonthCell[][] }

const DOT_ORDER: CalendarTone[] = ["coral", "blue", "amber", "green", "neutral"]

function drawnAsBar(item: CalendarItem) {
  return isSpan(item) && (item.kind === "test-week" || item.kind === "competition" || item.kind === "event")
}

/**
 * The weeks of a month, Monday first, each day with what is on it. Days of the months before and
 * after fill the first and last week (inMonth false).
 */
export function buildMonthGrid(month: string, items: CalendarItem[], today: string): MonthGrid {
  const { from, to } = gridBounds(month)
  const visible = items.filter((item) => item.endsOn >= from && item.startsOn <= to)

  // Lanes: longest and earliest spans take the top rows, and keep their row on every day.
  const bars = visible.filter(drawnAsBar).sort((left, right) => left.startsOn.localeCompare(right.startsOn) || right.endsOn.localeCompare(left.endsOn) || left.key.localeCompare(right.key))
  const laneEnds: string[] = []
  const laneOf = new Map<string, number>()
  for (const bar of bars) {
    let lane = laneEnds.findIndex((end) => end < bar.startsOn)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = bar.endsOn
    laneOf.set(bar.key, lane)
  }

  const cells = daysBetween(from, to).map((date): MonthCell => {
    const onDay = itemsOnDay(visible, date)
    const dayBars = onDay.filter(drawnAsBar)
    const lanes = dayBars.length > 0 ? Math.max(...dayBars.map((bar) => laneOf.get(bar.key) ?? 0)) + 1 : 0
    const spans: Array<MonthSpan | null> = Array.from({ length: lanes }, () => null)
    for (const bar of dayBars) {
      spans[laneOf.get(bar.key) ?? 0] = {
        item: bar,
        lane: laneOf.get(bar.key) ?? 0,
        isStart: bar.startsOn === date,
        isEnd: bar.endsOn === date,
        showTitle: bar.startsOn === date || weekdayIndex(date) === 0 || date === from,
      }
    }
    const tones = new Set(onDay.map(itemTone))
    return {
      date,
      dayNumber: Number(date.slice(8)),
      inMonth: monthOf(date) === month,
      isToday: date === today,
      items: onDay,
      spans,
      singles: onDay.filter((item) => !drawnAsBar(item)),
      dots: DOT_ORDER.filter((tone) => tones.has(tone)).slice(0, 4),
    }
  })

  const weeks: MonthCell[][] = []
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7))
  return { month, weeks }
}

/** What a screen reader hears for a day: "Wednesday 14 October, today, 3 things". */
export function dayAriaLabel(cell: Pick<MonthCell, "date" | "isToday" | "items">): string {
  const count = cell.items.length
  return `${longDayLabel(cell.date)}${cell.isToday ? ", today" : ""}, ${count === 0 ? "nothing on" : count === 1 ? "1 thing" : `${count} things`}`
}

/* ---------- Agenda ---------------------------------------------------------------------------- */

export type AgendaDay = { date: string; items: CalendarItem[] }

/**
 * The list view: one group per day that has something, oldest first. Something lasting several days
 * is listed once, on its first day inside the range (its dates are in its own line), so a ten day
 * camp is one row and not ten.
 */
export function buildAgenda(items: CalendarItem[], from: string, to: string): AgendaDay[] {
  const byDay = new Map<string, CalendarItem[]>()
  for (const item of items) {
    if (item.endsOn < from || item.startsOn > to) continue
    const day = item.startsOn < from ? from : item.startsOn
    byDay.set(day, [...(byDay.get(day) ?? []), item])
  }
  return [...byDay.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, dayItems]) => ({ date, items: dayItems.sort(compareItems) }))
}

/** The line under an item's title: when (for spans and timed things), where, then its own detail. */
export function itemSubtitle(item: CalendarItem): string {
  const parts: string[] = []
  if (isSpan(item)) parts.push(rangeLabel(item.startsOn, item.endsOn))
  const time = timeRangeLabel(item.startTime, item.endTime)
  if (time) parts.push(time)
  if (item.place) parts.push(item.place)
  if (item.detail) parts.push(item.detail)
  return parts.join(", ")
}

/* ---------- Making items ---------------------------------------------------------------------- */

export type PlannedDay = { date: string; title: string; planId?: string | null; teamId?: string | null; teamName?: string | null; to?: string | null }

/** A team's planned sessions: one entry per day and session title, however many athletes or plans have it. */
export function teamSessionItems(days: PlannedDay[]): CalendarItem[] {
  const seen = new Map<string, CalendarItem>()
  for (const day of days) {
    const date = day.date.slice(0, 10)
    const title = day.title.trim()
    if (!isDayKey(date) || !title) continue
    const key = `session:${day.teamId ?? ""}:${date}:${title.toLowerCase()}`
    if (seen.has(key)) continue
    seen.set(key, { key, kind: "session", title, startsOn: date, endsOn: date, to: day.to ?? null, teamId: day.teamId ?? null, teamName: day.teamName ?? null, sourceId: day.planId ?? null })
  }
  return [...seen.values()]
}

/** The club calendar: a number of sessions per day and team, never the session lines themselves. */
export function sessionCountItems(days: PlannedDay[]): CalendarItem[] {
  const counts = new Map<string, CalendarItem>()
  for (const item of teamSessionItems(days)) {
    const key = `count:${item.teamId ?? ""}:${item.startsOn}`
    const existing = counts.get(key)
    const count = (existing?.count ?? 0) + 1
    counts.set(key, {
      key,
      kind: "session-count",
      title: item.teamName ?? "Team",
      detail: count === 1 ? "1 session" : `${count} sessions`,
      startsOn: item.startsOn,
      endsOn: item.startsOn,
      teamId: item.teamId,
      teamName: item.teamName,
      count,
    })
  }
  return [...counts.values()]
}

export type UnavailablePeriod = { athleteId: string; startsOn: string; endsOn: string | null }

/**
 * Athletes who cannot train, as calendar entries for a coach: a count per stretch of days on which
 * the same people are out. The names are carried for the opened entry only, and the reason
 * (injured, sick, away) is left out altogether.
 */
export function unavailableItems(
  athletes: Array<{ id: string; name: string }>,
  periods: UnavailablePeriod[],
  range: { from: string; to: string },
  team: { teamId: string; to: (day: string) => string },
): CalendarItem[] {
  const nameOf = new Map(athletes.map((athlete) => [athlete.id, athlete.name]))
  const items: CalendarItem[] = []
  let open: { ids: string; names: string[]; from: string; to: string } | null = null
  const close = () => {
    if (!open) return
    const count = open.names.length
    items.push({
      key: `unavailable:${team.teamId}:${open.from}`,
      kind: "unavailable",
      title: count === 1 ? "1 athlete unavailable" : `${count} athletes unavailable`,
      startsOn: open.from,
      endsOn: open.to,
      to: team.to(open.from),
      teamId: team.teamId,
      names: open.names,
      count,
    })
    open = null
  }
  for (const day of daysBetween(range.from, range.to)) {
    const out = [...new Set(periods.filter((period) => nameOf.has(period.athleteId) && period.startsOn <= day && (period.endsOn === null || period.endsOn >= day)).map((period) => period.athleteId))].sort()
    const ids = out.join(",")
    if (open && open.ids === ids) {
      open.to = day
      continue
    }
    close()
    if (out.length > 0) open = { ids, names: out.map((id) => nameOf.get(id) ?? "").sort((left, right) => left.localeCompare(right)), from: day, to: day }
  }
  close()
  return items
}

export type SessionRefLite = { date: string; title: string; origin: "plan" | "athlete"; status: "scheduled" | "in-progress" | "completed" | "skipped" }

/** Where one of the athlete's own sessions stands on their calendar. Null for a day still to come. */
export function athleteSessionState(input: { date: string; today: string; refs: SessionRefLite[]; excused: boolean; planned: boolean }): { tone: CalendarTone; label: string } | null {
  const { date, today, refs, excused } = input
  if (refs.some((ref) => ref.status === "completed")) return { tone: "green", label: "Done" }
  if (refs.some((ref) => ref.status === "skipped")) return { tone: "neutral", label: "Skipped" }
  if (date === today) return refs.some((ref) => ref.status === "in-progress") ? { tone: "blue", label: "Started" } : excused ? { tone: "neutral", label: "Excused" } : { tone: "blue", label: "Today" }
  if (excused) return { tone: "neutral", label: "Excused" }
  if (date > today) return null
  // A past planned day with no session of the athlete's (they joined later) was never due.
  if (input.planned && refs.length === 0) return null
  return refs.some((ref) => ref.origin === "plan") ? { tone: "coral", label: "Missed" } : null
}

/**
 * The athlete's sessions for their calendar: every planned day and every session they have (planned
 * or added by them), one entry per day and title, with its state.
 */
export function athleteSessionItems(input: {
  planned: PlannedDay[]
  refs: Array<SessionRefLite & { id: string }>
  excusedOn: (day: string) => boolean
  today: string
  to: (day: string, ref: (SessionRefLite & { id: string }) | null) => string
}): CalendarItem[] {
  const groups = new Map<string, { date: string; title: string; planned: boolean; refs: Array<SessionRefLite & { id: string }> }>()
  const keyOf = (date: string, title: string) => `${date}:${title.trim().toLowerCase()}`
  for (const day of input.planned) {
    const date = day.date.slice(0, 10)
    if (!isDayKey(date) || !day.title.trim()) continue
    const key = keyOf(date, day.title)
    if (!groups.has(key)) groups.set(key, { date, title: day.title.trim(), planned: true, refs: [] })
  }
  for (const ref of input.refs) {
    if (!isDayKey(ref.date) || !ref.title.trim()) continue
    const key = keyOf(ref.date, ref.title)
    const group = groups.get(key) ?? { date: ref.date, title: ref.title.trim(), planned: ref.origin === "plan", refs: [] }
    group.refs.push(ref)
    groups.set(key, group)
  }
  return [...groups.entries()].map(([key, group]) => {
    const own = group.refs.find((ref) => ref.origin === "athlete") ?? null
    return {
      key: `session:${key}`,
      kind: "session" as const,
      title: group.title,
      startsOn: group.date,
      endsOn: group.date,
      detail: !group.planned && own ? "Added by you" : null,
      to: input.to(group.date, !group.planned ? own : null),
      state: athleteSessionState({ date: group.date, today: input.today, refs: group.refs, excused: input.excusedOn(group.date), planned: group.planned }),
    }
  })
}

export function clubEventItem(event: ClubEvent, teamNames: Record<string, string> = {}): CalendarItem {
  const teams = event.teamIds.map((id) => teamNames[id]).filter(Boolean)
  return {
    key: `event:${event.id}`,
    kind: "event",
    title: event.title,
    startsOn: event.startsOn,
    endsOn: event.endsOn,
    startTime: event.startTime,
    endTime: event.endTime,
    place: event.place,
    detail: event.audience === "club" ? "Whole club" : teams.length > 0 ? teams.join(", ") : null,
    to: null,
    sourceId: event.id,
    event,
  }
}

/* ---------- Club events: rules ----------------------------------------------------------------- */

export type CalendarViewer = { role: "athlete" | "coach" | "club-admin"; teamIds: string[] }

/** The same rule as the row policy: club admins see all, everyone sees whole club events, others their teams' events. */
export function eventVisibleTo(event: Pick<ClubEvent, "audience" | "teamIds">, viewer: CalendarViewer): boolean {
  if (viewer.role === "club-admin" || event.audience === "club") return true
  return event.teamIds.some((id) => viewer.teamIds.includes(id))
}

/** The same rule as can_manage_club_event: a coach only when every team of the event is theirs. */
export function canManageEvent(event: Pick<ClubEvent, "audience" | "teamIds">, viewer: CalendarViewer): boolean {
  if (viewer.role === "club-admin") return true
  if (viewer.role !== "coach") return false
  return event.audience === "teams" && event.teamIds.length > 0 && event.teamIds.every((id) => viewer.teamIds.includes(id))
}

export const CLUB_EVENT_MAX_DAYS = 60

/** Null when the event can be saved, otherwise what to fix, in plain words. */
export function validateClubEvent(input: ClubEventInput, viewer: CalendarViewer): string | null {
  const title = input.title.trim()
  if (!title) return "Give the event a title."
  if (title.length > 120) return "Keep the title to 120 characters."
  if (!isDayKey(input.startsOn)) return "Choose the day it starts."
  if (!isDayKey(input.endsOn) || input.endsOn < input.startsOn) return "The last day cannot be before the first day."
  if (input.endsOn > addDays(input.startsOn, CLUB_EVENT_MAX_DAYS)) return `An event can last up to ${CLUB_EVENT_MAX_DAYS} days.`
  if (input.endTime && !input.startTime) return "Add a start time, or clear the end time."
  if (input.startTime && input.endTime && input.endsOn === input.startsOn && input.endTime <= input.startTime) return "The end time must be after the start time."
  if ((input.place ?? "").length > 160) return "Keep the place to 160 characters."
  if ((input.note ?? "").length > 1000) return "Keep the note to 1000 characters."
  if (input.audience === "teams" && input.teamIds.length === 0) return "Choose at least one team."
  if (viewer.role === "athlete") return "Only a coach or a club admin can add club events."
  if (viewer.role === "coach" && !canManageEvent(input, viewer)) return "You can add events for the teams you coach only."
  return null
}

/* ---------- One-off "Add to calendar" files ------------------------------------------------------ */

/**
 * The calendar file entry for something a person adds to their phone by hand. Only competitions,
 * test weeks and club events can be added. Names of athletes and anything about health never go in.
 */
export function icsEventForItem(item: CalendarItem): IcsEvent | null {
  if (!item.sourceId) return null
  if (item.kind === "competition") {
    return { uid: calendarUid("competition", item.sourceId), title: item.title, startsOn: item.startsOn, endsOn: item.endsOn, place: item.place ?? null }
  }
  if (item.kind === "test-week") {
    return { uid: calendarUid("test-week", item.sourceId), title: `Test week: ${item.title}`, startsOn: item.startsOn, endsOn: item.endsOn }
  }
  if (item.kind === "event") {
    return {
      uid: calendarUid("event", item.sourceId),
      title: item.title,
      startsOn: item.startsOn,
      endsOn: item.endsOn,
      startTime: item.startTime ?? null,
      endTime: item.endTime ?? null,
      place: item.place ?? null,
      description: item.event?.note ?? null,
    }
  }
  return null
}
