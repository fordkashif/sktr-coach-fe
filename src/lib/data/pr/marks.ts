/**
 * Track and field marks: the event list, how a mark is typed, stored, written and compared, and
 * how personal and season bests are picked from an athlete's history.
 *
 * Pure: no imports, no browser, no Supabase. The database applies the same rules in
 * supabase/migrations/20261008100000_results_history_and_competitions.sql (result_events,
 * format_result_mark(), athlete_event_best()) and, for rounds, splits, attempt series and heights,
 * in 20261016100000_result_detail_splits_attempts_relays_rounds.sql (apply_result_detail()).
 * Keep them in step.
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

/* ---------- Rounds and detail: the shapes ---------------------------------------------------- */

export type ResultRound = "heat" | "quarter_final" | "semi_final" | "final" | "timed_final"
/** Q: went through on place. q: went through on time. */
export type Qualifier = "Q" | "q"

/** One attempt of a horizontal jump or a throw: a distance, a foul (X) or a pass (-). */
export type Attempt = { result: "mark"; mark: number; wind?: number | null } | { result: "foul" } | { result: "pass" }

/** One height of a vertical jump with what happened at it: "O", "XO", "XXO", "X", "XX", "XXX", "-", "X-", "XX-". */
export type HeightLine = { height: number; tries: string }

/** Running (cumulative) times in seconds. `every` is the distance between splits in metres, when it is regular. */
export type SplitsDetail = { every: number | null; times: number[] }

/** What a result can carry beyond its mark. Stored in one canonical form (see applyResultDetail). */
export type ResultDetail = {
  splits?: SplitsDetail
  /** Reaction time in seconds, three decimals. */
  reaction?: number
  attempts?: Attempt[]
  heights?: HeightLine[]
}

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
  /** Heat, semi final, final. Null or missing when the event had one round or nobody said. */
  round?: ResultRound | null
  /** Which heat (or section of a timed final). */
  heat?: number | null
  lane?: number | null
  qualifier?: Qualifier | null
  /** Splits, reaction time, attempt series or heights. */
  detail?: ResultDetail | null
  /** Set on the row that holds the best wind legal attempt of a series whose best attempt was wind assisted. */
  derivedFromResultId?: string | null
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

/* ---------- Rounds and heats ------------------------------------------------------------------- */

export const RESULT_ROUNDS: Array<{ value: ResultRound; label: string }> = [
  { value: "heat", label: "Heat" },
  { value: "quarter_final", label: "Quarter final" },
  { value: "semi_final", label: "Semi final" },
  { value: "final", label: "Final" },
  { value: "timed_final", label: "Timed final" },
]

/** "Heat", "Semi final". Empty when there is no round. */
export function roundLabel(round: ResultRound | null | undefined): string {
  return RESULT_ROUNDS.find((item) => item.value === round)?.label ?? ""
}

/**
 * An entry holds one result per slot. The deciding round is one slot: a result with no round, a
 * final and a timed final are the same place in the running order.
 */
export type RoundSlot = "heat" | "quarter_final" | "semi_final" | "final"

export function roundSlot(round: ResultRound | null | undefined): RoundSlot {
  return round === "heat" || round === "quarter_final" || round === "semi_final" ? round : "final"
}

const ROUND_SLOT_ORDER: Record<RoundSlot, number> = { heat: 1, quarter_final: 2, semi_final: 3, final: 4 }

/** 1 for a heat up to 4 for the deciding round. */
export function roundOrder(round: ResultRound | null | undefined): number {
  return ROUND_SLOT_ORDER[roundSlot(round)]
}

type RoundFields = { round?: ResultRound | null; heat?: number | null; lane?: number | null; qualifier?: Qualifier | null }

/** "Heat 2, lane 4, qualified on place (Q)". Empty when nothing was recorded. The place is said separately. */
export function describeRound(result: RoundFields): string {
  const parts: string[] = []
  const label = roundLabel(result.round)
  if (label) parts.push(result.heat ? `${label} ${result.heat}` : label)
  else if (result.heat) parts.push(`Race ${result.heat}`)
  if (result.lane) parts.push(`lane ${result.lane}`)
  if (result.qualifier) parts.push(result.qualifier === "Q" ? "qualified on place (Q)" : "qualified on time (q)")
  const text = parts.join(", ")
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ""
}

/** The results of one entry in running order: heat, quarter final, semi final, then the deciding round. */
export function sortRounds<T extends { round?: ResultRound | null; date: string; createdAt: string }>(results: T[]): T[] {
  return [...results].sort((a, b) => roundOrder(a.round) - roundOrder(b.round) || a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
}

/** The result an entry is known by: the last round that was run. Null when there is none. */
export function headlineResult<T extends { round?: ResultRound | null; date: string; createdAt: string }>(results: T[]): T | null {
  const sorted = sortRounds(results)
  return sorted[sorted.length - 1] ?? null
}

/* ---------- Splits ------------------------------------------------------------------------------- */

/** How far an event is, in metres. Null when its name does not say (a test a coach named). */
export function eventDistance(eventKey: string): number | null {
  if (eventKey === "mile") return 1609
  if (eventKey === "half_marathon") return 21098
  if (eventKey === "marathon") return 42195
  const relay = /^4x(\d+)m$/.exec(eventKey)
  if (relay) return 4 * Number(relay[1])
  const kilometres = /^(\d+)k(?:m)?_/.exec(eventKey)
  if (kilometres) return Number(kilometres[1]) * 1000
  const metres = /^(\d+)m(?:_|$)/.exec(eventKey)
  return metres ? Number(metres[1]) : null
}

/** The usual distance between splits: 200m in a 400m, a lap from 800m up, a kilometre on long ones. Null: no usual one. */
export function defaultSplitEvery(eventKey: string): number | null {
  const distance = eventDistance(eventKey)
  if (distance === null || distance <= 150) return null
  if (distance <= 300) return 100
  if (distance <= 400) return 200
  if (distance <= 3000) return 400
  if (distance <= 12000) return 1000
  return 5000
}

/** How splits are typed: the running time at each point, or the time of each lap on its own. Stored as running times. */
export type SplitEntryMode = "running" | "lap"

/** What was typed, as running (cumulative) times. */
export function toRunningSplits(values: number[], mode: SplitEntryMode): number[] {
  if (mode === "running") return values.map((value) => roundTo(value, 2))
  let total = 0
  return values.map((value) => {
    total = roundTo(total + value, 2)
    return total
  })
}

/** Running times as the time of each lap. */
export function toLapSplits(running: number[]): number[] {
  return running.map((value, index) => roundTo(value - (index === 0 ? 0 : running[index - 1]), 2))
}

/** Checks running times against each other and against the final time. A message in plain words, or null when fine. */
export function checkSplits(running: number[], finalTime: number | null): string | null {
  if (running.length > 40) return "A result can hold 40 splits at most."
  for (let index = 0; index < running.length; index += 1) {
    const value = running[index]
    if (!(value > 0)) return `Split ${index + 1} must be more than 0.`
    if (index > 0 && value <= running[index - 1]) {
      return `Split ${index + 1} (${formatMark(value, "s")}) must be later than split ${index} (${formatMark(running[index - 1], "s")}). Each split must be later than the one before it.`
    }
    if (finalTime !== null && value > finalTime) {
      return `Split ${index + 1} (${formatMark(value, "s")}) is larger than the final time (${formatMark(finalTime, "s")}). A split cannot be larger than the final time.`
    }
  }
  return null
}

export type SplitRow = {
  /** "200m", "Split 2", "Finish". */
  label: string
  /** Running time at this point. */
  time: number
  /** Time of this lap on its own. */
  lap: number
  /** This lap against the one before: negative is faster. Null for the first lap and when the two laps are not the same length. */
  change: number | null
  finish: boolean
}

/** A race's splits as table rows, ending with the finish. */
export function splitRows(splits: SplitsDetail, finalTime: number, eventKey: string): SplitRow[] {
  const every = splits.every
  const distance = eventDistance(eventKey)
  const times = splits.times.filter((time) => time < finalTime)
  const points = [...times, finalTime]
  const lastLegMatches = every !== null && distance !== null ? distance - every * times.length === every : false
  return points.map((time, index) => {
    const finish = index === points.length - 1
    const lap = roundTo(time - (index === 0 ? 0 : points[index - 1]), 2)
    const previousLap = index === 0 ? null : roundTo(points[index - 1] - (index === 1 ? 0 : points[index - 2]), 2)
    const comparable = every !== null && (!finish || lastLegMatches)
    return {
      label: finish ? "Finish" : every !== null ? `${every * (index + 1)}m` : `Split ${index + 1}`,
      time,
      lap,
      change: previousLap !== null && comparable ? roundTo(lap - previousLap, 2) : null,
      finish,
    }
  })
}

/** "+0.42", "-0.31", "0.00": a lap against the one before. */
export function formatLapChange(change: number): string {
  const amount = Math.abs(change)
  const text = amount >= 60 ? formatMark(amount, "s") : amount.toFixed(2)
  return change > 0 ? `+${text}` : change < 0 ? `-${text}` : text
}

export type ParsedReaction = { ok: true; value: number | null } | { ok: false; message: string }

/** "0.152", ".152", "0,152", "" (none). Seconds, three decimals, under one second. */
export function parseReactionInput(text: string): ParsedReaction {
  const raw = text.trim().replace(/,/g, ".")
  if (!raw) return { ok: true, value: null }
  if (!/^0?\.\d{1,3}$/.test(raw)) return { ok: false, message: "Write the reaction time in seconds, like 0.152." }
  const value = roundTo(Number(raw), 3)
  if (!(value > 0)) return { ok: false, message: "A reaction time is more than 0." }
  return { ok: true, value }
}

export function formatReaction(value: number): string {
  return roundTo(value, 3).toFixed(3)
}

/* ---------- Attempt series (horizontal jumps and throws) ------------------------------------------ */

export const MAX_ATTEMPTS = 6

export type ParsedAttempt = { ok: true; attempt: Attempt | null } | { ok: false; message: string }

/** "6.42" a distance, "X" a foul, "-" a pass, "" not taken. */
export function parseAttemptInput(text: string): ParsedAttempt {
  const raw = text.trim()
  if (!raw) return { ok: true, attempt: null }
  if (/^(x|f|foul)$/i.test(raw)) return { ok: true, attempt: { result: "foul" } }
  if (/^(-|–|p|pass)$/i.test(raw)) return { ok: true, attempt: { result: "pass" } }
  const parsed = parseMarkInput(raw, "m")
  if (!parsed.ok || parsed.value >= 1000) return { ok: false, message: "Write a distance like 6.42, X for a foul or - for a pass." }
  return { ok: true, attempt: { result: "mark", mark: parsed.value } }
}

/** "6.42", "X" or "-". */
export function formatAttempt(attempt: Attempt): string {
  return attempt.result === "mark" ? formatMark(attempt.mark, "m") : attempt.result === "foul" ? "X" : "-"
}

export type SeriesSummary = {
  /** The attempt that is the result: the longest; of two equal ones a wind legal one, then the earlier. Null with no measured attempt. */
  bestIndex: number | null
  /** The best wind legal attempt, only when the best attempt itself was wind assisted and another one was legal. */
  legalIndex: number | null
  measured: number
  fouls: number
  passes: number
}

function attemptWindLegal(attempt: Attempt): boolean {
  return attempt.result === "mark" && isWindLegal(attempt.wind ?? null)
}

export function summariseSeries(attempts: Attempt[]): SeriesSummary {
  let bestIndex: number | null = null
  let legalBest: number | null = null
  let measured = 0
  let fouls = 0
  let passes = 0
  const markAt = (index: number | null) => (index === null ? null : (attempts[index] as Extract<Attempt, { result: "mark" }>))
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]
    if (attempt.result === "foul") {
      fouls += 1
      continue
    }
    if (attempt.result === "pass") {
      passes += 1
      continue
    }
    measured += 1
    const best = markAt(bestIndex)
    if (best === null || attempt.mark > best.mark || (attempt.mark === best.mark && !attemptWindLegal(best) && attemptWindLegal(attempt))) bestIndex = index
    if (attemptWindLegal(attempt)) {
      const legal = markAt(legalBest)
      if (legal === null || attempt.mark > legal.mark) legalBest = index
    }
  }
  const best = markAt(bestIndex)
  return { bestIndex, legalIndex: best !== null && !attemptWindLegal(best) ? legalBest : null, measured, fouls, passes }
}

/* ---------- Heights (high jump and pole vault) --------------------------------------------------- */

const TRIES_PATTERN = /^(O|XO|XXO|X|XX|XXX|-|X-|XX-)$/

/** "xo" becomes "XO". Also takes 0 for O and P for a pass. Null when it is not a line of attempts. */
export function normaliseTries(text: string): string | null {
  const tries = text.replace(/\s+/g, "").toUpperCase().replace(/0/g, "O").replace(/[P–]/g, "-")
  return TRIES_PATTERN.test(tries) ? tries : null
}

export type ParsedHeightLine = { ok: true; line: HeightLine } | { ok: false; message: string }

/** "1.85 XO", "1,85 xo", "1.90m XXX". */
export function parseHeightLine(text: string): ParsedHeightLine {
  const match = /^\s*(\d+(?:[.,]\d{1,2})?)\s*m?\s+(\S(?:.*\S)?)\s*$/.exec(text)
  const height = match ? parseMarkInput(match[1], "m") : null
  const tries = match ? normaliseTries(match[2]) : null
  if (!height || !height.ok || height.value >= 10 || !tries) return { ok: false, message: "Write a height and its attempts, like 1.85 XO." }
  return { ok: true, line: { height: height.value, tries } }
}

/** "1.80 O, 1.85 XO, 1.90 XXX" (commas, semicolons or new lines between heights). */
export function parseHeightSeries(text: string): { ok: true; lines: HeightLine[] } | { ok: false; message: string } {
  const lines: HeightLine[] = []
  // A comma between heights follows the attempts or is followed by a space; a decimal comma ("1,85") does neither.
  for (const part of text.split(/[;\n]|(?<=\s[oOxX0pP–-]{1,3})\s*,|,(?=\s)/)) {
    if (!part.trim()) continue
    const parsed = parseHeightLine(part)
    if (!parsed.ok) return parsed
    lines.push(parsed.line)
  }
  return { ok: true, lines }
}

/** "1.85 XO" */
export function formatHeightLine(line: HeightLine): string {
  return `${formatMark(line.height, "m")} ${line.tries}`
}

function failuresIn(tries: string): number {
  return tries.split("").filter((letter) => letter === "X").length
}

export type HeightsSummary = {
  /** The highest height cleared. Null when none was. */
  best: number | null
  bestIndex: number | null
  /** 1, 2 or 3: the attempt the best height was cleared on. */
  clearedOnAttempt: number | null
  /** The first tie-break: failures at the height last cleared. */
  failuresAtBest: number
  /** The second tie-break: failures in the whole competition up to and including the height last cleared. */
  totalFailures: number
  /** Three failures in a row: the athlete's competition is over. */
  out: boolean
}

export function summariseHeights(heights: HeightLine[]): HeightsSummary {
  let bestIndex = -1
  let run = 0
  let out = false
  for (let index = 0; index < heights.length; index += 1) {
    if (heights[index].tries.endsWith("O")) {
      bestIndex = index
      run = 0
    } else {
      run += failuresIn(heights[index].tries)
    }
    if (run >= 3) out = true
  }
  if (bestIndex < 0) return { best: null, bestIndex: null, clearedOnAttempt: null, failuresAtBest: 0, totalFailures: 0, out }
  const best = heights[bestIndex]
  return {
    best: best.height,
    bestIndex,
    clearedOnAttempt: best.tries.length,
    failuresAtBest: failuresIn(best.tries),
    totalFailures: heights.slice(0, bestIndex + 1).reduce((sum, line) => sum + failuresIn(line.tries), 0),
    out,
  }
}

/* ---------- Detail as a whole ---------------------------------------------------------------------- */

/** Which kinds of detail an event takes. */
export function detailKindsFor(eventKey: string, unit: MarkUnit | null): { splits: boolean; reaction: boolean; attempts: boolean; heights: boolean } {
  const event = findResultEvent(eventKey)
  const vertical = eventKey === "high_jump" || eventKey === "pole_vault"
  const distance = eventDistance(eventKey)
  return {
    splits: unit === "s" && (distance === null || distance >= 200),
    reaction: unit === "s" && Boolean(event) && (event?.category === "Sprints" || event?.category === "Hurdles"),
    attempts: unit === "m" && !vertical,
    heights: vertical,
  }
}

export type AppliedDetail =
  | {
      ok: true
      /** The detail in its canonical form. Null when nothing applies to the event. */
      detail: ResultDetail | null
      /** True when the mark comes from the detail (an attempt series or heights). */
      series: boolean
      /** The best measured attempt or the highest height cleared; the mark that was passed in when there is no series. */
      mark: number | null
      wind: number | null
      /** The best wind legal attempt, only when the best attempt was wind assisted and another was legal. */
      legal: { mark: number; wind: number | null } | null
    }
  | { ok: false; message: string }

/**
 * Checks the detail of a result and puts it in its canonical form, with what follows from it.
 * The database does the same in apply_result_detail(); the messages match.
 * Parts that do not belong to the event are dropped: splits and reaction are for times, attempts
 * for distances other than the high jump and pole vault, heights for those two.
 */
export function applyResultDetail(detail: ResultDetail | null | undefined, context: { eventKey: string; unit: MarkUnit; windApplies: boolean; mark: number | null }): AppliedDetail {
  const { eventKey, unit, windApplies, mark } = context
  if (!detail) return { ok: true, detail: null, series: false, mark, wind: null, legal: null }
  const vertical = eventKey === "high_jump" || eventKey === "pole_vault"
  const out: ResultDetail = {}
  let series = false
  let seriesMark: number | null = null
  let seriesWind: number | null = null
  let legal: { mark: number; wind: number | null } | null = null

  if (unit === "s" && detail.splits && Array.isArray(detail.splits.times)) {
    const times = detail.splits.times.map((time) => roundTo(Number(time), 2))
    if (times.length > 40) return { ok: false, message: "A result can hold 40 splits at most." }
    for (let index = 0; index < times.length; index += 1) {
      if (!Number.isFinite(times[index])) return { ok: false, message: "Every split must be a time." }
      if (!(times[index] > 0)) return { ok: false, message: "Every split must be more than 0." }
      if (index > 0 && times[index] <= times[index - 1]) return { ok: false, message: "Each split must be later than the one before it." }
      if (mark !== null && times[index] > mark) return { ok: false, message: "A split cannot be larger than the final time." }
    }
    const every = detail.splits.every ?? null
    if (every !== null && (!Number.isInteger(every) || every < 10 || every > 10000)) {
      return { ok: false, message: "The distance between splits is a whole number of metres, like 200." }
    }
    // A last split equal to the final time is the finish itself, which is the mark.
    const kept = times.filter((time) => mark === null || time < mark)
    if (kept.length > 0) out.splits = { every, times: kept }
  }

  if (unit === "s" && detail.reaction !== undefined && detail.reaction !== null) {
    const reaction = roundTo(Number(detail.reaction), 3)
    if (!Number.isFinite(reaction)) return { ok: false, message: "A reaction time is a number of seconds, like 0.152." }
    if (reaction <= 0 || reaction >= 1) return { ok: false, message: "A reaction time is under one second, like 0.152." }
    out.reaction = reaction
  }

  if (unit === "m" && !vertical && Array.isArray(detail.attempts) && detail.attempts.length > 0) {
    if (detail.attempts.length > MAX_ATTEMPTS) return { ok: false, message: "A series has six attempts at most." }
    const attempts: Attempt[] = []
    for (const attempt of detail.attempts) {
      if (attempt?.result === "foul" || attempt?.result === "pass") {
        attempts.push({ result: attempt.result })
      } else if (attempt?.result === "mark" && typeof attempt.mark === "number") {
        const value = roundTo(attempt.mark, 2)
        if (!(value > 0) || value >= 1000) return { ok: false, message: "Every measured attempt needs a distance in metres, like 6.42." }
        const wind = windApplies && typeof attempt.wind === "number" ? roundTo(attempt.wind, 1) : null
        if (wind !== null && (wind < -9.9 || wind > 9.9)) return { ok: false, message: "Wind must be between -9.9 and +9.9." }
        attempts.push(wind === null ? { result: "mark", mark: value } : { result: "mark", mark: value, wind })
      } else {
        return { ok: false, message: "An attempt is a distance, a foul (X) or a pass (-)." }
      }
    }
    const summary = summariseSeries(attempts)
    if (summary.bestIndex === null) {
      return { ok: false, message: "A series needs at least one measured attempt. With only fouls and passes there is no mark to save." }
    }
    const best = attempts[summary.bestIndex] as Extract<Attempt, { result: "mark" }>
    series = true
    seriesMark = best.mark
    seriesWind = best.wind ?? null
    if (summary.legalIndex !== null) {
      const legalAttempt = attempts[summary.legalIndex] as Extract<Attempt, { result: "mark" }>
      legal = { mark: legalAttempt.mark, wind: legalAttempt.wind ?? null }
    }
    out.attempts = attempts
  }

  if (vertical && Array.isArray(detail.heights) && detail.heights.length > 0) {
    if (detail.heights.length > 30) return { ok: false, message: "A competition can hold 30 heights at most." }
    const heights: HeightLine[] = []
    let run = 0
    for (const line of detail.heights) {
      const height = typeof line?.height === "number" ? roundTo(line.height, 2) : Number.NaN
      if (!(height > 0) || height >= 10) return { ok: false, message: "Every line needs a height in metres, like 1.85." }
      const tries = normaliseTries(String(line.tries ?? ""))
      if (!tries) return { ok: false, message: "Write the attempts at a height with O, X and -, like O, XO or XXX." }
      if (heights.length > 0 && height <= heights[heights.length - 1].height) return { ok: false, message: "Heights go up: each one must be higher than the one before." }
      if (run >= 3) return { ok: false, message: "After three failures in a row the competition is over, so no height can follow." }
      run = tries.endsWith("O") ? 0 : run + failuresIn(tries)
      heights.push({ height, tries })
    }
    const summary = summariseHeights(heights)
    if (summary.best === null) return { ok: false, message: "No height was cleared, so there is no mark to save." }
    series = true
    seriesMark = summary.best
    seriesWind = null
    out.heights = heights
  }

  return {
    ok: true,
    detail: Object.keys(out).length > 0 ? out : null,
    series,
    mark: series ? seriesMark : mark,
    wind: series ? seriesWind : null,
    legal,
  }
}

/** True when a result carries more than its mark: a round, a lane, splits, a series. */
export function hasResultDetail(result: Pick<AthleteResult, "round" | "heat" | "lane" | "qualifier" | "detail">): boolean {
  return Boolean(result.round || result.heat || result.lane || result.qualifier || (result.detail && Object.keys(result.detail).length > 0))
}

/** Running splits as one line of text for a file: "24.10; 49.80". Empty when there are none. */
export function splitsText(detail: ResultDetail | null | undefined): string {
  return (detail?.splits?.times ?? []).map((time) => formatMark(time, "s")).join("; ")
}

/** The attempts or heights as one line of text for a file: "6.42 (+1.1); X; -" or "1.80 O; 1.85 XO". */
export function seriesText(detail: ResultDetail | null | undefined): string {
  if (detail?.attempts?.length) {
    return detail.attempts
      .map((attempt) => `${formatAttempt(attempt)}${attempt.result === "mark" && attempt.wind !== null && attempt.wind !== undefined ? ` (${formatWind(attempt.wind)})` : ""}`)
      .join("; ")
  }
  if (detail?.heights?.length) return detail.heights.map(formatHeightLine).join("; ")
  return ""
}
