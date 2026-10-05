"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Button, Choices, Field, Input, LinkButton, Notice, Screen, ScreenHeader, Section, Tabs, TapScale, Textarea } from "@/components/sk"
import { submitCurrentAthletePainReport, validatePainReportInput } from "@/lib/data/wellness/pain-report-data"
import {
  BODY_REGIONS,
  PAIN_IMPACT_OPTIONS,
  PAIN_MAX_AREAS,
  PAIN_NOTE_MAX_LENGTH,
  PAIN_SEVERITY_WORDS,
  bodyAreasSummary,
  type BodyRegionKey,
  type PainReportField,
  type PainTrainingImpact,
} from "@/lib/data/wellness/pain-report-types"
import { localWellnessDate } from "@/lib/data/wellness/wellness-data"

/** Report pain or an injury. Reached from the wellness check-in ("Anything hurting?") and on its own. */
export default function AthletePainReportPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const fromCheckIn = Boolean((location.state as { fromCheckIn?: boolean } | null)?.fromCheckIn)
  const today = localWellnessDate()

  const [region, setRegion] = useState<BodyRegionKey>("upper-legs")
  const [bodyAreas, setBodyAreas] = useState<string[]>([])
  const [severity, setSeverity] = useState<number | null>(null)
  const [startedOn, setStartedOn] = useState(today)
  const [trainingImpact, setTrainingImpact] = useState<PainTrainingImpact | null>(null)
  const [note, setNote] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PainReportField, string>>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const activeRegion = BODY_REGIONS.find((item) => item.key === region) ?? BODY_REGIONS[0]
  // Shown in the order of the list, not the order they were tapped.
  const orderedAreas = useMemo(
    () => BODY_REGIONS.flatMap((item) => item.areas.map((area) => area.key)).filter((key) => bodyAreas.includes(key)),
    [bodyAreas],
  )

  const clearError = (field: PainReportField) => {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
    setSaveError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return

    const input = { bodyAreas: orderedAreas, severity, startedOn, trainingImpact, note: note.trim() || null }
    const validation = validatePainReportInput(input)
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors)
      setSaveError("Some answers are missing. Check the questions marked in red.")
      return
    }

    setSaving(true)
    setSaveError(null)
    const result = await submitCurrentAthletePainReport(input)
    setSaving(false)
    if (!result.ok) {
      setSaveError(
        result.error.code === "FORBIDDEN" || result.error.code === "UNAUTHORIZED"
          ? "We could not send this report. Sign in again and retry."
          : `We could not send this report. ${result.error.message}`,
      )
      return
    }
    navigate("/athlete/wellness", { replace: true, state: { painReported: result.data.trainingImpact } })
  }

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: "/athlete/wellness", label: "Wellness" }}
        title="Report pain or an injury"
        lede={
          fromCheckIn
            ? "Check-in saved. Now tell us what hurts, so your coach can adjust your training."
            : "Tell us what hurts, so your coach can adjust your training."
        }
      />

      <Notice>Only you, the coaches of your team and your club&apos;s admins can see this report. Other athletes cannot.</Notice>

      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="flex flex-col gap-7">
        <Section title="Where does it hurt?" hint="Pick every area that applies." meta={orderedAreas.length > 0 ? `${orderedAreas.length} picked` : undefined}>
          <Tabs
            label="Part of the body"
            value={region}
            onChange={setRegion}
            options={BODY_REGIONS.map((item) => {
              const count = item.areas.filter((area) => bodyAreas.includes(area.key)).length
              return { value: item.key, label: item.label, count: count > 0 ? count : undefined }
            })}
          />
          <Choices
            className="pt-4"
            label={`${activeRegion.label}: areas that hurt`}
            hideLabel
            multiple
            columns={2}
            value={bodyAreas}
            onChange={(next) => {
              setBodyAreas(next.slice(0, PAIN_MAX_AREAS))
              clearError("bodyAreas")
            }}
            options={activeRegion.areas.map((area) => ({ value: area.key, label: area.label }))}
            error={fieldErrors.bodyAreas}
          />
          <p className="pt-3 text-[0.9375rem] text-sk-mute" aria-live="polite">
            {orderedAreas.length > 0 ? (
              <>
                Picked: <span className="font-semibold text-sk-ink">{bodyAreasSummary(orderedAreas)}</span>
              </>
            ) : (
              "Nothing picked yet."
            )}
          </p>
        </Section>

        <Section title="About it">
          <TapScale
            label="How bad is it?"
            name="Pain"
            words={PAIN_SEVERITY_WORDS}
            value={severity}
            missing={Boolean(fieldErrors.severity)}
            onChange={(next) => {
              setSeverity(next)
              clearError("severity")
            }}
          />
          <Field label="When did it start?" error={fieldErrors.startedOn} className="pb-5 pt-1">
            <Input
              type="date"
              min="2000-01-01"
              max={today}
              value={startedOn}
              onChange={(event) => {
                setStartedOn(event.target.value)
                clearError("startedOn")
              }}
            />
          </Field>
          <Choices
            label="Does it stop you training?"
            columns={3}
            value={trainingImpact}
            onChange={(next) => {
              setTrainingImpact(next)
              clearError("trainingImpact")
            }}
            options={PAIN_IMPACT_OPTIONS}
            error={fieldErrors.trainingImpact}
            hint={trainingImpact && trainingImpact !== "none" ? "Your coaches get a notification when you send this." : undefined}
          />
          <Field label="Anything else your coach should know?" optional error={fieldErrors.note} hint="How it happened, what makes it worse." className="pt-5">
            <Textarea
              rows={3}
              maxLength={PAIN_NOTE_MAX_LENGTH}
              value={note}
              onChange={(event) => {
                setNote(event.target.value)
                clearError("note")
              }}
            />
          </Field>
        </Section>

        {saveError ? <Notice tone="error">{saveError}</Notice> : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" variant="primary" size="lg" disabled={saving} className="sm:flex-1">
            {saving ? "Sending..." : "Send report"}
          </Button>
          <LinkButton to="/athlete/wellness" variant="quiet" size="lg">
            {fromCheckIn ? "Skip for now" : "Cancel"}
          </LinkButton>
        </div>
      </form>
    </Screen>
  )
}
