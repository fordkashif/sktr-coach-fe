import { useEffect, useSyncExternalStore } from "react"
import {
  getNotificationFeed,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationsRead,
  subscribeToNotificationChanges,
  type NotificationItem,
} from "@/lib/data/notifications-data"
import type { NotificationRole } from "@/lib/notifications/target"

/**
 * The notification centre's state, shared by the bell in the shell and the /notifications page:
 * the unread count and the most recent notifications. One copy for the whole app, so marking
 * something read on the page updates the bell at once.
 */

/** How many the bell's sheet shows. The rest are behind "See all". */
export const RECENT_NOTIFICATION_LIMIT = 10
/** Gentle fallback when Realtime is not available: once a minute while the tab is visible. */
const POLL_INTERVAL_MS = 60_000

export const NOTIFICATIONS_LOAD_ERROR = "Your notifications could not be loaded. Check your connection and try again."
export const NOTIFICATIONS_SAVE_ERROR = "That could not be saved. Check your connection and try again."

export type NotificationCenterState = {
  role: NotificationRole | null
  recent: NotificationItem[]
  hasMore: boolean
  unreadCount: number
  /** True until the first load for this person has finished. */
  loading: boolean
  error: string | null
  /** Goes up whenever a refresh found something different. The /notifications page reloads on it. */
  revision: number
}

const initialState: NotificationCenterState = {
  role: null,
  recent: [],
  hasMore: false,
  unreadCount: 0,
  loading: true,
  error: null,
  revision: 0,
}

let state: NotificationCenterState = initialState
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null
let requestSeq = 0

function setState(next: Partial<NotificationCenterState>) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function fingerprint(items: NotificationItem[], unreadCount: number) {
  return `${unreadCount}|${items.map((item) => `${item.id}:${item.state}:${item.createdAt}`).join(",")}`
}

/** Loads the unread count and the recent list. Calls that arrive while one is running share it. */
export function refreshNotifications(role: NotificationRole): Promise<void> {
  if (state.role !== role) {
    // Someone else signed in on this tab: never show the previous person's notifications.
    requestSeq += 1
    inflight = null
    state = { ...initialState, role, revision: state.revision }
    listeners.forEach((listener) => listener())
  }
  if (inflight) return inflight

  const seq = requestSeq
  inflight = (async () => {
    const [feed, count] = await Promise.all([
      getNotificationFeed({ role, limit: RECENT_NOTIFICATION_LIMIT }),
      getUnreadNotificationCount(role),
    ])
    if (seq !== requestSeq) return

    if (!feed.ok) {
      setState({ loading: false, error: NOTIFICATIONS_LOAD_ERROR })
      return
    }
    const unreadCount = count.ok ? count.data : feed.data.items.filter((item) => item.state === "unread").length
    const changed = fingerprint(feed.data.items, unreadCount) !== fingerprint(state.recent, state.unreadCount)
    setState({
      recent: feed.data.items,
      hasMore: feed.data.hasMore,
      unreadCount,
      loading: false,
      error: null,
      revision: changed ? state.revision + 1 : state.revision,
    })
  })().finally(() => {
    if (seq === requestSeq) inflight = null
  })
  return inflight
}

/** Marks one notification read. The bell updates straight away; a failure puts it back. */
export async function markNotificationRead(role: NotificationRole, id: string): Promise<boolean> {
  const target = state.recent.find((item) => item.id === id)
  const wasUnreadHere = target?.state === "unread"
  const previous = { recent: state.recent, unreadCount: state.unreadCount }
  setState({
    recent: state.recent.map((item) => (item.id === id ? { ...item, state: "read", readAt: new Date().toISOString() } : item)),
    // An item that is not in the recent list (opened from the full history) still counts down.
    unreadCount: Math.max(0, state.unreadCount - (wasUnreadHere || !target ? 1 : 0)),
  })
  const result = await markNotificationsRead(role, [id])
  if (!result.ok) {
    setState({ ...previous, error: NOTIFICATIONS_SAVE_ERROR })
    return false
  }
  return true
}

export async function markEveryNotificationRead(role: NotificationRole): Promise<boolean> {
  const previous = { recent: state.recent, unreadCount: state.unreadCount }
  const readAt = new Date().toISOString()
  setState({
    recent: state.recent.map((item) => (item.state === "unread" ? { ...item, state: "read", readAt } : item)),
    unreadCount: 0,
    error: null,
  })
  const result = await markAllNotificationsRead(role)
  if (!result.ok) {
    setState({ ...previous, error: NOTIFICATIONS_SAVE_ERROR })
    return false
  }
  setState({ revision: state.revision + 1 })
  return true
}

export function useNotificationCenter(): NotificationCenterState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}

/**
 * Keeps the notification centre fresh for the signed-in person. Mounted once, by the shell.
 * Refreshes on mount, on every navigation (`pathname`), when the window regains focus or the tab
 * becomes visible, when Realtime reports a change to the person's rows, and once a minute while
 * the tab is visible (which is all that happens where Realtime is not available).
 */
export function useNotificationRefresh(role: NotificationRole, enabled: boolean, pathname: string) {
  useEffect(() => {
    if (!enabled) return
    void refreshNotifications(role)
  }, [role, enabled, pathname])

  useEffect(() => {
    if (!enabled) return

    const refresh = () => {
      if (document.visibilityState === "visible") void refreshNotifications(role)
    }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    const timer = window.setInterval(refresh, POLL_INTERVAL_MS)
    const unsubscribe = subscribeToNotificationChanges(() => void refreshNotifications(role))

    return () => {
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [role, enabled])
}
