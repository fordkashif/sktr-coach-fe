"use client"

import { Check, Copy } from "@phosphor-icons/react"
import { useState } from "react"
import { Button, Field, Input, Notice } from "@/components/sk"
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
 * `onDone` closes the dialog it sits in.
 */
export function InviteCreatedResult({
  email,
  link,
  outcome,
  onInviteAnother,
  onDone,
}: {
  email: string
  link: string
  outcome: InviteEmailOutcome
  onInviteAnother: () => void
  onDone?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    setCopied(await copyText(link))
    window.setTimeout(() => setCopied(false), 2000)
  }
  const copyButton = (variant: "secondary" | "primary") => (
    <Button variant={variant} size="sm" onClick={() => void copy()}>
      {copied ? <Check className="size-4" weight="bold" aria-hidden /> : <Copy className="size-4" weight="bold" aria-hidden />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4" data-invite-email={outcome.sent ? "sent" : "failed"}>
      {outcome.sent ? (
        <Notice tone="success">
          Invite emailed to <span className="break-all">{email}</span>
          <span className="mt-0.5 block font-normal">
            {outcome.preview ? "Local preview: the send was recorded but no real email goes out from this setup. Use the link below." : "They join from the button in the email. Nothing else for you to do."}
          </span>
        </Notice>
      ) : (
        <Notice tone="warning">
          Invite created, but the email to <span className="break-all">{email}</span> was not sent
          <span className="mt-0.5 block font-normal">{outcome.reason} The invite still works: copy the link and send it yourself, or resend the email from Invites.</span>
        </Notice>
      )}
      <Field label="Invite link" hint="Their personal link. It works once, for the email you entered.">
        <Input readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
      </Field>
      <div className="flex flex-wrap gap-2">
        {copyButton(outcome.sent ? "secondary" : "primary")}
        <Button variant="quiet" size="sm" onClick={onInviteAnother}>
          Invite another
        </Button>
        {onDone ? (
          <Button variant="quiet" size="sm" onClick={onDone}>
            Done
          </Button>
        ) : null}
      </div>
    </div>
  )
}
