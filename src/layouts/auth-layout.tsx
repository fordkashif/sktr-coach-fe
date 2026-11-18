import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react"
import { Timer } from "@phosphor-icons/react"
import { Link, Outlet } from "react-router-dom"
import { Screen } from "@/components/sk"
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support"
import { cn } from "@/lib/utils"

export function AuthLayout() {
  return (
    <div className="min-h-dvh bg-white">
      <Outlet />
    </div>
  )
}

/** The product name with its mark. Links to sign in. */
export function AuthBrand({ className }: { className?: string }) {
  return (
    <Link
      to="/login"
      className={cn(
        "inline-flex min-h-11 items-center gap-2.5 self-start rounded-lg font-display text-[1.5rem] font-black uppercase leading-none text-sk-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sk-blue",
        className,
      )}
    >
      <img src="/favicon.svg" alt="" width={32} height={32} className="size-8" />
      SKTR Coach
    </Link>
  )
}

/** The links under every public page: the two legal pages, support, and who makes the app. */
export function PublicFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-sk-line pt-4 text-sm text-sk-mute", className)}>
      <Link to="/privacy" className="sk-link inline-flex min-h-11 items-center">
        Privacy
      </Link>
      <Link to="/terms" className="sk-link inline-flex min-h-11 items-center">
        Terms
      </Link>
      <a href={SUPPORT_MAILTO} className="sk-link inline-flex min-h-11 items-center">
        {SUPPORT_EMAIL}
      </a>
      <span>Made by SKTR Labs in Kingston, Jamaica</span>
    </footer>
  )
}

/* ---- The track drawing ---------------------------------------------------------------------- */

// The bend of a running track seen from above, drawn around the bottom right corner of the panel.
const TRACK = { cx: 660, cy: 660, inner: 210, lane: 74, lanes: 6 }
const LANE_STARTS = [-103, -111, -118, -124, -129, -133]
/** Where each runner ends up, in degrees round the bend, and how late they leave the line. */
const RUNNERS = [
  { lane: 0, to: -150, fill: "#ffc93c", delay: 0 },
  { lane: 2, to: -158, fill: "#ffffff", delay: 80 },
  { lane: 3, to: -147, fill: "#ffc93c", delay: 40 },
  { lane: 5, to: -161, fill: "#ffffff", delay: 120 },
]

function polar(radius: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180
  return { x: TRACK.cx + radius * Math.cos(radians), y: TRACK.cy + radius * Math.sin(radians) }
}

/**
 * TrackArt: the picture on the public pages. Six lanes, a staggered start with lane numbers, and four
 * runners who leave their marks once when the page opens (they stand still for anyone who asked their
 * device for less motion). It is drawn here, so it can never fail to load.
 */
export function TrackArt({ className }: { className?: string }) {
  const outer = TRACK.inner + TRACK.lane * TRACK.lanes
  const midBand = (TRACK.inner + outer) / 2
  return (
    <svg viewBox="0 0 660 660" preserveAspectRatio="xMaxYMax meet" className={className} aria-hidden focusable="false">
      <style>{`
        .sk-track-runner { transform-box: view-box; transform-origin: ${TRACK.cx}px ${TRACK.cy}px; transform: rotate(var(--to)); }
        @media (prefers-reduced-motion: no-preference) {
          .sk-track-runner { animation: sk-track-run 1400ms cubic-bezier(0.2, 0.7, 0.2, 1) both; animation-delay: var(--delay); }
        }
        @keyframes sk-track-run { from { transform: rotate(var(--from)); } to { transform: rotate(var(--to)); } }
      `}</style>
      {/* The track surface: one wide band. */}
      <circle cx={TRACK.cx} cy={TRACK.cy} r={midBand} fill="none" stroke="#ff5c39" strokeWidth={outer - TRACK.inner} />
      {/* Lane lines. */}
      {Array.from({ length: TRACK.lanes + 1 }, (_, index) => (
        <circle key={index} cx={TRACK.cx} cy={TRACK.cy} r={TRACK.inner + TRACK.lane * index} fill="none" stroke="#ffffff" strokeWidth={index === 0 || index === TRACK.lanes ? 7 : 4} />
      ))}
      {/* The infield. */}
      <circle cx={TRACK.cx} cy={TRACK.cy} r={TRACK.inner - 3.5} fill="#0c9d61" />
      {/* Staggered start lines and lane numbers. */}
      {LANE_STARTS.map((angle, lane) => {
        const from = polar(TRACK.inner + TRACK.lane * lane, angle)
        const to = polar(TRACK.inner + TRACK.lane * (lane + 1), angle)
        const radius = TRACK.inner + TRACK.lane * (lane + 0.5)
        // The number sits just behind the line, turned to face the runner.
        const numberAngle = angle + (26 * 180) / (Math.PI * radius)
        const at = polar(radius, numberAngle)
        return (
          <g key={lane}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#ffffff" strokeWidth={7} />
            <text
              x={at.x}
              y={at.y}
              transform={`rotate(${numberAngle + 90} ${at.x} ${at.y})`}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#ffffff"
              fontSize={40}
              fontWeight={800}
            >
              {lane + 1}
            </text>
          </g>
        )
      })}
      {/* Runners. Each is drawn at three o'clock and turned round the bend to its place. */}
      {RUNNERS.map((runner) => (
        <circle
          key={runner.lane}
          className="sk-track-runner"
          cx={TRACK.cx + TRACK.inner + TRACK.lane * (runner.lane + 0.5)}
          cy={TRACK.cy}
          r={17}
          fill={runner.fill}
          style={{ "--from": `${LANE_STARTS[runner.lane]}deg`, "--to": `${runner.to}deg`, "--delay": `${runner.delay}ms` } as CSSProperties}
        />
      ))}
    </svg>
  )
}

/** The photo on the public pages (public/images/athlete, from Unsplash): starting blocks. */
const PANEL_PHOTO = "/images/athlete/blocks-tall.webp"

/**
 * FinishClock: a race clock that runs up to a time and stops on it, then a "New best" stamp lands.
 * It runs once when the page opens; with less motion asked for, it shows the time at once.
 */
function FinishClock({ to = 10.28 }: { to?: number }) {
  const [shown, setShown] = useState(0)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(to)
      setDone(true)
      return
    }
    let frame = 0
    const started = performance.now()
    const run = (now: number) => {
      const share = Math.min(1, (now - started) / 1600)
      setShown(to * (1 - Math.pow(1 - share, 3)))
      if (share < 1) frame = requestAnimationFrame(run)
      else setDone(true)
    }
    const wait = window.setTimeout(() => (frame = requestAnimationFrame(run)), 350)
    return () => {
      window.clearTimeout(wait)
      cancelAnimationFrame(frame)
    }
  }, [to])
  return (
    <div className="sk-finish-clock inline-flex items-center gap-3 rounded-[22px] bg-white px-4 py-3 text-sk-ink shadow-[0_18px_40px_-20px_rgb(14_17_22/0.6)]" aria-hidden>
      <span className="grid size-10 place-items-center rounded-full bg-sk-accent text-sk-on-accent">
        <Timer className="size-5" weight="bold" />
      </span>
      <span>
        <span className="block text-[0.6875rem] font-extrabold uppercase tracking-[0.04em] text-sk-mute">Lane 4, 100m</span>
        <span className="block font-display text-[2.25rem] font-black leading-none tabular-nums">{shown.toFixed(2)}</span>
      </span>
      <span className={cn("rounded-full bg-sk-accent px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.04em] text-sk-on-accent transition-all duration-300", done ? "scale-100 opacity-100" : "scale-50 opacity-0")}>New best</span>
    </div>
  )
}

/** The panel of the public pages: a photo, a race clock on it, and one plain line about the product on an accent card. */
function BrandPanel({ headline, body, compact = false }: { headline: string[]; body?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn("sk-brand-panel relative isolate flex flex-col justify-between overflow-hidden bg-sk-sw-grey", compact ? "min-h-[420px] rounded-[26px] p-4" : "h-full rounded-[30px] p-6 xl:p-8")}>
      <img src={PANEL_PHOTO} alt="" aria-hidden className="sk-hero-photo absolute inset-0 -z-10 size-full object-cover" decoding="async" />
      <div className="flex justify-end">
        <FinishClock />
      </div>
      <div className={cn("sk-brand-card rounded-[24px] bg-sk-accent text-sk-on-accent", compact ? "p-5" : "p-7 xl:p-9")}>
        <p className={cn("font-display font-black uppercase", compact ? "text-[2.5rem] leading-[0.9]" : "text-[3.5rem] leading-[0.88] xl:text-[4.5rem]")}>
          {headline.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>
        {body && !compact ? <p className="mt-4 max-w-[38ch] text-[1.0625rem] leading-relaxed opacity-90">{body}</p> : null}
      </div>
    </div>
  )
}

/** Puts the skin on the page and on <html> (dialogs open outside it) while a public page is open. */
function useStopwatchSkin() {
  useLayoutEffect(() => {
    const root = document.documentElement
    const had = root.dataset.skin
    root.dataset.skin = "stopwatch"
    return () => {
      if (had) root.dataset.skin = had
      else delete root.dataset.skin
    }
  }, [])
}

/**
 * AuthSplit: the front door frame. The form on white, and beside it (under it on a phone, so the
 * form comes first) the blue panel with one plain line about the product. `children` are kit parts:
 * a ScreenHeader, then Sections.
 */
export function AuthSplit({
  headline,
  body,
  wide = false,
  children,
}: {
  /** One short line each. */
  headline: string[]
  body?: ReactNode
  /** A longer form: a wider column that starts at the top instead of sitting in the middle. */
  wide?: boolean
  children: ReactNode
}) {
  useStopwatchSkin()
  return (
    <div data-skin="stopwatch" className="min-h-dvh bg-white lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      <main className={cn("mx-auto flex w-full min-w-0 flex-col pt-3 lg:pt-0", wide ? "max-w-[720px]" : "max-w-[560px]")}>
        <Screen width="narrow" className={cn("flex-1", !wide && "lg:justify-center")}>
          <AuthBrand />
          {children}
          <div className="lg:hidden">
            <BrandPanel headline={headline} body={body} compact />
          </div>
          <PublicFooter />
        </Screen>
      </main>
      <aside className="hidden p-4 lg:block" aria-label="About SKTR Coach">
        <div className="sticky top-4 h-[calc(100dvh-2rem)] min-h-[600px]">
          <BrandPanel headline={headline} body={body} />
        </div>
      </aside>
    </div>
  )
}

/**
 * PublicFrame: a public page that is not a form (not found, access paused, privacy, terms). No app
 * chrome: the brand, the page's kit parts, the footer. The same shape as the invite pages.
 */
export function PublicFrame({ children, width = "narrow" }: { children: ReactNode; width?: "narrow" | "reading" }) {
  useStopwatchSkin()
  return (
    <div data-skin="stopwatch" className="min-h-dvh bg-white">
      <main className={cn("mx-auto w-full py-3 sm:py-8", width === "reading" ? "max-w-[720px]" : "max-w-[560px]")}>
        <Screen width="narrow">
          <AuthBrand />
          {children}
          <PublicFooter />
        </Screen>
      </main>
    </div>
  )
}
