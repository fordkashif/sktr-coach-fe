/**
 * Track and field marks: the event list, how a mark is typed, stored, written and compared, and
 * how personal and season bests are picked from an athlete's history.
 *
 * Pure: no imports, no browser, no Supabase. The database applies the same rules in
 * supabase/migrations/20261008100000_results_history_and_competitions.sql (result_events,
 * format_result_mark(), athlete_event_best()). Keep the two in step.
 */

/** The canonical unit a mark is stored in. Times are seconds, field events metres. */
export type MarkUnit = "s" | "m" | "cm" | "kg" | "pts"
export type EventKind = "time" | "distance" | "points" | "weight" | "other"
export type Timing = "electronic" | "hand"
export type ResultSource = "competition" | "test_week" | "training" | "manual" | "imported"
export type ResultEnvironment = "outdoor" | "indoor"

export type ResultEvent = {
  key: string
  name: string
  category: string
  kind: EventKind
  /** Null for "other": the person adding the result chooses. */
  unit: MarkUnit | null
  lowerIsBetter: boolean | null
  /** A wind reading is taken for this event outdoors. */
  windApplies: boolean
  /** Seconds added to a hand time before it is compared with electronic times. */
  handAdjust: number
  aliases?: string[]
}

function timed(key: string, name: string, category: string, handAdjust = 0, windApplies = false, aliases: string[] = []): ResultEvent {
  return { key, name, category, kind: "time", unit: "s", lowerIsBetter: true, windApplies, handAdjust, aliases }
}
function field(key: string, name: string, category: string, windApplies = false, aliases: string[] = []): ResultEvent {
  return { key, name, category, kind: "distance", unit: "m", lowerIsBetter: false, windApplies, handAdjust: 0, aliases }
}
function combined(key: string, name: string): ResultEvent {
  return { key, name, category: "Combined events", kind: "points", unit: "pts", lowerIsBetter: false, windApplies: false, handAdjust: 0 }
}
function lift(key: string, name: string, aliases: string[] = []): ResultEvent {
  return { key, name, category: "Strength", kind: "weight", unit: "kg", lowerIsBetter: false, windApplies: false, handAdjust: 0, aliases }
}

export const OTHER_EVENT_KEY = "other"

/** In display order. The same rows as public.result_events. */
export const RESULT_EVENTS: ResultEvent[] = [
  timed("60m", "60m", "Sprints", 0.24),
  timed("100m", "100m", "Sprints", 0.24, true),
  timed("150m", "150m", "Sprints", 0.24),
  timed("200m", "200m", "Sprints", 0.24, true),
  timed("300m", "300m", "Sprints", 0.24),
  timed("400m", "400m", "Sprints", 0.14),
  timed("60m_hurdles", "60m hurdles", "Hurdles", 0.24, false, ["60mh"]),
  timed("100m_hurdles", "100m hurdles", "Hurdles", 0.24, true, ["100mh"]),
  timed("110m_hurdles", "110m hurdles", "Hurdles", 0.24, true, ["110mh"]),
  timed("300m_hurdles", "300m hurdles", "Hurdles", 0.24, false, ["300mh"]),
  timed("400m_hurdles", "400m hurdles", "Hurdles", 0.14, false, ["400mh"]),
  timed("600m", "600m", "Middle distance"),
  timed("800m", "800m", "Middle distance"),
  timed("1000m", "1000m", "Middle distance"),
  timed("1500m", "1500m", "Middle distance"),
  timed("mile", "Mile", "Middle distance", 0, false, ["1mile"]),
  timed("3000m", "3000m", "Distance"),
  timed("2000m_steeplechase", "2000m steeplechase", "Distance", 0, false, ["2000msc"]),
  timed("3000m_steeplechase", "3000m steeplechase", "Distance", 0, false, ["3000msc"]),
  timed("5000m", "5000m", "Distance"),
  timed("10000m", "10000m", "Distance", 0, false, ["10,000m"]),
  timed("5k_road", "5K road", "Distance", 0, false, ["5k"]),
  timed("10k_road", "10K road", "Distance", 0, false, ["10k"]),
  timed("half_marathon", "Half marathon", "Distance"),
  timed("marathon", "Marathon", "Distance"),
  timed("5000m_walk", "5000m walk", "Walks"),
  timed("10km_walk", "10km walk", "Walks"),
  timed("20km_walk", "20km walk", "Walks"),
  timed("4x100m", "4x100m relay", "Relays", 0.24, false, ["4x100m", "4x100"]),
  timed("4x200m", "4x200m relay", "Relays", 0.24, false, ["4x200m", "4x200"]),
  timed("4x400m", "4x400m relay", "Relays", 0.14, false, ["4x400m", "4x400"]),
  field("high_jump", "High jump", "Jumps", false, ["hj"]),
  field("pole_vault", "Pole vault", "Jumps", false, ["pv"]),
  field("long_jump", "Long jump", "Jumps", true, ["lj"]),
  field("triple_jump", "Triple jump", "Jumps", true, ["tj"]),
  field("shot_put", "Shot put", "Throws", false, ["shot", "sp"]),
  field("discus", "Discus", "Throws", false, ["discusthrow"]),
  field("hammer", "Hammer", "Throws", false, ["hammerthrow"]),
  field("javelin", "Javelin", "Throws", false, ["javelinthrow"]),
  combined("pentathlon", "Pentathlon"),
  combined("heptathlon", "Heptathlon"),
  combined("decathlon", "Decathlon"),
  lift("back_squat", "Back squat", ["squat"]),
  lift("front_squat", "Front squat"),
  lift("bench_press", "Bench press", ["bench"]),
  lift("deadlift", "Deadlift"),
  lift("power_clean", "Power clean"),
  lift("clean_and_jerk", "Clean and jerk"),
  lift("snatch", "Snatch"),
  lift("hip_thrust", "Hip thrust"),
  { key: OTHER_EVENT_KEY, name: "Other", category: "Other", kind: "other", unit: null, lowerIsBetter: null, windApplies: false, handAdjust: 0 },
]

/** Section order on the Records screen. Tests and other free text events come last. */
export const EVENT_CATEGORY_ORDER = [
  "Sprints",
  "Hurdles",
  "Middle distance",
  "Distance",
  "Walks",
  "Relays",
  "Jumps",
  "Throws",
  "Combined events",
  "Strength",
  "Tests",
]

const EVENTS_BY_KEY = new Map(RESULT_EVENTS.map((event) => [event.key, event]))

export function findResultEvent(key: string | null | undefined): ResultEvent | null {
  return (key && EVENTS_BY_KEY.get(key)) || null
}

/** What bests are grouped by: "k:100m" for a listed event, "o:flying 30m" for a free text one. */
export function eventGroupKey(eventKey: string, label: string): string {
  if (eventKey !== OTHER_EVENT_KEY) return `k:${eventKey}`
  return `o:${cleanLabel(label).toLowerCase()}`
}

export function cleanLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().slice(0, 80)
}

/**
 * Which event a free text name is (a test a coach named in a test week). A name on the list, in a
 * unit that fits, is that event; anything else is "other" under its own name. `factor` converts a
 * value given in `unit` to the event's unit (centimetres to metres for a jump).
 */
export function resolveEventByName(name: string, unit: MarkUnit): { eventKey: string; label: string; unit: MarkUnit; lowerIsBetter: boolean; factor: number } {
  const normalised = name.replace(/\s+/g, "").toLowerCase()
  const match = RESULT_EVENTS.find(
    (event) =>
      event.kind !== "other" &&
      (event.name.replace(/\s+/g, "").toLowerCase() === normalised || event.key.replace(/_/g, "") === normalised || (event.aliases ?? []).includes(normalised)) &&
      (event.unit === unit || (event.unit === "m" && unit === "cm")),
  )
  if (match && match.unit) {
    return { eventKey: match.key, label: match.name, unit: match.unit, lowerIsBetter: Boolean(match.lowerIsBetter), factor: match.unit === "m" && unit === "cm" ? 0.01 : 1 }
  }
  return { eventKey: OTHER_EVENT_KEY, label: cleanLabel(name) || "Other", unit, lowerIsBetter: unit === "s", factor: 1 }
}

/* ---------- Typing a mark ---------------------------------------------------------------- */

export type ParsedMark = { ok: true; value: number } | { ok: false; message: string }

const MAX_MARK = 1_000_000

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

/**
 * Reads what a person typed for a mark in the given unit.
 *   s    "10.84", "10,84", "1:52.30", "2:45:30" (hundredths at most)
 *   m    "7.42", "7,4" (two decimals at most)
 *   cm   "72", "72.5"
 *   kg   "185", "182.5"
 *   pts  "5420"
 */
export function parseMarkInput(text: string, unit: MarkUnit): ParsedMark {
  const raw = text.trim().replace(/,/g, ".")
  if (!raw) return { ok: false, message: "Enter the mark." }

  if (unit === "s") {
    const parts = raw.split(":")
    if (parts.length > 3 || parts.some((part) => part === "")) {
      return { ok: false, message: "Write a time like 10.84 or 1:52.30." }
    }
    const last = parts[parts.length - 1]
    if (!/^\d{1,5}(\.\d{1,2})?$/.test(last) || parts.slice(0, -1).some((part) => !/^\d{1,3}$/.test(part))) {
      return {
        ok: false,
        message: /^\d+\.\d{3,}$/.test(last) ? "Times go to hundredths, like 10.84." : "Write a time like 10.84 or 1:52.30.",
      }
    }
    const seconds = Number(last)
    if (parts.length > 1 && (seconds >= 60 || !/^\d{2}(\.|$)/.test(last))) {
      return { ok: false, message: "After the colon use two digits of seconds, like 1:05.30." }
    }
    if (parts.length === 3 && Number(parts[1]) >= 60) {
      return { ok: false, message: "Minutes after the hours must be under 60, like 2:45:30." }
    }
    const value = parts.length === 1 ? seconds : parts.length === 2 ? Number(parts[0]) * 60 + seconds : Number(parts[0]) * 3600 + Number(parts[1]) * 60 + seconds
    if (!(value > 0)) return { ok: false, message: "The time must be more than 0." }
    if (value >= MAX_MARK) return { ok: false, message: "That time is too long." }
    return { ok: true, value: roundTo(value, 2) }
  }

  const decimals = unit === "m" || unit === "kg" ? 2 : unit === "cm" ? 1 : 0
  const pattern = decimals === 0 ? /^\d{1,6}$/ : new RegExp(`^\\d{1,6}(\\.\\d{1,${decimals}})?$`)
  if (!pattern.test(raw)) {
    if (unit === "m") return { ok: false, message: "Write the distance in metres, like 7.42." }
    if (unit === "kg") return { ok: false, message: "Write the weight in kilograms, like 182.5." }
    if (unit === "cm") return { ok: false, message: "Write the height in centimetres, like 72." }
    return { ok: false, message: "Write the points as a whole number, like 5420." }
  }
  const value = Number(raw)
  if (!(value > 0)) return { ok: false, message: "The mark must be more than 0." }
  return { ok: true, value: roundTo(value, decimals) }
}

export type ParsedWind = { ok: true; value: number | null } | { ok: false; message: string }

/** "+1.2", "-0.3", "1.2", "0", "" (no reading). One decimal, between -9.9 and +9.9. */
export function parseWindInput(text: string): ParsedWind {
  const raw = text.trim().replace(/,/g, ".").replace(/\s*m\/s$/i, "").replace(/^−/, "-")
  if (!raw) return { ok: true, value: null }
  if (!/^[+-]?\d(\.\d)?$/.test(raw)) return { ok: false, message: "Write the wind with its sign and one decimal, like +1.2 or -0.4." }
  return { ok: true, value: roundTo(Number(raw), 1) }
}

/* ---------- Writing a mark ---------------------------------------------------------------- */

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

/**
 * The mark the way it is written on a results sheet, without a unit:
 * "10.84", "10.6h" (hand), "1:52.30", "2:45:30", "7.42", "185", "5420".
 */
export function formatMark(value: number, unit: MarkUnit, timing: Timing | null = null): string {
  if (unit === "s") {
    const tenths = Math.abs(value * 10 - Math.round(value * 10)) < 1e-6
    const decimals = timing === "hand" && tenths ? 1 : 2
    const rounded = roundTo(value, decimals)
    const suffix = timing === "hand" ? "h" : ""
    if (rounded >= 3600) {
      const hours = Math.floor(rounded / 3600)
      const minutes = Math.floor((rounded - hours * 3600) / 60)
      const seconds = roundTo(rounded - hours * 3600 - minutes * 60, 2)
      const whole = Math.floor(seconds)
      const fraction = Math.round((seconds - whole) * 100)
      return `${hours}:${pad2(minutes)}:${pad2(whole)}${fraction ? `.${pad2(fraction)}` : ""}${suffix}`
    }
    if (rounded >= 60) {
      const minutes = Math.floor(rounded / 60)
      const seconds = roundTo(rounded - minutes * 60, decimals)
      const [whole, fraction = ""] = seconds.toFixed(decimals).split(".")
      return `${minutes}:${whole.padStart(2, "0")}.${fraction}${suffix}`
    }
    return `${rounded.toFixed(decimals)}${suffix}`
  }
  if (unit === "m") return roundTo(value, 2).toFixed(2)
  if (unit === "pts") return String(Math.round(value))
  return String(roundTo(value, 2))
}

/** The unit to show beside a written mark. Clock times ("1:52.30") and hand times ("10.6h") carry none. */
export function markUnitLabel(display: string, unit: MarkUnit): string {
  if (unit === "s") return display.includes(":") || display.endsWith("h") ? "" : "s"
  return unit === "pts" ? " pts" : unit
}

/** "10.84s", "1:52.30", "7.42m", "185kg", "5420 pts". */
export function formatMarkWithUnit(display: string, unit: MarkUnit): string {
  return `${display}${markUnitLabel(display, unit)}`
}

/** "+1.2", "-0.3", "0.0". Empty when there is no reading. */
export function formatWind(wind: number | null | undefined): string {
  if (wind === null || wind === undefined) return ""
  const fixed = roundTo(wind, 1).toFixed(1)
  return wind > 0 ? `+${fixed}` : fixed === "-0.0" ? "0.0" : fixed
}

/** A mark with a following wind of more than 2.0 metres per second does not count for records. */
export const WIND_LEGAL_LIMIT = 2.0

export function isWindLegal(wind: number | null | undefined): boolean {
  return wind === null || wind === undefined || wind <= WIND_LEGAL_LIMIT
}

/** What marks are ranked by: the mark, plus the hand timing adjustment for a hand time. */
export function compareValueFor(value: number, timing: Timing | null, event: ResultEvent | null): number {
  return roundTo(value + (timing === "hand" && event ? event.handAdjust : 0), 3)
}

/* ---------- History and bests ---------------------------------------------------------------- */

export type AthleteResult = {
  id: string
  athleteId: string
  eventKey: string
  eventLabel: string
  eventGroup: string
  unit: MarkUnit
  lowerIsBetter: boolean
  value: number
  compareValue: number
  /** Written mark without a unit: "10.84". */
  display: string
  timing: Timing | null
  /** YYYY-MM-DD */
  date: string
  source: ResultSource
  competitionId: string | null
  competitionEntryId: string | null
  testResultId: string | null
  place: number | null
  wind: number | null
  windLegal: boolean
  environment: ResultEnvironment
  altitude: boolean
  /** Where it was set: the meet, the test week, or what the athlete typed. */
  location: string | null
  notes: string | null
  enteredByUserId: string | null
  createdAt: string
}

export type Season = { start: string; end: string }

/** The club's season when today falls inside it, otherwise the calendar year. Dates are YYYY-MM-DD. */
export function seasonFor(today: string, clubSeason?: { start: string; end: string } | null): Season {
  if (clubSeason && clubSeason.start <= today && today <= clubSeason.end) return { start: clubSeason.start, end: clubSeason.end }
  const year = today.slice(0, 4)
  return { start: `${year}-01-01`, end: `${year}-12-31` }
}

export function inSeason(date: string, season: Season): boolean {
  return season.start <= date.slice(0, 10) && date.slice(0, 10) <= season.end
}

/** Negative when `a` is the better result. Ties go to the mark that was set first. */
export function compareResults(a: AthleteResult, b: AthleteResult): number {
  const direction = a.lowerIsBetter ? 1 : -1
  if (a.compareValue !== b.compareValue) return (a.compareValue - b.compareValue) * direction
  if (a.date !== b.date) return a.date.localeCompare(b.date)
  return a.createdAt.localeCompare(b.createdAt)
}

function bestOf(results: AthleteResult[]): AthleteResult | null {
  return results.reduce<AthleteResult | null>((best, result) => (best === null || compareResults(result, best) < 0 ? result : best), null)
}

export type EventBests = {
  /** Best wind legal mark ever. */
  personalBest: AthleteResult | null
  /** Best wind legal mark of the season. */
  seasonBest: AthleteResult | null
  /** Best wind assisted mark, only when it is better than the personal best (or there is no legal mark). */
  windAssistedBest: AthleteResult | null
}

/** Bests for ONE event (pass the results of one event group). */
export function selectBests(results: AthleteResult[], season: Season): EventBests {
  const legal = results.filter((result) => result.windLegal)
  const personalBest = bestOf(legal)
  const seasonBest = bestOf(legal.filter((result) => inSeason(result.date, season)))
  const assisted = bestOf(results.filter((result) => !result.windLegal))
  const windAssistedBest = assisted && (personalBest === null || (assisted.lowerIsBetter ? assisted.compareValue < personalBest.compareValue : assisted.compareValue > personalBest.compareValue)) ? assisted : null
  return { personalBest, seasonBest, windAssistedBest }
}

export type EventHistory = {
  group: string
  eventKey: string
  label: string
  category: string
  unit: MarkUnit
  lowerIsBetter: boolean
  /** Newest first. */
  results: AthleteResult[]
  bests: EventBests
}

function categoryOf(result: AthleteResult): string {
  const event = findResultEvent(result.eventKey)
  if (event && event.kind !== "other") return event.category
  return "Tests"
}

function eventOrder(key: string): number {
  const index = RESULT_EVENTS.findIndex((event) => event.key === key)
  return index === -1 ? RESULT_EVENTS.length : index
}

/** An athlete's whole history, one entry per event, in event list order. */
export function groupResultsByEvent(results: AthleteResult[], season: Season): EventHistory[] {
  const groups = new Map<string, AthleteResult[]>()
  for (const result of results) {
    const list = groups.get(result.eventGroup) ?? []
    list.push(result)
    groups.set(result.eventGroup, list)
  }
  return [...groups.entries()]
    .map(([group, list]) => {
      const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      const bests = selectBests(sorted, season)
      const lead = bests.personalBest ?? sorted[0]
      return {
        group,
        eventKey: lead.eventKey,
        label: lead.eventLabel,
        category: categoryOf(lead),
        unit: lead.unit,
        lowerIsBetter: lead.lowerIsBetter,
        results: sorted,
        bests,
      }
    })
    .sort((a, b) => {
      const ca = EVENT_CATEGORY_ORDER.indexOf(a.category)
      const cb = EVENT_CATEGORY_ORDER.indexOf(b.category)
      if (ca !== cb) return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb)
      const ea = eventOrder(a.eventKey)
      const eb = eventOrder(b.eventKey)
      if (ea !== eb) return ea - eb
      return a.label.localeCompare(b.label)
    })
}

/** What a result was when it was set: a personal best, a season best, wind assisted, or just a result. */
export type ResultStanding = "personal-best" | "season-best" | "wind-assisted" | null

/**
 * Walks one event's history in date order and says what each result was on the day:
 * a personal best when it beat every earlier legal mark, a season best when it beat every earlier
 * legal mark of its own calendar season. The first mark ever counts as a personal best.
 */
export function standingsOverTime(results: AthleteResult[], seasonOf: (date: string) => Season = (date) => seasonFor(date)): Map<string, ResultStanding> {
  const ordered = [...results].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  const standings = new Map<string, ResultStanding>()
  let best: AthleteResult | null = null
  const seasonBests = new Map<string, AthleteResult>()
  for (const result of ordered) {
    if (!result.windLegal) {
      standings.set(result.id, "wind-assisted")
      continue
    }
    const seasonKey = seasonOf(result.date).start
    const seasonBest = seasonBests.get(seasonKey) ?? null
    if (best === null || compareResults(result, best) < 0) {
      standings.set(result.id, "personal-best")
      best = result
      seasonBests.set(seasonKey, result)
    } else if (seasonBest === null || compareResults(result, seasonBest) < 0) {
      standings.set(result.id, "season-best")
      seasonBests.set(seasonKey, result)
    } else {
      standings.set(result.id, null)
    }
  }
  return standings
}

export type NewResultVerdict = {
  kind: "personal-best" | "season-best" | "first" | "wind-assisted" | "none"
  /** The mark it beat, when there was one. */
  beat: AthleteResult | null
}

/** What a result that was just added means, given the event's history WITH the new result in it. */
export function verdictForNewResult(added: AthleteResult, eventResults: AthleteResult[], season: Season): NewResultVerdict {
  const others = eventResults.filter((result) => result.id !== added.id)
  if (!added.windLegal) return { kind: "wind-assisted", beat: null }
  const before = selectBests(others, season)
  const after = selectBests(eventResults, season)
  if (after.personalBest?.id === added.id) {
    return before.personalBest ? { kind: "personal-best", beat: before.personalBest } : { kind: "first", beat: null }
  }
  if (inSeason(added.date, season) && after.seasonBest?.id === added.id) {
    return { kind: "season-best", beat: before.seasonBest }
  }
  return { kind: "none", beat: null }
}

/** "0.08s faster", "0.12m further", "0.05m higher", "5kg more", "120 pts more". Null when equal. */
export function describeDifference(current: AthleteResult, reference: AthleteResult): { text: string; improved: boolean } | null {
  if (current.unit !== reference.unit) return null
  const diff = roundTo(current.compareValue - reference.compareValue, 3)
  if (diff === 0) return null
  const improved = current.lowerIsBetter ? diff < 0 : diff > 0
  const amount = Math.abs(diff)
  const unit = current.unit
  const amountText =
    unit === "s"
      ? amount >= 60
        ? formatMark(amount, "s")
        : `${amount.toFixed(2)}s`
      : unit === "m"
        ? `${amount.toFixed(2)}m`
        : unit === "pts"
          ? `${Math.round(amount)} pts`
          : `${roundTo(amount, 2)}${unit}`
  const vertical = current.eventKey === "high_jump" || current.eventKey === "pole_vault" || unit === "cm"
  const word =
    unit === "s"
      ? diff < 0
        ? "faster"
        : "slower"
      : unit === "m" || unit === "cm"
        ? diff > 0
          ? vertical
            ? "higher"
            : "further"
          : vertical
            ? "lower"
            : "shorter"
        : diff > 0
          ? "more"
          : "less"
  return { text: `${amountText} ${word}`, improved }
}

/** "Wind +1.2", "Wind +2.6, wind assisted", "Indoor". Empty when there is nothing to say. */
export function resultConditions(result: Pick<AthleteResult, "wind" | "windLegal" | "environment" | "altitude" | "timing">): string {
  const parts: string[] = []
  if (result.wind !== null) parts.push(`Wind ${formatWind(result.wind)}`)
  if (!result.windLegal) parts.push("wind assisted")
  if (result.environment === "indoor") parts.push("indoor")
  if (result.timing === "hand") parts.push("hand timed")
  if (result.altitude) parts.push("at altitude")
  const text = parts.join(", ")
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ""
}

export const RESULT_SOURCE_LABELS: Record<ResultSource, string> = {
  competition: "Competition",
  test_week: "Test week",
  training: "Training",
  manual: "Added by hand",
  imported: "Earlier record",
}
