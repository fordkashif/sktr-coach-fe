import type { ReactNode } from "react"
import { Button } from "./controls"
import { Dialog } from "./overlays"

/**
 * EditConflictDialog: shown when a save would replace a change someone else made to the same
 * record since it was opened (a plan, a test week, a team, the club profile). The title says who
 * and when ("Andre changed this plan 2 minutes ago."), from conflictSentence in
 * src/lib/data/edit-conflict.ts. Two ways on: look at their version, or save over it on purpose.
 * Closing it changes nothing: the form stays open with the person's own work in it.
 */
export function EditConflictDialog({
  open,
  title,
  children,
  busy = false,
  onSeeTheirs,
  onSaveMine,
  onClose,
}: {
  open: boolean
  /** Who changed it and when. */
  title: string
  /** What happens to the person's own unsaved work if they look at the other version. */
  children: ReactNode
  busy?: boolean
  onSeeTheirs: () => void
  onSaveMine: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      title={title}
      description="Your changes were not saved over theirs."
      footer={
        <>
          <Button variant="danger" onClick={onSaveMine} disabled={busy}>
            Save mine anyway
          </Button>
          <Button variant="primary" onClick={onSeeTheirs} disabled={busy}>
            See their version
          </Button>
        </>
      }
    >
      <div data-edit-conflict className="text-[0.9375rem] leading-relaxed text-sk-mute">
        {children}
      </div>
    </Dialog>
  )
}
