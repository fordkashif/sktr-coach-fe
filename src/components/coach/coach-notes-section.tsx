"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { ActionRow, Button, EmptyState, Field, FormGrid, InlineConfirm, Input, List, Notice, RowMenu, Section, SkeletonRows, StatusText, Textarea, notify, type RowMenuItem } from "@/components/sk"
import { useUndoableDelete } from "@/lib/use-undoable-delete"
import { addCoachNote, COACH_NOTE_MAX_LENGTH, deleteCoachNote, listCoachNotes, updateCoachNote, type CoachNote } from "@/lib/data/coach/coach-notes-data"
import { parseLocalDay } from "@/lib/data/pr/pr-display"
import { todayIso } from "@/lib/data/training-plan/plan-builder-model"

const SHOWN = 5

function dayText(value: string) {
  const day = parseLocalDay(value)
  if (!day) return value
  return day.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(day.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) })
}

function NoteForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { body: string; date: string }
  submitLabel: string
  onSubmit: (values: { body: string; date: string }) => Promise<string | null>
  onCancel: () => void
}) {
  const [body, setBody] = useState(initial.body)
  const [date, setDate] = useState(initial.date)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const problem = await onSubmit({ body, date })
    setBusy(false)
    if (problem) setError(problem)
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)} data-coach-note-form>
      <Field label="Note" error={error ?? undefined}>
        <Textarea rows={3} maxLength={COACH_NOTE_MAX_LENGTH} required autoFocus value={body} onChange={(event) => setBody(event.target.value)} placeholder="What you saw, what to watch, what was agreed" />
      </Field>
      <FormGrid>
        <Field label="Day">
          <Input type="date" required max={todayIso()} value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
      </FormGrid>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || !body.trim()}>
          {busy ? "Saving..." : submitLabel}
        </Button>
        <Button size="sm" variant="quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/**
 * Private notes about one athlete, on the coach's athlete screen. Only coaches of the athlete's
 * team and club admins can read them (the database enforces it); the athlete never sees them.
 */
export function CoachNotesSection({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  const [notes, setNotes] = useState<CoachNote[] | null>(null)
  const undoableDelete = useUndoableDelete()
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const first = athleteName.split(" ")[0] || athleteName

  const load = useCallback(async () => {
    const result = await listCoachNotes(athleteId)
    if (!result.ok) {
      setLoadError(result.error.message)
      setNotes((current) => current ?? [])
      return
    }
    setLoadError(null)
    setNotes(result.data)
  }, [athleteId])

  useEffect(() => {
    void load()
  }, [load])

  const togglePin = async (note: CoachNote) => {
    setBusyId(note.id)
    const result = await updateCoachNote(note.id, { pinned: !note.pinned })
    setBusyId(null)
    if (!result.ok) {
      setLoadError(result.error.message)
      return
    }
    notify(note.pinned ? "Note unpinned" : "Note pinned to the top")
    void load()
  }

  // The note leaves the list at once. The delete is sent when "Undo" runs out.
  const remove = (note: CoachNote) => {
    setConfirmId(null)
    undoableDelete({
      message: "Note deleted",
      failed: "The note was not deleted",
      hide: () => setNotes((current) => (current ? current.filter((item) => item.id !== note.id) : current)),
      restore: () => void load(),
      commit: () => deleteCoachNote(note.id),
    })
  }

  const visible = notes ? (showAll ? notes : notes.slice(0, SHOWN)) : []

  return (
    <Section
      title="Coach notes"
      hint="Only coaches and club admins can see these."
      data-coach-notes
      action={
        adding ? undefined : (
          <Button variant="quiet" size="sm" onClick={() => setAdding(true)}>
            Add note
          </Button>
        )
      }
    >
      {loadError ? <Notice tone="error">Could not load or save notes: {loadError}</Notice> : null}

      {adding ? (
        <NoteForm
          initial={{ body: "", date: todayIso() }}
          submitLabel="Save note"
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            const result = await addCoachNote(athleteId, { ...values, pinned: false })
            if (!result.ok) return result.error.message
            setAdding(false)
            notify("Note saved")
            void load()
            return null
          }}
        />
      ) : null}

      {notes === null ? (
        <SkeletonRows rows={2} label="Loading coach notes" />
      ) : notes.length === 0 ? (
        adding ? null : (
          <EmptyState title="No notes yet" body={`Keep what you notice about ${first} here: how a session looked, what you agreed, what to watch. ${first} never sees it.`} />
        )
      ) : (
        <>
          <List aria-label="Coach notes">
            {visible.map((note) => {
              const items: RowMenuItem[] = [
                ...(note.canEdit
                  ? [
                      { label: "Edit", onSelect: () => setEditingId(note.id) },
                      { label: note.pinned ? "Unpin" : "Pin to top", onSelect: () => void togglePin(note), disabled: busyId === note.id },
                    ]
                  : []),
                ...(note.canDelete ? [{ label: "Delete", onSelect: () => setConfirmId(note.id), danger: true }] : []),
              ]
              const editing = editingId === note.id
              return (
                <ActionRow
                  key={note.id}
                  data-coach-note={note.id}
                  className="[&_.sk-list-row]:items-start"
                  title={dayText(note.date)}
                  subtitle={
                    editing ? (
                      note.authorName
                    ) : (
                      <>
                        <span className="mt-1 block whitespace-pre-wrap break-words text-[0.9375rem] leading-relaxed text-sk-ink">{note.body}</span>
                        <span className="mt-1 block">
                          {note.authorName}
                          {note.edited ? ", edited" : ""}
                        </span>
                      </>
                    )
                  }
                  trailing={note.pinned ? <StatusText tone="blue">Pinned</StatusText> : undefined}
                  actions={items.length > 0 && !editing ? <RowMenu label={`More for the note of ${dayText(note.date)}`} items={items} /> : undefined}
                  below={
                    editing ? (
                      <NoteForm
                        initial={{ body: note.body, date: note.date }}
                        submitLabel="Save changes"
                        onCancel={() => setEditingId(null)}
                        onSubmit={async (values) => {
                          const result = await updateCoachNote(note.id, values)
                          if (!result.ok) return result.error.message
                          setEditingId(null)
                          notify("Note saved")
                          void load()
                          return null
                        }}
                      />
                    ) : confirmId === note.id ? (
                      <InlineConfirm
                        question="Delete this note? It cannot be brought back."
                        confirmLabel="Delete note"
                        busy={busyId === note.id}
                        onConfirm={() => remove(note)}
                        onCancel={() => setConfirmId(null)}
                      />
                    ) : undefined
                  }
                />
              )
            })}
          </List>
          {notes.length > SHOWN ? (
            <div>
              <Button variant="quiet" size="sm" aria-expanded={showAll} onClick={() => setShowAll((current) => !current)}>
                {showAll ? "Show fewer" : `Show all ${notes.length} notes`}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Section>
  )
}
