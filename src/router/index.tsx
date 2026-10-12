import { Suspense, type ComponentType } from "react"
import { lazyPage } from "@/router/lazy-page"
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
import { Navigate, Route, Routes } from "react-router-dom"
import { ScreenSkeleton } from "@/components/sk"
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
// Opened from an email link or a code, not on a normal visit: loaded when needed.
const ResetPasswordPage = lazyPage(() => import("@/app/(auth)/reset-password/page"))
const AthleteClaimPage = lazyPage(() => import("@/app/(auth)/athlete/claim/[inviteId]/page"))
const ClubAdminClaimPage = lazyPage(() => import("@/app/(auth)/club-admin/claim/page"))
const CreateClubAccountPage = lazyPage(() => import("@/app/(auth)/create-club-account/page"))
const CoachInviteAcceptPage = lazyPage(() => import("@/app/(auth)/invite/coach/[inviteId]/page"))
const TeamJoinCodePage = lazyPage(() => import("@/app/(auth)/join/[code]/page"))
const GuardianClaimPage = lazyPage(() => import("@/app/(auth)/guardian/claim/[inviteId]/page"))
import { AssistantGate, type AssistantGateNeed } from "@/components/coach/assistant-gate"
const GuardianHomePage = lazyPage(() => import("@/app/(authenticated)/guardian/home/page"))
const GuardianPlanPage = lazyPage(() => import("@/app/(authenticated)/guardian/plan/page"))
const GuardianResultsPage = lazyPage(() => import("@/app/(authenticated)/guardian/results/page"))
const GuardianReportPage = lazyPage(() => import("@/app/(authenticated)/guardian/reports/[reportId]/page"))
const GuardianHealthPage = lazyPage(() => import("@/app/(authenticated)/guardian/health/page"))
const GuardianCalendarPage = lazyPage(() => import("@/app/(authenticated)/guardian/calendar/page"))
const GuardianNewsPage = lazyPage(() => import("@/app/(authenticated)/guardian/news/page"))
const GuardianContactPage = lazyPage(() => import("@/app/(authenticated)/guardian/contact/page"))
const AthleteJoinTeamPage = lazyPage(() => import("@/app/(authenticated)/athlete/join/page"))
const AthleteJoinTeamCodePage = lazyPage(() => import("@/app/(authenticated)/athlete/join/[code]/page"))
const AthleteAddSessionPage = lazyPage(() => import("@/app/(authenticated)/athlete/log/new/page"))
const AthleteHistoryPage = lazyPage(() => import("@/app/(authenticated)/athlete/history/page"))
const AthleteGoalsPage = lazyPage(() => import("@/app/(authenticated)/athlete/goals/page"))
const AthletePrsPage = lazyPage(() => import("@/app/(authenticated)/athlete/prs/page"))
const AthleteAddResultPage = lazyPage(() => import("@/app/(authenticated)/athlete/prs/add/page"))
const AthleteEditResultPage = lazyPage(() => import("@/app/(authenticated)/athlete/prs/edit/[resultId]/page"))
const AthleteEventHistoryPage = lazyPage(() => import("@/app/(authenticated)/athlete/prs/event/[eventGroup]/page"))
const AthleteCompetitionsPage = lazyPage(() => import("@/app/(authenticated)/athlete/competitions/page"))
const AthleteNewCompetitionPage = lazyPage(() => import("@/app/(authenticated)/athlete/competitions/new/page"))
const AthleteCompetitionDetailPage = lazyPage(() => import("@/app/(authenticated)/athlete/competitions/[competitionId]/page"))
const AthleteEditCompetitionPage = lazyPage(() => import("@/app/(authenticated)/athlete/competitions/[competitionId]/edit/page"))
const AthleteTestWeekPage = lazyPage(() => import("@/app/(authenticated)/athlete/test-week/page"))
const AthleteTestWeekHistoryPage = lazyPage(() => import("@/app/(authenticated)/athlete/test-week/history/page"))
const AthleteWellnessPage = lazyPage(() => import("@/app/(authenticated)/athlete/wellness/page"))
const AthleteWellnessHistoryPage = lazyPage(() => import("@/app/(authenticated)/athlete/wellness/history/page"))
const AthletePainReportPage = lazyPage(() => import("@/app/(authenticated)/athlete/wellness/pain/page"))
const AthleteMessageThreadPage = lazyPage(() => import("@/app/(authenticated)/athlete/messages/t/[threadId]/page"))
const AthleteMessageCoachPage = lazyPage(() => import("@/app/(authenticated)/athlete/messages/coach/[coachUserId]/page"))
const AthleteAnnouncementPage = lazyPage(() => import("@/app/(authenticated)/athlete/messages/a/[announcementId]/page"))
const CoachLoadPage = lazyPage(() => import("@/app/(authenticated)/coach/reports/load/page"))
const CoachExercisesPage = lazyPage(() => import("@/app/(authenticated)/coach/training-plan/exercises/page"))
const CoachPlanTemplatesPage = lazyPage(() => import("@/app/(authenticated)/coach/training-plan/templates/page"))
const CoachLiftMaxesPage = lazyPage(() => import("@/app/(authenticated)/coach/training-plan/maxes/page"))
const CoachTeamCalendarPage = lazyPage(() => import("@/app/(authenticated)/coach/training-plan/calendar/page"))
const ClubAdminCalendarPage = lazyPage(() => import("@/app/(authenticated)/club-admin/calendar/page"))
const CoachAthleteDetailPage = lazyPage(() => import("@/app/(authenticated)/coach/athletes/[athleteId]/page"))
const CoachLogForAthletePage = lazyPage(() => import("@/app/(authenticated)/coach/athletes/[athleteId]/log/page"))
const CoachTeamAttendancePage = lazyPage(() => import("@/app/(authenticated)/coach/teams/[teamId]/attendance/page"))
const CoachAddAthleteResultPage = lazyPage(() => import("@/app/(authenticated)/coach/athletes/[athleteId]/results/new/page"))
const CoachEditAthleteResultPage = lazyPage(() => import("@/app/(authenticated)/coach/athletes/[athleteId]/results/[resultId]/page"))
const CoachNewCompetitionPage = lazyPage(() => import("@/app/(authenticated)/coach/competitions/new/page"))
const CoachCompetitionDetailPage = lazyPage(() => import("@/app/(authenticated)/coach/competitions/[competitionId]/page"))
const CoachEditCompetitionPage = lazyPage(() => import("@/app/(authenticated)/coach/competitions/[competitionId]/edit/page"))
const CoachEnterAthletesPage = lazyPage(() => import("@/app/(authenticated)/coach/competitions/[competitionId]/enter/page"))
const CoachMessageThreadPage = lazyPage(() => import("@/app/(authenticated)/coach/messages/t/[threadId]/page"))
const CoachMessageAthletePage = lazyPage(() => import("@/app/(authenticated)/coach/messages/with/[athleteId]/page"))
const CoachNewAnnouncementPage = lazyPage(() => import("@/app/(authenticated)/coach/messages/a/new/page"))
const CoachAnnouncementPage = lazyPage(() => import("@/app/(authenticated)/coach/messages/a/[announcementId]/page"))
const ClubAdminDashboardPage = lazyPage(() => import("@/app/(authenticated)/club-admin/dashboard/page"))
const ClubAdminGetStartedPage = lazyPage(() => import("@/app/(authenticated)/club-admin/get-started/page"))
const ClubAdminBillingSetupPage = lazyPage(() => import("@/app/(authenticated)/club-admin/setup/billing/page"))
const ClubAdminProfilePage = lazyPage(() => import("@/app/(authenticated)/club-admin/profile/page"))
const ClubAdminSeasonsPage = lazyPage(() => import("@/app/(authenticated)/club-admin/seasons/page"))
const ClubAdminStartSeasonPage = lazyPage(() => import("@/app/(authenticated)/club-admin/seasons/start/page"))
const ClubAdminUsersPage = lazyPage(() => import("@/app/(authenticated)/club-admin/users/page"))
const ClubAdminTeamsPage = lazyPage(() => import("@/app/(authenticated)/club-admin/teams/page"))
const ClubAdminReportsPage = lazyPage(() => import("@/app/(authenticated)/club-admin/reports/page"))
const ClubAdminBillingPage = lazyPage(() => import("@/app/(authenticated)/club-admin/billing/page"))
const ClubAdminAuditPage = lazyPage(() => import("@/app/(authenticated)/club-admin/audit/page"))
const ClubAdminMessagesPage = lazyPage(() => import("@/app/(authenticated)/club-admin/messages/page"))
const ClubAdminMessageThreadPage = lazyPage(() => import("@/app/(authenticated)/club-admin/messages/t/[threadId]/page"))
const ClubAdminNewAnnouncementPage = lazyPage(() => import("@/app/(authenticated)/club-admin/messages/a/new/page"))
const ClubAdminAnnouncementPage = lazyPage(() => import("@/app/(authenticated)/club-admin/messages/a/[announcementId]/page"))
const PlatformAdminRequestsPage = lazyPage(() => import("@/app/(authenticated)/platform-admin/requests/page"))
const PlatformAdminTenantsPage = lazyPage(() => import("@/app/(authenticated)/platform-admin/tenants/page"))
const PlatformAdminBillingPage = lazyPage(() => import("@/app/(authenticated)/platform-admin/billing/page"))
const PlatformAdminCommercialPage = lazyPage(() => import("@/app/(authenticated)/platform-admin/commercial/page"))
const PlatformAdminAuditPage = lazyPage(() => import("@/app/(authenticated)/platform-admin/audit/page"))
const PlatformAdminDashboardPage = lazyPage(() => import("@/app/(authenticated)/platform-admin/dashboard/page"))
const PlatformAdminUsagePage = lazyPage(() => import("@/app/(authenticated)/platform-admin/usage/page"))
const PlatformAdminStatusPage = lazyPage(() => import("@/app/(authenticated)/platform-admin/status/page"))
const PlatformAdminNoticesPage = lazyPage(() => import("@/app/(authenticated)/platform-admin/notices/page"))
const PlatformAdminAdminsPage = lazyPage(() => import("@/app/(authenticated)/platform-admin/admins/page"))
const PlatformAdminClubOverviewPage = lazyPage(() => import("@/app/(authenticated)/platform-admin/club/page"))
const AccountPage = lazyPage(() => import("@/app/(authenticated)/account/page"))
const NotificationSettingsPage = lazyPage(() => import("@/app/(authenticated)/settings/notifications/page"))
const NotificationsPage = lazyPage(() => import("@/app/(authenticated)/notifications/page"))
const PrivacyPage = lazyPage(() => import("@/app/(public)/privacy/page"))
const SharedReportPage = lazyPage(() => import("@/app/(public)/shared-report/page"))
const CoachCreateAthleteReportPage = lazyPage(() => import("@/app/(authenticated)/coach/athletes/[athleteId]/report/page"))
const CoachAthleteReportPage = lazyPage(() => import("@/app/(authenticated)/coach/athletes/[athleteId]/report/[reportId]/page"))
const AthleteReportPage = lazyPage(() => import("@/app/(authenticated)/athlete/reports/[reportId]/page"))
const TermsPage = lazyPage(() => import("@/app/(public)/terms/page"))

function routeElement(Component: ComponentType) {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <Component />
    </Suspense>
  )
}

/** A coach screen an assistant coach may not use: they get a plain "this is with the lead coach" screen instead. */
function gatedRouteElement(Component: ComponentType, need: AssistantGateNeed) {
  return <AssistantGate need={need}>{routeElement(Component)}</AssistantGate>
}

export function AppRouter() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route path="/" element={<RootRedirectPage />} />
        <Route path="/invite/:code" element={<InviteRedirectPage />} />

        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={routeElement(ResetPasswordPage)} />
          <Route path="/athlete/claim/:inviteId" element={routeElement(AthleteClaimPage)} />
          <Route path="/club-admin/claim" element={routeElement(ClubAdminClaimPage)} />
          <Route path="/create-club-account" element={routeElement(CreateClubAccountPage)} />
          <Route path="/privacy" element={routeElement(PrivacyPage)} />
          <Route path="/shared/report" element={routeElement(SharedReportPage)} />
          <Route path="/terms" element={routeElement(TermsPage)} />
          <Route path="/invite/coach/:inviteId" element={routeElement(CoachInviteAcceptPage)} />
          <Route path="/join/:code" element={routeElement(TeamJoinCodePage)} />
          <Route path="/guardian/claim/:inviteId" element={routeElement(GuardianClaimPage)} />
        </Route>

        <Route element={<GuardedAuthenticatedLayout />}>
          <Route element={<AuthenticatedLayout />}>
            <Route path="/athlete/home" element={routeElement(AthleteHomePage)} />
            <Route path="/athlete/join" element={routeElement(AthleteJoinTeamPage)} />
            <Route path="/athlete/join/:code" element={routeElement(AthleteJoinTeamCodePage)} />
            <Route path="/athlete/log" element={routeElement(AthleteLogPage)} />
            <Route path="/athlete/log/history" element={<Navigate to="/athlete/history" replace />} />
            <Route path="/athlete/log/new" element={routeElement(AthleteAddSessionPage)} />
            <Route path="/athlete/history" element={routeElement(AthleteHistoryPage)} />
            <Route path="/athlete/goals" element={routeElement(AthleteGoalsPage)} />
            <Route path="/athlete/profile" element={routeElement(AthleteProfilePage)} />
            <Route path="/athlete/prs" element={routeElement(AthletePrsPage)} />
            <Route path="/athlete/prs/add" element={routeElement(AthleteAddResultPage)} />
            <Route path="/athlete/prs/edit/:resultId" element={routeElement(AthleteEditResultPage)} />
            <Route path="/athlete/prs/event/:eventGroup" element={routeElement(AthleteEventHistoryPage)} />
            <Route path="/athlete/competitions" element={routeElement(AthleteCompetitionsPage)} />
            <Route path="/athlete/competitions/new" element={routeElement(AthleteNewCompetitionPage)} />
            <Route path="/athlete/competitions/:competitionId" element={routeElement(AthleteCompetitionDetailPage)} />
            <Route path="/athlete/competitions/:competitionId/edit" element={routeElement(AthleteEditCompetitionPage)} />
            <Route path="/athlete/test-week" element={routeElement(AthleteTestWeekPage)} />
            <Route path="/athlete/test-week/history" element={routeElement(AthleteTestWeekHistoryPage)} />
            <Route path="/athlete/training-plan" element={routeElement(AthleteTrainingPlanPage)} />
            <Route path="/athlete/trends" element={routeElement(AthleteTrendsPage)} />
            <Route path="/athlete/reports/:reportId" element={routeElement(AthleteReportPage)} />
            <Route path="/athlete/wellness" element={routeElement(AthleteWellnessPage)} />
            <Route path="/athlete/wellness/history" element={routeElement(AthleteWellnessHistoryPage)} />
            <Route path="/athlete/wellness/pain" element={routeElement(AthletePainReportPage)} />
            <Route path="/athlete/messages" element={routeElement(AthleteMessagesPage)} />
            <Route path="/athlete/messages/t/:threadId" element={routeElement(AthleteMessageThreadPage)} />
            <Route path="/athlete/messages/coach/:coachUserId" element={routeElement(AthleteMessageCoachPage)} />
            <Route path="/athlete/messages/a/:announcementId" element={routeElement(AthleteAnnouncementPage)} />

            <Route path="/coach/dashboard" element={routeElement(CoachDashboardPage)} />
            <Route path="/coach/reports" element={gatedRouteElement(CoachReportsPage, "reports")} />
            <Route path="/coach/reports/load" element={gatedRouteElement(CoachLoadPage, "reports")} />
            <Route path="/coach/teams" element={routeElement(CoachTeamsPage)} />
            <Route path="/coach/teams/:teamId" element={routeElement(CoachTeamDetailPage)} />
            <Route path="/coach/test-week" element={routeElement(CoachTestWeekPage)} />
            <Route path="/coach/training-plan" element={gatedRouteElement(CoachTrainingPlanPage, "plans")} />
            <Route path="/coach/training-plan/exercises" element={gatedRouteElement(CoachExercisesPage, "club-content")} />
            <Route path="/coach/training-plan/maxes" element={gatedRouteElement(CoachLiftMaxesPage, "athlete-records")} />
            <Route path="/coach/training-plan/templates" element={gatedRouteElement(CoachPlanTemplatesPage, "club-content")} />
            <Route path="/coach/training-plan/calendar" element={gatedRouteElement(CoachTeamCalendarPage, "plans")} />
            <Route path="/coach/athletes/:athleteId" element={routeElement(CoachAthleteDetailPage)} />
            <Route path="/coach/athletes/:athleteId/log" element={routeElement(CoachLogForAthletePage)} />
            <Route path="/coach/athletes/:athleteId/report" element={gatedRouteElement(CoachCreateAthleteReportPage, "reports")} />
            <Route path="/coach/athletes/:athleteId/report/:reportId" element={gatedRouteElement(CoachAthleteReportPage, "reports")} />
            <Route path="/coach/teams/:teamId/attendance" element={routeElement(CoachTeamAttendancePage)} />
            <Route path="/coach/athletes/:athleteId/results/new" element={gatedRouteElement(CoachAddAthleteResultPage, "athlete-records")} />
            <Route path="/coach/athletes/:athleteId/results/:resultId" element={gatedRouteElement(CoachEditAthleteResultPage, "athlete-records")} />
            <Route path="/coach/competitions" element={gatedRouteElement(CoachCompetitionsPage, "athlete-records")} />
            <Route path="/coach/competitions/new" element={gatedRouteElement(CoachNewCompetitionPage, "athlete-records")} />
            <Route path="/coach/competitions/:competitionId" element={gatedRouteElement(CoachCompetitionDetailPage, "athlete-records")} />
            <Route path="/coach/competitions/:competitionId/edit" element={gatedRouteElement(CoachEditCompetitionPage, "athlete-records")} />
            <Route path="/coach/competitions/:competitionId/enter" element={gatedRouteElement(CoachEnterAthletesPage, "athlete-records")} />
            <Route path="/coach/messages" element={routeElement(CoachMessagesPage)} />
            <Route path="/coach/messages/t/:threadId" element={routeElement(CoachMessageThreadPage)} />
            <Route path="/coach/messages/with/:athleteId" element={gatedRouteElement(CoachMessageAthletePage, "messages")} />
            <Route path="/coach/messages/a/new" element={gatedRouteElement(CoachNewAnnouncementPage, "announcements")} />
            <Route path="/coach/messages/a/:announcementId" element={routeElement(CoachAnnouncementPage)} />

            <Route path="/club-admin" element={<ClubAdminRedirectPage />} />
            <Route path="/club-admin/setup/billing" element={routeElement(ClubAdminBillingSetupPage)} />
            <Route path="/club-admin/get-started" element={routeElement(ClubAdminGetStartedPage)} />
            <Route path="/club-admin/dashboard" element={routeElement(ClubAdminDashboardPage)} />
            <Route path="/club-admin/profile" element={routeElement(ClubAdminProfilePage)} />
            <Route path="/club-admin/profile/seasons" element={routeElement(ClubAdminSeasonsPage)} />
            <Route path="/club-admin/profile/seasons/:seasonId/start" element={routeElement(ClubAdminStartSeasonPage)} />
            <Route path="/club-admin/users" element={routeElement(ClubAdminUsersPage)} />
            <Route path="/club-admin/teams" element={routeElement(ClubAdminTeamsPage)} />
            <Route path="/club-admin/reports" element={routeElement(ClubAdminReportsPage)} />
            <Route path="/club-admin/audit" element={routeElement(ClubAdminAuditPage)} />
            <Route path="/club-admin/calendar" element={routeElement(ClubAdminCalendarPage)} />
            <Route path="/club-admin/messages" element={routeElement(ClubAdminMessagesPage)} />
            <Route path="/club-admin/messages/t/:threadId" element={routeElement(ClubAdminMessageThreadPage)} />
            <Route path="/club-admin/messages/a/new" element={routeElement(ClubAdminNewAnnouncementPage)} />
            <Route path="/club-admin/messages/a/:announcementId" element={routeElement(ClubAdminAnnouncementPage)} />
            <Route path="/club-admin/billing" element={routeElement(ClubAdminBillingPage)} />

            <Route path="/guardian" element={<Navigate to="/guardian/home" replace />} />
            <Route path="/guardian/home" element={routeElement(GuardianHomePage)} />
            <Route path="/guardian/plan" element={routeElement(GuardianPlanPage)} />
            <Route path="/guardian/results" element={routeElement(GuardianResultsPage)} />
            <Route path="/guardian/reports/:reportId" element={routeElement(GuardianReportPage)} />
            <Route path="/guardian/health" element={routeElement(GuardianHealthPage)} />
            <Route path="/guardian/calendar" element={routeElement(GuardianCalendarPage)} />
            <Route path="/guardian/news" element={routeElement(GuardianNewsPage)} />
            <Route path="/guardian/contact" element={routeElement(GuardianContactPage)} />

            <Route path="/platform-admin" element={<PlatformAdminRedirectPage />} />
            <Route path="/platform-admin/dashboard" element={routeElement(PlatformAdminDashboardPage)} />
            <Route path="/platform-admin/requests" element={routeElement(PlatformAdminRequestsPage)} />
            <Route path="/platform-admin/tenants" element={routeElement(PlatformAdminTenantsPage)} />
            <Route path="/platform-admin/billing" element={routeElement(PlatformAdminBillingPage)} />
            <Route path="/platform-admin/commercial" element={routeElement(PlatformAdminCommercialPage)} />
            <Route path="/platform-admin/audit" element={routeElement(PlatformAdminAuditPage)} />
            <Route path="/platform-admin/usage" element={routeElement(PlatformAdminUsagePage)} />
            <Route path="/platform-admin/status" element={routeElement(PlatformAdminStatusPage)} />
            <Route path="/platform-admin/notices" element={routeElement(PlatformAdminNoticesPage)} />
            <Route path="/platform-admin/admins" element={routeElement(PlatformAdminAdminsPage)} />
            <Route path="/platform-admin/tenants/:tenantId" element={routeElement(PlatformAdminClubOverviewPage)} />

            <Route path="/account" element={routeElement(AccountPage)} />
            <Route path="/settings/notifications" element={routeElement(NotificationSettingsPage)} />
            <Route path="/notifications" element={routeElement(NotificationsPage)} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
