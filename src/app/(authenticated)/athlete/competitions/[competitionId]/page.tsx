"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { PencilSimple, Plus } from "@phosphor-icons/react"
import { useLocation, useParams } from "react-router-dom"
import { BestStatus, meetDatesText, meetDayText, ordinal, ResultMark, UNIT_WORDS, verdictMessage } from "@/components/athlete/results-parts"
import {
  Button,
  Choices,
  Dialog,
  EmptyState,
  Fact,
  FactList,
  Field,
  Input,
  LinkButton,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  Select,
  SkeletonRows,
  StatusText,
} from "@/components/sk"
import {
  addEntryForCurrentAthlete,
  getCompetitionForCurrentAthlete,
  removeCompetitionEntry,
  saveCompetitionEntryResult,
  updateCompetitionEntry,
} from "@/lib/data/competition/competition-data"
import { COMPETITION_LEVELS, type CompetitionEntryWithResult, type CompetitionWithEntries } from "@/lib/data/competition/types"
import {
  findResultEvent,
  formatMark,
  formatWind,
  OTHER_EVENT_KEY,
  parseMarkInput,
  parseWindInput,
  RESULT_EVENTS,
  verdictForNewResult,
  WIND_LEGAL_LIMIT,
  type MarkUnit,
  type Timing,
} from "@/lib/data/pr/marks"
import { addDays, localDayKey, parseLocalDay } from "@/lib/data/pr/pr-display"
import { canViewerEditResult, deleteAthleteResult, getCurrentAthleteRecords, type AthleteRecords } from "@/lib/data/pr/results-data"

type SavedNotice = { tone: "success" | "warning" | "info"; text: string }

const CATEGORY_GROUPS = [...new Set(RESULT_EVENTS.filter((event) => event.kind !== "other").map((event) => event.category))]

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

/* ---------- Enter or correct the result of one entry ---------- */

function ResultDialog({
  entry,
  competition,
  canEdit,
  onClose,
  onSaved,
}: {
  entry: CompetitionEntryWithResult
  competition: CompetitionWithEntries
  canEdit: boolean
  onClose: () => void
  onSaved: (notice: SavedNotice | null, created: boolean, resultId: string | null) => void
}) {
  const event = findResultEvent(entry.eventKey)
  const isOther = !event || event.kind === "other"
  const existing = entry.result
  const todayKey = localDayKey(new Date())
  const days = competitionDays(competition.startDate, competition.endDate).filter((day) => day <= todayKey)

  const [otherUnit, setOtherUnit] = useState<MarkUnit>(existing?.unit ?? "s")
  const unit: MarkUnit = isOther ? otherUnit : (event.unit ?? "s")
  const [mark, setMark] = useState(existing ? formatMark(existing.value, existing.unit) : "")
  const [timing, setTiming] = useState<Timing>(existing?.timing ?? "electronic")
  const [wind, setWind] = useState(existing && existing.wind !== null ? formatWind(existing.wind) : "")
  const [place, setPlace] = useState(existing?.place ? String(existing.place) : "")
  const [date, setDate] = useState(existing?.date ?? days[0] ?? competition.startDate)
  const [errors, setErrors] = useState<{ mark?: string; wind?: string; place?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const windApplies = Boolean(event?.windApplies) && competition.environment === "outdoor"
  const parsedWind = windApplies ? parseWindInput(wind) : null
  const windAssisted = Boolean(parsedWind?.ok && parsedWind.value !== null && parsedWind.value > WIND_LEGAL_LIMIT)
  const words = UNIT_WORDS[unit]

  const save = async () => {
    setFormError(null)
    const nextErrors: typeof errors = {}
    const parsedMark = parseMarkInput(mark, unit)
    if (!parsedMark.ok) nextErrors.mark = parsedMark.message
    if (parsedWind && !parsedWind.ok) nextErrors.wind = parsedWind.message
    const placeNumber = place.trim() ? Number(place.trim()) : null
    if (placeNumber !== null && (!Number.isInteger(placeNumber) || placeNumber < 1 || placeNumber > 999)) nextErrors.place = "A whole number, like 2."
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || !parsedMark.ok) return

    setBusy(true)
    const result = await saveCompetitionEntryResult(entry, competition, {
      value: parsedMark.value,
      timing: unit === "s" ? timing : null,
      wind: parsedWind && parsedWind.ok ? parsedWind.value : null,
      place: placeNumber,
      date,
      unit: isOther ? otherUnit : undefined,
    })
    setBusy(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    onSaved(existing ? { tone: "info", text: `${entry.eventLabel} result updated.` } : null, !existing, result.data.id)
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
    onSaved({ tone: "info", text: `${entry.eventLabel} result deleted.` }, false, null)
  }

  const scratch = async () => {
    setBusy(true)
    const result = await updateCompetitionEntry(entry.id, { status: "scratched" })
    setBusy(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    onSaved({ tone: "info", text: `Marked as scratched from the ${entry.eventLabel}.` }, false, null)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`${entry.eventLabel} result`}
      description={`${competition.name}. One final mark for the event.`}
      footer={
        canEdit ? (
          <>
            {existing ? (
              <Button variant="danger" disabled={busy} onClick={() => void remove()}>
                Delete result
              </Button>
            ) : (
              <Button variant="quiet" disabled={busy} onClick={() => void scratch()}>
                I did not compete
              </Button>
            )}
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving..." : "Save result"}
            </Button>
          </>
        ) : undefined
      }
    >
      {canEdit ? (
        <div className="flex flex-col gap-4">
          {isOther && !existing ? (
            <Field label="Measured in">
              <Select value={otherUnit} onChange={(changeEvent) => setOtherUnit(changeEvent.target.value as MarkUnit)}>
                {OTHER_UNITS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
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
          {windApplies ? (
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
          <Field label="Place" optional hint="Where you finished in the final standings." error={errors.place}>
            <Input value={place} inputMode="numeric" autoComplete="off" placeholder="2" onChange={(changeEvent) => setPlace(changeEvent.target.value)} />
          </Field>
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
          {formError ? <Notice tone="error">{formError}</Notice> : null}
        </div>
      ) : (
        <Notice tone="info">Your coach entered this result. Ask them if it needs to change.</Notice>
      )}
    </Dialog>
  )
}

/* ---------- Manage an entry before the meet ---------- */

function EntryDialog({ entry, canRemove, onClose, onSaved }: { entry: CompetitionEntryWithResult; canRemove: boolean; onClose: () => void; onSaved: (notice: SavedNotice) => void }) {
  const [notes, setNotes] = useState(entry.notes ?? "")
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const run = async (action: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>, notice: SavedNotice) => {
    setBusy(true)
    const result = await action()
    setBusy(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    onSaved(notice)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={entry.eventLabel}
      description={entry.status === "scratched" ? "You are scratched from this event." : "You are entered in this event."}
      footer={
        <>
          {canRemove ? (
            <Button variant="danger" disabled={busy} onClick={() => void run(() => removeCompetitionEntry(entry.id), { tone: "info", text: `${entry.eventLabel} entry removed.` })}>
              Remove entry
            </Button>
          ) : null}
          {entry.status === "entered" ? (
            <Button disabled={busy} onClick={() => void run(() => updateCompetitionEntry(entry.id, { status: "scratched", notes }), { tone: "info", text: `Scratched from the ${entry.eventLabel}.` })}>
              Scratch
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => void run(() => updateCompetitionEntry(entry.id, { status: "entered", notes }), { tone: "success", text: `Back in the ${entry.eventLabel}.` })}>
              Enter again
            </Button>
          )}
          <Button variant="primary" disabled={busy} onClick={() => void run(() => updateCompetitionEntry(entry.id, { notes }), { tone: "success", text: `${entry.eventLabel} note saved.` })}>
            Save note
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Heat, lane or flight" optional hint="Whatever you need on the day: heat 2 lane 4, flight B, call room 10:15.">
          <Input value={notes} maxLength={500} onChange={(changeEvent) => setNotes(changeEvent.target.value)} />
        </Field>
        {formError ? <Notice tone="error">{formError}</Notice> : null}
      </div>
    </Dialog>
  )
}

/* ---------- Add an event ---------- */

function AddEventDialog({ competitionId, takenGroups, onClose, onSaved }: { competitionId: string; takenGroups: Set<string>; onClose: () => void; onSaved: (notice: SavedNotice) => void }) {
  const [eventKey, setEventKey] = useState("")
  const [label, setLabel] = useState("")
  const [notes, setNotes] = useState("")
  const [errors, setErrors] = useState<{ event?: string; label?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isOther = eventKey === OTHER_EVENT_KEY

  const save = async () => {
    setFormError(null)
    const nextErrors: typeof errors = {}
    if (!eventKey) nextErrors.event = "Choose an event."
    if (isOther && !label.trim()) nextErrors.label = "Name the event."
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setBusy(true)
    const result = await addEntryForCurrentAthlete(competitionId, { eventKey, eventLabel: isOther ? label : null, notes })
    setBusy(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    onSaved({ tone: "success", text: `You are entered in the ${result.data.eventLabel}.` })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Add an event"
      description="An event you are entered in at this competition."
      footer={
        <>
          <Button variant="quiet" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving..." : "Add event"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Event" error={errors.event}>
          <Select value={eventKey} onChange={(changeEvent) => setEventKey(changeEvent.target.value)}>
            <option value="">Choose an event</option>
            {CATEGORY_GROUPS.map((category) => (
              <optgroup key={category} label={category}>
                {RESULT_EVENTS.filter((item) => item.category === category).map((item) => (
                  <option key={item.key} value={item.key} disabled={takenGroups.has(`k:${item.key}`)}>
                    {item.name}
                    {takenGroups.has(`k:${item.key}`) ? " (entered)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
            <optgroup label="Something else">
              <option value={OTHER_EVENT_KEY}>Another event</option>
            </optgroup>
          </Select>
        </Field>
        {isOther ? (
          <Field label="Name of the event" error={errors.label}>
            <Input value={label} maxLength={80} placeholder="Medley relay" onChange={(changeEvent) => setLabel(changeEvent.target.value)} />
          </Field>
        ) : null}
        <Field label="Heat, lane or flight" optional>
          <Input value={notes} maxLength={500} onChange={(changeEvent) => setNotes(changeEvent.target.value)} />
        </Field>
        {formError ? <Notice tone="error">{formError}</Notice> : null}
      </div>
    </Dialog>
  )
}

/* ---------- Screen ---------- */

export default function AthleteCompetitionDetailPage() {
  const { competitionId = "" } = useParams()
  const location = useLocation()
  const [competition, setCompetition] = useState<CompetitionWithEntries | null | undefined>(undefined)
  const [records, setRecords] = useState<AthleteRecords | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<SavedNotice | null>((location.state as { saved?: SavedNotice } | null)?.saved ?? null)
  const [resultEntryId, setResultEntryId] = useState<string | null>(null)
  const [manageEntryId, setManageEntryId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const [competitionResult, recordsResult] = await Promise.all([getCompetitionForCurrentAthlete(competitionId), getCurrentAthleteRecords()])
    if (competitionResult.ok) {
      setCompetition(competitionResult.data)
      setError(null)
    } else {
      setError(competitionResult.error.message)
    }
    if (recordsResult.ok) setRecords(recordsResult.data)
    return recordsResult.ok ? recordsResult.data : null
  }, [competitionId])

  useEffect(() => {
    void load()
  }, [load])

  const today = useMemo(() => localDayKey(new Date()), [])
  const bestIds = useMemo(() => {
    const personal = new Set<string>()
    const season = new Set<string>()
    for (const event of records?.events ?? []) {
      if (event.bests.personalBest) personal.add(event.bests.personalBest.id)
      if (event.bests.seasonBest) season.add(event.bests.seasonBest.id)
    }
    return { personal, season }
  }, [records])

  if (competition === undefined && !error) {
    return (
      <Screen>
        <ScreenHeader back={{ to: "/athlete/competitions", label: "Competitions" }} title="Competition" />
        <Section title="Your events">
          <SkeletonRows rows={3} label="Loading the competition" />
        </Section>
      </Screen>
    )
  }

  if (!competition) {
    return (
      <Screen>
        <ScreenHeader back={{ to: "/athlete/competitions", label: "Competitions" }} title="Competition" />
        {error ? <Notice tone="error">This competition could not be loaded. {error}</Notice> : null}
        {!error ? (
          <Section title="This competition is not on your calendar">
            <EmptyState
              title="It may have been removed"
              body="Or it belongs to another team. Your calendar shows every meet you can see."
              action={
                <LinkButton to="/athlete/competitions" size="sm">
                  Back to competitions
                </LinkButton>
              }
            />
          </Section>
        ) : null}
      </Screen>
    )
  }

  const started = competition.startDate <= today
  const over = competition.endDate < today
  const startDay = parseLocalDay(competition.startDate)
  const daysAway = startDay ? Math.round((startDay.getTime() - (parseLocalDay(today) ?? new Date()).getTime()) / 86_400_000) : 0
  const where = [competition.venue, competition.location].filter(Boolean).join(", ")
  const level = COMPETITION_LEVELS.find((item) => item.value === competition.level)?.label ?? null
  const viewerUserId = records?.viewerUserId ?? null
  const entered = competition.entries.filter((entry) => entry.status === "entered")
  const resultEntry = competition.entries.find((entry) => entry.id === resultEntryId) ?? null
  const manageEntry = competition.entries.find((entry) => entry.id === manageEntryId) ?? null

  const afterResult = async (savedNotice: SavedNotice | null, created: boolean, resultId: string | null) => {
    setResultEntryId(null)
    const fresh = await load()
    if (savedNotice) {
      setNotice(savedNotice)
      return
    }
    const added = created && resultId ? fresh?.results.find((result) => result.id === resultId) : null
    if (added && fresh) {
      const sameEvent = fresh.results.filter((result) => result.eventGroup === added.eventGroup)
      setNotice(verdictMessage(added, verdictForNewResult(added, sameEvent, fresh.season)))
    } else {
      setNotice({ tone: "success", text: "Result saved." })
    }
  }

  const afterEntry = async (savedNotice: SavedNotice) => {
    setManageEntryId(null)
    setAdding(false)
    setNotice(savedNotice)
    await load()
  }

  return (
    <Screen>
      <ScreenHeader
        back={{ to: "/athlete/competitions", label: "Competitions" }}
        fact={over ? "Past competition" : started ? "On now" : daysAway === 1 ? "Tomorrow" : `In ${daysAway} days`}
        title={competition.name}
        lede={[meetDatesText(competition.startDate, competition.endDate), where].filter(Boolean).join(", ")}
        actions={
          competition.canManage ? (
            <LinkButton to={`/athlete/competitions/${competition.id}/edit`}>
              <PencilSimple className="size-[18px]" weight="bold" aria-hidden />
              Edit
            </LinkButton>
          ) : undefined
        }
      />

      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {error ? <Notice tone="error">The latest changes could not be loaded. {error}</Notice> : null}

      <Section
        title="Your events"
        meta={competition.entries.length > 0 ? `${entered.length} entered` : undefined}
        hint={started && entered.some((entry) => !entry.result) ? "Tap an event to enter your result. It goes straight into your records." : undefined}
      >
        {competition.entries.length > 0 ? (
          <List>
            {competition.entries.map((entry) => {
              const result = entry.result
              const scratched = entry.status === "scratched"
              const openResult = started && !scratched
              const details = result ? [result.wind !== null ? `Wind ${formatWind(result.wind)}` : null, !result.windLegal ? "wind assisted" : null, result.place ? `${ordinal(result.place)} place` : null].filter(Boolean).join(", ") : ""
              return (
                <ListRow
                  key={entry.id}
                  onClick={() => (openResult ? setResultEntryId(entry.id) : setManageEntryId(entry.id))}
                  aria-label={openResult ? (result ? `${entry.eventLabel}, change result` : `${entry.eventLabel}, enter result`) : `${entry.eventLabel}, manage entry`}
                  title={entry.eventLabel}
                  subtitle={
                    result ? (
                      <>
                        {details || "No wind or place recorded"}
                        {bestIds.personal.has(result.id) ? (
                          <span className="mt-0.5 block">
                            <BestStatus kind="pb" />
                          </span>
                        ) : bestIds.season.has(result.id) ? (
                          <span className="mt-0.5 block">
                            <BestStatus kind="sb" />
                          </span>
                        ) : null}
                      </>
                    ) : (
                      (entry.notes ?? (entry.enteredByUserId && entry.enteredByUserId === viewerUserId ? "You entered this" : "Entered by your coach"))
                    )
                  }
                  trailing={
                    result ? (
                      <ResultMark result={result} />
                    ) : scratched ? (
                      <StatusText tone="coral">Scratched</StatusText>
                    ) : started ? (
                      <span className="sk-link">Enter result</span>
                    ) : (
                      <span className="font-normal text-sk-mute">Entered</span>
                    )
                  }
                />
              )
            })}
          </List>
        ) : (
          <EmptyState
            title="You are not entered in anything yet"
            body={over ? "If you competed here, add the event and then your result." : "Add the events you are entered in. After the meet you enter your results here."}
          />
        )}
        <Button className="mt-3 self-start" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-[18px]" weight="bold" aria-hidden />
          Add an event
        </Button>
      </Section>

      <Section title="Details">
        <FactList aria-label="Competition details">
          <Fact label="Date">{meetDatesText(competition.startDate, competition.endDate)}</Fact>
          <Fact label="Venue" empty="Not set">
            {competition.venue}
          </Fact>
          <Fact label="Town or city" empty="Not set">
            {competition.location}
          </Fact>
          <Fact label="Indoors or outdoors">{competition.environment === "indoor" ? "Indoors" : "Outdoors"}</Fact>
          <Fact label="Level" empty="Not set">
            {level}
          </Fact>
          <Fact label="Set up by">{competition.scope === "athlete" ? "You" : competition.scope === "club" ? "Your club" : "Your coach"}</Fact>
          {competition.notes ? (
            <Fact label="Note" stack>
              {competition.notes}
            </Fact>
          ) : null}
        </FactList>
      </Section>

      {resultEntry ? (
        <ResultDialog
          key={resultEntry.id}
          entry={resultEntry}
          competition={competition}
          canEdit={!resultEntry.result || canViewerEditResult(resultEntry.result, viewerUserId)}
          onClose={() => setResultEntryId(null)}
          onSaved={(savedNotice, created, resultId) => void afterResult(savedNotice, created, resultId)}
        />
      ) : null}
      {manageEntry ? (
        <EntryDialog
          key={manageEntry.id}
          entry={manageEntry}
          canRemove={Boolean(viewerUserId) && manageEntry.enteredByUserId === viewerUserId && !manageEntry.result}
          onClose={() => setManageEntryId(null)}
          onSaved={(savedNotice) => void afterEntry(savedNotice)}
        />
      ) : null}
      {adding ? (
        <AddEventDialog competitionId={competition.id} takenGroups={new Set(competition.entries.map((entry) => entry.eventGroup))} onClose={() => setAdding(false)} onSaved={(savedNotice) => void afterEntry(savedNotice)} />
      ) : null}
    </Screen>
  )
}
