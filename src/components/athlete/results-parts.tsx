import { Mark, NavTabs, StatusText, Tag } from "@/components/sk"
import {
  formatWind,
  markUnitLabel,
  type AthleteResult,
  type MarkUnit,
  type NewResultVerdict,
  type ResultStanding,
  describeDifference,
  formatMarkWithUnit,
} from "@/lib/data/pr/marks"
import { formatFullDay, parseLocalDay } from "@/lib/data/pr/pr-display"

/** The four screens under the athlete's Progress tab. */
export function ProgressTabs() {
  return (
    <NavTabs
      label="Progress sections"
      items={[
        { to: "/athlete/trends", label: "Overview" },
        { to: "/athlete/prs", label: "Records" },
        { to: "/athlete/competitions", label: "Competitions" },
        { to: "/athlete/test-week", label: "Tests" },
      ]}
    />
  )
}

/** The address of one event's history. */
export function eventHistoryPath(eventGroup: string): string {
  return `/athlete/prs/event/${encodeURIComponent(eventGroup)}`
}

/** "+0.9" for a legal reading, "+2.6 w" for a wind assisted one, "i" for indoor. */
export function markQualifier(result: Pick<AthleteResult, "wind" | "windLegal" | "environment">): string | undefined {
  const parts: string[] = []
  if (result.wind !== null) parts.push(formatWind(result.wind))
  if (!result.windLegal) parts.push("w")
  if (result.environment === "indoor") parts.push("i")
  return parts.length ? parts.join(" ") : undefined
}

export function ResultMark({ result, size = "md", withWind = false }: { result: AthleteResult; size?: "sm" | "md" | "lg"; withWind?: boolean }) {
  return <Mark value={result.display} unit={markUnitLabel(result.display, result.unit)} qualifier={withWind ? markQualifier(result) : undefined} size={size} />
}

/** "11.28s (+0.9)" as plain text, for sentences. */
export function markText(result: AthleteResult): string {
  const wind = result.wind !== null ? ` (${formatWind(result.wind)})` : ""
  return `${formatMarkWithUnit(result.display, result.unit)}${wind}`
}

/** "Jul 11, 2026" */
export function dayText(date: string): string {
  return formatFullDay(date)
}

/** "Sat, Oct 17" or, with a year when it is not this year, "Sat, Oct 17, 2027". */
export function meetDayText(date: string): string {
  const day = parseLocalDay(date)
  if (!day) return date
  const sameYear = day.getFullYear() === new Date().getFullYear()
  return day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })
}

export function meetDatesText(startDate: string, endDate: string): string {
  return startDate === endDate ? meetDayText(startDate) : `${meetDayText(startDate)} to ${meetDayText(endDate)}`
}

/** "Jul 11, 2026, Summer Open" */
export function whenAndWhere(result: AthleteResult): string {
  return [dayText(result.date), result.location].filter(Boolean).join(", ")
}

/** "2nd" */
export function ordinal(place: number): string {
  const tens = place % 100
  if (tens >= 11 && tens <= 13) return `${place}th`
  const last = place % 10
  return `${place}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`
}

/** The status column of a results table. */
export function StandingTag({ standing }: { standing: ResultStanding }) {
  if (standing === "personal-best") return <Tag tone="green">Personal best</Tag>
  if (standing === "season-best") return <Tag tone="blue">Season best</Tag>
  if (standing === "wind-assisted") return <Tag tone="yellow">Wind assisted</Tag>
  return null
}

/** "PB" or "SB" beside a mark outside a table. */
export function BestStatus({ kind }: { kind: "pb" | "sb" }) {
  return kind === "pb" ? <StatusText tone="green">Personal best</StatusText> : <StatusText tone="blue">Season best</StatusText>
}

/** What to tell the athlete after a result is saved. */
export function verdictMessage(result: AthleteResult, verdict: NewResultVerdict): { tone: "success" | "warning" | "info"; text: string } {
  const mark = markText(result)
  const event = result.eventLabel
  if (verdict.kind === "wind-assisted") {
    return {
      tone: "warning",
      text: `Saved as wind assisted. ${mark} is in your ${event} history, but a wind over +2.0 does not count for a personal or season best.`,
    }
  }
  if (verdict.kind === "personal-best") {
    const gain = verdict.beat ? describeDifference(result, verdict.beat) : null
    return {
      tone: "success",
      text: `New personal best in the ${event}: ${mark}${gain && verdict.beat ? `, ${gain.text} than your ${formatMarkWithUnit(verdict.beat.display, verdict.beat.unit)}` : ""}. Your coach will see it.`,
    }
  }
  if (verdict.kind === "season-best") {
    const gain = verdict.beat ? describeDifference(result, verdict.beat) : null
    return {
      tone: "success",
      text: `New season best in the ${event}: ${mark}${gain && verdict.beat ? `, ${gain.text} than your ${formatMarkWithUnit(verdict.beat.display, verdict.beat.unit)}` : ""}.`,
    }
  }
  if (verdict.kind === "first") {
    return { tone: "success", text: `Saved. ${mark} is your first ${event} result, so it is your personal best.` }
  }
  return { tone: "info", text: `Saved. ${mark} is in your ${event} history.` }
}

export const UNIT_WORDS: Record<MarkUnit, { field: string; hint: string; placeholder: string }> = {
  s: { field: "Time", hint: "Like 10.84, or 1:52.30 for minutes and seconds.", placeholder: "10.84" },
  m: { field: "Distance or height (metres)", hint: "In metres with two decimals, like 7.42.", placeholder: "7.42" },
  cm: { field: "Height (centimetres)", hint: "In centimetres, like 72.", placeholder: "72" },
  kg: { field: "Weight (kilograms)", hint: "In kilograms, like 182.5.", placeholder: "182.5" },
  pts: { field: "Points", hint: "A whole number, like 5420.", placeholder: "5420" },
}
