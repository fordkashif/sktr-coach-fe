"use client"

import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { eventHistoryPath, UNIT_WORDS, verdictMessage } from "@/components/athlete/results-parts"
import { Button, Choices, Field, Input, InlineConfirm, LinkButton, Notice, Section, Select, Textarea } from "@/components/sk"
import {
  findResultEvent,
  formatMark,
  formatWind,
  OTHER_EVENT_KEY,
  parseMarkInput,
  parseWindInput,
  RESULT_EVENTS,
  WIND_LEGAL_LIMIT,
  type AthleteResult,
  type MarkUnit,
  type Timing,
} from "@/lib/data/pr/marks"
import { addResultForCurrentAthlete, deleteAthleteResult, localToday, updateAthleteResult, type ResultInput } from "@/lib/data/pr/results-data"

const CATEGORY_GROUPS = [...new Set(RESULT_EVENTS.filter((event) => event.kind !== "other").map((event) => event.category))]

const OTHER_UNITS: Array<{ value: MarkUnit; label: string }> = [
  { value: "s", label: "Time (seconds)" },
  { value: "m", label: "Distance (metres)" },
  { value: "cm", label: "Height (centimetres)" },
  { value: "kg", label: "Weight (kilograms)" },
  { value: "pts", label: "Points or a score" },
]

type FieldErrors = Partial<Record<"event" | "label" | "mark" | "wind" | "date", string>>

/**
 * The "Add a result" and "Edit result" form. `existing` switches it to editing (and adds delete).
 * After saving it goes to the event's history and says there what the result means
 * (personal best, season best, wind assisted).
 */
export function ResultForm({ existing, initialEventKey, cancelTo }: { existing?: AthleteResult; initialEventKey?: string; cancelTo: string }) {
  const navigate = useNavigate()
  const [eventKey, setEventKey] = useState(existing?.eventKey ?? (findResultEvent(initialEventKey) ? (initialEventKey as string) : ""))
  const [otherLabel, setOtherLabel] = useState(existing?.eventKey === OTHER_EVENT_KEY ? existing.eventLabel : "")
  const [otherUnit, setOtherUnit] = useState<MarkUnit>(existing?.eventKey === OTHER_EVENT_KEY ? existing.unit : "s")
  const [mark, setMark] = useState(existing ? formatMark(existing.value, existing.unit) : "")
  const [timing, setTiming] = useState<Timing>(existing?.timing ?? "electronic")
  const [wind, setWind] = useState(existing && existing.wind !== null ? formatWind(existing.wind) : "")
  const [date, setDate] = useState(existing?.date ?? localToday())
  const [setting, setSetting] = useState<"manual" | "training">(existing?.source === "training" ? "training" : "manual")
  const [environment, setEnvironment] = useState<"outdoor" | "indoor">(existing?.environment ?? "outdoor")
  const [place, setPlace] = useState(existing?.location ?? "")
  const [notes, setNotes] = useState(existing?.notes ?? "")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const event = findResultEvent(eventKey)
  const isOther = event?.kind === "other"
  const unit: MarkUnit | null = event ? (isOther ? otherUnit : event.unit) : null
  const words = unit ? UNIT_WORDS[unit] : null
  const windApplies = Boolean(event?.windApplies) && environment === "outdoor"
  const parsedWind = windApplies ? parseWindInput(wind) : null
  const windAssisted = Boolean(parsedWind?.ok && parsedWind.value !== null && parsedWind.value > WIND_LEGAL_LIMIT)

  const handleSubmit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault()
    setFormError(null)
    const nextErrors: FieldErrors = {}
    if (!event) nextErrors.event = "Choose an event."
    if (isOther && !otherLabel.trim()) nextErrors.label = "Name the event."
    const parsedMark = unit ? parseMarkInput(mark, unit) : null
    if (unit && parsedMark && !parsedMark.ok) nextErrors.mark = parsedMark.message
    if (parsedWind && !parsedWind.ok) nextErrors.wind = parsedWind.message
    if (!date) nextErrors.date = "Choose the date."
    else if (date > localToday()) nextErrors.date = "A result cannot be dated in the future."
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || !event || !unit || !parsedMark || !parsedMark.ok) {
      setFormError("Check the highlighted fields, then save again.")
      return
    }

    const input: ResultInput = {
      eventKey: event.key,
      eventLabel: isOther ? otherLabel : null,
      unit: isOther ? otherUnit : null,
      value: parsedMark.value,
      timing: unit === "s" ? timing : null,
      date,
      source: setting,
      wind: parsedWind && parsedWind.ok ? parsedWind.value : null,
      environment,
      location: place,
      notes,
    }

    setSaving(true)
    if (existing) {
      const result = await updateAthleteResult(existing.id, input)
      setSaving(false)
      if (!result.ok) {
        setFormError(result.error.message)
        return
      }
      navigate(eventHistoryPath(result.data.eventGroup), { replace: true, state: { saved: { tone: "info", text: "Result updated. Your bests have been worked out again." } } })
      return
    }

    const result = await addResultForCurrentAthlete(input)
    setSaving(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    navigate(eventHistoryPath(result.data.result.eventGroup), { replace: true, state: { saved: verdictMessage(result.data.result, result.data.verdict) } })
  }

  const handleDelete = async () => {
    if (!existing) return
    setDeleting(true)
    const result = await deleteAthleteResult(existing.id)
    setDeleting(false)
    if (!result.ok) {
      setConfirmDelete(false)
      setFormError(result.error.message)
      return
    }
    navigate(eventHistoryPath(existing.eventGroup), { replace: true, state: { saved: { tone: "info", text: "Result deleted. Your bests have been worked out again." } } })
  }

  return (
    <>
      <Section aria-label="Result">
        <form className="flex flex-col gap-5" onSubmit={(submitEvent) => void handleSubmit(submitEvent)} noValidate>
          <Field label="Event" error={errors.event}>
            <Select
              value={eventKey}
              onChange={(changeEvent) => {
                setEventKey(changeEvent.target.value)
                setErrors((current) => ({ ...current, event: undefined, mark: undefined }))
              }}
            >
              <option value="">Choose an event</option>
              {CATEGORY_GROUPS.map((category) => (
                <optgroup key={category} label={category}>
                  {RESULT_EVENTS.filter((item) => item.category === category).map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              ))}
              <optgroup label="Something else">
                <option value={OTHER_EVENT_KEY}>Another event or test</option>
              </optgroup>
            </Select>
          </Field>

          {isOther ? (
            <>
              <Field label="Name of the event" hint="Use the same name every time, so its results stay together." error={errors.label}>
                <Input value={otherLabel} maxLength={80} placeholder="Standing long jump" onChange={(changeEvent) => setOtherLabel(changeEvent.target.value)} />
              </Field>
              <Field label="Measured in">
                <Select value={otherUnit} onChange={(changeEvent) => setOtherUnit(changeEvent.target.value as MarkUnit)}>
                  {OTHER_UNITS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}

          <Field label={words?.field ?? "Mark"} hint={words?.hint ?? "Choose the event first."} error={errors.mark}>
            <Input
              value={mark}
              inputMode={unit === "s" ? "text" : "decimal"}
              autoComplete="off"
              placeholder={words?.placeholder ?? ""}
              disabled={!unit}
              onChange={(changeEvent) => {
                setMark(changeEvent.target.value)
                if (errors.mark) setErrors((current) => ({ ...current, mark: undefined }))
              }}
            />
          </Field>

          {unit === "s" ? (
            <Choices
              label="How was it timed"
              hint={event && event.handAdjust > 0 ? `A hand time is ranked with ${event.handAdjust.toFixed(2)}s added, the usual conversion.` : undefined}
              value={timing}
              onChange={setTiming}
              options={[
                { value: "electronic", label: "Electronic" },
                { value: "hand", label: "Hand (stopwatch)" },
              ]}
            />
          ) : null}

          <Choices
            label="Where was it"
            value={environment}
            onChange={setEnvironment}
            options={[
              { value: "outdoor", label: "Outdoors" },
              { value: "indoor", label: "Indoors" },
            ]}
          />

          {windApplies ? (
            <Field
              label="Wind"
              optional
              error={errors.wind}
              hint={
                windAssisted
                  ? "Over +2.0 is wind assisted. It is kept in your history but does not count as a best."
                  : "Metres per second with its sign, like +1.2 or -0.4. Leave it empty if there was no reading."
              }
            >
              <Input
                value={wind}
                inputMode="text"
                autoComplete="off"
                placeholder="+1.2"
                onChange={(changeEvent) => {
                  setWind(changeEvent.target.value)
                  if (errors.wind) setErrors((current) => ({ ...current, wind: undefined }))
                }}
              />
            </Field>
          ) : null}

          <Field label="Date" error={errors.date}>
            <Input type="date" value={date} max={localToday()} onChange={(changeEvent) => setDate(changeEvent.target.value)} />
          </Field>

          <Choices
            label="Set in"
            value={setting}
            onChange={setSetting}
            options={[
              { value: "manual", label: "A competition" },
              { value: "training", label: "Training" },
            ]}
          />

          <Field label={setting === "manual" ? "Meet or place" : "Place"} optional>
            <Input value={place} maxLength={160} placeholder={setting === "manual" ? "County Championships" : "Home track"} onChange={(changeEvent) => setPlace(changeEvent.target.value)} />
          </Field>

          <Field label="Note" optional>
            <Textarea value={notes} maxLength={1000} onChange={(changeEvent) => setNotes(changeEvent.target.value)} />
          </Field>

          {formError ? <Notice tone="error">{formError}</Notice> : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving..." : existing ? "Save changes" : "Save result"}
            </Button>
            <LinkButton to={cancelTo} variant="quiet">
              Cancel
            </LinkButton>
          </div>
        </form>
      </Section>

      {existing ? (
        <Section title="Delete this result" hint="It is removed from your history and your bests are worked out again.">
          {confirmDelete ? (
            <InlineConfirm
              question="Delete this result for good?"
              confirmLabel="Delete result"
              busy={deleting}
              onConfirm={() => void handleDelete()}
              onCancel={() => setConfirmDelete(false)}
            />
          ) : (
            <Button variant="danger" className="mt-2 self-start" onClick={() => setConfirmDelete(true)}>
              Delete result
            </Button>
          )}
        </Section>
      ) : null}
    </>
  )
}
