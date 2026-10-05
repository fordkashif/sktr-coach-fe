import { ArrowLeft, ArrowRight } from "@phosphor-icons/react"
import { useState } from "react"
import { PageHeader, Panel, Segmented } from "@/components/sk"
import {
  EVENT_GROUPS,
  MAX_WEEKS,
  createSkeletonSessions,
  sessionsBeyondWeek,
  setPlanWeeks,
  type PlanDraft,
} from "@/lib/data/training-plan/plan-builder-model"
import type { EventGroup } from "@/lib/mock-data"
import type { TeamOption } from "./storage"
import { ErrorNote, Field, plural } from "./ui"

type StartFrom = "blank" | "template"

/** Plan basics. For a new plan this is step one; for an existing plan it edits the details. */
export function PlanSetup({
  plan,
  teams,
  isNew,
  teamLocked,
  onCancel,
  onDone,
}: {
  plan: PlanDraft
  teams: TeamOption[]
  isNew: boolean
  teamLocked: boolean
  onCancel: () => void
  onDone: (next: PlanDraft) => void
}) {
  const [name, setName] = useState(plan.name)
  const [teamId, setTeamId] = useState(plan.teamId)
  const [startDate, setStartDate] = useState(plan.startDate)
  const [weeks, setWeeks] = useState(String(plan.weeks))
  const [notes, setNotes] = useState(plan.notes)
  const [startFrom, setStartFrom] = useState<StartFrom>("blank")
  const team = teams.find((candidate) => candidate.id === teamId) ?? null
  const [eventGroup, setEventGroup] = useState<EventGroup>(team?.eventGroup ?? "Sprint")
  const [daysPerWeek, setDaysPerWeek] = useState("5")
  const [error, setError] = useState<string | null>(null)

  const weekCount = Number.parseInt(weeks, 10)
  const weeksValid = Number.isInteger(weekCount) && weekCount >= 1 && weekCount <= MAX_WEEKS
  const dropped = weeksValid ? sessionsBeyondWeek(plan, weekCount) : 0

  const submit = () => {
    if (!name.trim()) return setError("Give the plan a name.")
    if (!teamId) return setError("Choose a team for this plan.")
    if (!startDate) return setError("Pick a start date.")
    if (!weeksValid) return setError(`Weeks must be a number from 1 to ${MAX_WEEKS}.`)
    setError(null)
    let next: PlanDraft = setPlanWeeks({ ...plan, name: name.trim(), teamId, startDate, notes }, weekCount)
    if (isNew && startFrom === "template") {
      next = { ...next, sessions: createSkeletonSessions(weekCount, eventGroup, Number.parseInt(daysPerWeek, 10)) }
    }
    onDone(next)
  }

  return (
    <div className="sk-page">
      <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm -ml-3 hidden lg:inline-flex" onClick={onCancel}>
        <ArrowLeft className="size-4" weight="bold" />
        {isNew ? "All plans" : "Back to the week planner"}
      </button>

      <PageHeader
        title={isNew ? "New plan" : "Plan details"}
        lede={isNew ? "Start with the basics. You can change any of this later." : "Changing the start date moves every session with it."}
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Panel title="Basics" className="max-w-3xl">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan name" className="sm:col-span-2">
              <input
                className="sk-field"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Preseason power block"
                autoFocus={isNew}
              />
            </Field>
            <Field label="Team">
              <select className="sk-field" value={teamId} disabled={teamLocked} onChange={(event) => setTeamId(event.target.value)}>
                {teams.length === 0 ? <option value="">No teams yet</option> : null}
                {teams.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Start date">
              <input type="date" className="sk-field" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </Field>
            <Field
              label="Weeks"
              hint={dropped > 0 ? `Shortening the plan removes ${plural(dropped, "session")} after week ${weekCount}.` : undefined}
            >
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_WEEKS}
                className="sk-field"
                value={weeks}
                onChange={(event) => setWeeks(event.target.value)}
              />
            </Field>
            <Field label="Notes for athletes" className="sm:col-span-2">
              <textarea
                className="sk-field h-auto min-h-[88px] py-2.5"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional plan notes"
              />
            </Field>
          </div>
        </Panel>

        {isNew ? (
          <Panel title="Start from" hint="A template fills every week with sessions you can then edit." className="max-w-3xl">
            <Segmented<StartFrom>
              label="Start from"
              value={startFrom}
              onChange={setStartFrom}
              options={[
                { value: "blank", label: "Blank weeks" },
                { value: "template", label: "Template" },
              ]}
            />
            {startFrom === "template" ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Event group">
                  <select className="sk-field" value={eventGroup} onChange={(event) => setEventGroup(event.target.value as EventGroup)}>
                    {EVENT_GROUPS.map((group) => (
                      <option key={group.value} value={group.value}>
                        {group.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Training days per week">
                  <select className="sk-field" value={daysPerWeek} onChange={(event) => setDaysPerWeek(event.target.value)}>
                    {[3, 4, 5, 6, 7].map((count) => (
                      <option key={count} value={count}>
                        {count} days
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}
          </Panel>
        ) : null}

        <div className="flex max-w-3xl flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="sk-btn sk-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="sk-btn sk-btn-primary">
            {isNew ? "Continue to build" : "Save details"}
            <ArrowRight className="size-5" weight="bold" />
          </button>
        </div>
      </form>
    </div>
  )
}
