import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { DownloadSimple } from "@phosphor-icons/react"
import { Button, Field, FormActions, Input, List, ListRow, Notice, Section, SkeletonRows } from "@/components/sk"
import {
  collectPersonalExport,
  deleteMyAccount,
  downloadFile,
  getAccountDeletionCheck,
  recordDataExport,
} from "@/lib/data/account/data-rights-data"
import { blockingTeamLine, isTypedConfirmation, type DeletionCheck } from "@/lib/data-rights"
import { useRole } from "@/lib/role-context"
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support"

/**
 * "Your data" on the account screen: download a copy of everything stored about you, and delete
 * your account. Every role sees the download. Deleting follows the rules per role, which the
 * database checks again (get_my_account_deletion_check, delete_my_account).
 */

/** What deleting means for each role, in one short paragraph. The privacy page says the same. */
export function deletionRulesText(role: string | null): string {
  const messages =
    "Messages you sent stay in the other person's conversation, shown as from \"Deleted account\", so a club admin can still read a conversation that was reported."
  if (role === "athlete") {
    return `Deleting your account removes your sign-in and everything recorded about you: your profile and private details, sessions and logs, check-ins, pain reports, results, goals and attendance. Your coaches are told. ${messages} This cannot be undone.`
  }
  if (role === "coach") {
    return `Deleting your account removes your sign-in, your profile and your team assignments. The plans, templates, exercises and notes you wrote stay with the club, shown as written by "A former coach". ${messages} You cannot delete your account while you lead a team or are the only coach of a team with athletes. This cannot be undone.`
  }
  if (role === "club-admin") {
    return `Deleting your account removes your sign-in and your profile. What you set up for the club stays with the club. ${messages} The club owner cannot delete their account: transfer ownership to another club admin, or close the club, first. This cannot be undone.`
  }
  return "A platform admin account is not deleted in the app."
}

export function YourDataSection() {
  const { role } = useRole()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ fileName: string; records: number; areas: number; unread: number } | null>(null)

  const download = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    const result = await collectPersonalExport()
    if (!result.ok) {
      setBusy(false)
      setError(`We could not put your data together. ${result.error.message}`)
      return
    }
    downloadFile(result.data.fileName, result.data.json, "application/json;charset=utf-8")
    // The record says that a copy was made and by whom. It never holds the data.
    await recordDataExport("personal")
    setBusy(false)
    const { summary } = result.data.file
    setDone({ fileName: result.data.fileName, records: summary.total_records, areas: summary.counts.filter((item) => item.records > 0).length, unread: summary.could_not_read.length })
  }

  return (
    <Section
      title="Your data"
      hint={
        role === "athlete"
          ? "A copy of everything SKTR Coach stores about you: your profile, private details, sessions and logs, check-ins, pain reports, results, goals, attendance, messages and notifications."
          : "A copy of everything SKTR Coach stores about you: your account, the plans, templates, exercises and notes you wrote, your messages and your notifications."
      }
    >
      {error ? (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      ) : null}
      {done ? (
        <Notice tone={done.unread > 0 ? "warning" : "success"} className="mb-3">
          Downloaded {done.fileName}: {done.records} {done.records === 1 ? "record" : "records"} in {done.areas} {done.areas === 1 ? "area" : "areas"}. The summary is at the top of the file.
          {done.unread > 0 ? ` ${done.unread} ${done.unread === 1 ? "area" : "areas"} could not be read and are listed there. Email ${SUPPORT_EMAIL} if you need them.` : ""}
        </Notice>
      ) : null}
      <List>
        <ListRow
          title="Download your data"
          subtitle="One file (JSON) with a short summary at the top. Keep it somewhere private."
          trailing={
            <Button size="sm" disabled={busy} onClick={() => void download()}>
              <DownloadSimple className="size-4" weight="bold" aria-hidden />
              {busy ? "Preparing..." : "Download"}
            </Button>
          }
        />
      </List>
    </Section>
  )
}

function BlockedReason({ check }: { check: DeletionCheck }) {
  if (check.reason === "platform_admin") {
    return (
      <Notice tone="info">
        A platform admin account is not deleted in the app. Email{" "}
        <a className="sk-link" href={SUPPORT_MAILTO}>
          {SUPPORT_EMAIL}
        </a>{" "}
        and another platform admin will remove it.
      </Notice>
    )
  }
  if (check.reason === "club_owner") {
    return (
      <Notice tone="warning">
        You own this club, so your account cannot be deleted yet. Transfer ownership to another club admin, or close the club, under Club data and ownership on the{" "}
        <Link className="sk-link" to="/club-admin/profile">
          club profile
        </Link>
        .
      </Notice>
    )
  }
  return (
    <Notice tone="warning">
      <span className="block font-semibold text-sk-ink">Your account cannot be deleted yet.</span>
      <ul className="mt-1 list-disc pl-5" aria-label="Teams that block deleting your account">
        {check.blockingTeams.map((team) => (
          <li key={team.teamId}>{blockingTeamLine(team)}</li>
        ))}
      </ul>
      <span className="mt-1 block">A club admin must give {check.blockingTeams.length === 1 ? "this team" : "these teams"} another lead coach first. Ask them, then come back here.</span>
    </Notice>
  )
}

export function DeleteAccountSection() {
  const { role } = useRole()
  const [check, setCheck] = useState<DeletionCheck | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getAccountDeletionCheck().then((result) => {
      if (cancelled) return
      if (result.ok) setCheck(result.data)
      else setLoadError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const confirmed = check ? isTypedConfirmation(check.email, typed) : false

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!confirmed || busy) return
    setBusy(true)
    setError(null)
    const result = await deleteMyAccount(typed)
    if (!result.ok) {
      setBusy(false)
      setError(result.error.message)
      return
    }
    // A full page load: the route guard is already sending this signed-out browser to the sign-in
    // screen, and the page has to arrive there with the confirmation in the address.
    window.location.replace("/login?account=deleted")
  }

  return (
    <Section title="Delete your account" hint={deletionRulesText(check?.role === "none" ? role : (check?.role ?? role))}>
      {loadError ? <Notice tone="error">We could not check whether your account can be deleted. {loadError}</Notice> : null}
      {!check && !loadError ? <SkeletonRows rows={1} label="Checking your account" /> : null}
      {check && !check.canDelete ? <BlockedReason check={check} /> : null}
      {check?.canDelete && !open ? (
        <List>
          <ListRow
            title="Delete my account and data"
            subtitle="You will type your email to confirm."
            trailing={
              <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
                Delete account
              </Button>
            }
          />
        </List>
      ) : null}
      {check?.canDelete && open ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
          <p className="sk-list-sub">Download your data first if you want to keep a copy. Once your account is deleted we cannot get it back.</p>
          <Field label={`Type ${check.email ?? "your sign-in email"} to confirm`}>
            <Input type="email" name="confirm-email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={typed} onChange={(event) => setTyped(event.target.value)} />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <FormActions>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setTyped("")
                setError(null)
              }}
            >
              Keep my account
            </Button>
            <Button type="submit" variant="danger" disabled={busy || !confirmed}>
              {busy ? "Deleting..." : "Delete my account for good"}
            </Button>
          </FormActions>
        </form>
      ) : null}
    </Section>
  )
}
