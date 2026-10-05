import { ArrowRight } from "@phosphor-icons/react"
import { useState } from "react"
import { Button, Field, FormActions, FormGrid, Input, Notice, Screen, ScreenHeader, Section, Segmented, Select, Textarea } from "@/components/sk"
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
import { plural } from "./ui"

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
    <Screen width="narrow">
      <ScreenHeader
        back={{ onClick: onCancel, label: isNew ? "All plans" : "Back to the plan" }}
        title={isNew ? "New plan" : "Plan details"}
        lede={isNew ? "Start with the basics. You can change any of this later." : "Changing the start date moves every session with it."}
      />

      {error ? <Notice tone="error">{error}</Notice> : null}

      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Section title="Basics">
          <FormGrid className="mt-2">
            <Field label="Plan name" className="sm:col-span-2">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Preseason power block" autoFocus={isNew} />
            </Field>
            <Field label="Team" className="sm:col-span-2" hint={teamLocked && team ? "You coach one team, so plans are for it." : undefined}>
              <Select value={teamId} disabled={teamLocked} onChange={(event) => setTeamId(event.target.value)}>
                {teams.length === 0 ? <option value="">No teams yet</option> : null}
                {teams.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Start date">
              <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </Field>
            <Field label="Weeks" hint={dropped > 0 ? `Shortening the plan removes ${plural(dropped, "session")} after week ${weekCount}.` : `1 to ${MAX_WEEKS}`}>
              <Input type="number" inputMode="numeric" min={1} max={MAX_WEEKS} value={weeks} onChange={(event) => setWeeks(event.target.value)} />
            </Field>
            <Field label="Notes for athletes" optional className="sm:col-span-2">
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional plan notes" />
            </Field>
          </FormGrid>
        </Section>

        {isNew ? (
          <Section title="Start from" hint="A template fills every week with sessions you can then edit.">
            <Segmented<StartFrom>
              label="Start from"
              className="mt-2 self-start"
              value={startFrom}
              onChange={setStartFrom}
              options={[
                { value: "blank", label: "Blank weeks" },
                { value: "template", label: "Template" },
              ]}
            />
            {startFrom === "template" ? (
              <FormGrid className="mt-4">
                <Field label="Event group">
                  <Select value={eventGroup} onChange={(event) => setEventGroup(event.target.value as EventGroup)}>
                    {EVENT_GROUPS.map((group) => (
                      <option key={group.value} value={group.value}>
                        {group.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Training days per week">
                  <Select value={daysPerWeek} onChange={(event) => setDaysPerWeek(event.target.value)}>
                    {[3, 4, 5, 6, 7].map((count) => (
                      <option key={count} value={count}>
                        {count} days
                      </option>
                    ))}
                  </Select>
                </Field>
              </FormGrid>
            ) : null}
          </Section>
        ) : null}

        <FormActions>
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {isNew ? "Continue to build" : "Save details"}
            <ArrowRight className="size-5" weight="bold" aria-hidden />
          </Button>
        </FormActions>
      </form>
    </Screen>
  )
}
