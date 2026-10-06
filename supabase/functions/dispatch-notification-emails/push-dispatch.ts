// The push part of a dispatch run. It sits beside the email part and shares nothing with it but
// the caller check: its own queue (public.push_deliveries, migration 20261016120000), its own
// claimed state, its own time budget. Whatever happens here, the email part still runs.
//
//   claim_push_deliveries     hands out rows with FOR UPDATE SKIP LOCKED and holds back what must
//                             not be sent (paused club, deactivated member, switched off, device
//                             turned off, already read in the app, too old).
//   complete_push_delivery    sent / gone (404 or 410: the device is disabled) / retry / failed.
//
// Secrets it reads: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT. With any of them missing
// push is simply off: what is waiting is marked "not set up" and nothing is posted anywhere.

import { notificationTargetPath, type NotificationRole } from "../_shared/notification-target.ts"
import { isAllowedPushEndpoint, pushPayloadJson, renderPushMessage } from "../_shared/push-message.ts"
import { buildPushRequest, loadVapidKeys, readPushResponse, type PushOutcome, type VapidConfigProblem } from "../_shared/web-push.ts"

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any

export type ClaimedPush = {
  id: string
  subscription_id: string
  endpoint: string
  p256dh: string
  auth: string
  recipient_user_id: string
  recipient_role: string | null
  event_type: string
  subject: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  attempt_count: number
}

export type PushRunSummary = {
  /** False when the VAPID settings are missing or wrong: nothing was sent. */
  configured: boolean
  problem?: VapidConfigProblem | "queue_unavailable" | "error"
  processed: number
  sent: number
  failed: number
  /** Devices that were disabled because the push service said they no longer exist. */
  gone: number
  stopped: string | null
}

export type PushRunDeps = {
  getEnv: (name: string) => string | undefined
  fetch: typeof fetch
  now: () => Date
}

export const PUSH_CLAIM_BATCH_SIZE = 20
/** Pushes posted at the same moment. */
export const PUSH_PARALLEL = 6
/** A push service that does not answer in this time counts as busy. */
export const PUSH_TIMEOUT_MS = 8_000

/** Where the notification opens. The same screen the bell row and the email button open. */
export function pushTargetPath(row: Pick<ClaimedPush, "event_type" | "metadata" | "recipient_role">): string {
  if (row.event_type === "push_test") return "/settings/notifications"
  // The role is passed as it is in the database, so a role added later needs no change here.
  return notificationTargetPath(row.event_type, row.metadata, (row.recipient_role ?? null) as NotificationRole | null)
}

export async function runPushDispatch(
  serviceClient: LooseClient,
  deps: PushRunDeps,
  options: { tenantId: string | null; maxPushes: number; budgetMs: number },
): Promise<PushRunSummary> {
  const summary: PushRunSummary = { configured: false, processed: 0, sent: 0, failed: 0, gone: 0, stopped: null }

  try {
    const loaded = await loadVapidKeys(deps.getEnv("VAPID_PUBLIC_KEY"), deps.getEnv("VAPID_PRIVATE_KEY"), deps.getEnv("VAPID_SUBJECT"))
    if (!loaded.ok) {
      summary.problem = loaded.problem
      // Nothing waits forever for keys that are not there.
      await serviceClient.rpc("suppress_pending_push_deliveries", { p_reason: "Not sent: push is not set up for this environment." })
      return summary
    }
    summary.configured = true
    const keys = loaded.keys
    const startedAt = deps.now().getTime()

    const sendOne = async (row: ClaimedPush): Promise<PushOutcome> => {
      if (!isAllowedPushEndpoint(row.endpoint)) return { result: "failed", error: "Not sent: the address is not a known push service." }
      const message = renderPushMessage(row)
      let request
      try {
        request = await buildPushRequest({
          keys,
          endpoint: row.endpoint,
          p256dh: row.p256dh,
          auth: row.auth,
          payload: pushPayloadJson(message, pushTargetPath(row)),
          ttlSeconds: message.ttlSeconds,
          urgency: message.urgency,
          tag: message.tag,
          nowSeconds: deps.now().getTime() / 1000,
        })
      } catch (error) {
        return { result: "failed", error: error instanceof Error ? error.message : "The push message could not be encrypted." }
      }
      if (!request) return { result: "failed", error: "Not sent: the address is not usable." }
      try {
        const response = await deps.fetch(request.url, {
          method: "POST",
          headers: request.headers,
          body: request.body as unknown as BodyInit,
          // A push service never redirects. Following one would let it point us somewhere else.
          redirect: "manual",
          signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
        })
        // Free the connection; the answer is in the status.
        await response.arrayBuffer().catch(() => undefined)
        return readPushResponse(response.status)
      } catch (error) {
        return { result: "retry", error: error instanceof Error ? error.message : "The push service could not be reached.", stop: false }
      }
    }

    while (summary.processed < options.maxPushes && !summary.stopped) {
      if (deps.now().getTime() - startedAt > options.budgetMs) {
        summary.stopped = "time_budget"
        break
      }

      const { data: claimed, error: claimError } = await serviceClient.rpc("claim_push_deliveries", {
        p_limit: Math.min(PUSH_CLAIM_BATCH_SIZE, options.maxPushes - summary.processed),
        p_tenant_id: options.tenantId,
      })
      if (claimError) {
        summary.problem = "queue_unavailable"
        summary.stopped = "queue_unavailable"
        break
      }
      const rows = ((claimed as ClaimedPush[] | null) ?? []).filter((row) => row && typeof row.id === "string")
      if (rows.length === 0) break

      // Every claimed row is dealt with: sent and reported, or handed back untouched.
      for (let index = 0; index < rows.length; index += PUSH_PARALLEL) {
        const group = rows.slice(index, index + PUSH_PARALLEL)
        if (summary.stopped) {
          await Promise.all(group.map((row) => serviceClient.rpc("release_push_delivery", { p_delivery_id: row.id })))
          continue
        }
        const outcomes = await Promise.all(group.map((row) => sendOne(row)))
        await Promise.all(
          group.map((row, position) => {
            const outcome = outcomes[position]
            summary.processed += 1
            if (outcome.result === "sent") summary.sent += 1
            else {
              summary.failed += 1
              if (outcome.result === "gone") summary.gone += 1
              if (outcome.result === "retry" && outcome.stop) summary.stopped = "push_service_busy"
            }
            return serviceClient.rpc("complete_push_delivery", {
              p_delivery_id: row.id,
              p_result: outcome.result,
              p_error: outcome.result === "sent" ? null : outcome.error,
            })
          }),
        )
      }
    }
  } catch {
    // Push is an extra. A surprise here must not cost anyone an email.
    summary.problem = summary.problem ?? "error"
    summary.stopped = summary.stopped ?? "error"
  }

  return summary
}
