import { mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

export type NotificationItem = {
  id: string
  channel: "in-app" | "email"
  eventType: string
  subject: string
  body: string | null
  status: "pending" | "sent" | "failed" | "read"
  createdAt: string
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
    .from("notification_events")
    .select("id, channel, event_type, subject, body, status, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
      id: string
      channel: NotificationItem["channel"]
      event_type: string
      subject: string
      body: string | null
      status: NotificationItem["status"]
      created_at: string
    }> | null) ?? []).map((row) => ({
      id: row.id,
      channel: row.channel,
      eventType: row.event_type,
      subject: row.subject,
      body: row.body,
      status: row.status,
      createdAt: row.created_at,
    })),
  )
}

export async function markNotificationsRead(notificationIds: string[]): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("markNotificationsRead")
  if (!clientResult.ok) return clientResult
  if (notificationIds.length === 0) return ok(undefined)

  const { error } = await clientResult.client
    .from("notification_events")
    .update({
      status: "read",
      read_at: new Date().toISOString(),
    })
    .in("id", notificationIds)

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}
