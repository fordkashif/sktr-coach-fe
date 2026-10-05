import { useId } from "react"
import { cn } from "@/lib/utils"

/**
 * QuickPick: mark one row of a list with one tap, from two to four short words that sit side by
 * side in one line (attendance: Present, Late, Absent, Excused). Equal buttons, 44px tall. The
 * chosen one takes the tint of what it means (green, amber, coral, or neutral ink); the others stay
 * plain. Nothing has to be chosen (`value` null). `label` names the group for screen readers
 * ("Attendance of Marcus Johnson").
 * For a question in a form use `Choices`; for switching views use `Segmented`.
 */

export type QuickPickTone = "green" | "amber" | "coral" | "neutral" | "blue"

export type QuickPickOption<T extends string> = { value: T; label: string; tone?: QuickPickTone }

const ON: Record<QuickPickTone, string> = {
  green: "border-sk-green bg-sk-green-tint text-sk-green-ink",
  amber: "border-sk-amber bg-sk-yellow-tint text-sk-amber-ink",
  coral: "border-sk-coral bg-sk-coral-tint text-sk-coral-ink",
  neutral: "border-sk-ink-2 bg-sk-soft-2 text-sk-ink",
  blue: "border-sk-blue bg-sk-blue-tint text-sk-blue-ink",
}

export function QuickPick<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled = false,
  className,
}: {
  label: string
  value: T | null
  onChange: (next: T) => void
  options: Array<QuickPickOption<T>>
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  return (
    <div className={className}>
      <span id={id} className="sr-only">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="grid auto-cols-fr grid-flow-col gap-1.5">
        {options.map((option) => {
          const on = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex min-h-11 min-w-0 cursor-pointer items-center justify-center rounded-[12px] border px-1 text-center text-sm leading-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 sm:text-[0.9375rem]",
                on ? cn("font-bold", ON[option.tone ?? "blue"]) : "border-sk-line-strong bg-white font-semibold text-sk-ink-2 hover:bg-sk-soft hover:text-sk-ink",
              )}
            >
              <span className="truncate">{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
