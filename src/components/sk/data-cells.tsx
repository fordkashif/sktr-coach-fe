import { cn } from "@/lib/utils"

/**
 * PercentCell: a share in a table as the number and a short bar beside it that grows in.
 * Below `low` the bar turns amber, so the ones to follow up stand out down a column.
 */
export function PercentCell({ value, low = 75 }: { value: number; low?: number }) {
  const width = Math.max(0, Math.min(100, value))
  return (
    <span className="inline-flex items-center justify-end gap-2.5" data-percent-cell>
      <span aria-hidden className="block h-2 w-16 overflow-hidden rounded-full bg-sk-sw-grey sm:w-20">
        <span className={cn("sk-anim-grow block h-full rounded-full", value < low ? "bg-sk-amber" : "bg-sk-ink")} style={{ width: `${width}%` }} />
      </span>
      <span className="min-w-[3ch] text-right tabular-nums">{value}%</span>
    </span>
  )
}

/**
 * ScoreCell: a 1 to 5 score as the number and five pips, the filled ones in ink. `higherIsWorse`
 * fills them amber from 4 up (soreness, fatigue, stress), so a hard day shows across the row.
 */
export function ScoreCell({ value, higherIsWorse = false }: { value: number | null; higherIsWorse?: boolean }) {
  if (value === null || value === undefined) return <span className="text-sk-faint">-</span>
  const warn = higherIsWorse ? value >= 4 : value <= 2
  return (
    <span className="inline-flex items-center justify-end gap-2" data-score-cell>
      <span aria-hidden className="flex gap-[3px]">
        {[1, 2, 3, 4, 5].map((pip) => (
          <span key={pip} className={cn("block size-[7px] rounded-full", pip <= value ? (warn ? "bg-sk-amber" : "bg-sk-ink") : "bg-sk-soft-2")} />
        ))}
      </span>
      <span className="tabular-nums">{value}</span>
    </span>
  )
}
