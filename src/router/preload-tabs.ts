import { whenDatabaseQuiet } from "@/lib/supabase/in-flight"
import {
  AthleteHomePage,
  AthleteLogPage,
  AthleteMessagesPage,
  AthleteProfilePage,
  AthleteTrainingPlanPage,
  AthleteTrendsPage,
  ClubAdminDashboardPage,
  ClubAdminReportsPage,
  ClubAdminTeamsPage,
  ClubAdminUsersPage,
  CoachCompetitionsPage,
  CoachDashboardPage,
  CoachMessagesPage,
  CoachReportsPage,
  CoachTeamDetailPage,
  CoachTeamsPage,
  CoachTestWeekPage,
  CoachTrainingPlanPage,
} from "@/router/tab-pages"

/**
 * Each screen's code is downloaded the first time it is opened. On a phone that is a wait the
 * person notices on every new tab (the Progress tab brings the chart library, about 120 KB; a
 * coach tab was 15 to 17 files). On a computer the coach tabs already load on hover, but a phone
 * has no hover. So once the app is open and the phone is idle, fetch the code of the screens in
 * the tab bar, so the first tap on a tab only waits for its data. Same imports as the router
 * (src/router/tab-pages.ts), so a screen loaded here opens with no loading screen at all.
 */
/** The search dialog (opened from the frame on every screen) is fetched with the tabs. */
function preloadSearch() {
  return import("@/components/search/global-search")
}

const ATHLETE_TAB_PAGES = [
  AthleteHomePage.preload,
  AthleteTrainingPlanPage.preload,
  AthleteLogPage.preload,
  AthleteTrendsPage.preload,
  AthleteProfilePage.preload,
  AthleteMessagesPage.preload,
  preloadSearch,
]

/** The plans screen loads its builder in a second step: load both. */
export function preloadCoachPlans() {
  return CoachTrainingPlanPage.preload().then((module) => (module as { preloadPlanBuilder?: () => Promise<unknown> }).preloadPlanBuilder?.())
}

const COACH_TAB_PAGES = [
  CoachDashboardPage.preload,
  CoachTeamDetailPage.preload,
  CoachTeamsPage.preload,
  preloadCoachPlans,
  CoachMessagesPage.preload,
  CoachTestWeekPage.preload,
  CoachCompetitionsPage.preload,
  CoachReportsPage.preload,
  preloadSearch,
]

const CLUB_ADMIN_TAB_PAGES = [ClubAdminDashboardPage.preload, ClubAdminUsersPage.preload, ClubAdminTeamsPage.preload, ClubAdminReportsPage.preload, preloadSearch]

const started = new Set<string>()

function whenIdle(run: () => void) {
  if (typeof window === "undefined") return
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
  // First let the screen's own data arrive: on a phone, code downloads started while it is on its
  // way compete with it for the connection and the screen waits longer.
  void whenDatabaseQuiet().then(() => {
    if (idle) idle(run, { timeout: 4000 })
    else window.setTimeout(run, 500)
  })
}

function preload(key: string, pages: Array<() => Promise<unknown>>) {
  if (started.has(key)) return
  started.add(key)
  // Respect "Data saver" on phones that report it.
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (connection?.saveData) return
  whenIdle(() => {
    void pages.reduce<Promise<unknown>>((previous, load) => previous.then(() => load().catch(() => undefined)), Promise.resolve())
  })
}

/** Fetches the athlete tab screens' code in the background, one after another, once per visit. */
export function preloadAthleteTabs() {
  preload("athlete", ATHLETE_TAB_PAGES)
}

/** Fetches the club admin tab screens' code in the background, one after another, once per visit. */
export function preloadClubAdminTabs() {
  preload("club-admin", CLUB_ADMIN_TAB_PAGES)
}

/** Fetches the coach tab screens' code in the background, one after another, once per visit. */
export function preloadCoachTabs() {
  preload("coach", COACH_TAB_PAGES)
}
