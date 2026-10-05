import { err, ok, type DataErrorCode, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

export type InviteEmailKind = "coach" | "athlete"

/** Machine codes returned by the send-invite-email edge function, plus "unreachable" for network trouble. */
export type InviteEmailFailureCode =
  | "email_not_configured"
  | "invite_not_sendable"
  | "not_allowed"
  | "rate_limited"
  | "provider_failure"
  | "recipient_opted_out"
  | "unreachable"

export type InviteEmailSent = {
  sentAt: string
  sendCount: number
  /** True on a local stack with no email provider: the send was recorded but nothing was delivered. */
  preview: boolean
}

/** What the invite lists show about the email for one invite. */
export type InviteEmailState = {
  emailSentAt?: string | null
  emailSendCount?: number
  /** Machine code of the last failed attempt. Cleared by the next successful send. */
  emailError?: string | null
}

/** An invite is emailed at most this many times. Mirrors MAX_SENDS_PER_INVITE in the edge function. */
export const INVITE_EMAIL_MAX_SENDS = 5

/** Columns added by 20261006090000_invite_email_delivery.sql. */
export const INVITE_EMAIL_COLUMNS = "last_email_sent_at, email_send_count, last_email_error"

/** True when a read failed only because the invite email columns are not in the database yet. */
export function isMissingInviteEmailColumns(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return error.code === "42703" || error.code === "PGRST204" || /last_email_|email_send_count/.test(error.message ?? "")
}

/**
 * Mock mode only. Set localStorage "pacelab:mock-invite-email-fail" to a failure code to see the
 * "email could not be sent" state in the demo. Remove it to go back to simulated success.
 */
const MOCK_FAILURE_STORAGE_KEY = "pacelab:mock-invite-email-fail"

const FAILURE_COPY: Record<InviteEmailFailureCode, { dataCode: DataErrorCode; message: string }> = {
  email_not_configured: { dataCode: "UNKNOWN", message: "Email sending is not set up for this club's environment yet." },
  invite_not_sendable: { dataCode: "CONFLICT", message: "This invite is no longer waiting, so it cannot be emailed." },
  not_allowed: { dataCode: "FORBIDDEN", message: "Your account is not allowed to email this invite." },
  rate_limited: { dataCode: "CONFLICT", message: "This invite was emailed a moment ago. Wait a minute, then try again." },
  provider_failure: { dataCode: "UNKNOWN", message: "The email service did not accept it. Try again in a moment." },
  recipient_opted_out: { dataCode: "CONFLICT", message: "This person has turned off emails from SKTR Coach." },
  unreachable: { dataCode: "UNKNOWN", message: "The email service could not be reached. Check your connection and try again." },
}

function isFailureCode(value: unknown): value is InviteEmailFailureCode {
  return typeof value === "string" && value in FAILURE_COPY
}

/** Plain words for a stored failure code, for the invite lists. */
export function describeInviteEmailError(code: string | null | undefined): string | null {
  if (!code) return null
  return isFailureCode(code) ? FAILURE_COPY[code].message : "The invite email could not be sent."
}

/** The machine code behind a failed send, when there is one. */
export function inviteEmailFailureCode(result: Result<unknown>): InviteEmailFailureCode | null {
  if (result.ok) return null
  return isFailureCode(result.error.cause) ? result.error.cause : null
}

function failure(code: InviteEmailFailureCode, body?: { reason?: string; retryAfterSeconds?: number; error?: string }): Result<InviteEmailSent> {
  let message = FAILURE_COPY[code].message
  if (code === "rate_limited" && body?.reason === "max_sends") {
    message = `This invite has been emailed ${INVITE_EMAIL_MAX_SENDS} times, which is the limit. Cancel it and create a new invite to send again.`
  } else if (code === "rate_limited" && typeof body?.retryAfterSeconds === "number") {
    message = `This invite was emailed a moment ago. Try again in ${body.retryAfterSeconds} seconds.`
  } else if (code === "invite_not_sendable" && body?.error) {
    message = body.error
  }
  return err(FAILURE_COPY[code].dataCode, message, code)
}

type FunctionBody = {
  ok?: boolean
  code?: string
  error?: string
  reason?: string
  retryAfterSeconds?: number
  sentAt?: string
  sendCount?: number
  preview?: boolean
}

/**
 * Emails a pending coach or athlete invite to the invited person. Call it right after creating the
 * invite, and again for "Resend email". A failure never affects the invite itself: the link still works.
 */
export async function sendInviteEmail(params: { kind: InviteEmailKind; inviteId: string }): Promise<Result<InviteEmailSent>> {
  if (getBackendMode() !== "supabase") {
    const forced = typeof window === "undefined" ? null : window.localStorage.getItem(MOCK_FAILURE_STORAGE_KEY)
    if (isFailureCode(forced)) return failure(forced)
    return ok({ sentAt: new Date().toISOString(), sendCount: 1, preview: false })
  }

  const client = getBrowserSupabaseClient()
  if (!client) return failure("unreachable")

  // Only the invite id is sent. The recipient and the link are worked out on the server.
  const { data, error } = await client.functions.invoke("send-invite-email", {
    body: { kind: params.kind, inviteId: params.inviteId },
  })

  let body = (data ?? null) as FunctionBody | null
  if (error) {
    body = null
    try {
      // supabase-js keeps the function's real reply on error.context (a Response) for non-2xx statuses.
      const context = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } }).context
      if (context && typeof context.clone === "function") body = (await context.clone().json()) as FunctionBody
    } catch {
      body = null
    }
    if (!body) return failure("unreachable")
  }

  if (body?.ok && body.sentAt) {
    return ok({ sentAt: body.sentAt, sendCount: body.sendCount ?? 1, preview: body.preview === true })
  }
  if (isFailureCode(body?.code)) return failure(body.code, body ?? undefined)
  return failure("unreachable")
}

/* ---------- Several invites at once ----------------------------------------------------------- */

/** Invites emailed per call to the edge function. Mirrors nothing on the server, which accepts up to 25. */
export const INVITE_EMAIL_BATCH_SIZE = 10

export type InviteEmailBatchItem = { inviteId: string; result: Result<InviteEmailSent> }

function bodyToResult(body: FunctionBody | null | undefined): Result<InviteEmailSent> {
  if (body?.ok && body.sentAt) return ok({ sentAt: body.sentAt, sendCount: body.sendCount ?? 1, preview: body.preview === true })
  if (isFailureCode(body?.code)) return failure(body.code, body ?? undefined)
  return failure("unreachable")
}

/**
 * Emails many pending invites of one kind. They go out in small batches, one batch per request and
 * one email at a time inside it, and `onProgress` is told after every batch, so the screen can show
 * "12 of 40 sent". Every invite gets the same checks as a single send. A failure never stops the
 * rest: the answer has one entry per invite, in the order given, and the failed ones can be passed
 * in again to retry.
 */
export async function sendInviteEmails(
  params: { kind: InviteEmailKind; inviteIds: string[] },
  onProgress?: (done: InviteEmailBatchItem[], total: number) => void,
): Promise<InviteEmailBatchItem[]> {
  const ids = [...new Set(params.inviteIds)]
  const done: InviteEmailBatchItem[] = []
  const report = () => onProgress?.([...done], ids.length)

  if (getBackendMode() !== "supabase") {
    // Demo: one at a time with a short pause, so the progress is visible.
    for (const inviteId of ids) {
      await new Promise((resolve) => setTimeout(resolve, 60))
      done.push({ inviteId, result: await sendInviteEmail({ kind: params.kind, inviteId }) })
      report()
    }
    return done
  }

  const client = getBrowserSupabaseClient()
  for (let start = 0; start < ids.length; start += INVITE_EMAIL_BATCH_SIZE) {
    const chunk = ids.slice(start, start + INVITE_EMAIL_BATCH_SIZE)
    if (!client) {
      for (const inviteId of chunk) done.push({ inviteId, result: failure("unreachable") })
      report()
      continue
    }

    type BatchBody = { ok?: boolean; batch?: boolean; results?: Array<FunctionBody & { inviteId?: string }> }
    let body: BatchBody | null = null
    try {
      const { data, error } = await client.functions.invoke("send-invite-email", { body: { kind: params.kind, inviteIds: chunk } })
      body = error ? null : ((data ?? null) as BatchBody | null)
    } catch {
      body = null
    }

    if (body?.batch && Array.isArray(body.results)) {
      const byId = new Map(body.results.map((item) => [String(item.inviteId ?? "").toLowerCase(), item]))
      for (const inviteId of chunk) done.push({ inviteId, result: bodyToResult(byId.get(inviteId.toLowerCase())) })
    } else {
      // An edge function that does not know the batch form yet (not deployed), or a network failure:
      // fall back to one request per invite. The per-invite checks are the same either way.
      for (const inviteId of chunk) done.push({ inviteId, result: await sendInviteEmail({ kind: params.kind, inviteId }) })
    }
    report()
  }
  return done
}
