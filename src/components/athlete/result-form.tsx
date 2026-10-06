"use client"

import { useState, type FormEvent } from "react"
import { Plus } from "@phosphor-icons/react"
import { useNavigate } from "react-router-dom"
import {
  detailDraftFrom,
  HeightsEditor,
  ReactionField,
  readDetailDraft,
  RoundFields,
  SeriesEditor,
  SplitsEditor,
  type DetailDraft,
  type DetailErrors,
} from "@/components/athlete/result-detail"
import { eventHistoryPath, UNIT_WORDS, verdictMessage } from "@/components/athlete/results-parts"
import { Button, Choices, Field, Input, InlineConfirm, LinkButton, Notice, Section, Select, Textarea } from "@/components/sk"
import {
  describeDifference,
  detailKindsFor,
  findResultEvent,
  formatMarkWithUnit,
  formatWind,
  OTHER_EVENT_KEY,
  parseMarkInput,
  parseWindInput,
  RESULT_EVENTS,
  WIND_LEGAL_LIMIT,
  type AthleteResult,
  type MarkUnit,
  type NewResultVerdict,
  type Timing,
} from "@/lib/data/pr/marks"
import { addAthleteResult, addResultForCurrentAthlete, deleteAthleteResult, localToday, updateAthleteResult, type ResultInput } from "@/lib/data/pr/results-data"
import { markEntryText, parseMarkForViewer, unitWordsForViewer, viewText, viewWeightWord } from "@/lib/units-view"

/** A coach or club admin entering a result for one of their athletes. Where to go back to afterwards is theirs to say. */
export type ResultFormAthlete = { id: string; name: string; returnTo: string }

/** What to tell a coach after saving a result for an athlete. */
function staffVerdictMessage(name: string, saved: AthleteResult, verdict: NewResultVerdict & { legal?: AthleteResult }): { tone: "success" | "warning" | "info"; text: string } {
  // Kilogram marks in the sentence are read in the coach's own unit.
  const message = metricStaffVerdictMessage(name, saved, verdict)
  return { ...message, text: viewText(message.text) }
}

function metricStaffVerdictMessage(name: string, saved: AthleteResult, verdict: NewResultVerdict & { legal?: AthleteResult }): { tone: "success" | "warning" | "info"; text: string } {
  // A wind assisted series whose best legal jump is a best: the news is about that jump.
  const result = verdict.legal ?? saved
  const first = name.split(" ")[0] || name
  const mark = formatMarkWithUnit(result.display, result.unit)
  if (verdict.kind === "wind-assisted") return { tone: "warning", text: `Saved as wind assisted. ${mark} is in ${first}'s ${result.eventLabel} history, but a wind over +2.0 does not count as a best.` }
  if (verdict.kind === "personal-best" || verdict.kind === "season-best") {
    const gain = verdict.beat ? describeDifference(result, verdict.beat) : null
    const kind = verdict.kind === "personal-best" ? "personal best" : "season best"
    return {
      tone: "success",
      text: `Saved. ${mark} is a new ${kind} for ${first} in the ${result.eventLabel}${gain && verdict.beat ? `, ${gain.text} than ${formatMarkWithUnit(verdict.beat.display, verdict.beat.unit)}` : ""}.`,
    }
  }
  if (verdict.kind === "first") return { tone: "success", text: `Saved. ${mark} is ${first}'s first ${result.eventLabel} result, so it is their personal best.` }
  return { tone: "info", text: `Saved. ${mark} is in ${first}'s ${result.eventLabel} history.` }
}

const CATEGORY_GROUPS = [...new Set(RESULT_EVENTS.filter((event) => event.kind !== "other").map((event) => event.category))]

const OTHER_UNITS: Array<{ value: MarkUnit; label: string }> = [
  { value: "s", label: "Time (seconds)" },
  { value: "m", label: "Distance (metres)" },
  { value: "cm", label: "Height (centimetres)" },
  { value: "kg", label: "Weight (kilograms)" },
  { value: "pts", label: "Points or a score" },
]

type FieldErrors = Partial<Record<"event" | "label" | "mark" | "wind" | "date", string>> & DetailErrors

/**
 * The "Add a result" and "Edit result" form. `existing` switches it to editing (and adds delete).
 * After saving it goes to the event's history and says there what the result means
 * (personal best, season best, wind assisted).
 * With `forAthlete` the same form is used by a coach or club admin for one of their athletes:
 * the result is saved on that athlete and the form goes back to `forAthlete.returnTo`.
 */
export function ResultForm({
  existing,
  initialEventKey,
  cancelTo,
  forAthlete,
}: {
  existing?: AthleteResult
  initialEventKey?: string
  cancelTo: string
  forAthlete?: ResultFormAthlete
}) {
  const navigate = useNavigate()
  const [eventKey, setEventKey] = useState(existing?.eventKey ?? (findResultEvent(initialEventKey) ? (initialEventKey as string) : ""))
  const [otherLabel, setOtherLabel] = useState(existing?.eventKey === OTHER_EVENT_KEY ? existing.eventLabel : "")
  const [otherUnit, setOtherUnit] = useState<MarkUnit>(existing?.eventKey === OTHER_EVENT_KEY ? existing.unit : "s")
  const [mark, setMark] = useState(existing ? markEntryText(existing.value, existing.unit) : "")
  const [timing, setTiming] = useState<Timing>(existing?.timing ?? "electronic")
  const [wind, setWind] = useState(existing && existing.wind !== null ? formatWind(existing.wind) : "")
  const [date, setDate] = useState(existing?.date ?? localToday())
  const [setting, setSetting] = useState<"manual" | "training">(existing?.source === "training" ? "training" : "manual")
  const [environment, setEnvironment] = useState<"outdoor" | "indoor">(existing?.environment ?? "outdoor")
  const [place, setPlace] = useState(existing?.location ?? "")
  const [notes, setNotes] = useState(existing?.notes ?? "")
  const [draft, setDraft] = useState<DetailDraft>(() => detailDraftFrom(existing, existing?.eventKey ?? initialEventKey ?? ""))
  const [showSplits, setShowSplits] = useState(Boolean(existing?.detail?.splits || existing?.detail?.reaction !== undefined))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const event = findResultEvent(eventKey)
  const isOther = event?.kind === "other"
  const unit: MarkUnit | null = event ? (isOther ? otherUnit : event.unit) : null
  const words = unit ? unitWordsForViewer(UNIT_WORDS, unit) : null
  const windApplies = Boolean(event?.windApplies) && environment === "outdoor"
  const kinds = detailKindsFor(eventKey, unit)
  const seriesKind: "attempts" | "heights" | null = kinds.attempts ? "attempts" : kinds.heights ? "heights" : null
  const inSeries = draft.series && seriesKind !== null
  const parsedWind = windApplies && !inSeries ? parseWindInput(wind) : null
  const windAssisted = Boolean(parsedWind?.ok && parsedWind.value !== null && parsedWind.value > WIND_LEGAL_LIMIT)
  const typedTime = unit === "s" ? parseMarkInput(mark, "s") : null

  const patchDraft = (change: Partial<DetailDraft>) => {
    setDraft((current) => ({ ...current, ...change }))
    setErrors((current) => ({ ...current, series: undefined, splits: undefined, reaction: undefined, heat: undefined, lane: undefined }))
  }

  const handleSubmit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault()
    setFormError(null)
    const nextErrors: FieldErrors = {}
    if (!event) nextErrors.event = "Choose an event."
    if (isOther && !otherLabel.trim()) nextErrors.label = "Name the event."
    const parsedMark = unit && !inSeries ? parseMarkForViewer(mark, unit) : null
    if (unit && parsedMark && !parsedMark.ok) nextErrors.mark = parsedMark.message
    if (parsedWind && !parsedWind.ok) nextErrors.wind = parsedWind.message
    if (!date) nextErrors.date = "Choose the date."
    else if (date > localToday()) nextErrors.date = "A result cannot be dated in the future."
    // Rounds belong to a competition; splits and a reaction time only count once they are shown.
    const reading = unit
      ? readDetailDraft(
          { ...draft, ...(setting === "manual" ? {} : { round: "", heat: "", lane: "", qualifier: "" }), ...(showSplits ? {} : { splits: [], reaction: "" }) },
          { eventKey, unit, windApplies, finalTime: unit === "s" && parsedMark?.ok ? parsedMark.value : null },
        )
      : null
    if (reading && !reading.ok) Object.assign(nextErrors, reading.errors)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || !event || !unit || !reading || !reading.ok || (!reading.series && (!parsedMark || !parsedMark.ok))) {
      setFormError("Check the highlighted fields, then save again.")
      return
    }

    const input: ResultInput = {
      eventKey: event.key,
      eventLabel: isOther ? otherLabel : null,
      unit: isOther ? otherUnit : null,
      // With a series the mark and its wind are worked out from the attempts when it is saved.
      value: !reading.series && parsedMark?.ok ? parsedMark.value : 0,
      timing: unit === "s" ? timing : null,
      date,
      source: setting,
      wind: !reading.series && parsedWind && parsedWind.ok ? parsedWind.value : null,
      environment,
      location: place,
      notes,
      round: reading.round,
      heat: reading.heat,
      lane: reading.lane,
      qualifier: reading.qualifier,
      detail: reading.detail,
    }

    setSaving(true)
    if (existing) {
      const result = await updateAthleteResult(existing.id, input)
      setSaving(false)
      if (!result.ok) {
        setFormError(result.error.message)
        return
      }
      if (forAthlete) {
        navigate(forAthlete.returnTo, { replace: true, state: { saved: { tone: "info", text: "Result corrected. Their bests have been worked out again." } } })
        return
      }
      navigate(eventHistoryPath(result.data.eventGroup), { replace: true, state: { saved: { tone: "info", text: "Result updated. Your bests have been worked out again." } } })
      return
    }

    const result = forAthlete ? await addAthleteResult(forAthlete.id, input) : await addResultForCurrentAthlete(input)
    setSaving(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    if (forAthlete) {
      navigate(forAthlete.returnTo, { replace: true, state: { saved: staffVerdictMessage(forAthlete.name, result.data.result, result.data.verdict) } })
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
    if (forAthlete) {
      navigate(forAthlete.returnTo, { replace: true, state: { saved: { tone: "info", text: "Result deleted. Their bests have been worked out again." } } })
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
                // Another event takes other detail (attempts are not splits): start it clean, keep the round.
                setDraft((current) => ({ ...detailDraftFrom(null, changeEvent.target.value), round: current.round, heat: current.heat, lane: current.lane, qualifier: current.qualifier }))
                setShowSplits(false)
                setErrors((current) => ({ ...current, event: undefined, mark: undefined, series: undefined, splits: undefined, reaction: undefined }))
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
                      {option.value === "kg" ? `Weight (${viewWeightWord()})` : option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}

          {inSeries && seriesKind === "attempts" ? <SeriesEditor draft={draft} onChange={patchDraft} windApplies={windApplies} error={errors.series} /> : null}
          {inSeries && seriesKind === "heights" ? <HeightsEditor draft={draft} onChange={patchDraft} error={errors.series} /> : null}
          {!inSeries ? (
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
          ) : null}
          {seriesKind ? (
            <Button variant="quiet" size="sm" className="-mt-2 self-start" onClick={() => patchDraft({ series: !draft.series })}>
              {inSeries ? (seriesKind === "heights" ? "Type the best height only" : "Type the best mark only") : seriesKind === "heights" ? "Enter every height" : "Enter every attempt"}
            </Button>
          ) : null}

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

          {windApplies && !inSeries ? (
            <Field
              label="Wind"
              optional
              error={errors.wind}
              hint={
                windAssisted
                  ? `Over +2.0 is wind assisted. It is kept in ${forAthlete ? "their" : "your"} history but does not count as a best.`
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

          {setting === "manual" && unit ? <RoundFields draft={draft} onChange={patchDraft} errors={errors} timed={unit === "s"} /> : null}

          {kinds.splits || kinds.reaction ? (
            showSplits ? (
              <>
                {kinds.reaction ? <ReactionField draft={draft} onChange={patchDraft} error={errors.reaction} /> : null}
                {kinds.splits ? <SplitsEditor draft={draft} onChange={patchDraft} eventKey={eventKey} finalTime={typedTime?.ok ? typedTime.value : null} error={errors.splits} /> : null}
              </>
            ) : (
              <Button variant="quiet" size="sm" className="self-start" onClick={() => setShowSplits(true)}>
                <Plus className="size-[18px]" weight="bold" aria-hidden />
                {kinds.splits && kinds.reaction ? "Add splits or a reaction time" : kinds.splits ? "Add splits" : "Add a reaction time"}
              </Button>
            )
          ) : null}

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
        <Section title="Delete this result" hint={forAthlete ? "It is removed from their history and their bests are worked out again." : "It is removed from your history and your bests are worked out again."}>
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
