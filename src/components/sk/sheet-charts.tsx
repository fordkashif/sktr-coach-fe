import type { CSSProperties } from "react"

/**
 * Charts for a sheet of paper: SheetBars and SheetLine.
 *
 * TrendLine and TrendBars measure the screen and react to the pointer, which paper cannot do.
 * These two are still pictures: plain HTML and one SVG path, sized by their container, so they
 * print exactly as they look, never clipped, at any page width. Same look as the screen charts:
 * hairline grid, slim green bars, a 2px blue line, small grey labels. Sizes are in em, so they
 * follow the text size of the sheet (PrintSheet, or a report shown on screen).
 * Both need a `label` sentence that says what the chart shows, for people who cannot see it.
 */

const INK_MUTE = "#5a6274"
const LINE = "#e6e8ee"
const exact: CSSProperties = { printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }

export type SheetBar = {
  /** Under the bar ("8 Sep"). */
  label: string
  value: number
  /** The amount planned: drawn as a soft bar behind the value. */
  of?: number
}

/** A count per period as slim bars, starting at zero. With `of`, each bar sits in front of what was planned. */
export function SheetBars({ bars, label, height = 7 }: { bars: SheetBar[]; label: string; height?: number }) {
  const peak = Math.max(1, ...bars.map((bar) => Math.max(bar.value, bar.of ?? 0)))
  // Room for about eight labels: with more bars, only every nth is named.
  const step = Math.max(1, Math.ceil(bars.length / 8))
  const dense = bars.length > 16
  return (
    <div role="img" aria-label={label} data-sheet-chart="bars" style={{ breakInside: "avoid" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: dense ? "0.15em" : "0.5em", height: `${height}em`, borderBottom: `1px solid ${LINE}` }}>
        {bars.map((bar, index) => (
          <div key={index} style={{ flex: "1 1 0", minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
            {!dense ? <span style={{ fontSize: "0.8em", fontWeight: 700, lineHeight: 1.4 }}>{bar.value}</span> : null}
            <div style={{ position: "relative", width: "100%", maxWidth: "2.2em", height: `${(Math.max(bar.value, bar.of ?? 0) / peak) * 78}%` }}>
              {bar.of !== undefined ? <div style={{ ...exact, position: "absolute", inset: 0, background: "#eef0f5", borderRadius: "0.2em 0.2em 0 0" }} /> : null}
              <div
                style={{
                  ...exact,
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: `${Math.max(bar.value, bar.of ?? 0) > 0 ? (bar.value / Math.max(bar.value, bar.of ?? 0)) * 100 : 0}%`,
                  background: "#0c9d61",
                  borderRadius: "0.2em 0.2em 0 0",
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div aria-hidden style={{ display: "flex", gap: dense ? "0.15em" : "0.5em", marginTop: "0.3em" }}>
        {bars.map((bar, index) => (
          <span key={index} style={{ flex: "1 1 0", minWidth: 0, textAlign: "center", fontSize: "0.75em", color: INK_MUTE, whiteSpace: "nowrap", overflow: "visible" }}>
            {index % step === 0 ? bar.label : ""}
          </span>
        ))}
      </div>
    </div>
  )
}

/** One series over time as a 2px line on a hairline grid, from `min` to `max`. `startLabel` and `endLabel` name the ends. */
export function SheetLine({
  values,
  label,
  min = 0,
  max = 100,
  startLabel,
  endLabel,
  height = 7,
}: {
  values: number[]
  label: string
  min?: number
  max?: number
  startLabel?: string
  endLabel?: string
  height?: number
}) {
  const span = max - min || 1
  const x = (index: number) => (values.length > 1 ? (index / (values.length - 1)) * 100 : 50)
  const y = (value: number) => 100 - ((Math.min(max, Math.max(min, value)) - min) / span) * 100
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)} ${y(value).toFixed(2)}`).join(" ")
  const middle = Math.round(min + span / 2)
  return (
    <div role="img" aria-label={label} data-sheet-chart="line" style={{ breakInside: "avoid" }}>
      <div style={{ display: "flex", gap: "0.5em", height: `${height}em` }}>
        <div aria-hidden style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: "0.75em", color: INK_MUTE, textAlign: "right", minWidth: "1.8em", lineHeight: 1, margin: "-0.4em 0" }}>
          <span>{max}</span>
          <span>{middle}</span>
          <span>{min}</span>
        </div>
        <div style={{ position: "relative", flex: "1 1 0", minWidth: 0 }}>
          {[0, 50, 100].map((at) => (
            <div key={at} style={{ position: "absolute", left: 0, right: 0, top: `${at}%`, borderTop: `1px solid ${LINE}` }} />
          ))}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
            <path d={path} fill="none" stroke="#2152ff" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      </div>
      {startLabel || endLabel ? (
        <div aria-hidden style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5em", paddingLeft: "2.3em", fontSize: "0.75em", color: INK_MUTE }}>
          <span>{startLabel}</span>
          <span>{endLabel}</span>
        </div>
      ) : null}
    </div>
  )
}
