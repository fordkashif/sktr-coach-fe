import { BarChart, ChartsReferenceLine, LineChart } from "@mui/x-charts"
import { useDrawingArea, useYScale } from "@mui/x-charts/hooks"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Charts for training load, in the same look as TrendLine and TrendBars (charts.tsx): straight on
 * the page, hairline grid, 12px grey axis labels, a tooltip on hover or tap, one y axis each.
 * Weekly load and the ratio have different scales, so they are two charts, never one with two axes.
 * Both need `label`: one sentence that says what the chart shows, for screen readers. The headline
 * goes in words beside the chart as well.
 */

const GREEN = "#0c9d61"
const BLUE = "#2152ff"
/** Planned load: a quiet grey, so what was done is what the eye lands on. */
const PLANNED = "#aab1c0"
const GRID = "#e6e8ee"
const AXIS_TEXT = "#5a6274"

const tickLabelStyle = { fontFamily: "inherit", fontSize: 12, fontWeight: 500, fill: AXIS_TEXT }

const sx = {
  fontFamily: "inherit",
  "& .MuiChartsAxis-line, & .MuiChartsAxis-tick": { stroke: "transparent" },
  "& .MuiChartsAxis-tickLabel": { fill: AXIS_TEXT, fontSize: 12, fontFamily: "inherit", fontWeight: 500 },
  "& .MuiChartsGrid-line": { stroke: GRID, strokeDasharray: "none" },
  "& .MuiChartsAxisHighlight-root": { stroke: "#d5d9e3", strokeDasharray: "none" },
  "& .MuiLineElement-root": { strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
  "& .MuiMarkElement-root": { fill: BLUE, stroke: "#ffffff", strokeWidth: 2 },
} as const

const tooltipSlotProps = {
  tooltip: {
    sx: {
      "& *": { fontFamily: "inherit !important" },
      "& .MuiChartsTooltip-paper": { boxShadow: "none", border: "1px solid #d5d9e3", borderRadius: "12px", backgroundColor: "#ffffff", color: "#0e1320" },
      "& .MuiChartsTooltip-cell, & .MuiChartsTooltip-labelCell, & .MuiChartsTooltip-valueCell": { fontSize: 14, color: "#0e1320" },
    },
  },
} as const

function useElementWidth<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0))
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return [setNode, width] as const
}

function thousands(value: number) {
  return Math.round(value).toLocaleString("en-GB")
}

/** Every label on a wide chart, every second or third one where they would run into each other. */
function tickEvery(count: number, width: number) {
  if (width <= 0) return 1
  return Math.max(1, Math.ceil(count / Math.max(1, Math.floor((width - 56) / 52))))
}

function LegendDot({ color, children }: { color: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ backgroundColor: color }} />
      {children}
    </span>
  )
}

export type LoadBarsPoint = {
  /** The week, as it reads on the axis ("28 Sep"). */
  x: string
  actual: number
  /** Planned load of that week. Null when the plan gives none. */
  planned?: number | null
}

/**
 * LoadBars: load per week as slim green bars from zero. When any week has a planned load, a grey
 * bar for it stands beside the green one and a one line legend names the two.
 * The unit ("effort x minutes") belongs in the Section hint, not on the axis.
 */
export function LoadBars({ points, label, height = 220, className }: { points: LoadBarsPoint[]; label: string; height?: number; className?: string }) {
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>()
  const hasPlanned = points.some((point) => point.planned !== null && point.planned !== undefined)
  const peak = Math.max(100, ...points.map((point) => Math.max(point.actual, point.planned ?? 0)))
  const every = tickEvery(points.length, wrapWidth)
  // Slim bars however wide the chart is: about 18px each, so a pair is about 40px.
  const groupPx = hasPlanned ? 40 : 20
  const gapRatio = wrapWidth > 0 && points.length > 0 ? Math.max(0.3, Math.min(0.9, 1 - (groupPx * points.length) / Math.max(1, wrapWidth - 60))) : 0.6

  return (
    <div className={cn("min-w-0", className)}>
      <div ref={wrapRef} role="img" aria-label={label} className="-ml-1 min-w-0 overflow-hidden">
        <BarChart
          xAxis={[
            {
              scaleType: "band",
              data: points.map((point) => point.x),
              categoryGapRatio: gapRatio,
              barGapRatio: 0.15,
              tickLabelInterval: (_value, index) => (points.length - 1 - index) % every === 0,
              disableLine: true,
              disableTicks: true,
              tickLabelStyle,
            },
          ]}
          yAxis={[{ min: 0, max: peak * 1.08, tickNumber: 4, width: 48, valueFormatter: (value: number) => thousands(value), disableLine: true, disableTicks: true, tickLabelStyle }]}
          series={[
            ...(hasPlanned ? [{ data: points.map((point) => point.planned ?? null), label: "Planned", color: PLANNED, valueFormatter: (value: number | null) => (value === null ? "None" : thousands(value)) }] : []),
            { data: points.map((point) => point.actual), label: "Done", color: GREEN, valueFormatter: (value: number | null) => thousands(value ?? 0) },
          ]}
          borderRadius={3}
          grid={{ horizontal: true }}
          margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
          height={height}
          hideLegend
          sx={sx}
          slotProps={tooltipSlotProps}
        />
      </div>
      {hasPlanned ? (
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-sk-mute">
          <LegendDot color={PLANNED}>Planned</LegendDot>
          <LegendDot color={GREEN}>Done</LegendDot>
        </p>
      ) : null}
    </div>
  )
}

/** The usual range as a faint band behind the line, with its name on it. */
function UsualBand({ from, to }: { from: number; to: number }) {
  const { left, width } = useDrawingArea()
  const scale = useYScale<"linear">()
  const top = scale(to)
  const bottom = scale(from)
  if (top === undefined || bottom === undefined) return null
  return (
    <g aria-hidden>
      <rect x={left} y={top} width={width} height={Math.max(0, bottom - top)} fill={GREEN} fillOpacity={0.08} />
      <text x={left + 6} y={top + 14} fontSize={12} fontWeight={500} fill={AXIS_TEXT} fontFamily="inherit">
        Usual range
      </text>
    </g>
  )
}

/**
 * RatioLine: the last 7 days against the usual week, week by week, as a blue line from zero.
 * 1.0 means the same as usual. The band is the usual range and the line at `wellAbove` is where
 * "well above usual" starts. A week with no ratio yet leaves a gap.
 */
export function RatioLine({
  points,
  label,
  usualFrom,
  usualTo,
  wellAbove,
  height = 200,
  className,
}: {
  points: Array<{ x: string; y: number | null }>
  label: string
  usualFrom: number
  usualTo: number
  wellAbove: number
  height?: number
  className?: string
}) {
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>()
  const known = points.map((point) => point.y).filter((value): value is number => value !== null)
  const max = Math.max(2, Math.ceil((Math.max(0, ...known) + 0.15) * 2) / 2)
  const every = tickEvery(points.length, wrapWidth)

  return (
    <div ref={wrapRef} role="img" aria-label={label} className={cn("-ml-1 min-w-0 overflow-hidden", className)}>
      <LineChart
        xAxis={[
          {
            scaleType: "point",
            data: points.map((point) => point.x),
            tickLabelInterval: (_value, index) => (points.length - 1 - index) % every === 0,
            disableLine: true,
            disableTicks: true,
            tickLabelStyle,
          },
        ]}
        yAxis={[{ min: 0, max, tickNumber: 4, width: 48, valueFormatter: (value: number) => value.toFixed(1), disableLine: true, disableTicks: true, tickLabelStyle }]}
        series={[
          {
            data: points.map((point) => point.y),
            label: "Last 7 days against the usual week",
            color: BLUE,
            curve: "linear",
            connectNulls: false,
            showMark: true,
            valueFormatter: (value) => (value === null ? "Not enough history" : value.toFixed(2)),
          },
        ]}
        grid={{ horizontal: true }}
        margin={{ left: 0, right: 28, top: 12, bottom: 0 }}
        height={height}
        hideLegend
        sx={sx}
        slotProps={tooltipSlotProps}
      >
        <UsualBand from={usualFrom} to={usualTo} />
        <ChartsReferenceLine y={wellAbove} lineStyle={{ stroke: "#ff5c39", strokeWidth: 1, strokeDasharray: "4 3" }} label="Well above" labelAlign="start" labelStyle={{ fontSize: 12, fontWeight: 500, fill: AXIS_TEXT, fontFamily: "inherit" }} />
      </LineChart>
    </div>
  )
}
