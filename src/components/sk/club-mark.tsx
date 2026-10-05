import { cn } from "@/lib/utils"

const SIZES = { sm: "size-8 rounded-[8px] text-[0.6875rem]", md: "size-10 rounded-[10px] text-xs", lg: "size-20 rounded-[16px] text-xl" } as const

/** Black or white, whichever reads better on the given colour (WCAG relative luminance). */
function readableOn(hex: string) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) return "#ffffff"
  const [r, g, b] = match.slice(1).map((part) => {
    const channel = parseInt(part, 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.4 ? "#0e1320" : "#ffffff"
}

/**
 * ClubMark: a club's logo as a small square. With no logo it shows the club's short name (or its
 * initials) on the club colour, with black or white letters picked for contrast. This is the only
 * place a club colour is used on screen; it never colours buttons, links or state.
 * Decorative: always put the club's name in words beside it.
 */
export function ClubMark({
  name,
  shortName,
  color,
  logoUrl,
  size = "sm",
  className,
}: {
  name: string
  shortName?: string | null
  /** Six digit hex. */
  color?: string | null
  logoUrl?: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  if (logoUrl) {
    return <img src={logoUrl} alt="" className={cn("shrink-0 border border-sk-line bg-white object-contain", SIZES[size], className)} />
  }
  const letters =
    (shortName ?? "").trim().slice(0, 4).toUpperCase() ||
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") ||
    "?"
  const background = color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#2152ff"
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 select-none items-center justify-center font-extrabold leading-none tracking-[-0.02em]", SIZES[size], className)}
      // Kept on paper too: browsers drop background colours when printing unless told otherwise.
      style={{ backgroundColor: background, color: readableOn(background), printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
    >
      {letters}
    </span>
  )
}
