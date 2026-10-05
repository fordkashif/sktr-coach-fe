"use client"

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, CalendarBlank, CheckCircle, Circle, ClipboardText, LockSimple, Trophy } from "@phosphor-icons/react"
import { EmptyState, PageHeader, Panel, Stat, Tag } from "@/components/sk"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { getCurrentAthletePrRecords } from "@/lib/data/pr/pr-data"
import { getBackendMode } from "@/lib/supabase/config"
import {
  getCurrentAthleteActiveTestWeekContext,
  submitCurrentAthleteTestWeekResults,
} from "@/lib/data/test-week/test-week-data"
import type { ActiveTestDefinition, CurrentAthleteTestWeekContext, TestDefinitionUnit } from "@/lib/data/test-week/types"
import { cn } from "@/lib/utils"

type TestSubmission = Record<string, string>
type WeekPhase = "upcoming" | "open" | "closed"

const PR_OVERRIDE_STORAGE_KEY = "pacelab:pr-overrides"
const TEST_WEEK_STORAGE_KEY = "pacelab:test-week-results"

/** What the athlete types is a plain number. The unit is fixed by the test and shown beside the field. */
const UNIT_META: Record<TestDefinitionUnit, { suffix: string; long: string; lowerIsBetter: boolean }> = {
  time: { suffix: "s", long: "seconds", lowerIsBetter: true },
  distance: { suffix: "m", long: "metres", lowerIsBetter: false },
  weight: { suffix: "kg", long: "kilograms", lowerIsBetter: false },
  height: { suffix: "cm", long: "centimetres", lowerIsBetter: false },
  score: { suffix: "pts", long: "points", lowerIsBetter: false },
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

/* ---------- mock mode: a demo week kept in this browser only ---------- */

const MOCK_TESTS: Array<{ name: string; unit: TestDefinitionUnit; dayIndex: number; isRequired: boolean; previous: string; best?: string }> = [
  { name: "30m", unit: "time", dayIndex: 0, isRequired: true, previous: "4.05s", best: "4.05s" },
  { name: "Flying 30m", unit: "time", dayIndex: 0, isRequired: true, previous: "2.89s", best: "2.89s" },
  { name: "150m", unit: "time", dayIndex: 1, isRequired: true, previous: "16.8s", best: "16.8s" },
  { name: "Squat 1RM", unit: "weight", dayIndex: 1, isRequired: true, previous: "185kg", best: "185kg" },
  { name: "CMJ", unit: "height", dayIndex: 2, isRequired: false, previous: "72cm" },
]

type MockStored = { results: CurrentAthleteTestWeekContext["results"]; submittedAt: string | null }

function readMockStored(): MockStored {
  if (typeof window === "undefined") return { results: {}, submittedAt: null }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(TEST_WEEK_STORAGE_KEY)) ?? "null") as MockStored | null
    if (parsed && typeof parsed === "object" && parsed.results) return parsed
  } catch {
    /* fall through to empty */
  }
  return { results: {}, submittedAt: null }
}

/** Mock mode only: `?state=none|upcoming|closed` previews the other screen states. Ignored in supabase mode. */
function buildMockContext(): CurrentAthleteTestWeekContext | null {
  const preview = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("state")
  if (preview === "none") return null

  const today = localIsoDate()
  const startDate = preview === "upcoming" ? shiftDate(today, 3) : preview === "closed" ? shiftDate(today, -6) : shiftDate(today, -1)
  const stored = readMockStored()
  const tests = MOCK_TESTS.map((test, index) => ({
    id: `fallback-${index}`,
    name: test.name,
    unit: test.unit,
    isRequired: test.isRequired,
    scheduledDate: shiftDate(startDate, test.dayIndex),
    dayIndex: test.dayIndex,
  }))

  return {
    athleteId: "fallback-athlete",
    testWeekId: "fallback-week",
    testWeekName: "Speed and power testing",
    startDate,
    endDate: shiftDate(startDate, 2),
    status: preview === "closed" ? "closed" : "published",
    tests,
    lastSubmittedAt: stored.submittedAt,
    results: stored.results,
    previous: Object.fromEntries(
      MOCK_TESTS.map((test, index) => [`fallback-${index}`, { valueText: test.previous, submittedAt: shiftDate(today, -84) }]),
    ),
  }
}

function mockBests(): Record<string, string> {
  const bests: Record<string, string> = {}
  MOCK_TESTS.forEach((test) => {
    if (test.best) bests[test.name.toLowerCase()] = test.best
  })
  if (typeof window !== "undefined") {
    try {
      const overrides = JSON.parse(window.localStorage.getItem(tenantStorageKey(PR_OVERRIDE_STORAGE_KEY)) ?? "{}") as Record<string, string>
      Object.entries(overrides).forEach(([event, value]) => {
        bests[event.toLowerCase()] = value
      })
    } catch {
      /* ignore unreadable overrides */
    }
  }
  return bests
}

/* ---------- screen ---------- */

export default function AthleteTestWeekPage() {
  const backendMode = getBackendMode()
  const isSupabase = backendMode === "supabase"

  const [context, setContext] = useState<CurrentAthleteTestWeekContext | null>(() => (isSupabase ? null : buildMockContext()))
  const [bests, setBests] = useState<Record<string, string>>(() => (isSupabase ? {} : mockBests()))
  const [isLoading, setIsLoading] = useState(isSupabase)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [values, setValues] = useState<TestSubmission>(() =>
    context ? Object.fromEntries(context.tests.map((test) => [test.id, inputValueFor(context.results[test.id])])) : {},
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [prUpdates, setPrUpdates] = useState<string[]>([])
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [submissionNotice, setSubmissionNotice] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const applyContext = useCallback((next: CurrentAthleteTestWeekContext | null) => {
    setContext(next)
    setValues(next ? Object.fromEntries(next.tests.map((test) => [test.id, inputValueFor(next.results[test.id])])) : {})
    setFieldErrors({})
  }, [])

  const load = useCallback(async () => {
    if (!isSupabase) return
    setIsLoading(true)
    const [contextResult, prsResult] = await Promise.all([getCurrentAthleteActiveTestWeekContext(), getCurrentAthletePrRecords()])
    setIsLoading(false)

    if (!contextResult.ok) {
      setLoadError(contextResult.error.message)
      return
    }
    setLoadError(null)
    applyContext(contextResult.data)

    // Personal bests only add a line of context to each test, so a failure here is not worth blocking the form.
    if (prsResult.ok) {
      setBests(Object.fromEntries(prsResult.data.map((pr) => [pr.event.toLowerCase(), pr.bestValue])))
    }
  }, [applyContext, isSupabase])

  useEffect(() => {
    void load()
  }, [load])

  const today = localIsoDate()
  const tests = useMemo(() => context?.tests ?? [], [context])
  const phase: WeekPhase | null = !context ? null : context.status === "closed" ? "closed" : context.startDate > today ? "upcoming" : "open"
  const canEdit = phase === "open"

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
    setPrUpdates([])

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
      document.getElementById(`test-${Object.keys(errors)[0]}`)?.focus()
      return
    }

    const describeBest = (test: ActiveTestDefinition) => {
      const before = bests[test.name.toLowerCase()]
      return before ? `${test.name}: ${payload[test.id]} (was ${before})` : `${test.name}: ${payload[test.id]}`
    }

    if (isSupabase) {
      setIsSaving(true)
      const submission = await submitCurrentAthleteTestWeekResults(payload)
      setIsSaving(false)
      if (!submission.ok) {
        setSubmissionError(submission.error.message)
        return
      }
      const bestNames = new Set(submission.data.newPersonalBests)
      setPrUpdates(tests.filter((test) => payload[test.id] && bestNames.has(test.name)).map(describeBest))
      setSubmissionNotice(`${submission.data.submittedCount} ${submission.data.submittedCount === 1 ? "result" : "results"} saved.`)
      if (submission.data.prWarning) {
        setSubmissionError(`Your results are saved, but your personal bests could not be updated. ${submission.data.prWarning}`)
      }
      await load()
      return
    }

    const submittedAt = new Date().toISOString()
    const nextResults = { ...context.results }
    const updates: string[] = []
    let nextOverrides: Record<string, string> = {}
    try {
      nextOverrides = JSON.parse(window.localStorage.getItem(tenantStorageKey(PR_OVERRIDE_STORAGE_KEY)) ?? "{}") as Record<string, string>
    } catch {
      nextOverrides = {}
    }

    tests.forEach((test) => {
      const valueText = payload[test.id]
      if (!valueText) return
      const numeric = Number.parseFloat(cleaned[test.id])
      nextResults[test.id] = { valueText, valueNumeric: numeric, submittedAt }
      const before = numericOf(bests[test.name.toLowerCase()] ?? "")
      const better = before === null || (UNIT_META[test.unit].lowerIsBetter ? numeric < before : numeric > before)
      if (better) {
        updates.push(describeBest(test))
        nextOverrides[test.name] = valueText
      }
    })

    try {
      window.localStorage.setItem(tenantStorageKey(PR_OVERRIDE_STORAGE_KEY), JSON.stringify(nextOverrides))
      window.localStorage.setItem(tenantStorageKey(TEST_WEEK_STORAGE_KEY), JSON.stringify({ results: nextResults, submittedAt }))
    } catch {
      setSubmissionError("Could not save these results on this device.")
      return
    }

    setPrUpdates(updates)
    setSubmissionNotice(`${Object.keys(payload).length} ${Object.keys(payload).length === 1 ? "result" : "results"} saved.`)
    setBests(mockBests())
    applyContext({ ...context, results: nextResults, lastSubmittedAt: submittedAt })
  }

  if (isLoading && !context) {
    return (
      <div className="sk-page">
        <PageHeader title="Test week" />
        <p className="text-sm font-semibold text-sk-mute">Loading your test week...</p>
      </div>
    )
  }

  if (loadError && !context) {
    return (
      <div className="sk-page">
        <PageHeader title="Test week" />
        <div role="alert" className="rounded-2xl bg-sk-coral-tint p-5">
          <p className="sk-h3">Could not load your test week</p>
          <p className="mt-1 text-sm text-[#b32a0c]">{loadError}</p>
          <button type="button" onClick={() => void load()} className="sk-btn sk-btn-quiet mt-4">
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!context || !phase) {
    return (
      <div className="sk-page">
        <PageHeader title="Test week" lede="This is where you enter your results when your coach runs testing." />
        <EmptyState
          icon={<ClipboardText className="size-5" weight="bold" />}
          title="No open test week"
          body="When your coach publishes a test week for your team, the tests will show up here with a box for each result."
          action={
            <Link to="/athlete/trends" className="sk-btn sk-btn-quiet">
              See my progress
              <ArrowRight className="size-4" weight="bold" />
            </Link>
          }
        />
      </div>
    )
  }

  const dateRange =
    context.startDate === context.endDate ? dayLabel(context.startDate) : `${dayLabel(context.startDate)} to ${dayLabel(context.endDate)}`
  const daysUntilStart = Math.round((parseLocalDate(context.startDate).getTime() - parseLocalDate(today).getTime()) / 86400000)
  const daysLeft = Math.round((parseLocalDate(context.endDate).getTime() - parseLocalDate(today).getTime()) / 86400000)
  const allDone = tests.length > 0 && submittedCount === tests.length

  return (
    <div className="sk-page">
      <PageHeader
        title={context.testWeekName}
        lede={
          <span className="inline-flex items-center gap-2">
            <CalendarBlank className="size-4 shrink-0" weight="bold" />
            Test week, {dateRange}
          </span>
        }
      />

      {phase === "upcoming" ? (
        <div className="rounded-[20px] bg-sk-yellow-tint p-5">
          <p className="sk-h3">
            Starts {daysUntilStart === 1 ? "tomorrow" : `in ${daysUntilStart} days`}, on {dayLabel(context.startDate)}
          </p>
          <p className="mt-1 text-[0.95rem] leading-relaxed text-sk-ink-2">
            You can enter results once the test week starts. Here is what your coach has planned.
          </p>
        </div>
      ) : null}

      {phase === "closed" ? (
        <div className="flex items-start gap-3 rounded-[20px] bg-sk-canvas p-5 ring-1 ring-sk-line">
          <LockSimple className="mt-0.5 size-5 shrink-0 text-sk-ink-2" weight="bold" />
          <div>
            <p className="sk-h3">This test week is closed</p>
            <p className="mt-1 text-[0.95rem] leading-relaxed text-sk-ink-2">
              Your coach has closed it, so results can no longer be changed. If something is wrong, ask your coach to reopen it.
            </p>
          </div>
        </div>
      ) : null}

      {phase !== "upcoming" ? (
        <section aria-label="Progress" className="grid grid-cols-2 gap-3 lg:max-w-[720px]">
          <Stat
            tone={allDone ? "green" : phase === "open" ? "blue" : "plain"}
            label="Submitted"
            value={submittedCount}
            unit={` of ${tests.length}`}
            hint={
              tests.length === 0
                ? "No tests set"
                : allDone
                  ? "All tests done"
                  : requiredLeft > 0
                    ? `${requiredLeft} required still to do`
                    : "Only optional tests left"
            }
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
        </section>
      ) : null}

      {canEdit && context.lastSubmittedAt ? (
        <div className="flex items-start gap-3 rounded-[20px] bg-sk-green-tint p-5">
          <CheckCircle className="mt-0.5 size-5 shrink-0 text-sk-green" weight="fill" />
          <div>
            <p className="sk-h3">{allDone ? "All results submitted" : "Results submitted so far"}</p>
            <p className="mt-1 text-[0.95rem] leading-relaxed text-sk-ink-2">
              Last saved {stamp(context.lastSubmittedAt)}. Your coach can see them. You can change a result until your coach closes the week.
            </p>
          </div>
        </div>
      ) : null}

      {prUpdates.length > 0 ? (
        <Panel title="New personal bests" action={<Trophy className="size-6 text-[#c48a00]" weight="fill" />}>
          <ul>
            {prUpdates.map((update) => (
              <li key={update} className="sk-row font-semibold text-sk-ink">
                {update}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {tests.length === 0 ? (
        <EmptyState
          icon={<ClipboardText className="size-5" weight="bold" />}
          title="No tests in this week yet"
          body="Your coach has not added any tests to this test week. Check back soon."
        />
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <div className="grid items-start gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {days.map(([dayIndex, testsForDay]) => {
              const date = testsForDay[0]?.scheduledDate ?? shiftDate(context.startDate, dayIndex)
              return (
                <Panel
                  key={dayIndex}
                  title={`Day ${dayIndex + 1}`}
                  hint={date === today ? `${dayLabel(date)}, today` : dayLabel(date)}
                >
                  <ul className="divide-y divide-sk-line border-t border-sk-line">
                    {testsForDay.map((test) => {
                      const meta = UNIT_META[test.unit]
                      const saved = context.results[test.id]
                      const previous = context.previous[test.id]
                      const best = bests[test.name.toLowerCase()]
                      const error = fieldErrors[test.id]
                      const inputId = `test-${test.id}`
                      return (
                        <li key={test.id} className="py-4 last:pb-0">
                          <div className="flex items-start justify-between gap-3">
                            <label htmlFor={canEdit ? inputId : undefined} className="min-w-0">
                              <span className="block text-lg font-bold tracking-[-0.01em] text-sk-ink">{test.name}</span>
                              <span className="mt-0.5 block text-sm text-sk-mute">
                                {test.isRequired ? "" : "Optional. "}
                                {previous ? `Last time ${previous.valueText}, ${shortDate(previous.submittedAt)}` : "No earlier result"}
                                {best && best !== previous?.valueText ? `. Best ${best}` : ""}
                              </span>
                            </label>
                            {phase === "upcoming" ? (
                              <span className="shrink-0 text-sm font-semibold text-sk-mute">{meta.long}</span>
                            ) : saved ? (
                              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-[#07673f]">
                                <CheckCircle className="size-4" weight="fill" />
                                Submitted
                              </span>
                            ) : (
                              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-sk-mute">
                                <Circle className="size-4" weight="bold" />
                                Not submitted
                              </span>
                            )}
                          </div>

                          {canEdit ? (
                            <>
                              <div className="relative mt-3">
                                <input
                                  id={inputId}
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  enterKeyHint="next"
                                  placeholder="0.00"
                                  value={values[test.id] ?? ""}
                                  aria-invalid={Boolean(error)}
                                  aria-describedby={error ? `${inputId}-error` : `${inputId}-unit`}
                                  onChange={(event) => {
                                    const next = event.target.value
                                    setValues((current) => ({ ...current, [test.id]: next }))
                                    if (error) setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== test.id)))
                                  }}
                                  onBlur={() => {
                                    // A saved result cannot be removed by the athlete, so an emptied field goes back to the saved value.
                                    if (saved && !(values[test.id] ?? "").trim()) {
                                      setValues((current) => ({ ...current, [test.id]: inputValueFor(saved) }))
                                    }
                                  }}
                                  className={cn(
                                    "sk-field h-14 pr-28 text-xl font-bold tabular-nums placeholder:font-semibold",
                                    error && "border-sk-coral focus:border-sk-coral focus:ring-sk-coral/20",
                                  )}
                                />
                                <span
                                  id={`${inputId}-unit`}
                                  className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-bold text-sk-mute"
                                >
                                  {meta.long}
                                </span>
                              </div>
                              {error ? (
                                <p id={`${inputId}-error`} role="alert" className="mt-1.5 text-sm font-semibold text-[#b32a0c]">
                                  {error}
                                </p>
                              ) : null}
                            </>
                          ) : phase === "closed" ? (
                            <p className="mt-2">
                              {saved ? (
                                <span className="sk-num text-[1.75rem]">{saved.valueText}</span>
                              ) : (
                                <Tag>No result</Tag>
                              )}
                            </p>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </Panel>
              )
            })}
          </div>

          {canEdit ? (
            <div className="space-y-3">
              {submissionError ? (
                <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
                  {submissionError}
                </p>
              ) : null}
              {submissionNotice && !submissionError ? (
                <p role="status" className="rounded-2xl bg-sk-green-tint px-4 py-3 text-sm font-semibold text-[#07673f]">
                  {submissionNotice}
                </p>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button type="submit" disabled={isSaving} className="sk-btn sk-btn-primary h-14 w-full text-base sm:w-auto sm:min-w-[240px]">
                  {isSaving ? "Saving..." : submittedCount > 0 ? "Submit changes" : "Submit results"}
                </button>
                <p className="text-sm text-sk-mute">
                  {changedIds.length > 0
                    ? `${changedIds.length} ${changedIds.length === 1 ? "result" : "results"} ready to submit. You can come back for the rest.`
                    : "Enter what you have done so far. You can come back for the rest."}
                </p>
              </div>
            </div>
          ) : null}
        </form>
      )}
    </div>
  )
}
