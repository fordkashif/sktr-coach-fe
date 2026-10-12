import { lazyPage } from "@/router/lazy-page"

/*
 * The screens in the athlete and coach tab bars. The router shows them, the background loader
 * (src/router/preload-tabs.ts) and the desktop tab bar's hover (src/components/app-shell.tsx) load
 * them early. They share these objects, so a screen loaded early opens without a loading screen.
 */
export const AthleteHomePage = lazyPage(() => import("@/app/(authenticated)/athlete/home/page"))
export const AthleteLogPage = lazyPage(() => import("@/app/(authenticated)/athlete/log/page"))
export const AthleteProfilePage = lazyPage(() => import("@/app/(authenticated)/athlete/profile/page"))
export const AthleteTrainingPlanPage = lazyPage(() => import("@/app/(authenticated)/athlete/training-plan/page"))
export const AthleteTrendsPage = lazyPage(() => import("@/app/(authenticated)/athlete/trends/page"))
export const AthleteMessagesPage = lazyPage(() => import("@/app/(authenticated)/athlete/messages/page"))
export const CoachDashboardPage = lazyPage(() => import("@/app/(authenticated)/coach/dashboard/page"))
export const CoachReportsPage = lazyPage(() => import("@/app/(authenticated)/coach/reports/page"))
export const CoachTeamsPage = lazyPage(() => import("@/app/(authenticated)/coach/teams/page"))
export const CoachTeamDetailPage = lazyPage(() => import("@/app/(authenticated)/coach/teams/[teamId]/page"))
export const CoachTestWeekPage = lazyPage(() => import("@/app/(authenticated)/coach/test-week/page"))
export const CoachTrainingPlanPage = lazyPage(() => import("@/app/(authenticated)/coach/training-plan/page"))
export const CoachCompetitionsPage = lazyPage(() => import("@/app/(authenticated)/coach/competitions/page"))
export const CoachMessagesPage = lazyPage(() => import("@/app/(authenticated)/coach/messages/page"))
