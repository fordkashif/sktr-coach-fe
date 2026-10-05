import type { CompetitionWithEntries } from "@/lib/data/competition/types"
import { parseLocalDay } from "@/lib/data/pr/pr-display"

/** Shared by the coach's competition screens. */

export const COMPETITIONS_PATH = "/coach/competitions"

export function competitionPath(competitionId: string, sub?: "edit" | "enter"): string {
  return `${COMPETITIONS_PATH}/${encodeURIComponent(competitionId)}${sub ? `/${sub}` : ""}`
}

/** "National Stadium, Kingston" */
export function whereText(competition: Pick<CompetitionWithEntries, "venue" | "location">): string {
  return [competition.venue, competition.location].filter(Boolean).join(", ")
}

/** "On now", "Tomorrow", "In 12 days", "In 6 weeks". */
export function countdownText(startDate: string, today: Date): string {
  const day = parseLocalDay(startDate)
  if (!day) return ""
  const days = Math.round((day.getTime() - today.getTime()) / 86_400_000)
  if (days <= 0) return "On now"
  if (days === 1) return "Tomorrow"
  if (days < 14) return `In ${days} days`
  return `In ${Math.round(days / 7)} weeks`
}

/** "Team meet", "Club wide", "Added by Maya Chen". */
export function scopeText(competition: Pick<CompetitionWithEntries, "scope" | "ownerName">): string {
  if (competition.scope === "club") return "Club wide"
  if (competition.scope === "athlete") return `Added by ${competition.ownerName ?? "an athlete"}`
  return "Team meet"
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}
