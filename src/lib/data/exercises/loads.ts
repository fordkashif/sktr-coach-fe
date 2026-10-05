/**
 * Loads written as a percentage of a best lift (1RM), and per athlete changes to a plan row.
 * Pure, with no imports, so the plan builder, the mock athlete screens, the publish step and the
 * unit tests all use exactly the same rules. The database repeats the same rules in
 * resolve_session_row_load() (migration 20261011090000); keep the two in step.
 */

/** Resolved loads are rounded to the nearest plate change a gym can make. */
export const LOAD_STEP_KG = 2.5

/**
 * How lift names are matched: "Back Squat", "back squat 1RM" and " Back  squat (1 rep max)" are
 * the same lift. Lower case, no punctuation, no "1RM" or "max" wording, single spaces.
 */
export function liftKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\b(1\s*rm|one\s*rep\s*max|1\s*rep\s*max|rep\s*max|max)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

/** "80%", "80 %", "@ 82.5%" and "80% 1RM" are percentages. "80", "80kg" and "BW" are not. */
export function parsePercent(load: string | null | undefined): number | null {
  const match = /^\s*@?\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*%/.exec(load ?? "")
  if (!match) return null
  const value = Number.parseFloat(match[1].replace(",", "."))
  return Number.isFinite(value) && value > 0 && value <= 200 ? value : null
}

export function roundToStep(valueKg: number, stepKg: number = LOAD_STEP_KG): number {
  if (!Number.isFinite(valueKg) || stepKg <= 0) return valueKg
  // The small nudge keeps exact halves (121.25) rounding up whatever the floating point noise.
  return Math.round(valueKg / stepKg + 1e-9) * stepKg
}

/** The load in kg for a percentage of a best lift, or null when there is no usable best. */
export function percentOfMaxKg(percent: number | null, maxKg: number | null | undefined): number | null {
  if (percent === null || maxKg === null || maxKg === undefined) return null
  if (!Number.isFinite(maxKg) || maxKg <= 0) return null
  return roundToStep((maxKg * percent) / 100)
}

function trimNumber(value: number) {
  return String(Math.round(value * 100) / 100)
}

export function formatKg(valueKg: number) {
  return `${trimNumber(valueKg)} kg`
}

export function formatPercent(percent: number) {
  return `${trimNumber(percent)}%`
}

/** "80%, 120 kg" when the best lift is known, otherwise "80%". */
export function describePercentLoad(percent: number, maxKg: number | null | undefined) {
  const kg = percentOfMaxKg(percent, maxKg)
  return kg === null ? formatPercent(percent) : `${formatPercent(percent)}, ${formatKg(kg)}`
}

/** The short hint an athlete sees when a percentage cannot be turned into a weight yet. */
export function missingMaxHint(liftName: string | null | undefined) {
  const lift = (liftName ?? "").trim()
  return lift ? `No best ${lift} saved yet, so there is no weight to show. Ask your coach to add it.` : "No best lift saved yet, so there is no weight to show."
}

export type ResolvedLoad = {
  /** What the athlete reads: "4 x 4 at 80%, 120 kg". */
  target: string
  /** What "same as target" fills in: "120 kg", or the bare percentage when no best is known. */
  targetLoad: string
  /** Set when the weight could not be worked out. */
  hint: string | null
  loadKg: number | null
}

/** Builds the athlete-facing target of a percentage row. `volume` is the "4 x 4" part and may be empty. */
export function resolvePercentTarget(input: { volume: string | null | undefined; percent: number; maxKg: number | null | undefined; liftName: string | null | undefined }): ResolvedLoad {
  const kg = percentOfMaxKg(input.percent, input.maxKg)
  const load = describePercentLoad(input.percent, input.maxKg)
  const volume = (input.volume ?? "").trim()
  return {
    target: volume ? `${volume} at ${load}` : load,
    targetLoad: kg === null ? formatPercent(input.percent) : formatKg(kg),
    hint: kg === null ? missingMaxHint(input.liftName) : null,
    loadKg: kg,
  }
}

export type RowPrescription = { sets: string; reps: string; load: string }
export type RowOverride = RowPrescription & { athleteId: string; note: string }

/** An override only replaces what the coach filled in. Empty fields keep the row's own value. */
export function mergeOverride<T extends RowPrescription>(base: T, override: Partial<RowPrescription> | null | undefined): T {
  if (!override) return base
  return {
    ...base,
    sets: override.sets?.trim() ? override.sets.trim() : base.sets,
    reps: override.reps?.trim() ? override.reps.trim() : base.reps,
    load: override.load?.trim() ? override.load.trim() : base.load,
  }
}

export function overrideFor<T extends { athleteId: string }>(overrides: T[] | null | undefined, athleteId: string): T | null {
  return (overrides ?? []).find((override) => override.athleteId === athleteId) ?? null
}

/** True when an override changes nothing and says nothing, so it can be dropped. */
export function isEmptyOverride(override: Partial<RowOverride>) {
  return !override.sets?.trim() && !override.reps?.trim() && !override.load?.trim() && !override.note?.trim()
}

/** "70%", "5 reps, 70%" or "Goblet squat instead": an override in a few words for the builder and the print view. */
export function summarizeOverride(override: Partial<RowOverride>) {
  const sets = override.sets?.trim()
  const reps = override.reps?.trim()
  const volume = sets && reps ? `${sets} x ${reps}` : reps ? `${reps} reps` : sets ? `${sets} sets` : ""
  return [volume, override.load?.trim(), override.note?.trim()].filter(Boolean).join(", ")
}

/** Only http and https links are kept. Returns the cleaned link, or null when it is not one. */
export function cleanReferenceUrl(value: string | null | undefined): string | null {
  const text = (value ?? "").trim()
  if (!text || text.length > 500 || /\s/.test(text)) return null
  if (!/^https?:\/\/[^/?#]+\.[^/?#]+/i.test(text)) return null
  try {
    const url = new URL(text)
    return url.protocol === "http:" || url.protocol === "https:" ? text : null
  } catch {
    return null
  }
}
