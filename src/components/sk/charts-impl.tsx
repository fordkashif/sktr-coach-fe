import { BarChart, LineChart } from "@mui/x-charts"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Charts in the kit's look. One series per chart, straight on the page (never inside a box):
 * a 2px line or slim bars in blue or green, hairline grid, 12px grey axis labels, the page's own
 * typeface, a tooltip on hover or tap. Every chart needs `label`: one sentence that says what it
 * shows and the headline number, for screen readers. Put the headline number in words next to
 * the chart as well (a Section `meta` or `hint`); the chart supports it, it does not replace it.
 */

const SERIES = { blue: "#2152ff", green: "#0c9d61" } as const
const GRID = "#e6e8ee"
const AXIS_TEXT = "#5a6274"

export type ChartColor = keyof typeof SERIES

const tickLabelStyle = { fontFamily: "inherit", fontSize: 12, fontWeight: 500, fill: AXIS_TEXT }

function chartSx(color: string) {
  return {
    fontFamily: "inherit",
    "& .MuiChartsAxis-line, & .MuiChartsAxis-tick": { stroke: "transparent" },
    "& .MuiChartsAxis-tickLabel": { fill: AXIS_TEXT, fontSize: 12, fontFamily: "inherit", fontWeight: 500 },
    "& .MuiChartsGrid-line": { stroke: GRID, strokeDasharray: "none" },
    "& .MuiChartsAxisHighlight-root": { stroke: "#d5d9e3", strokeDasharray: "none" },
    "& .MuiLineElement-root": { strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
    // A filled dot with a ring in the page colour, so it stays readable where it sits on the line.
    "& .MuiMarkElement-root": { fill: color, stroke: "#ffffff", strokeWidth: 2 },
    "& .MuiBarLabel-root": { fill: "#0e1320", fontSize: 12, fontFamily: "inherit", fontWeight: 700 },
  }
}

const tooltipSlotProps = {
  tooltip: {
    sx: {
      "& *": { fontFamily: "inherit !important" },
      "& .MuiChartsTooltip-paper": {
        boxShadow: "none",
        border: "1px solid #d5d9e3",
        borderRadius: "12px",
        backgroundColor: "#ffffff",
        color: "#0e1320",
      },
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

export type TrendLinePoint = {
  /** A Date puts the point on a time axis (uneven gaps are drawn to scale). Text puts points at even steps. */
  x: Date | string
  /** Null leaves a gap that the line bridges. */
  y: number | null
}

/**
 * TrendLine: how one number moved over time (readiness per day, a 100m time per race).
 * `seriesName` names the number in the tooltip. `formatValue` writes a value the way the screen
 * does ("11.28s", "1:52.30"). The y axis starts at the data unless `min` and `max` fix it (0 and
 * 100 for a score).
 */
export function TrendLine({
  points,
  label,
  seriesName,
  color = "blue",
  formatValue = (value) => String(value),
  formatDate = (date) => date.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
  formatTooltipDate = (date) => date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
  min,
  max,
  smooth = false,
  height = 220,
  className,
}: {
  points: TrendLinePoint[]
  label: string
  seriesName: string
  color?: ChartColor
  formatValue?: (value: number) => string
  /** Axis tick text on a time axis. */
  formatDate?: (date: Date) => string
  formatTooltipDate?: (date: Date) => string
  min?: number
  max?: number
  /** Round the corners of the line. For dense daily data; leave off for a handful of marks. */
  smooth?: boolean
  height?: number
  className?: string
}) {
  const stroke = SERIES[color]
  const timeAxis = points.length > 0 && points.every((point) => point.x instanceof Date)
  const known = points.map((point) => point.y).filter((value): value is number => value !== null)
  // Room above and below so the highest and lowest dots are not cut by the plot edge.
  const span = known.length ? Math.max(...known) - Math.min(...known) : 0
  const pad = span === 0 ? Math.max(Math.abs(known[0] ?? 1) * 0.02, 0.05) : span * 0.15
  const yMin = min ?? (known.length ? Math.min(...known) - pad : undefined)
  const yMax = max ?? (known.length ? Math.max(...known) + pad : undefined)
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>()

  return (
    <div ref={wrapRef} role="img" aria-label={label} className={cn("-ml-1 min-w-0 overflow-hidden", className)}>
      <LineChart
        xAxis={[
          timeAxis
            ? {
                scaleType: "time",
                data: points.map((point) => point.x as Date),
                valueFormatter: (value: Date, context) => (context.location === "tick" ? formatDate(value) : formatTooltipDate(value)),
                tickNumber: wrapWidth > 640 ? 7 : 4,
                disableLine: true,
                disableTicks: true,
                tickLabelStyle,
              }
            : {
                scaleType: "point",
                data: points.map((point) => String(point.x)),
                disableLine: true,
                disableTicks: true,
                tickLabelStyle,
              },
        ]}
        yAxis={[
          {
            min: yMin,
            max: yMax,
            width: 44,
            tickNumber: 4,
            valueFormatter: (value: number) => formatValue(value),
            disableLine: true,
            disableTicks: true,
            tickLabelStyle,
          },
        ]}
        series={[
          {
            data: points.map((point) => point.y),
            label: seriesName,
            color: stroke,
            curve: smooth ? "monotoneX" : "linear",
            connectNulls: true,
            showMark: points.length <= 31,
            valueFormatter: (value) => (value === null ? "No value" : formatValue(value)),
          },
        ]}
        grid={{ horizontal: true }}
        margin={{ left: 0, right: 28, top: 12, bottom: 0 }}
        height={height}
        hideLegend
        sx={chartSx(stroke)}
        slotProps={tooltipSlotProps}
      />
    </div>
  )
}

/**
 * TrendBars: a count per period (sessions per week). Bars are slim whatever the number of periods,
 * start at zero and carry their value on top while there are few enough to read.
 */
export function TrendBars({
  points,
  label,
  seriesName,
  color = "green",
  formatValue = (value) => String(value),
  minPeak = 4,
  height = 220,
  className,
}: {
  points: Array<{ x: string; y: number }>
  label: string
  seriesName: string
  color?: ChartColor
  formatValue?: (value: number) => string
  /** The y axis reaches at least this, so one session does not fill the whole chart. */
  minPeak?: number
  height?: number
  className?: string
}) {
  const fill = SERIES[color]
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>()
  // Keep bars about 20px wide however few periods are shown.
  const gapRatio = wrapWidth > 0 && points.length > 0 ? Math.max(0.3, Math.min(0.95, 1 - (20 * points.length) / Math.max(1, wrapWidth - 60))) : 0.7
  // One step of headroom so the value on the tallest bar is never clipped.
  const peak = Math.max(minPeak, ...points.map((point) => point.y)) + 1

  return (
    <div ref={wrapRef} role="img" aria-label={label} className={cn("-ml-1 min-w-0 overflow-hidden", className)}>
      <BarChart
        xAxis={[
          {
            scaleType: "band",
            data: points.map((point) => point.x),
            categoryGapRatio: gapRatio,
            disableLine: true,
            disableTicks: true,
            tickLabelStyle,
          },
        ]}
        yAxis={[{ min: 0, max: peak, tickMinStep: 1, tickNumber: 4, width: 32, disableLine: true, disableTicks: true, tickLabelStyle }]}
        series={[
          {
            data: points.map((point) => point.y),
            label: seriesName,
            color: fill,
            barLabel: points.length <= 13 ? (item) => (item.value ? String(item.value) : null) : undefined,
            barLabelPlacement: "outside",
            valueFormatter: (value) => formatValue(value ?? 0),
          },
        ]}
        borderRadius={4}
        grid={{ horizontal: true }}
        margin={{ left: 0, right: 16, top: 20, bottom: 0 }}
        height={height}
        hideLegend
        sx={chartSx(fill)}
        slotProps={tooltipSlotProps}
      />
    </div>
  )
}
