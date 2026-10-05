import { ChatCircle } from "@phosphor-icons/react"
import { Link, useLocation } from "react-router-dom"
import { useMessageUnread, useMessageUnreadRefresh } from "@/lib/data/messages/unread-store"
import { useNotificationCenter } from "@/lib/notifications/store"
import { useRole } from "@/lib/role-context"
import { cn } from "@/lib/utils"

/**
 * The Messages entry points in the shell: the icon button beside the bell, the count on a phone
 * tab, and the one component that keeps the unread count fresh. See DESIGN.md, "Navigation".
 */

function unreadLabel(total: number) {
  return total === 0 ? "Messages" : total === 1 ? "Messages, 1 unread" : `Messages, ${total} unread`
}

/** The count bubble, the same one the bell uses. Renders nothing at zero. */
export function MessagesCount({ className }: { className?: string }) {
  const { total } = useMessageUnread()
  if (total === 0) return null
  return (
    <span
      aria-hidden
      data-testid="messages-count"
      className={cn(
        "flex h-5 min-w-5 items-center justify-center rounded-full bg-sk-coral-ink px-1 text-[11px] font-bold leading-none text-white tabular-nums ring-2 ring-white",
        className,
      )}
    >
      {total > 99 ? "99+" : total}
    </span>
  )
}

/** Messages as an icon button with the unread count, next to the notifications bell. */
export function MessagesButton({ to, active }: { to: string; active: boolean }) {
  const { total } = useMessageUnread()
  return (
    <Link to={to} className={cn("sk-icon-btn", active && "border-sk-blue text-sk-blue-ink")} aria-label={unreadLabel(total)} aria-current={active ? "page" : undefined} data-shell-messages>
      <ChatCircle className="size-5" weight={active ? "fill" : "bold"} aria-hidden />
      <MessagesCount className="absolute -right-1.5 -top-1.5" />
    </Link>
  )
}

/** What a screen reader hears for a Messages tab or row: "Messages, 2 unread". */
export function useMessagesLabel() {
  return unreadLabel(useMessageUnread().total)
}

/** Mounted once by the shell for the roles that have messages. Draws nothing. */
export function MessageUnreadKeeper() {
  const { role, userEmail } = useRole()
  const { pathname } = useLocation()
  const { revision } = useNotificationCenter()
  const enabled = role === "athlete" || role === "coach" || role === "club-admin"
  useMessageUnreadRefresh(userEmail ? `${role}|${userEmail.toLowerCase()}` : role, enabled, `${pathname}|${revision}`)
  return null
}
