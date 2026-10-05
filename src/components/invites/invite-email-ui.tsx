"use client"

import { Check, CheckCircle, Copy, WarningCircle } from "@phosphor-icons/react"
import { useState } from "react"
import { DialogClose } from "@/components/ui/dialog"
import {
  describeInviteEmailError,
  INVITE_EMAIL_MAX_SENDS,
  type InviteEmailSent,
  type InviteEmailState,
} from "@/lib/data/invites/invite-email-data"
import type { Result } from "@/lib/data/result"

/** How the email for a just created invite went. */
export type InviteEmailOutcome = { sent: true; preview: boolean } | { sent: false; reason: string }

export function toInviteEmailOutcome(result: Result<InviteEmailSent>): InviteEmailOutcome {
  return result.ok ? { sent: true, preview: result.data.preview } : { sent: false, reason: result.error.message }
}

/** Email fields to store on an invite after a send attempt. */
export function applyInviteEmailResult<T extends InviteEmailState>(invite: T, result: Result<InviteEmailSent>): T {
  if (result.ok) {
    return {
      ...invite,
      emailSentAt: result.data.sentAt,
      emailSendCount: Math.max(result.data.sendCount, (invite.emailSendCount ?? 0) + 1),
      emailError: undefined,
    }
  }
  const cause = result.error.cause
  return { ...invite, emailError: typeof cause === "string" ? cause : "provider_failure" }
}

function shortDate(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

/** One short line for an invite list: whether and when the invite was emailed. */
export function inviteEmailSummary(invite: InviteEmailState): { text: string; problem: boolean } {
  const sentOn = shortDate(invite.emailSentAt)
  const count = invite.emailSendCount ?? 0
  if (invite.emailError) {
    const reason = describeInviteEmailError(invite.emailError)
    return {
      text: sentOn ? `Emailed ${sentOn}. The last resend failed: ${reason}` : `Email not sent: ${reason}`,
      problem: true,
    }
  }
  if (sentOn) return { text: count > 1 ? `Emailed ${count} times, last on ${sentOn}` : `Emailed ${sentOn}`, problem: false }
  return { text: "Not emailed yet", problem: false }
}

export function canResendInviteEmail(invite: InviteEmailState) {
  return (invite.emailSendCount ?? 0) < INVITE_EMAIL_MAX_SENDS
}

export function resendInviteEmailLabel(invite: InviteEmailState, busy: boolean) {
  if (busy) return "Sending..."
  return invite.emailSentAt ? "Resend email" : "Send email"
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * What an invite dialog shows once the invite exists. Emailed: the link is a quiet extra. Not emailed:
 * says why in plain words and makes "Copy link" the main action, so the inviter is never stuck.
 */
export function InviteCreatedResult({
  email,
  link,
  outcome,
  onInviteAnother,
}: {
  email: string
  link: string
  outcome: InviteEmailOutcome
  onInviteAnother: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => setCopied(await copyText(link))
  const copyLabel = copied ? "Link copied" : "Copy link"
  const copyIcon = copied ? <Check className="size-5" weight="bold" /> : <Copy className="size-5" weight="bold" />

  return (
    <div className="space-y-4" data-invite-email={outcome.sent ? "sent" : "failed"}>
      {outcome.sent ? (
        <div role="status" className="flex items-start gap-3 rounded-2xl bg-sk-green-tint p-4">
          <CheckCircle className="mt-0.5 size-6 shrink-0 text-sk-green" weight="fill" aria-hidden />
          <p className="min-w-0 text-sm leading-relaxed text-sk-ink-2">
            <span className="block break-all text-base font-bold text-sk-ink">Invite emailed to {email}</span>
            {outcome.preview
              ? "Local preview: the send was recorded but no real email goes out from this setup. Use the link below."
              : "They can join from the button in the email. Nothing else for you to do."}
          </p>
        </div>
      ) : (
        <div role="alert" className="flex items-start gap-3 rounded-2xl bg-sk-yellow-tint p-4">
          <WarningCircle className="mt-0.5 size-6 shrink-0 text-[#7a5600]" weight="fill" aria-hidden />
          <p className="min-w-0 text-sm leading-relaxed text-sk-ink-2">
            <span className="block break-all text-base font-bold text-sk-ink">Invite created, but the email to {email} was not sent</span>
            {outcome.reason} The invite still works: copy the link and send it to them yourself, or resend the email later from Invites.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-sm text-sk-mute">
          {outcome.sent ? "Their personal link, in case you want to share it another way:" : "Their personal link:"}
        </p>
        <input
          readOnly
          aria-label="Invite link"
          value={link}
          className="sk-field text-sm"
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>

      {outcome.sent ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="sk-btn sk-btn-quiet" onClick={() => void copy()}>
            {copyIcon}
            {copyLabel}
          </button>
          <button type="button" className="sk-btn sk-btn-quiet" onClick={onInviteAnother}>
            Invite another
          </button>
          <DialogClose className="sk-btn sk-btn-primary">Done</DialogClose>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="sk-btn sk-btn-quiet" onClick={onInviteAnother}>
            Invite another
          </button>
          <button type="button" className="sk-btn sk-btn-primary" onClick={() => void copy()}>
            {copyIcon}
            {copyLabel}
          </button>
        </div>
      )}
    </div>
  )
}
