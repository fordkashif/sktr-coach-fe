"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { PencilSimple } from "@phosphor-icons/react"
import {
  Button,
  Choices,
  FactList,
  Fact,
  Field,
  List,
  ListRow,
  Notice,
  ReadinessText,
  Screen,
  ScreenHeader,
  Section,
  SkeletonRows,
  Split,
  Stat,
  StatStrip,
  StatusDot,
  Stepper,
  TapScale,
  Textarea,
  notify,
} from "@/components/sk"
import { currentAvailability, getMyAvailability, setMyAvailability } from "@/lib/data/athlete/availability-data"
import { getCurrentAthletePainReports, resolveCurrentAthletePainReport } from "@/lib/data/wellness/pain-report-data"
import { bodyAreasSummary, type PainReport, type PainTrainingImpact } from "@/lib/data/wellness/pain-report-types"
import {
  loadCurrentAthleteWellnessEntries,
  localWellnessDate,
  saveCurrentAthleteWellnessEntry,
  validateWellnessInput,
  WELLNESS_NOTE_MAX_LENGTH,
  WELLNESS_SLEEP_MAX_HOURS,
} from "@/lib/data/wellness/wellness-data"
import type { WellnessEntry, WellnessSubmissionInput } from "@/lib/data/wellness/types"
import {
  WELLNESS_SCALES,
  formatHours,
  formatSleep,
  longDate,
  painReportSummary,
  painTone,
  readinessCopy,
  shiftDate,
  shortDate,
  type ScaleKey,
} from "./wellness-shared"

type ScaleAnswers = Record<ScaleKey, number | null>

const EMPTY_ANSWERS: ScaleAnswers = { soreness: null, fatigue: null, mood: null, stress: null }

/** Set by the pain report screen when it sends the athlete back here. */
type ReportedState = { painReported?: PainTrainingImpact } | null

export default function AthleteWellnessPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const today = localWellnessDate()

  const [entries, setEntries] = useState<WellnessEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [painReports, setPainReports] = useState<PainReport[] | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const [sleep, setSleep] = useState(8)
  const [answers, setAnswers] = useState<ScaleAnswers>(EMPTY_ANSWERS)
  const [notes, setNotes] = useState("")
  const [hurting, setHurting] = useState<"no" | "yes">("no")
  const [isEditing, setIsEditing] = useState(false)
  const [showMissing, setShowMissing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const [reported, setReported] = useState<PainTrainingImpact | null>(() => (location.state as ReportedState)?.painReported ?? null)
  const [unavailable, setUnavailable] = useState<"unknown" | "no" | "yes" | "saving">("unknown")

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [entriesResult, painResult] = await Promise.all([loadCurrentAthleteWellnessEntries(), getCurrentAthletePainReports({ status: "open" })])
      if (cancelled) return
      if (entriesResult.ok) {
        setEntries(entriesResult.data)
        setLoadError(null)
      } else {
        setEntries([])
        setLoadError(entriesResult.error.message)
      }
      // A database without pain reports yet simply shows none.
      setPainReports(painResult.ok ? painResult.data : [])
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // The "you said you cannot train" follow-up only makes sense while the athlete is not already marked unavailable.
  useEffect(() => {
    if (reported !== "cannot_train") return
    let cancelled = false
    void getMyAvailability().then((result) => {
      if (cancelled) return
      setUnavailable(result.ok && currentAvailability(result.data) ? "yes" : "no")
    })
    return () => {
      cancelled = true
    }
  }, [reported])

  const todayEntry = useMemo(() => entries?.find((entry) => entry.entryDate === today) ?? null, [entries, today])
  const showForm = !todayEntry || isEditing

  const week = useMemo(() => {
    const byDate = new Map((entries ?? []).map((entry) => [entry.entryDate, entry]))
    return Array.from({ length: 7 }, (_, index) => {
      const date = shiftDate(today, -index)
      return { date, entry: byDate.get(date) ?? null, isToday: date === today }
    })
  }, [entries, today])
  const weekCount = week.filter((day) => day.entry).length

  /** Days in a row with a check-in, ending today (or yesterday if today is still open). */
  const streak = useMemo(() => {
    const dates = new Set((entries ?? []).map((entry) => entry.entryDate))
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
    setAnswers({ soreness: todayEntry.soreness, fatigue: todayEntry.fatigue, mood: todayEntry.mood, stress: todayEntry.stress })
    setNotes(todayEntry.notes ?? "")
    setHurting("no")
    setSubmitError(null)
    setShowMissing(false)
    setJustSaved(false)
    setIsEditing(true)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSaving) return
    setSubmitError(null)

    const missing = WELLNESS_SCALES.filter((scale) => answers[scale.key] === null)
    if (missing.length > 0) {
      setShowMissing(true)
      setSubmitError(`Still to answer: ${missing.map((scale) => scale.label.toLowerCase()).join(", ")}.`)
      document.getElementById(`wellness-${missing[0].key}`)?.scrollIntoView({ block: "center", behavior: "smooth" })
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

    setIsSaving(true)
    const result = await saveCurrentAthleteWellnessEntry(input)
    setIsSaving(false)
    if (!result.ok) {
      setSubmitError(result.error.message)
      return
    }

    setEntries((current) => [...(current ?? []).filter((item) => item.entryDate !== result.data.entryDate), result.data].sort((a, b) => a.entryDate.localeCompare(b.entryDate)))
    setIsEditing(false)
    setShowMissing(false)
    setJustSaved(true)
    if (hurting === "yes") navigate("/athlete/wellness/pain", { state: { fromCheckIn: true } })
  }

  const handleResolve = async (report: PainReport) => {
    setResolvingId(report.id)
    const result = await resolveCurrentAthletePainReport(report.id)
    setResolvingId(null)
    if (!result.ok) {
      notify("Could not mark it resolved", result.error.message)
      return
    }
    setPainReports((current) => (current ?? []).filter((item) => item.id !== report.id))
    notify("Marked resolved", "It stays in your wellness history.")
  }

  const handleMarkUnavailable = async () => {
    setUnavailable("saving")
    const result = await setMyAvailability({ kind: "injured", startsOn: today, endsOn: null, note: null })
    if (!result.ok) {
      setUnavailable("no")
      notify("Could not mark you unavailable", result.error.message)
      return
    }
    setUnavailable("yes")
  }

  const resultCopy = todayEntry ? readinessCopy(todayEntry) : null
  const loading = entries === null

  const painSection = (
    <Section
      title="Pain and injuries"
      action={
        painReports && painReports.length > 0 ? (
          <Link className="sk-link" to="/athlete/wellness/pain">
            Report another
          </Link>
        ) : undefined
      }
    >
      {painReports === null ? (
        <SkeletonRows rows={1} label="Checking your pain reports" />
      ) : painReports.length === 0 ? (
        <List>
          <ListRow to="/athlete/wellness/pain" title="Report pain or an injury" subtitle="Tell your coach about something that hurts." />
        </List>
      ) : (
        <List aria-label="Open pain reports">
          {painReports.map((report) => (
            <ListRow
              key={report.id}
              leading={<StatusDot tone={painTone(report)} />}
              title={bodyAreasSummary(report.bodyAreas)}
              subtitle={painReportSummary(report)}
              trailing={
                <Button size="sm" disabled={resolvingId === report.id} onClick={() => void handleResolve(report)}>
                  {resolvingId === report.id ? "Saving..." : "Mark resolved"}
                </Button>
              }
            />
          ))}
        </List>
      )}
    </Section>
  )

  const historySection = (
    <Section
      title="Last 7 days"
      meta={loading ? undefined : weekCount === 0 ? "No check-ins yet" : `${weekCount} of 7${streak >= 2 ? `, ${streak} in a row` : ""}`}
    >
      {loading ? (
        <SkeletonRows rows={7} label="Loading your check-ins" />
      ) : (
        <>
          <List aria-label="Check-ins in the last 7 days">
            {week.map((day) => (
              <ListRow
                key={day.date}
                title={day.isToday ? "Today" : shortDate(day.date)}
                subtitle={day.entry ? `Slept ${formatSleep(day.entry.sleepHours)}` : undefined}
                trailing={
                  day.entry ? (
                    <ReadinessText status={day.entry.readiness} detail={String(day.entry.readinessScore)} />
                  ) : (
                    <span className="font-normal text-sk-mute">{day.isToday ? "Not done yet" : "No check-in"}</span>
                  )
                }
              />
            ))}
            <ListRow to="/athlete/wellness/history" title="Wellness history" subtitle="Earlier weeks, your readiness trend and pain reports." />
          </List>
        </>
      )}
    </Section>
  )

  return (
    <Screen>
      <ScreenHeader
        title="Wellness check-in"
        lede={todayEntry && !isEditing ? "Today is done. Your coach can see how you are feeling." : "Five quick taps before you train. It takes about 20 seconds."}
      />

      {loadError ? <Notice tone="error">We could not load your check-ins. {loadError}</Notice> : null}

      {reported ? (
        <Notice
          tone="success"
          action={
            reported === "cannot_train" && unavailable !== "yes" && unavailable !== "unknown" ? (
              <Button size="sm" disabled={unavailable === "saving"} onClick={() => void handleMarkUnavailable()}>
                {unavailable === "saving" ? "Saving..." : "Mark me unavailable"}
              </Button>
            ) : (
              <Button variant="quiet" size="sm" onClick={() => setReported(null)}>
                Dismiss
              </Button>
            )
          }
        >
          {reported === "none"
            ? "Report saved. Your coaches can see it."
            : reported === "cannot_train" && unavailable === "yes"
              ? "Report sent and you are marked unavailable from today. Your coaches have been told."
              : reported === "cannot_train"
                ? "Report sent. Your coaches have been told. You can also mark yourself unavailable so missed sessions do not count against you."
                : "Report sent. Your coaches have been told."}
        </Notice>
      ) : null}

      <Split
        main={
          loading ? (
            <Section title="How are you today?">
              <SkeletonRows rows={5} label="Loading today's check-in" />
            </Section>
          ) : showForm ? (
            <Section title={isEditing ? "Update today's check-in" : "How are you today?"} meta={longDate(today)}>
              <form onSubmit={(event) => void handleSubmit(event)} noValidate className="flex flex-col gap-5">
                <List>
                  <li>
                    <Stepper
                      label="How long did you sleep?"
                      value={sleep}
                      onChange={setSleep}
                      min={0}
                      max={WELLNESS_SLEEP_MAX_HOURS}
                      step={0.5}
                      format={(hours) => (
                        <>
                          {formatHours(hours)} <span className="text-base font-semibold tracking-normal text-sk-mute">{hours === 1 ? "hour" : "hours"}</span>
                        </>
                      )}
                      decreaseLabel="Half an hour less sleep"
                      increaseLabel="Half an hour more sleep"
                    />
                  </li>
                  {WELLNESS_SCALES.map((scale) => (
                    <li key={scale.key} id={`wellness-${scale.key}`}>
                      <TapScale
                        label={scale.question}
                        name={scale.label}
                        words={scale.words}
                        value={answers[scale.key]}
                        missing={showMissing}
                        onChange={(next) => setAnswers((current) => ({ ...current, [scale.key]: next }))}
                      />
                    </li>
                  ))}
                  <li className="py-4">
                    <Choices
                      label="Anything hurting?"
                      hint={hurting === "yes" ? "You will tell us where right after this." : undefined}
                      value={hurting}
                      onChange={setHurting}
                      options={[
                        { value: "no", label: "No" },
                        { value: "yes", label: "Yes" },
                      ]}
                    />
                  </li>
                </List>

                <Field label="Anything your coach should know?" optional hint="A late night, travel, exams.">
                  <Textarea rows={2} maxLength={WELLNESS_NOTE_MAX_LENGTH} value={notes} onChange={(event) => setNotes(event.target.value)} />
                </Field>

                {submitError ? <Notice tone="error">{submitError}</Notice> : null}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="submit" variant="primary" size="lg" disabled={isSaving} className="sm:flex-1">
                    {isSaving ? "Saving..." : isEditing ? "Save changes" : hurting === "yes" ? "Submit and report pain" : "Submit check-in"}
                  </Button>
                  {isEditing ? (
                    <Button
                      variant="quiet"
                      size="lg"
                      onClick={() => {
                        setIsEditing(false)
                        setSubmitError(null)
                      }}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </form>
            </Section>
          ) : todayEntry && resultCopy ? (
            <>
              <Section title="Today's readiness" meta={justSaved ? "Check-in saved" : longDate(today)}>
                <List>
                  <ListRow
                    leading={<StatusDot tone={todayEntry.readiness === "green" ? "green" : todayEntry.readiness === "yellow" ? "amber" : "coral"} />}
                    title={resultCopy.headline}
                    subtitle={resultCopy.body}
                  />
                </List>
                <StatStrip aria-label="Today's numbers">
                  <Stat label="Readiness" value={todayEntry.readinessScore} of={100} hint={<ReadinessText status={todayEntry.readiness} />} />
                  <Stat label="Sleep" value={formatHours(todayEntry.sleepHours)} unit=" h" />
                </StatStrip>
              </Section>

              <Section
                title="Your answers"
                action={
                  <Button variant="quiet" size="sm" onClick={startEditing}>
                    <PencilSimple className="size-4" weight="bold" aria-hidden />
                    Update today&apos;s check-in
                  </Button>
                }
              >
                <FactList>
                  {WELLNESS_SCALES.map((scale) => {
                    const value = todayEntry[scale.key]
                    return (
                      <Fact key={scale.key} label={scale.label}>
                        {scale.words[value - 1] ?? value}
                        <span className="ml-2 font-normal tabular-nums text-sk-mute">{value} of 5</span>
                      </Fact>
                    )
                  })}
                  {todayEntry.notes ? (
                    <Fact label="Note to coach" stack>
                      {todayEntry.notes}
                    </Fact>
                  ) : null}
                </FactList>
              </Section>
            </>
          ) : null
        }
        side={
          <>
            {painSection}
            {historySection}
          </>
        }
      />
    </Screen>
  )
}
