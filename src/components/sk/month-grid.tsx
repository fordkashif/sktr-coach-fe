import { cn } from "@/lib/utils"
import type { StateTone } from "./status"

export type MonthGridSpan = {
  key: string
  title: string
  isStart: boolean
  isEnd: boolean
  /** Write the name on this day (the first day, and the first day of each week row). */
  showTitle: boolean
}

export type MonthGridDay = {
  /** ISO day, handed to onSelect. */
  date: string
  dayNumber: number
  /** False for the days of the month before and after that fill the first and last week. */
  inMonth: boolean
  isToday: boolean
  /** Full sentence for screen readers: "Wednesday 14 October, today, 3 things". */
  label: string
  /** Things lasting several days, one per row, null for an empty row. Drawn as a bar across the days. */
  spans: Array<MonthGridSpan | null>
  /** One day things: written out on desktop (the first three), counted on phone. */
  lines: Array<{ key: string; title: string; tone: StateTone }>
  /** Phone: one small dot per kind of thing on the day. */
  dots: StateTone[]
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const DOT: Record<StateTone, string> = { green: "sk-dot-green", amber: "sk-dot-amber", coral: "sk-dot-coral", blue: "sk-dot-blue", neutral: "" }
const MAX_LINES = 3

/**
 * MonthGrid: a month as weeks of seven days, Monday first. Every day is one button that opens that
 * day (the screen shows what is on it in a Sheet). Rows are divided by hairlines; there are no boxes.
 * On a phone a day shows its number, a thin bar for anything lasting several days and up to four
 * dots. From desktop width up it also writes the names. Colour is state: a blue dot is something on,
 * amber is something to watch, green is done, coral needs attention, grey is planned.
 * Give it whole weeks (`weeks` of exactly seven days each).
 */
export function MonthGrid({ weeks, selected, onSelect, label, className }: { weeks: MonthGridDay[][]; selected?: string | null; onSelect: (date: string) => void; label: string; className?: string }) {
  return (
    <div role="grid" aria-label={label} className={cn("w-full select-none", className)}>
      <div role="row" className="grid grid-cols-7">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} role="columnheader" className="pb-2 text-center text-xs font-semibold text-sk-mute lg:pl-2 lg:text-left lg:text-sm">
            <span aria-hidden className="lg:hidden">
              {weekday.charAt(0)}
            </span>
            <span className="sr-only lg:not-sr-only">{weekday}</span>
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]?.date} role="row" className="grid grid-cols-7 border-t border-sk-line">
          {week.map((day) => {
            const more = day.lines.length - MAX_LINES
            return (
              <div key={day.date} role="gridcell" className="min-w-0">
                <button
                  type="button"
                  aria-label={day.label}
                  aria-current={day.isToday ? "date" : undefined}
                  aria-pressed={selected === day.date}
                  data-date={day.date}
                  data-in-month={day.inMonth}
                  onClick={() => onSelect(day.date)}
                  className={cn(
                    "group flex min-h-[3.75rem] w-full cursor-pointer flex-col items-stretch pb-1.5 pt-1.5 text-left hover:bg-sk-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sk-blue lg:min-h-[7.5rem] lg:pb-2",
                    selected === day.date && "bg-sk-soft",
                  )}
                >
                  <span className="flex justify-center lg:justify-start lg:pl-1.5">
                    <span
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full text-sm tabular-nums",
                        day.isToday ? "bg-sk-blue font-bold text-white" : day.inMonth ? "font-semibold text-sk-ink" : "font-semibold text-sk-faint",
                      )}
                    >
                      {day.dayNumber}
                    </span>
                  </span>

                  {day.spans.length > 0 ? (
                    <span className="mt-1 flex flex-col gap-0.5" aria-hidden>
                      {day.spans.map((span, index) =>
                        span ? (
                          <span
                            key={span.key}
                            className={cn(
                              "block h-1 overflow-hidden whitespace-nowrap bg-sk-blue-tint text-xs font-semibold leading-5 text-sk-blue-ink max-lg:bg-sk-blue lg:h-5 lg:px-1.5",
                              span.isStart && "ml-1 rounded-l-full lg:ml-1.5 lg:rounded-l-md",
                              span.isEnd && "mr-1 rounded-r-full lg:mr-1.5 lg:rounded-r-md",
                              !day.inMonth && "opacity-50",
                            )}
                          >
                            <span className="hidden lg:inline">{span.showTitle ? span.title : " "}</span>
                          </span>
                        ) : (
                          <span key={`empty-${index}`} className="block h-1 lg:h-5" />
                        ),
                      )}
                    </span>
                  ) : null}

                  {day.dots.length > 0 ? (
                    <span className="mt-1.5 flex justify-center gap-1 lg:hidden" aria-hidden>
                      {day.dots.map((tone) => (
                        <span key={tone} className={cn("sk-dot size-1.5", DOT[tone], !day.inMonth && "opacity-50")} />
                      ))}
                    </span>
                  ) : null}

                  <span className={cn("mt-1 hidden flex-col gap-0.5 px-1.5 lg:flex", !day.inMonth && "opacity-60")} aria-hidden>
                    {day.lines.slice(0, MAX_LINES).map((line) => (
                      <span key={line.key} className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] leading-5 text-sk-ink-2">
                        <span className={cn("sk-dot size-1.5", DOT[line.tone])} />
                        <span className="truncate">{line.title}</span>
                      </span>
                    ))}
                    {more > 0 ? <span className="pl-3 text-xs font-semibold text-sk-mute">{more} more</span> : null}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
