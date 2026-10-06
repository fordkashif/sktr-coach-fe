import { useCallback, useEffect, useState, type FormEvent } from "react"
import { DownloadSimple } from "@phosphor-icons/react"
import {
  Button,
  CheckRow,
  Dialog,
  Fact,
  FactList,
  Field,
  FormActions,
  Input,
  List,
  ListRow,
  Notice,
  RadioRow,
  Section,
  SkeletonRows,
  SubSection,
  SubSections,
  notify,
} from "@/components/sk"
import { downloadFile, recordDataExport } from "@/lib/data/account/data-rights-data"
import {
  closeClub,
  collectClubExport,
  getClubOwnership,
  signOutAfterClosing,
  transferClubOwnership,
  type ClubOwnership,
} from "@/lib/data/club-admin/club-exit-data"
import { CLUB_DELETION_DAYS, CLUB_EXPORT_HEALTH_REMINDER, isTypedConfirmation } from "@/lib/data-rights"

/**
 * "Club data and ownership" on the club profile screen: who owns the club and handing it on,
 * exporting everything the club stores, and closing the club. Loads and saves on its own.
 * The owner is the one club admin who can transfer ownership, close the club and remove or
 * change another club admin; the database enforces all of it (20261014120000).
 */

function ExportBlock({ compact = false }: { compact?: boolean }) {
  const [includeHealth, setIncludeHealth] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ zipName: string; files: number; rows: number; problems: string[]; health: boolean } | null>(null)

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    const result = await collectClubExport(includeHealth)
    if (!result.ok) {
      setBusy(false)
      setError(`We could not build the export. ${result.error.message}`)
      return
    }
    downloadFile(result.data.zipName, result.data.bytes, "application/zip")
    await recordDataExport("club", includeHealth)
    setBusy(false)
    setDone({
      zipName: result.data.zipName,
      files: result.data.counts.length,
      rows: result.data.counts.reduce((sum, item) => sum + item.rows, 0),
      problems: result.data.problems,
      health: includeHealth,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {compact ? null : (
        <p className="sk-list-sub">
          One zip of spreadsheet files (CSV): teams, people, athletes with their private details, plans and sessions, logs, results, test weeks, attendance, competitions, announcements and the activity log, with
          a readme that counts the rows in each.
        </p>
      )}
      <List>
        <CheckRow
          checked={includeHealth}
          onChange={setIncludeHealth}
          title="Include health data"
          subtitle="Wellness check-ins, pain and injury reports, injured and sick days, and medical notes."
        />
      </List>
      {includeHealth ? <Notice tone="warning">{CLUB_EXPORT_HEALTH_REMINDER}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {done ? (
        <Notice tone={done.problems.length > 0 ? "warning" : "success"}>
          Downloaded {done.zipName}: {done.files} files, {done.rows} rows{done.health ? ", health data included" : ", without health data"}.
          {done.problems.length > 0 ? ` Some files could not be read in full (${done.problems.join("; ")}). The readme in the zip lists them.` : ""}
        </Notice>
      ) : null}
      <div>
        <Button disabled={busy} onClick={() => void run()}>
          <DownloadSimple className="size-5" weight="bold" aria-hidden />
          {busy ? "Building the export..." : "Export club data"}
        </Button>
      </div>
    </div>
  )
}

function TransferDialog({ ownership, open, onClose, onDone }: { ownership: ClubOwnership; open: boolean; onClose: () => void; onDone: (name: string) => void }) {
  const [target, setTarget] = useState<string | null>(null)
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTarget(ownership.otherAdmins.length === 1 ? ownership.otherAdmins[0].userId : null)
      setTyped("")
      setError(null)
    }
  }, [open, ownership.otherAdmins])

  const chosen = ownership.otherAdmins.find((admin) => admin.userId === target) ?? null
  const ready = Boolean(chosen) && isTypedConfirmation(ownership.clubName, typed)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!chosen || !ready || busy) return
    setBusy(true)
    setError(null)
    const result = await transferClubOwnership(chosen.userId, typed)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onDone(chosen.name)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      title="Transfer ownership"
      description="The new owner can transfer ownership, close the club and manage the other club admins. You stay a club admin."
      className="sm:max-w-lg"
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <fieldset>
          <legend className="sk-label mb-1">New owner</legend>
          <List>
            {ownership.otherAdmins.map((admin) => (
              <RadioRow key={admin.userId} name="new-owner" value={admin.userId} checked={target === admin.userId} onChange={setTarget} title={admin.name} subtitle={admin.email ?? undefined} />
            ))}
          </List>
        </fieldset>
        <Field label={`Type ${ownership.clubName} to confirm`}>
          <Input autoComplete="off" spellCheck={false} value={typed} onChange={(event) => setTyped(event.target.value)} />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <FormActions>
          <Button variant="quiet" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !ready}>
            {busy ? "Transferring..." : "Transfer ownership"}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  )
}

function CloseClubDialog({ ownership, open, onClose }: { ownership: ClubOwnership; open: boolean; onClose: () => void }) {
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTyped("")
      setError(null)
    }
  }, [open])

  const ready = isTypedConfirmation(ownership.clubName, typed)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    const result = await closeClub(typed)
    if (!result.ok) {
      setBusy(false)
      setError(result.error.message)
      return
    }
    await signOutAfterClosing()
    // A full page load, for the same reason as after deleting an account.
    window.location.replace("/login?club=closed")
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      title="Close this club"
      description={`Everyone in ${ownership.clubName} is locked out straight away, you included.`}
      className="sm:max-w-lg"
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <p className="text-[0.9375rem] leading-relaxed text-sk-ink-2">
          Nothing is deleted today. The club's data is kept for {CLUB_DELETION_DAYS} days and then deleted for good: teams, athletes, plans, results, health information, messages and every member's sign-in. To
          reopen the club before then, email SKTR Coach support.
        </p>
        <SubSection title="Export first" hint="After closing you cannot sign in to export. Take a copy now.">
          <ExportBlock compact />
        </SubSection>
        <Field label={`Type ${ownership.clubName} to confirm`}>
          <Input autoComplete="off" spellCheck={false} value={typed} onChange={(event) => setTyped(event.target.value)} />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <FormActions>
          <Button variant="quiet" onClick={onClose} disabled={busy}>
            Keep club open
          </Button>
          <Button type="submit" variant="danger" disabled={busy || !ready}>
            {busy ? "Closing..." : "Close club"}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  )
}

export function ClubDataAndOwnership() {
  const [ownership, setOwnership] = useState<ClubOwnership | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<"transfer" | "close" | null>(null)
  const [transferred, setTransferred] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await getClubOwnership()
    if (result.ok) {
      setOwnership(result.data)
      setLoadError(null)
    } else {
      setLoadError(result.error.message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Section title="Club data and ownership" hint="Who owns the club, a copy of everything it stores, and closing it.">
      {loadError ? <Notice tone="error">We could not load who owns the club. {loadError}</Notice> : null}
      {!ownership && !loadError ? <SkeletonRows rows={3} label="Loading club ownership" /> : null}
      {ownership ? (
        <SubSections className="mt-3 max-w-3xl">
          <SubSection title="Owner" hint="One club admin owns the club. Only the owner can transfer ownership, close the club, or remove or change another club admin.">
            {transferred ? (
              <Notice tone="success" className="mb-3">
                {transferred} now owns the club. You are still a club admin. Both of you have been told.
              </Notice>
            ) : null}
            <FactList aria-label="Club owner">
              <Fact label="Club owner" empty="No owner">
                {ownership.ownerName ? `${ownership.ownerName}${ownership.isOwner ? " (you)" : ""}` : null}
              </Fact>
            </FactList>
            {ownership.isOwner ? (
              ownership.otherAdmins.length > 0 ? (
                <div className="mt-3">
                  <Button onClick={() => setDialog("transfer")}>Transfer ownership</Button>
                </div>
              ) : (
                <p className="sk-list-sub mt-3">To hand the club to someone else, invite them as a club admin under People first. Ownership can only go to an active club admin.</p>
              )
            ) : null}
          </SubSection>

          <SubSection title="Export club data">
            <ExportBlock />
          </SubSection>

          <SubSection
            title="Close this club"
            hint={`Closing locks everyone out at once and keeps the data for ${CLUB_DELETION_DAYS} days. After that it is deleted for good.`}
          >
            {ownership.isOwner ? (
              <List>
                <ListRow
                  title={`Close ${ownership.clubName}`}
                  subtitle="You will type the club's name to confirm. Export your data first."
                  trailing={
                    <Button size="sm" variant="danger" onClick={() => setDialog("close")}>
                      Close club
                    </Button>
                  }
                />
              </List>
            ) : (
              <p className="sk-list-sub">Only the club owner{ownership.ownerName ? `, ${ownership.ownerName},` : ""} can close the club.</p>
            )}
          </SubSection>
        </SubSections>
      ) : null}

      {ownership ? (
        <>
          <TransferDialog
            ownership={ownership}
            open={dialog === "transfer"}
            onClose={() => setDialog(null)}
            onDone={(name) => {
              setDialog(null)
              setTransferred(name)
              notify("Ownership transferred")
              void load()
            }}
          />
          <CloseClubDialog ownership={ownership} open={dialog === "close"} onClose={() => setDialog(null)} />
        </>
      ) : null}
    </Section>
  )
}
