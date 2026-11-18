import { Link } from "react-router-dom"
import { Alarm, Bell, Buildings, CalendarCheck, ChatCircleText, CheckCircle, FileText, Heartbeat, Megaphone, Receipt, Timer, UserPlus, type Icon } from "@phosphor-icons/react"
import type { NotificationItem } from "@/lib/data/notifications-data"
import { formatNotificationExact, formatNotificationTime } from "@/lib/notifications/format"
import { cn } from "@/lib/utils"

/** A picture for what the notification is about, so a long list reads at a glance. */
function iconFor(eventType: string): Icon {
  if (eventType.startsWith("reminder_test_week") || eventType.includes("test_week") || eventType.includes("test_results")) return Timer
  if (eventType.startsWith("reminder_")) return Alarm
  if (eventType.includes("readiness") || eventType.includes("checkin") || eventType.includes("wellness")) return Heartbeat
  if (eventType.includes("session_completed")) return CheckCircle
  if (eventType.includes("note") || eventType.includes("message")) return ChatCircleText
  if (eventType.includes("invite") || eventType.includes("team_added")) return UserPlus
  if (eventType.includes("plan_published")) return CalendarCheck
  if (eventType.includes("announcement") || eventType.includes("notice")) return Megaphone
  if (eventType.includes("report")) return FileText
  if (eventType.includes("package")) return Receipt
  if (eventType.includes("provision") || eventType.includes("tenant")) return Buildings
  return Bell
}

/**
 * Notifications as cards, shared by the bell's sheet and the /notifications page. Each card is a
 * link to the screen it is about, with a round picture of what it is (in the accent while unread)
 * and a dot. `onOpen` runs when a card is followed: mark it read, close the sheet.
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
    <ul aria-label={label} className="flex flex-col gap-2">
      {items.map((item, index) => {
        const unread = item.state === "unread"
        const ItemIcon = iconFor(item.eventType)
        return (
          <li key={item.id} className="sk-tile-item" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
            <Link to={item.href} onClick={() => onOpen(item)} className="sk-tile group flex items-start gap-3 p-3.5" data-notification-state={item.state}>
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-full transition-transform duration-300 group-hover:scale-110", unread ? "bg-sk-accent text-sk-on-accent" : "bg-white text-sk-ink")} aria-hidden>
                <ItemIcon className="size-5" weight="bold" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block leading-snug text-sk-ink", unread ? "font-bold" : "font-semibold")}>
                  {item.subject}
                  {unread ? <span className="sr-only"> (unread)</span> : null}
                </span>
                {item.body ? <span className="mt-0.5 block text-sm leading-snug text-sk-mute">{item.body}</span> : null}
                <span className="mt-1 block text-[0.8125rem] font-semibold text-sk-mute">
                  <time dateTime={item.createdAt} title={formatNotificationExact(item.createdAt)}>
                    {formatNotificationTime(item.createdAt)}
                  </time>
                </span>
              </span>
              {unread ? <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-sk-accent" aria-hidden /> : null}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
