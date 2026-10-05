import { useCallback, useEffect, useState } from "react"
import { Button, Choices, Dialog, Field, Input, Notice, Textarea, notify, notifyError } from "@/components/sk"
import {
  AVAILABILITY_CHANGED_EVENT,
  AVAILABILITY_KINDS,
  currentAvailability,
  describeAvailability,
  endMyAvailability,
  getMyAvailability,
  setMyAvailability,
  type AthleteAvailability,
  type AvailabilityKind,
} from "@/lib/data/athlete/availability-data"
import { todayIso } from "@/lib/data/training-plan/plan-builder-model"

/**
 * The athlete's own availability (injured, sick, away). Shared by home, plan and log:
 * the hook, the notice with "I'm back", and the dialog that sets a period.
 */
export function useMyAvailability() {
  const [periods, setPeriods] = useState<AthleteAvailability[] | null>(null)

  const reload = useCallback(() => {
    void getMyAvailability().then((result) => {
      // A notice, not the screen: when it cannot be read the screen carries on without it.
      setPeriods(result.ok ? result.data : [])
    })
  }, [])

  useEffect(() => {
    reload()
    window.addEventListener(AVAILABILITY_CHANGED_EVENT, reload)
    return () => window.removeEventListener(AVAILABILITY_CHANGED_EVENT, reload)
  }, [reload])

  return { periods: periods ?? [], loaded: periods !== null, current: currentAvailability(periods ?? []), reload }
}

/** One line at the top of home, plan and log while the athlete is marked unavailable. Renders nothing otherwise. */
export function AvailabilityNotice({ current }: { current: AthleteAvailability | null }) {
  const [ending, setEnding] = useState(false)
  if (!current) return null
  const today = todayIso()
  const started = current.startsOn <= today
  const who = current.createdByRole === "coach" ? "Your coach marked you as" : current.createdByRole === "club-admin" ? "Your club marked you as" : "You are marked as"

  const end = async () => {
    setEnding(true)
    const result = await endMyAvailability(current.id)
    setEnding(false)
    if (result.ok) notify(started ? "Welcome back" : "Removed", started ? "Your planned sessions count again from today." : undefined)
    else notifyError("Could not save that", result.error.message)
  }

  return (
    <Notice
      tone="warning"
      action={
        <Button variant="quiet" size="sm" disabled={ending} onClick={() => void end()}>
          {ending ? "Saving..." : started ? "I'm back" : "Remove"}
        </Button>
      }
    >
      {who} {describeAvailability(current, today)}. Sessions in that time are excused.
    </Notice>
  )
}

/** "I can't train for a while": kind, first day, last day (optional) and a short note for the coach. */
export function AvailabilityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [kind, setKind] = useState<AvailabilityKind | null>(null)
  const [startsOn, setStartsOn] = useState(todayIso)
  const [endsOn, setEndsOn] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missingKind, setMissingKind] = useState(false)

  useEffect(() => {
    if (!open) return
    setKind(null)
    setStartsOn(todayIso())
    setEndsOn("")
    setNote("")
    setError(null)
    setMissingKind(false)
  }, [open])

  const save = async () => {
    if (!kind) {
      setMissingKind(true)
      return
    }
    setSaving(true)
    setError(null)
    const result = await setMyAvailability({ kind, startsOn, endsOn: endsOn || null, note: note.trim() || null })
    setSaving(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    notify("Marked as unavailable", "Your coach has been told.")
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="I can't train for a while"
      description="Your coach is told. Planned sessions in this time will not count as missed."
      footer={
        <>
          <Button variant="quiet" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving..." : "Mark me unavailable"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Choices
          label="Why"
          columns={3}
          options={AVAILABILITY_KINDS}
          value={kind}
          onChange={(next) => {
            setKind(next)
            setMissingKind(false)
          }}
          error={missingKind ? "Choose one." : undefined}
        />
        <Field label="From">
          <Input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
        </Field>
        <Field label="Until" optional hint="Leave empty if you do not know yet. You can end it any time with I'm back.">
          <Input type="date" value={endsOn} min={startsOn} onChange={(event) => setEndsOn(event.target.value)} />
        </Field>
        <Field label="Note for your coach" optional>
          <Textarea rows={2} maxLength={280} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What happened, what you can still do" />
        </Field>
        {error ? (
          <Notice tone="error">Could not save that. {error}</Notice>
        ) : null}
      </div>
    </Dialog>
  )
}

/** The notice on its own, for screens that need nothing else from the hook (athlete home). */
export function MyAvailabilityNotice() {
  const { current } = useMyAvailability()
  return <AvailabilityNotice current={current} />
}
