import { StatusText } from "@/components/sk"
import type { PlanStatus } from "@/lib/data/training-plan/plan-builder-model"

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
