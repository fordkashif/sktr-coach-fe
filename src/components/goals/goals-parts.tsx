"use client"

import { useUndoableDelete } from "@/lib/use-undoable-delete"
import { useEffect, useMemo, useState, type FormEvent } from "react"
import { UNIT_WORDS } from "@/components/athlete/results-parts"
import { ActionRow, Button, Dialog, Field, FormGrid, InlineConfirm, Input, List, Meter, Notice, RowMenu, Select, StatusText, Textarea, notify, type RowMenuItem } from "@/components/sk"
import { currentBest, daysUntil, goalProgressPercent, goalState, remainingToTarget, type AthleteGoal, type GoalState } from "@/lib/data/goals/goal-logic"
import { addAthleteGoal, deleteAthleteGoal, setAthleteGoalAchieved, updateAthleteGoal, type AthleteGoalsView } from "@/lib/data/goals/goals-data"
import { formatMark, formatMarkWithUnit, groupResultsByEvent, RESULT_EVENTS, seasonFor, type AthleteResult, type MarkUnit } from "@/lib/data/pr/marks"
import { formatFullDay } from "@/lib/data/pr/pr-display"
import { localToday } from "@/lib/data/pr/results-data"
import type { Result } from "@/lib/data/result"
import { markEntryText, parseMarkForViewer, unitWordsForViewer, viewText } from "@/lib/units-view"

/** "11.10s", "6.60m", "190kg", "1:52.30". */
export function goalMarkText(value: number, unit: MarkUnit): string {
  return viewText(formatMarkWithUnit(formatMark(value, unit), unit))
}

/** A difference between two marks: "0.18s", "0.30m", "5kg". */
function amountText(value: number, unit: MarkUnit): string {
  if (unit === "s" && value < 60) return `${value.toFixed(2)}s`
  return goalMarkText(value, unit)
}

export type GoalProgress = {
  state: GoalState
  best: AthleteResult | null
  percent: number
  /** "Now 11.28s, 0.18s to go." */
  line: string
  /** "By Dec 4, 2026, 60 days left." */
  dateLine: string | null
}

/** Everything a goal row says, worked out from the athlete's results. */
export function describeGoal(goal: AthleteGoal, results: AthleteResult[], today: string): GoalProgress {
  const state = goalState(goal, today)
  const best = currentBest(results, goal.eventGroup, goal.lowerIsBetter)
  const percent = goal.achievedOn ? 100 : goalProgressPercent(goal.startValue, best?.compareValue ?? null, goal.targetValue, goal.lowerIsBetter)
  const bestText = best ? goalMarkText(best.compareValue, goal.unit) : null

  let line: string
  if (goal.achievedOn) {
    line = `${goal.achievedManually ? "Marked achieved" : "Reached"} on ${formatFullDay(goal.achievedOn)}.${bestText ? ` Best now ${bestText}.` : ""}`
  } else if (!best) {
    line = "No result in this event yet. The first one starts the line."
  } else {
    const left = remainingToTarget(best.compareValue, goal.targetValue, goal.lowerIsBetter)
    line = `Now ${bestText}, ${amountText(left, goal.unit)} to go. ${percent}% of the way${goal.startValue === null ? "" : ` from ${goalMarkText(goal.startValue, goal.unit)}`}.`
  }

  let dateLine: string | null = null
  if (goal.targetDate && !goal.achievedOn) {
    const days = daysUntil(goal.targetDate, today)
    dateLine =
      days < 0
        ? `Was due ${formatFullDay(goal.targetDate)}.`
        : days === 0
          ? `Due today, ${formatFullDay(goal.targetDate)}.`
          : `By ${formatFullDay(goal.targetDate)}, ${days} ${days === 1 ? "day" : "days"} left.`
  } else if (goal.targetDate) {
    dateLine = `Target date was ${formatFullDay(goal.targetDate)}.`
  }
  return { state, best, percent, line, dateLine }
}

type EventOption = { value: string; eventKey: string; label: string; unit: MarkUnit; lowerIsBetter: boolean; best: AthleteResult | null }

/** The events a goal can be set in: the athlete's own events and tests first, then the event list. */
function eventOptions(results: AthleteResult[]): { own: EventOption[]; listed: EventOption[] } {
  const own = groupResultsByEvent(results, seasonFor(localToday())).map((event) => ({
    value: event.group,
    eventKey: event.eventKey,
    label: event.label,
    unit: event.unit,
    lowerIsBetter: event.lowerIsBetter,
    best: event.bests.personalBest,
  }))
  const taken = new Set(own.map((option) => option.value))
  const listed = RESULT_EVENTS.filter((event) => event.kind !== "other" && event.unit && !taken.has(`k:${event.key}`)).map((event) => ({
    value: `k:${event.key}`,
    eventKey: event.key,
    label: event.name,
    unit: event.unit as MarkUnit,
    lowerIsBetter: Boolean(event.lowerIsBetter),
    best: null,
  }))
  return { own, listed }
}

/** Set a goal, or change one. `goal` null means a new goal. Remount it (with a key) each time it opens. */
export function GoalDialog({
  open,
  onOpenChange,
  view,
  goal,
  audience,
  athleteName,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  view: AthleteGoalsView
  goal: AthleteGoal | null
  audience: "athlete" | "staff"
  /** First name, for a coach's wording. */
  athleteName?: string
  onSaved: () => void
}) {
  const today = localToday()
  const options = useMemo(() => eventOptions(view.results), [view.results])
  const all = useMemo(() => [...options.own, ...options.listed], [options])
  const [eventValue, setEventValue] = useState(goal?.eventGroup ?? "")
  const [mark, setMark] = useState(goal ? markEntryText(goal.targetValue, goal.unit) : "")
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "")
  const [note, setNote] = useState(goal?.note ?? "")
  const [errors, setErrors] = useState<{ event?: string; mark?: string; date?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const chosen = goal
    ? { value: goal.eventGroup, eventKey: goal.eventKey, label: goal.eventLabel, unit: goal.unit, lowerIsBetter: goal.lowerIsBetter, best: currentBest(view.results, goal.eventGroup, goal.lowerIsBetter) }
    : (all.find((option) => option.value === eventValue) ?? null)
  const words = chosen ? unitWordsForViewer(UNIT_WORDS, chosen.unit) : null
  const whose = audience === "athlete" ? "Your" : `${athleteName ?? "Their"}'s`
  const bestHint = chosen
    ? chosen.best
      ? `${whose} best is ${goalMarkText(chosen.best.compareValue, chosen.unit)}. ${chosen.lowerIsBetter ? "Lower is better." : "Higher is better."}`
      : `No result in this event yet. ${chosen.lowerIsBetter ? "Lower is better." : "Higher is better."}`
    : "Choose the event first."

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors: typeof errors = {}
    if (!chosen) nextErrors.event = "Choose an event."
    const parsed = chosen ? parseMarkForViewer(mark, chosen.unit) : null
    if (chosen && parsed && !parsed.ok) nextErrors.mark = parsed.message === "Enter the mark." ? "Enter the mark to aim for." : parsed.message
    if (targetDate && !goal && targetDate < today) nextErrors.date = "The date to reach it by cannot be in the past."
    setErrors(nextErrors)
    setFormError(null)
    if (Object.keys(nextErrors).length > 0 || !chosen || !parsed || !parsed.ok) return

    setBusy(true)
    const input = { targetValue: parsed.value, targetDate: targetDate || null, note: note.trim() || null }
    const result = goal
      ? await updateAthleteGoal(goal, input)
      : await addAthleteGoal(view.athleteId, { ...input, eventKey: chosen.eventKey, eventLabel: chosen.label, unit: chosen.unit, lowerIsBetter: chosen.lowerIsBetter }, view.results)
    setBusy(false)
    if (!result.ok) {
      if (result.error.code === "VALIDATION" && /already reached/.test(result.error.message)) setErrors({ mark: result.error.message })
      else setFormError(result.error.message)
      return
    }
    notify(result.data.achievedOn ? "Goal saved. It is already achieved." : goal ? "Goal saved" : "Goal set")
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={goal ? "Change goal" : "Set a goal"}
      description={
        audience === "athlete"
          ? "A mark to aim for in one event. Your coaches can see your goals. It is ticked off by itself when a later result reaches it."
          : `A mark for ${athleteName ?? "the athlete"} to aim for in one event. They see it under Progress, Goals. It is ticked off by itself when a later result reaches it.`
      }
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
        <Field label="Event" error={errors.event} hint={goal ? "The event of a goal cannot be changed. Remove the goal and set a new one instead." : undefined}>
          {goal ? (
            <Input value={goal.eventLabel} readOnly disabled />
          ) : (
            <Select value={eventValue} onChange={(event) => setEventValue(event.target.value)}>
              <option value="">Choose an event</option>
              {options.own.length > 0 ? (
                <optgroup label={audience === "athlete" ? "Your events and tests" : "Their events and tests"}>
                  {options.own.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="All events">
                {options.listed.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            </Select>
          )}
        </Field>
        <FormGrid>
          <Field label={words ? `Target: ${words.field.charAt(0).toLowerCase()}${words.field.slice(1)}` : "Target mark"} error={errors.mark} hint={bestHint}>
            <Input value={mark} inputMode="decimal" autoComplete="off" placeholder={words?.placeholder} disabled={!chosen} onChange={(event) => setMark(event.target.value)} />
          </Field>
          <Field label="Reach it by" optional error={errors.date} hint="Leave empty for no date.">
            <Input type="date" value={targetDate} min={goal ? undefined : today} onChange={(event) => setTargetDate(event.target.value)} />
          </Field>
        </FormGrid>
        <Field label="Note" optional hint={audience === "athlete" ? "Why it matters, or the meet it is for. Your coaches can read it." : `${athleteName ?? "The athlete"} can read it.`}>
          <Textarea value={note} maxLength={500} rows={2} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving..." : goal ? "Save goal" : "Set goal"}
          </Button>
          <Button variant="quiet" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** One goal: what it is, its state as a dot plus text, the progress line with its numbers, and its actions. */
function GoalRow({
  goal,
  results,
  audience,
  onEdit,
  onChanged,
}: {
  goal: AthleteGoal
  results: AthleteResult[]
  audience: "athlete" | "staff"
  onEdit: () => void
  onChanged: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Off the screen while "Undo" is offered. The delete itself is sent a few seconds later.
  const [removed, setRemoved] = useState(false)
  const undoableDelete = useUndoableDelete()
  const progress = describeGoal(goal, results, localToday())
  const target = goalMarkText(goal.targetValue, goal.unit)
  const name = `${goal.eventLabel} ${target}`
  const startText = goal.startValue !== null ? goalMarkText(goal.startValue, goal.unit) : "No mark"

  const setAchieved = async (achieved: boolean) => {
    setBusy(true)
    setError(null)
    const result = await setAthleteGoalAchieved(goal, achieved)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    notify(achieved ? "Goal marked achieved" : result.data.achievedOn ? "A result already reaches this goal, so it stays achieved" : "Goal opened again")
    onChanged()
  }

  // The goal leaves the list at once. The delete is sent when "Undo" runs out.
  const remove = () => {
    setError(null)
    setConfirming(false)
    undoableDelete({
      message: "Goal removed",
      failed: "The goal was not removed",
      hide: () => setRemoved(true),
      restore: () => setRemoved(false),
      commit: () => deleteAthleteGoal(goal.id),
      done: onChanged,
    })
  }

  const items: RowMenuItem[] = [
    { label: "Change goal", onSelect: onEdit },
    ...(goal.achievedOn
      ? goal.achievedManually
        ? [{ label: "Open it again", onSelect: () => void setAchieved(false), disabled: busy }]
        : []
      : [{ label: "Mark achieved", onSelect: () => void setAchieved(true), disabled: busy }]),
    { label: "Remove goal", onSelect: () => setConfirming(true), danger: true },
  ]

  if (removed) return null

  return (
    <ActionRow
      data-goal={goal.eventLabel}
      data-goal-state={progress.state.kind}
      title={
        <>
          {goal.eventLabel} <span className="tabular-nums">{target}</span>
        </>
      }
      subtitle={
        <>
          <StatusText tone={progress.state.tone}>{progress.state.label}</StatusText>
          {progress.dateLine ? <span className="block">{progress.dateLine}</span> : null}
          {goal.setByStaff ? <span className="block">{audience === "athlete" ? "Set by your coach." : "Set by a coach."}</span> : audience === "staff" ? <span className="block">Set by the athlete.</span> : null}
          {goal.note ? <span className="block">Note: {goal.note}</span> : null}
        </>
      }
      actions={<RowMenu label={`More for the goal ${name}`} items={items} />}
      below={
        <>
          <div className="flex items-center gap-3 text-sm tabular-nums text-sk-mute">
            <span className="shrink-0">{startText}</span>
            <Meter className="min-w-0 flex-1" value={progress.percent} tone={goal.achievedOn ? "green" : "blue"} label={`Progress to ${name}: ${progress.percent}%`} />
            <span className="shrink-0 font-semibold text-sk-ink">{target}</span>
          </div>
          <p className="mt-1.5 text-sm text-sk-mute" data-goal-progress>
            {progress.line}
          </p>
          {error ? (
            <Notice tone="error" className="mt-2">
              {error}
            </Notice>
          ) : null}
          {confirming ? (
            <InlineConfirm className="mt-2" question={`Remove the goal ${name}? Results are not touched.`} confirmLabel="Remove goal" onConfirm={remove} onCancel={() => setConfirming(false)} busy={busy} />
          ) : null}
        </>
      }
    />
  )
}

/** The goals of one athlete as a list, with the dialog to set or change one. Sections and headings are the caller's. */
export function GoalList({
  view,
  goals,
  audience,
  athleteName,
  onChanged,
  "aria-label": ariaLabel,
}: {
  view: AthleteGoalsView
  /** The goals to show (the caller splits open and achieved). */
  goals: AthleteGoal[]
  audience: "athlete" | "staff"
  athleteName?: string
  onChanged: () => void
  "aria-label": string
}) {
  const [editing, setEditing] = useState<AthleteGoal | null>(null)
  return (
    <>
      <List aria-label={ariaLabel}>
        {goals.map((goal) => (
          <GoalRow key={goal.id} goal={goal} results={view.results} audience={audience} onEdit={() => setEditing(goal)} onChanged={onChanged} />
        ))}
      </List>
      {editing ? (
        <GoalDialog key={editing.id} open onOpenChange={(open) => (open ? undefined : setEditing(null))} view={view} goal={editing} audience={audience} athleteName={athleteName} onSaved={onChanged} />
      ) : null}
    </>
  )
}

/** Loads the goals of one athlete (the signed-in athlete when no id is given) and reloads on demand. */
export function useGoals(load: () => Promise<Result<AthleteGoalsView>>) {
  const [view, setView] = useState<AthleteGoalsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)
  useEffect(() => {
    let cancelled = false
    void load().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setView(result.data)
        setError(null)
      } else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [load, token])
  return { view, error, reload: () => setToken((value) => value + 1) }
}
