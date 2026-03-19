"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  AssignmentsIcon,
  Home01Icon,
  Moon01Icon,
  Notification01Icon,
  PieChartSquareIcon,
  StarAward02Icon,
  Sun01Icon,
  Table03Icon,
  TextCreationIcon,
  UserGroupIcon,
  UserStoryIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import type React from "react"
import { useTheme } from "next-themes"
import { getCoachScope } from "@/lib/coach-scope"
import { cn } from "@/lib/utils"
import { useRole } from "@/lib/role-context"
import { clearSessionCookies } from "@/lib/auth-session"
import {
  MOCK_COACH_TEAM_STORAGE_KEY,
  MOCK_ROLE_STORAGE_KEY,
  MOCK_USER_EMAIL_STORAGE_KEY,
} from "@/lib/mock-auth"
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
]

function getRoleLabel(role: string) {
  if (role === "club-admin") return "Club Admin"
  if (role === "coach") return "Coach"
  return "Athlete"
}

function getProfileImage(role: string) {
  if (role === "coach") return "/coach-avatar.png"
  if (role === "athlete") return "/avatar-placeholder.svg"
  return "/avatar-placeholder.svg"
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { role } = useRole()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const [mobileDetailMode, setMobileDetailMode] = useState(false)
  const useSectionBoundTopTone =
    pathname.startsWith("/coach/dashboard") ||
    pathname.startsWith("/coach/teams") ||
    pathname.startsWith("/coach/athletes") ||
    pathname.startsWith("/coach/training-plan") ||
    pathname.startsWith("/coach/test-week") ||
    pathname.startsWith("/coach/reports")

  const coachTeamsHref = useMemo(() => {
    if (role !== "coach" || typeof window === "undefined") return "/coach/teams"
    const coachScope = getCoachScope(role)
    const coachTeamId = window.localStorage.getItem(MOCK_COACH_TEAM_STORAGE_KEY) ?? coachScope.teamId

    if (coachScope.isScopedCoach && !coachScope.allowTeamSwitcher && coachTeamId) {
      return `/coach/teams/${coachTeamId}`
    }

    return "/coach/teams"
  }, [role])

  const links = useMemo(() => {
    if (role === "athlete") return athleteLinks
    if (role === "coach") {
      return coachLinks.map((link) => (link.href === "/coach/teams" ? { ...link, href: coachTeamsHref } : link))
    }
    return clubAdminLinks
  }, [coachTeamsHref, role])

  const activeLink = links.find((link) => pathname.startsWith(link.href)) ?? links[0]
  const isDark = resolvedTheme === "dark"
  const toggleTheme = () => setTheme(isDark ? "light" : "dark")
  const userEmail = typeof window === "undefined" ? "clubadmin@pacelab.local" : window.localStorage.getItem(MOCK_USER_EMAIL_STORAGE_KEY) ?? "clubadmin@pacelab.local"
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

  const handleSignOut = () => {
    window.localStorage.removeItem(MOCK_ROLE_STORAGE_KEY)
    window.localStorage.removeItem(MOCK_USER_EMAIL_STORAGE_KEY)
    window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
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
          <div className="flex size-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] shadow-[0_12px_40px_rgba(31,140,255,0.35)]">
            <HugeiconsIcon icon={ZapIcon} className="size-5 text-white" />
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
            onClick={handleSignOut}
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
                      <div className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-[#678c26]" />
                        <p className="truncate text-[15px] font-medium text-slate-950">{getRoleLabel(role)}</p>
                      </div>
                    </div>
                  </div>
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
                      <DropdownMenuItem>Settings</DropdownMenuItem>
                      <DropdownMenuItem onSelect={handleSignOut}>Sign out</DropdownMenuItem>
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
                    <Button variant="ghost" size="icon" className="relative size-14 rounded-[24px] border border-slate-200/70 bg-white/95 text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.08)] hover:bg-white lg:size-8 lg:rounded-full lg:border-white/10 lg:bg-white/[0.04] lg:text-white lg:shadow-none lg:hover:bg-white/[0.1]" aria-label="Notifications">
                      <HugeiconsIcon icon={Notification01Icon} className="size-3.5" />
                      <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[#ff6a55]" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" showCloseButton={false} className="w-full border-l-slate-200 bg-white sm:max-w-md">
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
                    <div className="space-y-3 p-4">
                      <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                        <p className="text-sm font-medium text-slate-950">No new notifications</p>
                        <p className="text-xs text-slate-500">You are all caught up.</p>
                      </div>
                    </div>
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
                    <DropdownMenuItem>Settings</DropdownMenuItem>
                    <DropdownMenuItem onSelect={handleSignOut}>Sign out</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </header>

        <main
          id="main-content"
          className={cn("flex-1 overflow-y-auto lg:pb-0", mobileDetailMode ? "pb-6" : "pb-28")}
        >
          <div className="min-h-full rounded-t-none bg-transparent lg:rounded-t-[40px]">{children}</div>
        </main>
      </div>

      <nav className={cn("fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden", mobileDetailMode && "hidden")}>
        <div className="mx-auto max-w-md rounded-[28px] border border-white/12 bg-[linear-gradient(135deg,rgba(7,17,34,0.94)_0%,rgba(9,20,39,0.92)_100%)] px-2 py-2 shadow-[0_20px_60px_rgba(5,12,24,0.34)] backdrop-blur-xl">
          <div className="grid grid-cols-5 gap-1">
            {links.map((link) => {
              const isActive = pathname.startsWith(link.href)
              return (
                <Link
                  key={link.href}
                  to={link.href}
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
      </nav>
    </div>
  )
}
