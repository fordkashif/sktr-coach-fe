import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Ring } from "./motion"
import { Avatar } from "./status"
import { CaretRight } from "@phosphor-icons/react"

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

/**
 * ReadinessBar: how a group checked in, as one bar in parts (ready, watch, review, no check-in),
 * with the words under it. The parts grow in from the left.
 */
export function ReadinessBar({ ready, watch, review, none = 0, className }: { ready: number; watch: number; review: number; none?: number; className?: string }) {
  const total = ready + watch + review + none
  if (total === 0) return null
  const parts = [
    { key: "ready", count: ready, className: "bg-sk-green", word: "ready" },
    { key: "watch", count: watch, className: "bg-sk-amber", word: "watch" },
    { key: "review", count: review, className: "bg-sk-coral", word: "review" },
    { key: "none", count: none, className: "bg-sk-soft-2", word: "no check-in" },
  ].filter((part) => part.count > 0)
  const words = parts.map((part) => `${part.count} ${part.word}`).join(", ")
  return (
    <span className={cn("block", className)}>
      <span role="img" aria-label={`Readiness: ${words}`} className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
        {parts.map((part, index) => (
          <span key={part.key} className={cn("sk-anim-grow block h-full first:rounded-l-full last:rounded-r-full", part.className)} style={{ flexGrow: part.count, animationDelay: `${index * 90}ms` }} />
        ))}
      </span>
      <span className="mt-1.5 block text-[0.8125rem] text-sk-mute" aria-hidden>
        {words}
      </span>
    </span>
  )
}

/**
 * TeamTile: one team as a tile. Lead coach (or a coral "No lead coach"), how many athletes in a
 * scoreboard number, how they checked in, and plan adherence in a ring.
 */
export function TeamTile({
  to,
  name,
  detail,
  lead,
  athletes,
  adherence,
  readiness,
  flag,
}: {
  to: string
  name: string
  detail?: ReactNode
  lead: ReactNode
  athletes: number
  adherence: number | null
  readiness?: ReactNode
  flag?: boolean
}) {
  return (
    <li className="sk-tile-item">
      <Link to={to} className={cn("sk-tile flex h-full flex-col gap-3 p-4", flag && "sk-tile-flag")} data-team-tile={name}>
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate font-display text-[1.5rem] font-black uppercase leading-none text-sk-ink">{name}</span>
            {detail ? <span className="mt-1 block truncate text-sm text-sk-mute">{detail}</span> : null}
          </span>
          <Ring progress={adherence === null ? 0 : adherence / 100} size={58} thickness={6}>
            <span className="font-display text-[1rem] font-black leading-none text-sk-ink">{adherence === null ? "-" : `${adherence}%`}</span>
          </Ring>
        </span>
        <span className="flex items-end justify-between gap-3">
          <span className="min-w-0 text-sm">{lead}</span>
          <span className="shrink-0 text-right">
            <span className="block font-display text-[2rem] font-black leading-none tabular-nums text-sk-ink">{athletes}</span>
            <span className="block text-[0.6875rem] font-bold uppercase tracking-[0.02em] text-sk-mute">{athletes === 1 ? "athlete" : "athletes"}</span>
          </span>
        </span>
        {readiness}
      </Link>
    </li>
  )
}

/**
 * UsageMeter: how much of an allowance is used (4 of 5 teams) as a ring with the numbers beside it.
 * Near the limit the ring turns amber; at it, coral.
 */
export function UsageMeter({ label, used, limit, hint }: { label: string; used: number; limit: number | null; hint?: ReactNode }) {
  const share = limit ? Math.min(1, used / limit) : 0
  const tone = limit && used >= limit ? "text-sk-coral-ink" : limit && used / limit >= 0.8 ? "text-sk-amber-ink" : "text-sk-mute"
  return (
    <li className="sk-tile-item">
      <span className="sk-tile flex items-center gap-4 p-4" data-usage={label}>
        <Ring progress={share} size={64} thickness={7} />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-sk-mute">{label}</span>
          <span className="block font-display text-[2rem] font-black leading-none tabular-nums text-sk-ink">
            {used}
            <span className="ml-1 text-[1rem] text-sk-mute">{limit ? `of ${limit}` : "no limit"}</span>
          </span>
          {hint ? <span className={cn("mt-0.5 block text-[0.8125rem]", tone)}>{hint}</span> : null}
        </span>
      </span>
    </li>
  )
}

/**
 * FaceStack: the first few people of a group as overlapping avatars, then "+3". Each face pops in
 * a beat after the last.
 */
export function FaceStack({ names, max = 5, label }: { names: string[]; max?: number; label: string }) {
  if (names.length === 0) return null
  const shown = names.slice(0, max)
  const rest = names.length - shown.length
  return (
    <span role="img" aria-label={label} className="flex items-center">
      {shown.map((name, index) => (
        <span key={`${name}-${index}`} className="sk-face -ml-1 inline-flex first:ml-0" style={{ animationDelay: `${index * 60}ms` }}>
          <Avatar name={name} size="sm" className="ring-[3px] ring-sk-sw-grey" />
        </span>
      ))}
      {rest > 0 ? (
        <span className="sk-face -ml-1 grid size-8 place-items-center rounded-full bg-sk-ink text-[0.75rem] font-bold text-white ring-[3px] ring-sk-sw-grey" style={{ animationDelay: `${shown.length * 60}ms` }}>
          +{rest}
        </span>
      ) : null}
    </span>
  )
}

const MARK_TONE: Record<string, string> = { green: "bg-sk-green", amber: "bg-sk-amber", coral: "bg-sk-coral", blue: "bg-sk-accent", neutral: "bg-sk-faint" }

/**
 * AttendanceTile: how often someone turned up, as a ring with the share, and every marked day as
 * a small block (oldest on the left) in the colour of what the coach marked. The blocks pop in.
 */
export function AttendanceTile({ attended, marks }: { attended: number; marks: Array<{ key: string; tone: string; label: string }> }) {
  const total = marks.length
  const share = total > 0 ? attended / total : 0
  return (
    <div className="sk-tile flex items-center gap-4 p-4" data-attendance-tile>
      <Ring progress={share} size={76} thickness={8}>
        <span className="font-display text-[1.25rem] font-black leading-none text-sk-ink">{Math.round(share * 100)}%</span>
      </Ring>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[1.75rem] font-black leading-none tabular-nums text-sk-ink">
          {attended}
          <span className="ml-1 text-[1rem] text-sk-mute">of {total}</span>
        </p>
        <p className="text-sm text-sk-mute">sessions attended</p>
        <ol aria-label="Each session, oldest first" className="mt-2.5 flex flex-wrap gap-1">
          {marks.map((mark, index) => (
            <li key={mark.key} title={mark.label} aria-label={mark.label} className={cn("sk-face block h-4 w-3 rounded-[4px]", MARK_TONE[mark.tone] ?? MARK_TONE.neutral)} style={{ animationDelay: `${index * 35}ms` }} />
          ))}
        </ol>
      </div>
    </div>
  )
}

/**
 * Pipeline: stages one after another (a club asks, is approved, sets up billing, goes live) as
 * numbered tiles joined by arrows. Each shows how many are at that stage, with a bar for its share
 * of the busiest stage. `flag` outlines a stage that needs someone in amber.
 */
export function Pipeline({
  label,
  stages,
}: {
  label: string
  stages: Array<{ key: string; label: string; count: number | string; hint?: ReactNode; to?: string; flag?: boolean; accent?: boolean }>
}) {
  const counts = stages.map((stage) => (typeof stage.count === "number" ? stage.count : 0))
  const peak = Math.max(1, ...counts)
  return (
    <ol aria-label={label} className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3" data-pipeline>
      {stages.map((stage, index) => {
        const share = typeof stage.count === "number" ? stage.count / peak : 0
        const body = (
          <>
            <span className="flex items-center gap-2">
              <span className={cn("grid size-7 place-items-center rounded-full text-[0.8125rem] font-extrabold", stage.accent ? "bg-white/20" : "bg-white text-sk-ink")}>{index + 1}</span>
              <span className={cn("text-sm font-bold", stage.accent ? "" : "text-sk-mute")}>{stage.label}</span>
            </span>
            <span className="mt-3 block font-display text-[3rem] font-black leading-[0.85] tabular-nums">{stage.count}</span>
            {stage.hint ? <span className={cn("mt-1 block text-[0.8125rem] leading-snug", stage.accent ? "opacity-85" : "text-sk-mute")}>{stage.hint}</span> : null}
            <span className={cn("mt-auto block h-1.5 w-full overflow-hidden rounded-full pt-0", stage.accent ? "bg-white/25" : "bg-white")}>
              <span className={cn("sk-anim-grow block h-full rounded-full", stage.accent ? "bg-white" : stage.flag ? "bg-sk-amber" : "bg-sk-ink")} style={{ width: `${Math.round(share * 100)}%`, animationDelay: `${index * 120}ms` }} />
            </span>
          </>
        )
        const className = cn("sk-tile relative flex h-full min-h-[168px] flex-col gap-0 p-4", stage.accent && "sk-tile-accent", stage.flag && !stage.accent && "sk-tile-flag")
        return (
          <li key={stage.key} className="sk-tile-item relative" style={{ animationDelay: `${index * 80}ms` }}>
            {stage.to ? (
              <Link to={stage.to} className={className}>
                {body}
              </Link>
            ) : (
              <span className={className}>{body}</span>
            )}
            {index < stages.length - 1 ? (
              <span aria-hidden className="sk-pipeline-arrow absolute -right-[13px] top-1/2 z-10 hidden size-6 -translate-y-1/2 place-items-center rounded-full bg-white text-sk-ink shadow-[0_2px_8px_rgb(14_17_22/0.18)] lg:grid">
                <CaretRight className="size-3.5" weight="bold" />
              </span>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
