import { ArrowRight, ClipboardText, ListBullets, Minus, Plus, Stack } from "@phosphor-icons/react"
import { useMemo, useState } from "react"
import { Button, Field, FormActions, FormGrid, Input, List, Notice, RadioRow, SearchInput, Section, Sheet, Segmented, Select, SkeletonRows, Textarea } from "@/components/sk"
import {
  EVENT_GROUPS,
  MAX_WEEKS,
  addDaysIso,
  formatDayMonth,
  todayIso,
  weekdayLabel,
  createSkeletonSessions,
  sessionsBeyondWeek,
  setPlanWeeks,
  type PlanDraft,
} from "@/lib/data/training-plan/plan-builder-model"
import { planFromTemplate, weekdayName, weekdayOfIso, type PlanTemplate, type PlanTemplateSummary } from "@/lib/data/training-plan/plan-templates"
import type { Result } from "@/lib/data/result"
import type { EventGroup } from "@/lib/mock-data"
import { parsePastedSheet } from "@/lib/data/training-plan/plan-paste"
import { placePastedDays, sessionsFromPlaced } from "./plan-sheet"
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

/** Plan basics. A new plan gets the quick two-step start; an existing plan edits its details here. */
export function PlanSetup(props: Parameters<typeof PlanDetailsForm>[0]) {
  return props.isNew ? <NewPlanSheet {...props} /> : <PlanDetailsForm {...props} />
}

function PlanDetailsForm({
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
    <Sheet
      open
      onOpenChange={(open) => (open ? undefined : onCancel())}
      title={isNew ? "New plan" : "Plan details"}
      description={isNew ? undefined : "Changing the start date moves every session with it."}
      className="sm:max-w-xl"
    >
      {error ? (
        <Notice tone="error" className="mb-4">
          {error}
        </Notice>
      ) : null}

      <form
        className="sk-plan-setup flex flex-col gap-6"
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
          <Section title="Start from">
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
    </Sheet>
  )
}

/* --------------------------------- A new plan --------------------------------- */

type NewStep = "basics" | "start" | "paste" | "template" | "outline"

/** The next three Mondays from today (today included when it is one). */
function nextMondays(count: number) {
  const today = todayIso()
  const weekday = weekdayOfIso(today) ?? 1
  const first = addDaysIso(today, (8 - weekday) % 7)
  return Array.from({ length: count }, (_, index) => addDaysIso(first, index * 7))
}

function shortDate(dateIso: string) {
  return `${weekdayLabel(dateIso)} ${formatDayMonth(dateIso)}`
}

/**
 * A new plan in two short steps: a name, a start and a length, then how to start it (a blank week,
 * rows pasted from a spreadsheet, a club template or a starter outline).
 */
function NewPlanSheet({
  plan,
  teams,
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
  onDone: (next: PlanDraft, usedTemplateId?: string) => void
}) {
  const mondays = useMemo(() => nextMondays(3), [])
  const [step, setStep] = useState<NewStep>("basics")
  const [name, setName] = useState(plan.name)
  const [teamId, setTeamId] = useState(plan.teamId)
  // A new plan starts on the coming Monday unless the coach picks another day.
  const [startDate, setStartDate] = useState(mondays[0])
  const [pickDate, setPickDate] = useState(false)
  const [weeks, setWeeks] = useState(Math.min(Math.max(plan.weeks || 4, 1), MAX_WEEKS))
  const [pasteText, setPasteText] = useState("")
  const [templateId, setTemplateId] = useState<string | null>(templates?.initialId ?? null)
  const team = teams.find((candidate) => candidate.id === teamId) ?? null
  const [eventGroup, setEventGroup] = useState<EventGroup>(team?.eventGroup ?? "Sprint")
  const [daysPerWeek, setDaysPerWeek] = useState("5")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const templateList = templates?.list ?? null
  const chosenTemplate = templateList?.find((candidate) => candidate.id === templateId) ?? null
  const [appliedInitial, setAppliedInitial] = useState(false)
  if (!appliedInitial && templates?.initialId && templateList) {
    setAppliedInitial(true)
    const initial = templateList.find((candidate) => candidate.id === templates.initialId)
    if (initial) {
      setWeeks(initial.weeks)
      if (!name.trim()) setName(initial.name)
    }
  }

  const base = (): PlanDraft => setPlanWeeks({ ...plan, name: name.trim(), teamId, startDate }, weeks)
  const endDate = addDaysIso(startDate, weeks * 7 - 1)
  const pasted = useMemo(() => parsePastedSheet(pasteText), [pasteText])
  const placedPaste = useMemo(() => placePastedDays(setPlanWeeks({ ...plan, startDate }, weeks), 1, pasted), [plan, startDate, weeks, pasted])

  const toStart = () => {
    if (!name.trim()) return setError("Give the plan a name.")
    if (!teamId) return setError("Choose a team for this plan.")
    if (!startDate) return setError("Pick a start date.")
    setError(null)
    setStep("start")
  }

  const applyTemplate = async () => {
    if (!templates || !templateId || !chosenTemplate) return setError("Choose a template.")
    setBusy(true)
    const loaded = await templates.load(templateId)
    setBusy(false)
    if (!loaded.ok) return setError(`Could not open the template: ${loaded.error.message}`)
    // A copy with its own ids, dated from the start date. The template itself is never touched.
    onDone(setPlanWeeks(planFromTemplate(loaded.data, { teamId, startDate, name: name.trim(), notes: plan.notes }), Math.max(weeks, chosenTemplate.weeks)), templateId)
  }

  const builtFor = chosenTemplate?.startWeekday ?? null
  const startWeekday = weekdayOfIso(startDate)
  const weekdayNote =
    chosenTemplate && builtFor !== null && startWeekday !== null && builtFor !== startWeekday
      ? `This template was built to start on a ${weekdayName(builtFor)}. Starting on a ${weekdayName(startWeekday)} moves its sessions to other weekdays.`
      : null
  const back = step === "start" ? () => setStep("basics") : step === "basics" ? null : () => setStep("start")

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onCancel())} title="New plan" className="sm:max-w-xl">
      {error ? (
        <Notice tone="error" className="mb-4">
          {error}
        </Notice>
      ) : null}

      {back ? (
        <button type="button" className="sk-link mb-4 self-start text-[0.9375rem] font-bold" onClick={back}>
          Back
        </button>
      ) : null}

      {step === "basics" ? (
        <form
          className="sk-plan-setup flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (templates?.initialId && chosenTemplate) void applyTemplate()
            else toStart()
          }}
        >
          <Field label="Plan name">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Winter strength block" autoFocus />
          </Field>
          {teams.length > 1 && !teamLocked ? (
            <Field label="Team">
              <Select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                {teams.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div>
            <p className="sk-field-label mb-1.5" id="plan-starts">
              Starts
            </p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="plan-starts">
              {mondays.map((monday) => (
                <button
                  key={monday}
                  type="button"
                  role="radio"
                  aria-checked={!pickDate && startDate === monday}
                  className="sk-choice-tile"
                  onClick={() => {
                    setPickDate(false)
                    setStartDate(monday)
                  }}
                >
                  {shortDate(monday)}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={pickDate}
                className="sk-choice-tile"
                onClick={() => {
                  setPickDate(true)
                  setStartDate(todayIso())
                }}
              >
                Pick a date
              </button>
            </div>
            {pickDate ? <Input type="date" aria-label="Start date" className="mt-2" value={startDate} onChange={(event) => setStartDate(event.target.value)} /> : null}
          </div>
          <div>
            <p className="sk-field-label mb-1.5">Weeks</p>
            <div className="flex items-center gap-3">
              <button type="button" className="sk-step-btn" aria-label="Fewer weeks" disabled={weeks <= 1} onClick={() => setWeeks((current) => Math.max(1, current - 1))}>
                <Minus className="size-5" weight="bold" aria-hidden />
              </button>
              <output className="sk-step-value" aria-label="Weeks" aria-live="polite">
                {weeks}
              </output>
              <button type="button" className="sk-step-btn" aria-label="More weeks" disabled={weeks >= MAX_WEEKS} onClick={() => setWeeks((current) => Math.min(MAX_WEEKS, current + 1))}>
                <Plus className="size-5" weight="bold" aria-hidden />
              </button>
              <span className="text-sm text-sk-mute">to {shortDate(endDate)}</span>
            </div>
          </div>
          {templates?.initialId && weekdayNote ? <Notice tone="warning">{weekdayNote}</Notice> : null}
          <Button type="submit" variant="primary" className="mt-1" disabled={busy}>
            {templates?.initialId && chosenTemplate ? (busy ? "Opening the template..." : `Start from ${chosenTemplate.name}`) : "Next"}
            <ArrowRight className="size-5" weight="bold" aria-hidden />
          </Button>
        </form>
      ) : null}

      {step === "start" ? (
        <div className="grid grid-cols-2 gap-3" role="group" aria-label="How to start">
          <button type="button" className="sk-start-tile" data-primary onClick={() => onDone(base())}>
            <Plus className="size-8" weight="bold" aria-hidden />
            <span>Blank week</span>
          </button>
          <button type="button" className="sk-start-tile" onClick={() => setStep("paste")}>
            <ClipboardText className="size-8" weight="bold" aria-hidden />
            <span>Paste from Excel</span>
          </button>
          <button type="button" className="sk-start-tile" onClick={() => setStep("template")} disabled={templateList !== null && templateList.length === 0}>
            <Stack className="size-8" weight="bold" aria-hidden />
            <span>From a template</span>
          </button>
          <button type="button" className="sk-start-tile" onClick={() => setStep("outline")}>
            <ListBullets className="size-8" weight="bold" aria-hidden />
            <span>Starter outline</span>
          </button>
        </div>
      ) : null}

      {step === "paste" ? (
        <div className="flex flex-col gap-3">
          <Textarea
            autoFocus
            rows={9}
            aria-label="Rows from your spreadsheet"
            placeholder={"Copy your week in Excel and paste it here.\nMonday\nBack squat\t3\t5\t80%"}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            className="font-mono text-sm"
          />
          {placedPaste.placed.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="What will be filled">
              {placedPaste.placed.map(({ slot, count }) => (
                <li key={slot.index} className="sk-paste-day">
                  <strong>{slot.name}</strong>
                  <span>{plural(count, "exercise")}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            variant="primary"
            disabled={placedPaste.placed.length === 0}
            onClick={() => {
              const next = base()
              onDone({ ...next, sessions: sessionsFromPlaced(next, 1, placePastedDays(next, 1, pasted).placed) })
            }}
          >
            {placedPaste.placed.length === 0 ? "Fill week 1" : `Fill ${plural(placedPaste.placed.length, "day")}`}
          </Button>
        </div>
      ) : null}

      {step === "template" ? (
        templates?.error ? (
          <Notice tone="error">{templates.error}</Notice>
        ) : templateList === null ? (
          <SkeletonRows rows={2} label="Loading templates" />
        ) : (
          <div className="flex flex-col gap-3">
            <div role="radiogroup" aria-label="Template">
              <List>
                {templateList.map((candidate) => (
                  <RadioRow
                    key={candidate.id}
                    name="plan-template"
                    value={candidate.id}
                    checked={candidate.id === templateId}
                    onChange={(id) => {
                      setTemplateId(id)
                      setError(null)
                    }}
                    title={candidate.name}
                    subtitle={templateFacts(candidate)}
                  />
                ))}
              </List>
            </div>
            {weekdayNote ? <Notice tone="warning">{weekdayNote}</Notice> : null}
            <Button variant="primary" disabled={!chosenTemplate || busy} onClick={() => void applyTemplate()}>
              {busy ? "Opening the template..." : "Use this template"}
            </Button>
          </div>
        )
      ) : null}

      {step === "outline" ? (
        <div className="flex flex-col gap-4">
          <FormGrid>
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
          <Button variant="primary" onClick={() => onDone({ ...base(), sessions: createSkeletonSessions(weeks, eventGroup, Number.parseInt(daysPerWeek, 10)) })}>
            Use the outline
          </Button>
        </div>
      ) : null}
    </Sheet>
  )
}
