// Where a notification takes you. THE ONE PLACE this is decided.
//
// Used by the app (the bell, the /notifications page: src/lib/notifications/target.ts re-exports it)
// and by dispatch-notification-emails (the button in the email). Pure: no imports, no Deno, no DOM.
//
// A notification row carries its event type and a small metadata object written by the database
// trigger that queued it (see supabase/migrations/20261007090000_notifications_delivery.sql). The
// screen is derived from those two and from who is looking. Nothing here is taken from text a
// person typed: ids are checked before they go into a path, and anything unknown falls back to the
// notifications page.

export type NotificationRole = "athlete" | "coach" | "club-admin" | "platform-admin"

export type NotificationMetadata = Record<string, unknown> | null | undefined

/** The fallback: the full list. */
export const NOTIFICATIONS_PATH = "/notifications"
export const NOTIFICATION_SETTINGS_PATH = "/settings/notifications"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function id(metadata: NotificationMetadata, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null
}

function date(metadata: NotificationMetadata, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === "string" && DATE_PATTERN.test(value) ? value : null
}

function idList(metadata: NotificationMetadata, key: string): string[] {
  const value = metadata?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && UUID_PATTERN.test(item))
}

/** A coach's (or a club admin's) way to one team. */
function teamPath(metadata: NotificationMetadata, role: NotificationRole | null): string {
  if (role === "club-admin") return "/club-admin/teams"
  const teamId = id(metadata, "team_id")
  return teamId ? `/coach/teams/${teamId}` : "/coach/teams"
}

/**
 * The in-app path a notification opens. Always starts with "/".
 * `role` is the role of the person it was sent to; null when unknown.
 */
export function notificationTargetPath(eventType: string, metadata: NotificationMetadata, role: NotificationRole | null): string {
  switch (eventType) {
    // Athlete
    case "training_plan_published":
    case "training_plan_updated":
      return "/athlete/training-plan"
    case "test_week_published":
      return "/athlete/test-week"
    case "session_note_added": {
      const sessionDate = date(metadata, "session_date")
      return sessionDate ? `/athlete/log?date=${sessionDate}` : "/athlete/log"
    }
    case "athlete_team_added":
    case "athlete_team_removed":
      return "/athlete/home"
    case "athlete_invite_created":
      // The invited athlete sees this one; the person who sent the invite is told below when it is accepted.
      return role === "athlete" ? "/athlete/join" : teamPath(metadata, role)

    // Coach
    case "athlete_session_completed": {
      // One athlete: straight to them. Several: the team.
      const athleteIds = idList(metadata, "athlete_ids")
      if (athleteIds.length === 1) return `/coach/athletes/${athleteIds[0].toLowerCase()}`
      return teamPath(metadata, "coach")
    }
    case "athlete_test_results_submitted":
      return "/coach/test-week"
    case "athlete_low_readiness": {
      const athleteId = id(metadata, "athlete_id")
      return athleteId ? `/coach/athletes/${athleteId}` : teamPath(metadata, "coach")
    }
    case "athlete_invite_accepted":
      return teamPath(metadata, role)
    case "coach_team_assigned":
      return teamPath(metadata, "coach")
    case "coach_team_removed":
      return "/coach/teams"

    // Club admin
    case "coach_invite_created":
    case "coach_invite_accepted":
      return role === "club-admin" ? "/club-admin/users" : role === "coach" ? "/coach/dashboard" : NOTIFICATIONS_PATH
    case "package_request_reviewed":
      return "/club-admin/billing"
    case "club_suspended":
    case "club_reactivated":
      return "/club-admin/dashboard"

    // Platform admin, and the person who asked for a club
    case "tenant_provision_request_submitted":
      return role === "platform-admin" ? "/platform-admin/requests" : NOTIFICATIONS_PATH
    case "tenant_provision_request_reviewed":
    case "tenant_provision_request_provisioned":
      return role === "platform-admin" ? "/platform-admin/requests" : role === "club-admin" ? "/club-admin/dashboard" : "/login"

    default:
      return NOTIFICATIONS_PATH
  }
}

/** What the button in the email (and a screen reader in the app) calls the destination. */
export function notificationActionLabel(eventType: string): string {
  switch (eventType) {
    case "training_plan_published":
    case "training_plan_updated":
      return "Open your plan"
    case "test_week_published":
      return "Open the test week"
    case "session_note_added":
      return "Open the session"
    case "athlete_low_readiness":
      return "Open the athlete"
    case "athlete_invite_accepted":
    case "coach_team_assigned":
      return "Open the team"
    case "coach_invite_accepted":
      return "Open people"
    case "package_request_reviewed":
      return "Open billing"
    case "tenant_provision_request_submitted":
      return "Review the request"
    default:
      return "Open SKTR Coach"
  }
}
