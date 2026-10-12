import {
  AthleteHomePage,
  AthleteLogPage,
  AthleteMessagesPage,
  AthleteProfilePage,
  AthleteTrainingPlanPage,
  AthleteTrendsPage,
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
const ATHLETE_TAB_PAGES = [
  AthleteHomePage.preload,
  AthleteTrainingPlanPage.preload,
  AthleteLogPage.preload,
  AthleteTrendsPage.preload,
  AthleteProfilePage.preload,
  AthleteMessagesPage.preload,
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
]

const started = new Set<string>()

function whenIdle(run: () => void) {
  if (typeof window === "undefined") return
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
  if (idle) idle(run, { timeout: 4000 })
  else window.setTimeout(run, 2000)
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

/** Fetches the coach tab screens' code in the background, one after another, once per visit. */
export function preloadCoachTabs() {
  preload("coach", COACH_TAB_PAGES)
}
