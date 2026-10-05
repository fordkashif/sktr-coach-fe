"use client"

import {
  ArrowLeft,
  Briefcase,
  Buildings,
  CalendarBlank,
  ChartBar,
  ClipboardText,
  DotsThree,
  House,
  type Icon,
  ListChecks,
  Plus,
  Receipt,
  SquaresFour,
  Timer,
  Tray,
  TrendUp,
  User,
  UsersThree,
} from "@phosphor-icons/react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import type React from "react"
import { CoachTeamSwitcher } from "@/components/coach/team-switcher"
import { useCoachTeams } from "@/lib/coach-teams"
import { NotificationBell, NotificationSheet } from "@/components/notifications/notification-center"
import { cn } from "@/lib/utils"
import { useRole } from "@/lib/role-context"
import { useCurrentAccount } from "@/lib/account-store"
import { clearSessionCookies } from "@/lib/auth-session"
import {
  MOCK_COACH_TEAM_STORAGE_KEY,
  MOCK_ROLE_STORAGE_KEY,
} from "@/lib/mock-auth"
import { getBackendMode } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, List, ListRow, Sheet } from "@/components/sk"

/**
 * App shell. See DESIGN.md, "Navigation".
 * Desktop (1024px and up): one top bar. Brand, team switcher, the role's destinations, bell, profile menu.
 * Phone: a slim app bar (brand or team switcher or back, bell, profile menu) and a bottom tab bar of at
 * most five items. A role with more destinations gets "More" as the fifth, opening a sheet.
 * There is no sidebar.
 */

type ShellLink = {
  id: string
  href: string
  /** Desktop top bar label. */
  label: string
  /** Phone tab label when the desktop one is too long. */
  short?: string
  icon: Icon
}

const coachLinks: ShellLink[] = [
  { id: "dashboard", href: "/coach/dashboard", label: "Dashboard", icon: SquaresFour },
  { id: "teams", href: "/coach/teams", label: "Athletes", icon: UsersThree },
  { id: "plans", href: "/coach/training-plan", label: "Plans", icon: ClipboardText },
  { id: "tests", href: "/coach/test-week", label: "Test weeks", short: "Tests", icon: Timer },
  { id: "reports", href: "/coach/reports", label: "Reports", icon: ChartBar },
]

/** The athlete's third item is the log action: a raised round button in the phone tab bar. */
const ATHLETE_LOG_ID = "log"
const athleteLinks: ShellLink[] = [
  { id: "home", href: "/athlete/home", label: "Home", icon: House },
  { id: "plan", href: "/athlete/training-plan", label: "Plan", icon: CalendarBlank },
  { id: ATHLETE_LOG_ID, href: "/athlete/log", label: "Log", icon: Plus },
  { id: "progress", href: "/athlete/trends", label: "Progress", icon: TrendUp },
  { id: "profile", href: "/athlete/profile", label: "Profile", short: "Me", icon: User },
]

const clubAdminLinks: ShellLink[] = [
  { id: "dashboard", href: "/club-admin/dashboard", label: "Dashboard", icon: SquaresFour },
  { id: "people", href: "/club-admin/users", label: "People", icon: UsersThree },
  { id: "teams", href: "/club-admin/teams", label: "Teams", icon: ClipboardText },
  { id: "reports", href: "/club-admin/reports", label: "Reports", icon: ChartBar },
  { id: "club", href: "/club-admin/profile", label: "Club", icon: Buildings },
  { id: "activity", href: "/club-admin/audit", label: "Activity", icon: ListChecks },
  { id: "billing", href: "/club-admin/billing", label: "Billing", icon: Receipt },
]

const platformAdminLinks: ShellLink[] = [
  { id: "dashboard", href: "/platform-admin/dashboard", label: "Dashboard", icon: SquaresFour },
  { id: "requests", href: "/platform-admin/requests", label: "Requests", icon: Tray },
  { id: "clubs", href: "/platform-admin/tenants", label: "Clubs", icon: Buildings },
  { id: "billing", href: "/platform-admin/billing", label: "Billing", icon: Receipt },
  { id: "packages", href: "/platform-admin/commercial", label: "Packages", icon: Briefcase },
  { id: "activity", href: "/platform-admin/audit", label: "Activity", icon: ListChecks },
]

/** The phone tab bar holds five items. With more destinations, four stay and the rest go behind "More". */
const PHONE_TAB_LIMIT = 5

function getRoleLabel(role: string) {
  if (role === "platform-admin") return "Platform Admin"
  if (role === "club-admin") return "Club Admin"
  if (role === "coach") return "Coach"
  return "Athlete"
}

let coachTeamRoutePrefetchPromise: Promise<unknown> | null = null
let coachReportsRoutePrefetchPromise: Promise<unknown> | null = null
let coachTrainingPlanRoutePrefetchPromise: Promise<unknown> | null = null
let coachTestWeekRoutePrefetchPromise: Promise<unknown> | null = null

function prefetchCoachTeamRoute() {
  if (!coachTeamRoutePrefetchPromise) {
    coachTeamRoutePrefetchPromise = import("@/app/(authenticated)/coach/teams/[teamId]/page")
  }
  return coachTeamRoutePrefetchPromise
}

function prefetchCoachReportsRoute() {
  if (!coachReportsRoutePrefetchPromise) {
    coachReportsRoutePrefetchPromise = import("@/app/(authenticated)/coach/reports/page")
  }
  return coachReportsRoutePrefetchPromise
}

function prefetchCoachTrainingPlanRoute() {
  if (!coachTrainingPlanRoutePrefetchPromise) {
    coachTrainingPlanRoutePrefetchPromise = import("@/app/(authenticated)/coach/training-plan/page")
  }
  return coachTrainingPlanRoutePrefetchPromise
}

function prefetchCoachTestWeekRoute() {
  if (!coachTestWeekRoutePrefetchPromise) {
    coachTestWeekRoutePrefetchPromise = import("@/app/(authenticated)/coach/test-week/page")
  }
  return coachTestWeekRoutePrefetchPromise
}

function prefetchCoachLink(linkId: string) {
  if (linkId === "teams") return prefetchCoachTeamRoute()
  if (linkId === "reports") return prefetchCoachReportsRoute()
  if (linkId === "plans") return prefetchCoachTrainingPlanRoute()
  if (linkId === "tests") return prefetchCoachTestWeekRoute()
  return Promise.resolve()
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { role, userEmail } = useRole()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [mobileDetailMode, setMobileDetailMode] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const { selectedTeamId: coachTeamId, teams: coachTeams } = useCoachTeams()
  const showTeamSwitcher = role === "coach" && coachTeams.length > 1
  const isRestrictedClubAdminSetupRoute =
    pathname === "/club-admin/setup/billing" || pathname === "/club-admin/get-started"
  const hideMobileNav = mobileDetailMode

  // The Teams tab opens the selected team. With no team it opens the page that explains why.
  const coachTeamsHref = role === "coach" && coachTeamId ? `/coach/teams/${coachTeamId}` : "/coach/teams"

  // After a switch, a screen that belongs to one team moves to the same screen for the new team.
  const handleTeamSwitched = (team: { id: string }) => {
    if (pathname.startsWith("/coach/teams/") || pathname.startsWith("/coach/athletes/")) {
      navigate(`/coach/teams/${team.id}`)
    }
  }

  const links = useMemo(() => {
    if (role === "athlete") return athleteLinks
    if (role === "coach") {
      return coachLinks.map((link) => (link.href === "/coach/teams" ? { ...link, href: coachTeamsHref } : link))
    }
    if (role === "platform-admin") return platformAdminLinks
    return clubAdminLinks
  }, [coachTeamsHref, role])

  // A coach's Athletes tab points at one team, so it stays lit on any team or athlete page.
  const isLinkActive = (link: ShellLink) =>
    role === "coach" && link.id === "teams"
      ? pathname.startsWith("/coach/teams") || pathname.startsWith("/coach/athletes")
      : pathname.startsWith(link.href)

  const homeHref = links[0]?.href ?? "/"
  const accountHref = role === "athlete" ? "/athlete/profile" : "/account"
  const phoneTabs = links.length > PHONE_TAB_LIMIT ? links.slice(0, PHONE_TAB_LIMIT - 1) : links
  const moreLinks = links.length > PHONE_TAB_LIMIT ? links.slice(PHONE_TAB_LIMIT - 1) : []
  const moreActive = moreLinks.some(isLinkActive)

  // The person's real name and photo. The email is only a fallback for an account with no name yet.
  const { displayName, avatarUrl } = useCurrentAccount()

  useEffect(() => {
    const scroller = document.getElementById("main-content")
    if (scroller) {
      scroller.scrollTo({ top: 0, left: 0, behavior: "auto" })
    } else {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" })
    }
  }, [pathname])

  useEffect(() => {
    if (typeof window !== "undefined") {
      setMobileDetailMode(Boolean((window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }).__PACELAB_MOBILE_DETAIL_MODE))
    }

    const handleMobileDetailMode = (event: Event) => {
      const customEvent = event as CustomEvent<{ active?: boolean }>
      setMobileDetailMode(Boolean(customEvent.detail?.active))
    }

    window.addEventListener("pacelab:mobile-detail-mode", handleMobileDetailMode as EventListener)
    return () => {
      window.removeEventListener("pacelab:mobile-detail-mode", handleMobileDetailMode as EventListener)
    }
  }, [])

  const handleMobileBack = () => {
    window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-back"))
  }

  const handleSignOut = async () => {
    const backendMode = getBackendMode()

    if (backendMode === "supabase") {
      const supabase = getBrowserSupabaseClient()
      if (supabase) {
        await supabase.auth.signOut()
      }
    }
    if (backendMode === "mock") {
      window.localStorage.removeItem(MOCK_ROLE_STORAGE_KEY)
      window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
    }
    clearSessionCookies()
    navigate("/login")
  }

  const prefetchHandlers = (linkId: string) =>
    role === "coach"
      ? {
          onMouseEnter: () => void prefetchCoachLink(linkId),
          onFocus: () => void prefetchCoachLink(linkId),
          onPointerDown: () => void prefetchCoachLink(linkId),
        }
      : {}

  const showChrome = !isRestrictedClubAdminSetupRoute
  // Every role has the notification centre (athletes included). It is only hidden during club setup.
  const showBell = showChrome

  const bell = showBell ? <NotificationBell onOpen={() => setPanelOpen(true)} /> : null

  const menuItem = "min-h-11 cursor-pointer rounded-[10px] px-3 text-[0.9375rem] font-semibold text-sk-ink focus:bg-sk-soft"
  const profileMenu = (size: "md" | "lg") => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
          aria-label="Open profile menu"
        >
          <Avatar name={displayName} src={avatarUrl} size={size} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64 rounded-2xl border-sk-line-strong bg-white p-1.5">
        <div className="px-3 pb-2 pt-2">
          <p className="truncate text-base font-bold text-sk-ink">{displayName}</p>
          <p className="truncate text-sm text-sk-mute">{userEmail ?? getRoleLabel(role)}</p>
        </div>
        <div className="my-1 h-px bg-sk-line" />
        <DropdownMenuItem asChild className={menuItem}>
          <Link to={accountHref}>Your account</Link>
        </DropdownMenuItem>
        {role === "athlete" ? (
          <DropdownMenuItem asChild className={menuItem}>
            <Link to="/athlete/join">Join a team</Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild className={menuItem}>
          <Link to="/settings/notifications">Notification settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={menuItem}
          onSelect={() => {
            void handleSignOut()
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const brand = (
    <Link
      to={homeHref}
      className="shrink-0 rounded-[6px] text-xl font-extrabold tracking-[-0.03em] text-sk-blue focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sk-blue"
    >
      SKTR Coach
    </Link>
  )

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white text-sk-ink">
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-[12px] bg-sk-blue px-4 py-2.5 font-bold text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>

      {/* Desktop: the top bar */}
      {showChrome ? (
        <header
          data-shell="topbar"
          className="hidden h-[69px] shrink-0 items-center gap-5 border-b border-sk-line bg-white px-6 lg:flex xl:gap-7 xl:px-10"
        >
          {brand}
          {showTeamSwitcher ? <CoachTeamSwitcher variant="topbar" onSwitched={handleTeamSwitched} /> : null}
          <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {links.map((link) => {
              const isActive = isLinkActive(link)
              return (
                <Link
                  key={link.id}
                  to={link.href}
                  {...prefetchHandlers(link.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-[12px] px-3.5 py-2.5 text-[0.9375rem] leading-5 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sk-blue",
                    isActive ? "bg-sk-blue-tint font-bold text-sk-blue-ink" : "font-semibold text-sk-ink-2 hover:bg-sk-soft hover:text-sk-ink",
                  )}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>
          <div className="flex shrink-0 items-center gap-3">
            {bell}
            {profileMenu("md")}
          </div>
        </header>
      ) : null}

      {/* Phone: the app bar */}
      <header data-shell="appbar" className="box-content flex h-14 shrink-0 items-center gap-3 bg-white px-5 pt-[env(safe-area-inset-top)] sm:px-6 lg:hidden">
        <div className="flex min-w-0 flex-1 items-center">
          {mobileDetailMode ? (
            <button type="button" className="sk-icon-btn" aria-label="Back" onClick={handleMobileBack}>
              <ArrowLeft className="size-5" weight="bold" aria-hidden />
            </button>
          ) : showTeamSwitcher ? (
            <CoachTeamSwitcher variant="bar" onSwitched={handleTeamSwitched} />
          ) : (
            brand
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {bell}
          {profileMenu("lg")}
        </div>
      </header>

      <main id="main-content" className="min-h-0 flex-1 overflow-y-auto">
        <div className="min-h-full">{children}</div>
      </main>

      {/* Phone: the tab bar */}
      {showChrome ? (
        <nav
          aria-label="Main"
          data-shell="tabbar"
          className={cn(
            "relative z-40 shrink-0 border-t border-sk-line bg-white px-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2 lg:hidden",
            hideMobileNav && "hidden",
          )}
        >
          <div className="mx-auto grid max-w-lg items-center" style={{ gridTemplateColumns: `repeat(${phoneTabs.length + (moreLinks.length > 0 ? 1 : 0)}, minmax(0, 1fr))` }}>
            {phoneTabs.map((link) => {
              const isActive = isLinkActive(link)
              const LinkIcon = link.icon
              if (role === "athlete" && link.id === ATHLETE_LOG_ID) {
                return (
                  <Link
                    key={link.id}
                    to={link.href}
                    aria-label="Log a session"
                    aria-current={isActive ? "page" : undefined}
                    className="-mt-[22px] flex size-14 items-center justify-center justify-self-center rounded-full bg-sk-ink text-white outline-offset-2 transition-transform focus-visible:outline-2 focus-visible:outline-sk-blue active:scale-95"
                  >
                    <Plus className="size-6" weight="bold" aria-hidden />
                  </Link>
                )
              }
              return (
                <Link
                  key={link.id}
                  to={link.href}
                  {...prefetchHandlers(link.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center gap-[3px] rounded-[12px] text-xs outline-offset-0 focus-visible:outline-2 focus-visible:outline-sk-blue",
                    isActive ? "font-bold text-sk-blue" : "font-semibold text-sk-mute",
                  )}
                >
                  <LinkIcon className="size-6" weight={isActive ? "fill" : "regular"} aria-hidden />
                  <span className="max-w-full truncate">{link.short ?? link.label}</span>
                </Link>
              )
            })}
            {moreLinks.length > 0 ? (
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setMoreOpen(true)}
                className={cn(
                  "flex min-h-12 cursor-pointer flex-col items-center justify-center gap-[3px] rounded-[12px] text-xs focus-visible:outline-2 focus-visible:outline-sk-blue",
                  moreActive ? "font-bold text-sk-blue" : "font-semibold text-sk-mute",
                )}
              >
                <DotsThree className="size-6" weight="bold" aria-hidden />
                More
              </button>
            ) : null}
          </div>
        </nav>
      ) : null}

      {moreLinks.length > 0 ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen} side="bottom" title="More">
          <List>
            {moreLinks.map((link) => {
              const LinkIcon = link.icon
              const isActive = isLinkActive(link)
              return (
                <ListRow
                  key={link.id}
                  to={link.href}
                  onNavigate={() => setMoreOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  leading={<LinkIcon className={cn("size-6", isActive ? "text-sk-blue" : "text-sk-ink-2")} weight={isActive ? "fill" : "regular"} aria-hidden />}
                  title={link.label}
                />
              )
            })}
          </List>
        </Sheet>
      ) : null}

      {showBell ? <NotificationSheet open={panelOpen} onOpenChange={setPanelOpen} /> : null}
    </div>
  )
}
