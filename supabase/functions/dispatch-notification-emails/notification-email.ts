// Pure logic for dispatch-notification-emails: no network, no Deno APIs.
// What a queued notification looks like as an email, where its button goes, and how a provider
// answer is read. Everything that decides something lives here so it can be tested on its own.

import {
  NOTIFICATION_SETTINGS_PATH,
  notificationActionLabel,
  notificationTargetPath,
  type NotificationRole,
} from "../_shared/notification-target.ts"

export type DispatchErrorCode =
  | "method_not_allowed"
  | "server_misconfigured"
  | "not_authenticated"
  | "bad_scheduler_token"
  | "not_allowed"
  | "email_not_configured"
  | "queue_unavailable"

export const APP_NAME = "SKTR Coach"
const BRAND_BLUE = "#2152ff"
const FONT_STACK = "Outfit, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** Emails claimed from the queue per round trip to the database. */
export const CLAIM_BATCH_SIZE = 10
/** Pause between two sends. The provider allows two requests a second. */
export const SEND_SPACING_MS = 550

export type QueuedEmail = {
  id: string
  tenant_id: string | null
  tenant_name: string | null
  recipient_user_id: string | null
  recipient_email: string
  recipient_role: string | null
  event_type: string
  subject: string
  body: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  delivery_attempt_count: number
}

export type RenderedNotificationEmail = {
  subject: string
  text: string
  html: string
  /** Where the button goes: the app's own address plus the screen for this notification. */
  actionLink: string
  settingsLink: string
}

/** Origin of the configured app URL, or null when it is missing or not http(s). */
export function normalizeAppBaseUrl(value: string | null | undefined): string | null {
  const candidate = value?.trim()
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return url.origin
  } catch {
    return null
  }
}

export function isLocalBaseUrl(origin: string | null): boolean {
  if (!origin) return false
  try {
    const url = new URL(origin)
    return url.hostname === "localhost" || url.hostname === "127.0.0.1"
  } catch {
    return false
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Subjects and names can hold text people typed. Keep them to one tidy line. */
export function cleanLine(value: string | null | undefined, maxLength = 160): string {
  const cleaned = (value ?? "").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim()
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned
}

function asRole(value: string | null | undefined): NotificationRole | null {
  return value === "athlete" || value === "coach" || value === "club-admin" || value === "platform-admin" ? value : null
}

/**
 * The body as short paragraphs. Older club request notifications pack their fields into one line
 * separated by " | "; those become one line each. Nothing in the body is trusted as markup.
 */
export function bodyParagraphs(eventType: string, body: string | null): string[] {
  const text = (body ?? "").replace(/\r/g, "").trim()
  if (!text) return []
  const parts = eventType.startsWith("tenant_provision_request_") && text.includes(" | ") ? text.split(" | ") : text.split(/\n+/)
  return parts.map((part) => cleanLine(part, 600)).filter(Boolean)
}

export function renderNotificationEmail(row: QueuedEmail, appBaseUrl: string): RenderedNotificationEmail {
  const role = asRole(row.recipient_role)
  const subject = cleanLine(row.subject) || `An update from ${APP_NAME}`
  const paragraphs = bodyParagraphs(row.event_type, row.body)
  const club = cleanLine(row.tenant_name, 80)
  const actionLink = `${appBaseUrl}${notificationTargetPath(row.event_type, row.metadata, role)}`
  const settingsLink = `${appBaseUrl}${NOTIFICATION_SETTINGS_PATH}`
  const buttonLabel = notificationActionLabel(row.event_type)
  const preview = paragraphs[0] ?? subject
  const whyLine = `You are getting this email because email notifications are on for your ${APP_NAME} account.`
  const offLine = "To turn these emails off, open your notification settings:"
  const sentBy = club ? `Sent by ${APP_NAME} on behalf of ${club}.` : `Sent by ${APP_NAME}.`

  const text = [
    subject,
    "",
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
    `${buttonLabel}:`,
    actionLink,
    "",
    whyLine,
    offLine,
    settingsLink,
    "",
    sentBy,
  ].join("\n")

  const e = escapeHtml
  const bodyHtml = paragraphs
    .map(
      (paragraph, index) =>
        `<p style="margin:0 0 ${index === paragraphs.length - 1 ? 28 : 12}px;font-family:${FONT_STACK};font-size:17px;line-height:26px;color:#0b1020;">${e(paragraph)}</p>`,
    )
    .join("\n")

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;color:#0b1020;font-family:${FONT_STACK};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ffffff;">${e(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;">
<tr>
<td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr>
<td style="padding:0 4px 20px;font-family:${FONT_STACK};font-size:18px;line-height:24px;font-weight:800;letter-spacing:-0.01em;color:${BRAND_BLUE};">${e(APP_NAME)}</td>
</tr>
<tr>
<td style="border:2px solid #e6e9f2;border-radius:20px;padding:32px 28px;background-color:#ffffff;">
<h1 style="margin:0 0 ${paragraphs.length > 0 ? 16 : 28}px;font-family:${FONT_STACK};font-size:28px;line-height:34px;font-weight:800;letter-spacing:-0.02em;color:#0b1020;">${e(subject)}</h1>
${bodyHtml}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr>
<td align="center" bgcolor="${BRAND_BLUE}" style="border-radius:14px;background-color:${BRAND_BLUE};">
<a href="${e(actionLink)}" style="display:block;padding:17px 24px;font-family:${FONT_STACK};font-size:18px;line-height:22px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:14px;">${e(buttonLabel)}</a>
</td>
</tr>
</table>
<p style="margin:24px 0 6px;font-family:${FONT_STACK};font-size:14px;line-height:21px;color:#4a5169;">Button not working? Copy this link into your browser:</p>
<p style="margin:0;font-family:${FONT_STACK};font-size:14px;line-height:21px;word-break:break-all;"><a href="${e(actionLink)}" style="color:${BRAND_BLUE};text-decoration:underline;">${e(actionLink)}</a></p>
</td>
</tr>
<tr>
<td style="padding:20px 4px 0;font-family:${FONT_STACK};font-size:13px;line-height:20px;color:#6b7289;">
<p style="margin:0 0 6px;">${e(whyLine)} To turn these emails off, open your <a href="${e(settingsLink)}" style="color:${BRAND_BLUE};text-decoration:underline;">notification settings</a>.</p>
<p style="margin:0;">${e(sentBy)}</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`

  return { subject, text, html, actionLink, settingsLink }
}

export type ProviderOutcome =
  | { sent: true; messageId: string | null }
  /** retry: try this email again later. stop: do not send anything else in this run. */
  | { sent: false; error: string; retry: boolean; stop: boolean }

/**
 * Reads the email provider's answer.
 *   2xx              sent
 *   422              the provider will never accept this email (bad address): no retry
 *   429              rate limited: retry later and stop this run
 *   401, 403         our key or sender is wrong: retry later and stop this run (every email would fail)
 *   anything else    retry later
 */
export function readProviderResponse(status: number, body: { id?: unknown; message?: unknown } | null): ProviderOutcome {
  if (status >= 200 && status < 300) {
    return { sent: true, messageId: typeof body?.id === "string" ? body.id : null }
  }
  const message = typeof body?.message === "string" && body.message.trim() ? cleanLine(body.message, 300) : `Email provider answered ${status}.`
  if (status === 422) return { sent: false, error: message, retry: false, stop: false }
  if (status === 429 || status === 401 || status === 403) return { sent: false, error: message, retry: true, stop: true }
  return { sent: false, error: message, retry: true, stop: false }
}
