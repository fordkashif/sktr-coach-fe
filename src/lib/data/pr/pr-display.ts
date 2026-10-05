import type { PrRecord } from "@/lib/data/pr/types"

/**
 * Display helpers shared by the athlete Progress and Personal records screens.
 * Marks are stored as free text ("4.05s", "185kg", "1:52.30"), so everything here
 * parses defensively and returns null rather than guessing.
 */

/** Parse the YYYY-MM-DD part of a value as a local calendar day (never via UTC). */
export function parseLocalDay(value: string | null | undefined): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

export function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** Monday of the week the date falls in. */
export function weekStart(date: Date): Date {
  const offset = (date.getDay() + 6) % 7
  return addDays(date, -offset)
}

/** "Mar 2, 2026". Falls back to the raw text if it is not a date. */
export function formatFullDay(value: string | Date | null | undefined): string {
  const date = value instanceof Date ? value : parseLocalDay(value)
  if (!date) return typeof value === "string" ? value : ""
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

/** "Mar 2" for chart ticks, where the year is stated next to the chart. */
export function formatShortDay(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export type Mark = {
  /** The number as typed, e.g. "4.05" or "1:52.30". */
  numeral: string
  /** The unit as typed, e.g. "s", "kg". Empty when none was entered. */
  unit: string
  /** Comparable value (seconds for times). Null when the text is not a number. */
  value: number | null
  isTime: boolean
  decimals: number
}

const TIME_UNITS = new Set(["s", "sec", "secs", "second", "seconds"])

export function parseMark(text: string | null | undefined): Mark {
  const raw = (text ?? "").trim()

  const clock = /^(\d+):(\d{1,2})(?:[.,](\d+))?\s*([a-zA-Z]*)$/.exec(raw)
  if (clock) {
    const fraction = clock[3] ?? ""
    const seconds = Number(clock[1]) * 60 + Number(`${clock[2]}${fraction ? `.${fraction}` : ""}`)
    return { numeral: raw.replace(/\s*[a-zA-Z]+$/, ""), unit: "", value: seconds, isTime: true, decimals: fraction.length }
  }

  const plain = /^(-?\d+(?:[.,]\d+)?)\s*(\D.*)?$/.exec(raw)
  if (plain) {
    const numeral = plain[1]
    const unit = (plain[2] ?? "").trim()
    const value = Number.parseFloat(numeral.replace(",", "."))
    const decimals = numeral.includes(".") || numeral.includes(",") ? numeral.split(/[.,]/)[1].length : 0
    return {
      numeral,
      unit,
      value: Number.isFinite(value) ? value : null,
      isTime: TIME_UNITS.has(unit.toLowerCase()),
      decimals,
    }
  }

  return { numeral: raw, unit: "", value: null, isTime: false, decimals: 0 }
}

const TIMED_CATEGORIES = new Set(["sprint", "sprints", "mid", "hurdles"])

export type MarkChange = {
  /** e.g. "0.05s faster", "5kg more". */
  text: string
  /** True when the first mark is the better one. */
  improved: boolean
  /** Absolute difference in the mark's own unit. */
  amount: number
}

/**
 * Compare two marks. Returns null when they cannot be compared honestly
 * (not numbers, different units, or no difference).
 */
export function compareMarks(current: string, reference: string | null | undefined, category?: string): MarkChange | null {
  if (!reference) return null
  const a = parseMark(current)
  const b = parseMark(reference)
  if (a.value === null || b.value === null) return null
  if (a.unit && b.unit && a.unit.toLowerCase() !== b.unit.toLowerCase()) return null
  if (a.isTime !== b.isTime && a.unit && b.unit) return null

  const unit = a.unit || b.unit
  const timed = a.isTime || b.isTime || (!unit && TIMED_CATEGORIES.has((category ?? "").toLowerCase()))
  const decimals = Math.max(a.decimals, b.decimals)
  const diff = Number((a.value - b.value).toFixed(Math.max(decimals, 3)))
  if (diff === 0) return null

  const amount = Math.abs(diff)
  const amountText = `${amount.toFixed(decimals)}${unit || (timed ? "s" : "")}`
  if (timed) {
    return { text: `${amountText} ${diff < 0 ? "faster" : "slower"}`, improved: diff < 0, amount }
  }
  return { text: `${amountText} ${diff > 0 ? "more" : "less"}`, improved: diff > 0, amount }
}

export function sameMark(a: string, b: string): boolean {
  const first = parseMark(a)
  const second = parseMark(b)
  if (first.value === null || second.value === null) return a.trim().toLowerCase() === b.trim().toLowerCase()
  if (first.unit && second.unit && first.unit.toLowerCase() !== second.unit.toLowerCase()) return false
  return first.value === second.value
}

const CATEGORY_LABELS: Record<string, string> = {
  sprint: "Sprints",
  sprints: "Sprints",
  mid: "Middle distance",
  distance: "Distance",
  jumps: "Jumps",
  jump: "Jumps",
  throws: "Throws",
  throw: "Throws",
  strength: "Strength",
  performance: "Performance",
}

const CATEGORY_ORDER = ["sprint", "sprints", "mid", "distance", "jumps", "jump", "throws", "throw", "strength", "performance"]

export function categoryLabel(category: string): string {
  const trimmed = category.trim()
  if (!trimmed) return "Other"
  return CATEGORY_LABELS[trimmed.toLowerCase()] ?? trimmed
}

export function compareCategories(a: string, b: string): number {
  const ai = CATEGORY_ORDER.indexOf(a.trim().toLowerCase())
  const bi = CATEGORY_ORDER.indexOf(b.trim().toLowerCase())
  if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  return a.localeCompare(b)
}

/** Where a record came from, in words. The schema has no venue, so this is the source. */
export function prSourceLabel(pr: Pick<PrRecord, "sourceType">): string {
  if (pr.sourceType === "test-week") return "Set in a test week"
  if (pr.sourceType === "import") return "Imported result"
  return "Added by hand"
}

/** Newest first, by local day. */
export function sortPrsNewestFirst(prs: PrRecord[]): PrRecord[] {
  return [...prs].sort((a, b) => b.measuredOn.localeCompare(a.measuredOn))
}

/**
 * Mock mode only: the test-week screen stores submitted marks per event in
 * localStorage. Apply them the way the PR screen always has.
 */
export function applyMockPrOverrides(prs: PrRecord[], overrides: Record<string, string>): PrRecord[] {
  return prs.map((pr) => {
    const overrideValue = overrides[pr.event]
    if (!overrideValue || overrideValue === pr.bestValue) return pr
    return { ...pr, previousValue: pr.bestValue, bestValue: overrideValue }
  })
}
