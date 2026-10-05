"use client"

import {
  ArrowLeft,
  Bell,
  Briefcase,
  Buildings,
  ChartBar,
  ClipboardText,
  House,
  type Icon,
  List,
  ListChecks,
  NotePencil,
  Play,
  Receipt,
  SignOut,
  SquaresFour,
  Timer,
  Tray,
  TrendUp,
  User,
  UsersThree,
  X,
} from "@phosphor-icons/react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import type React from "react"
import { getCoachScope } from "@/lib/coach-scope"
import { getNotificationFeed, markNotificationsRead, type NotificationItem } from "@/lib/data/notifications-data"
import { cn } from "@/lib/utils"
import { useRole } from "@/lib/role-context"
import { clearSessionCookies, COACH_TEAM_COOKIE, getCookieValue, setCoachTeamCookie } from "@/lib/auth-session"
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
import { Initials } from "@/components/sk"
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

type ShellLink = { href: string; label: string; icon: Icon }

const coachLinks: ShellLink[] = [
  { href: "/coach/dashboard", label: "Dashboard", icon: SquaresFour },
  { href: "/coach/teams", label: "Teams", icon: UsersThree },
  { href: "/coach/training-plan", label: "Plan", icon: ClipboardText },
  { href: "/coach/test-week", label: "Test", icon: Timer },
  { href: "/coach/reports", label: "Reports", icon: ChartBar },
]

const athleteLinks: ShellLink[] = [
  { href: "/athlete/home", label: "Home", icon: House },
  { href: "/athlete/training-plan", label: "Plan", icon: ClipboardText },
  { href: "/athlete/log", label: "Log", icon: NotePencil },
  { href: "/athlete/trends", label: "Progress", icon: TrendUp },
  { href: "/athlete/profile", label: "Profile", icon: User },
]

const clubAdminLinks: ShellLink[] = [
  { href: "/club-admin/dashboard", label: "Dashboard", icon: SquaresFour },
  { href: "/club-admin/profile", label: "Profile", icon: Buildings },
  { href: "/club-admin/users", label: "People", icon: UsersThree },
  { href: "/club-admin/teams", label: "Teams", icon: ClipboardText },
  { href: "/club-admin/reports", label: "Reports", icon: ChartBar },
  { href: "/club-admin/audit", label: "Audit", icon: ListChecks },
  { href: "/club-admin/billing", label: "Billing", icon: Receipt },
]

const platformAdminLinks: ShellLink[] = [
  { href: "/platform-admin/dashboard", label: "Dashboard", icon: SquaresFour },
  { href: "/platform-admin/requests", label: "Requests", icon: Tray },
  { href: "/platform-admin/tenants", label: "Tenants", icon: Buildings },
  { href: "/platform-admin/billing", label: "Billing", icon: Receipt },
  { href: "/platform-admin/commercial", label: "Commercial", icon: Briefcase },
  { href: "/platform-admin/audit", label: "Audit", icon: ListChecks },
]

function getRoleLabel(role: string) {
  if (role === "platform-admin") return "Platform Admin"
  if (role === "club-admin") return "Club Admin"
  if (role === "coach") return "Coach"
  return "Athlete"
}

function formatNotificationTime(value: string) {
  return new Date(value).toLocaleString()
}

function displayNameFromEmail(userEmail: string | null, fallbackRole: string) {
  if (!userEmail) return getRoleLabel(fallbackRole)
  const localPart = userEmail.split("@")[0] ?? ""
  const label = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
    .trim()
  return label || getRoleLabel(fallbackRole)
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

function prefetchCoachLink(linkLabel: string) {
  if (linkLabel === "Teams") return prefetchCoachTeamRoute()
  if (linkLabel === "Reports") return prefetchCoachReportsRoute()
  if (linkLabel === "Plan") return prefetchCoachTrainingPlanRoute()
  if (linkLabel === "Test") return prefetchCoachTestWeekRoute()
  return Promise.resolve()
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { role, userEmail } = useRole()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [mobileDetailMode, setMobileDetailMode] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsError, setNotificationsError] = useState<string | null>(null)
  const [resolvedCoachTeamId, setResolvedCoachTeamId] = useState<string | null>(() =>
    role === "coach" ? getCookieValue(COACH_TEAM_COOKIE) : null,
  )
  const isRestrictedClubAdminSetupRoute =
    pathname === "/club-admin/setup/billing" || pathname === "/club-admin/get-started"
  const useAthleteHomeActionNav = pathname.startsWith("/athlete/home")
  const hideMobileNav = mobileDetailMode

  useEffect(() => {
    if (role !== "coach" || typeof window === "undefined") {
      setResolvedCoachTeamId(null)
      return
    }

    const scopedTeamId = getCookieValue(COACH_TEAM_COOKIE)
    if (scopedTeamId) {
      setResolvedCoachTeamId(scopedTeamId)
      return
    }

    if (getBackendMode() !== "supabase") {
      const coachScope = getCoachScope(role)
      const mockTeamId = window.localStorage.getItem(MOCK_COACH_TEAM_STORAGE_KEY) ?? coachScope.teamId ?? null
      setResolvedCoachTeamId(mockTeamId)
      return
    }

    const supabase = getBrowserSupabaseClient()
    if (!supabase) {
      setResolvedCoachTeamId(null)
      return
    }

    let cancelled = false

    const resolveCoachTeamId = async () => {
      const { data: authSession } = await supabase.auth.getSession()
      const userId = authSession.session?.user.id
      if (!userId) {
        if (!cancelled) setResolvedCoachTeamId(null)
        return
      }

      const profileResult = await supabase.from("profiles").select("tenant_id, role").eq("user_id", userId).maybeSingle()
      if (cancelled || profileResult.error || !profileResult.data || profileResult.data.role !== "coach") {
        if (!cancelled) setResolvedCoachTeamId(null)
        return
      }

      const membershipResult = await supabase
        .from("team_coaches")
        .select("team_id")
        .eq("tenant_id", profileResult.data.tenant_id)
        .eq("user_id", userId)

      if (cancelled || membershipResult.error) {
        if (!cancelled) setResolvedCoachTeamId(null)
        return
      }

      const teamId = ((membershipResult.data as Array<{ team_id: string }> | null) ?? []).map((row) => row.team_id)[0] ?? null
      if (!cancelled) {
        setResolvedCoachTeamId(teamId)
        setCoachTeamCookie(teamId ?? undefined)
      }
    }

    void resolveCoachTeamId()
    return () => {
      cancelled = true
    }
  }, [role, pathname])

  const coachTeamsHref = useMemo(() => {
    if (role !== "coach" || typeof window === "undefined") return "/coach/teams"

    const scopedTeamId = resolvedCoachTeamId ?? getCookieValue(COACH_TEAM_COOKIE)
    if (scopedTeamId) {
      return `/coach/teams/${scopedTeamId}`
    }

    if (getBackendMode() !== "mock") return "/coach/teams"
    const coachScope = getCoachScope(role)
    const coachTeamId = window.localStorage.getItem(MOCK_COACH_TEAM_STORAGE_KEY) ?? coachScope.teamId

    if (coachScope.isScopedCoach && !coachScope.allowTeamSwitcher && coachTeamId) {
      return `/coach/teams/${coachTeamId}`
    }

    return "/coach/teams"
  }, [resolvedCoachTeamId, role])

  const links = useMemo(() => {
    if (role === "athlete") return athleteLinks
    if (role === "coach") {
      return coachLinks.map((link) => (link.href === "/coach/teams" ? { ...link, href: coachTeamsHref } : link))
    }
    if (role === "platform-admin") return platformAdminLinks
    return clubAdminLinks
  }, [coachTeamsHref, role])

  const useAthleteDrawerMenu = role === "athlete"
  const displayName = displayNameFromEmail(userEmail, role)
  const unreadNotifications = notifications.filter((item) => item.channel === "in-app" && item.state === "unread")

  useEffect(() => {
    if (getBackendMode() !== "supabase" || useAthleteDrawerMenu) return

    let cancelled = false

    const loadNotifications = async () => {
      setNotificationsLoading(true)
      const result = await getNotificationFeed()
      if (cancelled) return

      if (!result.ok) {
        setNotificationsError(result.error.message)
        setNotificationsLoading(false)
        return
      }

      setNotifications(result.data)
      setNotificationsError(null)
      setNotificationsLoading(false)
    }

    void loadNotifications()
    return () => {
      cancelled = true
    }
  }, [pathname, role, useAthleteDrawerMenu, userEmail])
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

  const prefetchHandlers = (label: string) =>
    role === "coach"
      ? {
          onMouseEnter: () => void prefetchCoachLink(label),
          onFocus: () => void prefetchCoachLink(label),
          onPointerDown: () => void prefetchCoachLink(label),
        }
      : {}

  const iconButton =
    "relative inline-flex size-11 items-center justify-center rounded-[14px] border border-sk-line bg-white text-sk-ink transition-colors hover:border-sk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"

  const profileMenuItems = (
    <>
      <DropdownMenuItem asChild>
        <Link to="/settings/notifications">Notification settings</Link>
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          void handleSignOut()
        }}
      >
        Sign out
      </DropdownMenuItem>
    </>
  )

  return (
    <div className="flex h-dvh overflow-hidden bg-sk-canvas text-sk-ink">
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>

      {!isRestrictedClubAdminSetupRoute ? (
        <aside className="hidden w-[264px] shrink-0 flex-col border-r border-sk-line bg-white lg:flex">
          <div className="flex items-center gap-3 px-6 pb-6 pt-7">
            <img src="/app-icon.png" alt="" className="size-11 rounded-[14px] object-contain" />
            <div className="leading-tight">
              <p className="text-lg font-extrabold tracking-[-0.03em] text-sk-ink">SKTR Coach</p>
              <p className="text-sm text-sk-mute">{getRoleLabel(role)}</p>
            </div>
            {useAthleteDrawerMenu ? null : (
              <button type="button" className={cn(iconButton, "ml-auto")} aria-label="Notifications" onClick={() => setPanelOpen(true)}>
                <Bell className="size-5" weight="bold" />
                {unreadNotifications.length > 0 ? (
                  <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-sk-coral px-1 text-[11px] font-bold leading-5 text-white">
                    {unreadNotifications.length}
                  </span>
                ) : null}
              </button>
            )}
          </div>

          <nav aria-label="Main" className="flex flex-1 flex-col gap-1 px-3">
            {links.map((link) => {
              const isActive = pathname.startsWith(link.href)
              const LinkIcon = link.icon
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  {...prefetchHandlers(link.label)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-[14px] px-3.5 py-3 text-[0.98rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue",
                    isActive ? "bg-sk-blue text-white" : "text-sk-ink-2 hover:bg-sk-canvas hover:text-sk-ink",
                  )}
                >
                  <LinkIcon className="size-5" weight={isActive ? "fill" : "bold"} />
                  {link.label}
                </Link>
              )
            })}
          </nav>

          <div className="border-t border-sk-line p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-[14px] p-2.5 text-left transition-colors hover:bg-sk-canvas focus-visible:outline-2 focus-visible:outline-sk-blue"
                  aria-label="Open profile menu"
                >
                  <Initials name={displayName} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-sk-ink">{displayName}</span>
                    <span className="block truncate text-xs text-sk-mute">{userEmail}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-56">
                {profileMenuItems}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.875rem)] sm:px-6 lg:hidden">
          <div className="min-w-0 lg:hidden">
            {mobileDetailMode ? (
              <button type="button" className={iconButton} aria-label="Back" onClick={handleMobileBack}>
                <ArrowLeft className="size-5" weight="bold" />
              </button>
            ) : role === "athlete" ? (
              <Link to="/athlete/profile" className="flex items-center gap-3">
                <Initials name={displayName} className="size-11" />
                <span className="truncate text-base font-bold text-sk-ink">{displayName}</span>
              </Link>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="flex items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-sk-blue" aria-label="Open profile menu">
                    <Initials name={displayName} className="size-11" />
                    <span className="min-w-0 text-left leading-tight">
                      <span className="block truncate text-base font-bold text-sk-ink">{displayName}</span>
                      {displayName !== getRoleLabel(role) ? <span className="block text-sm text-sk-mute">{getRoleLabel(role)}</span> : null}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">{profileMenuItems}</DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {isRestrictedClubAdminSetupRoute ? null : (
              <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
                <SheetTrigger asChild>
                  <button type="button" className={iconButton} aria-label={useAthleteDrawerMenu ? "Open menu" : "Notifications"}>
                    {useAthleteDrawerMenu ? <List className="size-5" weight="bold" /> : <Bell className="size-5" weight="bold" />}
                    {!useAthleteDrawerMenu && unreadNotifications.length > 0 ? (
                      <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-sk-coral px-1 text-[11px] font-bold leading-5 text-white">
                        {unreadNotifications.length}
                      </span>
                    ) : null}
                  </button>
                </SheetTrigger>
                <SheetContent side="right" showCloseButton={false} className="w-full border-l-sk-line bg-white sm:max-w-md">
                  {useAthleteDrawerMenu ? (
                    <div className="flex h-full flex-col px-5 pb-5 pt-6">
                      <SheetHeader className="sr-only">
                        <SheetTitle>Menu</SheetTitle>
                      </SheetHeader>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Initials name={displayName} className="size-11" />
                          <div className="min-w-0">
                            <p className="truncate text-lg font-bold tracking-[-0.02em] text-sk-ink">{displayName}</p>
                            <p className="truncate text-sm text-sk-mute">{getRoleLabel(role)}</p>
                          </div>
                        </div>
                        <SheetClose asChild>
                          <button type="button" className={iconButton} aria-label="Close menu">
                            <X className="size-5" weight="bold" />
                          </button>
                        </SheetClose>
                      </div>

                      <div className="mt-6 space-y-1">
                        {links.map((link) => {
                          const isActive = pathname.startsWith(link.href)
                          const LinkIcon = link.icon
                          return (
                            <SheetClose asChild key={link.href}>
                              <Link
                                to={link.href}
                                className={cn(
                                  "flex items-center gap-3 rounded-[14px] px-3.5 py-3.5 text-lg font-bold",
                                  isActive ? "bg-sk-blue text-white" : "text-sk-ink hover:bg-sk-canvas",
                                )}
                              >
                                <LinkIcon className="size-5" weight={isActive ? "fill" : "bold"} />
                                {link.label}
                              </Link>
                            </SheetClose>
                          )
                        })}
                      </div>

                      <div className="mt-5 space-y-1 border-t border-sk-line pt-5">
                        <SheetClose asChild>
                          <Link to="/athlete/join" className="block rounded-[14px] px-3.5 py-3 font-semibold text-sk-ink-2 hover:bg-sk-canvas">
                            Join a team
                          </Link>
                        </SheetClose>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-[14px] px-3.5 py-3 text-left font-semibold text-sk-ink-2 hover:bg-sk-canvas"
                          onClick={() => {
                            void handleSignOut()
                          }}
                        >
                          <SignOut className="size-5" weight="bold" />
                          Sign out
                        </button>
                      </div>

                      <div className="mt-auto pt-6">
                        <SheetClose asChild>
                          <Link to="/athlete/log" className="sk-btn sk-btn-primary h-14 w-full text-base">
                            <Play className="size-5" weight="fill" />
                            Start workout
                          </Link>
                        </SheetClose>
                      </div>
                    </div>
                  ) : (
                    <>
                      <SheetHeader className="border-b border-sk-line px-5 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <SheetTitle className="text-xl font-extrabold tracking-[-0.02em] text-sk-ink">Notifications</SheetTitle>
                          <SheetClose asChild>
                            <button type="button" className={iconButton} aria-label="Close notifications">
                              <X className="size-5" weight="bold" />
                            </button>
                          </SheetClose>
                        </div>
                      </SheetHeader>
                      <div className="space-y-3 overflow-y-auto p-5">
                        {notificationsLoading ? <p className="text-sm text-sk-mute">Loading notifications...</p> : null}
                        {notificationsError ? (
                          <p className="rounded-2xl bg-sk-coral-tint p-4 text-sm font-semibold text-[#b32a0c]">{notificationsError}</p>
                        ) : null}
                        {!notificationsLoading && !notificationsError && notifications.length === 0 ? (
                          <div className="rounded-2xl bg-sk-canvas p-5">
                            <p className="font-bold text-sk-ink">You are all caught up</p>
                            <p className="mt-1 text-sm text-sk-mute">New invites, plans and test weeks show up here.</p>
                          </div>
                        ) : null}
                        {!notificationsLoading && !notificationsError && notifications.length > 0 ? (
                          <>
                            {unreadNotifications.length > 0 ? (
                              <button
                                type="button"
                                className="sk-btn sk-btn-quiet sk-btn-sm"
                                onClick={async () => {
                                  const pendingIds = unreadNotifications.map((item) => item.userNotificationId)
                                  const result = await markNotificationsRead(pendingIds)
                                  if (!result.ok) {
                                    setNotificationsError(result.error.message)
                                    return
                                  }
                                  setNotifications((current) =>
                                    current.map((item) =>
                                      pendingIds.includes(item.userNotificationId)
                                        ? { ...item, state: "read", readAt: new Date().toISOString() }
                                        : item,
                                    ),
                                  )
                                  setNotificationsError(null)
                                }}
                              >
                                Mark all read
                              </button>
                            ) : null}
                            {notifications.map((item) => (
                              <div
                                key={item.id}
                                className={cn(
                                  "rounded-2xl border p-4",
                                  item.state === "unread" ? "border-sk-blue/30 bg-sk-blue-tint" : "border-sk-line bg-white",
                                )}
                              >
                                <p className="font-bold text-sk-ink">{item.subject}</p>
                                {item.body ? <p className="mt-1 text-sm leading-relaxed text-sk-ink-2">{item.body}</p> : null}
                                <p className="mt-2 text-xs text-sk-mute">{formatNotificationTime(item.createdAt)}</p>
                              </div>
                            ))}
                          </>
                        ) : null}
                      </div>
                    </>
                  )}
                </SheetContent>
              </Sheet>
            )}
          </div>
        </header>

        <main
          id="main-content"
          className={cn("flex-1 overflow-y-auto lg:pb-0", mobileDetailMode ? "pb-0" : "pb-28")}
        >
          <div className="min-h-full">{children}</div>
        </main>
      </div>

      {!isRestrictedClubAdminSetupRoute ? (
        <nav
          aria-label="Main"
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 border-t border-sk-line bg-white px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:hidden",
            hideMobileNav && "hidden",
          )}
        >
          {useAthleteHomeActionNav ? (
            <div className="mx-auto max-w-md px-2 pb-1">
              <Link to="/athlete/log" className="sk-btn sk-btn-primary h-14 w-full text-base">
                <Play className="size-5" weight="fill" />
                Start workout
              </Link>
            </div>
          ) : (
            <div className="mx-auto grid max-w-lg gap-1" style={{ gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))` }}>
              {links.map((link) => {
                const isActive = pathname.startsWith(link.href)
                const LinkIcon = link.icon
                return (
                  <Link
                    key={link.href}
                    to={link.href}
                    {...prefetchHandlers(link.label)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 rounded-[14px] px-1 py-2 text-xs font-bold transition-colors",
                      isActive ? "bg-sk-blue text-white" : "text-sk-mute hover:text-sk-ink",
                    )}
                  >
                    <LinkIcon className="size-6" weight={isActive ? "fill" : "bold"} />
                    <span className="truncate">{link.label}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </nav>
      ) : null}
    </div>
  )
}
