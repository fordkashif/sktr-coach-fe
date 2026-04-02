"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  AssignmentsIcon,
  Fire03Icon,
  Home01Icon,
  Menu01Icon,
  Moon01Icon,
  Notification01Icon,
  PlayIcon,
  PieChartSquareIcon,
  StarAward02Icon,
  Sun01Icon,
  Table03Icon,
  TextCreationIcon,
  UserGroupIcon,
  UserStoryIcon,
} from "@hugeicons/core-free-icons"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import type React from "react"
import { useTheme } from "next-themes"
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
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

type IconType = React.ComponentProps<typeof HugeiconsIcon>["icon"]

type ShellLink = { href: string; label: string; icon: IconType }

const coachLinks: ShellLink[] = [
  { href: "/coach/dashboard", label: "Dashboard", icon: Table03Icon },
  { href: "/coach/teams", label: "Teams", icon: UserGroupIcon },
  { href: "/coach/training-plan", label: "Plan", icon: AssignmentsIcon },
  { href: "/coach/test-week", label: "Test", icon: StarAward02Icon },
  { href: "/coach/reports", label: "Reports", icon: PieChartSquareIcon },
]

const athleteLinks: ShellLink[] = [
  { href: "/athlete/home", label: "Home", icon: Home01Icon },
  { href: "/athlete/training-plan", label: "Plan", icon: AssignmentsIcon },
  { href: "/athlete/log", label: "Log", icon: TextCreationIcon },
  { href: "/athlete/trends", label: "Progress", icon: PieChartSquareIcon },
  { href: "/athlete/profile", label: "Profile", icon: UserStoryIcon },
]

const clubAdminLinks: ShellLink[] = [
  { href: "/club-admin/dashboard", label: "Dashboard", icon: Table03Icon },
  { href: "/club-admin/profile", label: "Profile", icon: UserStoryIcon },
  { href: "/club-admin/users", label: "Users", icon: UserGroupIcon },
  { href: "/club-admin/teams", label: "Teams", icon: AssignmentsIcon },
  { href: "/club-admin/reports", label: "Reports", icon: PieChartSquareIcon },
  { href: "/club-admin/audit", label: "Audit", icon: Notification01Icon },
  { href: "/club-admin/billing", label: "Billing", icon: TextCreationIcon },
]

const platformAdminLinks: ShellLink[] = [
  { href: "/platform-admin/dashboard", label: "Dashboard", icon: Table03Icon },
  { href: "/platform-admin/requests", label: "Requests", icon: Notification01Icon },
  { href: "/platform-admin/audit", label: "Audit", icon: PieChartSquareIcon },
]

function getRoleLabel(role: string) {
  if (role === "platform-admin") return "Platform Admin"
  if (role === "club-admin") return "Club Admin"
  if (role === "coach") return "Coach"
  return "Athlete"
}

function getProfileImage(role: string) {
  if (role === "platform-admin") return "/avatar-placeholder.svg"
  if (role === "coach") return "/coach-avatar.png"
  if (role === "athlete") return "/coach-avatar.png"
  return "/avatar-placeholder.svg"
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
  const { resolvedTheme, setTheme } = useTheme()
  const [mobileDetailMode, setMobileDetailMode] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsError, setNotificationsError] = useState<string | null>(null)
  const [resolvedCoachTeamId, setResolvedCoachTeamId] = useState<string | null>(() =>
    role === "coach" ? getCookieValue(COACH_TEAM_COOKIE) : null,
  )
  const useAthleteHomeActionNav = pathname.startsWith("/athlete/home")
  const hideMobileNav = mobileDetailMode
  const useSectionBoundTopTone =
    pathname.startsWith("/coach/dashboard") ||
    pathname.startsWith("/coach/teams") ||
    pathname.startsWith("/coach/athletes") ||
    pathname.startsWith("/coach/training-plan") ||
    pathname.startsWith("/coach/test-week") ||
    pathname.startsWith("/coach/reports") ||
    pathname.startsWith("/club-admin") ||
    pathname.startsWith("/platform-admin")

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

  const activeLink = links.find((link) => pathname.startsWith(link.href)) ?? links[0]
  const isDark = resolvedTheme === "dark"
  const toggleTheme = () => setTheme(isDark ? "light" : "dark")
  const useAthleteDrawerMenu = role === "athlete"
  const athleteDisplayName = role === "athlete" ? displayNameFromEmail(userEmail, role) : null
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

  return (
    <div className="flex h-dvh overflow-hidden bg-[#06101d] text-slate-950">
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>

      <aside className="hidden w-[320px] shrink-0 border-r border-white/10 bg-[linear-gradient(180deg,rgba(7,17,34,0.98)_0%,rgba(9,21,41,0.96)_100%)] text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-3 px-7 pb-6 pt-7">
          <div className="flex size-11 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(31,140,255,0.25)]">
            <img src="/app-icon.png" alt="PaceLab" className="size-full object-cover" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#6fb6ff]">PaceLab</p>
            <p className="text-sm text-white/60">Performance workspace</p>
          </div>
        </div>

        <div className="px-5">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.05] p-5 backdrop-blur-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6fb6ff]">Signed in as</p>
            <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">{getRoleLabel(role)}</p>
            <p className="mt-2 text-sm leading-6 text-white/62">{userEmail}</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-2 px-5 py-6">
          {links.map((link) => {
            const isActive = pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                to={link.href}
                onMouseEnter={() => {
                  if (role === "coach") void prefetchCoachLink(link.label)
                }}
                onFocus={() => {
                  if (role === "coach") void prefetchCoachLink(link.label)
                }}
                onPointerDown={() => {
                  if (role === "coach") void prefetchCoachLink(link.label)
                }}
                className={cn(
                  "group flex items-center justify-between rounded-[22px] px-4 py-3.5 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-white text-slate-950 shadow-[0_12px_36px_rgba(15,23,42,0.24)]"
                    : "text-white/68 hover:bg-white/[0.06] hover:text-white",
                )}
              >
                <span className="flex items-center gap-3">
                  <HugeiconsIcon icon={link.icon} className={cn("size-4", isActive ? "text-[#1368ff]" : "text-white/70")} />
                  {link.label}
                </span>
                <span className={cn("h-2.5 w-2.5 rounded-full transition-colors", isActive ? "bg-[#1368ff]" : "bg-transparent group-hover:bg-white/25")} />
              </Link>
            )
          })}
        </nav>

        <div className="space-y-3 border-t border-white/10 px-5 py-5">
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full justify-between rounded-full border border-white/10 bg-white/[0.04] px-4 text-white hover:bg-white/[0.08]"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            <span className="text-sm font-medium">Theme</span>
            <HugeiconsIcon icon={isDark ? Moon01Icon : Sun01Icon} className="size-4 text-white/80" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full justify-between rounded-full border border-white/10 bg-white/[0.04] px-4 text-white hover:bg-white/[0.08]"
            onClick={() => {
              void handleSignOut()
            }}
          >
            <span className="text-sm font-medium">Sign out</span>
            <span className="text-xs uppercase tracking-[0.18em] text-white/55">Exit</span>
          </Button>
        </div>
      </aside>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col overflow-hidden",
          useSectionBoundTopTone
            ? "bg-[linear-gradient(180deg,#f3f6fb_0%,#eef3f8_100%)] lg:bg-[linear-gradient(180deg,#f3f6fb_0%,#eef3f8_100%)]"
            : "bg-[linear-gradient(180deg,#f3f6fb_0%,#eef3f8_100%)] lg:bg-[linear-gradient(180deg,#06101d_0%,#091425_160px,#f3f6fb_160px,#eef3f8_100%)]",
        )}
      >
        <header
          className={cn(
            "px-4 pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-6 lg:px-8 lg:pt-4",
            "bg-[#f2f5fa] pb-3 text-slate-950 lg:text-white",
            useSectionBoundTopTone
              ? "lg:bg-[#06101d] lg:pb-4"
              : "lg:bg-[linear-gradient(180deg,#f3f6fb_0%,#eef3f8_100%)] lg:pb-0",
          )}
        >
          <div className="py-0 lg:bg-transparent">
            <div className="flex items-start justify-between gap-4 lg:items-center">
              <div className="hidden min-w-0 lg:block">
                <h1 className="truncate text-[clamp(1.5rem,2vw,2rem)] font-semibold tracking-[-0.04em] text-white">
                  {activeLink?.label ?? "Workspace"}
                </h1>
              </div>

              <div className="min-w-0 lg:hidden">
                {mobileDetailMode ? (
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-14 rounded-[24px] border border-slate-200/70 bg-white/95 text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.08)] hover:bg-white"
                      aria-label="Back"
                      onClick={handleMobileBack}
                    >
                      <HugeiconsIcon icon={ArrowLeft01Icon} className="size-5" />
                    </Button>
                    <div className="min-w-0 text-left">
                      {role === "athlete" ? (
                        <div className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 shadow-[0_8px_18px_rgba(15,23,42,0.06)]">
                          <span className="flex size-4 items-center justify-center rounded-full bg-[#5d7f2c] text-white">
                            <HugeiconsIcon icon={Fire03Icon} className="size-3" />
                          </span>
                          124 kcal
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="size-2 rounded-full bg-[#678c26]" />
                          <p className="truncate text-[15px] font-medium text-slate-950">{getRoleLabel(role)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : role === "athlete" ? (
                  <Link to="/athlete/profile" className="flex items-center gap-3">
                    <img
                      src={getProfileImage(role)}
                      alt={`${getRoleLabel(role)} profile`}
                      className="size-14 rounded-[24px] object-cover shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
                    />
                    <div className="min-w-0 text-left">
                      <div className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 shadow-[0_8px_18px_rgba(15,23,42,0.06)]">
                        <span className="flex size-4 items-center justify-center rounded-full bg-[#5d7f2c] text-white">
                          <HugeiconsIcon icon={Fire03Icon} className="size-3" />
                        </span>
                        124 kcal
                      </div>
                    </div>
                  </Link>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="flex h-auto items-center gap-3 rounded-[24px] px-0 py-0 hover:bg-transparent"
                        aria-label="Open profile menu"
                      >
                        <img
                          src={getProfileImage(role)}
                          alt={`${getRoleLabel(role)} profile`}
                          className="size-14 rounded-[24px] object-cover shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
                        />
                        <div className="min-w-0 text-left">
                          <div className="flex items-center gap-1.5">
                            <span className="size-2 rounded-full bg-[#678c26]" />
                            <p className="truncate text-[15px] font-medium text-slate-950">{getRoleLabel(role)}</p>
                          </div>
                        </div>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem>Profile</DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/settings/notifications">Settings</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          void handleSignOut()
                        }}
                      >
                        Sign out
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Badge className="hidden rounded-full border-none bg-white/10 px-3 py-1.5 text-white lg:inline-flex">{userEmail}</Badge>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hidden size-9 rounded-full border border-slate-200/90 bg-white/95 text-slate-700 shadow-sm hover:bg-slate-50 lg:inline-flex lg:size-8 lg:border-white/10 lg:bg-white/[0.04] lg:text-white lg:hover:bg-white/[0.1]"
                  aria-label="Toggle theme"
                  onClick={toggleTheme}
                >
                  <HugeiconsIcon icon={isDark ? Moon01Icon : Sun01Icon} className="size-3.5" />
                </Button>

                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative size-14 rounded-[24px] border border-slate-200/70 bg-white/95 text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.08)] hover:bg-white lg:size-8 lg:rounded-full lg:border-white/10 lg:bg-white/[0.04] lg:text-white lg:shadow-none lg:hover:bg-white/[0.1]" aria-label={useAthleteDrawerMenu ? "Open menu" : "Notifications"}>
                      <HugeiconsIcon icon={useAthleteDrawerMenu ? Menu01Icon : Notification01Icon} className="size-3.5" />
                      {!useAthleteDrawerMenu && unreadNotifications.length > 0 ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[#ff6a55]" /> : null}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" showCloseButton={false} className="w-full border-l-slate-200 bg-white sm:max-w-md">
                    {useAthleteDrawerMenu ? null : (
                      <SheetHeader className="border-b border-slate-200 px-4 py-3">
                        <div className="grid grid-cols-[auto_1fr_auto] items-center">
                          <SheetClose asChild>
                            <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="Back">
                              <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
                            </Button>
                          </SheetClose>
                          <SheetTitle className="text-center text-base font-semibold text-slate-950">Notifications</SheetTitle>
                          <span aria-hidden className="size-9" />
                        </div>
                      </SheetHeader>
                    )}
                    {useAthleteDrawerMenu ? (
                      <div className="flex h-full flex-col px-4 pb-4 pt-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <img
                              src={getProfileImage(role)}
                              alt="Athlete profile"
                              className="size-12 rounded-[18px] object-cover"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-base font-semibold tracking-[-0.03em] text-slate-950">{athleteDisplayName ?? "Athlete"}</p>
                              <p className="truncate text-xs text-slate-500">
                                {getRoleLabel(role)}
                              </p>
                            </div>
                          </div>
                          <SheetClose asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-10 rounded-full border border-slate-200 bg-white text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
                              aria-label="Close menu"
                            >
                              <span className="text-base leading-none">x</span>
                            </Button>
                          </SheetClose>
                        </div>

                        <div className="mt-7 space-y-1">
                          {links.map((link) => (
                            <SheetClose asChild key={link.href}>
                              <Link
                                to={link.href}
                                className={cn(
                                  "flex items-center justify-between rounded-[20px] px-1 py-3 text-[1.15rem] font-medium tracking-[-0.03em] text-slate-950",
                                  pathname.startsWith(link.href) && "text-[#1368ff]",
                                )}
                              >
                                <span>{link.label}</span>
                                {pathname.startsWith(link.href) ? (
                                  <span className="inline-flex size-2 rounded-full bg-[#1368ff]" />
                                ) : null}
                              </Link>
                            </SheetClose>
                          ))}
                        </div>

                        <div className="mt-6 border-t border-slate-200 pt-5">
                          <div className="space-y-3 text-sm text-slate-700">
                            <SheetClose asChild>
                              <Link to="/athlete/profile" className="block">
                                Profile
                              </Link>
                            </SheetClose>
                            <button type="button" className="block text-left" onClick={toggleTheme}>
                              Theme
                            </button>
                            <SheetClose asChild>
                              <Link to="/athlete/join" className="block">
                                Join Team
                              </Link>
                            </SheetClose>
                            <button
                              type="button"
                              className="block text-left"
                              onClick={() => {
                                void handleSignOut()
                              }}
                            >
                              Sign out
                            </button>
                          </div>
                        </div>

                        <div className="mt-auto pt-6">
                          <SheetClose asChild>
                            <Link
                              to="/athlete/log"
                              className="flex h-[58px] items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(7,17,34,0.94)_0%,rgba(9,20,39,0.92)_100%)] px-5 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(5,12,24,0.24)]"
                            >
                              Start Workout
                            </Link>
                          </SheetClose>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 p-4">
                        {notificationsLoading ? (
                          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                            <p className="text-sm font-medium text-slate-950">Loading notifications</p>
                            <p className="text-xs text-slate-500">Fetching your latest events.</p>
                          </div>
                        ) : null}
                        {notificationsError ? (
                          <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-4">
                            <p className="text-sm font-medium text-rose-700">{notificationsError}</p>
                          </div>
                        ) : null}
                        {!notificationsLoading && !notificationsError && notifications.length === 0 ? (
                          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                            <p className="text-sm font-medium text-slate-950">No new notifications</p>
                            <p className="text-xs text-slate-500">You are all caught up.</p>
                          </div>
                        ) : null}
                        {!notificationsLoading && !notificationsError && notifications.length > 0 ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-10 rounded-full border-slate-200"
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
                            </Button>
                            {notifications.map((item) => (
                              <div key={item.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-medium text-slate-950">{item.subject}</p>
                                    {item.body ? <p className="mt-1 text-xs leading-5 text-slate-500">{item.body}</p> : null}
                                  </div>
                                  <span
                                    className={cn(
                                      "rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]",
                                      item.state === "read" && "bg-slate-200 text-slate-600",
                                      item.state === "unread" && "bg-[#dbeafe] text-[#1368ff]",
                                      item.state === "dismissed" && "bg-slate-100 text-slate-500",
                                    )}
                                  >
                                    {item.state}
                                  </span>
                                </div>
                                <p className="mt-2 text-[11px] text-slate-400">
                                  {item.channel} · {formatNotificationTime(item.createdAt)}
                                </p>
                              </div>
                            ))}
                          </>
                        ) : null}
                      </div>
                    )}
                  </SheetContent>
                </Sheet>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="hidden size-10 overflow-hidden rounded-full border border-slate-200/80 bg-white/90 p-0 shadow-[0_8px_24px_rgba(15,23,42,0.08)] hover:bg-white lg:inline-flex lg:size-8 lg:border-white/10 lg:bg-white/[0.04] lg:shadow-none lg:hover:bg-white/[0.1]" aria-label="Open profile menu">
                      <img
                        src={getProfileImage(role)}
                        alt={`${getRoleLabel(role)} profile`}
                        className="size-10 rounded-full object-cover lg:size-8"
                      />
                      <span className="sr-only">Profile menu</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>Profile</DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/settings/notifications">Settings</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        void handleSignOut()
                      }}
                    >
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </header>

        <main
          id="main-content"
          className={cn(
            "flex-1 overflow-y-auto lg:pb-0",
            mobileDetailMode ? "pb-0" : useAthleteHomeActionNav ? "pb-24" : "pb-28",
          )}
        >
          <div className="min-h-full rounded-t-none bg-transparent lg:rounded-t-[40px]">{children}</div>
        </main>
      </div>

      <nav className={cn("fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden", hideMobileNav && "hidden")}>
        {useAthleteHomeActionNav ? (
          <div className="mx-auto max-w-md">
            <Link
              to="/athlete/log"
              className="flex h-[60px] items-center justify-center gap-2 rounded-[28px] bg-[linear-gradient(135deg,rgba(7,17,34,0.94)_0%,rgba(9,20,39,0.92)_100%)] px-5 text-white shadow-[0_20px_60px_rgba(5,12,24,0.34)]"
            >
              <span className="text-sm font-semibold">Start Workout</span>
              <HugeiconsIcon icon={PlayIcon} className="size-4 text-[#6fb6ff]" />
            </Link>
          </div>
        ) : (
          <div className="mx-auto max-w-md rounded-[28px] border border-white/12 bg-[linear-gradient(135deg,rgba(7,17,34,0.94)_0%,rgba(9,20,39,0.92)_100%)] px-2 py-2 shadow-[0_20px_60px_rgba(5,12,24,0.34)] backdrop-blur-xl">
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))` }}
            >
              {links.map((link) => {
                const isActive = pathname.startsWith(link.href)
                return (
                  <Link
                    key={link.href}
                    to={link.href}
                    onMouseEnter={() => {
                      if (role === "coach") void prefetchCoachLink(link.label)
                    }}
                    onFocus={() => {
                      if (role === "coach") void prefetchCoachLink(link.label)
                    }}
                    onPointerDown={() => {
                      if (role === "coach") void prefetchCoachLink(link.label)
                    }}
                    aria-label={link.label}
                    title={link.label}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 rounded-[20px] px-2 py-2.5 text-[11px] font-medium transition-all duration-200",
                      isActive ? "bg-white text-slate-950 shadow-sm" : "text-white/68 hover:bg-white/[0.06] hover:text-white",
                    )}
                  >
                    <HugeiconsIcon icon={link.icon} className={cn("size-5", isActive ? "text-[#1368ff]" : "text-white/78")} />
                    <span className="truncate">{link.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </nav>
    </div>
  )
}
