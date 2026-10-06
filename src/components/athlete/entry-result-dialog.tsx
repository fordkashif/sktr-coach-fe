"use client"

import { useState } from "react"
import { Plus } from "@phosphor-icons/react"
import {
  detailDraftFrom,
  HeightsEditor,
  ReactionField,
  readDetailDraft,
  ResultDetailView,
  roundLine,
  RoundFields,
  SeriesEditor,
  SplitsEditor,
  type DetailDraft,
  type DetailErrors,
} from "@/components/athlete/result-detail"
import { meetDayText, ResultMark, UNIT_WORDS } from "@/components/athlete/results-parts"
import { Button, Choices, Dialog, Field, Input, List, ListRow, Notice, Select } from "@/components/sk"
import type { CompetitionEntryWithResult, CompetitionResultInput, CompetitionWithEntries } from "@/lib/data/competition/types"
import {
  detailKindsFor,
  findResultEvent,
  formatWind,
  parseMarkInput,
  parseWindInput,
  roundLabel,
  roundSlot,
  WIND_LEGAL_LIMIT,
  type AthleteResult,
  type MarkUnit,
  type Timing,
} from "@/lib/data/pr/marks"
import { addDays, localDayKey, parseLocalDay } from "@/lib/data/pr/pr-display"
import { deleteAthleteResult } from "@/lib/data/pr/results-data"
import type { Result } from "@/lib/data/result"
import { markEntryText, parseMarkForViewer, unitWordsForViewer, viewWeightWord } from "@/lib/units-view"

export type EntryResultNotice = { tone: "success" | "warning" | "info"; text: string }

export type EntryResultOutcome = {
  /** Something to say on the screen. Null after a new result: the screen says what the mark means. */
  notice: EntryResultNotice | null
  /** True when a result was added (not corrected). */
  created: boolean
  resultId: string | null
}

const OTHER_UNITS: Array<{ value: MarkUnit; label: string }> = [
  { value: "s", label: "Time (seconds)" },
  { value: "m", label: "Distance (metres)" },
  { value: "cm", label: "Height (centimetres)" },
  { value: "kg", label: "Weight (kilograms)" },
  { value: "pts", label: "Points or a score" },
]

function competitionDays(startDate: string, endDate: string): string[] {
  const start = parseLocalDay(startDate)
  const end = parseLocalDay(endDate)
  if (!start || !end) return [startDate]
  const days: string[] = []
  for (let day = start; day.getTime() <= end.getTime() && days.length < 31; day = addDays(day, 1)) days.push(localDayKey(day))
  return days
}

/** What a round is called in a list: "Heat", "Final", or "Result" when nobody said. */
function roundName(result: AthleteResult): string {
  return roundLabel(result.round) || "Result"
}

/* ---------- One round: add or correct --------------------------------------------------------------- */

function useRoundForm({
  entry,
  competition,
  existing,
  audience,
  save,
  scratch,
  onBack,
  onAddAnother,
  onSaved,
}: {
  entry: CompetitionEntryWithResult
  competition: CompetitionWithEntries
  /** The round being corrected. Null to add one. */
  existing: AthleteResult | null
  audience: "athlete" | "staff"
  save: (entry: CompetitionEntryWithResult, input: CompetitionResultInput) => Promise<Result<AthleteResult>>
  scratch?: () => Promise<Result<unknown>>
  /** Back to the list of rounds, when the entry has more than one. */
  onBack?: () => void
  /** Start another round, when this is the entry's only one. */
  onAddAnother?: () => void
  onSaved: (outcome: EntryResultOutcome) => void
}) {
  const event = findResultEvent(entry.eventKey)
  const isOther = !event || event.kind === "other"
  const todayKey = localDayKey(new Date())
  const days = competitionDays(competition.startDate, competition.endDate).filter((day) => day <= todayKey)
  const otherRounds = (entry.rounds ?? []).filter((round) => round.id !== existing?.id)

  const [otherUnit, setOtherUnit] = useState<MarkUnit>(existing?.unit ?? entry.result?.unit ?? "s")
  const unit: MarkUnit = isOther ? otherUnit : (event.unit ?? "s")
  const kinds = detailKindsFor(entry.eventKey, unit)
  const [mark, setMark] = useState(existing ? markEntryText(existing.value, existing.unit) : "")
  const [timing, setTiming] = useState<Timing>(existing?.timing ?? "electronic")
  const [wind, setWind] = useState(existing && existing.wind !== null ? formatWind(existing.wind) : "")
  const [place, setPlace] = useState(existing?.place ? String(existing.place) : "")
  const [date, setDate] = useState(existing?.date ?? days[days.length - 1] ?? competition.startDate)
  const [draft, setDraft] = useState<DetailDraft>(() => detailDraftFrom(existing, entry.eventKey))
  const [showSplits, setShowSplits] = useState(Boolean(existing?.detail?.splits || existing?.detail?.reaction !== undefined))
  const [errors, setErrors] = useState<{ mark?: string; wind?: string; place?: string } & DetailErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const patch = (change: Partial<DetailDraft>) => {
    setDraft((current) => ({ ...current, ...change }))
    setErrors((current) => ({ ...current, series: undefined, splits: undefined, reaction: undefined, heat: undefined, lane: undefined }))
  }

  const windApplies = Boolean(event?.windApplies) && competition.environment === "outdoor"
  const seriesKind: "attempts" | "heights" | null = kinds.attempts ? "attempts" : kinds.heights ? "heights" : null
  const inSeries = draft.series && seriesKind !== null
  const parsedWind = windApplies && !inSeries ? parseWindInput(wind) : null
  const windAssisted = Boolean(parsedWind?.ok && parsedWind.value !== null && parsedWind.value > WIND_LEGAL_LIMIT)
  const words = unitWordsForViewer(UNIT_WORDS, unit)
  const typedTime = unit === "s" ? parseMarkInput(mark, "s") : null
  const whose = audience === "athlete" ? "you" : "they"

  const submit = async () => {
    setFormError(null)
    const nextErrors: typeof errors = {}
    const parsedMark = inSeries ? null : parseMarkForViewer(mark, unit)
    if (parsedMark && !parsedMark.ok) nextErrors.mark = parsedMark.message
    if (parsedWind && !parsedWind.ok) nextErrors.wind = parsedWind.message
    const placeNumber = place.trim() ? Number(place.trim()) : null
    if (placeNumber !== null && (!Number.isInteger(placeNumber) || placeNumber < 1 || placeNumber > 999)) nextErrors.place = "A whole number, like 2."
    const reading = readDetailDraft(showSplits ? draft : { ...draft, splits: [], reaction: "" }, {
      eventKey: entry.eventKey,
      unit,
      windApplies,
      finalTime: unit === "s" && parsedMark?.ok ? parsedMark.value : null,
    })
    if (!reading.ok) Object.assign(nextErrors, reading.errors)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || !reading.ok) {
      setFormError("Check the highlighted fields, then save again.")
      return
    }

    setBusy(true)
    const result = await save(
      { ...entry, result: existing },
      {
        value: reading.series ? 0 : parsedMark?.ok ? parsedMark.value : 0,
        timing: unit === "s" ? timing : null,
        wind: reading.series ? null : parsedWind && parsedWind.ok ? parsedWind.value : null,
        place: placeNumber,
        date,
        unit: isOther ? otherUnit : undefined,
        round: reading.round,
        heat: reading.heat,
        lane: reading.lane,
        qualifier: reading.qualifier,
        detail: reading.detail,
      },
    )
    setBusy(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    onSaved({ notice: existing ? { tone: "info", text: `${entry.eventLabel} result updated.` } : null, created: !existing, resultId: result.data.id })
  }

  const remove = async () => {
    if (!existing) return
    setBusy(true)
    const result = await deleteAthleteResult(existing.id)
    setBusy(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    onSaved({ notice: { tone: "info", text: `${entry.eventLabel} result deleted.` }, created: false, resultId: null })
  }

  const doScratch = async () => {
    if (!scratch) return
    setBusy(true)
    const result = await scratch()
    setBusy(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    onSaved({ notice: { tone: "info", text: `Marked as scratched from the ${entry.eventLabel}.` }, created: false, resultId: null })
  }

  return {
    title: existing ? `${entry.eventLabel} result` : otherRounds.length > 0 ? `${entry.eventLabel}, another round` : `${entry.eventLabel} result`,
    description: `${competition.name}. ${inSeries ? (seriesKind === "heights" ? "The highest height cleared becomes the mark." : "The best attempt becomes the mark.") : otherRounds.length > 0 || existing?.round ? "One mark for this round." : "The mark, and the round if there was more than one."}`,
    footer: (
      <>
        {onBack ? (
          <Button variant="quiet" disabled={busy} onClick={onBack}>
            All rounds
          </Button>
        ) : null}
        {existing ? (
          <Button variant="danger" disabled={busy} onClick={() => void remove()}>
            Delete result
          </Button>
        ) : scratch && otherRounds.length === 0 ? (
          <Button variant="quiet" disabled={busy} onClick={() => void doScratch()}>
            I did not compete
          </Button>
        ) : null}
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Saving..." : "Save result"}
        </Button>
      </>
    ),
    body: (
      <div className="flex flex-col gap-4">
        {isOther && !existing && otherRounds.length === 0 ? (
          <Field label="Measured in">
            <Select value={otherUnit} onChange={(changeEvent) => setOtherUnit(changeEvent.target.value as MarkUnit)}>
              {OTHER_UNITS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === "kg" ? `Weight (${viewWeightWord()})` : option.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <RoundFields draft={draft} onChange={patch} errors={errors} timed={unit === "s"} taken={otherRounds.map((round) => round.round ?? null)} />

        {inSeries && seriesKind === "attempts" ? <SeriesEditor draft={draft} onChange={patch} windApplies={windApplies} error={errors.series} /> : null}
        {inSeries && seriesKind === "heights" ? <HeightsEditor draft={draft} onChange={patch} error={errors.series} /> : null}
        {!inSeries ? (
          <Field label={words.field} hint={words.hint} error={errors.mark}>
            <Input
              value={mark}
              inputMode={unit === "s" ? "text" : "decimal"}
              autoComplete="off"
              placeholder={words.placeholder}
              onChange={(changeEvent) => {
                setMark(changeEvent.target.value)
                if (errors.mark) setErrors((current) => ({ ...current, mark: undefined }))
              }}
            />
          </Field>
        ) : null}
        {seriesKind ? (
          <Button variant="quiet" size="sm" className="-mt-1 self-start" onClick={() => patch({ series: !draft.series })}>
            {inSeries ? (seriesKind === "heights" ? "Type the best height only" : "Type the best mark only") : seriesKind === "heights" ? "Enter every height" : "Enter every attempt"}
          </Button>
        ) : null}

        {unit === "s" ? (
          <Choices
            label="How was it timed"
            value={timing}
            onChange={setTiming}
            options={[
              { value: "electronic", label: "Electronic" },
              { value: "hand", label: "Hand (stopwatch)" },
            ]}
          />
        ) : null}
        {windApplies && !inSeries ? (
          <Field
            label="Wind"
            optional
            error={errors.wind}
            hint={windAssisted ? "Over +2.0 is wind assisted. It is kept but does not count as a best." : "With its sign, like +1.2 or -0.4. Leave it empty if there was no reading."}
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
        <Field label="Place" optional hint={`Where ${whose} finished in this ${unit === "s" ? "race" : "event"}.`} error={errors.place}>
          <Input value={place} inputMode="numeric" autoComplete="off" placeholder="2" onChange={(changeEvent) => setPlace(changeEvent.target.value)} />
        </Field>

        {kinds.splits || kinds.reaction ? (
          showSplits ? (
            <>
              {kinds.reaction ? <ReactionField draft={draft} onChange={patch} error={errors.reaction} /> : null}
              {kinds.splits ? <SplitsEditor draft={draft} onChange={patch} eventKey={entry.eventKey} finalTime={typedTime?.ok ? typedTime.value : null} error={errors.splits} /> : null}
            </>
          ) : (
            <Button variant="quiet" size="sm" className="self-start" onClick={() => setShowSplits(true)}>
              <Plus className="size-[18px]" weight="bold" aria-hidden />
              {kinds.splits && kinds.reaction ? "Add splits or a reaction time" : kinds.splits ? "Add splits" : "Add a reaction time"}
            </Button>
          )
        ) : null}

        {days.length > 1 ? (
          <Field label="Day">
            <Select value={date} onChange={(changeEvent) => setDate(changeEvent.target.value)}>
              {days.map((day) => (
                <option key={day} value={day}>
                  {meetDayText(day)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {onAddAnother ? (
          <Button variant="quiet" size="sm" className="self-start" disabled={busy} onClick={onAddAnother}>
            <Plus className="size-[18px]" weight="bold" aria-hidden />
            Add another round
          </Button>
        ) : null}

        {formError ? <Notice tone="error">{formError}</Notice> : null}
      </div>
    ),
  }
}

/**
 * The form of one round in its Dialog. useRoundForm hands back the title, description, fields and
 * buttons; this component is keyed by the round, so the fields reset when another one is opened.
 */
function RoundFormDialog(props: Parameters<typeof useRoundForm>[0] & { onClose: () => void }) {
  const form = useRoundForm(props)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={form.title}
      description={form.description}
      footer={form.footer}
    >
      {form.body}
    </Dialog>
  )
}

/* ---------- The dialog --------------------------------------------------------------------------------- */

/**
 * Enter, correct or look at the results of one competition entry. An entry can hold one result per
 * round (heat, quarter final, semi final, final): with one round the dialog opens straight on its
 * form, with more it lists them first. `save` is the athlete's or the staff's save function.
 */
export function EntryResultDialog({
  entry,
  competition,
  audience,
  canEdit,
  save,
  scratch,
  onClose,
  onSaved,
}: {
  entry: CompetitionEntryWithResult
  competition: CompetitionWithEntries
  audience: "athlete" | "staff"
  /** May the viewer change this result? (An athlete cannot change one their coach entered.) */
  canEdit: (result: AthleteResult) => boolean
  save: (entry: CompetitionEntryWithResult, input: CompetitionResultInput) => Promise<Result<AthleteResult>>
  /** Athlete only: "I did not compete". */
  scratch?: () => Promise<Result<unknown>>
  onClose: () => void
  onSaved: (outcome: EntryResultOutcome) => void
}) {
  const rounds = entry.rounds ?? (entry.result ? [entry.result] : [])
  // Which round is open: an id, "new" for another round, or null for the list.
  const [open, setOpen] = useState<string | "new" | null>(rounds.length === 0 ? "new" : rounds.length === 1 ? rounds[0].id : null)
  const current = open && open !== "new" ? (rounds.find((round) => round.id === open) ?? null) : null
  const freeSlots = 4 - new Set(rounds.map((round) => roundSlot(round.round))).size
  const canAdd = freeSlots > 0
  const dialogProps = {
    open: true,
    onOpenChange: (next: boolean) => {
      if (!next) onClose()
    },
  }

  if (open === "new" || (current && canEdit(current))) {
    return (
      <RoundFormDialog
        key={open}
        entry={entry}
        competition={competition}
        existing={current}
        audience={audience}
        save={save}
        scratch={scratch}
        onBack={rounds.length > 1 || (open === "new" && rounds.length > 0) ? () => setOpen(rounds.length === 1 ? rounds[0].id : null) : undefined}
        onAddAnother={current && rounds.length === 1 && canAdd ? () => setOpen("new") : undefined}
        onSaved={onSaved}
        onClose={onClose}
      />
    )
  }

  if (current) {
    return (
      <Dialog
        {...dialogProps}
        title={`${entry.eventLabel}, ${roundName(current).toLowerCase()}`}
        description={competition.name}
        footer={
          rounds.length > 1 ? (
            <Button variant="quiet" onClick={() => setOpen(null)}>
              All rounds
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-4">
          <ResultMark result={current} size="lg" withWind />
          <ResultDetailView result={current} />
          <Notice tone="info">{audience === "athlete" ? "Your coach entered this result. Ask them if it needs to change." : "This result cannot be changed here."}</Notice>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      {...dialogProps}
      title={`${entry.eventLabel} results`}
      description={`${competition.name}. One result for each round. The best of them counts for records.`}
      footer={
        canAdd ? (
          <Button onClick={() => setOpen("new")}>
            <Plus className="size-[18px]" weight="bold" aria-hidden />
            Add another round
          </Button>
        ) : undefined
      }
    >
      <List aria-label={`Rounds of the ${entry.eventLabel}`}>
        {rounds.map((round) => {
          const line = roundLine({ ...round, round: null })
          return (
            <ListRow
              key={round.id}
              onClick={() => setOpen(round.id)}
              aria-label={`${roundName(round)}, ${canEdit(round) ? "change result" : "see result"}`}
              title={roundName(round)}
              subtitle={[line, round.wind !== null ? `Wind ${formatWind(round.wind)}` : "", !round.windLegal ? "wind assisted" : ""].filter(Boolean).join(", ") || meetDayText(round.date)}
              trailing={<ResultMark result={round} />}
            />
          )
        })}
      </List>
    </Dialog>
  )
}
