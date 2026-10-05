import { MagnifyingGlass } from "@phosphor-icons/react"
import type { InputHTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Button, Field, Input } from "./controls"

/**
 * FormGrid: the layout for a group of Fields. One column on phone; two (or, with `columns={4}`,
 * four on desktop) from tablet up. A Field that should be wider takes `className="sm:col-span-2"`
 * (or "sm:col-span-full").
 */
export function FormGrid({ children, columns = 2, className }: { children: ReactNode; columns?: 2 | 4; className?: string }) {
  return <div className={cn("grid gap-x-4 gap-y-4 sm:grid-cols-2", columns === 4 && "lg:grid-cols-4", className)}>{children}</div>
}

/**
 * FormActions: the buttons that end a form. The main action is on the right on desktop and on top,
 * full width, on phone. Put the quiet "Cancel" first and the main action last.
 */
export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end", className)}>{children}</div>
}

/** SearchInput: an Input with the search icon inside. Wrap it in a Field like any Input. */
export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="relative block">
      <MagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-sk-mute" weight="bold" aria-hidden />
      <Input type="search" className={cn("pl-10", className)} {...props} />
    </span>
  )
}

export type DateRangeValue = { from: string; to: string }

/**
 * DateRangeFields: "From" and "To" as two date fields side by side, with optional quick ranges
 * under them ("Last 28 days"). Dates are ISO days. The range is always kept the right way round:
 * moving one end past the other moves the other end with it.
 */
export function DateRangeFields({
  value,
  onChange,
  max,
  presets,
  className,
}: {
  value: DateRangeValue
  onChange: (next: DateRangeValue) => void
  /** Latest day that can be picked (usually today). */
  max?: string
  presets?: Array<{ label: string; range: DateRangeValue }>
  className?: string
}) {
  const set = (patch: Partial<DateRangeValue>) => {
    const next = { ...value, ...patch }
    if (!next.from || !next.to) return
    if (next.from > next.to) {
      if (patch.from) next.to = next.from
      else next.from = next.to
    }
    onChange(next)
  }
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <Input type="date" value={value.from} max={max} onChange={(event) => set({ from: event.target.value })} />
        </Field>
        <Field label="To">
          <Input type="date" value={value.to} max={max} onChange={(event) => set({ to: event.target.value })} />
        </Field>
      </div>
      {presets && presets.length > 0 ? (
        <div className="-ml-2.5 flex flex-wrap gap-x-1">
          {presets.map((preset) => {
            const active = preset.range.from === value.from && preset.range.to === value.to
            return (
              <Button key={preset.label} variant="quiet" size="sm" aria-pressed={active} className={cn(active && "text-sk-ink")} onClick={() => onChange(preset.range)}>
                {preset.label}
              </Button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
