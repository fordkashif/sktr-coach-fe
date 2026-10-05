// Where a notification takes you is decided in ONE place, shared with the edge function that writes
// the emails, so the button in an email and the row in the app always open the same screen.
export {
  NOTIFICATIONS_PATH,
  NOTIFICATION_SETTINGS_PATH,
  notificationActionLabel,
  notificationTargetPath,
  type NotificationMetadata,
  type NotificationRole,
} from "../../../supabase/functions/_shared/notification-target"
