import { cn } from "@/lib/utils"

export type StepIndicatorStep = { id: string; label: string }

/**
 * StepIndicator: where someone is in a short run of screens that must be done in order (a setup
 * wizard). One thin bar per step, blue up to and including the current one, with the step's name
 * under it on tablet and desktop. On a phone only the bars show, so put "Step 3 of 6: Club details"
 * in the `fact` of the ScreenHeader above it. Read-only: steps are not links. Three to seven steps.
 * Goes straight under the ScreenHeader.
 */
export function StepIndicator({
  steps,
  current,
  label = "Setup progress",
  className,
}: {
  steps: StepIndicatorStep[]
  /** The id of the step being shown. */
  current: string
  /** What the steps are, for screen readers. */
  label?: string
  className?: string
}) {
  const currentIndex = steps.findIndex((step) => step.id === current)
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex gap-1.5 sm:gap-2">
        {steps.map((step, index) => {
          const done = index < currentIndex
          const active = index === currentIndex
          return (
            <li key={step.id} aria-current={active ? "step" : undefined} className="min-w-0 flex-1" data-step-state={done ? "done" : active ? "current" : "todo"}>
              <span aria-hidden className={cn("block h-1 rounded-full", done || active ? "bg-sk-blue" : "bg-sk-line")} />
              <span className={cn("mt-2 block truncate text-sm max-sm:sr-only", active ? "font-bold text-sk-ink" : done ? "font-semibold text-sk-ink-2" : "text-sk-mute")}>
                <span className="sr-only">{`Step ${index + 1}: `}</span>
                {step.label}
                <span className="sr-only">{done ? ", done" : active ? ", current step" : ""}</span>
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
