// HTTP handler for dispatch-notification-emails. Everything it touches from the outside world
// (environment, Supabase clients, fetch, the clock, waiting) is passed in, so the whole flow can be
// exercised without a network. index.ts wires in the real things.
//
// The queue itself lives in the database (migration 20261007090000):
//   claim_notification_emails     hands out rows with FOR UPDATE SKIP LOCKED, so two runs at the same
//                                 moment never get the same email, and holds back what must not be
//                                 sent (deactivated recipient, suspended club, switched off, too old).
//   complete_notification_email   records sent / failed and schedules the retry.
// This file only decides who may start a run, sends what it is handed, and reports back.
//
// Push notifications ride in the same run (push-dispatch.ts): their own queue and claimed state,
// worked BEFORE the email settings are looked at, so push goes out where email is not set up and a
// failing push never holds an email back. Every answer carries a "push" summary.

import {
  APP_NAME,
  CLAIM_BATCH_SIZE,
  isLocalBaseUrl,
  normalizeAppBaseUrl,
  readProviderResponse,
  renderNotificationEmail,
  SEND_SPACING_MS,
  type DispatchErrorCode,
  type ProviderOutcome,
  type QueuedEmail,
} from "./notification-email.ts"
import { runPushDispatch } from "./push-dispatch.ts"

// The Supabase client is used structurally so tests can pass a small fake.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any

export type HandlerDeps = {
  getEnv: (name: string) => string | undefined
  /** Client that carries the caller's JWT: used only to identify the caller and ask the database who they are. */
  createUserClient: (supabaseUrl: string, anonKey: string, authorization: string) => LooseClient
  /** Service role client: works the queue. Never returned to the caller. */
  createServiceClient: (supabaseUrl: string, serviceRoleKey: string) => LooseClient
  fetch: typeof fetch
  now: () => Date
  sleep: (ms: number) => Promise<void>
}

export const SCHEDULER_TOKEN_HEADER = "x-sktr-scheduler-token"

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type Mode = "scheduler" | "platform-admin" | "member"

/** How many emails one run may send, and for how long it may keep going. */
const RUN_LIMITS: Record<Mode, { maxEmails: number; budgetMs: number }> = {
  scheduler: { maxEmails: 200, budgetMs: 25_000 },
  "platform-admin": { maxEmails: 100, budgetMs: 25_000 },
  member: { maxEmails: 60, budgetMs: 20_000 },
}

/** How many pushes one run may send, and for how long the push part may keep going. */
const PUSH_RUN_LIMITS: Record<Mode, { maxPushes: number; budgetMs: number }> = {
  scheduler: { maxPushes: 400, budgetMs: 12_000 },
  "platform-admin": { maxPushes: 200, budgetMs: 12_000 },
  member: { maxPushes: 120, budgetMs: 8_000 },
}

type DispatchResult = {
  id: string
  status: "sent" | "failed"
  error?: string
  actionLink?: string
  recipientEmail?: string
  subject?: string
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function fail(status: number, code: DispatchErrorCode, message: string, extra: Record<string, unknown> = {}) {
  return json(status, { ok: false, code, error: message, ...extra })
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parsePayload(value: unknown): { limit: number | null; eventIds: string[] | null } {
  if (!value || typeof value !== "object") return { limit: null, eventIds: null }
  const record = value as Record<string, unknown>
  const limit = typeof record.limit === "number" && Number.isFinite(record.limit) ? Math.floor(record.limit) : null
  const eventIds = Array.isArray(record.eventIds)
    ? record.eventIds.filter((item): item is string => typeof item === "string" && UUID_PATTERN.test(item)).slice(0, 100)
    : null
  return { limit, eventIds: eventIds && eventIds.length > 0 ? eventIds : null }
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return difference === 0
}

export async function handleDispatchNotificationEmails(request: Request, deps: HandlerDeps): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return fail(405, "method_not_allowed", "Method not allowed.")

  const supabaseUrl = deps.getEnv("SUPABASE_URL")
  const supabaseAnonKey = deps.getEnv("SUPABASE_ANON_KEY")
  const supabaseServiceRoleKey = deps.getEnv("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return fail(500, "server_misconfigured", "Missing Supabase function environment.")
  }

  let rawPayload: unknown = null
  try {
    rawPayload = await request.json()
  } catch {
    rawPayload = null
  }
  const payload = parsePayload(rawPayload)

  const serviceClient = deps.createServiceClient(supabaseUrl, supabaseServiceRoleKey)

  // 1. Who is asking?
  let mode: Mode
  let tenantId: string | null = null
  const schedulerToken = request.headers.get(SCHEDULER_TOKEN_HEADER)
  const authorization = request.headers.get("Authorization")
  const bearer = authorization?.replace(/^Bearer\s+/i, "").trim() ?? ""

  if (schedulerToken !== null) {
    // The database scheduler. The token was made by the migration and never leaves the database
    // except in this header; the database is asked whether it matches.
    const { data: tokenOk, error: tokenError } = await serviceClient.rpc("verify_notification_scheduler_token", {
      p_token: schedulerToken,
    })
    if (tokenError || tokenOk !== true) return fail(401, "bad_scheduler_token", "The scheduler token is not valid.")
    mode = "scheduler"
  } else if (!authorization) {
    return fail(401, "not_authenticated", "Sign in to send notification emails.")
  } else if (sameSecret(bearer, supabaseServiceRoleKey)) {
    // The deploy workflow, right after a deploy: starts a run and lets the function register its address.
    mode = "scheduler"
  } else {
    const userClient = deps.createUserClient(supabaseUrl, supabaseAnonKey, authorization)
    const { data: authData, error: authError } = await userClient.auth.getUser()
    if (authError || !authData?.user) return fail(401, "not_authenticated", "Sign in to send notification emails.")

    const { data: platformAdminContact, error: platformAdminError } = await userClient
      .from("platform_admin_contacts")
      .select("id")
      .limit(1)
      .maybeSingle()

    if (!platformAdminError && platformAdminContact) {
      mode = "platform-admin"
    } else {
      // An active member of an open club may ask for their own club's queue, nothing more.
      // current_tenant_id() answers NULL for a deactivated member and for a suspended or cancelled club.
      const { data: callerTenantId, error: tenantError } = await userClient.rpc("current_tenant_id")
      if (tenantError || typeof callerTenantId !== "string" || !callerTenantId) {
        return fail(403, "not_allowed", "You are not allowed to send notification emails.")
      }
      mode = "member"
      tenantId = callerTenantId
    }
  }

  // 2. Tell the database where this function lives, so its scheduler needs no setup. Best effort.
  try {
    await serviceClient.rpc("register_notification_dispatch_url", {
      p_url: `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/dispatch-notification-emails`,
    })
  } catch {
    // The scheduler simply stays unregistered; this run still sends.
  }

  // 2b. Push first. It never throws and never stops what follows.
  const push = await runPushDispatch(serviceClient, deps, { tenantId, ...PUSH_RUN_LIMITS[mode] })

  // 3. Can email be sent at all? Checked before anything is claimed, so a missing setting does not
  //    use up delivery attempts.
  const appBaseUrl = normalizeAppBaseUrl(deps.getEnv("PUBLIC_APP_URL"))
  const resendApiKey = deps.getEnv("RESEND_API_KEY")
  const fromEmail = deps.getEnv("NOTIFICATION_FROM_EMAIL")
  const providerConfigured = Boolean(resendApiKey && fromEmail)
  // Local preview: a local stack whose app URL is localhost and has no email provider. Nothing is sent.
  const isLocalPreview = !providerConfigured && isLocalBaseUrl(appBaseUrl)

  if (!appBaseUrl || (!providerConfigured && !isLocalPreview)) {
    return fail(503, "email_not_configured", "Email sending is not set up for this environment yet.", {
      missing: [
        ...(appBaseUrl ? [] : ["PUBLIC_APP_URL"]),
        ...(resendApiKey ? [] : ["RESEND_API_KEY"]),
        ...(fromEmail ? [] : ["NOTIFICATION_FROM_EMAIL"]),
      ],
      push,
    })
  }

  // 4. Work the queue.
  const limits = RUN_LIMITS[mode]
  const maxEmails = mode === "platform-admin" && payload.limit ? Math.max(1, Math.min(payload.limit, limits.maxEmails)) : limits.maxEmails
  const eventIds = mode === "platform-admin" ? payload.eventIds : null
  const startedAt = deps.now().getTime()
  const results: DispatchResult[] = []
  let stopped: string | null = null

  const sendOne = async (row: QueuedEmail): Promise<{ outcome: ProviderOutcome; actionLink: string; subject: string }> => {
    const email = renderNotificationEmail(row, appBaseUrl)
    if (isLocalPreview) return { outcome: { sent: true, messageId: null }, actionLink: email.actionLink, subject: email.subject }
    try {
      const response = await deps.fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
          // The same queue row is never delivered twice, even if this run dies after the provider
          // accepted the email and before the database heard about it.
          "Idempotency-Key": `sktr-notification-${row.id}`,
        },
        body: JSON.stringify({
          from: fromEmail!.includes("<") ? fromEmail : `${APP_NAME} <${fromEmail}>`,
          to: [row.recipient_email],
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
      })
      const body = (await response.json().catch(() => null)) as { id?: unknown; message?: unknown } | null
      return { outcome: readProviderResponse(response.status, body), actionLink: email.actionLink, subject: email.subject }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email provider request failed."
      return { outcome: { sent: false, error: message, retry: true, stop: false }, actionLink: email.actionLink, subject: email.subject }
    }
  }

  let firstSend = true
  while (results.length < maxEmails && !stopped) {
    if (deps.now().getTime() - startedAt > limits.budgetMs) {
      stopped = "time_budget"
      break
    }

    const { data: claimed, error: claimError } = await serviceClient.rpc("claim_notification_emails", {
      p_limit: Math.min(CLAIM_BATCH_SIZE, maxEmails - results.length),
      p_tenant_id: tenantId,
      p_event_ids: eventIds,
      p_ignore_backoff: mode === "platform-admin",
    })
    if (claimError) {
      if (results.length === 0) return fail(500, "queue_unavailable", "The email queue could not be read.", { push })
      stopped = "queue_unavailable"
      break
    }
    const rows = ((claimed as QueuedEmail[] | null) ?? []).filter((row) => row && typeof row.id === "string")
    if (rows.length === 0) break

    // Every claimed row is dealt with, even after a stop: a claimed row left alone would wait ten minutes.
    for (const row of rows) {
      if (stopped) {
        // Hand the row back untouched (no attempt used up); the next run takes it.
        await serviceClient
          .from("notification_events")
          .update({ processing_started_at: null, delivery_attempt_count: Math.max(0, row.delivery_attempt_count - 1) })
          .eq("id", row.id)
          .eq("channel", "email")
        continue
      }

      if (!firstSend && !isLocalPreview) await deps.sleep(SEND_SPACING_MS)
      firstSend = false

      const { outcome, actionLink, subject } = await sendOne(row)
      if (outcome.sent) {
        await serviceClient.rpc("complete_notification_email", {
          p_event_id: row.id,
          p_sent: true,
          p_provider_message_id: outcome.messageId,
          p_error: null,
          p_retry: true,
        })
        results.push({ id: row.id, status: "sent", actionLink, recipientEmail: row.recipient_email, subject })
      } else {
        await serviceClient.rpc("complete_notification_email", {
          p_event_id: row.id,
          p_sent: false,
          p_provider_message_id: null,
          p_error: outcome.error,
          p_retry: outcome.retry,
        })
        results.push({ id: row.id, status: "failed", error: outcome.error })
        if (outcome.stop) stopped = "provider"
      }
    }
  }

  const sent = results.filter((item) => item.status === "sent").length
  const failed = results.length - sent
  const summary = { processed: results.length, sent, failed, stopped, preview: isLocalPreview }

  try {
    await serviceClient.rpc("record_notification_dispatch_run", { p_mode: mode, p_summary: { ...summary, push } })
  } catch {
    // Bookkeeping for the platform admin dashboard only.
  }

  // Only the platform admin sees who was emailed. A member learns how many, the scheduler nothing more.
  return json(200, {
    ok: true,
    mode,
    ...summary,
    push,
    results: mode === "platform-admin" ? results : [],
  })
}
