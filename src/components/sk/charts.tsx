import { lazy, Suspense, type ComponentProps } from "react"
import type { TrendBars as TrendBarsImpl, TrendLine as TrendLineImpl } from "./charts-impl"

// The charts sit on a large charting library. Loading them only when a chart is on screen keeps
// that library out of the first load of every other screen.
export type { ChartColor, TrendLinePoint } from "./charts-impl"

const LazyTrendLine = lazy(() => import("./charts-impl").then((module) => ({ default: module.TrendLine })))
const LazyTrendBars = lazy(() => import("./charts-impl").then((module) => ({ default: module.TrendBars })))

/** Holds the chart's place while it loads, so the screen does not jump. */
export function ChartPlaceholder({ height }: { height?: number }) {
  return <div aria-hidden style={{ height: height ?? 220 }} />
}

export function TrendLine(props: ComponentProps<typeof TrendLineImpl>) {
  return (
    <Suspense fallback={<ChartPlaceholder height={(props as { height?: number }).height} />}>
      <LazyTrendLine {...props} />
    </Suspense>
  )
}

export function TrendBars(props: ComponentProps<typeof TrendBarsImpl>) {
  return (
    <Suspense fallback={<ChartPlaceholder height={(props as { height?: number }).height} />}>
      <LazyTrendBars {...props} />
    </Suspense>
  )
}
