export type NotificationCategoryRole = "athlete" | "coach" | "club-admin" | "platform-admin"

export type NotificationPreferenceCategory = {
  key: string
  title: string
  description: string
  eventTypes: string[]
  /** Who can receive this kind of update. The settings screen only shows a person what can reach them. */
  roles: NotificationCategoryRole[]
  /**
   * What happens when the person has not chosen. Keep in step with notification_default_enabled()
   * in supabase/migrations/20261007090000_notifications_delivery.sql: the database decides, this is
   * what the settings screen shows.
   */
  defaults: { "in-app": boolean; email: boolean }
  /** False when this kind of update is never emailed (it would be an email per athlete per session). */
  emailAvailable: boolean
}

export const NOTIFICATION_PREFERENCE_CATEGORIES: NotificationPreferenceCategory[] = [
  // Athlete
  {
    key: "training-plans",
    title: "New training plans",
    description: "When your coach publishes a plan for you or your team.",
    eventTypes: ["training_plan_published"],
    roles: ["athlete"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "training-plan-updates",
    title: "Changes to your plan",
    description: "When your coach edits a plan you are already on.",
    eventTypes: ["training_plan_updated"],
    roles: ["athlete"],
    defaults: { "in-app": true, email: false },
    emailAvailable: true,
  },
  {
    key: "test-weeks",
    title: "Test weeks",
    description: "When a test week opens for your team.",
    eventTypes: ["test_week_published"],
    roles: ["athlete"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "session-notes",
    title: "Notes from your coach",
    description: "When your coach leaves or changes a note on one of your sessions.",
    eventTypes: ["session_note_added"],
    roles: ["athlete"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "team-membership",
    title: "Your team",
    description: "When you are added to, moved to or removed from a team.",
    eventTypes: ["athlete_team_added", "athlete_team_removed"],
    roles: ["athlete"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },

  // Coach (and a club admin who also coaches a team)
  {
    key: "low-readiness",
    title: "Low readiness",
    description: "When an athlete on one of your teams reports low readiness in today's check-in.",
    eventTypes: ["athlete_low_readiness"],
    roles: ["coach", "club-admin"],
    defaults: { "in-app": true, email: false },
    emailAvailable: true,
  },
  {
    key: "session-activity",
    title: "Finished sessions",
    description: "When athletes on your teams finish a session. One notification per team per day.",
    eventTypes: ["athlete_session_completed"],
    roles: ["coach", "club-admin"],
    defaults: { "in-app": true, email: false },
    emailAvailable: false,
  },
  {
    key: "test-results",
    title: "Test week results",
    description: "When athletes submit their test week results.",
    eventTypes: ["athlete_test_results_submitted"],
    roles: ["coach", "club-admin"],
    defaults: { "in-app": true, email: false },
    emailAvailable: false,
  },
  {
    key: "athlete-invites",
    title: "Team invites",
    description: "When an athlete you invited joins the team.",
    eventTypes: ["athlete_invite_created", "athlete_invite_accepted"],
    roles: ["coach", "club-admin"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "coach-teams",
    title: "Your teams",
    description: "When a club admin adds you to a team or takes you off one.",
    eventTypes: ["coach_team_assigned", "coach_team_removed"],
    roles: ["coach"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },

  // Club admin
  {
    key: "coach-invites",
    title: "Coach invites",
    description: "When a coach you invited accepts.",
    eventTypes: ["coach_invite_created", "coach_invite_accepted"],
    roles: ["club-admin"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "club-account",
    title: "Your club's account",
    description: "When a package request is approved or declined, and when the club's access is paused or turned back on.",
    eventTypes: ["package_request_reviewed", "club_suspended", "club_reactivated"],
    roles: ["club-admin"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },

  // Platform admin, and the person who asked for a club
  {
    key: "tenant-provisioning",
    title: "Club requests",
    description: "When a club asks to join, is reviewed or is set up.",
    eventTypes: [
      "tenant_provision_request_submitted",
      "tenant_provision_request_reviewed",
      "tenant_provision_request_provisioned",
    ],
    roles: ["club-admin", "platform-admin"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
]

export function notificationCategoriesForRole(role: NotificationCategoryRole): NotificationPreferenceCategory[] {
  return NOTIFICATION_PREFERENCE_CATEGORIES.filter((category) => category.roles.includes(role))
}
