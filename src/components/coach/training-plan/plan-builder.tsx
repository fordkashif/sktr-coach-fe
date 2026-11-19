import { ArrowRight, CopySimple, PencilSimple, Printer } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActionBar,
  Button,
  Dialog,
  DayChecks,
  Field,
  FormGrid,
  InlineConfirm,
  Input,
  Notice,
  RowMenu,
  Screen,
  ScreenHeader,
  Section,
  Select,
  Sheet,
  Tabs,
} from "@/components/sk"
import {
  applyABPattern,
  copySessionToNextDay,
  duplicatePreviousWeek,
  formatDateRange,
  formatDayMonth,
  getSession,
  nextSlot,
  planEndDate,
  putSession,
  removeSession,
  slotDate,
  weekSessions,
  weekdayLabel,
    type PlanDraft,
} from "@/lib/data/training-plan/plan-builder-model"
import { WEEK_TYPES, cleanTargetLoad, isWeekType, phaseForWeek, plannedWeekLoad } from "@/lib/data/training-plan/plan-phases"
import { BoardDay } from "./plan-board"
import { DaySheet, PasteWeekButton, PasteWeekDialog, SessionDetailsDialog, type SheetFocus } from "./plan-sheet"
import { PlanOverview, usePlanMarkers } from "./plan-overview"
import type { AthleteOption, TeamOption } from "./storage"
import { PlanStatusText, plural } from "./ui"
import { useExerciseTools } from "./use-exercise-tools"

const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6]

type WeekTool = null | "duplicate-confirm" | "ab" | "settings" | "copy-rest-confirm"

export function PlanBuilder({
  plan,
  team,
  athletes,
  dirty,
  busy,
  error,
  savedLabel,
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
  const [tool, setTool] = useState<WeekTool>(null)
  const [confirmCopyDay, setConfirmCopyDay] = useState<number | null>(null)
  const [detailsDay, setDetailsDay] = useState<number | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [tableDay, setTableDay] = useState<number | null>(null)
  const [focusDay, setFocusDay] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const athleteIds = useMemo(() => athletes.map((athlete) => athlete.id), [athletes])
  const exerciseTools = useExerciseTools(athleteIds)
  const sheetRef = useRef<HTMLOListElement | null>(null)
  const tableRef = useRef<HTMLOListElement | null>(null)
  const clearFocusDay = useCallback(() => setFocusDay(null), [])
  const markers = usePlanMarkers(plan, team?.name ?? null)
  const pendingFocus = useRef<SheetFocus>(null)

  const activeWeek = Math.min(week, plan.weeks)
  const sessions = weekSessions(plan, activeWeek)
  const isPublished = plan.status === "published"
  const weekPhase = phaseForWeek(plan.phases, activeWeek)
  const weekPlanned = plannedWeekLoad(plan.sessions, activeWeek)
  const weekTarget = plan.weekTargetLoad?.[String(activeWeek)] ?? null
  const weekFocus = plan.weekFocus[String(activeWeek)]?.trim() ?? ""
  const dayName = (index: number) => {
    const date = slotDate(plan, activeWeek, index)
    return `${weekdayLabel(date)} ${formatDayMonth(date)}`
  }

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const target = pendingFocus.current
    const root = tableRef.current
    if (!target || !root) return
    const node =
      target.kind === "title"
        ? root.querySelector<HTMLInputElement>(`[data-day-title="${target.dayIndex}"]`)
        : target.kind === "section"
          ? root.querySelector<HTMLInputElement>(`[data-block-id="${target.blockId}"] [data-block-field="name"]`)
          : root.querySelector<HTMLInputElement>(`[data-exercise-id="${target.exerciseId}"] [data-cell$=":0"]`)
    if (!node) return
    pendingFocus.current = null
    node.focus()
    // A row started from the "type an exercise" line keeps the first letter typed: the cursor goes after it.
    const end = node.value.length
    node.setSelectionRange?.(end, end)
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
    setTool(null)
    setConfirmCopyDay(null)
  }

  const copyToNextDay = (index: number) => {
    const target = nextSlot(plan, activeWeek, index)
    if (!target) return
    const date = slotDate(plan, target.week, target.dayIndex)
    onChange((current) => copySessionToNextDay(current, activeWeek, index))
    setConfirmCopyDay(null)
    setNotice(`Copied to ${weekdayLabel(date)} ${formatDayMonth(date)}.`)
  }

  const requestCopy = (index: number) => {
    const target = nextSlot(plan, activeWeek, index)
    if (!target) return
    if (getSession(plan, target.week, target.dayIndex)) setConfirmCopyDay(index)
    else copyToNextDay(index)
  }

  const duplicateLastWeek = () => {
    const copied = weekSessions(plan, activeWeek - 1).length
    onChange((current) => duplicatePreviousWeek(current, activeWeek))
    setTool(null)
    setNotice(`Copied ${plural(copied, "session")} from week ${activeWeek - 1}.`)
  }

  const requestDuplicate = () => {
    if (activeWeek <= 1) return
    if (sessions.length > 0) setTool("duplicate-confirm")
    else duplicateLastWeek()
  }

  const laterWeeks = plan.weeks - activeWeek
  const laterSessions = plan.sessions.filter((session) => session.week > activeWeek).length
  const copyToRest = () => {
    onChange((current) => {
      let next = current
      for (let target = activeWeek + 1; target <= current.weeks; target += 1) next = duplicatePreviousWeek(next, target)
      return next
    })
    setTool(null)
    setNotice(laterWeeks === 1 ? `Copied to week ${activeWeek + 1}.` : `Copied to weeks ${activeWeek + 1} to ${plan.weeks}.`)
  }
  const requestCopyToRest = () => {
    if (laterWeeks <= 0 || sessions.length === 0) return
    if (laterSessions > 0) setTool("copy-rest-confirm")
    else copyToRest()
  }

  const copyTarget = confirmCopyDay === null ? null : nextSlot(plan, activeWeek, confirmCopyDay)
  const copyTargetDate = copyTarget ? slotDate(plan, copyTarget.week, copyTarget.dayIndex) : ""
  const detailsSession = detailsDay === null ? null : getSession(plan, activeWeek, detailsDay)
  const status = notice ?? (busy ? "Saving..." : dirty ? "Unsaved changes" : savedLabel)

  return (
    <Screen className="sk-page-board">
      <ScreenHeader
        back={{ onClick: onBack, label: "All plans" }}
        fact={<PlanStatusText status={plan.status} />}
        title={plan.name || "Untitled plan"}
        lede={[team?.name ?? "No team", plural(plan.weeks, "week"), formatDateRange(plan.startDate, planEndDate(plan))].join(", ")}
        actions={
          <>
            <PasteWeekButton onClick={() => setPasteOpen(true)} />
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

      {error ? <Notice tone="error">{error}</Notice> : null}

      {plan.weeks > 1 ? (
        <>
          <Tabs<string>
            label="Week"
            value={String(activeWeek)}
            onChange={(next) => selectWeek(Number(next))}
            options={Array.from({ length: plan.weeks }, (_, index) => ({ value: String(index + 1), label: `Week ${index + 1}` }))}
          />
        </>
      ) : null}

      <Section
        title={`Week ${activeWeek}`}
        hint={[formatDateRange(slotDate(plan, activeWeek, 0), slotDate(plan, activeWeek, 6)), weekPhase?.name, weekFocus].filter(Boolean).join(", ")}
        meta={
          <span className="flex items-center gap-2">
            {sessions.length === 0 ? "No sessions yet" : plural(sessions.length, "session")}
            <RowMenu
              label={`Tools for week ${activeWeek}`}
              items={[
                { label: "Week focus and load", onSelect: () => window.setTimeout(() => setTool("settings"), 0), opensOverlay: true },
                { label: "Duplicate last week", onSelect: requestDuplicate, disabled: activeWeek <= 1 },
                { label: "A/B days", onSelect: () => setTool(tool === "ab" ? null : "ab") },
              ]}
            />
          </span>
        }
      >
        {weekPlanned.load !== null ? (
          <p className="mt-1 text-sm text-sk-mute" data-week-planned-load>
            {`Planned load ${weekPlanned.load.toLocaleString("en-GB")}${weekTarget !== null ? ` of a target of ${weekTarget.toLocaleString("en-GB")}` : ""}, from ${weekPlanned.counted} of ${plural(weekPlanned.sessions, "session")}.`}
          </p>
        ) : null}

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
            defaultA={sessions[0]?.dayIndex ?? null}
            onCancel={() => setTool(null)}
            onApply={(a, b, targets) => {
              onChange((current) => applyABPattern(current, activeWeek, a, b, targets))
              setTool(null)
              setNotice(`A/B pattern applied to ${plural(targets.length, "day")}.`)
            }}
          />
        ) : null}

        {confirmCopyDay !== null && copyTarget ? (
          <InlineConfirm
            className="mt-2"
            question={`${weekdayLabel(copyTargetDate)} ${formatDayMonth(copyTargetDate)} already has a session. Replace it with ${dayName(confirmCopyDay)}?`}
            confirmLabel={`Replace ${weekdayLabel(copyTargetDate)}`}
            onConfirm={() => copyToNextDay(confirmCopyDay)}
            onCancel={() => setConfirmCopyDay(null)}
          />
        ) : null}

        {tool === "copy-rest-confirm" ? (
          <InlineConfirm
            className="mt-2"
            question={`Weeks ${activeWeek + 1} to ${plan.weeks} already have ${plural(laterSessions, "session")}. Replace them with copies of week ${activeWeek}?`}
            confirmLabel="Replace them"
            onConfirm={copyToRest}
            onCancel={() => setTool(null)}
          />
        ) : null}

        <nav className="sk-board-days" aria-label={`Days of week ${activeWeek}`}>
          {DAY_INDEXES.map((index) => {
            const date = slotDate(plan, activeWeek, index)
            return (
              <button
                key={index}
                type="button"
                data-on={getSession(plan, activeWeek, index) ? "" : undefined}
                onClick={() => sheetRef.current?.querySelector<HTMLElement>(`[data-board-day="${index}"]`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })}
              >
                {weekdayLabel(date).slice(0, 2)}
              </button>
            )
          })}
        </nav>

        <ol ref={sheetRef} className="sk-board" aria-label={`Week ${activeWeek} days`}>
          {DAY_INDEXES.map((index) => (
            <BoardDay
              key={`${activeWeek}:${index}`}
              plan={plan}
              week={activeWeek}
              dayIndex={index}
              tools={exerciseTools}
              focusLine={focusDay === index}
              canCopyNext={Boolean(nextSlot(plan, activeWeek, index))}
              onFocusDone={clearFocusDay}
              onStarted={() => setFocusDay(index)}
              onChange={onChange}
              // After the menu has closed: opening a sheet while the menu still holds the page leaves it unclickable.
              onOpenTable={() => window.setTimeout(() => setTableDay(index), 0)}
              onOpenDetails={() => window.setTimeout(() => setDetailsDay(index), 0)}
              onCopyNext={() => requestCopy(index)}
              onRemove={() => {
                onChange((current) => removeSession(current, activeWeek, index))
                setNotice(`Removed the ${dayName(index)} session.`)
              }}
              onNotice={setNotice}
            />
          ))}
        </ol>

        {laterWeeks > 0 && sessions.length > 0 ? (
          <Button size="sm" className="mt-3" onClick={requestCopyToRest}>
            <CopySimple className="size-4" weight="bold" aria-hidden />
            {laterWeeks === 1 ? `Copy to week ${activeWeek + 1}` : `Copy to weeks ${activeWeek + 1} to ${plan.weeks}`}
          </Button>
        ) : null}
      </Section>

      {plan.weeks > 1 ? <PlanOverview plan={plan} activeWeek={activeWeek} markers={markers} onSelectWeek={selectWeek} onChange={onChange} /> : null}

      {tool === "settings" ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setTool(null)
          }}
          title={`Week ${activeWeek}`}
          footer={
            <Button variant="primary" onClick={() => setTool(null)}>
              Done
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            <Field label="Week focus" optional>
              <Input
                placeholder="For example: acceleration"
                value={plan.weekFocus[String(activeWeek)] ?? ""}
                onChange={(event) => onChange((current) => ({ ...current, weekFocus: { ...current.weekFocus, [String(activeWeek)]: event.target.value } }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Week type" optional>
                <Select
                  value={plan.weekTypes?.[String(activeWeek)] ?? ""}
                  onChange={(event) =>
                    onChange((current) => {
                      const next = { ...(current.weekTypes ?? {}) }
                      if (isWeekType(event.target.value)) next[String(activeWeek)] = event.target.value
                      else delete next[String(activeWeek)]
                      return { ...current, weekTypes: next }
                    })
                  }
                >
                  <option value="">Not set</option>
                  {WEEK_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Target load" optional>
                <Input
                  inputMode="numeric"
                  placeholder="1500"
                  value={weekTarget === null ? "" : String(weekTarget)}
                  onChange={(event) =>
                    onChange((current) => {
                      const next = { ...(current.weekTargetLoad ?? {}) }
                      const target = cleanTargetLoad(event.target.value.replace(/[^0-9]/g, "").slice(0, 5))
                      if (target === null) delete next[String(activeWeek)]
                      else next[String(activeWeek)] = target
                      return { ...current, weekTargetLoad: next }
                    })
                  }
                />
              </Field>
            </div>
          </div>
        </Dialog>
      ) : null}

      {tableDay !== null ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) setTableDay(null)
          }}
          title={dayName(tableDay)}
          className="sm:max-w-4xl"
        >
          <ol ref={tableRef} className="sk-sheet-week mt-0" aria-label={`${dayName(tableDay)} as a table`}>
            <DaySheet
              plan={plan}
              week={activeWeek}
              dayIndex={tableDay}
              eventGroup={team?.eventGroup ?? "Sprint"}
              athletes={athletes}
              tools={exerciseTools}
              canCopyNext={Boolean(nextSlot(plan, activeWeek, tableDay))}
              onChange={onChange}
              onFocus={(target) => {
                pendingFocus.current = target
              }}
              onOpenSettings={() => window.setTimeout(() => setDetailsDay(tableDay), 0)}
              onCopyNext={() => requestCopy(tableDay)}
              onRemove={() => {
                onChange((current) => removeSession(current, activeWeek, tableDay))
                setTableDay(null)
                setNotice(`Removed the ${dayName(tableDay)} session.`)
              }}
              onNotice={setNotice}
            />
          </ol>
        </Sheet>
      ) : null}

      {detailsDay !== null && detailsSession ? (
        <SessionDetailsDialog
          session={detailsSession}
          dayName={dayName(detailsDay)}
          onClose={() => setDetailsDay(null)}
          onChange={(patch) =>
            onChange((current) => {
              const existing = getSession(current, activeWeek, detailsDay)
              return existing ? putSession(current, { ...existing, ...patch }) : current
            })
          }
        />
      ) : null}

      {pasteOpen ? (
        <PasteWeekDialog
          plan={plan}
          week={activeWeek}
          onClose={() => setPasteOpen(false)}
          onApply={(pasted) => {
            onChange((current) => pasted.reduce((next, session) => putSession(next, session), current))
            setPasteOpen(false)
            setNotice(`Filled ${plural(pasted.length, "day")} of week ${activeWeek}.`)
          }}
        />
      ) : null}

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
