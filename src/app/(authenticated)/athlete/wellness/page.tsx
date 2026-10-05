"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Check, Minus, PencilSimple, Plus } from "@phosphor-icons/react"
import { PageHeader, Panel, ReadinessTag } from "@/components/sk"
import {
  getCurrentAthleteWellnessEntries,
  localWellnessDate,
  scoreWellnessInput,
  submitCurrentAthleteWellnessEntry,
  validateWellnessInput,
  WELLNESS_NOTE_MAX_LENGTH,
  WELLNESS_SLEEP_MAX_HOURS,
} from "@/lib/data/wellness/wellness-data"
import type { WellnessEntry, WellnessReadiness, WellnessSubmissionInput } from "@/lib/data/wellness/types"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { cn } from "@/lib/utils"

const MOCK_WELLNESS_STORAGE_KEY = "pacelab:wellness-entries"
const HISTORY_LOOKBACK = 90

type ScaleKey = "soreness" | "fatigue" | "mood" | "stress"

/** Stored values stay 1 to 5. Soreness, fatigue and stress: 1 is best. Mood: 5 is best. */
const SCALES: Array<{ key: ScaleKey; label: string; question: string; words: [string, string, string, string, string] }> = [
  { key: "soreness", label: "Soreness", question: "How sore is your body?", words: ["None", "Light", "Some", "Sore", "Very sore"] },
  { key: "fatigue", label: "Fatigue", question: "How tired do you feel?", words: ["Fresh", "Good", "OK", "Tired", "Drained"] },
  { key: "mood", label: "Mood", question: "How is your mood?", words: ["Low", "Flat", "OK", "Good", "Great"] },
  { key: "stress", label: "Stress", question: "How stressed are you?", words: ["Calm", "Light", "Some", "High", "Very high"] },
]

type ScaleAnswers = Record<ScaleKey, number | null>

const EMPTY_ANSWERS: ScaleAnswers = { soreness: null, fatigue: null, mood: null, stress: null }

function parseLocalDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

function shiftDate(iso: string, days: number) {
  const date = parseLocalDate(iso)
  date.setDate(date.getDate() + days)
  return localWellnessDate(date)
}

function formatSleep(hours: number) {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? "hour" : "hours"}`
}

function readMockEntries(): WellnessEntry[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(MOCK_WELLNESS_STORAGE_KEY)) ?? "[]") as WellnessEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function sortEntries(entries: WellnessEntry[]) {
  return [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate))
}

function readinessCopy(entry: WellnessEntry): { headline: string; body: string } {
  if (entry.readiness === "green") {
    return {
      headline: "You are ready to train",
      body: "Sleep, soreness, fatigue and stress all look good. Train as planned.",
    }
  }

  const reasons: string[] = []
  if (entry.sleepHours < 6) reasons.push("sleep was under 6 hours")
  else if (entry.sleepHours < 7) reasons.push("sleep was under 7 hours")
  if (entry.soreness >= 4) reasons.push("soreness is high")
  if (entry.fatigue >= 4) reasons.push("fatigue is high")
  if (entry.stress >= 4) reasons.push("stress is high")
  if (entry.mood < 3) reasons.push("mood is low")
  if (reasons.length === 0) reasons.push("soreness, fatigue and stress are adding up")

  const joined = reasons.length > 1 ? `${reasons.slice(0, -1).join(", ")} and ${reasons[reasons.length - 1]}` : reasons[0]
  const why = `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`

  if (entry.readiness === "yellow") {
    return { headline: "Take it a little easier today", body: `${why} You can train, but listen to your body.` }
  }
  return { headline: "Talk to your coach before training", body: `${why} Your coach can see this and may adjust today's session.` }
}

const READINESS_SURFACE: Record<WellnessReadiness, string> = {
  green: "bg-sk-green-tint",
  yellow: "bg-sk-yellow-tint",
  red: "bg-sk-coral-tint",
}

const READINESS_DOT: Record<WellnessReadiness, string> = {
  green: "bg-sk-green text-white",
  yellow: "bg-sk-yellow text-sk-ink",
  red: "bg-sk-coral text-white",
}

const READINESS_WORD: Record<WellnessReadiness, string> = { green: "Ready", yellow: "Watch", red: "Review" }

function ScaleQuestion({
  scale,
  value,
  onChange,
  missing,
}: {
  scale: (typeof SCALES)[number]
  value: number | null
  onChange: (next: number) => void
  missing: boolean
}) {
  const titleId = `wellness-${scale.key}`
  return (
    <div className="py-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={titleId} className="sk-h3">
          {scale.question}
        </h3>
        <p className={cn("shrink-0 text-sm font-bold", value ? "text-sk-blue" : missing ? "text-[#b32a0c]" : "text-sk-mute")}>
          {value ? scale.words[value - 1] : missing ? "Pick one" : ""}
        </p>
      </div>
      <div role="radiogroup" aria-labelledby={titleId} className="mt-3 grid grid-cols-5 gap-2">
        {scale.words.map((word, index) => {
          const option = index + 1
          const selected = value === option
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${scale.label} ${option} of 5, ${word}`}
              onClick={() => onChange(option)}
              className={cn(
                "flex h-14 items-center justify-center rounded-[14px] border-2 text-xl font-extrabold tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue",
                selected
                  ? "border-sk-blue bg-sk-blue text-white"
                  : "border-sk-line bg-white text-sk-ink hover:border-sk-blue hover:bg-sk-blue-tint",
              )}
            >
              {option}
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-sm font-semibold text-sk-mute" aria-hidden>
        <span>{scale.words[0]}</span>
        <span>{scale.words[4]}</span>
      </div>
    </div>
  )
}

export default function AthleteWellnessPage() {
  const backendMode = getBackendMode()
  const isSupabase = backendMode === "supabase"
  const today = localWellnessDate()

  const [entries, setEntries] = useState<WellnessEntry[]>(() => (isSupabase ? [] : sortEntries(readMockEntries())))
  const [isLoading, setIsLoading] = useState(isSupabase)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [sleep, setSleep] = useState(8)
  const [answers, setAnswers] = useState<ScaleAnswers>(EMPTY_ANSWERS)
  const [notes, setNotes] = useState("")
  const [isEditing, setIsEditing] = useState(false)
  const [showMissing, setShowMissing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    if (!isSupabase) return
    let cancelled = false
    void (async () => {
      const result = await getCurrentAthleteWellnessEntries(HISTORY_LOOKBACK)
      if (cancelled) return
      if (result.ok) {
        setEntries(sortEntries(result.data))
        setLoadError(null)
      } else {
        setLoadError(result.error.message)
      }
      setIsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [isSupabase])

  const todayEntry = useMemo(() => entries.find((entry) => entry.entryDate === today) ?? null, [entries, today])
  const showForm = !todayEntry || isEditing

  const week = useMemo(() => {
    const byDate = new Map(entries.map((entry) => [entry.entryDate, entry]))
    return Array.from({ length: 7 }, (_, index) => {
      const date = shiftDate(today, index - 6)
      return { date, entry: byDate.get(date) ?? null, isToday: date === today }
    })
  }, [entries, today])

  const weekCount = week.filter((day) => day.entry).length

  /** Days in a row with a real check-in, ending today (or yesterday if today is still open). */
  const streak = useMemo(() => {
    const dates = new Set(entries.map((entry) => entry.entryDate))
    let cursor = dates.has(today) ? today : shiftDate(today, -1)
    let count = 0
    while (dates.has(cursor)) {
      count += 1
      cursor = shiftDate(cursor, -1)
    }
    return count
  }, [entries, today])

  const startEditing = () => {
    if (!todayEntry) return
    setSleep(todayEntry.sleepHours)
    setAnswers({
      soreness: todayEntry.soreness,
      fatigue: todayEntry.fatigue,
      mood: todayEntry.mood,
      stress: todayEntry.stress,
    })
    setNotes(todayEntry.notes ?? "")
    setSubmitError(null)
    setShowMissing(false)
    setJustSaved(false)
    setIsEditing(true)
  }

  const stepSleep = (delta: number) => {
    setSleep((current) => Math.max(0, Math.min(WELLNESS_SLEEP_MAX_HOURS, Math.round((current + delta) * 2) / 2)))
  }

  const storeEntry = (entry: WellnessEntry) => {
    setEntries((current) => sortEntries([...current.filter((item) => item.entryDate !== entry.entryDate), entry]))
    setIsEditing(false)
    setShowMissing(false)
    setJustSaved(true)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitError(null)

    const missing = SCALES.filter((scale) => answers[scale.key] === null).map((scale) => scale.label.toLowerCase())
    if (missing.length > 0) {
      setShowMissing(true)
      setSubmitError(`Still to answer: ${missing.join(", ")}.`)
      const firstMissing = SCALES.find((scale) => answers[scale.key] === null)
      if (firstMissing) document.getElementById(`wellness-${firstMissing.key}`)?.scrollIntoView({ block: "center", behavior: "smooth" })
      return
    }

    const input: WellnessSubmissionInput = {
      entryDate: today,
      sleepHours: sleep,
      soreness: answers.soreness as number,
      fatigue: answers.fatigue as number,
      mood: answers.mood as number,
      stress: answers.stress as number,
      notes: notes.trim() || null,
    }

    const validationError = validateWellnessInput(input)
    if (validationError) {
      setSubmitError(validationError)
      return
    }

    if (isSupabase) {
      setIsSaving(true)
      const persistResult = await submitCurrentAthleteWellnessEntry(input)
      setIsSaving(false)
      if (!persistResult.ok) {
        setSubmitError(persistResult.error.message)
        return
      }
      storeEntry(persistResult.data)
      return
    }

    const scored = scoreWellnessInput(input)
    const mockEntry: WellnessEntry = {
      id: `mock-${today}`,
      athleteId: "mock-athlete",
      createdAt: new Date().toISOString(),
      ...input,
      ...scored,
    }
    try {
      const next = sortEntries([...readMockEntries().filter((item) => item.entryDate !== today), mockEntry]).slice(-HISTORY_LOOKBACK)
      window.localStorage.setItem(tenantStorageKey(MOCK_WELLNESS_STORAGE_KEY), JSON.stringify(next))
    } catch {
      setSubmitError("Could not save this check-in on this device.")
      return
    }
    storeEntry(mockEntry)
  }

  const resultCopy = todayEntry ? readinessCopy(todayEntry) : null

  return (
    <div className="sk-page">
      <PageHeader
        title="Wellness check-in"
        lede={
          todayEntry && !isEditing
            ? "Today is done. Your coach can see how you are feeling."
            : "Five quick taps before you train. It takes about 20 seconds."
        }
      />

      {loadError ? (
        <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
          Could not load your check-ins. {loadError}
        </p>
      ) : null}

      {isLoading ? (
        <p className="text-sm font-semibold text-sk-mute">Loading your check-ins...</p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8">
          {showForm ? (
            <Panel
              title={isEditing ? "Update today's check-in" : "How are you today?"}
              hint={parseLocalDate(today).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            >
              <form onSubmit={handleSubmit} noValidate>
                <div className="divide-y divide-sk-line border-t border-sk-line">
                  <div className="py-5">
                    <h3 id="wellness-sleep" className="sk-h3">
                      How long did you sleep?
                    </h3>
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => stepSleep(-0.5)}
                        disabled={sleep <= 0}
                        aria-label="Half an hour less sleep"
                        className="sk-btn sk-btn-quiet size-14 shrink-0 px-0"
                      >
                        <Minus className="size-5" weight="bold" />
                      </button>
                      <p
                        role="status"
                        aria-labelledby="wellness-sleep"
                        className="flex-1 rounded-[14px] bg-sk-canvas py-2.5 text-center"
                      >
                        <span className="sk-num text-[2.25rem]">{Number.isInteger(sleep) ? sleep : sleep.toFixed(1)}</span>
                        <span className="ml-1.5 text-base font-bold text-sk-ink-2">{sleep === 1 ? "hour" : "hours"}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => stepSleep(0.5)}
                        disabled={sleep >= WELLNESS_SLEEP_MAX_HOURS}
                        aria-label="Half an hour more sleep"
                        className="sk-btn sk-btn-quiet size-14 shrink-0 px-0"
                      >
                        <Plus className="size-5" weight="bold" />
                      </button>
                    </div>
                  </div>

                  {SCALES.map((scale) => (
                    <ScaleQuestion
                      key={scale.key}
                      scale={scale}
                      value={answers[scale.key]}
                      missing={showMissing && answers[scale.key] === null}
                      onChange={(next) => setAnswers((current) => ({ ...current, [scale.key]: next }))}
                    />
                  ))}

                  <div className="py-5">
                    <label htmlFor="wellness-notes" className="sk-h3 block">
                      Anything your coach should know?
                    </label>
                    <p className="mt-0.5 text-sm text-sk-mute">Optional. A niggle, a late night, travel.</p>
                    <textarea
                      id="wellness-notes"
                      rows={2}
                      maxLength={WELLNESS_NOTE_MAX_LENGTH}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      className="sk-field mt-3 h-auto min-h-[76px] resize-y py-3"
                    />
                  </div>
                </div>

                {submitError ? (
                  <p role="alert" className="mb-3 rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
                    {submitError}
                  </p>
                ) : null}

                <div className="flex flex-col gap-2 sm:flex-row-reverse">
                  <button type="submit" disabled={isSaving} className="sk-btn sk-btn-primary h-14 w-full text-base sm:flex-1">
                    {isSaving ? "Saving..." : isEditing ? "Save changes" : "Submit check-in"}
                  </button>
                  {isEditing ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditing(false)
                        setSubmitError(null)
                      }}
                      className="sk-btn sk-btn-ghost h-14 w-full sm:w-auto"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>
            </Panel>
          ) : todayEntry && resultCopy ? (
            <Panel
              title="Today's readiness"
              hint={justSaved ? "Check-in saved." : "From the check-in you submitted today."}
              action={<ReadinessTag status={todayEntry.readiness} />}
            >
              <div className={cn("rounded-2xl p-5", READINESS_SURFACE[todayEntry.readiness])}>
                <p className="sk-num text-[3.5rem]">
                  {todayEntry.readinessScore}
                  <span className="ml-1 text-lg font-bold tracking-normal text-sk-ink-2">out of 100</span>
                </p>
                <p className="mt-3 text-xl font-bold tracking-[-0.02em] text-sk-ink">{resultCopy.headline}</p>
                <p className="mt-1 max-w-[52ch] text-[0.95rem] leading-relaxed text-sk-ink-2">{resultCopy.body}</p>
              </div>

              <h3 className="sk-label mt-6">Your answers</h3>
              <dl className="mt-1">
                <div className="sk-row">
                  <dt className="font-semibold text-sk-ink">Sleep</dt>
                  <dd className="font-bold tabular-nums text-sk-ink">{formatSleep(todayEntry.sleepHours)}</dd>
                </div>
                {SCALES.map((scale) => {
                  const value = todayEntry[scale.key]
                  return (
                    <div key={scale.key} className="sk-row">
                      <dt className="font-semibold text-sk-ink">{scale.label}</dt>
                      <dd className="text-right">
                        <span className="font-bold text-sk-ink">{scale.words[value - 1] ?? value}</span>
                        <span className="ml-2 text-sm tabular-nums text-sk-mute">{value} of 5</span>
                      </dd>
                    </div>
                  )
                })}
                {todayEntry.notes ? (
                  <div className="border-b border-sk-line py-3.5 last:border-b-0">
                    <dt className="font-semibold text-sk-ink">Note to coach</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed text-sk-ink-2">{todayEntry.notes}</dd>
                  </div>
                ) : null}
              </dl>

              <button type="button" onClick={startEditing} className="sk-btn sk-btn-quiet mt-5 h-12 w-full sm:w-auto">
                <PencilSimple className="size-4" weight="bold" />
                Update today&apos;s check-in
              </button>
            </Panel>
          ) : null}

          <Panel
            title="Last 7 days"
            hint={
              weekCount === 0
                ? "No check-ins yet this week."
                : `${weekCount} of 7 days checked in${streak >= 2 ? `, ${streak} days in a row` : ""}.`
            }
          >
            <ol className="grid grid-cols-7 gap-1.5">
              {week.map((day) => {
                const date = parseLocalDate(day.date)
                const weekday = date.toLocaleDateString(undefined, { weekday: "short" })
                const longDate = date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
                return (
                  <li
                    key={day.date}
                    aria-label={`${longDate}: ${day.entry ? READINESS_WORD[day.entry.readiness] : day.isToday ? "not checked in yet" : "no check-in"}`}
                    className="flex flex-col items-center gap-1.5"
                  >
                    <span className={cn("text-xs font-bold", day.isToday ? "text-sk-ink" : "text-sk-mute")} aria-hidden>
                      {day.isToday ? "Today" : weekday}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-10 items-center justify-center rounded-full",
                        day.entry
                          ? READINESS_DOT[day.entry.readiness]
                          : day.isToday
                            ? "border-2 border-sk-blue bg-white"
                            : "border-2 border-dashed border-[#cdd2de] bg-white",
                      )}
                    >
                      {day.entry ? <Check className="size-4" weight="bold" /> : null}
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-sk-mute" aria-hidden>
                      {day.entry ? day.entry.readinessScore : ""}
                    </span>
                  </li>
                )
              })}
            </ol>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-sk-line pt-4 text-sm text-sk-ink-2">
              {(["green", "yellow", "red"] as const).map((status) => (
                <span key={status} className="inline-flex items-center gap-1.5 font-semibold">
                  <span className={cn("size-2.5 rounded-full", READINESS_DOT[status])} />
                  {READINESS_WORD[status]}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <span className="size-2.5 rounded-full border-2 border-dashed border-[#cdd2de]" />
                Missed
              </span>
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}
