import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * SKTR Coach shared building blocks. See DESIGN.md.
 * Flat, light, Outfit. Use these instead of ad hoc card markup.
 */

export function PageHeader({
  title,
  lede,
  actions,
  children,
  className,
}: {
  title: ReactNode
  lede?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <header className={cn("flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="min-w-0 space-y-3">
        <h1 className="sk-title">{title}</h1>
        {lede ? <p className="sk-lede">{lede}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export type Tone = "blue" | "ink" | "yellow" | "green" | "coral" | "plain"

export function Stat({
  label,
  value,
  unit,
  hint,
  tone = "plain",
  className,
}: {
  label: string
  value: ReactNode
  unit?: string
  hint?: ReactNode
  tone?: Tone
  className?: string
}) {
  const onDark = tone === "blue" || tone === "ink"
  return (
    <div className={cn("sk-stat", `sk-stat-${tone}`, className)}>
      <p className={cn("text-sm font-semibold", onDark ? "text-white/80" : "text-sk-ink-2")}>{label}</p>
      <div>
        <p className={cn("sk-num text-[2.75rem] sm:text-[3.25rem]", onDark && "text-white")}>
          {value}
          {unit ? <span className="ml-0.5 text-[0.45em] font-bold tracking-normal">{unit}</span> : null}
        </p>
        {hint ? <p className={cn("mt-1.5 text-sm", onDark ? "text-white/75" : "text-sk-mute")}>{hint}</p> : null}
      </div>
    </div>
  )
}

export function Panel({
  title,
  hint,
  action,
  children,
  className,
  flush = false,
}: {
  title?: ReactNode
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  flush?: boolean
}) {
  return (
    <section className={cn("sk-card", flush && "p-0 sm:p-0", className)}>
      {title || action ? (
        <div className={cn("mb-4 flex items-start justify-between gap-3", flush && "mb-0 px-5 pt-5 sm:px-6 sm:pt-6")}>
          <div className="min-w-0">
            {title ? <h2 className="sk-h2">{title}</h2> : null}
            {hint ? <p className="mt-1 text-sm text-sk-mute">{hint}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export type TagTone = "green" | "yellow" | "coral" | "blue" | "plain"

export function Tag({ tone = "plain", children, className }: { tone?: TagTone; children: ReactNode; className?: string }) {
  return <span className={cn("sk-tag", `sk-tag-${tone}`, className)}>{children}</span>
}

/** Readiness uses the app-wide mapping: green = ready, yellow = watch, red = review. */
export function ReadinessTag({ status }: { status: "green" | "yellow" | "red" }) {
  const tone: TagTone = status === "green" ? "green" : status === "yellow" ? "yellow" : "coral"
  const label = status === "green" ? "Ready" : status === "yellow" ? "Watch" : "Review"
  return (
    <Tag tone={tone}>
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "green" && "bg-sk-green",
          status === "yellow" && "bg-[#c48a00]",
          status === "red" && "bg-sk-coral",
        )}
      />
      {label}
    </Tag>
  )
}

const AVATAR_TONES = ["bg-sk-blue text-white", "bg-sk-yellow text-sk-ink", "bg-sk-ink text-white", "bg-sk-coral text-white", "bg-sk-green text-white"]

export function Initials({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
  const tone = AVATAR_TONES[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_TONES.length]
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        size === "sm" && "size-8 text-xs",
        size === "md" && "size-10 text-sm",
        size === "lg" && "size-14 text-lg",
        tone,
        className,
      )}
    >
      {initials || "?"}
    </span>
  )
}

export function Meter({ value, tone = "blue", className }: { value: number; tone?: "blue" | "green" | "yellow" | "coral"; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  const fill = tone === "green" ? "bg-sk-green" : tone === "yellow" ? "bg-sk-yellow" : tone === "coral" ? "bg-sk-coral" : "bg-sk-blue"
  return (
    <div className={cn("sk-meter", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span className={fill} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Tone for a 0 to 100 score where higher is better. */
export function scoreTone(value: number): "green" | "yellow" | "coral" {
  if (value >= 80) return "green"
  if (value >= 65) return "yellow"
  return "coral"
}

export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string
  body?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-start gap-3 rounded-[20px] border border-dashed border-[#cdd2de] bg-white p-6", className)}>
      {icon ? <span className="flex size-11 items-center justify-center rounded-2xl bg-sk-yellow text-sk-ink">{icon}</span> : null}
      <div className="space-y-1">
        <p className="sk-h3">{title}</p>
        {body ? <p className="max-w-[52ch] text-sm leading-relaxed text-sk-mute">{body}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  label,
}: {
  value: T
  onChange: (next: T) => void
  options: Array<{ value: T; label: ReactNode }>
  className?: string
  label?: string
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("sk-seg", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          data-active={option.value === value}
          className="sk-seg-item"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
