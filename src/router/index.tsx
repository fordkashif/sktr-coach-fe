import { lazy, Suspense, type ComponentType } from "react"
import { Route, Routes } from "react-router-dom"
import { RootLayout } from "@/layouts/root-layout"
import { AuthLayout } from "@/layouts/auth-layout"
import { AuthenticatedLayout } from "@/layouts/authenticated-layout"
import { GuardedAuthenticatedLayout } from "@/router/guards"
import { RootRedirectPage } from "@/pages/redirects/root-redirect"
import { InviteRedirectPage } from "@/pages/redirects/invite-redirect"
import { ClubAdminRedirectPage } from "@/pages/redirects/club-admin-redirect"
import { PlatformAdminRedirectPage } from "@/pages/redirects/platform-admin-redirect"
import { NotFoundPage } from "@/pages/not-found"
import LoginPage from "@/app/(auth)/login/page"
import AthleteClaimPage from "@/app/(auth)/athlete/claim/[inviteId]/page"
import ClubAdminClaimPage from "@/app/(auth)/club-admin/claim/page"
import CreateClubAccountPage from "@/app/(auth)/create-club-account/page"
import CoachInviteAcceptPage from "@/app/(auth)/invite/coach/[inviteId]/page"
const AthleteHomePage = lazy(() => import("@/app/(authenticated)/athlete/home/page"))
const AthleteJoinTeamPage = lazy(() => import("@/app/(authenticated)/athlete/join/page"))
const AthleteJoinTeamCodePage = lazy(() => import("@/app/(authenticated)/athlete/join/[code]/page"))
const AthleteLogPage = lazy(() => import("@/app/(authenticated)/athlete/log/page"))
const AthleteProfilePage = lazy(() => import("@/app/(authenticated)/athlete/profile/page"))
const AthletePrsPage = lazy(() => import("@/app/(authenticated)/athlete/prs/page"))
const AthleteTestWeekPage = lazy(() => import("@/app/(authenticated)/athlete/test-week/page"))
const AthleteTrainingPlanPage = lazy(() => import("@/app/(authenticated)/athlete/training-plan/page"))
const AthleteTrendsPage = lazy(() => import("@/app/(authenticated)/athlete/trends/page"))
const AthleteWellnessPage = lazy(() => import("@/app/(authenticated)/athlete/wellness/page"))
const CoachDashboardPage = lazy(() => import("@/app/(authenticated)/coach/dashboard/page"))
const CoachReportsPage = lazy(() => import("@/app/(authenticated)/coach/reports/page"))
const CoachTeamsPage = lazy(() => import("@/app/(authenticated)/coach/teams/page"))
const CoachTeamDetailPage = lazy(() => import("@/app/(authenticated)/coach/teams/[teamId]/page"))
const CoachTestWeekPage = lazy(() => import("@/app/(authenticated)/coach/test-week/page"))
const CoachTrainingPlanPage = lazy(() => import("@/app/(authenticated)/coach/training-plan/page"))
const CoachAthleteDetailPage = lazy(() => import("@/app/(authenticated)/coach/athletes/[athleteId]/page"))
const ClubAdminDashboardPage = lazy(() => import("@/app/(authenticated)/club-admin/dashboard/page"))
const ClubAdminGetStartedPage = lazy(() => import("@/app/(authenticated)/club-admin/get-started/page"))
const ClubAdminProfilePage = lazy(() => import("@/app/(authenticated)/club-admin/profile/page"))
const ClubAdminUsersPage = lazy(() => import("@/app/(authenticated)/club-admin/users/page"))
const ClubAdminTeamsPage = lazy(() => import("@/app/(authenticated)/club-admin/teams/page"))
const ClubAdminReportsPage = lazy(() => import("@/app/(authenticated)/club-admin/reports/page"))
const ClubAdminBillingPage = lazy(() => import("@/app/(authenticated)/club-admin/billing/page"))
const ClubAdminAuditPage = lazy(() => import("@/app/(authenticated)/club-admin/audit/page"))
const PlatformAdminRequestsPage = lazy(() => import("@/app/(authenticated)/platform-admin/requests/page"))
const PlatformAdminAuditPage = lazy(() => import("@/app/(authenticated)/platform-admin/audit/page"))
const PlatformAdminDashboardPage = lazy(() => import("@/app/(authenticated)/platform-admin/dashboard/page"))
const NotificationSettingsPage = lazy(() => import("@/app/(authenticated)/settings/notifications/page"))

function routeElement(Component: ComponentType) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-8xl p-4 text-sm text-slate-500 sm:p-6">
          Loading...
        </div>
      }
    >
      <Component />
    </Suspense>
  )
}

export function AppRouter() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route path="/" element={<RootRedirectPage />} />
        <Route path="/invite/:code" element={<InviteRedirectPage />} />

        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/athlete/claim/:inviteId" element={<AthleteClaimPage />} />
          <Route path="/club-admin/claim" element={<ClubAdminClaimPage />} />
          <Route path="/create-club-account" element={<CreateClubAccountPage />} />
          <Route path="/invite/coach/:inviteId" element={<CoachInviteAcceptPage />} />
        </Route>

        <Route element={<GuardedAuthenticatedLayout />}>
          <Route element={<AuthenticatedLayout />}>
            <Route path="/athlete/home" element={routeElement(AthleteHomePage)} />
            <Route path="/athlete/join" element={routeElement(AthleteJoinTeamPage)} />
            <Route path="/athlete/join/:code" element={routeElement(AthleteJoinTeamCodePage)} />
            <Route path="/athlete/log" element={routeElement(AthleteLogPage)} />
            <Route path="/athlete/profile" element={routeElement(AthleteProfilePage)} />
            <Route path="/athlete/prs" element={routeElement(AthletePrsPage)} />
            <Route path="/athlete/test-week" element={routeElement(AthleteTestWeekPage)} />
            <Route path="/athlete/training-plan" element={routeElement(AthleteTrainingPlanPage)} />
            <Route path="/athlete/trends" element={routeElement(AthleteTrendsPage)} />
            <Route path="/athlete/wellness" element={routeElement(AthleteWellnessPage)} />

            <Route path="/coach/dashboard" element={routeElement(CoachDashboardPage)} />
            <Route path="/coach/reports" element={routeElement(CoachReportsPage)} />
            <Route path="/coach/teams" element={routeElement(CoachTeamsPage)} />
            <Route path="/coach/teams/:teamId" element={routeElement(CoachTeamDetailPage)} />
            <Route path="/coach/test-week" element={routeElement(CoachTestWeekPage)} />
            <Route path="/coach/training-plan" element={routeElement(CoachTrainingPlanPage)} />
            <Route path="/coach/athletes/:athleteId" element={routeElement(CoachAthleteDetailPage)} />

            <Route path="/club-admin" element={<ClubAdminRedirectPage />} />
            <Route path="/club-admin/get-started" element={routeElement(ClubAdminGetStartedPage)} />
            <Route path="/club-admin/dashboard" element={routeElement(ClubAdminDashboardPage)} />
            <Route path="/club-admin/profile" element={routeElement(ClubAdminProfilePage)} />
            <Route path="/club-admin/users" element={routeElement(ClubAdminUsersPage)} />
            <Route path="/club-admin/teams" element={routeElement(ClubAdminTeamsPage)} />
            <Route path="/club-admin/reports" element={routeElement(ClubAdminReportsPage)} />
            <Route path="/club-admin/audit" element={routeElement(ClubAdminAuditPage)} />
            <Route path="/club-admin/billing" element={routeElement(ClubAdminBillingPage)} />

            <Route path="/platform-admin" element={<PlatformAdminRedirectPage />} />
            <Route path="/platform-admin/dashboard" element={routeElement(PlatformAdminDashboardPage)} />
            <Route path="/platform-admin/requests" element={routeElement(PlatformAdminRequestsPage)} />
            <Route path="/platform-admin/audit" element={routeElement(PlatformAdminAuditPage)} />

            <Route path="/settings/notifications" element={routeElement(NotificationSettingsPage)} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
