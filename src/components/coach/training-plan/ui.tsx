import { StatusText } from "@/components/sk"
import type { PlanStatus } from "@/lib/data/training-plan/plan-builder-model"
import { eventGroupLabel, formatLastUsed, phaseLabel, sessionsPerWeek, type PlanTemplateSummary } from "@/lib/data/training-plan/plan-templates"

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

const STATUS: Record<PlanStatus, { label: string; tone: "amber" | "green" | "neutral" }> = {
  draft: { label: "Draft", tone: "amber" },
  published: { label: "Published", tone: "green" },
  archived: { label: "Archived", tone: "neutral" },
}

/** A plan's state as a dot and a word, the same on the list, the builder and the print dialog. */
export function PlanStatusText({ status }: { status: PlanStatus }) {
  return <StatusText tone={STATUS[status].tone}>{STATUS[status].label}</StatusText>
}

/** One line about a template: length, sessions a week, tags, who made it, when it was last used. */
export function templateFacts(template: PlanTemplateSummary) {
  const rate = sessionsPerWeek(template.sessionCount, template.weeks)
  return [
    // A plan with less than a session a week reads better as a total ("1 session in all").
    `${plural(template.weeks, "week")}, ${template.sessionCount < template.weeks ? `${plural(template.sessionCount, "session")} in all` : `${rate} ${rate === "1" ? "session" : "sessions"} a week`}`,
    [phaseLabel(template.phase), eventGroupLabel(template.eventGroup)].filter(Boolean).join(", "),
    `Made by ${template.createdByName === "You" ? "you" : template.createdByName || "a coach"}`,
    formatLastUsed(template.lastUsedAt),
  ]
    .filter(Boolean)
    .join(". ")
}
