import { CheckCircle, Info, Warning, WarningCircle } from "@phosphor-icons/react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** Colour means state and nothing else: green ready or done, amber watch, coral needs attention, blue action. */
export type StateTone = "green" | "amber" | "coral" | "blue" | "neutral"
/** Legacy names still accepted by Tag. */
export type TagTone = "green" | "yellow" | "coral" | "blue" | "plain"
/** @deprecated Stat tiles no longer take a colour. */
export type Tone = "blue" | "ink" | "yellow" | "green" | "coral" | "plain"

export function StatusDot({ tone = "neutral", size = "md", className }: { tone?: StateTone | "yellow"; size?: "sm" | "md"; className?: string }) {
  return <span aria-hidden className={cn("sk-dot", size === "sm" && "sk-dot-sm", tone !== "neutral" && `sk-dot-${tone}`, className)} />
}

/** State as a small dot plus text. This is how state is shown everywhere outside a table status column. */
export function StatusText({ tone = "neutral", children, className }: { tone?: StateTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("sk-status", `sk-status-${tone}`, className)}>
      <StatusDot tone={tone} size="sm" />
      {children}
    </span>
  )
}

/** Readiness uses the app-wide mapping: green = ready, yellow = watch, red = review. */
export function ReadinessText({ status, detail }: { status: "green" | "yellow" | "red"; detail?: string }) {
  const tone: StateTone = status === "green" ? "green" : status === "yellow" ? "amber" : "coral"
  const label = status === "green" ? "Ready" : status === "yellow" ? "Watch" : "Review"
  return <StatusText tone={tone}>{detail ? `${label}, ${detail}` : label}</StatusText>
}

/** @deprecated Use ReadinessText. Kept so older screens compile; it now renders the dot and text, not a pill. */
export function ReadinessTag({ status }: { status: "green" | "yellow" | "red" }) {
  return <ReadinessText status={status} />
}

/** Tag: a small status tag for a status column inside a DataTable. Nowhere else; use StatusText instead. */
export function Tag({ tone = "plain", children, className }: { tone?: TagTone; children: ReactNode; className?: string }) {
  return <span className={cn("sk-tag", `sk-tag-${tone}`, className)}>{children}</span>
}

const AVATAR_TONES = ["bg-sk-blue text-white", "bg-sk-yellow text-sk-ink", "bg-sk-ink text-white", "bg-sk-coral text-white", "bg-sk-green text-white"]
const AVATAR_SIZES = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-11 text-[0.9375rem]", xl: "size-16 text-xl" } as const

/** Avatar: the photo when there is one, otherwise initials on a solid colour picked from the name. */
export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string
  src?: string | null
  size?: keyof typeof AVATAR_SIZES
  className?: string
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
  const tone = AVATAR_TONES[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_TONES.length]
  if (src) {
    return <img src={src} alt="" className={cn("shrink-0 rounded-full object-cover", AVATAR_SIZES[size], className)} />
  }
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold", AVATAR_SIZES[size], tone, className)}>
      {initials || "?"}
    </span>
  )
}

/** @deprecated Use Avatar. */
export function Initials({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  return <Avatar name={name} size={size === "lg" ? "xl" : size} className={className} />
}

export function Meter({ value, tone = "blue", className, label }: { value: number; tone?: "blue" | "green" | "yellow" | "coral"; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  const fill = tone === "green" ? "bg-sk-green" : tone === "yellow" ? "bg-sk-amber" : tone === "coral" ? "bg-sk-coral" : "bg-sk-blue"
  return (
    <div className={cn("sk-meter", className)} role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
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

/**
 * Notice: an inline message about the screen (could not load, saved, heads up). One line of text,
 * optionally one action. It is small and tinted; it is not a section and never wraps other content.
 */
export function Notice({
  tone = "info",
  children,
  action,
  className,
}: {
  tone?: "info" | "success" | "warning" | "error"
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  const NoticeIcon = tone === "error" ? WarningCircle : tone === "warning" ? Warning : tone === "success" ? CheckCircle : Info
  const iconTone = tone === "error" ? "text-sk-coral-ink" : tone === "warning" ? "text-sk-amber-ink" : tone === "success" ? "text-sk-green-ink" : "text-sk-blue-ink"
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("sk-notice", tone !== "info" && `sk-notice-${tone}`, className)}>
      <NoticeIcon className={cn("mt-0.5 size-5 shrink-0", iconTone)} weight="fill" aria-hidden />
      <div className="min-w-0 flex-1 font-semibold">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
