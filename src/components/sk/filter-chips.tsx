import { Funnel } from "@phosphor-icons/react"
import { useId, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

export type FilterChipOption<T extends string> = { value: T; label: string; count?: number }

/**
 * FilterChips: one filter of a list as a row of small toggles ("Readiness: All, Ready, Watch,
 * Review"). One is always chosen; the first option is normally "All". The label sits before the
 * chips on desktop and above them on phone, where a long row scrolls sideways inside itself and
 * the page never does. Use several, one per thing you can filter by, under a SearchInput.
 * (Segmented switches views, Choices answers a form question; this narrows a list.)
 */
export function FilterChips<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string
  value: T
  onChange: (next: T) => void
  options: Array<FilterChipOption<T>>
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3", className)}>
      <p id={id} className="shrink-0 text-sm font-semibold text-sk-mute">
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={id} className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
        {options.map((option) => {
          const on = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(option.value)}
              className={cn(
                "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[12px] border px-3.5 text-[0.9375rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue lg:min-h-10",
                on ? "border-sk-blue bg-sk-blue-tint text-sk-blue-ink" : "border-sk-line-strong bg-white text-sk-ink-2 hover:border-sk-blue",
              )}
            >
              {option.label}
              {option.count !== undefined ? <span className={cn("tabular-nums", on ? "text-sk-blue-ink" : "text-sk-mute")}>{option.count}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * FilterBar: the search box and filters above a list or table. `search` is a SearchInput; the
 * children are FilterChips rows. On desktop everything shows. On phone the filters fold away behind
 * a "Filters" button (with the number in use) so the list starts near the top of the screen.
 * `activeCount` is how many filters are not on "All"; with `onClear` a "Clear filters" action appears.
 */
export function FilterBar({
  search,
  children,
  activeCount = 0,
  onClear,
  className,
}: {
  search?: ReactNode
  children?: ReactNode
  activeCount?: number
  onClear?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        {search ? <div className="min-w-0 flex-1 sm:max-w-sm">{search}</div> : null}
        {children ? (
          <button type="button" className="sk-btn sk-btn-secondary sm:hidden" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)}>
            <Funnel className="size-[18px]" weight="bold" aria-hidden />
            Filters
            {activeCount > 0 ? <span className="tabular-nums text-sk-blue-ink">{activeCount}</span> : null}
          </button>
        ) : null}
        {activeCount > 0 && onClear ? (
          <button type="button" className="sk-btn sk-btn-text sk-btn-sm max-sm:hidden" onClick={onClear}>
            Clear filters
          </button>
        ) : null}
      </div>
      {children ? (
        <div id={panelId} className={cn("flex-col gap-2.5 sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8", open ? "flex" : "hidden")}>
          {children}
          {activeCount > 0 && onClear ? (
            <button type="button" className="sk-btn sk-btn-text sk-btn-sm self-start sm:hidden" onClick={onClear}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
