"use client"

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { ProgressTabs } from "@/components/athlete/results-parts"
import {
  ActionBar,
  Button,
  EmptyState,
  Field,
  Input,
  LinkButton,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  SkeletonRows,
  Split,
  Stat,
  StatStrip,
  StatusDot,
  StatusText,
} from "@/components/sk"
import { eventGroupKey, formatMarkWithUnit, resolveEventByName, selectBests, type AthleteResult, type MarkUnit } from "@/lib/data/pr/marks"
import { buildMockResult, loadMockResultsState, mockDay, updateMockResultsState } from "@/lib/data/pr/mock-results-store"
import { getCurrentAthleteRecords } from "@/lib/data/pr/results-data"
import {
  getCurrentAthleteActiveTestWeekContext,
  getCurrentAthleteTestWeekHistory,
  submitCurrentAthleteTestWeekResults,
} from "@/lib/data/test-week/test-week-data"
import type { ActiveTestDefinition, AthleteTestWeekHistoryItem, CurrentAthleteTestWeekContext, TestDefinitionUnit } from "@/lib/data/test-week/types"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

type TestSubmission = Record<string, string>
type WeekPhase = "upcoming" | "open" | "closed"
type PersonalBestLine = { testName: string; mark: string; previous: string | null }

/** The athlete home screen hides its "test week results" to-do once this is set (mock mode only). */
const MOCK_SUBMITTED_STORAGE_KEY = "pacelab:test-week-submission"
const MOCK_WEEK_ID = "fallback-week"
const MOCK_WEEK_NAME = "Speed and power testing"

/** What the athlete types is a plain number. The unit is fixed by the test and named beside the field. */
const UNIT_META: Record<TestDefinitionUnit, { suffix: string; long: string; mark: MarkUnit }> = {
  time: { suffix: "s", long: "seconds", mark: "s" },
  distance: { suffix: "m", long: "metres", mark: "m" },
  weight: { suffix: "kg", long: "kilograms", mark: "kg" },
  height: { suffix: "cm", long: "centimetres", mark: "cm" },
  score: { suffix: "pts", long: "points", mark: "pts" },
}

const MAX_RESULT_VALUE = 100000

function localIsoDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseLocalDate(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

function shiftDate(iso: string, days: number) {
  const date = parseLocalDate(iso)
  date.setDate(date.getDate() + days)
  return localIsoDate(date)
}

function dayLabel(iso: string) {
  return parseLocalDate(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
}

function shortDate(value: string) {
  const date = value.length > 10 ? new Date(value) : parseLocalDate(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

function stamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

function numericOf(text: string): number | null {
  const parsed = Number.parseFloat(text.replace(",", ".").replace(/[^\d.-]/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

/** Returns the cleaned number as text, or an error message for the field. */
function checkEntry(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const normalized = raw.trim().replace(",", ".")
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) return { ok: false, message: "Numbers only, up to 3 decimals." }
  const numeric = Number.parseFloat(normalized)
  if (!(numeric > 0)) return { ok: false, message: "Must be more than 0." }
  if (numeric >= MAX_RESULT_VALUE) return { ok: false, message: "That number is too large." }
  return { ok: true, value: String(numeric) }
}

function inputValueFor(saved: { valueText: string; valueNumeric: number | null } | undefined) {
  if (!saved) return ""
  const numeric = saved.valueNumeric ?? numericOf(saved.valueText)
  return numeric === null ? "" : String(numeric)
}

function groupFor(test: Pick<ActiveTestDefinition, "name" | "unit">): string {
  const resolved = resolveEventByName(test.name, UNIT_META[test.unit].mark)
  return eventGroupKey(resolved.eventKey, resolved.label)
}

/* ---------- mock mode: a demo week kept in this browser only ---------- */

const MOCK_TESTS: Array<{ name: string; unit: TestDefinitionUnit; dayIndex: number; isRequired: boolean }> = [
  { name: "30m", unit: "time", dayIndex: 0, isRequired: true },
  { name: "Flying 30m", unit: "time", dayIndex: 0, isRequired: true },
  { name: "150m", unit: "time", dayIndex: 1, isRequired: true },
  { name: "Squat 1RM", unit: "weight", dayIndex: 1, isRequired: true },
  { name: "CMJ", unit: "height", dayIndex: 2, isRequired: false },
]

/** Mock mode only: `?state=none|upcoming|closed` previews the other screen states. Ignored in supabase mode. */
function buildMockContext(): CurrentAthleteTestWeekContext | null {
  const preview = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("state")
  if (preview === "none") return null

  const today = localIsoDate()
  const startDate = preview === "upcoming" ? shiftDate(today, 3) : preview === "closed" ? shiftDate(today, -6) : shiftDate(today, -1)
  const state = loadMockResultsState()
  const tests = MOCK_TESTS.map((test, index) => ({
    id: `fallback-${index}`,
    name: test.name,
    unit: test.unit,
    isRequired: test.isRequired,
    scheduledDate: shiftDate(startDate, test.dayIndex),
    dayIndex: test.dayIndex,
  }))

  const results: CurrentAthleteTestWeekContext["results"] = {}
  const previous: CurrentAthleteTestWeekContext["previous"] = {}
  let lastSubmittedAt: string | null = null
  for (const test of tests) {
    const saved = state.results.find((result) => result.testResultId === `${MOCK_WEEK_ID}:${test.id}`)
    if (saved) {
      results[test.id] = { valueText: formatMarkWithUnit(saved.display, saved.unit), valueNumeric: saved.value, submittedAt: saved.createdAt }
      if (!lastSubmittedAt || saved.createdAt > lastSubmittedAt) lastSubmittedAt = saved.createdAt
    }
    const earlier = state.results
      .filter((result) => result.source === "test_week" && result.eventGroup === groupFor(test) && !(result.testResultId ?? "").startsWith(`${MOCK_WEEK_ID}:`))
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    if (earlier) previous[test.id] = { valueText: formatMarkWithUnit(earlier.display, earlier.unit), submittedAt: earlier.date }
  }

  return {
    athleteId: "fallback-athlete",
    testWeekId: MOCK_WEEK_ID,
    testWeekName: MOCK_WEEK_NAME,
    startDate,
    endDate: shiftDate(startDate, 2),
    status: preview === "closed" ? "closed" : "published",
    tests,
    lastSubmittedAt,
    results,
    previous,
  }
}

/** Mock mode only: saves the typed results into the demo history, the way the database trigger does. */
function saveMockResults(context: CurrentAthleteTestWeekContext, cleaned: Record<string, string>): void {
  const submittedAt = new Date().toISOString()
  updateMockResultsState((state) => {
    const kept = state.results.filter((result) => !Object.keys(cleaned).some((id) => result.testResultId === `${MOCK_WEEK_ID}:${id}`))
    const added = context.tests
      .filter((test) => cleaned[test.id])
      .map((test) => {
        const resolved = resolveEventByName(test.name, UNIT_META[test.unit].mark)
        return buildMockResult({
          eventKey: resolved.eventKey,
          label: resolved.label,
          unit: resolved.unit,
          value: Number.parseFloat(cleaned[test.id]) * resolved.factor,
          day: 0,
          date: test.scheduledDate <= localIsoDate() ? test.scheduledDate : localIsoDate(),
          source: "test_week",
          testResultId: `${MOCK_WEEK_ID}:${test.id}`,
          location: context.testWeekName,
          createdAt: submittedAt,
        })
      })
    const testWeeks = state.testWeeks.some((week) => week.id === MOCK_WEEK_ID)
      ? state.testWeeks
      : [...state.testWeeks, { id: MOCK_WEEK_ID, name: context.testWeekName, startDate: mockDay(-1), endDate: mockDay(1), status: "published" as const }]
    return { ...state, results: [...added, ...kept], testWeeks }
  })
  try {
    window.localStorage.setItem(tenantStorageKey(MOCK_SUBMITTED_STORAGE_KEY), submittedAt)
  } catch {
    /* the home screen to-do simply stays */
  }
}

/* ---------- screen ---------- */

export default function AthleteTestWeekPage() {
  const isSupabase = getBackendMode() === "supabase"

  const [context, setContext] = useState<CurrentAthleteTestWeekContext | null>(() => (isSupabase ? null : buildMockContext()))
  const [history, setHistory] = useState<AthleteResult[]>([])
  const [pastWeeks, setPastWeeks] = useState<AthleteTestWeekHistoryItem[] | null>(null)
  const [isLoading, setIsLoading] = useState(isSupabase)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [values, setValues] = useState<TestSubmission>(() =>
    context ? Object.fromEntries(context.tests.map((test) => [test.id, inputValueFor(context.results[test.id])])) : {},
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [newBests, setNewBests] = useState<PersonalBestLine[]>([])
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [submissionNotice, setSubmissionNotice] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const applyContext = useCallback((next: CurrentAthleteTestWeekContext | null) => {
    setContext(next)
    setValues(next ? Object.fromEntries(next.tests.map((test) => [test.id, inputValueFor(next.results[test.id])])) : {})
    setFieldErrors({})
  }, [])

  const loadSideData = useCallback(async () => {
    const [recordsResult, historyResult] = await Promise.all([getCurrentAthleteRecords(), getCurrentAthleteTestWeekHistory()])
    // Bests and past weeks only add context to the form, so a failure here is not worth blocking it.
    if (recordsResult.ok) setHistory(recordsResult.data.results)
    setPastWeeks(historyResult.ok ? historyResult.data : [])
    return recordsResult.ok ? recordsResult.data.results : null
  }, [])

  const load = useCallback(async () => {
    if (!isSupabase) {
      applyContext(buildMockContext())
      return
    }
    setIsLoading(true)
    const contextResult = await getCurrentAthleteActiveTestWeekContext()
    setIsLoading(false)
    if (!contextResult.ok) {
      setLoadError(contextResult.error.message)
      return
    }
    setLoadError(null)
    applyContext(contextResult.data)
  }, [applyContext, isSupabase])

  useEffect(() => {
    if (isSupabase) void load()
    void loadSideData()
  }, [isSupabase, load, loadSideData])

  const today = localIsoDate()
  const tests = useMemo(() => context?.tests ?? [], [context])
  const phase: WeekPhase | null = !context ? null : context.status === "closed" ? "closed" : context.startDate > today ? "upcoming" : "open"
  const canEdit = phase === "open"

  /** Best mark so far per test, from the whole results history. */
  const bestByTest = useMemo(() => {
    const season = { start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` }
    const map: Record<string, string> = {}
    for (const test of tests) {
      const best = selectBests(history.filter((result) => result.eventGroup === groupFor(test)), season).personalBest
      if (best) map[test.id] = formatMarkWithUnit(best.display, best.unit)
    }
    return map
  }, [history, tests, today])

  const days = useMemo(() => {
    const grouped = new Map<number, ActiveTestDefinition[]>()
    tests.forEach((test) => {
      const list = grouped.get(test.dayIndex) ?? []
      list.push(test)
      grouped.set(test.dayIndex, list)
    })
    return [...grouped.entries()].sort((a, b) => a[0] - b[0])
  }, [tests])

  const submittedCount = tests.filter((test) => context?.results[test.id]).length
  const requiredLeft = tests.filter((test) => test.isRequired && !context?.results[test.id]).length

  const changedIds = tests
    .filter((test) => {
      const typed = (values[test.id] ?? "").trim()
      if (!typed) return false
      return typed.replace(",", ".") !== inputValueFor(context?.results[test.id])
    })
    .map((test) => test.id)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!context || !canEdit) return
    setSubmissionError(null)
    setSubmissionNotice(null)
    setNewBests([])

    if (changedIds.length === 0) {
      setSubmissionError(submittedCount > 0 ? "Nothing has changed since you last submitted." : "Enter at least one result before submitting.")
      return
    }

    const errors: Record<string, string> = {}
    const payload: TestSubmission = {}
    const cleaned: Record<string, string> = {}
    changedIds.forEach((id) => {
      const test = tests.find((item) => item.id === id)
      if (!test) return
      const checked = checkEntry(values[id] ?? "")
      if (!checked.ok) {
        errors[id] = checked.message
        return
      }
      cleaned[id] = checked.value
      payload[id] = `${checked.value}${UNIT_META[test.unit].suffix === "pts" ? "" : UNIT_META[test.unit].suffix}`
    })

    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      setSubmissionError("Fix the highlighted results, then submit again.")
      window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#test-week-form input[aria-invalid="true"]')?.focus())
      return
    }

    const count = Object.keys(payload).length
    const savedText = `${count} ${count === 1 ? "result" : "results"} saved. Your coach can see ${count === 1 ? "it" : "them"}.`

    if (isSupabase) {
      setIsSaving(true)
      const submission = await submitCurrentAthleteTestWeekResults(payload)
      setIsSaving(false)
      if (!submission.ok) {
        setSubmissionError(submission.error.message)
        return
      }
      setNewBests(submission.data.personalBests)
      setSubmissionNotice(savedText)
      if (submission.data.prWarning) {
        setSubmissionError(`Your results are saved, but we could not check them against your personal bests. ${submission.data.prWarning}`)
      }
      await Promise.all([load(), loadSideData()])
      return
    }

    // Mock mode: what was the best before, so the new bests can be named.
    const before = { ...bestByTest }
    saveMockResults(context, cleaned)
    const fresh = await loadSideData()
    const season = { start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` }
    const bests: PersonalBestLine[] = []
    for (const test of tests) {
      if (!cleaned[test.id] || !fresh) continue
      const best = selectBests(fresh.filter((result) => result.eventGroup === groupFor(test)), season).personalBest
      if (best && best.testResultId === `${MOCK_WEEK_ID}:${test.id}`) {
        bests.push({ testName: test.name, mark: formatMarkWithUnit(best.display, best.unit), previous: before[test.id] ?? null })
      }
    }
    setNewBests(bests)
    setSubmissionNotice(savedText)
    applyContext(buildMockContext())
  }

  const header = (lede?: string) => <ScreenHeader title="Test week" lede={lede ?? "Where you enter your results when your coach runs testing."} />

  const pastWeeksSection = (
    <Section
      title="Past test weeks"
      action={
        pastWeeks && pastWeeks.length > 0 ? (
          <Link className="sk-link" to="/athlete/test-week/history">
            History and comparison
          </Link>
        ) : undefined
      }
    >
      {pastWeeks === null ? (
        <SkeletonRows rows={2} label="Loading past test weeks" />
      ) : pastWeeks.filter((week) => week.testWeekId !== context?.testWeekId).length > 0 ? (
        <List>
          {pastWeeks
            .filter((week) => week.testWeekId !== context?.testWeekId)
            .slice(0, 3)
            .map((week) => {
              const better = week.results.filter((result) => result.change?.improved).length
              return (
                <ListRow
                  key={week.testWeekId}
                  to={`/athlete/test-week/history#${week.testWeekId}`}
                  title={week.name}
                  subtitle={`${shortDate(week.startDate)} ${parseLocalDate(week.startDate).getFullYear()}, ${week.results.length} ${week.results.length === 1 ? "result" : "results"}${better > 0 ? `, ${better} better than the time before` : ""}`}
                />
              )
            })}
        </List>
      ) : (
        <EmptyState title="No past test weeks yet" body="After your first test week, your results stay here so you can see how each test moves." />
      )}
    </Section>
  )

  if (isLoading && !context) {
    return (
      <Screen>
        {header()}
        <ProgressTabs />
        <Section title="This test week">
          <SkeletonRows rows={4} label="Loading your test week" />
        </Section>
      </Screen>
    )
  }

  if (loadError && !context) {
    return (
      <Screen>
        {header()}
        <ProgressTabs />
        <Notice
          tone="error"
          action={
            <Button variant="quiet" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          Your test week could not be loaded. {loadError}
        </Notice>
      </Screen>
    )
  }

  if (!context || !phase) {
    return (
      <Screen>
        {header()}
        <ProgressTabs />
        <Split
          main={
            <Section title="No open test week">
              <EmptyState
                title="Nothing to enter right now"
                body="When your coach opens a test week for your team, its tests show up here with a box for each result."
                action={
                  <LinkButton to="/athlete/prs" size="sm">
                    See your records
                  </LinkButton>
                }
              />
            </Section>
          }
          side={pastWeeksSection}
        />
      </Screen>
    )
  }

  const dateRange = context.startDate === context.endDate ? dayLabel(context.startDate) : `${dayLabel(context.startDate)} to ${dayLabel(context.endDate)}`
  const daysUntilStart = Math.round((parseLocalDate(context.startDate).getTime() - parseLocalDate(today).getTime()) / 86400000)
  const daysLeft = Math.round((parseLocalDate(context.endDate).getTime() - parseLocalDate(today).getTime()) / 86400000)
  const allDone = tests.length > 0 && submittedCount === tests.length

  const contextLine = (test: ActiveTestDefinition) => {
    const previous = context.previous[test.id]
    const best = bestByTest[test.id]
    const parts = [previous ? `Last time ${previous.valueText}, ${shortDate(previous.submittedAt)}` : "No earlier result"]
    if (best && best !== previous?.valueText) parts.push(`Best ${best}`)
    return `${parts.join(". ")}.`
  }

  return (
    <Screen>
      {header(`${context.testWeekName}, ${dateRange}.`)}
      <ProgressTabs />

      {phase === "upcoming" ? (
        <Notice>
          Starts {daysUntilStart === 1 ? "tomorrow" : `in ${daysUntilStart} days`}, on {dayLabel(context.startDate)}. You can enter results once it starts. Here is what your coach has planned.
        </Notice>
      ) : null}
      {phase === "closed" ? (
        <Notice>Your coach has closed this test week, so results can no longer be changed. If something is wrong, ask your coach to reopen it.</Notice>
      ) : null}
      {canEdit && context.lastSubmittedAt && !submissionNotice ? (
        <Notice tone="success">
          {allDone ? "All results submitted." : "Results submitted so far."} Last saved {stamp(context.lastSubmittedAt)}. You can change a result until your coach closes the week.
        </Notice>
      ) : null}
      {submissionNotice && !submissionError ? <Notice tone="success">{submissionNotice}</Notice> : null}
      {submissionError ? <Notice tone="error">{submissionError}</Notice> : null}

      {phase !== "upcoming" ? (
        <StatStrip aria-label="This test week">
          <Stat
            label="Submitted"
            value={submittedCount}
            of={tests.length}
            hint={tests.length === 0 ? "No tests set" : allDone ? "All tests done" : requiredLeft > 0 ? `${requiredLeft} required still to do` : "Only optional tests left"}
          />
          <Stat
            label={phase === "closed" ? "Ended" : "Ends"}
            value={shortDate(context.endDate)}
            hint={
              phase === "closed"
                ? "Closed by your coach"
                : daysLeft > 1
                  ? `${daysLeft} days left`
                  : daysLeft === 1
                    ? "1 day left"
                    : daysLeft === 0
                      ? "Last day today"
                      : "Past the end date, still open"
            }
          />
        </StatStrip>
      ) : null}

      {newBests.length > 0 ? (
        <Section title="New personal bests" meta={`${newBests.length} this time`}>
          <List>
            {newBests.map((best) => (
              <ListRow
                key={best.testName}
                leading={<StatusDot tone="green" />}
                title={best.testName}
                subtitle={best.previous ? `Was ${best.previous}` : "Your first result in this test"}
                trailing={best.mark}
              />
            ))}
          </List>
        </Section>
      ) : null}

      <Split
        main={
          tests.length === 0 ? (
            <Section title="No tests in this week yet">
              <EmptyState title="Your coach has not added any tests" body="Check back soon. Once tests are added, each one gets a box for your result." />
            </Section>
          ) : canEdit ? (
            <form id="test-week-form" className="flex flex-col gap-7 lg:gap-9" onSubmit={(event) => void handleSubmit(event)} noValidate>
              {days.map(([dayIndex, testsForDay]) => {
                const date = testsForDay[0]?.scheduledDate ?? shiftDate(context.startDate, dayIndex)
                const done = testsForDay.filter((test) => context.results[test.id]).length
                return (
                  <Section key={dayIndex} title={`Day ${dayIndex + 1}`} hint={date === today ? `${dayLabel(date)}, today` : dayLabel(date)} meta={`${done} of ${testsForDay.length} submitted`}>
                    <div className="mt-3 flex flex-col gap-5">
                      {testsForDay.map((test) => {
                        const meta = UNIT_META[test.unit]
                        const saved = context.results[test.id]
                        return (
                          <Field
                            key={test.id}
                            label={`${test.name} (${meta.long})`}
                            optional={!test.isRequired}
                            error={fieldErrors[test.id]}
                            hint={`${saved ? `Submitted ${saved.valueText}. ` : ""}${contextLine(test)}`}
                          >
                            <Input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              enterKeyHint="next"
                              placeholder="0.00"
                              className="font-bold tabular-nums"
                              value={values[test.id] ?? ""}
                              onChange={(changeEvent) => {
                                const next = changeEvent.target.value
                                setValues((current) => ({ ...current, [test.id]: next }))
                                if (fieldErrors[test.id]) setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== test.id)))
                              }}
                              onBlur={() => {
                                // A saved result cannot be removed by the athlete, so an emptied field goes back to the saved value.
                                if (saved && !(values[test.id] ?? "").trim()) {
                                  setValues((current) => ({ ...current, [test.id]: inputValueFor(saved) }))
                                }
                              }}
                            />
                          </Field>
                        )
                      })}
                    </div>
                  </Section>
                )
              })}
            </form>
          ) : (
            <>
              {days.map(([dayIndex, testsForDay]) => {
                const date = testsForDay[0]?.scheduledDate ?? shiftDate(context.startDate, dayIndex)
                return (
                  <Section key={dayIndex} title={`Day ${dayIndex + 1}`} hint={dayLabel(date)}>
                    <List>
                      {testsForDay.map((test) => {
                        const saved = context.results[test.id]
                        return (
                          <ListRow
                            key={test.id}
                            title={test.name}
                            subtitle={`${test.isRequired ? "" : "Optional. "}${contextLine(test)}`}
                            trailing={
                              phase === "upcoming" ? (
                                <span className="font-normal text-sk-mute">{UNIT_META[test.unit].long}</span>
                              ) : saved ? (
                                saved.valueText
                              ) : (
                                <StatusText tone="neutral">No result</StatusText>
                              )
                            }
                          />
                        )
                      })}
                    </List>
                  </Section>
                )
              })}
            </>
          )
        }
        side={pastWeeksSection}
      />

      {canEdit && tests.length > 0 ? (
        <ActionBar aria-label="Submit results">
          <p className="min-w-0 text-sm text-sk-mute">
            {changedIds.length > 0
              ? `${changedIds.length} ${changedIds.length === 1 ? "result" : "results"} ready. You can come back for the rest.`
              : "Enter what you have done so far."}
          </p>
          <Button type="submit" form="test-week-form" variant="primary" disabled={isSaving}>
            {isSaving ? "Saving..." : submittedCount > 0 ? "Submit changes" : "Submit results"}
          </Button>
        </ActionBar>
      ) : null}
    </Screen>
  )
}
