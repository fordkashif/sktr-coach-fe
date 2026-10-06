"use client"

import { useCallback, useEffect, useState } from "react"
import { Button, Dialog, Field, FormActions, Notice, Section, Textarea, notify } from "@/components/sk"
import { dismissHandoverRequest, getMyOpenHandoverRequest, HANDOVER_NOTE_MAX_LENGTH, requestCoachHandover, type HandoverRequest } from "@/lib/data/club-admin/handover-data"

function shortDate(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

/**
 * A coach asks club admins to hand a team to someone else. It is only a message to the admins:
 * a coach cannot take themselves off a team or pick who follows them. Shown to coaches at the foot
 * of their team page.
 */
export function HandoverRequestSection({ teamId, teamName }: { teamId: string; teamName: string }) {
  const [request, setRequest] = useState<HandoverRequest | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await getMyOpenHandoverRequest()
    setRequest(result.ok ? result.data : null)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Nothing to show until we know whether a request is open: no flicker of the wrong line.
  if (request === undefined) return null

  const send = async () => {
    setBusy(true)
    setError(null)
    const result = await requestCoachHandover({ note, teamIds: [teamId] })
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setOpen(false)
    setNote("")
    notify("Request sent to your club admins", "You keep coaching this team until they hand it over.")
    await load()
  }

  const takeBack = async () => {
    if (!request) return
    setBusy(true)
    const result = await dismissHandoverRequest(request.id)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setRequest(null)
    notify("Request taken back")
  }

  const covered = request ? request.teamIds.includes(teamId) : false

  return (
    <Section title="Leaving this team" hint="Only a club admin can change who coaches a team.">
      {request ? (
        <p className="text-sm text-sk-ink-2" data-handover-request-sent>
          You asked your club admins on {shortDate(request.createdAt)} to hand over {covered ? teamName : "a team"}. You keep coaching until they do.{" "}
          <button type="button" className="sk-link cursor-pointer" disabled={busy} onClick={() => void takeBack()}>
            Take the request back
          </button>
        </p>
      ) : (
        <p className="text-sm text-sk-ink-2">
          Stepping back from {teamName}?{" "}
          <button type="button" className="sk-link cursor-pointer" onClick={() => setOpen(true)}>
            Ask a club admin to hand it over
          </button>
        </p>
      )}
      {error && !open ? <Notice tone="error">{error}</Notice> : null}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next)
        }}
        title={`Ask to hand over ${teamName}`}
        description="This sends a message to your club admins. They choose who takes over, and you keep coaching the team until they do."
      >
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <Field label="Note for the club admins" optional hint="When you would like to stop, and who could take over.">
            <Textarea rows={3} maxLength={HANDOVER_NOTE_MAX_LENGTH} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <FormActions>
            <Button variant="quiet" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Sending..." : "Send request"}
            </Button>
          </FormActions>
        </form>
      </Dialog>
    </Section>
  )
}
