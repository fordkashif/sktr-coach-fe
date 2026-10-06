// What a push notification says. Pure: no imports, no network, no Deno APIs.
//
// THE RULE, the same as for emails and stricter: a push shows on a lock screen, so it never
// carries health details and never carries anything a person typed (no message text, no
// announcement text, no plan name, no athlete name on a health report). Every line below is a
// fixed sentence. The one thing taken from data is the name of the person who sent a direct
// message ("You have a new message from Coach Rivera"), tidied to one short line.
//
// The words come from the event type alone. An event type this file does not know (one added
// later, for a role added later) gets the plain "You have a new notification".

export const PUSH_APP_NAME = "SKTR Coach"

export type PushMessage = {
  title: string
  body: string
  /** Notifications with the same tag replace each other on the device. */
  tag: string
  /** Seconds the push service may hold the message for a device that is offline. */
  ttlSeconds: number
  urgency: "normal" | "high"
}

export type PushMessageInput = {
  event_type: string
  /** The subject of the in-app notification. Only read for the sender's name of a direct message. */
  subject: string | null
  metadata: Record<string, unknown> | null
}

const HOUR = 60 * 60
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A name people typed, as one tidy line. Empty when there is nothing usable. */
export function cleanPushName(value: string | null | undefined, maxLength = 60): string {
  const cleaned = (value ?? "").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim()
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned
}

/** "New message from Coach Rivera" -> "Coach Rivera". The database writes that subject (20261009110000). */
export function messageSenderName(subject: string | null | undefined): string {
  const match = /^New message from ([\s\S]+)$/.exec((subject ?? "").trim())
  return match ? cleanPushName(match[1]) : ""
}

function metadataId(metadata: Record<string, unknown> | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata?.[key]
    if (typeof value === "string" && UUID_PATTERN.test(value)) return value.toLowerCase()
  }
  return null
}

/** One notification per thing on the device: a second message in the same conversation replaces the first. */
export function pushTag(eventType: string, metadata: Record<string, unknown> | null): string {
  const id = metadataId(metadata, ["thread_id", "announcement_id", "plan_id", "test_week_id", "report_id", "competition_id", "athlete_id", "team_id"])
  // The tag travels inside the encrypted message only, but it still does not name a health event.
  const named = eventType === "athlete_pain_reported" || eventType === "athlete_low_readiness" ? "athlete_update" : eventType
  const type = named.replace(/[^a-z0-9_]/gi, "").slice(0, 60) || "notification"
  return id ? `${type}:${id}` : type
}

function words(input: PushMessageInput): { title: string; body: string; urgency?: "high"; ttlSeconds?: number } {
  switch (input.event_type) {
    case "direct_message_received": {
      const sender = messageSenderName(input.subject)
      return { title: "New message", body: sender ? `You have a new message from ${sender}.` : "You have a new message.", urgency: "high" }
    }
    case "announcement_posted":
      return { title: "New announcement", body: "There is a new announcement for you. Open SKTR Coach to read it." }
    case "training_plan_published":
      return { title: "New training plan", body: "Your coach published a training plan for you." }
    case "training_plan_updated":
      return { title: "Your plan changed", body: "Your coach updated your training plan." }
    case "test_week_published":
    case "test_week_reopened":
      return { title: "Test week", body: "A test week is open for your team." }
    case "session_note_added":
      return { title: "Note from your coach", body: "Your coach left a note on one of your sessions." }
    case "athlete_report_shared":
      return { title: "New report", body: "Your coach shared a report with you." }
    case "competition_entry_added":
      return { title: "Competition entry", body: "Your coach entered you in a competition." }
    // To coaches. No name and no detail: what was reported is read in the app.
    case "athlete_pain_reported":
    case "athlete_low_readiness":
      return { title: "An athlete needs a look", body: "A report came in from one of your teams. Open SKTR Coach to read it." }
    case "athlete_unavailable":
    case "athlete_available_again":
      return { title: "Athlete availability", body: "An athlete on one of your teams changed their availability." }
    case "athlete_session_completed":
      return { title: "Finished sessions", body: "Athletes on your teams finished a session." }
    case "athlete_test_results_submitted":
      return { title: "Test week results", body: "Athletes submitted test week results." }
    // Reminders: no use the next day.
    case "reminder_session_today":
      return { title: "Session today", body: "You have a session planned today.", ttlSeconds: 8 * HOUR }
    case "reminder_checkin":
      return { title: "Check-in", body: "You have not done today's check-in yet.", ttlSeconds: 8 * HOUR }
    case "reminder_test_week_closing":
      return { title: "Test week closes today", body: "You still have a test without a result.", ttlSeconds: 8 * HOUR }
    case "reminder_test_week_closing_coach":
      return { title: "Test week closes today", body: "Some athletes still have results missing.", ttlSeconds: 8 * HOUR }
    case "reminder_athletes_not_logged":
      return { title: "Sessions not logged", body: "Some athletes did not log yesterday's session.", ttlSeconds: 8 * HOUR }
    case "push_test":
      return { title: "Push is working", body: "This is a test from SKTR Coach. Notifications will reach this device.", urgency: "high", ttlSeconds: 10 * 60 }
    default:
      return { title: PUSH_APP_NAME, body: "You have a new notification." }
  }
}

export function renderPushMessage(input: PushMessageInput): PushMessage {
  const picked = words(input)
  return {
    title: picked.title,
    body: picked.body,
    tag: pushTag(input.event_type, input.metadata),
    ttlSeconds: picked.ttlSeconds ?? 24 * HOUR,
    urgency: picked.urgency ?? "normal",
  }
}

/** Only a path inside the app: starts with one "/" and has no scheme or host. */
export function safePushPath(path: string | null | undefined, fallback = "/notifications"): string {
  const value = (path ?? "").trim()
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /\p{Cc}/u.test(value)) return fallback
  return value.length > 300 ? fallback : value
}

/** What the service worker receives. Small on purpose. */
export function pushPayloadJson(message: PushMessage, path: string): string {
  return JSON.stringify({ title: message.title, body: message.body, url: safePushPath(path), tag: message.tag })
}

/**
 * The server only posts to the push services of the browsers this app supports.
 * Keep in step with push_endpoint_allowed() in 20261016120000_push_notifications.sql.
 */
export function isAllowedPushEndpoint(endpoint: string | null | undefined): boolean {
  if (!endpoint || endpoint.length > 2000) return false
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false
  const host = url.hostname.toLowerCase()
  return ["fcm.googleapis.com", "jmt17.google.com", "push.services.mozilla.com", "notify.windows.com", "push.apple.com"].some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  )
}
