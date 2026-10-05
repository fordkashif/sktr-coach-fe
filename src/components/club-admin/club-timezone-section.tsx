import { useEffect, useMemo, useState, type FormEvent } from "react"
import { PencilSimple } from "@phosphor-icons/react"
import { Button, Fact, FactList, Field, FormActions, Notice, Section, Select, SkeletonRows, notify } from "@/components/sk"
import { localClockIn, timezoneLabel, timezoneOffsetLabel, timezoneOptions } from "@/lib/club-timezone"
import { getClubTimezone, saveClubTimezone } from "@/lib/data/club-admin/club-timezone-data"

/**
 * The club's time zone, on the club profile screen. Reminders (session today, check-in, test week
 * closing) go out at local time in this zone. Loads and saves on its own.
 */
export function ClubTimezoneSection() {
  const [timezone, setTimezone] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getClubTimezone().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setTimezone(result.data)
        setLoadError(null)
      } else {
        setLoadError("We could not load the club's time zone. Reload the page to try again.")
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const options = useMemo(() => timezoneOptions(timezone), [timezone])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setSaveError(null)
    const result = await saveClubTimezone(draft)
    setSaving(false)
    if (!result.ok) {
      setSaveError(result.error.message)
      return
    }
    setTimezone(result.data)
    setEditing(false)
    notify("Time zone saved")
  }

  return (
    <Section
      title="Time zone"
      hint="Reminders go out at local time in this time zone."
      action={
        timezone && !editing ? (
          <Button
            variant="quiet"
            size="sm"
            className="-my-2"
            aria-label="Edit time zone"
            onClick={() => {
              setDraft(timezone)
              setSaveError(null)
              setEditing(true)
            }}
          >
            <PencilSimple className="size-4" weight="bold" aria-hidden />
            Edit
          </Button>
        ) : null
      }
    >
      {loadError ? <Notice tone="error">{loadError}</Notice> : null}
      {!timezone && !loadError ? <SkeletonRows rows={2} label="Loading the time zone" /> : null}
      {timezone && editing ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)} noValidate>
          <Field label="Time zone" hint={draft ? `It is ${localClockIn(draft)} there now (${timezoneOffsetLabel(draft)}).` : undefined}>
            <Select value={draft} onChange={(event) => setDraft(event.target.value)}>
              <optgroup label="Common">
                {options.common.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
              {options.others.length > 0 ? (
                <optgroup label="All time zones">
                  {options.others.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </Field>
          {saveError ? <Notice tone="error">{saveError}</Notice> : null}
          <FormActions>
            <Button variant="quiet" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving..." : "Save time zone"}
            </Button>
          </FormActions>
        </form>
      ) : null}
      {timezone && !editing ? (
        <FactList aria-label="Time zone">
          <Fact label="Time zone">{timezoneLabel(timezone)}</Fact>
          <Fact label="Time there now">{`${localClockIn(timezone)} (${timezoneOffsetLabel(timezone)})`}</Fact>
        </FactList>
      ) : null}
    </Section>
  )
}
