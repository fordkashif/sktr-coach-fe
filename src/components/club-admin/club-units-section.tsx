import { useEffect, useState } from "react"
import { Field, FormGrid, Notice, Section, Select, SkeletonRows, notify } from "@/components/sk"
import { HEIGHT_UNIT_OPTIONS, METRIC_MARKS_NOTE, WEIGHT_UNIT_OPTIONS } from "@/components/account/units-section"
import { getUnitSettings, saveClubUnitDefaults } from "@/lib/data/account/unit-preferences-data"
import { isHeightUnit, isWeightUnit, type UnitPreferences } from "@/lib/units"
import { refreshUnits } from "@/lib/units-store"

/**
 * The club's units, on the club profile screen: what members read and type in until they choose
 * their own under Your account. It changes what is shown, never what is stored. Loads and saves
 * on its own.
 */
export function ClubUnitsSection() {
  const [club, setClub] = useState<UnitPreferences | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getUnitSettings().then((result) => {
      if (cancelled) return
      if (result.ok) setClub(result.data.club)
      else setLoadError("We could not load the club's units. Reload the page to try again.")
    })
    return () => {
      cancelled = true
    }
  }, [])

  const save = async (next: UnitPreferences) => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    const result = await saveClubUnitDefaults(next)
    // The admin's own screens follow the club too, unless they chose their own units.
    if (result.ok) await refreshUnits()
    setSaving(false)
    if (!result.ok) return setSaveError(result.error.message)
    setClub(result.data)
    notify("Club units saved")
  }

  return (
    <Section title="Units" hint="What members read and type in until they choose their own under Your account. Nothing that is saved changes.">
      {loadError ? <Notice tone="error">{loadError}</Notice> : null}
      {saveError ? (
        <Notice tone="error" className="mb-3">
          {saveError}
        </Notice>
      ) : null}
      {!club && !loadError ? <SkeletonRows rows={2} label="Loading the club's units" /> : null}
      {club ? (
        <>
          <FormGrid>
            <Field label="Weights in">
              <Select
                value={club.weight}
                disabled={saving}
                onChange={(event) => {
                  if (isWeightUnit(event.target.value)) void save({ ...club, weight: event.target.value })
                }}
              >
                {WEIGHT_UNIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Body height in">
              <Select
                value={club.height}
                disabled={saving}
                onChange={(event) => {
                  if (isHeightUnit(event.target.value)) void save({ ...club, height: event.target.value })
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
          <p className="sk-list-sub mt-3">{METRIC_MARKS_NOTE}</p>
        </>
      ) : null}
    </Section>
  )
}
