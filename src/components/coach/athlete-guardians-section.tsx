"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { ActionRow, Button, Dialog, EmptyState, Field, InlineConfirm, Input, List, Notice, RowMenu, Section, Select, SkeletonRows, StatusText, notify, notifyError } from "@/components/sk"
import {
  cancelGuardianInvite,
  getAthleteGuardians,
  guardianInviteLink,
  GUARDIANS_CHANGED_EVENT,
  inviteGuardian,
  RELATIONSHIP_OPTIONS,
  resendGuardianInvite,
  revokeGuardianLink,
} from "@/lib/data/guardian/guardian-admin-data"
import type { AthleteGuardians } from "@/lib/data/guardian/types"
import { healthRuleText } from "@/lib/guardian/health-visibility"

function shortDate(iso: string | null) {
  if (!iso) return ""
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

/**
 * Parents and guardians of one athlete, on the coach's athlete page. A lead or coach of the
 * athlete's team, or a club admin, invites a guardian by email and can end their access at any
 * time. The section stays away for anyone who may not manage guardians (an assistant coach).
 */
export function AthleteGuardiansSection({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  const first = athleteName.split(" ")[0] || athleteName
  const [data, setData] = useState<AthleteGuardians | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ kind: "link" | "invite"; id: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const result = await getAthleteGuardians(athleteId)
    if (result.ok) {
      setData(result.data)
      setLoadError(null)
    } else {
      setData(null)
      setLoadError(result.error.message)
    }
  }, [athleteId])

  useEffect(() => {
    setData(undefined)
    void load()
    const onChange = () => void load()
    window.addEventListener(GUARDIANS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(GUARDIANS_CHANGED_EVENT, onChange)
  }, [load])

  // Not allowed to manage guardians (or the feature is not in this database yet): nothing to show.
  if (data === null && !loadError) return null

  const remove = async () => {
    if (!confirm || busy) return
    setBusy(true)
    const result = confirm.kind === "link" ? await revokeGuardianLink(confirm.id) : await cancelGuardianInvite(confirm.id)
    setBusy(false)
    if (!result.ok) return notifyError(result.error.message)
    setConfirm(null)
    notify(confirm.kind === "link" ? "Access removed" : "Invite cancelled")
  }

  const resend = async (inviteId: string) => {
    const result = await resendGuardianInvite(inviteId)
    if (result.ok) notify("Invite emailed again")
    else notifyError(result.error.message)
  }

  const copyLink = async (inviteId: string) => {
    try {
      await navigator.clipboard.writeText(guardianInviteLink(inviteId))
      notify("Invite link copied")
    } catch {
      notifyError("Could not copy the link. Use Resend email instead.")
    }
  }

  const empty = data && data.links.length === 0 && data.invites.length === 0

  return (
    <Section
      title="Parents and guardians"
      hint={`A guardian gets their own sign-in and can read ${first}'s plan, results and team news. They cannot change anything, and you can end their access at any time.`}
      data-guardians-section
    >
      {loadError ? <Notice tone="error">{`Guardians could not be loaded. ${loadError}`}</Notice> : null}
      {data === undefined ? <SkeletonRows rows={2} /> : null}
      {data ? (
        <>
          <Notice tone={data.healthRule === "unknown_age" ? "warning" : "info"} className="mb-1">
            <span data-health-rule={data.healthRule}>{healthRuleText(data.healthRule, first, "coach")}</span>
          </Notice>
          {empty ? (
            <EmptyState
              title="No guardian has access"
              body={data.storedGuardian.email ? `The contact on file is ${data.storedGuardian.name ?? "a guardian"} (${data.storedGuardian.email}). Invite them to give them a sign-in.` : "Invite a parent or guardian by email to give them a sign-in."}
            />
          ) : (
            <List aria-label={`Parents and guardians of ${athleteName}`}>
              {data.links.map((link) => (
                <ActionRow
                  key={link.id}
                  title={link.name ?? link.email ?? "Guardian"}
                  subtitle={[link.relationship, link.email, `since ${shortDate(link.since)}`].filter(Boolean).join(", ")}
                  trailing={<StatusText tone="green">Has access</StatusText>}
                  actions={<RowMenu label={`More for ${link.name ?? link.email ?? "guardian"}`} items={[{ label: "Remove access", danger: true, onSelect: () => setConfirm({ kind: "link", id: link.id }) }]} />}
                  below={
                    confirm?.kind === "link" && confirm.id === link.id ? (
                      <InlineConfirm
                        question={`Remove ${link.name ?? "this guardian"}'s access to ${first}? It ends at once. You can invite them again later.`}
                        confirmLabel="Remove access"
                        cancelLabel="Keep access"
                        onConfirm={() => void remove()}
                        onCancel={() => setConfirm(null)}
                        busy={busy}
                      />
                    ) : undefined
                  }
                  data-guardian-link={link.email ?? link.id}
                />
              ))}
              {data.invites.map((invite) => (
                <ActionRow
                  key={invite.id}
                  title={invite.name ?? invite.email}
                  subtitle={[invite.relationship, invite.email, invite.expired ? "invite expired" : invite.lastEmailSentAt ? `emailed ${shortDate(invite.lastEmailSentAt)}` : "not emailed yet"].filter(Boolean).join(", ")}
                  trailing={<StatusText tone={invite.expired ? "coral" : "amber"}>{invite.expired ? "Expired" : "Invited"}</StatusText>}
                  actions={
                    <RowMenu
                      label={`More for ${invite.name ?? invite.email}`}
                      items={[
                        { label: "Resend email", onSelect: () => void resend(invite.id), disabled: invite.expired },
                        { label: "Copy invite link", onSelect: () => void copyLink(invite.id), disabled: invite.expired },
                        { label: "Cancel invite", danger: true, onSelect: () => setConfirm({ kind: "invite", id: invite.id }) },
                      ]}
                    />
                  }
                  below={
                    confirm?.kind === "invite" && confirm.id === invite.id ? (
                      <InlineConfirm question={`Cancel the invite to ${invite.email}? The link in their email stops working.`} confirmLabel="Cancel invite" cancelLabel="Keep invite" onConfirm={() => void remove()} onCancel={() => setConfirm(null)} busy={busy} />
                    ) : undefined
                  }
                  data-guardian-invite={invite.email}
                />
              ))}
            </List>
          )}
          <div className="pt-3">
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              Invite a guardian
            </Button>
          </div>
        </>
      ) : null}

      {data ? (
        <InviteGuardianDialog
          key={inviteOpen ? "open" : "closed"}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          athleteId={athleteId}
          athleteFirstName={first}
          prefill={data.links.length === 0 && data.invites.length === 0 ? data.storedGuardian : { name: null, email: null }}
        />
      ) : null}
    </Section>
  )
}

function InviteGuardianDialog({
  open,
  onOpenChange,
  athleteId,
  athleteFirstName,
  prefill,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  athleteId: string
  athleteFirstName: string
  prefill: { name: string | null; email: string | null }
}) {
  const [email, setEmail] = useState(prefill.email ?? "")
  const [name, setName] = useState(prefill.name ?? "")
  const [relationship, setRelationship] = useState(RELATIONSHIP_OPTIONS[0])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const cleanEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return setError("Enter the guardian's email address, like name@example.com.")
    if (!name.trim()) return setError("Add the guardian's name.")
    setBusy(true)
    setError(null)
    const result = await inviteGuardian({ athleteId, email: cleanEmail, name: name.trim(), relationship })
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    onOpenChange(false)
    if (result.data.outcome === "linked") {
      notify(`${name.trim()} already has a guardian account here and can now follow ${athleteFirstName}`)
    } else if (result.data.email.ok) {
      notify(`Invite emailed to ${cleanEmail}`)
    } else {
      notifyError(`The invite is ready, but the email could not be sent. ${result.data.email.error.message} Copy the invite link from the row's menu instead.`)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Invite a guardian for ${athleteFirstName}`}
      description="We email them a personal link. It works once, for the email it was sent to, for 14 days. They read, they do not change anything."
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field label="Guardian's email" hint={prefill.email ? "Filled in from the guardian contact on file." : "Their own email, not the athlete's."}>
          <Input type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label="Guardian's name">
          <Input autoComplete="off" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Relationship">
          <Select value={relationship} onChange={(event) => setRelationship(event.target.value)}>
            {RELATIONSHIP_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="quiet" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Sending..." : "Send invite"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
