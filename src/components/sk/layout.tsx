import { ArrowLeft } from "@phosphor-icons/react"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"

/**
 * Screen: the page frame. Every screen's root element. It owns the max width, the side padding,
 * the gap between blocks and the bottom space. Never set those by hand on a screen.
 * width "narrow" is for forms and single-column detail screens.
 */
export function Screen({
  children,
  width = "default",
  className,
}: {
  children: ReactNode
  width?: "default" | "narrow"
  className?: string
}) {
  return <div className={cn("sk-page", width === "narrow" && "sk-page-narrow", className)}>{children}</div>
}

/**
 * ScreenHeader: the first thing on every screen, exactly once.
 * variant "top" (default) is for a role's main destinations: big title.
 * variant "detail" is for anything reached from a list: a back link above a smaller title.
 * `fact` is one plain line above the title (today's date, a team name). It is information, never a category label.
 */
export function ScreenHeader({
  title,
  lede,
  fact,
  back,
  actions,
  variant,
  className,
}: {
  title: ReactNode
  lede?: ReactNode
  fact?: ReactNode
  back?: { to: string; label: string } | { onClick: () => void; label: string }
  actions?: ReactNode
  variant?: "top" | "detail"
  className?: string
}) {
  const resolved = variant ?? (back ? "detail" : "top")
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {back ? (
        "to" in back ? (
          <Link to={back.to} className="sk-link -ml-1 inline-flex min-h-11 items-center gap-1.5 self-start px-1 text-[0.9375rem]">
            <ArrowLeft className="size-4" weight="bold" aria-hidden />
            {back.label}
          </Link>
        ) : (
          <button type="button" onClick={back.onClick} className="sk-link -ml-1 inline-flex min-h-11 cursor-pointer items-center gap-1.5 self-start px-1 text-[0.9375rem]">
            <ArrowLeft className="size-4" weight="bold" aria-hidden />
            {back.label}
          </button>
        )
      ) : null}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-5">
        <div className="min-w-0">
          {fact ? <p className="mb-0.5 text-sm font-semibold text-sk-mute">{fact}</p> : null}
          <h1 className={resolved === "detail" ? "sk-title-compact" : "sk-title"}>{title}</h1>
          {lede ? <p className="sk-lede mt-2 lg:mt-2.5">{lede}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}

/**
 * Section: a heading and its content, separated from its neighbours by whitespace only.
 * No border, no background. `meta` is plain text on the right of the heading ("2 of 4 done"),
 * `action` is a link or quiet button there ("Open roster"). Use one or the other.
 */
export function Section({
  title,
  hint,
  meta,
  action,
  children,
  className,
  ...rest
}: {
  title?: ReactNode
  hint?: ReactNode
  meta?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  id?: string
  "aria-label"?: string
}) {
  return (
    <section className={cn("sk-section", className)} {...rest}>
      {title || action || meta ? (
        <div className="sk-section-head">
          <div className="min-w-0">
            {title ? <h2 className="sk-h2">{title}</h2> : null}
            {hint ? <p className="mt-1 text-sm text-sk-mute">{hint}</p> : null}
          </div>
          {meta ? <p className="sk-section-meta">{meta}</p> : null}
          {action ? <div className="shrink-0 text-[0.9375rem]">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

/**
 * Split: the only two-column layout. A wide main column and a narrower side column on desktop,
 * stacked (main first) on phone. Put Sections inside each.
 */
export function Split({ main, side, className }: { main: ReactNode; side: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-7 lg:flex-row lg:items-start lg:gap-12", className)}>
      <div className="flex min-w-0 flex-col gap-7 lg:flex-[1.9_1_0%] lg:gap-9">{main}</div>
      <div className="flex min-w-0 flex-col gap-7 lg:flex-[1_1_0%] lg:gap-9">{side}</div>
    </div>
  )
}

/**
 * HeroBlock: the single solid colour block. AT MOST ONE PER SCREEN, and most screens have none.
 * It is reserved for the one most important thing on the screen together with its primary action
 * (the athlete's session for today). Never use it for decoration, stats or notices.
 */
export function HeroBlock({
  label,
  meta,
  title,
  body,
  action,
  className,
}: {
  label: ReactNode
  meta?: ReactNode
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <section className={cn("sk-hero", className)} data-sk-hero>
      <div className="flex items-baseline justify-between gap-4">
        <p className="sk-hero-label">{label}</p>
        {meta ? <p className="sk-hero-label shrink-0">{meta}</p> : null}
      </div>
      <h2 className="sk-hero-title">{title}</h2>
      {body ? <p className="sk-hero-body">{body}</p> : null}
      {action}
    </section>
  )
}
