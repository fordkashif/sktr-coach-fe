import { Bell } from "@phosphor-icons/react"
import { useLocation } from "react-router-dom"
import { NotificationRows } from "@/components/notifications/notification-rows"
import { Button, EmptyState, LinkButton, Notice, Sheet, SkeletonRows } from "@/components/sk"
import type { NotificationItem } from "@/lib/data/notifications-data"
import {
  markEveryNotificationRead,
  markNotificationRead,
  refreshNotifications,
  useNotificationCenter,
  useNotificationRefresh,
} from "@/lib/notifications/store"
import { NOTIFICATIONS_PATH, type NotificationRole } from "@/lib/notifications/target"
import { useRole } from "@/lib/role-context"

/**
 * The notification centre in the shell: the bell (drawn in the phone app bar and in the desktop top
 * bar) and the one sheet it opens. Every signed-in role has it. The data lives in
 * src/lib/notifications/store.ts, shared with the /notifications page.
 */

/** The bell with the unread count. `onOpen` opens the sheet. */
export function NotificationBell({ onOpen }: { onOpen: () => void }) {
  const { unreadCount } = useNotificationCenter()
  const label = unreadCount === 0 ? "Notifications" : unreadCount === 1 ? "Notifications, 1 unread" : `Notifications, ${unreadCount} unread`
  return (
    <button type="button" className="sk-icon-btn" aria-label={label} aria-haspopup="dialog" onClick={onOpen}>
      <Bell className="size-5" weight="bold" aria-hidden />
      {unreadCount > 0 ? (
        <span
          aria-hidden
          data-testid="notification-count"
          className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-sk-coral-ink px-1 text-[11px] font-bold leading-none text-white tabular-nums ring-2 ring-white"
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </button>
  )
}

const EMPTY_BODY: Record<NotificationRole, string> = {
  athlete: "New plans, test weeks and notes from your coach show up here.",
  coach: "Finished sessions, test results and low readiness check-ins show up here.",
  "club-admin": "Accepted invites and changes to your club's account show up here.",
  "platform-admin": "New club requests show up here.",
}

/**
 * The sheet with the most recent notifications. Mounted once by the shell for as long as the bell
 * is shown, so it also owns keeping the notification centre fresh (see useNotificationRefresh).
 */
export function NotificationSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { role } = useRole()
  const appRole = role as NotificationRole
  const { pathname } = useLocation()
  const center = useNotificationCenter()
  useNotificationRefresh(appRole, true, pathname)

  const openItem = (item: NotificationItem) => {
    onOpenChange(false)
    if (item.state === "unread") void markNotificationRead(appRole, item.id)
  }

  const showSkeleton = center.loading && center.recent.length === 0
  const showEmpty = !center.loading && !center.error && center.recent.length === 0

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Notifications"
      footer={
        <>
          {center.unreadCount > 0 ? (
            <Button size="sm" onClick={() => void markEveryNotificationRead(appRole)}>
              Mark all read
            </Button>
          ) : null}
          <LinkButton size="sm" variant="quiet" to={NOTIFICATIONS_PATH} onClick={() => onOpenChange(false)}>
            See all
          </LinkButton>
        </>
      }
    >
      {center.error ? (
        <Notice
          tone="error"
          className="mb-3"
          action={
            <Button variant="quiet" size="sm" onClick={() => void refreshNotifications(appRole)}>
              Try again
            </Button>
          }
        >
          {center.error}
        </Notice>
      ) : null}
      {showSkeleton ? <SkeletonRows rows={4} label="Loading notifications" /> : null}
      {showEmpty ? <EmptyState title="You are all caught up" body={EMPTY_BODY[appRole] ?? EMPTY_BODY.athlete} /> : null}
      {center.recent.length > 0 ? <NotificationRows items={center.recent} onOpen={openItem} /> : null}
    </Sheet>
  )
}
