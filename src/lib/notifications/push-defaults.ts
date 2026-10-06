// Which kinds of update are pushed when a person has not chosen. Pure: no imports.
//
// Keep in step with push_default_enabled() in
// supabase/migrations/20261016120000_push_notifications.sql: the database decides, this is what
// the settings screen shows. On for what a person wants to know about now, off for roll-ups,
// digests and account housekeeping (a person can switch any of those on).

export const PUSH_DEFAULT_ON_EVENT_TYPES: readonly string[] = [
  "direct_message_received",
  "announcement_posted",
  "training_plan_published",
  "test_week_published",
  "test_week_reopened",
  "athlete_pain_reported",
  "athlete_report_shared",
  "reminder_session_today",
  "reminder_checkin",
  "reminder_test_week_closing",
  "reminder_test_week_closing_coach",
]

export function pushDefaultEnabled(eventType: string): boolean {
  return PUSH_DEFAULT_ON_EVENT_TYPES.includes(eventType)
}

/** A settings row covers one or more event types; it shows "on" when any of them is on by default. */
export function pushDefaultForEventTypes(eventTypes: readonly string[]): boolean {
  return eventTypes.some(pushDefaultEnabled)
}
