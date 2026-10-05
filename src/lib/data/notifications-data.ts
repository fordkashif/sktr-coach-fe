import { mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import {
  getMockNotificationFeed,
  getMockUnreadNotificationCount,
  markAllMockNotificationsRead,
  markMockNotificationsRead,
} from "@/lib/notifications/mock-feed"
import { notificationTargetPath, type NotificationRole } from "@/lib/notifications/target"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

export type NotificationItem = {
  /** The person's own copy of the notification (user_notifications.id). Read state lives here. */
  id: string
  eventType: string
  subject: string
  body: string | null
  state: "unread" | "read"
  /** When it happened, or when it last grew ("3 athletes finished a session"). */
  createdAt: string
  readAt: string | null
  /** The screen this notification opens. */
  href: string
}

export type NotificationPage = {
  items: NotificationItem[]
  /** True when older notifications exist beyond this page. */
  hasMore: boolean
}

type SupabaseClient = NonNullable<ReturnType<typeof getBrowserSupabaseClient>>

type ClientResolution = { ok: true; client: SupabaseClient } | { ok: false; error: DataError }

function isMockMode() {
  return getBackendMode() !== "supabase"
}

function requireSupabaseClient(operation: string): ClientResolution {
  const client = getBrowserSupabaseClient()
  if (!client) {
    return {
      ok: false,
      error: { code: "UNKNOWN", message: `[${operation}] Supabase client is not configured.` },
    }
  }
  return { ok: true, client }
}

type FeedRow = {
  id: string
  state: "unread" | "read" | "dismissed"
  read_at: string | null
  created_at: string
  // A to-one embed comes back as one object. (An older supabase-js typed it as an array; both are read.)
  notification_events:
    | { id: string; event_type: string; subject: string; body: string | null; metadata: Record<string, unknown> | null }
    | Array<{ id: string; event_type: string; subject: string; body: string | null; metadata: Record<string, unknown> | null }>
    | null
}

const FEED_COLUMNS = "id, state, read_at, created_at, notification_events!inner(id, event_type, subject, body, metadata)"

/**
 * The person's notifications, newest first.
 * `before` is the createdAt of the last item already shown (for "Load more").
 * `role` decides where each one leads; pass the signed-in role.
 */
export async function getNotificationFeed(params: {
  role: NotificationRole
  limit?: number
  before?: string | null
}): Promise<Result<NotificationPage>> {
  const limit = Math.max(1, Math.min(params.limit ?? 20, 100))
  if (isMockMode()) return ok(getMockNotificationFeed({ role: params.role, limit, before: params.before ?? null }))

  const clientResult = requireSupabaseClient("getNotificationFeed")
  if (!clientResult.ok) return clientResult

  let query = clientResult.client
    .from("user_notifications")
    .select(FEED_COLUMNS)
    .in("state", ["unread", "read"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    // One extra row tells us whether there is another page.
    .limit(limit + 1)
  if (params.before) query = query.lt("created_at", params.before)

  const { data, error } = await query
  if (error) return { ok: false, error: mapPostgrestError(error) }

  const rows = (data as unknown as FeedRow[] | null) ?? []
  const items = rows
    .map((row): NotificationItem | null => {
      const event = Array.isArray(row.notification_events) ? row.notification_events[0] : row.notification_events
      if (!event) return null
      return {
        id: row.id,
        eventType: event.event_type,
        subject: event.subject,
        body: event.body,
        state: row.state === "unread" ? "unread" : "read",
        createdAt: row.created_at,
        readAt: row.read_at,
        href: notificationTargetPath(event.event_type, event.metadata, params.role),
      }
    })
    .filter((item): item is NotificationItem => item !== null)

  return ok({ items: items.slice(0, limit), hasMore: rows.length > limit })
}

/** How many notifications the person has not read. */
export async function getUnreadNotificationCount(role: NotificationRole): Promise<Result<number>> {
  if (isMockMode()) return ok(getMockUnreadNotificationCount(role))

  const clientResult = requireSupabaseClient("getUnreadNotificationCount")
  if (!clientResult.ok) return clientResult

  // The inner join keeps the count in step with the list: a row whose event the person cannot read is not counted.
  const { count, error } = await clientResult.client
    .from("user_notifications")
    .select("id, notification_events!inner(id)", { count: "exact", head: true })
    .eq("state", "unread")

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(count ?? 0)
}

export async function markNotificationsRead(role: NotificationRole, notificationIds: string[]): Promise<Result<void>> {
  if (notificationIds.length === 0) return ok(undefined)
  if (isMockMode()) {
    markMockNotificationsRead(role, notificationIds)
    return ok(undefined)
  }

  const clientResult = requireSupabaseClient("markNotificationsRead")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client
    .from("user_notifications")
    .update({ state: "read", read_at: new Date().toISOString() })
    .in("id", notificationIds)
    .eq("state", "unread")

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

/** Marks everything read, including notifications that are not loaded on this screen. Row policies keep it to the person's own. */
export async function markAllNotificationsRead(role: NotificationRole): Promise<Result<void>> {
  if (isMockMode()) {
    markAllMockNotificationsRead(role)
    return ok(undefined)
  }

  const clientResult = requireSupabaseClient("markAllNotificationsRead")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client
    .from("user_notifications")
    .update({ state: "read", read_at: new Date().toISOString() })
    .eq("state", "unread")

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

/**
 * Listens for the person's notification rows changing (Supabase Realtime, which applies the table's
 * row policies). Calls `onChange` with no details; the caller reloads. Returns the function that
 * stops listening. When Realtime is not available this does nothing, silently: the caller also
 * refreshes on focus, on navigation and on a slow timer.
 */
export function subscribeToNotificationChanges(onChange: () => void): () => void {
  if (isMockMode()) return () => {}
  const client = getBrowserSupabaseClient()
  if (!client) return () => {}

  let stopped = false
  let channel: ReturnType<SupabaseClient["channel"]> | null = null

  void (async () => {
    try {
      const { data } = await client.auth.getSession()
      const userId = data.session?.user.id
      if (!userId || stopped) return
      channel = client
        .channel(`user-notifications:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_notifications", filter: `recipient_user_id=eq.${userId}` },
          () => {
            if (!stopped) onChange()
          },
        )
        .subscribe()
    } catch {
      // No Realtime: polling covers it.
    }
  })()

  return () => {
    stopped = true
    if (channel) {
      try {
        void client.removeChannel(channel)
      } catch {
        // Already gone.
      }
    }
  }
}

/**
 * Asks the server to send the notification emails waiting for this club, now. Called after an
 * action that notifies people (publishing a plan or a test week, leaving a session note).
 *
 * Emails are normally sent by the database's own scheduler within a minute. This is the fallback
 * that keeps email flowing where the scheduler is not available, and it makes delivery immediate
 * where it is. It never blocks or fails the action: nothing is awaited by the caller and every
 * error is swallowed. The server only ever sends the caller's own club's queue.
 */
export function kickNotificationEmails(): void {
  if (isMockMode()) return
  const client = getBrowserSupabaseClient()
  if (!client) return
  void client.functions
    .invoke("dispatch-notification-emails", { body: { source: "app" } })
    .then(
      () => undefined,
      () => undefined,
    )
}
