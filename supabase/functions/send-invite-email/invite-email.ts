// Pure logic for send-invite-email: no network, no Deno APIs, no imports.
// Everything that decides something (who may send, whether an invite can still be sent,
// the rate limit, the link, the email itself) lives here so it can be tested on its own.

export type InviteKind = "coach" | "athlete"

export type InviteEmailErrorCode =
  | "method_not_allowed"
  | "server_misconfigured"
  | "not_authenticated"
  | "invalid_request"
  | "not_allowed"
  | "invite_not_sendable"
  | "email_not_configured"
  | "recipient_opted_out"
  | "rate_limited"
  | "provider_failure"

/** A resend is refused until this many seconds have passed since the last attempt. */
export const RESEND_COOLDOWN_SECONDS = 60
/** An invite is emailed at most this many times in total. After that, create a new invite. */
export const MAX_SENDS_PER_INVITE = 5

export const APP_NAME = "SKTR Coach"
const BRAND_BLUE = "#2152ff"
const FONT_STACK = "Outfit, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/

export function parseInvitePayload(value: unknown): { kind: InviteKind; inviteId: string } | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const kind = record.kind
  const inviteId = typeof record.inviteId === "string" ? record.inviteId.trim() : ""
  if (kind !== "coach" && kind !== "athlete") return null
  if (!UUID_PATTERN.test(inviteId)) return null
  return { kind, inviteId: inviteId.toLowerCase() }
}

export function isValidRecipientEmail(value: string | null | undefined): value is string {
  return typeof value === "string" && EMAIL_PATTERN.test(value.trim())
}

/**
 * Mirrors the RLS insert policies on the invite tables:
 *   coach_invites    is_club_admin()     and tenant_id = current_tenant_id()
 *   athlete_invites  is_coach_or_admin() and tenant_id = current_tenant_id()
 * The three inputs come from those same database functions, called as the signed-in user, so an
 * inactive member or a member of a suspended club is refused here exactly as the database refuses them.
 */
export function canSendInvite(params: {
  kind: InviteKind
  callerTenantId: string | null
  callerIsClubAdmin: boolean
  callerIsCoachOrAdmin: boolean
  inviteTenantId: string | null
}): boolean {
  if (!params.callerTenantId || !params.inviteTenantId) return false
  if (params.callerTenantId !== params.inviteTenantId) return false
  return params.kind === "coach" ? params.callerIsClubAdmin : params.callerIsCoachOrAdmin
}

export type SendableDecision =
  | { sendable: true }
  | { sendable: false; reason: "accepted" | "revoked" | "expired" | "no_email" }

export function checkInviteSendable(
  invite: { status: string; expires_at: string | null; email: string | null },
  nowMs: number,
): SendableDecision {
  if (invite.status === "accepted") return { sendable: false, reason: "accepted" }
  if (invite.status === "revoked") return { sendable: false, reason: "revoked" }
  if (invite.status !== "pending") return { sendable: false, reason: "expired" }
  if (invite.expires_at) {
    const expiresMs = new Date(invite.expires_at).getTime()
    if (Number.isNaN(expiresMs) || expiresMs < nowMs) return { sendable: false, reason: "expired" }
  }
  if (!isValidRecipientEmail(invite.email)) return { sendable: false, reason: "no_email" }
  return { sendable: true }
}

export function describeNotSendable(reason: "accepted" | "revoked" | "expired" | "no_email") {
  if (reason === "accepted") return "This invite has already been accepted."
  if (reason === "revoked") return "This invite was cancelled. Create a new invite instead."
  if (reason === "expired") return "This invite has expired. Create a new invite instead."
  return "This invite has no valid email address."
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: "cooldown"; retryAfterSeconds: number }
  | { allowed: false; reason: "max_sends" }

export function checkRateLimit(
  invite: { email_send_count: number | null; last_email_attempt_at: string | null },
  nowMs: number,
): RateLimitDecision {
  if ((invite.email_send_count ?? 0) >= MAX_SENDS_PER_INVITE) return { allowed: false, reason: "max_sends" }
  if (invite.last_email_attempt_at) {
    const lastMs = new Date(invite.last_email_attempt_at).getTime()
    if (!Number.isNaN(lastMs)) {
      const elapsedSeconds = (nowMs - lastMs) / 1000
      if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
        return {
          allowed: false,
          reason: "cooldown",
          retryAfterSeconds: Math.max(1, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsedSeconds)),
        }
      }
    }
  }
  return { allowed: true }
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

/** The page the invited person has to land on. The base is always the server-side configured app URL. */
export function buildClaimLink(baseUrl: string, kind: InviteKind, inviteId: string): string {
  const path = kind === "coach" ? `/invite/coach/${encodeURIComponent(inviteId)}` : `/athlete/claim/${encodeURIComponent(inviteId)}`
  return `${baseUrl}${path}`
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Names come from user input. Keep them to one tidy line so they cannot break a subject or the layout. */
export function cleanName(value: string | null | undefined, maxLength = 80): string {
  const cleaned = (value ?? "").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim()
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** "20 October 2026". Uses the UTC calendar day so the same invite always shows the same date. */
export function formatExpiryDate(expiresAt: string | null): string | null {
  if (!expiresAt) return null
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

export type InviteEmailInput = {
  kind: InviteKind
  recipientEmail: string
  inviterName: string | null
  clubName: string | null
  teamName: string | null
  claimLink: string
  expiresAt: string | null
}

export type RenderedInviteEmail = {
  subject: string
  text: string
  html: string
}

export function renderInviteEmail(input: InviteEmailInput): RenderedInviteEmail {
  const club = cleanName(input.clubName) || "your club"
  const team = cleanName(input.teamName)
  const inviter = cleanName(input.inviterName)
  const expiry = formatExpiryDate(input.expiresAt)
  const isCoach = input.kind === "coach"

  const fallbackInviter = isCoach ? `A club admin at ${club}` : `Your coach at ${club}`
  const who = inviter || fallbackInviter

  let headline: string
  let subject: string
  let intro: string
  if (isCoach) {
    headline = `You are invited to coach at ${club}`
    subject = inviter ? `${inviter} invited you to coach at ${club}` : `You are invited to coach at ${club}`
    intro = team
      ? `${who} invited you to join ${club} on ${APP_NAME} as a coach for ${team}.`
      : `${who} invited you to join ${club} on ${APP_NAME} as a coach.`
  } else {
    const teamLabel = team || "the team"
    headline = `You are invited to join ${teamLabel}`
    subject = inviter ? `${inviter} invited you to join ${teamLabel} at ${club}` : `You are invited to join ${teamLabel} at ${club}`
    intro = `${who} invited you to join ${teamLabel} at ${club} on ${APP_NAME} as an athlete.`
  }

  const whatNext = isCoach
    ? "Accept the invite to set up your account, then start building plans and managing your athletes."
    : "Accept the invite to set up your account, then see your training plan and log your sessions."
  const buttonLabel = "Accept invite"
  const validity = expiry
    ? `This link is just for ${input.recipientEmail} and works until ${expiry}.`
    : `This link is just for ${input.recipientEmail}.`
  const ignore = `Not expecting this? You can ignore this email and nothing will happen.`

  const text = [
    headline,
    "",
    intro,
    "",
    whatNext,
    "",
    `${buttonLabel}:`,
    input.claimLink,
    "",
    validity,
    "",
    ignore,
    "",
    `Sent by ${APP_NAME} on behalf of ${club}.`,
  ].join("\n")

  const e = escapeHtml
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
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ffffff;">${e(intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;">
<tr>
<td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr>
<td style="padding:0 4px 20px;font-family:${FONT_STACK};font-size:18px;line-height:24px;font-weight:800;letter-spacing:-0.01em;color:${BRAND_BLUE};">${e(APP_NAME)}</td>
</tr>
<tr>
<td style="border:2px solid #e6e9f2;border-radius:20px;padding:32px 28px;background-color:#ffffff;">
<h1 style="margin:0 0 16px;font-family:${FONT_STACK};font-size:28px;line-height:34px;font-weight:800;letter-spacing:-0.02em;color:#0b1020;">${e(headline)}</h1>
<p style="margin:0 0 12px;font-family:${FONT_STACK};font-size:17px;line-height:26px;color:#0b1020;">${e(intro)}</p>
<p style="margin:0 0 28px;font-family:${FONT_STACK};font-size:16px;line-height:25px;color:#4a5169;">${e(whatNext)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr>
<td align="center" bgcolor="${BRAND_BLUE}" style="border-radius:14px;background-color:${BRAND_BLUE};">
<a href="${e(input.claimLink)}" style="display:block;padding:17px 24px;font-family:${FONT_STACK};font-size:18px;line-height:22px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:14px;">${e(buttonLabel)}</a>
</td>
</tr>
</table>
<p style="margin:24px 0 6px;font-family:${FONT_STACK};font-size:14px;line-height:21px;color:#4a5169;">Button not working? Copy this link into your browser:</p>
<p style="margin:0 0 24px;font-family:${FONT_STACK};font-size:14px;line-height:21px;word-break:break-all;"><a href="${e(input.claimLink)}" style="color:${BRAND_BLUE};text-decoration:underline;">${e(input.claimLink)}</a></p>
<p style="margin:0;padding:14px 16px;border-radius:12px;background-color:#eef2ff;font-family:${FONT_STACK};font-size:14px;line-height:21px;color:#0b1020;">${e(validity)}</p>
</td>
</tr>
<tr>
<td style="padding:20px 4px 0;font-family:${FONT_STACK};font-size:13px;line-height:20px;color:#6b7289;">
<p style="margin:0 0 6px;">${e(ignore)}</p>
<p style="margin:0;">Sent by ${e(APP_NAME)} on behalf of ${e(club)}.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`

  return { subject: cleanName(subject, 160), text, html }
}
