import { formatMark, parseMarkInput, type MarkUnit, type ParsedMark, type Timing } from "@/lib/data/pr/marks"
import { checkTestResultEntry, entryTextFor, type CheckedEntry } from "@/lib/data/test-week/result-entry"
import type { TestDefinitionUnit } from "@/lib/data/test-week/types"
import { localizeLoadText, localizeTargetText, markForViewer, weightInputText, weightTextToMetric, weightUnitWord, type WeightUnit } from "@/lib/units"
import { viewerUnits } from "@/lib/units-store"

/**
 * Units at the edge for code that is not a component: the small text helpers of the result, test
 * week and goal screens. Each one reads the signed-in person's units (units-store.ts) and converts
 * what is shown or typed. Stored values stay metric. On kilograms every helper here is a no-op.
 *
 * Only results measured in kilograms (strength tests, best lifts) are touched. Times, distances
 * and heights of track and field are metric by rule.
 */

function weight(): WeightUnit {
  return viewerUnits().weight
}

/** A line naming kilogram amounts ("185kg", "5 x 100 kg"), in the reader's unit. */
export function viewText<T extends string | null | undefined>(text: T): T {
  return localizeLoadText(text, weight()) as T
}

/** A prescription in words ("3 x 5 at 100"), in the reader's unit. */
export function viewTarget<T extends string | null | undefined>(text: T): T {
  return localizeTargetText(text, weight()) as T
}

/** A written mark and its unit for the reader: ("185", "kg") reads ("408", "lb") on pounds. */
export function viewMark(display: string, unit: string): { value: string; unit: string } {
  return markForViewer(display, unit, weight())
}

/** "kg" or "lb" for a result unit of "kg"; any other unit as it is. */
export function viewUnitLabel(unit: string): string {
  return unit === "kg" ? weight() : unit
}

/** "kilograms" or "pounds". */
export function viewWeightWord(): string {
  return weightUnitWord(weight())
}

/** The text to start an input with for a saved mark: pounds for a kilogram mark when the reader is on pounds. */
export function markEntryText(value: number, unit: MarkUnit, timing: Timing | null = null): string {
  return unit === "kg" ? weightInputText(value, weight()) : formatMark(value, unit, timing)
}

/** parseMarkInput for what the person typed in their own unit. The value that comes back is metric. */
export function parseMarkForViewer(text: string, unit: MarkUnit): ParsedMark {
  if (unit !== "kg" || weight() !== "lb") return parseMarkInput(text, unit)
  const parsed = parseMarkInput(weightTextToMetric(text, "lb"), "kg")
  return parsed.ok ? parsed : { ok: false, message: parsed.message.replace("in kilograms, like 182.5", "in pounds, like 402.5") }
}

/** What the result forms say about a field, by unit. */
export function unitWordsForViewer<T extends { field: string; hint: string; placeholder: string }>(words: Record<MarkUnit, T>, unit: MarkUnit): T {
  if (unit !== "kg" || weight() !== "lb") return words[unit]
  return { ...words.kg, field: "Weight (pounds)", hint: "In pounds, like 402.5.", placeholder: "402.5" }
}

/** A weight typed in the person's own unit, as the kilogram text the metric checks expect. */
export function weightEntryToMetric(text: string): string {
  return weight() === "lb" ? weightTextToMetric(text.trim().toLowerCase().replace(",", "."), "lb") : text
}

/** checkTestResultEntry for what was typed in the person's own unit. What is stored is metric ("183.7kg"). */
export function checkTestEntryForViewer(raw: string, unit: TestDefinitionUnit): CheckedEntry {
  if (unit !== "weight" || weight() !== "lb") return checkTestResultEntry(raw, unit)
  const checked = checkTestResultEntry(weightTextToMetric(raw.trim().toLowerCase().replace(",", "."), "lb"), "weight")
  return checked.ok ? checked : { ok: false, message: checked.message.replace("in kilograms", "in pounds") }
}

/** entryTextFor in the person's own unit. */
export function testEntryTextForViewer(saved: { value: string; numeric: number | null } | null | undefined, unit: TestDefinitionUnit): string {
  const text = entryTextFor(saved)
  if (unit !== "weight" || weight() !== "lb" || !text) return text
  return weightInputText(Number.parseFloat(text), "lb")
}

/** "kilograms" or "pounds" for a weight test; the given word for any other test. */
export function testUnitWordForViewer(unit: TestDefinitionUnit, word: string): string {
  return unit === "weight" ? viewWeightWord() : word
}
