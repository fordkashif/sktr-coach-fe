import { CaretLeft, CaretRight, Check, Minus } from "@phosphor-icons/react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * WeekPager: which week (or other period) is showing, with previous and next buttons.
 * `title` is the period in words ("Week 2 of 4", "This week"), `subtitle` the dates under it.
 * `action` sits before the arrows (a quiet "Today" button). Leave a handler out to disable that arrow.
 */
export function WeekPager({
  title,
  subtitle,
  onPrevious,
  onNext,
  previousLabel = "Previous week",
  nextLabel = "Next week",
  action,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  onPrevious?: () => void
  onNext?: () => void
  previousLabel?: string
  nextLabel?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="min-w-0" aria-live="polite">
        <p className="text-lg font-bold leading-tight tracking-[-0.02em] text-sk-ink lg:text-[1.375rem]">{title}</p>
        {subtitle ? <p className="mt-0.5 text-sm text-sk-mute">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {action}
        <button type="button" className="sk-icon-btn disabled:pointer-events-none disabled:opacity-40" aria-label={previousLabel} disabled={!onPrevious} onClick={onPrevious}>
          <CaretLeft className="size-5" weight="bold" aria-hidden />
        </button>
        <button type="button" className="sk-icon-btn disabled:pointer-events-none disabled:opacity-40" aria-label={nextLabel} disabled={!onNext} onClick={onNext}>
          <CaretRight className="size-5" weight="bold" aria-hidden />
        </button>
      </div>
    </div>
  )
}

export type DayPickerDay = {
  /** The value handed to onSelect (an ISO day). */
  key: string
  /** One letter weekday. */
  letter: string
  number: number
  /** today: blue. done: green tick. planned: soft fill. skipped: soft fill with a dash. missed: coral. rest: plain number. */
  state: "today" | "done" | "planned" | "skipped" | "missed" | "rest"
  isToday?: boolean
  /** Full sentence for screen readers: "Monday 5 October, today, session planned". */
  label: string
}

const DAY_STATE: Record<DayPickerDay["state"], string> = {
  today: "bg-sk-blue font-bold text-white",
  done: "bg-sk-green-tint font-bold text-sk-green-ink",
  planned: "bg-sk-soft-2 font-bold text-sk-ink",
  skipped: "bg-sk-soft-2 font-bold text-sk-mute",
  missed: "bg-sk-coral-tint font-bold text-sk-coral-ink",
  rest: "font-semibold text-sk-faint",
}

/**
 * DayPicker: the seven days of a week as circles you can tap. Same look as DayStrip (which is read
 * only); the selected day has a ring. Use it with WeekPager to move through weeks.
 */
export function DayPicker({
  days,
  selected,
  onSelect,
  className,
  ...rest
}: {
  days: DayPickerDay[]
  selected: string
  onSelect: (key: string) => void
  className?: string
  "aria-label"?: string
}) {
  return (
    <ol className={cn("grid grid-cols-7 gap-1.5 text-center", className)} {...rest}>
      {days.map((day) => {
        const active = day.key === selected
        return (
          <li key={day.key}>
            <button
              type="button"
              aria-current={active ? "date" : undefined}
              aria-label={day.label}
              data-state={day.state}
              onClick={() => onSelect(day.key)}
              className="group flex min-h-11 w-full cursor-pointer flex-col items-center rounded-[12px] pb-1 pt-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
            >
              <span className={cn("block text-xs font-semibold", day.isToday ? "font-bold text-sk-blue-link" : "text-sk-mute")} aria-hidden>
                {day.letter}
              </span>
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 flex size-9 items-center justify-center rounded-full text-sm tabular-nums outline-2 outline-offset-2 transition-colors",
                  DAY_STATE[day.state],
                  active ? "outline outline-sk-ink" : "outline-transparent group-hover:outline group-hover:outline-sk-line-strong",
                )}
              >
                {day.state === "done" ? <Check className="size-4" weight="bold" /> : day.state === "skipped" ? <Minus className="size-4" weight="bold" /> : day.number}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** DayLabel: a weekday over the day of the month, as the leading part of a ListRow in a week. Today is blue. */
export function DayLabel({ weekday, number, today = false, muted = false }: { weekday: string; number: number; today?: boolean; muted?: boolean }) {
  return (
    <span className="flex w-9 flex-col items-center leading-none" aria-hidden>
      <span className={cn("text-xs font-semibold", today ? "font-bold text-sk-blue-link" : "text-sk-mute")}>{weekday}</span>
      <span className={cn("mt-1 text-lg font-extrabold tabular-nums", today ? "text-sk-blue-link" : muted ? "text-sk-faint" : "text-sk-ink")}>{number}</span>
    </span>
  )
}

/**
 * ActionBar: a bar that stays at the bottom of the screen while the content scrolls, above the phone
 * tab bar. For progress and the state of a long task ("3 of 12 done", "Saved") and at most one button.
 * Put it last inside Screen. It spans the screen's gutters and never covers the tab bar.
 */
export function ActionBar({ children, className, ...rest }: { children: ReactNode; className?: string; "aria-label"?: string }) {
  return (
    <div
      data-sk-actionbar
      className={cn("sticky bottom-0 z-20 -mx-5 -mb-12 border-t border-sk-line bg-white px-5 py-2.5 sm:-mx-6 sm:px-6 lg:-mx-10 lg:-mb-16 lg:px-10", className)}
      {...rest}
    >
      <div className="flex min-h-11 items-center justify-between gap-4">{children}</div>
    </div>
  )
}
