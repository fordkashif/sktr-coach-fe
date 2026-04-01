"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { submitCurrentAthleteWellnessEntry } from "@/lib/data/wellness/wellness-data"
import type { WellnessReadiness } from "@/lib/data/wellness/types"
import { getBackendMode } from "@/lib/supabase/config"
import { cn } from "@/lib/utils"

function metricLabel(label: string, value: number) {
  return (
    <div className="mb-2 flex items-center justify-between text-sm">
      <Label className="text-sm font-medium text-slate-950">{label}</Label>
      <span className="text-sm font-semibold text-slate-950">{value}</span>
    </div>
  )
}

export default function AthleteWellnessPage() {
  const backendMode = getBackendMode()
  const [sleep, setSleep] = useState(8)
  const [soreness, setSoreness] = useState(2)
  const [fatigue, setFatigue] = useState(2)
  const [mood, setMood] = useState(4)
  const [stress, setStress] = useState(2)
  const [notes, setNotes] = useState("")
  const [result, setResult] = useState<WellnessReadiness | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitError(null)

    const loadScore = (soreness + fatigue + stress) / 3
    const readiness: WellnessReadiness = loadScore <= 2.5 && sleep >= 7 && mood >= 3 ? "green" : loadScore <= 3.5 && sleep >= 6 ? "yellow" : "red"

    if (backendMode === "supabase") {
      setIsSaving(true)
      const today = new Date().toISOString().slice(0, 10)
      const persistResult = await submitCurrentAthleteWellnessEntry({
        entryDate: today,
        sleepHours: sleep,
        soreness,
        fatigue,
        mood,
        stress,
        notes: notes.trim() || null,
      })
      setIsSaving(false)
      if (!persistResult.ok) {
        setSubmitError(persistResult.error.message)
        return
      }
      setResult(persistResult.data.readiness)
      return
    }

    setResult(readiness)
  }

  const readinessSummary =
    result === "green"
      ? {
          label: "Ready",
          body: "Recovery is in a good place. Stay on the current training schedule.",
          tone: "status-chip-info",
        }
      : result === "yellow"
        ? {
            label: "Watch",
            body: "You are trending manageable, but today may need a lighter touch.",
            tone: "bg-amber-100 text-amber-700",
          }
        : result === "red"
          ? {
              label: "Review",
              body: "Your coach should review load and recovery before a full session.",
              tone: "bg-rose-100 text-rose-700",
            }
          : null

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="page-intro">
        <div>
          <h1 className="page-intro-title">Wellness</h1>
          <p className="page-intro-copy">Quick daily check-in to score how ready you are to train today.</p>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Daily Input</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Check-In Form</h2>
          </div>

          <form className="mt-4 space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="sleep" className="text-sm font-medium text-slate-950">Sleep hours</Label>
                <Input
                  id="sleep"
                  type="number"
                  min={0}
                  max={12}
                  step={0.5}
                  value={sleep}
                  onChange={(event) => setSleep(Number(event.target.value))}
                  className="h-12 rounded-[18px] border-slate-200 bg-slate-50 text-slate-950"
                />
              </div>
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Today&apos;s target</p>
                <p className="mt-1.5 text-sm text-slate-500">Aim for at least `7` hours if you want the best readiness signal.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { label: "Soreness (1-5)", value: soreness, setValue: setSoreness },
                { label: "Fatigue (1-5)", value: fatigue, setValue: setFatigue },
                { label: "Mood (1-5)", value: mood, setValue: setMood },
                { label: "Stress (1-5)", value: stress, setValue: setStress },
              ].map((item) => (
                <div key={item.label} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                  {metricLabel(item.label, item.value)}
                  <Slider min={1} max={5} step={1} value={[item.value]} onValueChange={([value]) => item.setValue(value)} />
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes" className="text-sm font-medium text-slate-950">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Any details your coach should know before training..."
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="min-h-[120px] rounded-[18px] border-slate-200 bg-slate-50 text-slate-950"
              />
            </div>

            <Button type="submit" disabled={isSaving} className="h-12 w-full rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95">
              {isSaving ? "Saving..." : "Save check-in"}
            </Button>
            {submitError ? <p className="text-sm text-rose-700">{submitError}</p> : null}
          </form>
        </div>

        <div className="space-y-5">
          <div className="mobile-card-primary">
            <div className="space-y-1 border-b border-slate-200 pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Recovery Guide</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">How This Scores</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-500">
              <p>Lower soreness, fatigue, and stress with enough sleep produce a stronger readiness signal.</p>
              <div className="grid gap-2">
                {[
                  { label: "Ready", body: "Low load score, enough sleep, stable mood.", tone: "status-chip-info" },
                  { label: "Watch", body: "Moderate load score or lower sleep.", tone: "status-chip-warning" },
                  { label: "Review", body: "High load score or poor recovery markers.", tone: "status-chip-danger" },
                ].map((item) => (
                  <div key={item.label} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", item.tone)}>{item.label}</span>
                    <p className="mt-2 text-sm text-slate-500">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mobile-card-primary">
            <div className="space-y-1 border-b border-slate-200 pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Result</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Readiness Output</h2>
            </div>
            {readinessSummary ? (
              <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", readinessSummary.tone)}>
                  {readinessSummary.label}
                </span>
                <p className="mt-3 text-sm text-slate-500">{readinessSummary.body}</p>
              </div>
            ) : (
              <div className="mt-4 rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                <p className="text-sm text-slate-500">Submit today&apos;s check-in to generate a readiness state.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
