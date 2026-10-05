import { ArrowLeft, ArrowRight, CaretRight, CopySimple, FloppyDisk, PencilSimple, Plus, Swap, Trash, X } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import { PageHeader, Panel, Segmented } from "@/components/sk"
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
  newExercise,
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
import { cn } from "@/lib/utils"
import { PlanStatusTag } from "./plan-list"
import type { TeamOption } from "./storage"
import { ErrorNote, Field, STICKY_PAGE, StickyBar, plural } from "./ui"

const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6]

type WeekTool = null | "duplicate-confirm" | "ab"

export function PlanBuilder({
  plan,
  team,
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
}: {
  plan: PlanDraft
  team: TeamOption | null
  dirty: boolean
  busy: boolean
  error: string | null
  savedLabel: string | null
  /** On phones the session editor replaces the week list. The shell Back button closes it. */
  mobileEditorOpen: boolean
  onMobileEditorChange: (open: boolean) => void
  onChange: (updater: (plan: PlanDraft) => PlanDraft) => void
  onBack: () => void
  onEditDetails: () => void
  onSaveDraft: () => void
  onReview: () => void
}) {
  const [week, setWeek] = useState(1)
  const [dayIndex, setDayIndex] = useState(() => weekSessions(plan, 1)[0]?.dayIndex ?? 0)
  const [tool, setTool] = useState<WeekTool>(null)
  const [confirmCopy, setConfirmCopy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)

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
    }
    onMobileEditorChange(true)
    if (window.matchMedia("(min-width: 1024px)").matches) {
      window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }))
    } else {
      document.getElementById("main-content")?.scrollTo({ top: 0 })
    }
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

  const copyToNextDay = () => {
    if (!session || !copyTarget) return
    onChange((current) => copySessionToNextDay(current, activeWeek, dayIndex))
    setConfirmCopy(false)
    setNotice(`Copied this session to ${copyTargetName}.`)
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
    setNotice(`Copied ${plural(copied, "session")} from week ${activeWeek - 1} into week ${activeWeek}.`)
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

  const status = notice ?? (busy ? "Saving..." : dirty ? "You have unsaved changes." : savedLabel)

  return (
    <div className={STICKY_PAGE}>
      <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm -ml-3 hidden self-start lg:inline-flex" onClick={onBack}>
        <ArrowLeft className="size-4" weight="bold" />
        All plans
      </button>

      <div className={cn("space-y-6 lg:space-y-8", mobileEditorOpen && "hidden lg:block")}>
        <PageHeader
          title={plan.name || "Untitled plan"}
          lede={[team?.name ?? "No team", plural(plan.weeks, "week"), formatDateRange(plan.startDate, planEndDate(plan))].join(" · ")}
          actions={
            <button type="button" className="sk-btn sk-btn-quiet" onClick={onEditDetails}>
              <PencilSimple className="size-5" weight="bold" />
              Plan details
            </button>
          }
        >
          <PlanStatusTag status={plan.status} />
        </PageHeader>

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        <Panel>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="-mx-1 max-w-full overflow-x-auto px-1">
              <Segmented<string>
                label="Week"
                value={String(activeWeek)}
                onChange={(next) => selectWeek(Number(next))}
                options={Array.from({ length: plan.weeks }, (_, index) => ({
                  value: String(index + 1),
                  label: <span className="whitespace-nowrap">Week {index + 1}</span>,
                }))}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="sk-btn sk-btn-quiet sk-btn-sm"
                disabled={activeWeek <= 1}
                title={activeWeek <= 1 ? "Week 1 has no week before it" : undefined}
                onClick={requestDuplicate}
              >
                <CopySimple className="size-4" weight="bold" />
                Duplicate last week
              </button>
              <button
                type="button"
                className="sk-btn sk-btn-quiet sk-btn-sm"
                aria-expanded={tool === "ab"}
                onClick={() => setTool(tool === "ab" ? null : "ab")}
              >
                <Swap className="size-4" weight="bold" />
                A/B days
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-x-4 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
            <h2 className="sk-h2">
              Week {activeWeek}
              <span className="ml-2 text-base font-semibold tracking-normal text-sk-mute">
                {formatDateRange(slotDate(plan, activeWeek, 0), slotDate(plan, activeWeek, 6))}
              </span>
            </h2>
            <input
              className="sk-field sm:ml-auto sm:max-w-sm"
              aria-label={`Week ${activeWeek} focus`}
              placeholder="Week focus (optional), e.g. acceleration"
              value={plan.weekFocus[String(activeWeek)] ?? ""}
              onChange={(event) =>
                onChange((current) => ({ ...current, weekFocus: { ...current.weekFocus, [String(activeWeek)]: event.target.value } }))
              }
            />
          </div>

          {tool === "duplicate-confirm" ? (
            <div className="sk-well mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-semibold text-sk-ink">
                Week {activeWeek} already has {plural(sessions.length, "session")}. Replace them with a copy of week {activeWeek - 1}?
              </p>
              <div className="flex gap-2">
                <button type="button" className="sk-btn sk-btn-ink sk-btn-sm" onClick={duplicateLastWeek}>
                  Replace week {activeWeek}
                </button>
                <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm" onClick={() => setTool(null)}>
                  Keep it
                </button>
              </div>
            </div>
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
                setNotice(`A/B pattern applied to ${plural(targets.length, "day")} in week ${activeWeek}.`)
              }}
            />
          ) : null}

          <ol className="mt-5 grid gap-2 lg:grid-cols-7" aria-label={`Week ${activeWeek} days`}>
            {DAY_INDEXES.map((index) => {
              const date = slotDate(plan, activeWeek, index)
              const daySession = getSession(plan, activeWeek, index)
              const selected = index === dayIndex
              const dayName = `${weekdayLabel(date)} ${formatDayMonth(date)}`
              return (
                <li key={index} className="min-w-0">
                  <button
                    type="button"
                    data-day-index={index}
                    data-has-session={Boolean(daySession)}
                    aria-current={selected ? "true" : undefined}
                    aria-label={daySession ? `${dayName}: ${daySession.title || "Untitled session"}. Edit session` : `${dayName}: rest day. Add session`}
                    onClick={() => openDay(index)}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue lg:min-h-[168px] lg:flex-col lg:items-stretch lg:gap-2",
                      daySession ? "border-transparent bg-sk-canvas hover:border-sk-line" : "border-dashed border-sk-line bg-white hover:border-sk-blue",
                      selected && "lg:border-solid lg:border-sk-blue lg:hover:border-sk-blue",
                    )}
                  >
                    <span className="flex w-12 shrink-0 flex-col lg:w-auto lg:flex-row lg:items-baseline lg:justify-between">
                      <span className="font-bold text-sk-ink">{weekdayLabel(date)}</span>
                      <span className="text-sm text-sk-mute">{formatDayMonth(date)}</span>
                    </span>
                    {daySession ? (
                      <span className="min-w-0 flex-1 lg:flex lg:flex-col">
                        <span className="block truncate font-bold leading-snug text-sk-ink lg:line-clamp-3 lg:whitespace-normal">
                          {daySession.title || "Untitled session"}
                        </span>
                        <span className="mt-0.5 block text-sm text-sk-mute lg:mt-auto lg:pt-2">
                          {daySession.sessionType} · {plural(daySession.blocks.length, "block")}
                        </span>
                      </span>
                    ) : (
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-2 lg:flex-col lg:justify-center lg:gap-1">
                        <span className="text-sm text-sk-mute">Rest day</span>
                        <span className="inline-flex items-center gap-1 text-sm font-bold text-sk-blue">
                          <Plus className="size-4" weight="bold" />
                          Add session
                        </span>
                      </span>
                    )}
                    {daySession ? <CaretRight className="size-4 shrink-0 text-sk-mute lg:hidden" weight="bold" /> : null}
                  </button>
                </li>
              )
            })}
          </ol>
        </Panel>
      </div>

      <div ref={editorRef} className={cn("scroll-mt-4", !mobileEditorOpen && "hidden lg:block")}>
        {session ? (
          <Panel
            title={selectedDayName}
            hint={`Week ${activeWeek} session`}
          >
            <div className="mb-5 border-b border-sk-line pb-4">
              {confirmCopy ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-semibold text-sk-ink">{copyTargetName} already has a session. Replace it with this one?</p>
                  <div className="flex gap-2">
                    <button type="button" className="sk-btn sk-btn-ink sk-btn-sm" onClick={copyToNextDay}>
                      Replace {weekdayLabel(copyTargetDate ?? "")}
                    </button>
                    <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm" onClick={() => setConfirmCopy(false)}>
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="sk-btn sk-btn-quiet sk-btn-sm"
                    disabled={!copyTarget}
                    title={copyTarget ? `Copies to ${copyTargetName}` : "This is the last day of the plan"}
                    onClick={requestCopy}
                  >
                    <CopySimple className="size-4" weight="bold" />
                    Copy to next day
                  </button>
                  <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm" onClick={removeAndClose}>
                    <Trash className="size-4" weight="bold" />
                    Remove session
                  </button>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Session title" className="sm:col-span-2">
                <input
                  className="sk-field"
                  value={session.title}
                  onChange={(event) => updateSession({ title: event.target.value })}
                  placeholder="Acceleration and weights"
                />
              </Field>
              <Field label="Type">
                <select
                  className="sk-field"
                  value={session.sessionType}
                  onChange={(event) => updateSession({ sessionType: event.target.value as SessionType })}
                >
                  {SESSION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Minutes">
                <input
                  className="sk-field"
                  inputMode="numeric"
                  value={session.durationMinutes}
                  onChange={(event) => updateSession({ durationMinutes: event.target.value.replace(/[^0-9]/g, "").slice(0, 3) })}
                  placeholder="75"
                />
              </Field>
              <Field label="Location" className="sm:col-span-2">
                <input
                  className="sk-field"
                  value={session.location}
                  onChange={(event) => updateSession({ location: event.target.value })}
                  placeholder="Track, gym, throws field"
                />
              </Field>
              <Field label="Coach note" className="sm:col-span-2">
                <input
                  className="sk-field"
                  value={session.notes}
                  onChange={(event) => updateSession({ notes: event.target.value })}
                  placeholder="What athletes should know before they start"
                />
              </Field>
            </div>

            <h3 className="sk-h3 mt-7">Blocks</h3>
            {session.blocks.length === 0 ? (
              <p className="mt-1 text-sm text-sk-mute">No blocks yet. Add the parts of the session in the order athletes do them.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {session.blocks.map((block, blockIndex) => (
                  <li key={block.id} className="sk-well" data-block>
                    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_2.75rem] items-center gap-2 sm:grid-cols-[1.5rem_minmax(0,14rem)_minmax(0,1fr)_2.75rem]">
                      <span className="text-center text-sm font-extrabold tabular-nums text-sk-mute">{blockIndex + 1}</span>
                      <input
                        className="sk-field font-bold"
                        aria-label={`Block ${blockIndex + 1} name`}
                        placeholder="Block name"
                        value={block.title}
                        onChange={(event) => updateBlock(block.id, (current) => ({ ...current, title: event.target.value }))}
                      />
                      <input
                        className="sk-field order-last col-span-3 sm:order-none sm:col-span-1"
                        aria-label={`Block ${blockIndex + 1} details`}
                        placeholder="Details, e.g. 6 x 30m, full recovery"
                        value={block.notes}
                        onChange={(event) => updateBlock(block.id, (current) => ({ ...current, notes: event.target.value }))}
                      />
                      <button
                        type="button"
                        className="sk-btn sk-btn-ghost size-11 px-0"
                        aria-label={`Remove block ${blockIndex + 1}`}
                        onClick={() => updateSession({ blocks: session.blocks.filter((candidate) => candidate.id !== block.id) })}
                      >
                        <X className="size-4" weight="bold" />
                      </button>
                    </div>

                    <div className="mt-3 space-y-2 sm:pl-8">
                      {block.exercises.length > 0 ? (
                        <div className="hidden grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_6rem_2.75rem] gap-2 text-sm font-semibold text-sk-mute sm:grid">
                          <span>Exercise</span>
                          <span>Sets</span>
                          <span>Reps</span>
                          <span>Load</span>
                        </div>
                      ) : null}
                      {block.exercises.map((exercise, exerciseIndex) => {
                        const setExercise = (patch: Partial<typeof exercise>) =>
                          updateBlock(block.id, (current) => ({
                            ...current,
                            exercises: current.exercises.map((candidate) => (candidate.id === exercise.id ? { ...candidate, ...patch } : candidate)),
                          }))
                        const label = `Block ${blockIndex + 1} exercise ${exerciseIndex + 1}`
                        return (
                          <div
                            key={exercise.id}
                            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_6rem_2.75rem]"
                          >
                            <input
                              className="sk-field col-span-4 sm:col-span-1"
                              aria-label={`${label} name`}
                              placeholder="Exercise"
                              value={exercise.name}
                              onChange={(event) => setExercise({ name: event.target.value })}
                            />
                            <input className="sk-field px-2.5" aria-label={`${label} sets`} placeholder="Sets" value={exercise.sets} onChange={(event) => setExercise({ sets: event.target.value })} />
                            <input className="sk-field px-2.5" aria-label={`${label} reps`} placeholder="Reps" value={exercise.reps} onChange={(event) => setExercise({ reps: event.target.value })} />
                            <input className="sk-field px-2.5" aria-label={`${label} load`} placeholder="Load" value={exercise.load} onChange={(event) => setExercise({ load: event.target.value })} />
                            <button
                              type="button"
                              className="sk-btn sk-btn-ghost size-11 px-0"
                              aria-label={`Remove ${label}`}
                              onClick={() =>
                                updateBlock(block.id, (current) => ({
                                  ...current,
                                  exercises: current.exercises.filter((candidate) => candidate.id !== exercise.id),
                                }))
                              }
                            >
                              <X className="size-4" weight="bold" />
                            </button>
                          </div>
                        )
                      })}
                      <button
                        type="button"
                        className="sk-btn sk-btn-ghost sk-btn-sm -ml-3"
                        onClick={() => updateBlock(block.id, (current) => ({ ...current, exercises: [...current.exercises, newExercise()] }))}
                      >
                        <Plus className="size-4" weight="bold" />
                        Add exercise
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <div className="mt-4">
              <p className="sk-label">Add a block</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {QUICK_BLOCKS[team?.eventGroup ?? "Sprint"].map((title) => (
                  <button
                    key={title}
                    type="button"
                    className="sk-btn sk-btn-quiet sk-btn-sm"
                    onClick={() => updateSession({ blocks: [...session.blocks, newBlock(title)] })}
                  >
                    <Plus className="size-4" weight="bold" />
                    {title}
                  </button>
                ))}
                <button
                  type="button"
                  className="sk-btn sk-btn-quiet sk-btn-sm"
                  onClick={() => updateSession({ blocks: [...session.blocks, newBlock()] })}
                >
                  <Plus className="size-4" weight="bold" />
                  Custom block
                </button>
              </div>
            </div>

            <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm mt-6 lg:hidden" onClick={() => onMobileEditorChange(false)}>
              <ArrowLeft className="size-4" weight="bold" />
              Back to week {activeWeek}
            </button>
          </Panel>
        ) : (
          <section className="flex flex-col items-start gap-3 rounded-[20px] border border-dashed border-[#cdd2de] bg-white p-6">
            <div>
              <h2 className="sk-h3">{selectedDayName} is a rest day</h2>
              <p className="mt-1 text-sm text-sk-mute">Pick a day above to edit its session, or add one here.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="sk-btn sk-btn-ink sk-btn-sm" onClick={() => openDay(dayIndex)}>
                <Plus className="size-4" weight="bold" />
                Add a session on {weekdayLabel(selectedDate)}
              </button>
              <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm lg:hidden" onClick={() => onMobileEditorChange(false)}>
                Back to week {activeWeek}
              </button>
            </div>
          </section>
        )}
      </div>

      <StickyBar status={status}>
        {isPublished ? null : (
          <button
            type="button"
            className="sk-btn sk-btn-quiet"
            disabled={busy}
            onClick={() => {
              setNotice(null)
              onSaveDraft()
            }}
          >
            <FloppyDisk className="size-5" weight="bold" />
            Save draft
          </button>
        )}
        <button type="button" className="sk-btn sk-btn-primary" onClick={onReview} disabled={busy}>
          {isPublished ? "Review and update" : "Publish"}
          <ArrowRight className="size-5" weight="bold" />
        </button>
      </StickyBar>
    </div>
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
      <div className="sk-well mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sk-ink-2">
          <span className="font-semibold text-sk-ink">A/B days alternate two sessions across the week.</span> Add a session first, it becomes day A.
        </p>
        <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm" onClick={onCancel}>
          Close
        </button>
      </div>
    )
  }

  const sorted = [...targets].sort((left, right) => left - right)
  const chooseA = (next: number) => {
    setADay(next)
    if (bDay === next) setBDay(sessionDays.find((index) => index !== next) ?? null)
  }

  return (
    <div className="sk-well mt-4 space-y-4" role="group" aria-label="A/B days">
      <p className="text-sk-ink-2">
        <span className="font-semibold text-sk-ink">A/B days alternate two sessions across the week.</span> Pick the two sessions and the days to fill. Those days are replaced.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Session A">
          <select className="sk-field" value={aDay} onChange={(event) => chooseA(Number(event.target.value))}>
            {sessionDays.map((index) => (
              <option key={index} value={index}>
                {sessionName(index)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Session B">
          <select className="sk-field" value={bDay === null ? "new" : bDay} onChange={(event) => setBDay(event.target.value === "new" ? null : Number(event.target.value))}>
            {sessionDays
              .filter((index) => index !== aDay)
              .map((index) => (
                <option key={index} value={index}>
                  {sessionName(index)}
                </option>
              ))}
            <option value="new">New empty session B</option>
          </select>
        </Field>
      </div>
      <fieldset>
        <legend className="sk-label">Days to fill</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {DAY_INDEXES.map((index) => {
            const checked = targets.includes(index)
            const position = sorted.indexOf(index)
            return (
              <label
                key={index}
                className={cn(
                  "flex h-11 cursor-pointer items-center gap-2 rounded-[14px] border px-3 text-sm font-bold",
                  checked ? "border-sk-blue bg-sk-blue-tint text-sk-ink" : "border-sk-line bg-white text-sk-ink-2",
                )}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[#2152ff]"
                  checked={checked}
                  onChange={() => setTargets((current) => (checked ? current.filter((value) => value !== index) : [...current, index]))}
                />
                {dayName(index)}
                {checked ? <span className="tabular-nums text-sk-blue">{position % 2 === 0 ? "A" : "B"}</span> : null}
              </label>
            )
          })}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <button
          type="button"
          className="sk-btn sk-btn-ink sk-btn-sm"
          disabled={targets.length < 2 || bDay === aDay}
          onClick={() => onApply(aDay, bDay === aDay ? null : bDay, targets)}
        >
          Apply A/B days
        </button>
        <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
