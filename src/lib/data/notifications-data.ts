import { mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

export type NotificationItem = {
  id: string
  userNotificationId: string
  channel: "in-app"
  eventType: string
  subject: string
  body: string | null
  state: "unread" | "read" | "dismissed"
  createdAt: string
  readAt: string | null
}

type ClientResolution =
  | { ok: true; client: NonNullable<ReturnType<typeof getBrowserSupabaseClient>> }
  | { ok: false; error: DataError }

function requireSupabaseClient(operation: string): ClientResolution {
  if (getBackendMode() !== "supabase") {
    return {
      ok: false,
      error: { code: "UNKNOWN", message: `[${operation}] backend mode is not 'supabase'.` },
    }
  }

  const client = getBrowserSupabaseClient()
  if (!client) {
    return {
      ok: false,
      error: { code: "UNKNOWN", message: `[${operation}] Supabase client is not configured.` },
    }
  }

  return { ok: true, client }
}

export async function getNotificationFeed(limit = 8): Promise<Result<NotificationItem[]>> {
  const clientResult = requireSupabaseClient("getNotificationFeed")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client
    .from("user_notifications")
    .select(
      "id, state, read_at, created_at, notification_events!inner(id, channel, event_type, subject, body, created_at)",
    )
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
      id: string
      state: NotificationItem["state"]
      read_at: string | null
      created_at: string
      notification_events: Array<{
        id: string
        channel: NotificationItem["channel"]
        event_type: string
        subject: string
        body: string | null
        created_at: string
      }>
    }> | null) ?? [])
      .map((row) => {
        const event = row.notification_events[0]
        if (!event) return null

        return {
          id: event.id,
      userNotificationId: row.id,
      channel: event.channel,
      eventType: event.event_type,
      subject: event.subject,
      body: event.body,
      state: row.state,
      createdAt: event.created_at ?? row.created_at,
      readAt: row.read_at,
        }
      })
      .filter((row): row is NotificationItem => row !== null),
  )
}

export async function markNotificationsRead(notificationIds: string[]): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("markNotificationsRead")
  if (!clientResult.ok) return clientResult
  if (notificationIds.length === 0) return ok(undefined)

  const { error } = await clientResult.client
    .from("user_notifications")
    .update({
      state: "read",
      read_at: new Date().toISOString(),
    })
    .in("id", notificationIds)

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}
