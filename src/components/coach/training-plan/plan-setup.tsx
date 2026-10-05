import { ArrowRight } from "@phosphor-icons/react"
import { useState } from "react"
import { Button, Field, FormActions, FormGrid, Input, List, Notice, RadioRow, Screen, ScreenHeader, SearchInput, Section, Segmented, Select, SkeletonRows, Textarea } from "@/components/sk"
import {
  EVENT_GROUPS,
  MAX_WEEKS,
  createSkeletonSessions,
  sessionsBeyondWeek,
  setPlanWeeks,
  type PlanDraft,
} from "@/lib/data/training-plan/plan-builder-model"
import { planFromTemplate, weekdayName, weekdayOfIso, type PlanTemplate, type PlanTemplateSummary } from "@/lib/data/training-plan/plan-templates"
import type { Result } from "@/lib/data/result"
import type { EventGroup } from "@/lib/mock-data"
import type { TeamOption } from "./storage"
import { plural, templateFacts } from "./ui"

/** Blank weeks, a generated outline for an event group, or one of the club's saved templates. */
type StartFrom = "blank" | "outline" | "template"

/** What a new plan can be started from. Left out when editing the details of an existing plan. */
export type SetupTemplates = {
  /** The club's templates that are in use. Null while they load. */
  list: PlanTemplateSummary[] | null
  error: string | null
  /** A template to start on, picked on the Templates screen. */
  initialId: string | null
  load: (templateId: string) => Promise<Result<PlanTemplate>>
}

/** Plan basics. For a new plan this is step one; for an existing plan it edits the details. */
export function PlanSetup({
  plan,
  teams,
  isNew,
  teamLocked,
  templates,
  onCancel,
  onDone,
}: {
  plan: PlanDraft
  teams: TeamOption[]
  isNew: boolean
  teamLocked: boolean
  templates?: SetupTemplates
  onCancel: () => void
  /** `usedTemplateId` is set when the plan was filled in from a saved template. */
  onDone: (next: PlanDraft, usedTemplateId?: string) => void
}) {
  const [name, setName] = useState(plan.name)
  const [teamId, setTeamId] = useState(plan.teamId)
  const [startDate, setStartDate] = useState(plan.startDate)
  const [weeks, setWeeks] = useState(String(plan.weeks))
  const [notes, setNotes] = useState(plan.notes)
  const [startFrom, setStartFrom] = useState<StartFrom>(templates?.initialId ? "template" : "blank")
  const [templateId, setTemplateId] = useState<string | null>(templates?.initialId ?? null)
  const [templateSearch, setTemplateSearch] = useState("")
  const [busy, setBusy] = useState(false)
  const team = teams.find((candidate) => candidate.id === teamId) ?? null
  const [eventGroup, setEventGroup] = useState<EventGroup>(team?.eventGroup ?? "Sprint")
  const [daysPerWeek, setDaysPerWeek] = useState("5")
  const [error, setError] = useState<string | null>(null)

  const weekCount = Number.parseInt(weeks, 10)
  const weeksValid = Number.isInteger(weekCount) && weekCount >= 1 && weekCount <= MAX_WEEKS
  const dropped = weeksValid ? sessionsBeyondWeek(plan, weekCount) : 0

  const templateList = templates?.list ?? null
  const chosenTemplate = templateList?.find((candidate) => candidate.id === templateId) ?? null
  const templateQuery = templateSearch.trim().toLowerCase()
  const shownTemplates = (templateList ?? []).filter((candidate) => !templateQuery || candidate.name.toLowerCase().includes(templateQuery) || candidate.id === templateId)

  // The template picked on the Templates screen sets the length and a name once the list is in.
  const [appliedInitial, setAppliedInitial] = useState(false)
  if (!appliedInitial && templates?.initialId && templateList) {
    setAppliedInitial(true)
    const initial = templateList.find((candidate) => candidate.id === templates.initialId)
    if (initial) {
      setWeeks(String(initial.weeks))
      if (!name.trim()) setName(initial.name)
    } else {
      setTemplateId(null)
    }
  }

  const chooseTemplate = (id: string) => {
    const picked = templateList?.find((candidate) => candidate.id === id)
    if (!picked) return
    // The name follows the template until the coach types their own.
    if (!name.trim() || name === chosenTemplate?.name) setName(picked.name)
    setTemplateId(id)
    setWeeks(String(picked.weeks))
    setError(null)
  }

  const startWeekday = weekdayOfIso(startDate)
  const builtFor = startFrom === "template" && chosenTemplate ? chosenTemplate.startWeekday : null
  const weekdayHint =
    builtFor !== null && startWeekday !== null && builtFor !== startWeekday
      ? `This template was built to start on a ${weekdayName(builtFor)}. Starting on a ${weekdayName(startWeekday)} moves its sessions to other weekdays.`
      : undefined

  const submit = async () => {
    if (busy) return
    if (!name.trim()) return setError("Give the plan a name.")
    if (!teamId) return setError("Choose a team for this plan.")
    if (!startDate) return setError("Pick a start date.")
    if (!weeksValid) return setError(`Weeks must be a number from 1 to ${MAX_WEEKS}.`)
    setError(null)
    let next: PlanDraft = setPlanWeeks({ ...plan, name: name.trim(), teamId, startDate, notes }, weekCount)
    if (isNew && startFrom === "outline") {
      next = { ...next, sessions: createSkeletonSessions(weekCount, eventGroup, Number.parseInt(daysPerWeek, 10)) }
    }
    if (isNew && startFrom === "template") {
      if (!templates || !templateId || !chosenTemplate) return setError("Choose a template, or start from blank weeks.")
      setBusy(true)
      const loaded = await templates.load(templateId)
      setBusy(false)
      if (!loaded.ok) return setError(`Could not open the template: ${loaded.error.message}`)
      // A copy with its own ids, dated from the start date. The template itself is never touched.
      next = setPlanWeeks(planFromTemplate(loaded.data, { teamId, startDate, name: name.trim(), notes }), weekCount)
      return onDone(next, templateId)
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
          void submit()
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
            <Field label="Start date" hint={weekdayHint}>
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
          <Section title="Start from" hint="A starter outline or one of your club's templates fills every week with sessions you can then edit.">
            <Segmented<StartFrom>
              label="Start from"
              className="mt-2 self-start"
              value={startFrom}
              onChange={setStartFrom}
              options={[
                { value: "blank", label: "Blank weeks" },
                { value: "outline", label: "Starter outline" },
                { value: "template", label: "Template" },
              ]}
            />
            {startFrom === "template" ? (
              templates?.error ? (
                <Notice tone="error" className="mt-4">
                  {templates.error}
                </Notice>
              ) : templateList === null ? (
                <SkeletonRows rows={2} label="Loading templates" />
              ) : templateList.length === 0 ? (
                <p className="mt-4 text-[0.9375rem] text-sk-mute">Your club has no templates yet. Open a plan and choose Save as template, and it is offered here.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {templateList.length > 6 ? (
                    <SearchInput aria-label="Search templates" placeholder="Search templates" value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} />
                  ) : null}
                  <div role="radiogroup" aria-label="Template">
                    <List>
                      {shownTemplates.map((candidate) => (
                        <RadioRow
                          key={candidate.id}
                          name="plan-template"
                          value={candidate.id}
                          checked={candidate.id === templateId}
                          onChange={chooseTemplate}
                          title={candidate.name}
                          subtitle={templateFacts(candidate)}
                        />
                      ))}
                    </List>
                  </div>
                  <p className="text-sm text-sk-mute">You get your own copy, dated from the start date. Changing your plan never changes the template.</p>
                </div>
              )
            ) : null}
            {startFrom === "outline" ? (
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
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Opening the template..." : isNew ? "Continue to build" : "Save details"}
            <ArrowRight className="size-5" weight="bold" aria-hidden />
          </Button>
        </FormActions>
      </form>
    </Screen>
  )
}
