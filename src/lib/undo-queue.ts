// Undo for small deletes: the row disappears at once, the request is sent when the timer ends,
// when the screen is left, or when the page is hidden. "Undo" cancels it before that.
// Pure queue first (no DOM), then the one shared queue the app uses.

/** How long "Undo" is offered before a delete is final. */
export const UNDO_DELAY_MS = 6000

type Clock = {
  setTimeout: (run: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export type UndoQueue = {
  /** Holds `commit` back for `delayMs`. Returns the id to undo or flush it with. */
  add: (commit: () => void | Promise<void>, delayMs?: number) => number
  /** Cancels a held delete. False when it was already sent (too late to undo). */
  undo: (id: number) => boolean
  /** Sends one held delete now. Does nothing when it is no longer held. */
  flush: (id: number) => void
  /** Sends every held delete now (the page is being hidden or closed). */
  flushAll: () => void
  has: (id: number) => boolean
  size: () => number
}

export function createUndoQueue(clock: Clock = { setTimeout: (run, ms) => globalThis.setTimeout(run, ms), clearTimeout: (handle) => globalThis.clearTimeout(handle as never) }): UndoQueue {
  const held = new Map<number, { timer: unknown; commit: () => void | Promise<void> }>()
  let nextId = 1

  const send = (id: number) => {
    const entry = held.get(id)
    if (!entry) return
    // Removed first, so a commit that flushes the queue again can never send twice.
    held.delete(id)
    clock.clearTimeout(entry.timer)
    try {
      const outcome = entry.commit()
      if (outcome && typeof (outcome as Promise<void>).catch === "function") void (outcome as Promise<void>).catch(() => undefined)
    } catch {
      // The caller's commit reports its own failure. One bad delete must not stop the others.
    }
  }

  return {
    add(commit, delayMs = UNDO_DELAY_MS) {
      const id = nextId++
      const timer = clock.setTimeout(() => send(id), delayMs)
      held.set(id, { timer, commit })
      return id
    },
    undo(id) {
      const entry = held.get(id)
      if (!entry) return false
      held.delete(id)
      clock.clearTimeout(entry.timer)
      return true
    },
    flush: send,
    flushAll() {
      for (const id of [...held.keys()]) send(id)
    },
    has: (id) => held.has(id),
    size: () => held.size,
  }
}

/** The app's queue. */
export const undoQueue = createUndoQueue()

let hideFlushUntil = 0

/**
 * True for a moment after the page was hidden with deletes still held. The Supabase client reads it
 * to send those requests with keepalive, so the browser finishes them while the tab closes.
 */
export function isFlushingForPageHide(now: number = Date.now()) {
  return now < hideFlushUntil
}

let installed = false

/** Sends held deletes when the tab is hidden or closed. Safe to call more than once. */
export function installUndoFlushOnHide() {
  if (installed || typeof window === "undefined") return
  installed = true
  const flush = () => {
    if (undoQueue.size() === 0) return
    hideFlushUntil = Date.now() + 3000
    undoQueue.flushAll()
  }
  window.addEventListener("pagehide", flush)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush()
  })
}
