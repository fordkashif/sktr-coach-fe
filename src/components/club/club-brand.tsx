import { ClubMark } from "@/components/sk"
import { useClubBrand } from "@/lib/club-brand-store"
import { cn } from "@/lib/utils"

/**
 * The member's club in the desktop top bar, beside "SKTR Coach": the logo (or the short name on the
 * club colour) and the club's name. Nothing for someone with no club (a platform admin).
 * `compact` is for a coach who also has the team switcher: nothing below 1280px, where the
 * bar has no room, the mark from 1280px, the name from 1536px.
 */
export function ShellClubBrand({ compact = false }: { compact?: boolean }) {
  const { brand } = useClubBrand()
  if (!brand) return null
  return (
    <div data-shell-club className={cn("-ml-1 min-w-0 shrink-0 items-center gap-2.5 border-l border-sk-line pl-4 xl:-ml-2 xl:pl-5", compact ? "hidden xl:flex" : "flex")} title={brand.name}>
      <ClubMark name={brand.name} shortName={brand.shortName} color={brand.color} logoUrl={brand.logoUrl} />
      <span className={cn("hidden max-w-[11rem] truncate text-[0.9375rem] font-bold text-sk-ink", compact ? "min-[1536px]:block" : "xl:block")}>{brand.name}</span>
      <span className="sr-only">{brand.name}</span>
    </div>
  )
}

/** The member's club at the top of the profile menu (the phone app bar has no room for it). */
export function MenuClubBrand() {
  const { brand } = useClubBrand()
  if (!brand) return null
  return (
    <div data-menu-club className="flex items-center gap-2.5 px-3 pb-2 pt-2">
      <ClubMark name={brand.name} shortName={brand.shortName} color={brand.color} logoUrl={brand.logoUrl} />
      <p className="min-w-0 truncate text-[0.9375rem] font-bold text-sk-ink">{brand.name}</p>
    </div>
  )
}

/**
 * The club at the top of a printed sheet (PrintSheet `brand`): logo or short name, the club's name,
 * and a short rule in the club colour. Inline styles because print styles do not use the app's classes.
 */
export function PrintClubBrand() {
  const { brand } = useClubBrand()
  if (!brand) return null
  return (
    <div data-print-club style={{ display: "flex", alignItems: "center", gap: "3mm", marginBottom: "4mm", paddingBottom: "3mm", borderBottom: `0.8mm solid ${brand.color}` }}>
      <ClubMark name={brand.name} shortName={brand.shortName} color={brand.color} logoUrl={brand.logoUrl} size="md" />
      <span style={{ fontSize: "12pt", fontWeight: 700, letterSpacing: "-0.01em" }}>{brand.name}</span>
    </div>
  )
}
