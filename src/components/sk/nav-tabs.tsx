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
 * page never does. Use Tabs or Segmented instead when the views share one address.
 */
export function NavTabs({ label, items, className }: { label: string; items: NavTabItem[]; className?: string }) {
  const { pathname } = useLocation()
  const isActive = (item: NavTabItem) => [item.to, ...(item.match ?? [])].some((prefix) => pathname === prefix || (!item.exact && pathname.startsWith(`${prefix}/`)))
  return (
    <nav aria-label={label} className={cn("sk-tabs [scrollbar-width:none]", className)}>
      {items.map((item) => {
        const active = isActive(item)
        return (
          <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined} data-active={active} className="sk-tab inline-flex items-center">
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
