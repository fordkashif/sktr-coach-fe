import { lazy, Suspense, type ComponentProps } from "react"
import { ChartPlaceholder } from "./charts"
import type { LoadBars as LoadBarsImpl, RatioLine as RatioLineImpl } from "./load-charts-impl"

// Loaded only when a load chart is on screen. See charts.tsx.
export type { LoadBarsPoint } from "./load-charts-impl"

const LazyLoadBars = lazy(() => import("./load-charts-impl").then((module) => ({ default: module.LoadBars })))
const LazyRatioLine = lazy(() => import("./load-charts-impl").then((module) => ({ default: module.RatioLine })))

export function LoadBars(props: ComponentProps<typeof LoadBarsImpl>) {
  return (
    <Suspense fallback={<ChartPlaceholder height={props.height} />}>
      <LazyLoadBars {...props} />
    </Suspense>
  )
}

export function RatioLine(props: ComponentProps<typeof RatioLineImpl>) {
  return (
    <Suspense fallback={<ChartPlaceholder height={(props as { height?: number }).height} />}>
      <LazyRatioLine {...props} />
    </Suspense>
  )
}
