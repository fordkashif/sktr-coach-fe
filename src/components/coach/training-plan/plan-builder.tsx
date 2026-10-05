import { ArrowRight, CopySimple, PencilSimple, Plus, Printer, Swap, Trash, X } from "@phosphor-icons/react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ActionBar,
  Button,
  DayChecks,
  DayLabel,
  EmptyState,
  Field,
  FormGrid,
  InlineConfirm,
  Input,
  List,
  ListRow,
  Notice,
  RowMenu,
  Screen,
  ScreenHeader,
  Section,
  Select,
  Split,
  Tabs,
} from "@/components/sk"
import {
  QUICK_BLOCKS,
  SESSION_TYPES,
  applyABPattern,
  copySessionToNextDay,
  duplicatePreviousWeek,
  formatDateRange,
  formatDayMonth,
  getSession,
  newBlock,
  newSession,
  nextSlot,
  planEndDate,
  putSession,
  removeSession,
  slotDate,
  weekSessions,
  weekdayLabel,
  type BlockDraft,
    type PlanDraft,
  type SessionDraft,
  type SessionType,
} from "@/lib/data/training-plan/plan-builder-model"
import { ExerciseRows } from "./exercise-rows"
import type { AthleteOption, TeamOption } from "./storage"
import { PlanStatusText, plural } from "./ui"
import { useExerciseTools, type ExerciseTools } from "./use-exercise-tools"

const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6]

type WeekTool = null | "duplicate-confirm" | "ab"

function useIsDesktop() {
  const query = "(min-width: 1024px)"
  const [matches, setMatches] = useState(() => (typeof window === "undefined" ? true : window.matchMedia(query).matches))
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener("change", update)
    return () => list.removeEventListener("change", update)
  }, [])
  return matches
}

function dayOfMonth(dateIso: string) {
  return Number(dateIso.slice(8, 10)) || 0
}

export function PlanBuilder({
  plan,
  team,
  athletes,
  dirty,
  busy,
  error,
  savedLabel,
  mobileEditorOpen,
  onMobileEditorChange,
  onChange,
  onBack,
  onEditDetails,
  onSaveDraft,
  onReview,
  onPrint,
  onSaveAsTemplate,
}: {
  plan: PlanDraft
  team: TeamOption | null
  /** The athletes of the plan's team: who a row can be adjusted for. */
  athletes: AthleteOption[]
  dirty: boolean
  busy: boolean
  error: string | null
  savedLabel: string | null
  /** On phones the session editor replaces the week. */
  mobileEditorOpen: boolean
  onMobileEditorChange: (open: boolean) => void
  onChange: (updater: (plan: PlanDraft) => PlanDraft) => void
  onBack: () => void
  onEditDetails: () => void
  onSaveDraft: () => void
  onReview: () => void
  /** Opens the print dialog on the week that is showing. */
  onPrint: (week: number) => void
  onSaveAsTemplate: () => void
}) {
  const [week, setWeek] = useState(1)
  const [dayIndex, setDayIndex] = useState(() => weekSessions(plan, 1)[0]?.dayIndex ?? 0)
  const [tool, setTool] = useState<WeekTool>(null)
  const [confirmCopy, setConfirmCopy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const isDesktop = useIsDesktop()
  const athleteIds = useMemo(() => athletes.map((athlete) => athlete.id), [athletes])
  const exerciseTools = useExerciseTools(athleteIds)
  const editorRef = useRef<HTMLDivElement | null>(null)
  // What to put the cursor in once the screen has caught up with a change.
  const pendingFocus = useRef<null | "title" | { blockId: string; field: "name" | "details" }>(null)

  const activeWeek = Math.min(week, plan.weeks)
  const sessions = weekSessions(plan, activeWeek)
  const session = getSession(plan, activeWeek, dayIndex)
  const selectedDate = slotDate(plan, activeWeek, dayIndex)
  const selectedDayName = `${weekdayLabel(selectedDate)} ${formatDayMonth(selectedDate)}`
  const copyTarget = nextSlot(plan, activeWeek, dayIndex)
  const copyTargetDate = copyTarget ? slotDate(plan, copyTarget.week, copyTarget.dayIndex) : null
  const copyTargetName = copyTargetDate ? `${weekdayLabel(copyTargetDate)} ${formatDayMonth(copyTargetDate)}` : ""
  const isPublished = plan.status === "published"

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const target = pendingFocus.current
    if (!target || !editorRef.current) return
    const node =
      target === "title"
        ? editorRef.current.querySelector<HTMLInputElement>("[data-session-title]")
        : editorRef.current.querySelector<HTMLInputElement>(`[data-block-id="${target.blockId}"] [data-block-field="${target.field}"]`)
    if (!node) return
    pendingFocus.current = null
    node.focus()
  })

  // Ctrl or Cmd + S saves the draft, as people expect.
  useEffect(() => {
    if (isPublished) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        if (!busy) onSaveDraft()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [busy, isPublished, onSaveDraft])

  const selectWeek = (next: number) => {
    setWeek(next)
    setDayIndex(weekSessions(plan, next)[0]?.dayIndex ?? 0)
    setTool(null)
    setConfirmCopy(false)
  }

  const openDay = (index: number) => {
    setDayIndex(index)
    setConfirmCopy(false)
    if (!getSession(plan, activeWeek, index)) {
      onChange((current) => (getSession(current, activeWeek, index) ? current : putSession(current, newSession(activeWeek, index))))
      pendingFocus.current = "title"
    }
    onMobileEditorChange(true)
    if (!isDesktop) document.getElementById("main-content")?.scrollTo({ top: 0 })
  }

  const updateSession = (patch: Partial<SessionDraft>) =>
    onChange((current) => {
      const existing = getSession(current, activeWeek, dayIndex)
      return existing ? putSession(current, { ...existing, ...patch }) : current
    })

  const updateBlock = (blockId: string, updater: (block: BlockDraft) => BlockDraft) =>
    onChange((current) => {
      const existing = getSession(current, activeWeek, dayIndex)
      if (!existing) return current
      return putSession(current, { ...existing, blocks: existing.blocks.map((block) => (block.id === blockId ? updater(block) : block)) })
    })

  const addBlock = (title?: string) => {
    if (!session) return
    const block = newBlock(title)
    pendingFocus.current = { blockId: block.id, field: title ? "details" : "name" }
    updateSession({ blocks: [...session.blocks, block] })
  }

  const copyToNextDay = () => {
    if (!session || !copyTarget) return
    onChange((current) => copySessionToNextDay(current, activeWeek, dayIndex))
    setConfirmCopy(false)
    setNotice(`Copied to ${copyTargetName}.`)
  }

  const requestCopy = () => {
    if (!session || !copyTarget) return
    if (getSession(plan, copyTarget.week, copyTarget.dayIndex)) setConfirmCopy(true)
    else copyToNextDay()
  }

  const duplicateLastWeek = () => {
    const copied = weekSessions(plan, activeWeek - 1).length
    onChange((current) => duplicatePreviousWeek(current, activeWeek))
    setTool(null)
    setDayIndex(weekSessions(plan, activeWeek - 1)[0]?.dayIndex ?? 0)
    setNotice(`Copied ${plural(copied, "session")} from week ${activeWeek - 1}.`)
  }

  const requestDuplicate = () => {
    if (activeWeek <= 1) return
    if (sessions.length > 0) setTool("duplicate-confirm")
    else duplicateLastWeek()
  }

  const removeAndClose = () => {
    onChange((current) => removeSession(current, activeWeek, dayIndex))
    setConfirmCopy(false)
    onMobileEditorChange(false)
    setNotice(`Removed the ${selectedDayName} session.`)
  }

  const status = notice ?? (busy ? "Saving..." : dirty ? "Unsaved changes" : savedLabel)

  /* ---------------------------------- The week ---------------------------------- */

  const weekSection = (
    <Section
      title={`Week ${activeWeek}`}
      hint={formatDateRange(slotDate(plan, activeWeek, 0), slotDate(plan, activeWeek, 6))}
      meta={sessions.length === 0 ? "No sessions yet" : plural(sessions.length, "session")}
      className="lg:sticky lg:top-6"
    >
      <Field label="Week focus" optional className="mt-3">
        <Input
          placeholder="For example: acceleration"
          value={plan.weekFocus[String(activeWeek)] ?? ""}
          onChange={(event) => onChange((current) => ({ ...current, weekFocus: { ...current.weekFocus, [String(activeWeek)]: event.target.value } }))}
        />
      </Field>

      <List className="mt-2" aria-label={`Week ${activeWeek} days`}>
        {DAY_INDEXES.map((index) => {
          const date = slotDate(plan, activeWeek, index)
          const daySession = getSession(plan, activeWeek, index)
          const selected = index === dayIndex
          const dayName = `${weekdayLabel(date)} ${formatDayMonth(date)}`
          return (
            <ListRow
              key={index}
              data-day-index={index}
              data-has-session={Boolean(daySession)}
              aria-current={selected ? "true" : undefined}
              aria-label={daySession ? `${dayName}: ${daySession.title || "Untitled session"}. Edit session` : `${dayName}: rest day. Add a session`}
              onClick={() => openDay(index)}
              leading={<DayLabel weekday={weekdayLabel(date)} number={dayOfMonth(date)} today={selected} muted={!daySession} />}
              title={daySession ? daySession.title || "Untitled session" : <span className="font-medium text-sk-mute">Rest day</span>}
              subtitle={daySession ? `${daySession.sessionType}, ${plural(daySession.blocks.length, "block")}` : undefined}
              trailing={daySession ? undefined : <Plus className="size-[18px] text-sk-blue-link" weight="bold" aria-hidden />}
            />
          )
        })}
      </List>

      <div className="-ml-2.5 mt-2 flex flex-wrap gap-x-1">
        <Button variant="quiet" size="sm" disabled={activeWeek <= 1} title={activeWeek <= 1 ? "Week 1 has no week before it" : undefined} onClick={requestDuplicate}>
          <CopySimple className="size-4" weight="bold" aria-hidden />
          Duplicate last week
        </Button>
        <Button variant="quiet" size="sm" aria-expanded={tool === "ab"} onClick={() => setTool(tool === "ab" ? null : "ab")}>
          <Swap className="size-4" weight="bold" aria-hidden />
          A/B days
        </Button>
      </div>

      {tool === "duplicate-confirm" ? (
        <InlineConfirm
          className="mt-2"
          question={`Week ${activeWeek} already has ${plural(sessions.length, "session")}. Replace them with a copy of week ${activeWeek - 1}?`}
          confirmLabel={`Replace week ${activeWeek}`}
          onConfirm={duplicateLastWeek}
          onCancel={() => setTool(null)}
        />
      ) : null}

      {tool === "ab" ? (
        <ABDaysTool
          plan={plan}
          week={activeWeek}
          defaultA={session ? dayIndex : (sessions[0]?.dayIndex ?? null)}
          onCancel={() => setTool(null)}
          onApply={(a, b, targets) => {
            onChange((current) => applyABPattern(current, activeWeek, a, b, targets))
            setTool(null)
            setNotice(`A/B pattern applied to ${plural(targets.length, "day")}.`)
          }}
        />
      ) : null}
    </Section>
  )

  /* -------------------------------- One session -------------------------------- */

  const editor = session ? (
    <div ref={editorRef} className="contents">
      <Section title={isDesktop ? selectedDayName : undefined} hint={isDesktop ? `Week ${activeWeek}` : undefined}>
        {confirmCopy ? (
          <InlineConfirm
            question={`${copyTargetName} already has a session. Replace it with this one?`}
            confirmLabel={`Replace ${weekdayLabel(copyTargetDate ?? "")}`}
            onConfirm={copyToNextDay}
            onCancel={() => setConfirmCopy(false)}
          />
        ) : null}
        <FormGrid columns={4} className="mt-3">
          <Field label="Session title" className="sm:col-span-2">
            <Input
              data-session-title
              value={session.title}
              onChange={(event) => updateSession({ title: event.target.value })}
              placeholder="Acceleration and weights"
              enterKeyHint="next"
            />
          </Field>
          <Field label="Type">
            <Select value={session.sessionType} onChange={(event) => updateSession({ sessionType: event.target.value as SessionType })}>
              {SESSION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Minutes">
            <Input
              inputMode="numeric"
              value={session.durationMinutes}
              onChange={(event) => updateSession({ durationMinutes: event.target.value.replace(/[^0-9]/g, "").slice(0, 3) })}
              placeholder="75"
            />
          </Field>
          <Field label="Location" className="sm:col-span-2">
            <Input value={session.location} onChange={(event) => updateSession({ location: event.target.value })} placeholder="Track, gym, throws field" />
          </Field>
          <Field label="Coach note" className="sm:col-span-2">
            <Input value={session.notes} onChange={(event) => updateSession({ notes: event.target.value })} placeholder="What athletes should know before they start" />
          </Field>
        </FormGrid>
        <div className="-ml-2.5 mt-2 flex flex-wrap gap-x-1">
          <Button variant="quiet" size="sm" disabled={!copyTarget} title={copyTarget ? `Copies to ${copyTargetName}` : "This is the last day of the plan"} onClick={requestCopy}>
            <CopySimple className="size-4" weight="bold" aria-hidden />
            Copy to next day
          </Button>
          <Button variant="quiet" size="sm" className="text-sk-coral-ink hover:text-sk-coral-ink" onClick={removeAndClose}>
            <Trash className="size-4" weight="bold" aria-hidden />
            Remove session
          </Button>
        </div>
      </Section>

      <Section
        title="Blocks"
        hint={session.blocks.length === 0 ? "The parts of the session, in the order athletes do them." : undefined}
        meta={session.blocks.length > 0 ? plural(session.blocks.length, "block") : undefined}
      >
        {session.blocks.length > 0 ? (
          <ol className="sk-list">
            {session.blocks.map((block, blockIndex) => (
              <SessionBlock
                key={block.id}
                block={block}
                index={blockIndex}
                athletes={athletes}
                tools={exerciseTools}
                onChange={(updater) => updateBlock(block.id, updater)}
                onRemove={() => updateSession({ blocks: session.blocks.filter((candidate) => candidate.id !== block.id) })}
              />
            ))}
          </ol>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Add a block">
          {QUICK_BLOCKS[team?.eventGroup ?? "Sprint"].map((title) => (
            <Button key={title} size="sm" onClick={() => addBlock(title)}>
              <Plus className="size-4" weight="bold" aria-hidden />
              {title}
            </Button>
          ))}
          <Button size="sm" onClick={() => addBlock()}>
            <Plus className="size-4" weight="bold" aria-hidden />
            Custom block
          </Button>
        </div>
      </Section>
    </div>
  ) : (
    <Section title={isDesktop ? selectedDayName : undefined} hint={isDesktop ? `Week ${activeWeek}` : undefined}>
      <EmptyState
        title="Rest day"
        body="Nothing is planned on this day. Pick another day to edit its session, or add one here."
        action={
          <Button size="sm" onClick={() => openDay(dayIndex)}>
            <Plus className="size-4" weight="bold" aria-hidden />
            Add a session on {weekdayLabel(selectedDate)}
          </Button>
        }
      />
    </Section>
  )

  const showEditorOnly = !isDesktop && mobileEditorOpen

  return (
    <Screen>
      {showEditorOnly ? (
        <ScreenHeader back={{ onClick: () => onMobileEditorChange(false), label: `Week ${activeWeek}` }} title={selectedDayName} />
      ) : (
        <ScreenHeader
          back={{ onClick: onBack, label: "All plans" }}
          fact={<PlanStatusText status={plan.status} />}
          title={plan.name || "Untitled plan"}
          lede={[team?.name ?? "No team", plural(plan.weeks, "week"), formatDateRange(plan.startDate, planEndDate(plan))].join(", ")}
          actions={
            <>
              <Button onClick={() => onPrint(activeWeek)}>
                <Printer className="size-5" weight="bold" aria-hidden />
                Print
              </Button>
              <Button onClick={onEditDetails}>
                <PencilSimple className="size-5" weight="bold" aria-hidden />
                Plan details
              </Button>
              <RowMenu label="More for this plan" items={[{ label: "Save as template", onSelect: onSaveAsTemplate, disabled: busy }]} />
            </>
          }
        />
      )}

      {error ? <Notice tone="error">{error}</Notice> : null}

      {showEditorOnly ? null : (
        <Tabs<string>
          label="Week"
          value={String(activeWeek)}
          onChange={(next) => selectWeek(Number(next))}
          options={Array.from({ length: plan.weeks }, (_, index) => ({ value: String(index + 1), label: `Week ${index + 1}` }))}
        />
      )}

      {isDesktop ? <Split main={editor} side={weekSection} /> : showEditorOnly ? editor : weekSection}

      <ActionBar aria-label="Save and publish">
        <div className="flex min-w-0 items-center gap-1">
          <p aria-live="polite" className="truncate text-sm font-semibold text-sk-mute">
            {status}
          </p>
          {isPublished ? null : (
            <Button
              variant="quiet"
              size="sm"
              disabled={busy}
              onClick={() => {
                setNotice(null)
                onSaveDraft()
              }}
            >
              Save draft
            </Button>
          )}
        </div>
        <Button variant="primary" onClick={onReview} disabled={busy}>
          {isPublished ? "Review and update" : "Publish"}
          <ArrowRight className="size-5" weight="bold" aria-hidden />
        </Button>
      </ActionBar>
    </Screen>
  )
}

/** One block of a session: its name, a line of details and its exercises. */
function SessionBlock({
  block,
  index,
  athletes,
  tools,
  onChange,
  onRemove,
}: {
  block: BlockDraft
  index: number
  athletes: AthleteOption[]
  tools: ExerciseTools
  onChange: (updater: (block: BlockDraft) => BlockDraft) => void
  onRemove: () => void
}) {
  return (
    <li data-block data-block-id={block.id} className="py-4 first:pt-2">
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_2.75rem] items-center gap-2 sm:grid-cols-[1.5rem_minmax(0,13rem)_minmax(0,1fr)_2.75rem]">
        <span className="text-center text-base font-extrabold tabular-nums text-sk-mute" aria-hidden>
          {index + 1}
        </span>
        <input
          className="sk-field font-bold"
          data-block-field="name"
          aria-label={`Block ${index + 1} name`}
          placeholder="Block name"
          enterKeyHint="next"
          value={block.title}
          onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            event.currentTarget.closest("[data-block]")?.querySelector<HTMLInputElement>('[data-block-field="details"]')?.focus()
          }}
        />
        <input
          className="sk-field order-last col-span-3 sm:order-none sm:col-span-1"
          data-block-field="details"
          aria-label={`Block ${index + 1} details`}
          placeholder="Details, for example 6 x 30m, full recovery"
          enterKeyHint="next"
          value={block.notes}
          onChange={(event) => onChange((current) => ({ ...current, notes: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            // Enter carries on into the exercises: the first one, or a new one.
            const root = event.currentTarget.closest("[data-block]")
            const first = root?.querySelector<HTMLInputElement>('[data-cell="0:0"]')
            if (first) first.focus()
            else root?.querySelector<HTMLButtonElement>("[data-add-row]")?.click()
          }}
        />
        <button
          type="button"
          className="inline-flex size-11 cursor-pointer items-center justify-center rounded-[12px] text-sk-mute transition-colors hover:bg-sk-soft hover:text-sk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
          aria-label={`Remove block ${index + 1}`}
          onClick={onRemove}
        >
          <X className="size-4" weight="bold" aria-hidden />
        </button>
      </div>

      <ExerciseRows
        className="mt-2 sm:pl-8"
        blockIndex={index}
        blockTitle={block.title}
        exercises={block.exercises}
        athletes={athletes}
        tools={tools}
        onChange={(updater) => onChange((current) => ({ ...current, exercises: updater(current.exercises) }))}
      />
    </li>
  )
}

function ABDaysTool({
  plan,
  week,
  defaultA,
  onCancel,
  onApply,
}: {
  plan: PlanDraft
  week: number
  defaultA: number | null
  onCancel: () => void
  onApply: (aDayIndex: number, bDayIndex: number | null, targets: number[]) => void
}) {
  const sessions = weekSessions(plan, week)
  const sessionDays = sessions.map((item) => item.dayIndex)
  const [aDay, setADay] = useState<number | null>(defaultA)
  const [bDay, setBDay] = useState<number | null>(() => sessionDays.find((index) => index !== defaultA) ?? null)
  const [targets, setTargets] = useState<number[]>(() => (sessionDays.length >= 2 ? sessionDays : [0, 1, 2, 3]))

  const dayName = (index: number) => weekdayLabel(slotDate(plan, week, index))
  const sessionName = (index: number) => {
    const item = getSession(plan, week, index)
    return `${dayName(index)}: ${item?.title || "Untitled session"}`
  }

  if (sessions.length === 0 || aDay === null) {
    return (
      <div className="mt-2 flex flex-col items-start gap-1 border-y border-sk-line py-3" role="group" aria-label="A/B days">
        <p className="text-[0.9375rem] text-sk-ink-2">
          <span className="font-semibold text-sk-ink">A/B days alternate two sessions across the week.</span> Add a session first. It becomes day A.
        </p>
        <Button variant="quiet" size="sm" className="-ml-2.5" onClick={onCancel}>
          Close
        </Button>
      </div>
    )
  }

  const sorted = [...targets].sort((left, right) => left - right)
  const chooseA = (next: number) => {
    setADay(next)
    if (bDay === next) setBDay(sessionDays.find((index) => index !== next) ?? null)
  }

  return (
    <div className="mt-2 flex flex-col gap-4 border-y border-sk-line py-4" role="group" aria-label="A/B days">
      <p className="text-[0.9375rem] text-sk-ink-2">
        <span className="font-semibold text-sk-ink">A/B days alternate two sessions across the week.</span> Pick the two sessions and the days to fill. Those days are replaced.
      </p>
      <FormGrid>
        <Field label="Session A">
          <Select value={aDay} onChange={(event) => chooseA(Number(event.target.value))}>
            {sessionDays.map((index) => (
              <option key={index} value={index}>
                {sessionName(index)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Session B">
          <Select value={bDay === null ? "new" : bDay} onChange={(event) => setBDay(event.target.value === "new" ? null : Number(event.target.value))}>
            {sessionDays
              .filter((index) => index !== aDay)
              .map((index) => (
                <option key={index} value={index}>
                  {sessionName(index)}
                </option>
              ))}
            <option value="new">New empty session B</option>
          </Select>
        </Field>
      </FormGrid>
      <div>
        <p className="sk-field-label mb-1.5">Days to fill</p>
        <DayChecks
          label="Days to fill"
          days={DAY_INDEXES.map((index) => ({
            key: String(index),
            label: dayName(index),
            checked: targets.includes(index),
            mark: sorted.indexOf(index) % 2 === 0 ? "A" : "B",
          }))}
          onToggle={(key) => {
            const index = Number(key)
            setTargets((current) => (current.includes(index) ? current.filter((value) => value !== index) : [...current, index]))
          }}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={targets.length < 2 || bDay === aDay} onClick={() => onApply(aDay, bDay === aDay ? null : bDay, targets)}>
          Apply A/B days
        </Button>
        <Button variant="quiet" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
