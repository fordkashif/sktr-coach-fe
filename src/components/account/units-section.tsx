import { useState } from "react"
import { Field, FormGrid, Notice, Section, Select, SkeletonRows, notify } from "@/components/sk"
import { saveOwnUnits } from "@/lib/data/account/unit-preferences-data"
import { isHeightUnit, isWeightUnit, type HeightUnit, type WeightUnit } from "@/lib/units"
import { refreshUnits, useUnitSettings } from "@/lib/units-store"

export const WEIGHT_UNIT_OPTIONS: Array<{ value: WeightUnit; label: string }> = [
  { value: "kg", label: "Kilograms (kg)" },
  { value: "lb", label: "Pounds (lb)" },
]

export const HEIGHT_UNIT_OPTIONS: Array<{ value: HeightUnit; label: string }> = [
  { value: "cm", label: "Centimetres (cm)" },
  { value: "ft_in", label: "Feet and inches (ft, in)" },
]

/** One quiet line, shown wherever units are chosen. */
export const METRIC_MARKS_NOTE = "Throws, jumps and times always stay in metres and seconds, as the rules of the sport write them."

/**
 * Your account: the units this person reads and types in. Saved to the account, so it follows them
 * to every device. It changes what is shown, never what is stored.
 */
export function UnitsSection() {
  const { settings, loaded } = useUnitSettings()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (next: { weight?: WeightUnit; height?: HeightUnit }) => {
    if (!settings || saving) return
    setSaving(true)
    setError(null)
    // Choosing one unit fixes both as they are now, so a later change of the club default does not move them.
    const result = await saveOwnUnits({ weight: next.weight ?? settings.effective.weight, height: next.height ?? settings.effective.height })
    if (result.ok) await refreshUnits()
    setSaving(false)
    if (!result.ok) return setError(`Could not save your units. ${result.error.message}`)
    notify("Units saved")
  }

  const chosen = settings ? settings.own.weight !== null || settings.own.height !== null : false

  return (
    <Section title="Units" hint="How weights and body height are shown to you, on every device. Nothing that is saved changes.">
      {error ? (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      ) : null}
      {!settings ? (
        loaded ? (
          <Notice tone="error">We could not load your units. Reload the page to try again.</Notice>
        ) : (
          <SkeletonRows rows={2} label="Loading your units" />
        )
      ) : (
        <>
          <FormGrid>
            <Field label="Weights in" hint="Loads in sessions and plans, best lifts, strength tests and body weight.">
              <Select
                value={settings.effective.weight}
                disabled={saving}
                onChange={(event) => {
                  if (isWeightUnit(event.target.value)) void save({ weight: event.target.value })
                }}
              >
                {WEIGHT_UNIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Body height in" hint="Height on an athlete's profile.">
              <Select
                value={settings.effective.height}
                disabled={saving}
                onChange={(event) => {
                  if (isHeightUnit(event.target.value)) void save({ height: event.target.value })
                }}
              >
                {HEIGHT_UNIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <p className="sk-list-sub mt-3" data-units-note>
            {chosen ? "" : "These are your club's units. Change them here and they stay yours. "}
            {METRIC_MARKS_NOTE}
          </p>
        </>
      )}
    </Section>
  )
}
