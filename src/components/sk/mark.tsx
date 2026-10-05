import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

const MARK_SIZES = {
  sm: "text-[1.0625rem]",
  md: "text-[1.375rem]",
  lg: "text-[2rem] lg:text-[2.5rem]",
} as const

/**
 * Mark: a result written the track and field way, the number bold and its unit small beside it
 * ("11.28 s", "7.42 m", "1:52.30"). `qualifier` is what belongs to the mark and nothing else: the
 * wind reading ("+1.2"), "w" for wind assisted, "i" for indoor. Sizes: `sm` in a table or a line
 * of text, `md` as the trailing value of a ListRow, `lg` for the one mark a screen is about.
 * It is ink, never coloured; say "personal best" beside it with StatusText or a Tag.
 */
export function Mark({
  value,
  unit,
  qualifier,
  size = "md",
  className,
}: {
  /** The written mark without its unit: "11.28", "1:52.30". */
  value: ReactNode
  /** "s", "m", "kg", "cm", "pts". Leave out for clock times. */
  unit?: string
  qualifier?: ReactNode
  size?: keyof typeof MARK_SIZES
  className?: string
}) {
  return (
    <span className={cn("inline-flex items-baseline whitespace-nowrap font-extrabold leading-none tracking-[-0.03em] text-sk-ink tabular-nums", MARK_SIZES[size], className)}>
      {value}
      {unit ? <span className="ml-0.5 text-[max(0.65em,0.8125rem)] font-bold tracking-normal text-sk-mute">{unit.trim()}</span> : null}
      {qualifier ? <span className="ml-1.5 text-sm font-semibold tracking-normal text-sk-mute">{qualifier}</span> : null}
    </span>
  )
}
