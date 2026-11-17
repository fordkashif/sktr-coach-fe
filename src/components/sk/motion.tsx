import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/*
 * Motion parts of the athlete skin ("Stopwatch", see DESIGN.md). They work on any screen but are
 * drawn in lime and ink. Every animation is CSS that turns itself off for people who ask the
 * phone for reduced motion; the parts still show the same information when it does.
 */

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** A number that counts up to `value` when it first shows and whenever `value` changes. */
export function useCountUp(value: number, durationMs = 900) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0))
  const fromRef = useRef(shown)
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value)
      return
    }
    const from = fromRef.current
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      const next = Math.round(from + (value - from) * eased)
      fromRef.current = next
      setShown(next)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, durationMs])
  return shown
}

/**
 * Ring: a progress ring, ink with a lime line inside it. `progress` is 0 to 1. The centre takes
 * anything (the countdown, a score). Decorative: put the meaning in the children or an aria-label
 * on the element around it.
 */
export function Ring({
  progress,
  size = 96,
  thickness,
  children,
  className,
  pulse,
}: {
  progress: number
  size?: number
  thickness?: number
  children?: ReactNode
  className?: string
  /** Breathes with a lime glow (the last seconds of a rest). */
  pulse?: boolean
}) {
  const stroke = thickness ?? Math.max(8, Math.round(size / 9))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(1, progress))
  const dash = `${(circumference * clamped).toFixed(2)} ${circumference.toFixed(2)}`
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center rounded-full", pulse && "sk-anim-breathe", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--sk-sw-grey)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--sk-sw-ink)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={dash} className="transition-[stroke-dasharray] duration-300 ease-linear" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--sk-lime)" strokeWidth={Math.max(3, Math.round(stroke * 0.5))} strokeLinecap="round" strokeDasharray={dash} className="transition-[stroke-dasharray] duration-300 ease-linear" />
      </svg>
      <span className="relative flex flex-col items-center justify-center text-center">{children}</span>
    </span>
  )
}

/**
 * ReadinessGauge: a half circle that sweeps up to the score while the number counts up.
 * `word` is the plain meaning under it ("Ready", "Watch", "Review").
 */
export function ReadinessGauge({ value, word, size = 200, className }: { value: number; word?: ReactNode; size?: number; className?: string }) {
  const shown = useCountUp(value)
  const stroke = Math.round(size / 9)
  const radius = (size - stroke) / 2
  const length = Math.PI * radius
  const height = radius + stroke
  const path = `M ${stroke / 2} ${radius + stroke / 2} A ${radius} ${radius} 0 0 1 ${size - stroke / 2} ${radius + stroke / 2}`
  const dash = `${((length * Math.max(0, Math.min(100, shown))) / 100).toFixed(2)} ${length.toFixed(2)}`
  return (
    <figure className={cn("inline-flex flex-col items-center", className)} aria-label={`Readiness ${value} out of 100`} role="img">
      <span className="relative block" style={{ width: size, height }}>
        <svg width={size} height={height} viewBox={`0 0 ${size} ${height}`} aria-hidden className="absolute inset-0">
          <path d={path} fill="none" stroke="var(--sk-sw-grey)" strokeWidth={stroke} strokeLinecap="round" />
          <path d={path} fill="none" stroke="var(--sk-sw-ink)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={dash} />
          <path d={path} fill="none" stroke="var(--sk-lime)" strokeWidth={Math.round(stroke * 0.45)} strokeLinecap="round" strokeDasharray={dash} />
        </svg>
        <span className="absolute inset-x-0 bottom-0 text-center font-display text-[3.5rem] font-black leading-[0.85] tabular-nums text-sk-ink" aria-hidden>
          {shown}
        </span>
      </span>
      {word ? (
        <figcaption className="mt-2 text-sm font-bold text-sk-ink" aria-hidden>
          {word}
        </figcaption>
      ) : null}
    </figure>
  )
}

/**
 * HoldButton: a button for something that should not happen by accident (finishing a session).
 * On a touch screen it fills with lime while held and acts when full; let go early and it drains.
 * A mouse click or the keyboard acts straight away, so it never traps anyone.
 */
export function HoldButton({
  onConfirm,
  children,
  holdingLabel = "Keep holding",
  holdMs = 750,
  disabled,
  className,
}: {
  onConfirm: () => void
  children: ReactNode
  holdingLabel?: ReactNode
  holdMs?: number
  disabled?: boolean
  className?: string
}) {
  const [fill, setFill] = useState(0)
  const [holding, setHolding] = useState(false)
  const frame = useRef(0)
  const touch = useRef(false)

  const stop = (confirm: boolean) => {
    cancelAnimationFrame(frame.current)
    setHolding(false)
    setFill(0)
    if (confirm) onConfirm()
  }

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "relative isolate inline-flex h-[60px] w-full cursor-pointer touch-none select-none items-center justify-center overflow-hidden rounded-full bg-sk-ink px-6 font-display text-[1.5rem] font-black uppercase tracking-[0.01em] text-white transition-transform active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-ink",
        className,
      )}
      onPointerDown={(event) => {
        touch.current = event.pointerType === "touch" || event.pointerType === "pen"
        if (!touch.current || disabled) return
        setHolding(true)
        const start = performance.now()
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / holdMs)
          setFill(t)
          if (t >= 1) {
            try {
              navigator.vibrate?.(30)
            } catch {
              // No vibration here.
            }
            stop(true)
            return
          }
          frame.current = requestAnimationFrame(step)
        }
        frame.current = requestAnimationFrame(step)
      }}
      onPointerUp={() => {
        if (touch.current && holding) stop(false)
      }}
      onPointerLeave={() => {
        if (touch.current && holding) stop(false)
      }}
      onPointerCancel={() => {
        if (touch.current && holding) stop(false)
      }}
      onClick={() => {
        // Touch is handled by the hold. A mouse click or Enter acts at once.
        if (touch.current) {
          touch.current = false
          return
        }
        onConfirm()
      }}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 -z-10 bg-sk-lime" style={{ width: `${fill * 100}%`, transition: holding ? "none" : "width 0.35s cubic-bezier(0.2,0.9,0.2,1)" }} />
      <span className={cn("relative transition-colors", fill > 0.5 && "text-sk-ink")}>{holding ? holdingLabel : children}</span>
    </button>
  )
}

const RAYS = Array.from({ length: 14 }, (_, index) => index)

/**
 * Burst: lime and ink rays that fly out from what it wraps, and a bounce, once each time
 * `play` turns true. For a new personal best.
 */
export function Burst({ play, children, className }: { play: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("relative inline-grid place-items-center", className)}>
      {play ? (
        <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-0">
          {RAYS.map((index) => (
            <span key={index} className="absolute left-0 top-0 block" style={{ transform: `rotate(${(index * 360) / RAYS.length}deg)` }}>
              <span
                className="sk-anim-ray -ml-1 -mt-[30px] block h-[30px] w-2 rounded-full"
                style={{ background: index % 2 ? "var(--sk-sw-ink)" : "var(--sk-lime)", animationDelay: `${(index % 3) * 45}ms` }}
              />
            </span>
          ))}
        </span>
      ) : null}
      <span className={cn("relative", play && "sk-anim-thump")}>{children}</span>
    </span>
  )
}

/**
 * Bars: values drawn as chunky bars that grow in one after another (rep splits, laps).
 * `best` marks the one drawn in lime. Lower is better for times, so pass `lowerIsBetter`.
 */
export function Bars({
  items,
  lowerIsBetter,
  className,
  label,
}: {
  items: Array<{ key: string; label: ReactNode; value: number; display: ReactNode }>
  lowerIsBetter?: boolean
  className?: string
  label: string
}) {
  if (items.length === 0) return null
  const values = items.map((item) => item.value)
  const best = lowerIsBetter ? Math.min(...values) : Math.max(...values)
  return (
    <ol className={cn("flex flex-col gap-2", className)} aria-label={label}>
      {items.map((item, index) => {
        const ratio = lowerIsBetter ? best / item.value : item.value / best
        const width = Math.max(30, Math.round(100 * Math.pow(ratio, 5)))
        const isBest = item.value === best && items.length > 1
        return (
          <li key={item.key} className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2.5">
            <span className="text-[0.8125rem] font-bold text-sk-mute">{item.label}</span>
            <span className="block h-10 overflow-hidden rounded-[14px] bg-sk-sw-grey">
              <span
                className={cn("sk-anim-grow flex h-full items-center justify-between rounded-[14px] px-3", isBest ? "bg-sk-lime text-sk-ink" : "bg-sk-ink text-white")}
                style={{ width: `${width}%`, animationDelay: `${index * 110}ms` }}
              >
                <span className="text-[0.6875rem] font-extrabold uppercase">{isBest ? "Best" : ""}</span>
                <span className="font-display text-[1.5rem] font-black leading-none tabular-nums">{item.display}</span>
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
