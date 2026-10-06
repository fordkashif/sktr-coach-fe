import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"

export type NavTabItem = {
  to: string
  label: string
  /** Other path prefixes that belong to this tab. `to` itself always counts. */
  match?: string[]
  /** Only the address itself counts, not the screens under it (for a tab whose address is the parent of the other tabs). */
  exact?: boolean
}

/**
 * NavTabs: the sub-sections of one destination, each its own screen with its own address
 * (Progress: Overview, Records, Competitions, Tests). Underlined like Tabs, but every tab is a
 * link, so the back button and deep links work. Put it straight under the ScreenHeader of each of
 * those screens. Two to five short labels; on a phone they scroll sideways inside the row, the
 * page never does. When they do not all fit, the row fades at the edge that has more (a hint that it
 * scrolls, not an arrow), and the tab of the open screen is always scrolled into view.
 * Use Tabs or Segmented instead when the views share one address.
 */
/** How far a row must be scrolled so that `tab` is fully in view (with a little air), or null when it already is. */
export function scrollLeftToShow(row: { scrollLeft: number; clientWidth: number }, tab: { offsetLeft: number; offsetWidth: number }, air = 24): number | null {
  const start = tab.offsetLeft
  const end = tab.offsetLeft + tab.offsetWidth
  if (start < row.scrollLeft) return Math.max(0, start - air)
  if (end > row.scrollLeft + row.clientWidth) return end - row.clientWidth + air
  return null
}

/** Which edges of a scrolling row hide more tabs. */
export function overflowEdges(row: { scrollLeft: number; clientWidth: number; scrollWidth: number }): { start: boolean; end: boolean } {
  return { start: row.scrollLeft > 1, end: row.scrollLeft + row.clientWidth < row.scrollWidth - 1 }
}

export function NavTabs({ label, items, className }: { label: string; items: NavTabItem[]; className?: string }) {
  const { pathname } = useLocation()
  const isActive = (item: NavTabItem) => [item.to, ...(item.match ?? [])].some((prefix) => pathname === prefix || (!item.exact && pathname.startsWith(`${prefix}/`)))
  const row = useRef<HTMLElement | null>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  // The open screen's tab is never left off the edge. Only the row moves, never the page.
  useLayoutEffect(() => {
    const nav = row.current
    const active = nav?.querySelector<HTMLElement>('[data-active="true"]')
    if (!nav || !active) return
    const left = scrollLeftToShow(nav, { offsetLeft: active.offsetLeft - nav.offsetLeft, offsetWidth: active.offsetWidth })
    if (left !== null) nav.scrollLeft = left
  }, [pathname, items.length])

  useEffect(() => {
    const nav = row.current
    if (!nav) return
    const measure = () => {
      const next = overflowEdges(nav)
      setEdges((current) => (current.start === next.start && current.end === next.end ? current : next))
    }
    measure()
    nav.addEventListener("scroll", measure, { passive: true })
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(nav)
    return () => {
      nav.removeEventListener("scroll", measure)
      observer?.disconnect()
    }
  }, [pathname, items.length])

  return (
    <div className={cn("relative min-w-0", className)} data-overflow-start={edges.start} data-overflow-end={edges.end}>
      <nav ref={row} aria-label={label} className="sk-tabs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const active = isActive(item)
          return (
            <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined} data-active={active} className="sk-tab inline-flex items-center">
              {item.label}
            </Link>
          )
        })}
      </nav>
      {/* A soft fade where more tabs are hidden. Taps pass through it. */}
      <span aria-hidden data-tabs-fade="start" className={cn("pointer-events-none absolute bottom-px left-0 top-0 w-10 bg-gradient-to-r from-white to-white/0 transition-opacity", edges.start ? "opacity-100" : "opacity-0")} />
      <span aria-hidden data-tabs-fade="end" className={cn("pointer-events-none absolute bottom-px right-0 top-0 w-12 bg-gradient-to-l from-white via-white/80 to-white/0 transition-opacity", edges.end ? "opacity-100" : "opacity-0")} />
    </div>
  )
}
