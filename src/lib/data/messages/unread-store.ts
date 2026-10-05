import { useEffect, useSyncExternalStore } from "react"
import { getMessageUnreadCounts, MESSAGES_CHANGED_EVENT } from "@/lib/data/messages/messages-data"
import type { MessageUnreadCounts } from "@/lib/data/messages/types"

/**
 * How many messages and announcements the signed-in person has not read. One copy for the whole
 * app, shown on the Messages button in the shell. It is refreshed when the person navigates, comes
 * back to the tab, reads or sends something (MESSAGES_CHANGED_EVENT), whenever the notification
 * centre hears something new (a new message always comes with a notification), and once a minute.
 */

const EMPTY: MessageUnreadCounts = { direct: 0, announcements: 0, openReports: 0 }
const POLL_INTERVAL_MS = 60_000

let state: { key: string | null; counts: MessageUnreadCounts } = { key: null, counts: EMPTY }
const listeners = new Set<() => void>()
let requestSeq = 0

function setState(next: typeof state) {
  state = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** `key` identifies the signed-in person (role and email), so a different person never sees the last one's count. */
export async function refreshMessageUnread(key: string): Promise<void> {
  if (state.key !== key) setState({ key, counts: EMPTY })
  const seq = ++requestSeq
  const result = await getMessageUnreadCounts()
  if (seq !== requestSeq || state.key !== key) return
  if (!result.ok) return
  const next = result.data
  const current = state.counts
  if (next.direct !== current.direct || next.announcements !== current.announcements || next.openReports !== current.openReports) {
    setState({ key, counts: next })
  }
}

export function useMessageUnread(): MessageUnreadCounts & { total: number } {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
  const { direct, announcements, openReports } = snapshot.counts
  return { direct, announcements, openReports, total: direct + announcements + openReports }
}

/** Keeps the count fresh. Mounted once, by the Messages button in the shell. `signal` is anything that changes when a refresh is due. */
export function useMessageUnreadRefresh(key: string | null, enabled: boolean, signal: string) {
  useEffect(() => {
    if (!enabled || !key) return
    void refreshMessageUnread(key)
  }, [key, enabled, signal])

  useEffect(() => {
    if (!enabled || !key) return
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshMessageUnread(key)
    }
    window.addEventListener("focus", refresh)
    window.addEventListener(MESSAGES_CHANGED_EVENT, refresh)
    document.addEventListener("visibilitychange", refresh)
    const timer = window.setInterval(refresh, POLL_INTERVAL_MS)
    return () => {
      window.removeEventListener("focus", refresh)
      window.removeEventListener(MESSAGES_CHANGED_EVENT, refresh)
      document.removeEventListener("visibilitychange", refresh)
      window.clearInterval(timer)
    }
  }, [key, enabled])
}
