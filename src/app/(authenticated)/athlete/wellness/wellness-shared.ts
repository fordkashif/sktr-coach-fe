import { localWellnessDate } from "@/lib/data/wellness/wellness-data"
import { PAIN_SEVERITY_WORDS, painImpactLabel, type PainReport } from "@/lib/data/wellness/pain-report-types"
import type { WellnessEntry } from "@/lib/data/wellness/types"

export type ScaleKey = "soreness" | "fatigue" | "mood" | "stress"

/** Stored values stay 1 to 5. Soreness, fatigue and stress: 1 is best. Mood: 5 is best. */
export const WELLNESS_SCALES: Array<{ key: ScaleKey; label: string; question: string; words: string[] }> = [
  { key: "soreness", label: "Soreness", question: "How sore is your body?", words: ["None", "Light", "Some", "Sore", "Very sore"] },
  { key: "fatigue", label: "Fatigue", question: "How tired do you feel?", words: ["Fresh", "Good", "OK", "Tired", "Drained"] },
  { key: "mood", label: "Mood", question: "How is your mood?", words: ["Low", "Flat", "OK", "Good", "Great"] },
  { key: "stress", label: "Stress", question: "How stressed are you?", words: ["Calm", "Light", "Some", "High", "Very high"] },
]

export function parseLocalDate(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

export function shiftDate(iso: string, days: number) {
  const date = parseLocalDate(iso)
  date.setDate(date.getDate() + days)
  return localWellnessDate(date)
}

/** "Mon 5 Oct" */
export function shortDate(iso: string) {
  return parseLocalDate(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
}

/** "Monday 5 October" */
export function longDate(iso: string) {
  return parseLocalDate(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
}

export function formatHours(hours: number) {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
}

export function formatSleep(hours: number) {
  return `${formatHours(hours)} ${hours === 1 ? "hour" : "hours"}`
}

/** What the readiness result means for today, in plain words. */
export function readinessCopy(entry: WellnessEntry): { headline: string; body: string } {
  if (entry.readiness === "green") {
    return { headline: "You are ready to train", body: "Sleep, soreness, fatigue and stress all look good. Train as planned." }
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

/** "Moderate, since 3 Oct. Training modified." */
export function painReportSummary(report: PainReport) {
  const since = parseLocalDate(report.startedOn).toLocaleDateString(undefined, { day: "numeric", month: "short" })
  return `${PAIN_SEVERITY_WORDS[report.severity - 1] ?? report.severity}, since ${since}. ${painImpactLabel(report.trainingImpact)}.`
}

export function painTone(report: PainReport): "coral" | "amber" | "neutral" {
  if (report.status === "resolved") return "neutral"
  return report.trainingImpact === "cannot_train" ? "coral" : "amber"
}
