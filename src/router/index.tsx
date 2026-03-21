import { Route, Routes } from "react-router-dom"
import { RootLayout } from "@/layouts/root-layout"
import { AuthLayout } from "@/layouts/auth-layout"
import { AuthenticatedLayout } from "@/layouts/authenticated-layout"
import { GuardedAuthenticatedLayout } from "@/router/guards"
import { RootRedirectPage } from "@/pages/redirects/root-redirect"
import { InviteRedirectPage } from "@/pages/redirects/invite-redirect"
import { ClubAdminRedirectPage } from "@/pages/redirects/club-admin-redirect"
import { NotFoundPage } from "@/pages/not-found"
import LoginPage from "@/app/(auth)/login/page"
import CreateClubAccountPage from "@/app/(auth)/create-club-account/page"
import CoachInviteAcceptPage from "@/app/(auth)/invite/coach/[inviteId]/page"
import AthleteHomePage from "@/app/(authenticated)/athlete/home/page"
import AthleteJoinTeamPage from "@/app/(authenticated)/athlete/join/page"
import AthleteJoinTeamCodePage from "@/app/(authenticated)/athlete/join/[code]/page"
import AthleteLogPage from "@/app/(authenticated)/athlete/log/page"
import AthleteProfilePage from "@/app/(authenticated)/athlete/profile/page"
import AthletePrsPage from "@/app/(authenticated)/athlete/prs/page"
import AthleteTestWeekPage from "@/app/(authenticated)/athlete/test-week/page"
import AthleteTrainingPlanPage from "@/app/(authenticated)/athlete/training-plan/page"
import AthleteTrendsPage from "@/app/(authenticated)/athlete/trends/page"
import AthleteWellnessPage from "@/app/(authenticated)/athlete/wellness/page"
import CoachDashboardPage from "@/app/(authenticated)/coach/dashboard/page"
import CoachReportsPage from "@/app/(authenticated)/coach/reports/page"
import CoachTeamsPage from "@/app/(authenticated)/coach/teams/page"
import CoachTeamDetailPage from "@/app/(authenticated)/coach/teams/[teamId]/page"
import CoachTestWeekPage from "@/app/(authenticated)/coach/test-week/page"
import CoachTrainingPlanPage from "@/app/(authenticated)/coach/training-plan/page"
import CoachAthleteDetailPage from "@/app/(authenticated)/coach/athletes/[athleteId]/page"
import ClubAdminDashboardPage from "@/app/(authenticated)/club-admin/dashboard/page"
import ClubAdminProfilePage from "@/app/(authenticated)/club-admin/profile/page"
import ClubAdminUsersPage from "@/app/(authenticated)/club-admin/users/page"
import ClubAdminTeamsPage from "@/app/(authenticated)/club-admin/teams/page"
import ClubAdminReportsPage from "@/app/(authenticated)/club-admin/reports/page"
import ClubAdminBillingPage from "@/app/(authenticated)/club-admin/billing/page"
import ClubAdminAuditPage from "@/app/(authenticated)/club-admin/audit/page"

export function AppRouter() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route path="/" element={<RootRedirectPage />} />
        <Route path="/invite/:code" element={<InviteRedirectPage />} />

        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/create-club-account" element={<CreateClubAccountPage />} />
          <Route path="/invite/coach/:inviteId" element={<CoachInviteAcceptPage />} />
        </Route>

        <Route element={<GuardedAuthenticatedLayout />}>
          <Route element={<AuthenticatedLayout />}>
            <Route path="/athlete/home" element={<AthleteHomePage />} />
            <Route path="/athlete/join" element={<AthleteJoinTeamPage />} />
            <Route path="/athlete/join/:code" element={<AthleteJoinTeamCodePage />} />
            <Route path="/athlete/log" element={<AthleteLogPage />} />
            <Route path="/athlete/profile" element={<AthleteProfilePage />} />
            <Route path="/athlete/prs" element={<AthletePrsPage />} />
            <Route path="/athlete/test-week" element={<AthleteTestWeekPage />} />
            <Route path="/athlete/training-plan" element={<AthleteTrainingPlanPage />} />
            <Route path="/athlete/trends" element={<AthleteTrendsPage />} />
            <Route path="/athlete/wellness" element={<AthleteWellnessPage />} />

            <Route path="/coach/dashboard" element={<CoachDashboardPage />} />
            <Route path="/coach/reports" element={<CoachReportsPage />} />
            <Route path="/coach/teams" element={<CoachTeamsPage />} />
            <Route path="/coach/teams/:teamId" element={<CoachTeamDetailPage />} />
            <Route path="/coach/test-week" element={<CoachTestWeekPage />} />
            <Route path="/coach/training-plan" element={<CoachTrainingPlanPage />} />
            <Route path="/coach/athletes/:athleteId" element={<CoachAthleteDetailPage />} />

            <Route path="/club-admin" element={<ClubAdminRedirectPage />} />
            <Route path="/club-admin/dashboard" element={<ClubAdminDashboardPage />} />
            <Route path="/club-admin/profile" element={<ClubAdminProfilePage />} />
            <Route path="/club-admin/users" element={<ClubAdminUsersPage />} />
            <Route path="/club-admin/teams" element={<ClubAdminTeamsPage />} />
            <Route path="/club-admin/reports" element={<ClubAdminReportsPage />} />
            <Route path="/club-admin/billing" element={<ClubAdminBillingPage />} />
            <Route path="/club-admin/audit" element={<ClubAdminAuditPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
