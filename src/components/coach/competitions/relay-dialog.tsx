"use client"

import { useMemo, useState } from "react"
import { detailDraftFrom, RoundFields, type DetailDraft } from "@/components/athlete/result-detail"
import { meetDayText } from "@/components/athlete/results-parts"
import { Button, Choices, Dialog, Field, InlineConfirm, Input, Notice, Select } from "@/components/sk"
import { deleteRelayEntry, saveRelayEntry } from "@/lib/data/competition/relay-data"
import { RELAY_EVENTS, RELAY_LEGS } from "@/lib/data/competition/relay-logic"
import type { StaffAthlete, StaffTeam } from "@/lib/data/competition/staff-roster"
import type { CompetitionWithEntries, RelayEntry } from "@/lib/data/competition/types"
import { formatMark, parseMarkInput, type Timing } from "@/lib/data/pr/marks"
import { addDays, localDayKey, parseLocalDay } from "@/lib/data/pr/pr-display"

export type RelayDialogOutcome = { relay: RelayEntry | null; deleted: boolean; label: string }

function competitionDays(startDate: string, endDate: string): string[] {
  const start = parseLocalDay(startDate)
  const end = parseLocalDay(endDate)
  if (!start || !end) return [startDate]
  const days: string[] = []
  for (let day = start; day.getTime() <= end.getTime() && days.length < 31; day = addDays(day, 1)) days.push(localDayKey(day))
  return days
}

/** "43.5h" is a hand time. */
function readTime(text: string): { ok: true; value: number | null; timing: Timing | null } | { ok: false; message: string } {
  const raw = text.trim()
  if (!raw) return { ok: true, value: null, timing: null }
  const hand = /h$/i.test(raw)
  const parsed = parseMarkInput(hand ? raw.slice(0, -1) : raw, "s")
  if (!parsed.ok) return parsed
  return { ok: true, value: parsed.value, timing: hand ? "hand" : "electronic" }
}

/**
 * Add a relay team to a competition, or change one: the event, what the team is called, the four
 * legs in running order with optional leg splits and, once the relay is run, its time and place.
 * `roster` is who the coach may name; `teams` are the teams it can run for (one for a coach on a
 * team's meet, so the choice is not shown).
 */
export function RelayDialog({
  competition,
  relay,
  roster,
  teams,
  defaultTeamId,
  started,
  onClose,
  onDone,
}: {
  competition: CompetitionWithEntries
  /** The relay being changed. Null to add one. */
  relay: RelayEntry | null
  roster: StaffAthlete[]
  teams: StaffTeam[]
  defaultTeamId: string | null
  /** The competition has started, so a time can be typed. */
  started: boolean
  onClose: () => void
  onDone: (outcome: RelayDialogOutcome) => void
}) {
  const todayKey = localDayKey(new Date())
  const days = competitionDays(competition.startDate, competition.endDate).filter((day) => day <= todayKey || !started)
  const [eventKey, setEventKey] = useState(relay?.eventKey ?? "4x100m")
  const [teamId, setTeamId] = useState(relay?.teamId ?? defaultTeamId ?? teams[0]?.id ?? "")
  const teamName = teams.find((team) => team.id === teamId)?.name ?? relay?.teamName ?? ""
  const [teamLabel, setTeamLabel] = useState(relay?.teamLabel ?? "")
  const [legs, setLegs] = useState<string[]>(() => RELAY_LEGS.map((leg) => relay?.legs.find((item) => item.leg === leg)?.athleteId ?? ""))
  const [splits, setSplits] = useState<string[]>(() =>
    RELAY_LEGS.map((leg) => {
      const split = relay?.legs.find((item) => item.leg === leg)?.split ?? null
      return split === null ? "" : formatMark(split, "s")
    }),
  )
  const [time, setTime] = useState(relay && relay.value !== null ? formatMark(relay.value, "s", relay.timing) : "")
  const [place, setPlace] = useState(relay?.place ? String(relay.place) : "")
  const [date, setDate] = useState(relay?.date ?? days[days.length - 1] ?? competition.startDate)
  const [draft, setDraft] = useState<DetailDraft>(() => detailDraftFrom(relay ? { round: relay.round, heat: relay.heat, lane: relay.lane, qualifier: relay.qualifier, detail: null } : null, eventKey))
  const [errors, setErrors] = useState<{ time?: string; place?: string; heat?: string; lane?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // The athletes of the relay's team first, then everyone else the coach may name.
  const options = useMemo(() => [...roster].sort((a, b) => Number(b.teamId === teamId) - Number(a.teamId === teamId) || a.name.localeCompare(b.name)), [roster, teamId])
  /** A leg whose athlete's data was deleted: it may stay as it is. */
  const formerLegs = relay ? relay.legs.filter((leg) => !leg.athleteId).map((leg) => leg.leg) : []
  const eventName = RELAY_EVENTS.find((event) => event.key === eventKey)?.name ?? "relay"

  const save = async () => {
    setFormError(null)
    const nextErrors: typeof errors = {}
    const parsedTime = started ? readTime(time) : { ok: true as const, value: null, timing: null }
    if (!parsedTime.ok) nextErrors.time = parsedTime.message
    const placeNumber = place.trim() ? Number(place.trim()) : null
    if (placeNumber !== null && (!Number.isInteger(placeNumber) || placeNumber < 1 || placeNumber > 999)) nextErrors.place = "A whole number, like 2."
    const whole = (text: string, max: number) => (!text.trim() ? null : /^\d{1,2}$/.test(text.trim()) && Number(text) >= 1 && Number(text) <= max ? Number(text) : Number.NaN)
    const heat = whole(draft.heat, 99)
    const lane = whole(draft.lane, 20)
    if (Number.isNaN(heat)) nextErrors.heat = "A whole number, like 2."
    if (Number.isNaN(lane)) nextErrors.lane = "A whole number, like 4."
    const parsedSplits = splits.map((text) => (text.trim() ? parseMarkInput(text, "s") : null))
    const badSplit = parsedSplits.findIndex((item) => item !== null && !item.ok)
    setErrors(nextErrors)
    if (badSplit >= 0) {
      setFormError(`The split of leg ${badSplit + 1} is not a time. Write it like 10.84.`)
      return
    }
    if (Object.keys(nextErrors).length > 0 || !parsedTime.ok) {
      setFormError("Check the highlighted fields, then save again.")
      return
    }
    if (!teamId) {
      setFormError("Choose the team the relay runs for.")
      return
    }

    setBusy(true)
    const result = await saveRelayEntry(
      {
        id: relay?.id ?? null,
        competitionId: competition.id,
        eventKey,
        teamId,
        teamLabel: teamLabel.trim() || null,
        legs: RELAY_LEGS.map((leg, index) => {
          const split = parsedSplits[index]
          return { leg, athleteId: legs[index] || null, split: split && split.ok ? split.value : null }
        }),
        value: parsedTime.value,
        timing: parsedTime.timing,
        round: draft.round || null,
        heat,
        lane,
        place: placeNumber,
        qualifier: draft.round === "heat" || draft.round === "quarter_final" || draft.round === "semi_final" ? draft.qualifier || null : null,
        date,
      },
      competition,
    )
    setBusy(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    onDone({ relay: result.data, deleted: false, label: `${result.data.teamLabel}, ${result.data.eventLabel}` })
  }

  const remove = async () => {
    if (!relay) return
    setBusy(true)
    const result = await deleteRelayEntry(relay.id)
    setBusy(false)
    if (!result.ok) {
      setConfirmDelete(false)
      setFormError(result.error.message)
      return
    }
    onDone({ relay: null, deleted: true, label: `${relay.teamLabel}, ${relay.eventLabel}` })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={relay ? "Change relay team" : "Add a relay team"}
      description={`${competition.name}. Four athletes in running order${started ? ", and the time once they have run" : ""}. A relay counts for the team, not as anyone's own record.`}
      footer={
        confirmDelete ? undefined : (
          <>
            {relay ? (
              <Button variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
                Delete relay
              </Button>
            ) : (
              <Button variant="quiet" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
            )}
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving..." : "Save relay"}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Choices label="Relay" columns={3} value={eventKey} onChange={setEventKey} options={RELAY_EVENTS.map((event) => ({ value: event.key, label: event.name.replace(" relay", "") }))} />

        {teams.length > 1 ? (
          <Field label="Team">
            <Select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Name of the relay team" optional hint="Tell an A and a B team apart. Left empty, it takes the team's name.">
          <Input value={teamLabel} maxLength={60} placeholder={teamName ? `${teamName} A` : "Sprint Group A"} onChange={(event) => setTeamLabel(event.target.value)} />
        </Field>

        <div className="flex flex-col gap-3" role="group" aria-label="Legs in running order">
          {RELAY_LEGS.map((leg, index) => {
            const former = formerLegs.includes(leg) && !legs[index]
            return (
              <div key={leg} className="flex items-end gap-2">
                <Field label={`Leg ${leg}`} className="min-w-0 flex-1">
                  <Select value={legs[index]} onChange={(event) => setLegs((current) => current.map((id, position) => (position === index ? event.target.value : id)))}>
                    <option value="">{former ? "Former member (data deleted)" : "Choose an athlete"}</option>
                    {options.map((athlete) => (
                      <option key={athlete.id} value={athlete.id} disabled={legs.some((id, position) => id === athlete.id && position !== index)}>
                        {athlete.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {started ? (
                  <input
                    className="sk-field w-[5.25rem] shrink-0 px-2 text-center tabular-nums"
                    aria-label={`Split of leg ${leg}`}
                    value={splits[index]}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="Split"
                    onChange={(event) => setSplits((current) => current.map((text, position) => (position === index ? event.target.value : text)))}
                  />
                ) : null}
              </div>
            )
          })}
        </div>

        {started ? (
          <>
            <Field label="Time" optional hint="Like 43.12 or 3:21.50. Add h for a hand time (43.5h). Leave it empty if the team has not run yet." error={errors.time}>
              <Input
                value={time}
                inputMode="text"
                autoComplete="off"
                placeholder="43.12"
                onChange={(event) => {
                  setTime(event.target.value)
                  if (errors.time) setErrors((current) => ({ ...current, time: undefined }))
                }}
              />
            </Field>
            <Field label="Place" optional error={errors.place}>
              <Input value={place} inputMode="numeric" autoComplete="off" placeholder="2" onChange={(event) => setPlace(event.target.value)} />
            </Field>
          </>
        ) : null}

        <RoundFields draft={draft} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} errors={errors} timed />

        {days.length > 1 ? (
          <Field label="Day">
            <Select value={date} onChange={(event) => setDate(event.target.value)}>
              {days.map((day) => (
                <option key={day} value={day}>
                  {meetDayText(day)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {formError ? <Notice tone="error">{formError}</Notice> : null}
        {confirmDelete ? (
          <InlineConfirm question={`Delete this ${eventName} team and its time for good?`} confirmLabel="Delete relay" busy={busy} onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)} />
        ) : null}
      </div>
    </Dialog>
  )
}
