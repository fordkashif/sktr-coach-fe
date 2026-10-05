import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { exactTime, firstLine, listTime } from "@/components/messages/format"
import { Avatar, List, ListRow, StatusDot, StatusText } from "@/components/sk"
import { useAvatarLookup } from "@/lib/account-store"
import { announcementHref, threadHref } from "@/lib/data/messages/links"
import { audiencePhrase, HIDDEN_MESSAGE_STUB, type Announcement, type MessagesRole, type OversightThread, type ThreadSummary } from "@/lib/data/messages/types"
import { cn } from "@/lib/utils"

/** The lists on the three Messages screens. Rows only: each screen owns its header, tabs and sections. */

/** Which tab of a Messages screen is showing, kept in the address (?tab=) so links and Back work. */
export function useMessagesTab<T extends string>(tabs: readonly T[], fallback: T): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get("tab")
  const tab = tabs.includes(raw as T) ? (raw as T) : fallback
  const setTab = useCallback(
    (next: T) => {
      setParams({ tab: next }, { replace: true })
    },
    [setParams],
  )
  return [tab, setTab]
}

function Time({ value }: { value: string }) {
  return (
    <time dateTime={value} title={exactTime(value)} className="font-normal text-sk-mute">
      {listTime(value)}
    </time>
  )
}

/** Unread conversations first, then the most recent. */
export function sortThreads(threads: ThreadSummary[]): ThreadSummary[] {
  return [...threads].sort((a, b) => Number(b.unreadCount > 0) - Number(a.unreadCount > 0) || b.lastMessageAt.localeCompare(a.lastMessageAt))
}

/** Conversations as rows: the other person, the last message, when, and what is unread. */
export function ThreadRows({ role, threads }: { role: "coach" | "athlete"; threads: ThreadSummary[] }) {
  const avatarOf = useAvatarLookup()
  return (
    <List aria-label="Conversations">
      {sortThreads(threads).map((thread) => {
        const unread = thread.unreadCount > 0
        const name = role === "coach" ? thread.athleteName : thread.coachName
        const photo = role === "coach" ? avatarOf({ athleteId: thread.athleteId, userId: thread.athleteUserId }) : avatarOf({ userId: thread.coachUserId })
        const preview = thread.lastMessageHidden ? HIDDEN_MESSAGE_STUB : firstLine(thread.lastMessagePreview ?? "")
        return (
          <ListRow key={thread.id} to={threadHref(role, thread.id)} className="items-start" leading={<Avatar name={name} src={photo} size="md" />} trailing={<Time value={thread.lastMessageAt} />}>
            <span className={cn("sk-list-title", unread && "font-bold")}>
              {name}
              {unread ? <span className="sr-only"> ({thread.unreadCount} unread)</span> : null}
            </span>
            <span className={cn("sk-list-sub", unread && "font-semibold text-sk-ink")}>
              {thread.lastMessageFromMe ? "You: " : ""}
              {preview}
            </span>
            {unread ? (
              <span className="mt-1 block text-sm">
                <StatusText tone="blue">{thread.unreadCount === 1 ? "1 new message" : `${thread.unreadCount} new messages`}</StatusText>
              </span>
            ) : !thread.canSend ? (
              <span className="sk-list-sub">Read only</span>
            ) : null}
          </ListRow>
        )
      })}
    </List>
  )
}

/** Announcements as rows. Unread ones (for a recipient) carry a blue dot and a bold first line. */
export function AnnouncementRows({ role, announcements }: { role: MessagesRole; announcements: Announcement[] }) {
  return (
    <List aria-label="Announcements">
      {announcements.map((announcement) => {
        const unread = announcement.isRecipient && !announcement.readAt
        const from = announcement.isMine ? "You" : announcement.senderName
        return (
          <ListRow
            key={announcement.id}
            to={announcementHref(role, announcement.id)}
            className="items-start"
            // The dot keeps its space when read, so the lines start at the same place down the list.
            leading={<StatusDot tone="blue" className={cn("mt-[7px]", !unread && "invisible")} />}
            trailing={<Time value={announcement.createdAt} />}
          >
            <span className={cn("sk-list-title", unread && "font-bold")}>
              {firstLine(announcement.body, 110)}
              {unread ? <span className="sr-only"> (unread)</span> : null}
            </span>
            <span className="sk-list-sub">
              {from} to {audiencePhrase(announcement)}
            </span>
            {announcement.canManage && announcement.recipientCount !== null ? (
              <span className="sk-list-sub">
                {announcement.recipientCount === 0 ? "No one to read it yet" : `Read by ${announcement.readCount ?? 0} of ${announcement.recipientCount}`}
              </span>
            ) : null}
          </ListRow>
        )
      })}
    </List>
  )
}

/** Every conversation in the club, for a club admin. Reported ones come first and say so. */
export function OversightRows({ threads }: { threads: OversightThread[] }) {
  return (
    <List aria-label="Conversations in the club">
      {threads.map((thread) => (
        <ListRow
          key={thread.id}
          to={threadHref("club-admin", thread.id)}
          className="items-start"
          leading={<Avatar name={thread.athleteName} size="md" />}
          trailing={<Time value={thread.lastMessageAt} />}
        >
          <span className="sk-list-title">
            {thread.coachName} and {thread.athleteName}
          </span>
          <span className="sk-list-sub">
            {[thread.teamName, thread.messageCount === 1 ? "1 message" : `${thread.messageCount} messages`, thread.hiddenCount > 0 ? `${thread.hiddenCount} hidden` : null, thread.isOpen ? null : "read only"]
              .filter(Boolean)
              .join(", ")}
          </span>
          {thread.openReportCount > 0 ? (
            <span className="mt-1 block text-sm">
              <StatusText tone="coral">{thread.openReportCount === 1 ? "1 reported message to review" : `${thread.openReportCount} reported messages to review`}</StatusText>
            </span>
          ) : null}
        </ListRow>
      ))}
    </List>
  )
}
