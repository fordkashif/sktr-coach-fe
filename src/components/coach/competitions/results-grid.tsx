"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { markText } from "@/components/athlete/results-parts"
import { Avatar, EntryGrid, Notice, SaveState, StatusText, TableSub, type EntryGridCell, type SaveStateValue } from "@/components/sk"
import { saveCompetitionEntryResultForStaff, type EntryStanding } from "@/lib/data/competition/competition-data"
import type { CompetitionEntryWithResult, CompetitionWithEntries } from "@/lib/data/competition/types"
import {
  describeDifference,
  findResultEvent,
  formatMark,
  formatMarkWithUnit,
  formatWind,
  parseMarkInput,
  parseWindInput,
  roundSlot,
  type AthleteResult,
  type MarkUnit,
  type RoundSlot,
  type Timing,
} from "@/lib/data/pr/marks"
import { deleteAthleteResult, type SeriesVerdict } from "@/lib/data/pr/results-data"

type ColumnKey = "mark" | "wind" | "place"
type CellState = { value: string; state: SaveStateValue; message: string | null }
type RowState = Record<ColumnKey, CellState>
type Callout = { key: string; tone: "success" | "warning"; text: string }

const UNIT_HINT: Record<MarkUnit, string> = { s: "time", m: "metres", cm: "centimetres", kg: "kilograms", pts: "points" }

function cellOf(value: string): CellState {
  return { value, state: "idle", message: null }
}

function rowFromResult(result: AthleteResult | null): RowState {
  return {
    mark: cellOf(result ? formatMark(result.value, result.unit, result.timing) : ""),
    wind: cellOf(result && result.wind !== null ? formatWind(result.wind) : ""),
    place: cellOf(result?.place ? String(result.place) : ""),
  }
}

/** What the saved mark means for the athlete, as one sentence for the coach. Null when it is nothing to call out. */
function calloutFor(name: string, saved: AthleteResult, verdict: SeriesVerdict): Callout | null {
  // A wind assisted series whose best legal jump is a best: the news is about that jump.
  const result = verdict.legal ?? saved
  const mark = markText(result)
  const gain = verdict.beat ? describeDifference(result, verdict.beat) : null
  const beat = gain && verdict.beat ? `, ${gain.text} than ${formatMarkWithUnit(verdict.beat.display, verdict.beat.unit)}` : ""
  if (verdict.kind === "personal-best") return { key: result.id, tone: "success", text: `Personal best for ${name} in the ${result.eventLabel}: ${mark}${beat}.` }
  if (verdict.kind === "first") return { key: result.id, tone: "success", text: `${name}'s first ${result.eventLabel} result, ${mark}, so it is a personal best.` }
  if (verdict.kind === "season-best") return { key: result.id, tone: "success", text: `Season best for ${name} in the ${result.eventLabel}: ${mark}${beat}.` }
  if (verdict.kind === "wind-assisted") return { key: result.id, tone: "warning", text: `${name}'s ${mark} is wind assisted (over +2.0). It is kept, but does not count as a best.` }
  return null
}

/** The result an entry has for one round of the grid. */
function slotResult(entry: CompetitionEntryWithResult, slot: RoundSlot): AthleteResult | null {
  return (entry.rounds ?? (entry.result ? [entry.result] : [])).find((result) => roundSlot(result.round) === slot) ?? null
}

/**
 * The results of a meet, typed down a grid: mark, wind where the event takes it, and place for
 * every entry. Each cell saves as you leave it; a personal or season best is called out as it is
 * saved. The grid shows one round at a time (`slot`: the final or only round unless the coach
 * picks heats, quarter finals or semi finals). Splits, attempts and heights are typed in the
 * detail of a row (`onOpenDetail`). `onSaved` hands the fresh result (or null when it was removed,
 * with the id of the one that went) back to the screen.
 */
export function ResultsGrid({
  competition,
  standings,
  slot = "final",
  avatarFor,
  onSaved,
  onOpenDetail,
}: {
  competition: CompetitionWithEntries
  standings: Record<string, EntryStanding>
  slot?: RoundSlot
  avatarFor: (athleteId: string) => string | null
  onSaved: (entryId: string, result: AthleteResult | null, standing: EntryStanding, removedResultId?: string) => void
  onOpenDetail?: (entryId: string) => void
}) {
  // By athlete, then by event, so the grid reads like the roster.
  const entries = useMemo(
    () =>
      competition.entries
        .filter((entry) => entry.status === "entered")
        .sort((a, b) => (a.athleteName ?? "").localeCompare(b.athleteName ?? "") || a.eventLabel.localeCompare(b.eventLabel, undefined, { numeric: true })),
    [competition.entries],
  )
  const [rows, setRows] = useState<Record<string, RowState>>(() => Object.fromEntries(entries.map((entry) => [entry.id, rowFromResult(slotResult(entry, slot))])))
  // The latest thing worth saying about a saved mark. One line: the rows keep "Personal best" for the rest.
  const [callout, setCallout] = useState<Callout | null>(null)
  const [saving, setSaving] = useState(0)
  const [failed, setFailed] = useState(false)
  const [savedOnce, setSavedOnce] = useState(false)
  // The truth between renders: what each row holds and the saved result of each entry. Two cells of
  // one row can be committed a moment apart (Tab, Tab), so the second must see what the first did.
  const valuesRef = useRef<Record<string, Record<ColumnKey, string>>>({})
  const resultsRef = useRef<Record<string, AthleteResult | null>>({})
  const queueRef = useRef<Record<string, Promise<void>>>({})
  for (const entry of entries) {
    if (!(entry.id in resultsRef.current)) {
      resultsRef.current[entry.id] = slotResult(entry, slot)
      const row = rowFromResult(slotResult(entry, slot))
      valuesRef.current[entry.id] = { mark: row.mark.value, wind: row.wind.value, place: row.place.value }
    }
  }

  // An entry added (or entered again) while the grid is open gets its row.
  useEffect(() => {
    setRows((current) => {
      const missing = entries.filter((entry) => !current[entry.id])
      return missing.length === 0 ? current : { ...current, ...Object.fromEntries(missing.map((entry) => [entry.id, rowFromResult(slotResult(entry, slot))])) }
    })
  }, [entries, slot])

  const windApplies = (entry: CompetitionEntryWithResult) => Boolean(findResultEvent(entry.eventKey)?.windApplies) && competition.environment === "outdoor"
  const unitOf = (entry: CompetitionEntryWithResult): MarkUnit | null => {
    const event = findResultEvent(entry.eventKey)
    return event && event.kind !== "other" ? event.unit : ((resultsRef.current[entry.id] ?? entry.result)?.unit ?? null)
  }
  /** True when the mark of this row is worked out from an attempt series or heights. */
  const fromSeries = (entryId: string) => {
    const detail = resultsRef.current[entryId]?.detail
    return Boolean(detail?.attempts?.length || detail?.heights?.length)
  }

  const setCell = (entryId: string, column: ColumnKey, cell: Partial<CellState>) => {
    if (cell.value !== undefined) valuesRef.current[entryId] = { ...(valuesRef.current[entryId] ?? { mark: "", wind: "", place: "" }), [column]: cell.value }
    setRows((current) => {
      const row = current[entryId] ?? rowFromResult(null)
      return { ...current, [entryId]: { ...row, [column]: { ...row[column], ...cell } } }
    })
  }

  const setRow = (entryId: string, result: AthleteResult | null, states?: Partial<Record<ColumnKey, SaveStateValue>>) => {
    const fresh = rowFromResult(result)
    resultsRef.current[entryId] = result
    valuesRef.current[entryId] = { mark: fresh.mark.value, wind: fresh.wind.value, place: fresh.place.value }
    setRows((current) => ({
      ...current,
      [entryId]: {
        mark: { ...fresh.mark, state: states?.mark ?? "idle" },
        wind: { ...fresh.wind, state: states?.wind ?? "idle" },
        place: { ...fresh.place, state: states?.place ?? "idle" },
      },
    }))
  }

  const refuse = (entryId: string, column: ColumnKey, text: string, message: string) => {
    setCell(entryId, column, { value: text, state: "error", message })
    setFailed(true)
  }

  // One save at a time per row, in the order the cells were left.
  const commit = (entryId: string, column: ColumnKey, text: string) => {
    // Shown at once, so the cell never flashes back to the old value while it waits its turn.
    setCell(entryId, column, { value: text, state: "saving", message: null })
    const run = (queueRef.current[entryId] ?? Promise.resolve()).then(() => commitNow(entryId, column, text))
    queueRef.current[entryId] = run.catch(() => undefined)
  }

  const commitNow = async (entryId: string, column: ColumnKey, text: string) => {
    const listed = entries.find((item) => item.id === entryId)
    if (!listed) return
    const existing = resultsRef.current[entryId] ?? null
    const entry: CompetitionEntryWithResult = { ...listed, result: existing }
    const next = { ...(valuesRef.current[entryId] ?? { mark: "", wind: "", place: "" }), [column]: text }

    if (column === "wind" && text && !windApplies(entry)) {
      refuse(entryId, column, text, competition.environment === "indoor" ? "Wind is not recorded indoors." : `No wind reading is taken for the ${entry.eventLabel}.`)
      return
    }
    const unit = unitOf(entry)
    if (!unit) {
      refuse(entryId, column, text, `The ${entry.eventLabel} is not on the event list, so the app does not know what it is measured in. Record this one from the athlete's own competition screen.`)
      return
    }

    // A mark that comes from attempts or heights is changed there, never typed over.
    if (fromSeries(entryId) && next.mark.trim() && (column === "mark" || column === "wind")) {
      const shown = rowFromResult(existing)
      setCell(entryId, column, { value: shown[column].value, state: "error", message: `This ${column} comes from the ${existing?.detail?.heights ? "heights" : "attempts"} typed for this result. Open Rounds and detail to change them.` })
      setFailed(true)
      return
    }

    // Wind or place typed before the mark: kept in the row, saved together with the mark.
    if (!next.mark.trim()) {
      if (column === "mark" && entry.result) {
        setCell(entryId, "mark", { value: "", state: "saving", message: null })
        setSaving((count) => count + 1)
        const removed = await deleteAthleteResult(entry.result.id)
        setSaving((count) => count - 1)
        if (!removed.ok) {
          refuse(entryId, "mark", "", removed.error.message)
          return
        }
        setRow(entryId, null)
        setSavedOnce(true)
        onSaved(entryId, null, null, entry.result.id)
        return
      }
      setCell(entryId, column, { value: text, state: "idle", message: null })
      return
    }

    // "10.6h" is a hand time.
    const hand = unit === "s" && /h$/i.test(next.mark.trim())
    const parsedMark = parseMarkInput(hand ? next.mark.trim().slice(0, -1) : next.mark, unit)
    if (!parsedMark.ok) {
      refuse(entryId, "mark", next.mark, parsedMark.message)
      if (column !== "mark") setCell(entryId, column, { value: text, state: "idle", message: null })
      return
    }
    const parsedWind = windApplies(entry) ? parseWindInput(next.wind) : { ok: true as const, value: null }
    if (!parsedWind.ok) {
      refuse(entryId, "wind", next.wind, parsedWind.message)
      if (column !== "wind") setCell(entryId, column, { value: text, state: "idle", message: null })
      return
    }
    const placeText = next.place.trim()
    const place = placeText ? Number(placeText) : null
    if (place !== null && (!Number.isInteger(place) || place < 1 || place > 999)) {
      refuse(entryId, "place", next.place, "Place is a whole number, like 2.")
      if (column !== "place") setCell(entryId, column, { value: text, state: "idle", message: null })
      return
    }

    const timing: Timing | null = unit === "s" ? (hand ? "hand" : (entry.result?.timing ?? "electronic")) : null
    setCell(entryId, column, { value: text, state: "saving", message: null })
    setSaving((count) => count + 1)
    const saved = await saveCompetitionEntryResultForStaff(entry, competition, {
      value: parsedMark.value,
      timing: column === "mark" && unit === "s" ? (hand ? "hand" : "electronic") : timing,
      wind: parsedWind.value,
      place,
      date: entry.result?.date ?? null,
      // A new result takes the round the grid is on; a correction keeps the round it has.
      ...(entry.result ? {} : { round: slot === "final" ? null : slot }),
    })
    setSaving((count) => count - 1)
    if (!saved.ok) {
      refuse(entryId, column, text, saved.error.message)
      return
    }
    const { result, verdict } = saved.data
    setRow(entryId, result, { mark: "saved", wind: result.wind !== null ? "saved" : "idle", place: result.place ? "saved" : "idle" })
    setSavedOnce(true)
    setFailed(false)
    const standing: EntryStanding = verdict.kind === "personal-best" || verdict.kind === "first" ? "personal-best" : verdict.kind === "season-best" ? "season-best" : null
    onSaved(entryId, result, standing)
    const said = calloutFor(entry.athleteName ?? "This athlete", result, verdict)
    if (said) setCallout(said)
  }

  const cell = (rowKey: string, columnKey: string): EntryGridCell => {
    const current = rows[rowKey]?.[columnKey as ColumnKey]
    return current ? { value: current.value, state: current.state, message: current.message } : { value: "" }
  }

  const validate = (columnKey: string, text: string): string | null => {
    if (columnKey === "place") return /^\d{1,3}$/.test(text) && Number(text) >= 1 ? null : "Place is a whole number, like 2."
    if (columnKey === "wind") {
      const parsed = parseWindInput(text)
      return parsed.ok ? null : parsed.message
    }
    return null
  }

  const overall: SaveStateValue = saving > 0 ? "saving" : failed ? "error" : savedOnce ? "saved" : "idle"

  return (
    <div className="flex flex-col gap-3">
      {callout ? (
        <div data-result-callout>
          <Notice key={callout.key} tone={callout.tone}>
            {callout.text}
          </Notice>
        </div>
      ) : null}
      <EntryGrid
        caption={`Results of ${competition.name}`}
        rowHeader="Athlete and event"
        rows={entries.map((entry) => {
          const shown = rows[entry.id] ? (resultsRef.current[entry.id] ?? null) : slotResult(entry, slot)
          const standing = shown ? (shown.id in standings ? standings[shown.id] : slot === "final" ? standings[entry.id] : null) : null
          const unit = unitOf(entry)
          const roundCount = entry.rounds?.length ?? 0
          return {
            key: entry.id,
            label: `${entry.athleteName ?? "Athlete"}, ${entry.eventLabel}`,
            header: (
              <span className="flex items-center gap-3 py-1" data-entry-row={entry.id}>
                <Avatar name={entry.athleteName ?? "Athlete"} src={avatarFor(entry.athleteId)} size="sm" className="hidden sm:inline-flex" />
                <span className="min-w-0">
                  {entry.athleteName ?? "Athlete"}
                  <TableSub>
                    {entry.eventLabel}
                    {unit && unit !== "s" ? `, ${UNIT_HINT[unit]}` : ""}
                  </TableSub>
                  {standing ? (
                    <span className="mt-0.5 block text-sm">
                      <StatusText tone={standing === "personal-best" ? "green" : "blue"}>{standing === "personal-best" ? "Personal best" : "Season best"}</StatusText>
                    </span>
                  ) : shown && !shown.windLegal ? (
                    <span className="mt-0.5 block text-sm">
                      <StatusText tone="amber">Wind assisted</StatusText>
                    </span>
                  ) : null}
                  {onOpenDetail ? (
                    <button type="button" className="sk-link mt-0.5 block text-sm" aria-label={`Rounds and detail for ${entry.athleteName ?? "athlete"}, ${entry.eventLabel}`} onClick={() => onOpenDetail(entry.id)}>
                      {roundCount > 1 ? `${roundCount} rounds, detail` : "Rounds and detail"}
                    </button>
                  ) : null}
                </span>
              </span>
            ),
          }
        })}
        columns={[
          { key: "mark", header: "Mark" },
          { key: "wind", header: "Wind", sub: "m/s" },
          { key: "place", header: "Place" },
        ]}
        cell={cell}
        onCommit={(rowKey, columnKey, text) => commit(rowKey, columnKey as ColumnKey, text)}
        validate={validate}
      />
      <SaveState state={overall}>{overall === "error" ? "One result was not saved. Tap the cell to see why." : overall === "saved" ? "All results saved" : undefined}</SaveState>
    </div>
  )
}
