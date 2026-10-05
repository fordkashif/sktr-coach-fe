"use client"

import { PaperPlaneTilt } from "@phosphor-icons/react"
import { useEffect, useMemo, useState, type FormEvent } from "react"
import { InviteCreatedResult, toInviteEmailOutcome, type InviteEmailOutcome } from "@/components/invites/invite-email-ui"
import {
  Button,
  Choices,
  DataTable,
  Dialog,
  Field,
  Input,
  Meter,
  Notice,
  PasteList,
  Select,
  StatusText,
  TableSub,
  Tabs,
  type DataTableColumn,
  type StateTone,
} from "@/components/sk"
import { COACH_INVITE_VALID_DAYS } from "@/lib/data/club-admin/ops-data"
import type { StaffInviteRole } from "@/lib/data/club-admin/people-data"
import { sendInviteEmails, type InviteEmailSent } from "@/lib/data/invites/invite-email-data"
import { INVITE_LIST_MAX, isInviteEmail, parseInviteList, type ParsedInviteLine } from "@/lib/data/invites/invite-list"
import type { Result } from "@/lib/data/result"
import type { CoachInvite } from "@/lib/mock-club-admin"

export type InviteStaffView = "one" | "list"

/** Why an email cannot be invited right now. "ok" means it can. */
export type StaffInviteCheck = "ok" | "staff" | "invited"

export type StaffInviteCreated = { invite: CoachInvite; emailResult: Result<InviteEmailSent> }

const ROLE_OPTIONS: Array<{ value: StaffInviteRole; label: string }> = [
  { value: "coach", label: "Coach" },
  { value: "club-admin", label: "Club admin" },
]

const ROLE_HINT: Record<StaffInviteRole, string> = {
  coach: "Coaches work with the teams they are put on: rosters, plans, test weeks and messages.",
  "club-admin": "Club admins manage everything in the club: people, teams, billing and every team's training. Invite only people you trust with that.",
}

function absoluteLink(path: string) {
  return typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path
}

/* ---------- One person ------------------------------------------------------------------------------ */

function OneView({
  role,
  teams,
  coachLimitMessage,
  onCreateOne,
  onDone,
}: {
  role: StaffInviteRole
  teams: Array<{ id: string; name: string }>
  /** Set when the club has no coach place left. */
  coachLimitMessage: string | null
  onCreateOne: (email: string, role: StaffInviteRole, teamId: string | undefined) => Promise<StaffInviteCreated | { error: string }>
  onDone: () => void
}) {
  const [email, setEmail] = useState("")
  const [teamId, setTeamId] = useState("none")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ email: string; link: string; outcome: InviteEmailOutcome } | null>(null)
  const blocked = role === "coach" && Boolean(coachLimitMessage)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const clean = email.trim().toLowerCase()
    if (!clean) return
    if (!isInviteEmail(clean)) {
      setError("Enter a full email address, like coach@club.com.")
      return
    }
    setBusy(true)
    setError(null)
    const result = await onCreateOne(clean, role, teamId !== "none" ? teamId : undefined)
    setBusy(false)
    if ("error" in result) {
      setError(result.error)
      return
    }
    setCreated({
      email: clean,
      link: absoluteLink(result.invite.inviteUrl ?? `/invite/coach/${result.invite.id}`),
      outcome: toInviteEmailOutcome(result.emailResult),
    })
  }

  if (created) {
    return (
      <InviteCreatedResult
        email={created.email}
        link={created.link}
        outcome={created.outcome}
        onDone={onDone}
        onInviteAnother={() => {
          setCreated(null)
          setEmail("")
          setTeamId("none")
        }}
      />
    )
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
      <Field label="Email">
        <Input type="email" autoComplete="off" placeholder={role === "coach" ? "coach@email.com" : "admin@email.com"} value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>
      <Field label="Team" optional hint={role === "coach" ? "Pick a team and they become its lead coach when they accept." : "Pick a team only if this admin also coaches it. They become its lead coach when they accept."}>
        <Select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
          <option value="none">No team yet</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </Select>
      </Field>
      {blocked ? <Notice tone="warning">{coachLimitMessage}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div>
        <Button type="submit" variant="primary" disabled={busy || !email.trim() || blocked}>
          <PaperPlaneTilt className="size-5" weight="bold" aria-hidden />
          {busy ? "Sending..." : "Send invite"}
        </Button>
      </div>
    </form>
  )
}

/* ---------- Many at once ---------------------------------------------------------------------------- */

type LineCheck = StaffInviteCheck | "over_limit"

type ListRowState = ParsedInviteLine & {
  check: LineCheck | null
  inviteId: string | null
  emailed: "sent" | "failed" | null
  emailProblem: string | null
}

function lineStatus(row: ListRowState): { tone: StateTone; text: string; detail?: string } {
  if (row.emailed === "sent") return { tone: "green", text: "Invite sent" }
  if (row.emailed === "failed") return { tone: "coral", text: "Email not sent", detail: row.emailProblem ?? undefined }
  if (!row.valid) return { tone: "coral", text: row.problem === "Same email as a line above" ? "Listed twice" : "Not valid", detail: row.problem ?? undefined }
  if (row.inviteId) return { tone: "blue", text: "Invite created" }
  switch (row.check) {
    case "ok":
      return { tone: "green", text: "Ready to invite" }
    case "staff":
      return { tone: "neutral", text: "Already on the staff" }
    case "invited":
      return { tone: "neutral", text: "Already invited", detail: "Resend their email from Invites" }
    case "over_limit":
      return { tone: "amber", text: "Over the package limit", detail: "Your club has no coach place left for this one" }
    default:
      return { tone: "neutral", text: "Not invited" }
  }
}

function ListView({
  role,
  coachSeatsLeft,
  checkEmail,
  onCreateMany,
  onEmailed,
}: {
  role: StaffInviteRole
  /** Coach places the package still has. Null means no limit. */
  coachSeatsLeft: number | null
  checkEmail: (email: string) => StaffInviteCheck
  onCreateMany: (emails: string[], role: StaffInviteRole) => Promise<{ invites: CoachInvite[] } | { error: string }>
  onEmailed: (inviteId: string, result: Result<InviteEmailSent>) => void
}) {
  const [text, setText] = useState("")
  const [phase, setPhase] = useState<"edit" | "sending" | "done">("edit")
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [sent, setSent] = useState<ListRowState[] | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  const parsed = useMemo(() => parseInviteList(text), [text])
  const validCount = parsed.filter((line) => line.valid).length
  const tooMany = validCount > INVITE_LIST_MAX

  // Places are handed out from the top of the list, so the admin sees exactly which lines miss out.
  const preview: ListRowState[] = useMemo(() => {
    let seats = role === "coach" ? coachSeatsLeft : null
    return parsed.map((line): ListRowState => {
      let check: LineCheck | null = null
      if (line.valid) {
        check = checkEmail(line.email)
        if (check === "ok" && seats !== null) {
          if (seats <= 0) check = "over_limit"
          else seats -= 1
        }
      }
      return { ...line, check, inviteId: null, emailed: null, emailProblem: null }
    })
  }, [checkEmail, coachSeatsLeft, parsed, role])

  const rows = sent ?? preview
  const readyCount = preview.filter((row) => row.check === "ok").length
  const skippedCount = preview.length - readyCount

  const emailRows = async (current: ListRowState[], ids: string[]) => {
    setProgress({ done: 0, total: ids.length })
    const results = await sendInviteEmails({ kind: "coach", inviteIds: ids }, (done, total) => setProgress({ done: done.length, total }))
    const byId = new Map(results.map((item) => [item.inviteId, item.result]))
    return current.map((row): ListRowState => {
      const result = row.inviteId ? byId.get(row.inviteId) : undefined
      if (!result) return row
      onEmailed(row.inviteId as string, result)
      return result.ok ? { ...row, emailed: "sent", emailProblem: null } : { ...row, emailed: "failed", emailProblem: result.error.message }
    })
  }

  const send = async () => {
    setSendError(null)
    setPhase("sending")
    setProgress({ done: 0, total: 0 })
    const ready = preview.filter((row) => row.check === "ok")
    const created = await onCreateMany(
      ready.map((row) => row.email),
      role,
    )
    if ("error" in created) {
      setSendError(created.error)
      setPhase("edit")
      return
    }
    const idByEmail = new Map(created.invites.map((invite) => [invite.email.toLowerCase(), invite.id]))
    let next = preview.map((row): ListRowState => ({ ...row, inviteId: row.check === "ok" ? (idByEmail.get(row.email) ?? null) : null }))
    setSent(next)
    next = await emailRows(
      next,
      next.flatMap((row) => (row.inviteId ? [row.inviteId] : [])),
    )
    setSent(next)
    setPhase("done")
  }

  const retryFailed = async () => {
    if (!sent) return
    setPhase("sending")
    const next = await emailRows(
      sent,
      sent.flatMap((row) => (row.emailed === "failed" && row.inviteId ? [row.inviteId] : [])),
    )
    setSent(next)
    setPhase("done")
  }

  const startOver = () => {
    setText("")
    setSent(null)
    setPhase("edit")
    setSendError(null)
  }

  const columns: Array<DataTableColumn<ListRowState>> = [
    {
      key: "person",
      header: "Person",
      cell: (row) => (
        <span className="break-all">
          {row.email || row.raw}
          <TableSub>{[row.name, `line ${row.line}`].filter(Boolean).join(", ")}</TableSub>
        </span>
      ),
    },
    {
      key: "status",
      header: "What happens",
      phone: "plain",
      cell: (row) => {
        const status = lineStatus(row)
        return (
          <span data-line-status={row.emailed ?? (row.valid ? (row.check ?? "unchecked") : "invalid")}>
            <StatusText tone={status.tone}>{status.text}</StatusText>
            {status.detail ? <TableSub>{status.detail}</TableSub> : null}
          </span>
        )
      },
    },
  ]

  const sentCount = sent?.filter((row) => row.emailed === "sent").length ?? 0
  const failedCount = sent?.filter((row) => row.emailed === "failed").length ?? 0
  const notInvited = sent ? sent.length - sentCount - failedCount : 0
  const noun = role === "coach" ? "coach" : "club admin"

  return (
    <div className="flex flex-col gap-4">
      {phase === "edit" ? (
        <>
          <PasteList
            label={role === "coach" ? "Coaches, one per line" : "Club admins, one per line"}
            value={text}
            onChange={setText}
            fileLabel="Choose a CSV file"
            placeholder={"jordan@club.com\nSam Reid, sam@club.com"}
            hint={`An email on its own, or "Name, email". A CSV file needs an email column. Each person gets their own ${noun} invite, with no team yet.`}
          />
          {tooMany ? (
            <Notice tone="warning">
              That is {validCount} people. Invite up to {INVITE_LIST_MAX} at a time, then add the rest.
            </Notice>
          ) : null}
          {sendError ? <Notice tone="error">{sendError}</Notice> : null}
        </>
      ) : null}

      {phase === "sending" ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="text-[0.9375rem] font-semibold text-sk-ink">
            {progress.total > 0 ? `Sending ${Math.min(progress.done + 1, progress.total)} of ${progress.total}...` : "Creating invites..."}
          </p>
          <Meter value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0} label="Invites sent" />
          <p className="text-sm text-sk-mute">Emails go out one at a time. Keep this open until it finishes.</p>
        </div>
      ) : null}

      {phase === "done" && sent ? (
        <div data-bulk-summary>
          <Notice tone={failedCount > 0 ? "warning" : sentCount > 0 ? "success" : "info"}>
            {sentCount > 0 ? `${sentCount} ${noun} ${sentCount === 1 ? "invite" : "invites"} sent.` : "No invites were sent."}
            <span className="mt-0.5 block font-normal">
              {[
                failedCount > 0 ? `${failedCount} could not be emailed. Those invites exist: retry here, or copy their links from Invites.` : null,
                notInvited > 0 ? `${notInvited} skipped (see why below).` : null,
              ]
                .filter(Boolean)
                .join(" ")}
            </span>
          </Notice>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div>
          <p className="mb-1 text-sm font-semibold text-sk-mute" aria-live="polite" data-bulk-count>
            {phase === "edit" ? `${readyCount} ready to invite${skippedCount > 0 ? `, ${skippedCount} will be skipped` : ""}` : `${rows.length} ${rows.length === 1 ? "line" : "lines"}`}
          </p>
          <DataTable caption="The people in your list and what happens to each" columns={columns} rows={rows} rowKey={(row) => `${row.line}`} />
        </div>
      ) : null}

      {phase === "edit" ? (
        <div>
          <Button variant="primary" disabled={readyCount === 0 || tooMany} onClick={() => void send()}>
            <PaperPlaneTilt className="size-5" weight="bold" aria-hidden />
            {readyCount > 0 ? `Send ${readyCount} ${readyCount === 1 ? "invite" : "invites"}` : "Send invites"}
          </Button>
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="flex flex-wrap gap-2">
          {failedCount > 0 ? (
            <Button variant="primary" onClick={() => void retryFailed()}>
              Retry {failedCount} failed
            </Button>
          ) : null}
          <Button onClick={startOver}>Invite more</Button>
        </div>
      ) : null}
    </div>
  )
}

/* ---------- The dialog -------------------------------------------------------------------------------- */

/**
 * "Invite staff": a coach or a club admin, one by email or many from a pasted list. Every invite is
 * emailed as a personal link that works once, for the email it was sent to.
 */
export function InviteStaffDialog({
  open,
  onOpenChange,
  teams,
  coachLimitMessage,
  coachSeatsLeft,
  initialRole = "coach",
  initialView = "one",
  checkEmail,
  onCreateOne,
  onCreateMany,
  onEmailed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teams: Array<{ id: string; name: string }>
  coachLimitMessage: string | null
  coachSeatsLeft: number | null
  initialRole?: StaffInviteRole
  initialView?: InviteStaffView
  checkEmail: (email: string) => StaffInviteCheck
  onCreateOne: (email: string, role: StaffInviteRole, teamId: string | undefined) => Promise<StaffInviteCreated | { error: string }>
  onCreateMany: (emails: string[], role: StaffInviteRole) => Promise<{ invites: CoachInvite[] } | { error: string }>
  onEmailed: (inviteId: string, result: Result<InviteEmailSent>) => void
}) {
  const [view, setView] = useState<InviteStaffView>(initialView)
  const [role, setRole] = useState<StaffInviteRole>(initialRole)
  // A new form every time the dialog opens.
  const [session, setSession] = useState(0)

  useEffect(() => {
    if (!open) return
    setView(initialView)
    setRole(initialRole)
    setSession((current) => current + 1)
  }, [initialRole, initialView, open])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite staff"
      description={`We email each person a personal link to join your club. It works once, for the email it was sent to, for ${COACH_INVITE_VALID_DAYS} days.`}
      className="sm:max-w-2xl"
    >
      <div className="flex flex-col gap-5">
        <Tabs
          label="Ways to invite staff"
          value={view}
          onChange={setView}
          options={[
            { value: "one", label: "One person" },
            { value: "list", label: "List" },
          ]}
        />
        <Choices label="They join as" value={role} onChange={setRole} columns={2} options={ROLE_OPTIONS} hint={ROLE_HINT[role]} />
        {view === "one" ? (
          <OneView key={`one-${session}-${role}`} role={role} teams={teams} coachLimitMessage={coachLimitMessage} onCreateOne={onCreateOne} onDone={() => onOpenChange(false)} />
        ) : (
          <ListView key={`list-${session}-${role}`} role={role} coachSeatsLeft={coachSeatsLeft} checkEmail={checkEmail} onCreateMany={onCreateMany} onEmailed={onEmailed} />
        )}
      </div>
    </Dialog>
  )
}
