import { useCallback, useEffect, useState, type FormEvent } from "react"
import { ActionRow, Button, Dialog, Field, FormActions, InlineConfirm, Input, List, Notice, Section, StatusText, notify } from "@/components/sk"
import { deleteClosedClub, getClosedClubs, reopenClosedClub, type ClosedClub } from "@/lib/data/platform-admin/closed-clubs-data"
import { daysUntilDeletion, deletionCountdownText, isTypedConfirmation } from "@/lib/data-rights"

function day(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "an unknown date" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

function people(count: number, word: string) {
  return `${count} ${count === 1 ? word : `${word}s`}`
}

/**
 * Closed clubs on the platform admin's Clubs screen. A club its owner closed is kept for 90 days
 * and then deleted for good by the daily job. Until then a platform admin can reopen it, or
 * delete it now behind the club's typed name. Shows nothing while no club is closed.
 */
export function ClosedClubsSection({ onChanged }: { onChanged?: () => void }) {
  const [clubs, setClubs] = useState<ClosedClub[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reopening, setReopening] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ClosedClub | null>(null)
  const [typed, setTyped] = useState("")
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await getClosedClubs()
    if (result.ok) {
      setClubs(result.data)
      setLoadError(null)
    } else {
      setClubs([])
      setLoadError(result.error.message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const reopen = async (club: ClosedClub) => {
    setBusy(true)
    setError(null)
    const result = await reopenClosedClub(club.tenantId)
    setBusy(false)
    setReopening(null)
    if (!result.ok) {
      setError(`Could not reopen ${club.clubName}. ${result.error.message}`)
      return
    }
    setDone(`${club.clubName} is open again. Its members can sign in and nothing was deleted.`)
    notify("Club reopened")
    await load()
    onChanged?.()
  }

  const submitDelete = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!deleting || busy || !isTypedConfirmation(deleting.clubName, typed)) return
    setBusy(true)
    setDeleteError(null)
    const result = await deleteClosedClub(deleting, typed)
    setBusy(false)
    if (!result.ok) {
      setDeleteError(result.error.message)
      return
    }
    setDone(
      result.data.filesRemovedNow
        ? `${deleting.clubName} and all its data were deleted for good.`
        : `${deleting.clubName} and all its data were deleted for good. ${result.data.filesQueued} photo and logo files are queued and are removed from storage by the daily job.`,
    )
    setDeleting(null)
    setTyped("")
    notify("Club deleted")
    await load()
    onChanged?.()
  }

  const rowButtons = (club: ClosedClub) => (
    <>
      <Button size="sm" disabled={busy} aria-label={`Reopen ${club.clubName}`} onClick={() => setReopening(club.tenantId)}>
        Reopen
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={busy}
        aria-label={`Delete now: ${club.clubName}`}
        onClick={() => {
          setTyped("")
          setDeleteError(null)
          setDeleting(club)
        }}
      >
        Delete now
      </Button>
    </>
  )

  if (clubs === null) return null
  if (clubs.length === 0 && !loadError && !done) return null

  return (
    <Section
      title="Closed clubs"
      hint="Closed by the club's owner. Members cannot sign in. A closed club is deleted for good 90 days after it was closed."
      meta={clubs.length > 0 ? `${clubs.length} closed` : undefined}
    >
      {loadError ? <Notice tone="error">We could not load closed clubs. {loadError}</Notice> : null}
      {done ? (
        <Notice
          tone="success"
          className="mb-3"
          action={
            <Button variant="quiet" size="sm" onClick={() => setDone(null)}>
              Dismiss
            </Button>
          }
        >
          {done}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      ) : null}
      {clubs.length > 0 ? (
        <List aria-label="Closed clubs">
          {clubs.map((club) => (
            <ActionRow
              key={club.tenantId}
              data-closed-club={club.clubName}
              title={club.clubName}
              subtitle={
                <>
                  Closed {day(club.closedAt)}
                  {club.closedByName ? ` by ${club.closedByName}` : ""}. {people(club.memberCount, "member")}, {people(club.athleteCount, "athlete")}.{" "}
                  <StatusText tone={daysUntilDeletion(club.deleteAfter) <= 14 ? "coral" : "amber"}>
                    Deleted after {day(club.deleteAfter)} ({deletionCountdownText(club.deleteAfter).toLowerCase()})
                  </StatusText>
                </>
              }
              actions={reopening === club.tenantId ? null : <div className="hidden items-center gap-1 sm:flex">{rowButtons(club)}</div>}
              below={
                reopening === club.tenantId ? (
                  <InlineConfirm
                    question={`Reopen ${club.clubName}? Its members can sign in again and it will not be deleted.`}
                    confirmLabel="Reopen club"
                    cancelLabel="Leave closed"
                    busy={busy}
                    onConfirm={() => void reopen(club)}
                    onCancel={() => setReopening(null)}
                  />
                ) : (
                  // On a phone the two buttons sit under the row, so the dates keep the full width.
                  <div className="flex flex-wrap gap-2 sm:hidden">{rowButtons(club)}</div>
                )
              }
            />
          ))}
        </List>
      ) : null}

      <Dialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next && !busy) setDeleting(null)
        }}
        title="Delete permanently now"
        description="This cannot be undone and there is no copy to restore from in the app."
        className="sm:max-w-lg"
      >
        {deleting ? (
          <form className="flex flex-col gap-4" onSubmit={(event) => void submitDelete(event)}>
            <p className="text-[0.9375rem] leading-relaxed text-sk-ink-2">
              Everything <span className="font-bold text-sk-ink">{deleting.clubName}</span> stored is deleted for good: its teams, athletes, plans, sessions, results, health information and messages, the sign-in
              accounts of its {people(deleting.memberCount, "member")}, and its logo and profile photos.
            </p>
            <p className="text-[0.9375rem] leading-relaxed text-sk-ink-2">
              If you wait, this happens by itself after {day(deleting.deleteAfter)}. Other clubs and platform admin accounts are not touched.
            </p>
            <Field label={`Type ${deleting.clubName} to confirm`}>
              <Input autoComplete="off" spellCheck={false} value={typed} onChange={(event) => setTyped(event.target.value)} />
            </Field>
            {deleteError ? <Notice tone="error">{deleteError}</Notice> : null}
            <FormActions>
              <Button variant="quiet" onClick={() => setDeleting(null)} disabled={busy}>
                Keep club
              </Button>
              <Button type="submit" variant="danger" disabled={busy || !isTypedConfirmation(deleting.clubName, typed)}>
                {busy ? "Deleting..." : "Delete club for good"}
              </Button>
            </FormActions>
          </form>
        ) : null}
      </Dialog>
    </Section>
  )
}
