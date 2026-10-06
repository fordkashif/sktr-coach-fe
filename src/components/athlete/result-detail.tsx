"use client"

import { useState } from "react"
import { Plus, X } from "@phosphor-icons/react"
import { ordinal } from "@/components/athlete/results-parts"
import { Button, CompactTable, Field, Input, Segmented, Select, StatusText } from "@/components/sk"
import {
  applyResultDetail,
  checkSplits,
  defaultSplitEvery,
  describeRound,
  detailKindsFor,
  eventDistance,
  formatAttempt,
  formatLapChange,
  formatMark,
  formatReaction,
  formatWind,
  MAX_ATTEMPTS,
  normaliseTries,
  parseAttemptInput,
  parseMarkInput,
  parseReactionInput,
  parseWindInput,
  RESULT_ROUNDS,
  splitRows,
  summariseHeights,
  summariseSeries,
  toLapSplits,
  toRunningSplits,
  type Attempt,
  type AthleteResult,
  type HeightLine,
  type MarkUnit,
  type Qualifier,
  type ResultDetail,
  type ResultRound,
  type SplitEntryMode,
} from "@/lib/data/pr/marks"
import { cn } from "@/lib/utils"

/**
 * The detail of a result: the round and lane, the splits of a race, the attempts of a jump or
 * throw, the heights of a high jump. One set of fields for every place a result is typed (the
 * athlete's own form, the result of a competition entry, the coach's detail dialog) and one view
 * for wherever it is shown. What is typed is kept as text in a DetailDraft until it is saved;
 * readDetailDraft() checks it in plain words and hands back the canonical detail.
 */

/* ---------- What is being typed ------------------------------------------------------------------- */

export type DetailDraft = {
  round: ResultRound | ""
  heat: string
  lane: string
  qualifier: Qualifier | ""
  reaction: string
  splitMode: SplitEntryMode
  /** Metres between splits. Null: the splits are just numbered. */
  splitEvery: number | null
  splits: string[]
  /** True while the mark is typed attempt by attempt (or height by height) instead of as one number. */
  series: boolean
  attempts: Array<{ text: string; wind: string }>
  heights: Array<{ height: string; tries: string }>
}

const EMPTY_ATTEMPT = { text: "", wind: "" }
const EMPTY_HEIGHT = { height: "", tries: "" }

type DetailSource = Pick<AthleteResult, "round" | "heat" | "lane" | "qualifier" | "detail">

/** The fields filled from a saved result, or empty for a new one. */
export function detailDraftFrom(result: DetailSource | null | undefined, eventKey: string): DetailDraft {
  const detail = result?.detail ?? null
  const attempts = (detail?.attempts ?? []).map((attempt) => ({
    text: formatAttempt(attempt),
    wind: attempt.result === "mark" && attempt.wind !== null && attempt.wind !== undefined ? formatWind(attempt.wind) : "",
  }))
  const heights = (detail?.heights ?? []).map((line) => ({ height: formatMark(line.height, "m"), tries: line.tries }))
  return {
    round: result?.round ?? "",
    heat: result?.heat ? String(result.heat) : "",
    lane: result?.lane ? String(result.lane) : "",
    qualifier: result?.qualifier ?? "",
    reaction: detail?.reaction !== undefined ? formatReaction(detail.reaction) : "",
    splitMode: "running",
    splitEvery: detail?.splits ? detail.splits.every : defaultSplitEvery(eventKey),
    splits: (detail?.splits?.times ?? []).map((time) => formatMark(time, "s")),
    series: attempts.length > 0 || heights.length > 0,
    attempts: [...attempts, ...Array.from({ length: Math.max(0, MAX_ATTEMPTS - attempts.length) }, () => ({ ...EMPTY_ATTEMPT }))],
    heights: heights.length > 0 ? heights : [{ ...EMPTY_HEIGHT }, { ...EMPTY_HEIGHT }, { ...EMPTY_HEIGHT }],
  }
}

export type DetailErrors = Partial<Record<"heat" | "lane" | "reaction" | "splits" | "series", string>>

export type DetailReading =
  | {
      ok: true
      round: ResultRound | null
      heat: number | null
      lane: number | null
      qualifier: Qualifier | null
      detail: ResultDetail | null
      /** True when the mark comes from the attempts or heights. */
      series: boolean
      /** The mark and wind worked out from a series. Null without one. */
      mark: number | null
      wind: number | null
    }
  | { ok: false; errors: DetailErrors }

function wholeNumber(text: string, max: number): number | null | "bad" {
  const raw = text.trim()
  if (!raw) return null
  if (!/^\d{1,3}$/.test(raw)) return "bad"
  const value = Number(raw)
  return value >= 1 && value <= max ? value : "bad"
}

/**
 * Reads what was typed. `finalTime` is the mark of a timed result when it is known, so that a
 * split larger than it can be refused. Errors are worded for the person and say which attempt,
 * height or split is wrong.
 */
export function readDetailDraft(draft: DetailDraft, context: { eventKey: string; unit: MarkUnit; windApplies: boolean; finalTime: number | null }): DetailReading {
  const errors: DetailErrors = {}
  const kinds = detailKindsFor(context.eventKey, context.unit)
  const timed = context.unit === "s"

  const heat = timed ? wholeNumber(draft.heat, 99) : null
  if (heat === "bad") errors.heat = "A whole number, like 2."
  const lane = timed ? wholeNumber(draft.lane, 20) : null
  if (lane === "bad") errors.lane = "A whole number, like 4."

  const detail: ResultDetail = {}

  if (kinds.reaction) {
    const reaction = parseReactionInput(draft.reaction)
    if (!reaction.ok) errors.reaction = reaction.message
    else if (reaction.value !== null) detail.reaction = reaction.value
  }

  if (kinds.splits) {
    const values: number[] = []
    draft.splits.forEach((text, index) => {
      if (!text.trim() || errors.splits) return
      const parsed = parseMarkInput(text, "s")
      if (!parsed.ok) errors.splits = `Split ${index + 1}: ${parsed.message}`
      else values.push(parsed.value)
    })
    if (!errors.splits && values.length > 0) {
      const running = toRunningSplits(values, draft.splitMode)
      const problem = checkSplits(running, context.finalTime)
      if (problem) errors.splits = draft.splitMode === "lap" && /is larger than the final time/.test(problem) ? `The laps add up to more than the final time (${context.finalTime !== null ? formatMark(context.finalTime, "s") : ""}). A split cannot be larger than the final time.` : problem
      else detail.splits = { every: draft.splitEvery, times: running }
    }
  }

  if (draft.series && kinds.attempts) {
    const rows = [...draft.attempts]
    while (rows.length > 0 && !rows[rows.length - 1].text.trim()) rows.pop()
    const attempts: Attempt[] = []
    rows.forEach((row, index) => {
      if (errors.series) return
      const parsed = parseAttemptInput(row.text)
      if (!parsed.ok) {
        errors.series = `Attempt ${index + 1}: ${parsed.message}`
      } else if (parsed.attempt === null) {
        errors.series = `Attempt ${index + 1} is empty. Tap X for a foul or the dash for a pass.`
      } else if (parsed.attempt.result === "mark" && context.windApplies) {
        const wind = parseWindInput(row.wind)
        if (!wind.ok) errors.series = `Wind of attempt ${index + 1}: ${wind.message}`
        else attempts.push(wind.value === null ? parsed.attempt : { ...parsed.attempt, wind: wind.value })
      } else {
        attempts.push(parsed.attempt)
      }
    })
    if (!errors.series) {
      if (attempts.length === 0) errors.series = "Enter at least one attempt, or switch back to typing the best mark."
      else detail.attempts = attempts
    }
  }

  if (draft.series && kinds.heights) {
    const heights: HeightLine[] = []
    draft.heights.forEach((row) => {
      if (errors.series || (!row.height.trim() && !row.tries.trim())) return
      const height = parseMarkInput(row.height, "m")
      const tries = normaliseTries(row.tries)
      if (!height.ok || height.value >= 10) errors.series = `Write each height in metres, like 1.85. "${row.height.trim() || "empty"}" is not one.`
      else if (!tries) errors.series = `At ${formatMark(height.value, "m")}: write the attempts with O, X and the dash, like O, XO or XXX.`
      else heights.push({ height: height.value, tries })
    })
    if (!errors.series) {
      if (heights.length === 0) errors.series = "Enter at least one height, or switch back to typing the best height."
      else detail.heights = heights
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const applied = applyResultDetail(detail, { eventKey: context.eventKey, unit: context.unit, windApplies: context.windApplies, mark: context.finalTime })
  if (!applied.ok) return { ok: false, errors: /split/i.test(applied.message) ? { splits: applied.message } : /reaction/i.test(applied.message) ? { reaction: applied.message } : { series: applied.message } }

  return {
    ok: true,
    round: draft.round || null,
    heat: heat as number | null,
    lane: lane as number | null,
    qualifier: draft.round === "heat" || draft.round === "quarter_final" || draft.round === "semi_final" ? draft.qualifier || null : null,
    detail: applied.detail,
    series: applied.series,
    mark: applied.series ? applied.mark : null,
    wind: applied.series ? applied.wind : null,
  }
}

/* ---------- Fields: round, heat, lane ------------------------------------------------------------- */

/**
 * Round, and for races the heat and lane. The qualifier (Q or q) shows for a round someone can
 * go through from. `taken` rounds are already recorded for this entry and cannot be picked again.
 */
export function RoundFields({
  draft,
  onChange,
  errors,
  timed,
  taken = [],
}: {
  draft: DetailDraft
  onChange: (patch: Partial<DetailDraft>) => void
  errors?: DetailErrors
  /** A race: heat and lane apply. */
  timed: boolean
  taken?: Array<ResultRound | null>
}) {
  const canQualify = draft.round === "heat" || draft.round === "quarter_final" || draft.round === "semi_final"
  const decidingTaken = taken.some((round) => round === null || round === "final" || round === "timed_final")
  const isTaken = (round: ResultRound | null) => (round === null || round === "final" || round === "timed_final" ? decidingTaken : taken.includes(round))
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
      <Field label="Round" className="col-span-2" hint={taken.length > 0 ? "Each round is kept as its own result." : undefined}>
        <Select value={draft.round} onChange={(event) => onChange({ round: event.target.value as ResultRound | "" })}>
          <option value="" disabled={isTaken(null)}>
            One round, or not sure
          </option>
          {RESULT_ROUNDS.map((round) => (
            <option key={round.value} value={round.value} disabled={isTaken(round.value)}>
              {round.label}
              {isTaken(round.value) ? " (recorded)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      {timed ? (
        <>
          <Field label="Heat" optional error={errors?.heat}>
            <Input value={draft.heat} inputMode="numeric" autoComplete="off" placeholder="2" onChange={(event) => onChange({ heat: event.target.value })} />
          </Field>
          <Field label="Lane" optional error={errors?.lane}>
            <Input value={draft.lane} inputMode="numeric" autoComplete="off" placeholder="4" onChange={(event) => onChange({ lane: event.target.value })} />
          </Field>
        </>
      ) : null}
      {canQualify ? (
        <Field label="Went through" optional className="col-span-2" hint="Q is on place, q is on time.">
          <Select value={draft.qualifier} onChange={(event) => onChange({ qualifier: event.target.value as Qualifier | "" })}>
            <option value="">Not recorded</option>
            <option value="Q">Q, on place</option>
            <option value="q">q, on time</option>
          </Select>
        </Field>
      ) : null}
    </div>
  )
}

/* ---------- Fields: attempts of a horizontal jump or a throw ---------------------------------------- */

const SQUARE = "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[12px] border text-base font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
const SQUARE_OFF = "border-sk-line-strong bg-white text-sk-ink hover:border-sk-blue"
const SQUARE_ON = "border-sk-blue bg-sk-blue text-white"

function readAttempts(rows: DetailDraft["attempts"], windApplies: boolean): Attempt[] {
  const attempts: Attempt[] = []
  for (const row of rows) {
    const parsed = parseAttemptInput(row.text)
    if (!parsed.ok || parsed.attempt === null) continue
    const wind = windApplies ? parseWindInput(row.wind) : null
    attempts.push(parsed.attempt.result === "mark" && wind?.ok && wind.value !== null ? { ...parsed.attempt, wind: wind.value } : parsed.attempt)
  }
  return attempts
}

/** "Best so far: 6.71 (+2.9), wind assisted. 6.60 (+0.4) is the mark that counts for records." */
function SeriesSummary({ attempts }: { attempts: Attempt[] }) {
  const summary = summariseSeries(attempts)
  if (summary.bestIndex === null) return <p className="sk-field-hint">The best attempt becomes the mark. You do not type it again.</p>
  const text = (attempt: Attempt) => (attempt.result === "mark" ? `${formatMark(attempt.mark, "m")}m${attempt.wind !== null && attempt.wind !== undefined ? ` (${formatWind(attempt.wind)})` : ""}` : "")
  const best = attempts[summary.bestIndex]
  const assisted = best.result === "mark" && best.wind !== null && best.wind !== undefined && best.wind > 2
  return (
    <p className="text-sm text-sk-ink" data-series-summary>
      <span className="font-bold">Mark: {text(best)}</span>
      {assisted
        ? summary.legalIndex !== null
          ? `. Wind assisted, so ${text(attempts[summary.legalIndex])} is the jump that counts for records.`
          : ". Wind assisted, and no other jump was wind legal, so it does not count for records."
        : "."}
    </p>
  )
}

/** Up to six attempts, each a distance, a foul (X) or a pass (-), with the wind where it is read. */
export function SeriesEditor({
  draft,
  onChange,
  windApplies,
  error,
}: {
  draft: DetailDraft
  onChange: (patch: Partial<DetailDraft>) => void
  windApplies: boolean
  error?: string
}) {
  const lastFilled = draft.attempts.reduce((last, row, index) => (row.text.trim() ? index : last), -1)
  const [shown, setShown] = useState(lastFilled >= 3 ? MAX_ATTEMPTS : 3)
  const setRow = (index: number, patch: Partial<{ text: string; wind: string }>) =>
    onChange({ attempts: draft.attempts.map((row, position) => (position === index ? { ...row, ...patch } : row)) })
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Attempts">
      <p className="sk-field-label">Attempts</p>
      <p className="sk-field-hint">
        Type each distance in metres. Tap X for a foul and the dash for a pass.{windApplies ? " Add the wind of each jump if it was read." : ""}
      </p>
      {draft.attempts.slice(0, shown).map((row, index) => {
        const mark = row.text.trim().toUpperCase()
        return (
          <div key={index} className="flex items-center gap-1.5">
            <span className="w-3.5 shrink-0 text-sm font-semibold text-sk-mute" aria-hidden>
              {index + 1}
            </span>
            <input
              className="sk-field min-w-0 flex-1 px-2 text-center text-lg font-bold tabular-nums"
              aria-label={`Attempt ${index + 1}`}
              value={row.text}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="next"
              placeholder={index === 0 ? "6.42" : ""}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setRow(index, { text: event.target.value })}
            />
            {windApplies ? (
              <input
                className="sk-field w-[4.25rem] shrink-0 px-1.5 text-center tabular-nums"
                aria-label={`Wind of attempt ${index + 1}`}
                value={row.wind}
                inputMode="text"
                autoComplete="off"
                placeholder={index === 0 ? "+1.2" : ""}
                disabled={mark === "X" || mark === "-"}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setRow(index, { wind: event.target.value })}
              />
            ) : null}
            <button type="button" className={cn(SQUARE, mark === "X" ? SQUARE_ON : SQUARE_OFF)} aria-label={`Attempt ${index + 1} was a foul`} aria-pressed={mark === "X"} onClick={() => setRow(index, mark === "X" ? { text: "" } : { text: "X", wind: "" })}>
              X
            </button>
            <button type="button" className={cn(SQUARE, mark === "-" ? SQUARE_ON : SQUARE_OFF)} aria-label={`Attempt ${index + 1} was a pass`} aria-pressed={mark === "-"} onClick={() => setRow(index, mark === "-" ? { text: "" } : { text: "-", wind: "" })}>
              <span aria-hidden>-</span>
            </button>
          </div>
        )
      })}
      {shown < MAX_ATTEMPTS ? (
        <Button variant="quiet" size="sm" className="self-start" onClick={() => setShown(MAX_ATTEMPTS)}>
          <Plus className="size-[18px]" weight="bold" aria-hidden />
          Attempts 4 to 6
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="sk-field-error">
          {error}
        </p>
      ) : (
        <SeriesSummary attempts={readAttempts(draft.attempts, windApplies)} />
      )}
    </div>
  )
}

/* ---------- Fields: heights of a vertical jump -------------------------------------------------------- */

function readHeights(rows: DetailDraft["heights"]): HeightLine[] {
  const lines: HeightLine[] = []
  for (const row of rows) {
    const height = parseMarkInput(row.height, "m")
    const tries = normaliseTries(row.tries)
    if (height.ok && tries) lines.push({ height: height.value, tries })
  }
  return lines
}

/** "Mark: 1.85m, cleared on the 2nd attempt. Failures at 1.85: 1. Failures in all up to there: 1." */
export function heightsSentence(heights: HeightLine[]): string | null {
  const summary = summariseHeights(heights)
  if (summary.best === null || summary.clearedOnAttempt === null) return null
  return `Cleared on the ${ordinal(summary.clearedOnAttempt)} attempt. For a tie: ${summary.failuresAtBest} ${summary.failuresAtBest === 1 ? "failure" : "failures"} at ${formatMark(summary.best, "m")}, ${summary.totalFailures} in all up to that height.`
}

/** Heights going up, each with what happened at it: O cleared, X failed, dash passed. */
export function HeightsEditor({ draft, onChange, error }: { draft: DetailDraft; onChange: (patch: Partial<DetailDraft>) => void; error?: string }) {
  const setRow = (index: number, patch: Partial<{ height: string; tries: string }>) =>
    onChange({ heights: draft.heights.map((row, position) => (position === index ? { ...row, ...patch } : row)) })
  const press = (index: number, letter: "O" | "X" | "-") => {
    const current = draft.heights[index].tries.toUpperCase()
    // A height is finished once it is cleared, passed or failed three times: the next tap starts it again.
    const done = current.endsWith("O") || current.endsWith("-") || current.length >= 3
    setRow(index, { tries: `${done ? "" : current}${letter}` })
  }
  const lines = readHeights(draft.heights)
  const summary = summariseHeights(lines)
  const sentence = heightsSentence(lines)
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Heights">
      <p className="sk-field-label">Heights</p>
      <p className="sk-field-hint">The bar in metres, then each attempt at it: O for over, X for a failure, the dash for a pass. Tap the letters to start a height again.</p>
      {draft.heights.map((row, index) => {
        const name = row.height.trim() || `height ${index + 1}`
        return (
          <div key={index} className="flex items-center gap-1.5">
            <input
              className="sk-field w-[5.25rem] shrink-0 px-2 text-center text-lg font-bold tabular-nums"
              aria-label={`Height ${index + 1}`}
              value={row.height}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="next"
              placeholder={index === 0 ? "1.80" : ""}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setRow(index, { height: event.target.value })}
            />
            <input
              className="sk-field min-w-0 flex-1 px-1.5 text-center text-lg font-bold uppercase tracking-[0.08em]"
              aria-label={`Attempts at ${name}`}
              value={row.tries}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={3}
              placeholder="XO"
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setRow(index, { tries: event.target.value.toUpperCase().replace(/0/g, "O").replace(/[^OX-]/g, "") })}
            />
            <button type="button" className={cn(SQUARE, SQUARE_OFF)} aria-label={`Cleared ${name}`} onClick={() => press(index, "O")}>
              O
            </button>
            <button type="button" className={cn(SQUARE, SQUARE_OFF)} aria-label={`Failed at ${name}`} onClick={() => press(index, "X")}>
              X
            </button>
            <button type="button" className={cn(SQUARE, SQUARE_OFF)} aria-label={`Passed ${name}`} onClick={() => press(index, "-")}>
              <span aria-hidden>-</span>
            </button>
          </div>
        )
      })}
      <Button variant="quiet" size="sm" className="self-start" disabled={draft.heights.length >= 30} onClick={() => onChange({ heights: [...draft.heights, { ...EMPTY_HEIGHT }] })}>
        <Plus className="size-[18px]" weight="bold" aria-hidden />
        Add a height
      </Button>
      {error ? (
        <p role="alert" className="sk-field-error">
          {error}
        </p>
      ) : summary.best !== null ? (
        <p className="text-sm text-sk-ink" data-series-summary>
          <span className="font-bold">Mark: {formatMark(summary.best, "m")}m.</span> {sentence}
        </p>
      ) : (
        <p className="sk-field-hint">The highest height cleared becomes the mark. You do not type it again.</p>
      )}
    </div>
  )
}

/* ---------- Fields: splits and reaction time -------------------------------------------------------- */

const SPLIT_DISTANCES = [100, 200, 400, 1000, 5000]

/** Seconds only need digits; anything that can pass a minute needs the colon, so the full keyboard. */
function timeKeyboard(eventKey: string): "decimal" | "text" {
  const distance = eventDistance(eventKey)
  return distance !== null && distance <= 400 ? "decimal" : "text"
}

/** The splits of a race as a list of times, typed as running times or lap by lap. */
export function SplitsEditor({
  draft,
  onChange,
  eventKey,
  finalTime,
  error,
}: {
  draft: DetailDraft
  onChange: (patch: Partial<DetailDraft>) => void
  eventKey: string
  /** The result's time when it is typed and readable. */
  finalTime: number | null
  error?: string
}) {
  const rows = draft.splits.length > 0 ? draft.splits : [""]
  const setRow = (index: number, text: string) => onChange({ splits: rows.map((row, position) => (position === index ? text : row)) })
  const distance = eventDistance(eventKey)
  const options = SPLIT_DISTANCES.filter((every) => distance === null || every < distance)
  const label = (index: number) => (draft.splitEvery ? `${draft.splitEvery * (index + 1)}m` : `Split ${index + 1}`)

  // Switching how splits are typed rewrites what is already there, so nothing has to be typed twice.
  const switchMode = (mode: SplitEntryMode) => {
    if (mode === draft.splitMode) return
    const parsed = rows.map((text) => (text.trim() ? parseMarkInput(text, "s") : null))
    if (parsed.some((item) => item !== null && !item.ok) || parsed.some((item, index) => item === null && parsed.slice(index + 1).some(Boolean))) {
      onChange({ splitMode: mode })
      return
    }
    const values = parsed.filter((item): item is { ok: true; value: number } => item !== null && item.ok).map((item) => item.value)
    const converted = mode === "lap" ? toLapSplits(toRunningSplits(values, "running")) : toRunningSplits(values, "lap")
    onChange({ splitMode: mode, splits: converted.every((value) => value > 0) ? converted.map((value) => formatMark(value, "s")) : rows })
  }

  // What the typed splits come to, said back: the laps and how each compares with the one before.
  const typed = rows.filter((text) => text.trim()).map((text) => parseMarkInput(text, "s"))
  const values = typed.every((item) => item.ok) ? typed.map((item) => (item.ok ? item.value : 0)) : null
  const running = values && values.length > 0 ? toRunningSplits(values, draft.splitMode) : null
  const preview = running && finalTime !== null && !checkSplits(running, finalTime) ? splitRows({ every: draft.splitEvery, times: running }, finalTime, eventKey) : null

  return (
    <div className="flex flex-col gap-2.5" role="group" aria-label="Splits">
      <p className="sk-field-label">
        Splits<span className="font-normal text-sk-mute"> (optional)</span>
      </p>
      <Segmented
        label="How the splits are typed"
        value={draft.splitMode}
        onChange={switchMode}
        className="self-start"
        options={[
          { value: "running", label: "Running time" },
          { value: "lap", label: "Each lap" },
        ]}
      />
      <p className="sk-field-hint">
        {draft.splitMode === "running" ? "The time on the clock at each point, like 24.10 then 49.80." : "The time of each lap on its own, like 24.10 then 25.70."} Leave out the finish: that is the result.
      </p>
      {options.length > 0 ? (
        <Field label="A split every">
          <Select value={draft.splitEvery === null ? "" : String(draft.splitEvery)} onChange={(event) => onChange({ splitEvery: event.target.value ? Number(event.target.value) : null })}>
            <option value="">No fixed distance</option>
            {options.map((every) => (
              <option key={every} value={every}>
                {every}m
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {rows.map((text, index) => (
        <div key={index} className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-sm font-semibold text-sk-mute" aria-hidden>
            {label(index)}
          </span>
          <input
            className="sk-field min-w-0 flex-1 px-2 text-center text-lg font-bold tabular-nums"
            aria-label={`${draft.splitMode === "lap" ? "Lap" : "Split"} ${index + 1}${draft.splitEvery ? `, at ${label(index)}` : ""}`}
            value={text}
            inputMode={timeKeyboard(eventKey)}
            autoComplete="off"
            enterKeyHint="next"
            placeholder={draft.splitMode === "lap" ? "25.70" : "24.10"}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setRow(index, event.target.value)}
          />
          <button type="button" className="sk-icon-btn" aria-label={`Remove split ${index + 1}`} onClick={() => onChange({ splits: rows.filter((_, position) => position !== index) })}>
            <X className="size-[18px]" weight="bold" aria-hidden />
          </button>
        </div>
      ))}
      <Button variant="quiet" size="sm" className="self-start" disabled={rows.length >= 40} onClick={() => onChange({ splits: [...rows, ""] })}>
        <Plus className="size-[18px]" weight="bold" aria-hidden />
        Add a split
      </Button>
      {error ? (
        <p role="alert" className="sk-field-error">
          {error}
        </p>
      ) : preview ? (
        <p className="text-sm text-sk-ink" data-splits-summary>
          <span className="font-bold">Laps:</span>{" "}
          {preview.map((row) => `${formatMark(row.lap, "s")}${row.change !== null ? ` (${formatLapChange(row.change)})` : ""}`).join(", ")}
        </p>
      ) : null}
    </div>
  )
}

export function ReactionField({ draft, onChange, error }: { draft: DetailDraft; onChange: (patch: Partial<DetailDraft>) => void; error?: string }) {
  return (
    <Field label="Reaction time" optional hint="From the blocks, in seconds, like 0.152." error={error}>
      <Input value={draft.reaction} inputMode="decimal" autoComplete="off" placeholder="0.152" onChange={(event) => onChange({ reaction: event.target.value })} />
    </Field>
  )
}

/* ---------- Showing the detail of a saved result ------------------------------------------------------ */

/** "Heat 2, lane 4, 3rd place, qualified on time (q)". Empty when nothing was recorded. */
export function roundLine(result: Pick<AthleteResult, "round" | "heat" | "lane" | "qualifier" | "place">): string {
  const round = describeRound({ round: result.round, heat: result.heat, lane: result.lane })
  const qualifier = result.qualifier ? (result.qualifier === "Q" ? "qualified on place (Q)" : "qualified on time (q)") : ""
  const text = [round, result.place ? `${ordinal(result.place)} place` : "", qualifier].filter(Boolean).join(", ")
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ""
}

/** True when ResultDetailView has something to show for this result. */
export function hasDetailToShow(result: Pick<AthleteResult, "round" | "heat" | "lane" | "qualifier" | "detail" | "derivedFromResultId">): boolean {
  const detail = result.detail
  return Boolean(result.round || result.heat || result.lane || result.qualifier || detail?.splits || detail?.reaction !== undefined || detail?.attempts?.length || detail?.heights?.length || result.derivedFromResultId)
}

/**
 * Everything a result carries beyond its mark, read only: the round line, the reaction time, the
 * splits as a table with each lap and how it compares with the one before, the attempt series, the
 * heights with the two tie-break counts. `legalMark` is the wind legal attempt that counts for
 * records when the best attempt of the series was wind assisted.
 */
export function ResultDetailView({ result, legalMark, className }: { result: AthleteResult; legalMark?: AthleteResult | null; className?: string }) {
  const detail = result.detail ?? null
  const line = roundLine(result)
  const series = detail?.attempts ? summariseSeries(detail.attempts) : null
  const showWind = Boolean(detail?.attempts?.some((attempt) => attempt.result === "mark" && attempt.wind !== null && attempt.wind !== undefined))
  const heights = detail?.heights ?? null
  const heightsSummary = heights ? summariseHeights(heights) : null
  return (
    <div className={cn("flex flex-col gap-3", className)} data-result-detail={result.id}>
      {result.derivedFromResultId ? (
        <p className="text-sm text-sk-mute">The best wind legal jump of a series whose longest jump was wind assisted. It is the one that counts for records. To change it, change the series.</p>
      ) : null}
      {line || detail?.reaction !== undefined ? (
        <p className="text-sm text-sk-ink-2">{[line, detail?.reaction !== undefined ? `Reaction time ${formatReaction(detail.reaction)}s` : ""].filter(Boolean).join(". ")}.</p>
      ) : null}

      {detail?.splits && result.unit === "s" ? (
        <CompactTable
          caption={`Splits of the ${result.eventLabel} in ${result.display}`}
          columns={[
            { key: "point", header: "Split", cell: (row) => row.label },
            { key: "time", header: "Time", align: "right", cell: (row) => formatMark(row.time, "s") },
            { key: "lap", header: "Lap", align: "right", strong: true, cell: (row) => formatMark(row.lap, "s") },
            {
              key: "change",
              header: "Change",
              align: "right",
              cell: (row) => (row.change === null ? <span className="text-sk-faint">None</span> : row.change === 0 ? "Same" : `${formatLapChange(row.change)}s`),
            },
          ]}
          rows={splitRows(detail.splits, result.value, result.eventKey)}
          rowKey={(row) => row.label}
        />
      ) : null}

      {detail?.attempts && series ? (
        <CompactTable
          caption={`Attempts in the ${result.eventLabel}`}
          columns={[
            { key: "attempt", header: "Attempt", cell: (row: { attempt: Attempt; index: number }) => row.index + 1 },
            {
              key: "mark",
              header: "Mark",
              align: "right",
              cell: (row) => (row.attempt.result === "mark" ? `${formatMark(row.attempt.mark, "m")}m` : row.attempt.result === "foul" ? "X (foul)" : "- (pass)"),
            },
            ...(showWind
              ? [
                  {
                    key: "wind",
                    header: "Wind",
                    align: "right" as const,
                    cell: (row: { attempt: Attempt; index: number }) => (row.attempt.result === "mark" && row.attempt.wind !== null && row.attempt.wind !== undefined ? formatWind(row.attempt.wind) : ""),
                  },
                ]
              : []),
            {
              key: "note",
              header: "Counts as",
              cell: (row) =>
                row.index === series.bestIndex ? (
                  series.legalIndex !== null || !result.windLegal ? "Best, wind assisted" : "Best"
                ) : row.index === series.legalIndex ? (
                  <StatusText tone="green">Best wind legal</StatusText>
                ) : (
                  ""
                ),
            },
          ]}
          rows={detail.attempts.map((attempt, index) => ({ attempt, index }))}
          rowKey={(row) => String(row.index)}
          rowMark={(row) => row.index === series.bestIndex}
          footer={
            series.legalIndex !== null
              ? `The longest jump had too much wind, so ${legalMark ? `${legalMark.display}m` : "the best wind legal jump"} is the mark that counts for records.`
              : undefined
          }
        />
      ) : null}

      {heights && heightsSummary ? (
        <CompactTable
          caption={`Heights in the ${result.eventLabel}`}
          columns={[
            { key: "height", header: "Height", cell: (row: { line: HeightLine; index: number }) => `${formatMark(row.line.height, "m")}m` },
            { key: "tries", header: "Attempts", cell: (row) => <span className="tracking-[0.08em]">{row.line.tries}</span> },
            {
              key: "outcome",
              header: "Outcome",
              cell: (row) => (row.line.tries.endsWith("O") ? "Cleared" : row.line.tries === "-" ? "Passed" : row.line.tries.endsWith("-") ? "Failed, then passed" : "Not cleared"),
            },
          ]}
          rows={heights.map((line, index) => ({ line, index }))}
          rowKey={(row) => String(row.index)}
          rowMark={(row) => row.index === heightsSummary.bestIndex}
          footer={heightsSentence(heights) ?? undefined}
        />
      ) : null}
    </div>
  )
}
