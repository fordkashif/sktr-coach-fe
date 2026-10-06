import { useCallback, useEffect, useRef } from "react"
import { notify, notifyError } from "@/components/sk"
import { installUndoFlushOnHide, undoQueue, UNDO_DELAY_MS } from "@/lib/undo-queue"

export type UndoableDelete = {
  /** The toast: "Note deleted". */
  message: string
  detail?: string
  /** Take the row off the screen now. */
  hide: () => void
  /** Put it back (Undo, or the delete failed). */
  restore: () => void
  /** The real delete. Runs when the timer ends, the screen is left or the page is hidden. */
  commit: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>
  /** After the delete went through (reload counts, move on). */
  done?: () => void
  /** Toast title when the delete fails. */
  failed?: string
}

/**
 * A delete with "Undo" for a few seconds. For small things removed with one tap or an inline
 * confirm. Never for typed-confirmation actions (delete account, close club).
 * One toast shows at a time, so starting a new delete makes the one before it final.
 */
export function useUndoableDelete() {
  const mine = useRef(new Set<number>())

  useEffect(() => {
    installUndoFlushOnHide()
    const held = mine.current
    // Leaving the screen: the row is gone from view, so the delete is sent.
    return () => {
      for (const id of [...held]) undoQueue.flush(id)
    }
  }, [])

  return useCallback((options: UndoableDelete) => {
    undoQueue.flushAll()
    options.hide()
    let toast: { dismiss: () => void } | null = null
    const id = undoQueue.add(async () => {
      mine.current.delete(id)
      toast?.dismiss()
      const result = await options.commit().catch((cause: unknown) => ({ ok: false as const, error: { message: cause instanceof Error ? cause.message : "Try again in a moment." } }))
      if (!result.ok) {
        options.restore()
        notifyError(options.failed ?? "That was not deleted", result.error.message)
        return
      }
      options.done?.()
    }, UNDO_DELAY_MS)
    mine.current.add(id)
    toast = notify(options.message, options.detail, {
      durationMs: UNDO_DELAY_MS,
      action: {
        label: "Undo",
        onSelect: () => {
          if (!undoQueue.undo(id)) return
          mine.current.delete(id)
          options.restore()
        },
      },
    })
  }, [])
}
