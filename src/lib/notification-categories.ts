export type NotificationCategoryRole = "athlete" | "coach" | "club-admin" | "platform-admin" | "guardian"

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
  /**
   * "reminders": made on a schedule by the hourly job (20261011120000_reminders.sql), not by
   * something a person did. The settings screen lists these under their own heading.
   */
  group?: "reminders"
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
    eventTypes: ["test_week_published", "test_week_reopened"],
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
    description: "When you are added to, moved to or removed from a team, or your team gets a new lead coach.",
    eventTypes: ["athlete_team_added", "athlete_team_removed", "team_coach_changed"],
    roles: ["athlete"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "competition-entries",
    title: "Competition entries",
    description: "When your coach enters you in a competition.",
    eventTypes: ["competition_entry_added"],
    roles: ["athlete"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },

  {
    key: "coach-reports",
    title: "Reports from your coach",
    description: "When your coach shares a report about your training with you.",
    eventTypes: ["athlete_report_shared"],
    roles: ["athlete"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "availability-set",
    title: "Your availability",
    description: "When your coach or club marks you as injured, sick or away, or as available again.",
    eventTypes: ["availability_set_by_coach"],
    roles: ["athlete"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },

  // Messaging (20261009110000). Both are on by default on both channels: the database answers
  // "on" for any kind of update notification_default_enabled() does not list.
  {
    key: "announcements",
    title: "Announcements",
    description: "When your coach or your club posts an announcement to you. The email carries the announcement.",
    eventTypes: ["announcement_posted"],
    roles: ["athlete", "coach", "club-admin"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "direct-messages",
    title: "Messages",
    description: "When a coach or an athlete sends you a message. At most one email an hour per conversation, and the email never includes the message.",
    eventTypes: ["direct_message_received"],
    roles: ["athlete", "coach", "club-admin"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },

  // From the SKTR team to every club (20261017110000). Athletes and guardians only get the ones
  // sent to everyone; the email goes to club admins only, and only when the sender asks for it.
  {
    key: "platform-notices",
    title: "Notices from SKTR Coach",
    description: "Short notices from the SKTR Coach team about the app, such as planned maintenance. An email is only ever sent to club admins.",
    eventTypes: ["platform_notice"],
    roles: ["athlete", "coach", "club-admin", "guardian"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },

  // Coach (and a club admin who also coaches a team)
  {
    key: "athlete-availability",
    title: "Athlete availability",
    description: "When an athlete on one of your teams marks themselves injured, sick or away, and when they are back.",
    eventTypes: ["athlete_unavailable", "athlete_available_again"],
    roles: ["coach", "club-admin"],
    defaults: { "in-app": true, email: false },
    emailAvailable: false,
  },
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
    key: "pain-reports",
    title: "Pain and injury reports",
    description: "When an athlete on one of your teams reports pain that changes or stops their training.",
    eventTypes: ["athlete_pain_reported"],
    roles: ["coach", "club-admin"],
    defaults: { "in-app": true, email: false },
    emailAvailable: true,
  },
  {
    key: "athlete-joined-or-moved",
    title: "Athletes joining and moving",
    description: "When an athlete joins one of your teams with the team join code, or is moved to or from one of your teams.",
    eventTypes: ["athlete_joined_team", "athlete_moved_team"],
    roles: ["coach", "club-admin"],
    defaults: { "in-app": true, email: false },
    emailAvailable: false,
  },
  {
    key: "athlete-left-team",
    title: "Athletes leaving",
    description: "When an athlete leaves one of your teams or deletes their account.",
    eventTypes: ["athlete_left_team", "athlete_account_deleted"],
    roles: ["coach", "club-admin"],
    defaults: { "in-app": true, email: true },
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
    key: "athlete-bests",
    title: "Personal and season bests",
    description: "When an athlete on one of your teams beats their personal or season best.",
    eventTypes: ["athlete_new_best"],
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
    description: "When a club admin adds you to a team, takes you off one, changes your role on it or hands a team over to you.",
    eventTypes: ["coach_team_assigned", "coach_team_removed", "coach_team_role_changed", "coach_handover_new_lead"],
    roles: ["coach"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },

  // Club admin
  {
    key: "coach-invites",
    title: "Coach invites",
    description: "When a coach you invited accepts, or a coach asks to hand over a team.",
    eventTypes: ["coach_invite_created", "coach_invite_accepted", "coach_handover_requested"],
    roles: ["club-admin"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "club-account",
    title: "Your club's account",
    description: "When a package request is approved or declined, when the club's access is paused or turned back on, when the club changes owner or is closed, and when a coach or club admin deletes their account.",
    eventTypes: ["package_request_reviewed", "club_suspended", "club_reactivated", "club_closed", "club_ownership_transferred", "member_account_deleted"],
    roles: ["club-admin"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },

  {
    key: "message-reports",
    title: "Reported messages",
    description: "When a coach or an athlete reports a message for you to review in message oversight.",
    eventTypes: ["message_reported"],
    roles: ["club-admin"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },

  // Reminders (20261011120000_reminders.sql). Timed in the club's own time zone. The job only
  // emails a "default off" reminder to someone who switched its email on; keep these defaults in
  // step with the p_email_by_default argument each reminder passes to send_reminder().
  {
    key: "reminder-session-today",
    title: "Session today",
    description: "At 7 in the morning on a day you have a session planned and not logged yet.",
    eventTypes: ["reminder_session_today"],
    roles: ["athlete"],
    defaults: { "in-app": true, email: false },
    emailAvailable: true,
    group: "reminders",
  },
  {
    key: "reminder-checkin",
    title: "Check-in not done",
    description: "At 9 in the morning if you have not done today's check-in.",
    eventTypes: ["reminder_checkin"],
    roles: ["athlete"],
    defaults: { "in-app": true, email: false },
    emailAvailable: true,
    group: "reminders",
  },
  {
    key: "reminder-test-week-closing",
    title: "Test week closing",
    description: "On the last day of a test week, if you still have a required test without a result.",
    eventTypes: ["reminder_test_week_closing"],
    roles: ["athlete"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
    group: "reminders",
  },
  {
    key: "reminder-test-week-closing-coach",
    title: "Test week closing",
    description: "On the last day of a test week on one of your teams, with how many athletes still have results missing.",
    eventTypes: ["reminder_test_week_closing_coach"],
    roles: ["coach", "club-admin"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
    group: "reminders",
  },
  {
    key: "reminder-athletes-not-logged",
    title: "Sessions not logged",
    description: "At 8 in the morning, one summary of how many athletes on your teams did not log yesterday's session.",
    eventTypes: ["reminder_athletes_not_logged"],
    roles: ["coach", "club-admin"],
    defaults: { "in-app": true, email: false },
    emailAvailable: true,
    group: "reminders",
  },

  // Parent or guardian (20261016090000_guardian_access.sql). All on by default on both channels.
  {
    key: "guardian-plans",
    title: "New training plans",
    description: "When the coach publishes a plan for an athlete you follow.",
    eventTypes: ["guardian_plan_published"],
    roles: ["guardian"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "guardian-test-weeks",
    title: "Test weeks",
    description: "When a test week opens for an athlete you follow.",
    eventTypes: ["guardian_test_week_published"],
    roles: ["guardian"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "guardian-pain-reports",
    title: "Pain and injury reports",
    description: "When an athlete you follow sends a pain or injury report. Only where you can see their health information.",
    eventTypes: ["guardian_pain_reported"],
    roles: ["guardian"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "guardian-reports",
    title: "Reports from the coach",
    description: "When the coach shares a report about an athlete you follow.",
    eventTypes: ["guardian_report_shared"],
    roles: ["guardian"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "guardian-announcements",
    title: "Announcements",
    description: "When the coach or the club posts an announcement to the team. The email carries the announcement.",
    eventTypes: ["guardian_announcement_posted"],
    roles: ["guardian"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "guardian-access",
    title: "Your access",
    description: "When the club adds an athlete to your account or ends your access to one.",
    eventTypes: ["guardian_linked", "guardian_unlinked"],
    roles: ["guardian"],
    defaults: { "in-app": true, email: true },
    emailAvailable: true,
  },
  {
    key: "guardian-invites",
    title: "Guardian invites",
    description: "When a parent or guardian you invited accepts.",
    eventTypes: ["guardian_invite_accepted"],
    roles: ["coach", "club-admin"],
    defaults: { "in-app": true, email: false },
    emailAvailable: false,
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
