import { List, ListRow, StatusDot } from "@/components/sk"
import type { NotificationItem } from "@/lib/data/notifications-data"
import { formatNotificationExact, formatNotificationTime } from "@/lib/notifications/format"
import { cn } from "@/lib/utils"

/**
 * Notifications as list rows, shared by the bell's sheet and the /notifications page.
 * Each row is a link to the screen the notification is about. Unread rows carry a blue dot and
 * bold title (and say "unread" to a screen reader). `onOpen` runs when a row is followed: mark it
 * read, close the sheet.
 */
export function NotificationRows({
  items,
  onOpen,
  label = "Notifications",
}: {
  items: NotificationItem[]
  onOpen: (item: NotificationItem) => void
  label?: string
}) {
  return (
    <List aria-label={label}>
      {items.map((item) => {
        const unread = item.state === "unread"
        return (
          <ListRow
            key={item.id}
            to={item.href}
            onNavigate={() => onOpen(item)}
            className="items-start"
            // The dot keeps its space when read, so titles line up down the list.
            leading={<StatusDot tone="blue" className={cn("mt-[7px]", !unread && "invisible")} />}
          >
            <span className={cn("sk-list-title", unread && "font-bold")}>
              {item.subject}
              {unread ? <span className="sr-only"> (unread)</span> : null}
            </span>
            {item.body ? <span className="sk-list-sub mt-0.5">{item.body}</span> : null}
            <span className="sk-list-sub mt-1">
              <time dateTime={item.createdAt} title={formatNotificationExact(item.createdAt)}>
                {formatNotificationTime(item.createdAt)}
              </time>
            </span>
          </ListRow>
        )
      })}
    </List>
  )
}
