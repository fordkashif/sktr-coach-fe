/**
 * Units of measure: kilograms or pounds for loads and body weight, centimetres or feet and inches
 * for body height.
 *
 * Everything is STORED metric (kilograms, centimetres). This module converts only at the edge:
 * what a person reads and what a person types. It is pure, with no imports, so the screens, the
 * mock stores and the unit tests share exactly the same rules.
 *
 * Track and field marks (throws and jumps in metres, times) are metric by rule and never pass
 * through here.
 *
 * Rounding rules:
 * - A load shown in pounds is rounded to the nearest 0.5 lb. Kilograms are shown as stored.
 * - A load typed in pounds is stored in kilograms to two decimals (0.01 kg is 0.02 lb), so it reads
 *   back as the same pounds the person typed (to the 0.5 lb that is shown).
 * - A load worked out from a percentage of a best lift is rounded to the nearest 2.5 kg for a
 *   person on kilograms and to the nearest 5 lb for a person on pounds.
 * - Body weight is stored to 0.1 kg and shown to the nearest 0.5 lb. Body height is stored to
 *   0.1 cm and shown to the nearest half inch.
 */

export type WeightUnit = "kg" | "lb"
export type HeightUnit = "cm" | "ft_in"
export type UnitPreferences = { weight: WeightUnit; height: HeightUnit }

export const DEFAULT_UNITS: UnitPreferences = { weight: "kg", height: "cm" }

/** Exact by definition (the international avoirdupois pound). */
export const KG_PER_LB = 0.45359237
/** Exact by definition (the international inch). */
export const CM_PER_INCH = 2.54

export const LB_DISPLAY_STEP = 0.5
export const PERCENT_STEP_KG = 2.5
export const PERCENT_STEP_LB = 5

export function isWeightUnit(value: unknown): value is WeightUnit {
  return value === "kg" || value === "lb"
}

export function isHeightUnit(value: unknown): value is HeightUnit {
  return value === "cm" || value === "ft_in"
}

export function weightUnitWord(unit: WeightUnit) {
  return unit === "lb" ? "pounds" : "kilograms"
}

export function heightUnitWord(unit: HeightUnit) {
  return unit === "ft_in" ? "feet and inches" : "centimetres"
}

/* ---------- Numbers ----------------------------------------------------------------------- */

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

/** Nearest multiple of `step`. Exact halves round up whatever the floating point noise. */
export function roundToStep(value: number, step: number) {
  if (!Number.isFinite(value) || step <= 0) return value
  return roundTo(Math.round(value / step + 1e-9) * step, 4)
}

export function kgToLb(kg: number) {
  return kg / KG_PER_LB
}

export function lbToKg(lb: number) {
  return lb * KG_PER_LB
}

/** "120", "122.5", "102.06": at most two decimals, no trailing zeros. */
export function trimNumber(value: number) {
  return String(roundTo(value, 2))
}

function readNumber(text: string): number | null {
  const cleaned = text.trim().replace(",", ".")
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Number.parseFloat(cleaned)
  return Number.isFinite(value) ? value : null
}

/* ---------- Loads ------------------------------------------------------------------------- */

/** The number a person reads for a stored load: kilograms as stored, pounds to the nearest 0.5. */
export function loadForViewer(kg: number, unit: WeightUnit): number {
  return unit === "lb" ? roundToStep(kgToLb(kg), LB_DISPLAY_STEP) : roundTo(kg, 2)
}

/** The kilograms to store for a number a person typed in their own unit. */
export function loadToKg(value: number, unit: WeightUnit): number {
  return unit === "lb" ? roundTo(lbToKg(value), 2) : value
}

/** "120 kg" or "264.5 lb". */
export function formatLoad(kg: number, unit: WeightUnit) {
  return `${trimNumber(loadForViewer(kg, unit))} ${unit}`
}

/**
 * The load of a percentage of a best lift, in kilograms, for a person on the given unit:
 * nearest 2.5 kg, or nearest 5 lb (kept in kilograms so it can be stored and logged).
 * Null when there is no usable best.
 */
export function percentLoadKg(percent: number | null | undefined, maxKg: number | null | undefined, unit: WeightUnit): number | null {
  if (percent === null || percent === undefined || maxKg === null || maxKg === undefined) return null
  if (!Number.isFinite(percent) || !Number.isFinite(maxKg) || maxKg <= 0 || percent <= 0) return null
  if (unit === "lb") return roundTo(lbToKg(roundToStep((kgToLb(maxKg) * percent) / 100, PERCENT_STEP_LB)), 2)
  return roundToStep((maxKg * percent) / 100, PERCENT_STEP_KG)
}

/** "80%, 120 kg" or "80%, 265 lb". The bare percentage when there is no usable best. */
export function describePercentLoadFor(percent: number, maxKg: number | null | undefined, unit: WeightUnit) {
  const kg = percentLoadKg(percent, maxKg, unit)
  return kg === null ? `${trimNumber(percent)}%` : `${trimNumber(percent)}%, ${formatLoad(kg, unit)}`
}

/* ---------- Loads inside text ------------------------------------------------------------- */

const KG_IN_TEXT = /(\d+(?:[.,]\d+)?)(\s*)(?:kgs?|kilos?|kilograms?)\b/gi
const PERCENT_KG_IN_TEXT = /(%,\s*)(\d+(?:[.,]\d+)?)(\s*)kg\b/gi

function number(text: string) {
  return Number.parseFloat(text.replace(",", "."))
}

/**
 * A line that names loads in kilograms ("5 x 100 kg", "3 x 5 at 120kg", "4 x 4 at 80%, 120 kg"),
 * rewritten for the person reading it. Kilograms: unchanged. Pounds: every kilogram amount becomes
 * pounds (nearest 0.5; nearest 5 after a percentage). Times and distances are left alone.
 */
export function localizeLoadText(text: string, unit: WeightUnit): string
export function localizeLoadText(text: string | null | undefined, unit: WeightUnit): string | null
export function localizeLoadText(text: string | null | undefined, unit: WeightUnit): string | null {
  if (text === null || text === undefined) return null
  if (unit !== "lb" || !/k/i.test(text)) return text
  return text
    .replace(PERCENT_KG_IN_TEXT, (_match, lead: string, amount: string, space: string) => `${lead}${trimNumber(roundToStep(kgToLb(number(amount)), PERCENT_STEP_LB))}${space}lb`)
    .replace(KG_IN_TEXT, (_match, amount: string, space: string) => `${trimNumber(loadForViewer(number(amount), "lb"))}${space}lb`)
}

const BARE_LOAD_IN_TEXT = /((?:\bat|@)\s)(\d+(?:[.,]\d+)?)(?=\s*(?:$|[,;)]))/g

/**
 * A prescription in words ("3 x 5 at 100", "Back squat 4 x 4 @ 100kg, Bench 3 x 5 @ 60") for the
 * person reading it. As localizeLoadText, and a load written without a unit after "at" or "@" is
 * kilograms too (the plan builder's own rule: a bare number in the load box is a weight).
 */
export function localizeTargetText(text: string, unit: WeightUnit): string
export function localizeTargetText(text: string | null | undefined, unit: WeightUnit): string | null
export function localizeTargetText(text: string | null | undefined, unit: WeightUnit): string | null {
  if (text === null || text === undefined) return null
  if (unit !== "lb") return text
  return localizeLoadText(text, "lb").replace(BARE_LOAD_IN_TEXT, (_match, lead: string, amount: string) => `${lead}${trimNumber(loadForViewer(number(amount), "lb"))} lb`)
}

/**
 * What a coach reads in a plan's load box. The box is free text ("100", "100 kg", "80%", "BW",
 * "7.2 s"): a bare number or a kilogram amount is a load and is shown in the coach's unit,
 * anything else is shown as written.
 */
export function loadFieldForViewer(stored: string, unit: WeightUnit): string {
  if (unit !== "lb") return stored
  const bare = readNumber(stored)
  if (bare !== null) return `${trimNumber(loadForViewer(bare, "lb"))} lb`
  return localizeLoadText(stored, "lb")
}

/**
 * What is stored for a plan's load box typed in the coach's unit. On pounds, a bare number or a
 * pound amount ("225", "225 lb") is stored as kilograms ("102.06 kg"). Everything else (a
 * percentage, "BW", a time, an amount already written in kg) is stored as typed.
 */
export function loadFieldToStored(typed: string, unit: WeightUnit): string {
  if (unit !== "lb") return typed
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(?:lbs?|pounds?)?\s*$/i.exec(typed)
  if (!match) return typed
  return `${trimNumber(loadToKg(number(match[1]), "lb"))} kg`
}

export type RowLoadText = { target: string; targetLoad: string | null }

/**
 * One exercise row for the person reading it. `target` is the line they read, in their unit.
 * `targetLoad` stays metric, because it is what "same as target" stores: unchanged for a plain
 * weight (120 kg stays exactly 120 kg, read as 264.5 lb), and for a percentage on pounds the
 * kilograms of the 5 lb step that is shown.
 * `percent` and `maxKg`, when both are known, let a percentage load be worked out again in the
 * reader's own unit (nearest 5 lb) instead of converting the rounded kilograms.
 */
export function rowLoadForViewer(
  row: { target: string; targetLoad: string | null; percent?: number | null },
  unit: WeightUnit,
  maxKg?: number | null,
): RowLoadText {
  if (unit !== "lb") return { target: row.target, targetLoad: row.targetLoad }
  const resolved = /(%,\s*)(\d+(?:[.,]\d+)?)\s*kg\b/i.exec(row.target)
  if (resolved) {
    // From the best lift when it is known, otherwise from the kilograms the row already carries.
    const kg = percentLoadKg(row.percent, maxKg, "lb") ?? roundTo(lbToKg(roundToStep(kgToLb(number(resolved[2])), PERCENT_STEP_LB)), 2)
    return { target: row.target.replace(resolved[0], `${resolved[1]}${formatLoad(kg, "lb")}`), targetLoad: `${trimNumber(kg)} kg` }
  }
  const written = row.targetLoad?.trim() ?? null
  let target = row.target
  // "3 x 5 at 100": a load written without a unit is kilograms.
  if (written !== null && readNumber(written) !== null && target.endsWith(`at ${written}`)) {
    target = `${target.slice(0, target.length - written.length)}${loadFieldForViewer(written, "lb")}`
  }
  return { target: localizeLoadText(target, "lb"), targetLoad: row.targetLoad }
}

/* ---------- Results measured in kilograms (strength tests, best lifts) ---------------------- */

/** A written kilogram mark ("185") and its unit for the person reading it: "408" and "lb". Other units pass through. */
export function markForViewer(display: string, unit: string, weightUnit: WeightUnit): { value: string; unit: string } {
  if (weightUnit !== "lb" || unit.trim() !== "kg") return { value: display, unit }
  const value = readNumber(display)
  if (value === null) return { value: display, unit }
  return { value: trimNumber(loadForViewer(value, "lb")), unit: unit.replace("kg", "lb") }
}

/** The text to put in an input for a stored kilogram value, in the person's unit. */
export function weightInputText(kg: number, unit: WeightUnit) {
  return trimNumber(loadForViewer(kg, unit))
}

/**
 * What a person typed for a weight in their own unit, as kilograms. Their own unit typed after the
 * number ("225 lb" on pounds, "100kg" on kilograms) is allowed. Null when it is not a number.
 */
export function parseWeightInput(text: string, unit: WeightUnit): number | null {
  const value = readNumber(text.trim().replace(unit === "lb" ? /\s*lbs?$/i : /\s*kgs?$/i, ""))
  return value === null ? null : loadToKg(value, unit)
}

/**
 * Turns typed pounds into the kilogram text the metric checks expect ("225" becomes "102.06").
 * Kilograms, and anything that is not a plain number, pass through for those checks to judge.
 */
export function weightTextToMetric(text: string, unit: WeightUnit): string {
  if (unit !== "lb") return text
  const value = readNumber(text.trim().replace(/\s*lbs?$/i, ""))
  return value === null ? text : trimNumber(loadToKg(value, "lb"))
}

/* ---------- Body height and weight ------------------------------------------------------------ */

/** Feet and inches for a height in centimetres, inches to the nearest half. */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const total = roundToStep(cm / CM_PER_INCH, 0.5)
  const feet = Math.floor(total / 12)
  return { feet, inches: roundTo(total - feet * 12, 1) }
}

/** Centimetres (to 0.1) for a height in feet and inches. */
export function feetInchesToCm(feet: number, inches: number): number {
  return roundTo((feet * 12 + inches) * CM_PER_INCH, 1)
}

/** "180 cm" or "5 ft 11 in". */
export function formatHeight(cm: number, unit: HeightUnit) {
  if (unit !== "ft_in") return `${trimNumber(cm)} cm`
  const { feet, inches } = cmToFeetInches(cm)
  return `${feet} ft ${trimNumber(inches)} in`
}

/** Body weight a person reads: kilograms as stored, pounds to the nearest 0.5. */
export function bodyWeightForViewer(kg: number, unit: WeightUnit) {
  return loadForViewer(kg, unit)
}

/** Kilograms (to 0.1, as the profile stores it) for a body weight typed in the person's unit. */
export function bodyWeightToKg(value: number, unit: WeightUnit) {
  return unit === "lb" ? roundTo(lbToKg(value), 1) : value
}

export function formatBodyWeight(kg: number, unit: WeightUnit) {
  return formatLoad(kg, unit)
}
