import { cn } from "@/lib/utils"

/**
 * Sparkline: one small trend line with no axes, for "how has this moved lately". `values` run oldest
 * to newest; null is a day with no value and is skipped (the line joins its neighbours). The line is ink, never a state colour, and
 * the newest point is marked. `label` is read by screen readers and must say the trend in words
 * ("Readiness over the last 28 days, from 62 to 81"). For a real chart with axes use a chart part.
 */
export function Sparkline({
  values,
  label,
  min,
  max,
  className,
}: {
  values: Array<number | null>
  label: string
  /** Fix the scale (0 and 100 for a score). Defaults to the range of the values. */
  min?: number
  max?: number
  className?: string
}) {
  const known = values.filter((value): value is number => value !== null)
  const low = min ?? Math.min(...known)
  const high = max ?? Math.max(...known)
  const span = high - low || 1
  const width = 300
  const height = 64
  const pad = 5
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0
  const point = (value: number, index: number) => ({
    x: pad + index * step,
    y: pad + (1 - (Math.max(low, Math.min(high, value)) - low) / span) * (height - pad * 2),
  })

  // A day with no value is skipped: the line runs straight from the day before to the day after.
  const points = values.flatMap((value, index) => (value === null ? [] : [point(value, index)]))
  const segments = points.length > 0 ? [points] : []

  const lastIndex = values.reduce<number>((found, value, index) => (value !== null ? index : found), -1)
  const last = lastIndex >= 0 ? point(values[lastIndex] as number, lastIndex) : null

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn("block h-16 w-full overflow-visible", className)}>
      <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} className="stroke-sk-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {segments.map((segment, index) =>
        segment.length === 1 ? (
          <line key={index} x1={segment[0].x} x2={segment[0].x} y1={segment[0].y} y2={segment[0].y} className="stroke-sk-ink" strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ) : (
          <polyline
            key={index}
            points={segment.map((item) => `${item.x},${item.y}`).join(" ")}
            fill="none"
            className="stroke-sk-ink"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
      {/* Dots are zero-length round-capped lines so they stay round when the drawing stretches. */}
      {last ? <line x1={last.x} x2={last.x} y1={last.y} y2={last.y} className="stroke-sk-blue" strokeWidth={8} strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  )
}
