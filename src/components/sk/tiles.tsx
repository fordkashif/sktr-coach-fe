import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Ring } from "./motion"

/*
 * Tiles of the "Stopwatch" skin for the coach side (DESIGN.md, Coach screens). Grey tiles on white,
 * one accent, scoreboard numbers, and motion: tiles pop in one after another, lift on hover and
 * give when pressed. They read the same without the skin, only plainer.
 */

/**
 * ProgressAvatar: a person's avatar inside a ring that shows a share (plan adherence). With no
 * share (nothing was due) the ring is an empty track.
 */
export function ProgressAvatar({ value, children, size = 56, label }: { value: number | null; children: ReactNode; size?: number; label?: string }) {
  return (
    <span className="relative inline-grid shrink-0" aria-label={label} role={label ? "img" : undefined}>
      <Ring progress={value === null ? 0 : value / 100} size={size} thickness={5}>
        {children}
      </Ring>
    </span>
  )
}

/**
 * TileGrid: a responsive grid of tiles, two across on a phone and up to four on a wide screen.
 * It is a list, so a screen reader hears how many there are.
 */
export function TileGrid({ children, label, className, wide }: { children: ReactNode; label: string; className?: string; wide?: boolean }) {
  return (
    <ul aria-label={label} className={cn("sk-tile-grid grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:gap-3", wide ? "xl:grid-cols-3 2xl:grid-cols-4" : "xl:grid-cols-3", className)}>
      {children}
    </ul>
  )
}

/**
 * PersonTile: one athlete as a tile. The avatar sits in its adherence ring; the big number on the
 * right is the adherence; `status` is the readiness line; `flag` marks someone who needs a look.
 */
export function PersonTile({
  to,
  name,
  detail,
  avatar,
  adherence,
  status,
  meta,
  flag,
}: {
  to: string
  name: string
  detail?: ReactNode
  avatar: ReactNode
  adherence: number | null
  status?: ReactNode
  meta?: ReactNode
  flag?: boolean
}) {
  return (
    <li className="sk-tile-item">
      <Link to={to} className={cn("sk-tile group flex items-center gap-3.5 p-3.5", flag && "sk-tile-flag")} data-person-tile={name}>
        <ProgressAvatar value={adherence}>{avatar}</ProgressAvatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-bold leading-tight text-sk-ink">{name}</span>
          {detail ? <span className="block truncate text-sm text-sk-mute">{detail}</span> : null}
          {status || meta ? (
            <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-sm">
              {status}
              {meta ? <span className="text-sk-mute">{meta}</span> : null}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-display text-[2rem] font-black leading-none tabular-nums text-sk-ink">{adherence === null ? "-" : adherence}</span>
          <span className="block text-[0.6875rem] font-bold uppercase tracking-[0.02em] text-sk-mute">{adherence === null ? "No sessions" : "% done"}</span>
        </span>
      </Link>
    </li>
  )
}

/**
 * WeekRail: the days of a week as tiles in a row, today in the accent. Scrolls sideways inside
 * itself on a phone (never the page). Each day can link somewhere.
 */
export function WeekRail({
  days,
  label,
  className,
}: {
  days: Array<{ key: string; day: string; title: ReactNode; detail?: ReactNode; today?: boolean; rest?: boolean; to?: string }>
  label: string
  className?: string
}) {
  return (
    <ol aria-label={label} className={cn("sk-week-rail -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      {days.map((day) => {
        const body = (
          <>
            <span className={cn("block text-[0.75rem] font-extrabold uppercase tracking-[0.03em]", day.today ? "text-sk-on-accent" : "text-sk-mute")}>
              {day.day}
              {day.today ? ", today" : ""}
            </span>
            <span className={cn("mt-1.5 line-clamp-2 block font-display text-[1.375rem] font-black uppercase leading-[0.95]", day.today ? "text-sk-on-accent" : day.rest ? "text-sk-faint" : "text-sk-ink")}>{day.title}</span>
            {day.detail ? <span className={cn("mt-1.5 line-clamp-2 block text-[0.8125rem] leading-snug", day.today ? "text-sk-on-accent/85" : "text-sk-mute")}>{day.detail}</span> : null}
          </>
        )
        const className = cn("sk-tile block h-full min-h-[132px] w-[168px] shrink-0 snap-start p-3.5", day.today && "sk-tile-accent")
        return (
          <li key={day.key} aria-current={day.today ? "date" : undefined} className="sk-tile-item shrink-0">
            {day.to ? (
              <Link to={day.to} className={className}>
                {body}
              </Link>
            ) : (
              <span className={className}>{body}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Countdown: days until something, as one scoreboard number with its words. */
export function Countdown({ days, what, className }: { days: number; what?: ReactNode; className?: string }) {
  const text = days <= 0 ? "On now" : days === 1 ? "Tomorrow" : null
  return (
    <span className={cn("inline-flex flex-col", className)}>
      {text ? (
        <span className="font-display text-[2.5rem] font-black uppercase leading-[0.9] text-sk-ink">{text}</span>
      ) : (
        <span className="font-display text-[2.75rem] font-black leading-[0.9] tabular-nums text-sk-ink">
          {days}
          <span className="ml-1 text-[1.25rem] uppercase">days</span>
        </span>
      )}
      {what ? <span className="mt-1 text-sm text-sk-mute">{what}</span> : null}
    </span>
  )
}

/**
 * WeekSegments: the weeks of a block as a row of short bars. Weeks gone by are ink, the current
 * week is the accent, weeks to come are grey. `current` is 1 based; null when the block is not on.
 */
export function WeekSegments({ total, current, className }: { total: number; current: number | null; className?: string }) {
  const weeks = Array.from({ length: Math.max(1, Math.min(total, 52)) }, (_, index) => index + 1)
  const label = current === null ? `${total} ${total === 1 ? "week" : "weeks"}` : `Week ${current} of ${total}`
  return (
    <span role="img" aria-label={label} className={cn("flex items-center gap-2", className)}>
      <span className="flex gap-1" aria-hidden>
        {weeks.map((week) => (
          <span
            key={week}
            className={cn(
              "sk-anim-grow block h-2 w-5 rounded-full",
              current !== null && week < current ? "bg-sk-ink" : current === week ? "bg-sk-blue" : "bg-sk-soft-2",
            )}
            style={{ animationDelay: `${week * 50}ms` }}
          />
        ))}
      </span>
      {current !== null ? <span className="text-[0.8125rem] font-bold text-sk-ink">{label}</span> : null}
    </span>
  )
}
