"use client"

import { Check, Copy, PaperPlaneTilt, QrCode as QrCodeIcon } from "@phosphor-icons/react"
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import {
  Button,
  Choices,
  DataTable,
  Dialog,
  Fact,
  FactList,
  Field,
  InlineConfirm,
  Input,
  Meter,
  Notice,
  PasteList,
  QrCode,
  Select,
  SkeletonRows,
  StatusText,
  TableSub,
  Tabs,
  type DataTableColumn,
  type StateTone,
} from "@/components/sk"
import {
  createAthleteInviteForCurrentCoach,
  createAthleteInvites,
  previewAthleteInvites,
  recordMockInviteEmail,
  type InviteLineStatus,
  type TeamAthleteInvite,
} from "@/lib/data/athlete/invite-data"
import {
  createTeamJoinCode,
  disableTeamJoinCode,
  getTeamJoinCode,
  joinLink,
  JOIN_CODE_EXPIRY_OPTIONS,
  type JoinCodeExpiryDays,
  type TeamJoinCode,
} from "@/lib/data/coach/join-code-data"
import {
  createManagedAthlete,
  EVENT_GROUPS,
  getRosterCapacity,
  validateManagedAthlete,
  type ManagedAthleteField,
  type RosterCapacity,
} from "@/lib/data/coach/roster-data"
import { sendInviteEmail, sendInviteEmails } from "@/lib/data/invites/invite-email-data"
import { INVITE_LIST_MAX, parseInviteList, type ParsedInviteLine } from "@/lib/data/invites/invite-list"
import type { EventGroup } from "@/lib/mock-data"

export type AddAthletesView = "email" | "list" | "code" | "manual"

function absoluteLink(path: string) {
  return typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path
}

function shortDay(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
}

/** A quiet "Copy link" button that says "Copied" for a moment. */
export function CopyLinkButton({ text, label = "Copy link", variant = "secondary" }: { text: string; label?: string; variant?: "secondary" | "quiet" | "primary" }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Button variant={variant} size="sm" onClick={() => void copy()}>
      {copied ? <Check className="size-4" weight="bold" aria-hidden /> : <Copy className="size-4" weight="bold" aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  )
}

function capacityLine(capacity: RosterCapacity | null) {
  if (!capacity || capacity.athleteLimit === null) return null
  const waiting = capacity.pendingInvites > 0 ? `, ${capacity.pendingInvites} ${capacity.pendingInvites === 1 ? "invite" : "invites"} waiting` : ""
  return `${capacity.athletesUsed} of ${capacity.athleteLimit} athlete places used${waiting}.`
}

/* ---------- One by email -------------------------------------------------------------------------- */

function EmailView({ teamId, teamName, onCreated }: { teamId: string; teamName: string; onCreated: (invite: TeamAthleteInvite) => void }) {
  const [email, setEmail] = useState("")
  const [days, setDays] = useState("7")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ email: string; link: string; sent: boolean; preview: boolean; reason: string | null } | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const clean = email.trim().toLowerCase()
    if (!clean) return
    setBusy(true)
    setError(null)
    const expiresInDays = Number.parseInt(days, 10)
    const result = await createAthleteInviteForCurrentCoach({ teamId, email: clean, expiresInDays })
    if (!result.ok) {
      setBusy(false)
      setError(result.error.message)
      return
    }
    // The invite exists from here on. Email it, and if that fails say so and keep the link to hand.
    const sent = await sendInviteEmail({ kind: "athlete", inviteId: result.data.inviteId })
    recordMockInviteEmail(result.data.inviteId, sent.ok ? { sentAt: sent.data.sentAt } : { error: typeof sent.error.cause === "string" ? sent.error.cause : "provider_failure" })
    setBusy(false)
    setCreated({ email: clean, link: absoluteLink(result.data.invitePath), sent: sent.ok, preview: sent.ok && sent.data.preview, reason: sent.ok ? null : sent.error.message })
    onCreated({
      id: result.data.inviteId,
      email: clean,
      status: "pending",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
      invitePath: result.data.invitePath,
      emailSentAt: sent.ok ? sent.data.sentAt : null,
      emailSendCount: sent.ok ? sent.data.sendCount : 0,
      emailError: sent.ok ? null : typeof sent.error.cause === "string" ? sent.error.cause : "provider_failure",
    })
  }

  if (created) {
    return (
      <div className="flex flex-col gap-4" data-invite-email={created.sent ? "sent" : "failed"}>
        {created.sent ? (
          <Notice tone="success">
            Invite emailed to <span className="break-all">{created.email}</span>
            <span className="mt-0.5 block font-normal">
              {created.preview ? "Local preview: the send was recorded but no real email goes out from this setup. Use the link below." : "They join from the button in the email. Nothing else for you to do."}
            </span>
          </Notice>
        ) : (
          <Notice tone="warning">
            Invite created, but the email to <span className="break-all">{created.email}</span> was not sent
            <span className="mt-0.5 block font-normal">{created.reason} The invite still works: copy the link and send it yourself, or resend the email from Invites.</span>
          </Notice>
        )}
        <Field label="Invite link" hint="Their personal link. It works once, for the email you entered.">
          <Input readOnly value={created.link} onFocus={(event) => event.currentTarget.select()} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <CopyLinkButton text={created.link} variant={created.sent ? "secondary" : "primary"} />
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              setCreated(null)
              setEmail("")
            }}
          >
            Invite another
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <p className="text-[0.9375rem] text-sk-mute">We email them a personal link to join {teamName}. It works once, for the email you enter.</p>
      <Field label="Athlete email">
        <Input type="email" required autoComplete="off" placeholder="athlete@email.com" value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>
      <Field label="Link works for">
        <Select value={days} onChange={(event) => setDays(event.target.value)}>
          <option value="1">24 hours</option>
          <option value="7">7 days</option>
          <option value="30">30 days</option>
        </Select>
      </Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div>
        <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
          <PaperPlaneTilt className="size-5" weight="bold" aria-hidden />
          {busy ? "Sending..." : "Send invite"}
        </Button>
      </div>
    </form>
  )
}

/* ---------- Many at once -------------------------------------------------------------------------- */

type ListRowState = ParsedInviteLine & {
  /** From the database once it has been asked; "checking" while it has not answered yet. */
  check: InviteLineStatus | "checking" | null
  inviteId: string | null
  invitePath: string | null
  /** After sending. */
  emailed: "sent" | "failed" | null
  emailProblem: string | null
}

function lineStatus(row: ListRowState): { tone: StateTone; text: string; detail?: string } {
  if (row.emailed === "sent") return { tone: "green", text: "Invite sent" }
  if (row.emailed === "failed") return { tone: "coral", text: "Email not sent", detail: row.emailProblem ?? undefined }
  if (!row.valid) return { tone: "coral", text: row.problem === "Same email as a line above" ? "Listed twice" : "Not valid", detail: row.problem ?? undefined }
  switch (row.check) {
    case "checking":
      return { tone: "neutral", text: "Checking..." }
    case "created":
      return { tone: "blue", text: "Invite created" }
    case "ok":
      return { tone: "green", text: "Ready to invite" }
    case "on_team":
      return { tone: "neutral", text: "Already on the team" }
    case "invited":
      return { tone: "neutral", text: "Already invited" }
    case "staff_account":
      return { tone: "amber", text: "Coach or admin account", detail: "This email signs in as staff of your club" }
    case "over_limit":
      return { tone: "amber", text: "Over the package limit", detail: "Your club has no athlete place left for this one" }
    case "duplicate":
      return { tone: "coral", text: "Listed twice" }
    case "invalid":
      return { tone: "coral", text: "Not valid", detail: "This is not a valid email address" }
    default:
      return { tone: "neutral", text: "Not checked yet" }
  }
}

function ListView({ teamId, teamName, onCreated }: { teamId: string; teamName: string; onCreated: (invites: TeamAthleteInvite[]) => void }) {
  const [text, setText] = useState("")
  const [days, setDays] = useState("7")
  const [checks, setChecks] = useState<Record<string, InviteLineStatus>>({})
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [phase, setPhase] = useState<"edit" | "sending" | "done">("edit")
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [sent, setSent] = useState<ListRowState[] | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const requestId = useRef(0)

  const parsed = useMemo(() => parseInviteList(text), [text])
  const validLines = useMemo(() => parsed.filter((line) => line.valid), [parsed])
  const tooMany = validLines.length > INVITE_LIST_MAX
  const validKey = validLines.map((line) => line.email).join("\n")

  // Ask the database about the lines that look like emails, a moment after the coach stops typing.
  useEffect(() => {
    if (phase !== "edit") return
    if (validLines.length === 0 || tooMany) {
      setChecks({})
      setChecking(false)
      setCheckError(null)
      return
    }
    const id = ++requestId.current
    setChecking(true)
    const timer = window.setTimeout(() => {
      void previewAthleteInvites(
        teamId,
        validLines.map((line) => ({ email: line.email, name: line.name })),
      ).then((result) => {
        if (id !== requestId.current) return
        setChecking(false)
        if (!result.ok) {
          setCheckError(result.error.message)
          setChecks({})
          return
        }
        setCheckError(null)
        setChecks(Object.fromEntries(result.data.map((line) => [validLines[line.lineNo - 1]?.email ?? line.email, line.status])))
      })
    }, 450)
    return () => window.clearTimeout(timer)
    // validKey stands for validLines: the same emails in the same order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, teamId, tooMany, validKey])

  const rows: ListRowState[] =
    sent ??
    parsed.map((line) => ({
      ...line,
      check: line.valid ? (checks[line.email] ?? (checking ? "checking" : null)) : null,
      inviteId: null,
      invitePath: null,
      emailed: null,
      emailProblem: null,
    }))
  const readyCount = rows.filter((row) => row.valid && row.check === "ok").length
  const skippedCount = rows.length - readyCount

  const emailRows = async (current: ListRowState[], ids: string[]) => {
    setProgress({ done: 0, total: ids.length })
    const results = await sendInviteEmails({ kind: "athlete", inviteIds: ids }, (done, total) => setProgress({ done: done.length, total }))
    const byId = new Map(results.map((item) => [item.inviteId, item.result]))
    return current.map((row): ListRowState => {
      const result = row.inviteId ? byId.get(row.inviteId) : undefined
      if (!result) return row
      recordMockInviteEmail(row.inviteId as string, result.ok ? { sentAt: result.data.sentAt } : { error: typeof result.error.cause === "string" ? result.error.cause : "provider_failure" })
      return result.ok ? { ...row, emailed: "sent", emailProblem: null } : { ...row, emailed: "failed", emailProblem: result.error.message }
    })
  }

  const send = async () => {
    setSendError(null)
    setPhase("sending")
    setProgress({ done: 0, total: readyCount })
    const expiresInDays = Number.parseInt(days, 10)
    const created = await createAthleteInvites(
      teamId,
      validLines.map((line) => ({ email: line.email, name: line.name })),
      expiresInDays,
    )
    if (!created.ok) {
      setSendError(created.error.message)
      setPhase("edit")
      return
    }
    const byEmail = new Map(created.data.map((line) => [validLines[line.lineNo - 1]?.email ?? line.email, line]))
    let next: ListRowState[] = parsed.map((line) => {
      const outcome = line.valid ? byEmail.get(line.email) : undefined
      return { ...line, check: outcome?.status ?? null, inviteId: outcome?.inviteId ?? null, invitePath: outcome?.invitePath ?? null, emailed: null, emailProblem: null }
    })
    setSent(next)
    const ids = next.flatMap((row) => (row.inviteId ? [row.inviteId] : []))
    next = await emailRows(next, ids)
    setSent(next)
    setPhase("done")
    const now = new Date().toISOString()
    onCreated(
      next.flatMap((row): TeamAthleteInvite[] =>
        row.inviteId
          ? [
              {
                id: row.inviteId,
                email: row.email,
                name: row.name,
                status: "pending",
                createdAt: now,
                expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
                invitePath: row.invitePath ?? "",
                emailSentAt: row.emailed === "sent" ? now : null,
                emailSendCount: row.emailed === "sent" ? 1 : 0,
                emailError: row.emailed === "failed" ? "provider_failure" : null,
              },
            ]
          : [],
      ),
    )
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
    setChecks({})
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

  return (
    <div className="flex flex-col gap-4">
      {phase === "edit" ? (
        <>
          <PasteList
            label="Athletes, one per line"
            value={text}
            onChange={setText}
            fileLabel="Choose a CSV file"
            placeholder={"maya@example.com\nJordan Reid, jordan@example.com"}
            hint={`An email on its own, or "Name, email". A CSV file needs an email column, and a name column if you have one.`}
          />
          {tooMany ? <Notice tone="warning">That is {validLines.length} people. Invite up to {INVITE_LIST_MAX} at a time, then add the rest.</Notice> : null}
          {checkError ? <Notice tone="error">Could not check the list: {checkError}</Notice> : null}
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
            {sentCount > 0 ? `${sentCount} ${sentCount === 1 ? "invite" : "invites"} sent to join ${teamName}.` : "No invites were sent."}
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
            {phase === "edit"
              ? checking
                ? `Checking ${validLines.length} ${validLines.length === 1 ? "line" : "lines"}...`
                : `${readyCount} ready to invite${skippedCount > 0 ? `, ${skippedCount} will be skipped` : ""}`
              : `${rows.length} ${rows.length === 1 ? "line" : "lines"}`}
          </p>
          <DataTable caption="The people in your list and what happens to each" columns={columns} rows={rows} rowKey={(row) => `${row.line}`} />
        </div>
      ) : null}

      {phase === "edit" ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Field label="Links work for" className="sm:w-44">
            <Select value={days} onChange={(event) => setDays(event.target.value)}>
              <option value="1">24 hours</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
            </Select>
          </Field>
          <Button variant="primary" disabled={readyCount === 0 || checking || tooMany} onClick={() => void send()}>
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

/* ---------- QR code -------------------------------------------------------------------------------- */

function CodeView({ teamId, teamName, capacity }: { teamId: string; teamName: string; capacity: RosterCapacity | null }) {
  const [code, setCode] = useState<TeamJoinCode | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState<"1" | "7" | "30">("7")
  const [maxUses, setMaxUses] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const [replacing, setReplacing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getTeamJoinCode(teamId).then((result) => {
      if (cancelled) return
      if (result.ok) setCode(result.data)
      else {
        setCode(null)
        setError(result.error.message)
      }
    })
    return () => {
      cancelled = true
    }
  }, [teamId])

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const typed = maxUses.trim() ? Number.parseInt(maxUses, 10) : null
    if (typed !== null && (!Number.isInteger(typed) || typed < 1 || typed > 500)) {
      setError("Enter a number of athletes between 1 and 500, or leave it empty.")
      return
    }
    setBusy(true)
    setError(null)
    const result = await createTeamJoinCode(teamId, Number(days) as JoinCodeExpiryDays, typed)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setCode(result.data)
    setReplacing(false)
    setMaxUses("")
  }

  const turnOff = async () => {
    if (!code) return
    setBusy(true)
    const result = await disableTeamJoinCode(code.id)
    setBusy(false)
    setConfirmOff(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setCode(null)
  }

  if (code === undefined) return <SkeletonRows rows={3} label="Loading the join code" />

  const seatsLeft = capacity?.seatsLeft ?? null

  if (code && code.live && !replacing) {
    const link = joinLink(code.code)
    return (
      <div className="flex flex-col gap-4" data-join-code={code.code}>
        <p className="text-[0.9375rem] text-sk-mute">
          Athletes point their phone camera at this. They sign in or create an account, and they are on {teamName}.
        </p>
        <div className="flex justify-center py-1">
          <QrCode value={link} label={`QR code to join ${teamName}`} size="lg" />
        </div>
        <Field label="Or share the link">
          <Input readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
        </Field>
        <FactList aria-label="About this join code">
          <Fact label="Works until">{shortDay(code.expiresAt)}</Fact>
          <Fact label="Joined with it">
            {code.useCount} of {code.maxUses}
          </Fact>
        </FactList>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {confirmOff ? (
          <InlineConfirm
            question="Turn this code off? It stops working at once. Athletes who already joined stay on the team."
            confirmLabel="Turn off"
            cancelLabel="Keep it on"
            busy={busy}
            onConfirm={() => void turnOff()}
            onCancel={() => setConfirmOff(false)}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <CopyLinkButton text={link} />
            <Button size="sm" onClick={() => setReplacing(true)}>
              Make a new code
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmOff(true)}>
              Turn off
            </Button>
          </div>
        )}
        <p className="text-sm text-sk-mute">Anyone who has this code can join {teamName} as an athlete until it runs out. Turn it off when practice is over.</p>
      </div>
    )
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void create(event)}>
      <p className="text-[0.9375rem] text-sk-mute">
        {replacing
          ? "A new code replaces the one you have. The old one stops working straight away."
          : code && !code.live
            ? `The last code ${code.state === "expired" ? "has expired" : "has been used up"}. Make a new one to keep adding athletes.`
            : `Show one QR code to the whole squad. Everyone who scans it joins ${teamName} as an athlete, with their own account.`}
      </p>
      <Choices
        label="Code works for"
        value={days}
        onChange={setDays}
        columns={3}
        options={JOIN_CODE_EXPIRY_OPTIONS.map((option) => ({ value: String(option.value) as "1" | "7" | "30", label: option.label }))}
      />
      <Field
        label="Most athletes who can join with it"
        optional
        hint={seatsLeft !== null ? `Leave empty to allow every place your club has left (${seatsLeft}).` : "Leave empty for up to 100."}
      >
        <Input inputMode="numeric" value={maxUses} placeholder={seatsLeft !== null ? String(seatsLeft) : "100"} onChange={(event) => setMaxUses(event.target.value.replace(/[^0-9]/g, "").slice(0, 3))} />
      </Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          <QrCodeIcon className="size-5" weight="bold" aria-hidden />
          {busy ? "Creating..." : "Create join code"}
        </Button>
        {replacing ? (
          <Button variant="quiet" onClick={() => setReplacing(false)}>
            Keep the current code
          </Button>
        ) : null}
      </div>
    </form>
  )
}

/* ---------- No login -------------------------------------------------------------------------------- */

export type ManagedAthleteFormValues = {
  firstName: string
  lastName: string
  dateOfBirth: string
  eventGroup: EventGroup | ""
  primaryEvent: string
  guardianName: string
  guardianPhone: string
  guardianEmail: string
}

export const EMPTY_MANAGED_ATHLETE_FORM: ManagedAthleteFormValues = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  eventGroup: "",
  primaryEvent: "",
  guardianName: "",
  guardianPhone: "",
  guardianEmail: "",
}

export function toManagedAthleteInput(values: ManagedAthleteFormValues) {
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    dateOfBirth: values.dateOfBirth || null,
    eventGroup: values.eventGroup || null,
    primaryEvent: values.primaryEvent || null,
    guardianName: values.guardianName || null,
    guardianPhone: values.guardianPhone || null,
    guardianEmail: values.guardianEmail || null,
  }
}

/** The fields of an athlete without a login. Used to add one and to edit one. */
export function ManagedAthleteFields({
  values,
  onChange,
  errors,
}: {
  values: ManagedAthleteFormValues
  onChange: (next: ManagedAthleteFormValues) => void
  errors: Partial<Record<ManagedAthleteField, string>>
}) {
  const set = <K extends keyof ManagedAthleteFormValues>(key: K, value: ManagedAthleteFormValues[K]) => onChange({ ...values, [key]: value })
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" error={errors.firstName}>
          <Input autoComplete="off" maxLength={60} value={values.firstName} onChange={(event) => set("firstName", event.target.value)} />
        </Field>
        <Field label="Last name" error={errors.lastName}>
          <Input autoComplete="off" maxLength={60} value={values.lastName} onChange={(event) => set("lastName", event.target.value)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date of birth" optional error={errors.dateOfBirth}>
          <Input type="date" value={values.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(event) => set("dateOfBirth", event.target.value)} />
        </Field>
        <Field label="Event group" optional>
          <Select value={values.eventGroup} onChange={(event) => set("eventGroup", event.target.value as EventGroup | "")}>
            <option value="">Not chosen</option>
            {EVENT_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Main event" optional>
        <Input autoComplete="off" maxLength={60} placeholder="60m" value={values.primaryEvent} onChange={(event) => set("primaryEvent", event.target.value)} />
      </Field>
      <Field label="Parent or guardian" optional hint="Seen only by this athlete's coaches and club admins.">
        <Input autoComplete="off" maxLength={120} placeholder="Name" value={values.guardianName} onChange={(event) => set("guardianName", event.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Guardian phone" optional error={errors.guardianPhone}>
          <Input type="tel" autoComplete="off" value={values.guardianPhone} onChange={(event) => set("guardianPhone", event.target.value)} />
        </Field>
        <Field label="Guardian email" optional error={errors.guardianEmail}>
          <Input type="email" autoComplete="off" value={values.guardianEmail} onChange={(event) => set("guardianEmail", event.target.value)} />
        </Field>
      </div>
    </>
  )
}

function ManualView({ teamId, teamName, onAdded }: { teamId: string; teamName: string; onAdded: (athleteId: string, name: string) => void }) {
  const [values, setValues] = useState<ManagedAthleteFormValues>(EMPTY_MANAGED_ATHLETE_FORM)
  const [errors, setErrors] = useState<Partial<Record<ManagedAthleteField, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    setAdded(null)
    const input = toManagedAthleteInput(values)
    const checked = validateManagedAthlete(input)
    if (!checked.ok) {
      setErrors(checked.fieldErrors)
      setFormError("Check the highlighted fields, then add again.")
      return
    }
    setErrors({})
    setBusy(true)
    const result = await createManagedAthlete(teamId, input)
    setBusy(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    const name = `${checked.data.firstName} ${checked.data.lastName}`
    setAdded(name)
    setValues(EMPTY_MANAGED_ATHLETE_FORM)
    onAdded(result.data.athleteId, name)
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
      <p className="text-[0.9375rem] text-sk-mute">
        For young children, or anyone without their own email. They are on {teamName} with no login: you enter their results and availability. You can give them a login later and they keep their history.
      </p>
      {added ? <Notice tone="success">{added} is on the roster. Add another, or close this.</Notice> : null}
      <ManagedAthleteFields values={values} onChange={setValues} errors={errors} />
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Adding..." : "Add athlete"}
        </Button>
      </div>
    </form>
  )
}

/* ---------- The dialog ------------------------------------------------------------------------------ */

/**
 * "Add athletes": the four ways onto a team. One by email, many from a list, a QR code for the
 * whole squad, or an athlete without a login.
 */
export function AddAthletesDialog({
  open,
  onOpenChange,
  teamId,
  teamName,
  initialView = "email",
  onInvitesCreated,
  onAthleteAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: string
  teamName: string
  initialView?: AddAthletesView
  onInvitesCreated?: (invites: TeamAthleteInvite[]) => void
  onAthleteAdded?: (athleteId: string, name: string) => void
}) {
  const [view, setView] = useState<AddAthletesView>(initialView)
  const [capacity, setCapacity] = useState<RosterCapacity | null>(null)
  const [capacityTick, setCapacityTick] = useState(0)

  useEffect(() => {
    if (open) setView(initialView)
  }, [initialView, open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getRosterCapacity().then((result) => {
      if (!cancelled && result.ok) setCapacity(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [capacityTick, open])

  const full = capacity !== null && capacity.seatsLeft === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add athletes" description={[teamName, capacityLine(capacity)].filter(Boolean).join(". ")} className="sm:max-w-2xl">
      <div className="flex flex-col gap-5">
        <Tabs
          label="Ways to add athletes"
          value={view}
          onChange={setView}
          options={[
            { value: "email", label: "Email" },
            { value: "list", label: "List" },
            { value: "code", label: "QR code" },
            { value: "manual", label: "No login" },
          ]}
        />
        {full ? <Notice tone="warning">Your club has used every athlete place in its package. Ask a club admin to upgrade before adding more.</Notice> : null}
        {view === "email" ? (
          <EmailView
            key={teamId}
            teamId={teamId}
            teamName={teamName}
            onCreated={(invite) => {
              setCapacityTick((tick) => tick + 1)
              onInvitesCreated?.([invite])
            }}
          />
        ) : null}
        {view === "list" ? (
          <ListView
            key={teamId}
            teamId={teamId}
            teamName={teamName}
            onCreated={(invites) => {
              setCapacityTick((tick) => tick + 1)
              onInvitesCreated?.(invites)
            }}
          />
        ) : null}
        {view === "code" ? <CodeView key={teamId} teamId={teamId} teamName={teamName} capacity={capacity} /> : null}
        {view === "manual" ? (
          <ManualView
            key={teamId}
            teamId={teamId}
            teamName={teamName}
            onAdded={(athleteId, name) => {
              setCapacityTick((tick) => tick + 1)
              onAthleteAdded?.(athleteId, name)
            }}
          />
        ) : null}
      </div>
    </Dialog>
  )
}
