import { cn } from "@/lib/utils"

const DOT_COLORS = {
  blue: "bg-sk-blue",
  green: "bg-sk-green",
  yellow: "bg-sk-yellow",
  coral: "bg-sk-coral",
  ink: "bg-sk-ink",
} as const

export type GroupDotColor = keyof typeof DOT_COLORS

/**
 * GroupDot: the small colour dot a coach gives a squad so it can be told apart in a list. It uses
 * the avatar colours and, unlike StatusDot, says nothing about state: always put the squad's name
 * beside it. With no colour it is a hollow ring, so names stay lined up.
 */
export function GroupDot({ color, className }: { color?: GroupDotColor | null; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", color ? DOT_COLORS[color] : "border border-sk-line-strong", className)} />
}
