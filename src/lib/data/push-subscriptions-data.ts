import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { invokeSignedIn } from "@/lib/supabase/invoke"

/**
 * Push devices in the database (public.push_subscriptions, migration 20261016120000). A person
 * reads and deletes only their own rows; writing goes through register_push_subscription().
 * The browser side (permission, the subscription itself) and demo mode live in
 * src/lib/push/push-client.ts, which is what screens call.
 */

export type PushDeviceRow = {
  id: string
  endpoint: string
  label: string
  createdAt: string
  lastUsedAt: string
  lastSuccessAt: string | null
}

function client() {
  if (getBackendMode() !== "supabase") return null
  return getBrowserSupabaseClient()
}

const NOT_CONFIGURED = "Push devices are only stored when the app is connected to its backend."

export async function listPushDeviceRows(): Promise<Result<PushDeviceRow[]>> {
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NOT_CONFIGURED)
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, device_label, created_at, last_used_at, last_success_at")
    .is("disabled_at", null)
    .order("last_used_at", { ascending: false })
  if (error) return { ok: false, error: mapPostgrestError(error) }
  type Row = { id: string; endpoint: string; device_label: string; created_at: string; last_used_at: string; last_success_at: string | null }
  return ok(
    ((data as Row[] | null) ?? []).map((row) => ({
      id: row.id,
      endpoint: row.endpoint,
      label: row.device_label,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      lastSuccessAt: row.last_success_at,
    })),
  )
}

export type RegisterPushFailure = "browser-not-supported" | "error"

export async function registerPushDevice(params: {
  endpoint: string
  p256dh: string
  auth: string
  label: string
  replacesEndpoint?: string | null
}): Promise<{ ok: true; id: string } | { ok: false; reason: RegisterPushFailure; message: string }> {
  const supabase = client()
  if (!supabase) return { ok: false, reason: "error", message: NOT_CONFIGURED }
  const { data, error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: params.endpoint,
    p_p256dh: params.p256dh,
    p_auth: params.auth,
    p_device_label: params.label,
    p_replaces_endpoint: params.replacesEndpoint ?? null,
  })
  if (error) {
    if (error.hint === "push_endpoint_not_allowed") return { ok: false, reason: "browser-not-supported", message: error.message }
    return { ok: false, reason: "error", message: mapPostgrestError(error).message }
  }
  return { ok: true, id: String(data) }
}

/** Removes the row for one browser, by its endpoint. Used by "turn off" and by sign out. */
export async function removePushDeviceByEndpoint(endpoint: string): Promise<Result<boolean>> {
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NOT_CONFIGURED)
  const { data, error } = await supabase.rpc("remove_push_subscription", { p_endpoint: endpoint })
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(data === true)
}

/** Removes one of the person's devices from the list (another phone, an old laptop). */
export async function removePushDeviceById(id: string): Promise<Result<null>> {
  const supabase = client()
  if (!supabase) return err("UNKNOWN", NOT_CONFIGURED)
  const { error } = await supabase.from("push_subscriptions").delete().eq("id", id)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(null)
}

export type TestPushResult =
  | { ok: true; outcome: "sent" | "queued" | "wait" | "not-set-up" | "gone" }
  | { ok: false; message: string }

type DispatchAnswer = { push?: { configured?: boolean; sent?: number; gone?: number } } | null

/**
 * Queues a test message for one device and asks the server to send it now.
 *   sent        the push service accepted it
 *   queued      it is waiting; the scheduler sends it within a minute
 *   wait        a test went to this device a moment ago
 *   not-set-up  the server has no push keys yet
 *   gone        the push service says this device no longer exists
 */
export async function sendTestPushToDevice(id: string): Promise<TestPushResult> {
  const supabase = client()
  if (!supabase) return { ok: false, message: NOT_CONFIGURED }
  const { data, error } = await supabase.rpc("send_test_push", { p_subscription_id: id })
  if (error) return { ok: false, message: error.hint?.startsWith("push_") ? error.message : mapPostgrestError(error).message }
  if (data === "wait") return { ok: true, outcome: "wait" }

  // The same function that sends email sends push. It answers with what happened to the push part,
  // also when email is not set up (then the answer rides on the error).
  let answer: DispatchAnswer = null
  try {
    const invoked = await invokeSignedIn<DispatchAnswer>(supabase, "dispatch-notification-emails", { body: { source: "app-push-test" } })
    answer = invoked.data ?? null
    const context = (invoked.error as { context?: unknown } | null)?.context
    if (!answer && context instanceof Response) answer = (await context.clone().json().catch(() => null)) as DispatchAnswer
  } catch {
    answer = null
  }

  if (answer?.push?.configured === false) return { ok: true, outcome: "not-set-up" }
  if ((answer?.push?.gone ?? 0) > 0 && (answer?.push?.sent ?? 0) === 0) return { ok: true, outcome: "gone" }
  if ((answer?.push?.sent ?? 0) > 0) return { ok: true, outcome: "sent" }
  return { ok: true, outcome: "queued" }
}
