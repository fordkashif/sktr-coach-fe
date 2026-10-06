"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { NotificationRows } from "@/components/notifications/notification-rows"
import { Button, EmptyState, LinkButton, Notice, Screen, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { getNotificationFeed, type NotificationItem } from "@/lib/data/notifications-data"
import { formatNotificationDayHeading, notificationDayKey } from "@/lib/notifications/format"
import {
  markEveryNotificationRead,
  markNotificationRead,
  NOTIFICATIONS_LOAD_ERROR,
  useNotificationCenter,
} from "@/lib/notifications/store"
import { NOTIFICATION_SETTINGS_PATH, type NotificationRole } from "@/lib/notifications/target"
import { useRole } from "@/lib/role-context"

const PAGE_SIZE = 20

const EMPTY_BODY: Record<NotificationRole, string> = {
  athlete: "You will hear here when your coach publishes a plan, opens a test week or leaves a note on a session.",
  coach: "You will hear here when athletes finish sessions, submit test results or report low readiness.",
  "club-admin": "You will hear here when a coach accepts an invite or something changes on your club's account.",
  "platform-admin": "You will hear here when a club asks to join.",
  guardian: "You will hear here when the coach publishes a plan, opens a test week, shares a report or posts an announcement.",
}

/** The full history, grouped by day, for every signed-in role. The bell's sheet links here with "See all". */
export default function NotificationsPage() {
  const { role } = useRole()
  const appRole = role as NotificationRole
  const center = useNotificationCenter()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadedCount = useRef(PAGE_SIZE)

  /** Loads from the top, keeping as many rows as are already on screen so "Load more" is not undone. */
  const reload = useCallback(async () => {
    const result = await getNotificationFeed({ role: appRole, limit: Math.min(100, Math.max(PAGE_SIZE, loadedCount.current)) })
    if (!result.ok) {
      setError(NOTIFICATIONS_LOAD_ERROR)
      setLoading(false)
      return
    }
    setItems(result.data.items)
    setHasMore(result.data.hasMore)
    setError(null)
    setLoading(false)
  }, [appRole])

  // First load, and again whenever the notification centre saw something change (a new one arrived,
  // or one was read from the bell).
  useEffect(() => {
    void reload()
  }, [reload, center.revision])

  const loadMore = async () => {
    const last = items[items.length - 1]
    if (!last || loadingMore) return
    setLoadingMore(true)
    const result = await getNotificationFeed({ role: appRole, limit: PAGE_SIZE, before: last.createdAt })
    setLoadingMore(false)
    if (!result.ok) {
      setError(NOTIFICATIONS_LOAD_ERROR)
      return
    }
    setItems((current) => {
      const known = new Set(current.map((item) => item.id))
      const next = [...current, ...result.data.items.filter((item) => !known.has(item.id))]
      loadedCount.current = next.length
      return next
    })
    setHasMore(result.data.hasMore)
    setError(null)
  }

  const openItem = (item: NotificationItem) => {
    if (item.state !== "unread") return
    setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, state: "read" } : entry)))
    void markNotificationRead(appRole, item.id)
  }

  const markAllRead = async () => {
    setItems((current) => current.map((entry) => (entry.state === "unread" ? { ...entry, state: "read" } : entry)))
    const saved = await markEveryNotificationRead(appRole)
    if (!saved) void reload()
  }

  const days = useMemo(() => {
    const groups: Array<{ key: string; heading: string; items: NotificationItem[] }> = []
    for (const item of items) {
      const key = notificationDayKey(item.createdAt)
      const group = groups[groups.length - 1]
      if (group && group.key === key) group.items.push(item)
      else groups.push({ key, heading: formatNotificationDayHeading(item.createdAt), items: [item] })
    }
    return groups
  }, [items])

  const unreadCount = center.unreadCount
  const lede =
    loading || error
      ? undefined
      : unreadCount === 0
        ? "You are all caught up."
        : unreadCount === 1
          ? "1 unread."
          : `${unreadCount} unread.`

  return (
    <Screen width="narrow">
      <ScreenHeader
        title="Notifications"
        lede={lede}
        actions={
          <>
            {unreadCount > 0 ? (
              <Button size="sm" onClick={() => void markAllRead()}>
                Mark all read
              </Button>
            ) : null}
            <LinkButton size="sm" variant="quiet" to={NOTIFICATION_SETTINGS_PATH}>
              Notification settings
            </LinkButton>
          </>
        }
      />

      {error ? (
        <Notice
          tone="error"
          action={
            <Button variant="quiet" size="sm" onClick={() => void reload()}>
              Try again
            </Button>
          }
        >
          {error}
        </Notice>
      ) : null}
      {center.error && !error ? <Notice tone="error">{center.error}</Notice> : null}

      {loading ? (
        <Section title="Today">
          <SkeletonRows rows={5} label="Loading notifications" />
        </Section>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <Section>
          <EmptyState title="Nothing here yet" body={EMPTY_BODY[appRole] ?? EMPTY_BODY.athlete} />
        </Section>
      ) : null}

      {days.map((day) => (
        <Section key={day.key} title={day.heading}>
          <NotificationRows items={day.items} onOpen={openItem} label={`Notifications, ${day.heading}`} />
        </Section>
      ))}

      {hasMore ? (
        <Section aria-label="Older notifications">
          <Button className="self-start" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading older notifications" : "Load more"}
          </Button>
        </Section>
      ) : null}
    </Screen>
  )
}
