import { useCallback } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { exactTime, firstLine, listTime } from "@/components/messages/format"
import { Megaphone } from "@phosphor-icons/react"
import { Avatar, StatusText } from "@/components/sk"
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
    <ul aria-label="Conversations" className="flex flex-col gap-2.5">
      {sortThreads(threads).map((thread, index) => {
        const unread = thread.unreadCount > 0
        const name = role === "coach" ? thread.athleteName : thread.coachName
        const photo = role === "coach" ? avatarOf({ athleteId: thread.athleteId, userId: thread.athleteUserId }) : avatarOf({ userId: thread.coachUserId })
        const preview = thread.lastMessageHidden ? HIDDEN_MESSAGE_STUB : firstLine(thread.lastMessagePreview ?? "")
        return (
          <li key={thread.id} className="sk-tile-item" style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}>
            <Link to={threadHref(role, thread.id)} className={cn("sk-tile group flex items-start gap-3.5 p-4", unread && "sk-chat-unread")} data-thread={thread.id}>
              <span className={cn("shrink-0 rounded-full p-[3px]", unread ? "bg-sk-accent" : "bg-white")}>
                <Avatar name={name} src={photo} size="md" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cn("truncate font-display text-[1.25rem] font-black uppercase leading-none text-sk-ink")}>
                    {name}
                    {unread ? <span className="sr-only"> ({thread.unreadCount} unread)</span> : null}
                  </span>
                  <Time value={thread.lastMessageAt} />
                </span>
                <span className={cn("sk-chat-bubble mt-2 inline-block max-w-full rounded-[16px] rounded-tl-[4px] px-3 py-2 text-[0.9375rem] leading-snug", unread ? "bg-sk-accent font-semibold text-sk-on-accent" : thread.lastMessageFromMe ? "bg-white text-sk-ink-2" : "bg-white text-sk-ink")}>
                  <span className="line-clamp-2">
                    {thread.lastMessageFromMe ? "You: " : ""}
                    {preview}
                  </span>
                </span>
                {unread ? null : !thread.canSend ? <span className="mt-1.5 block text-sm text-sk-mute">Read only</span> : null}
              </span>
              {unread ? (
                <span className="sk-chat-count grid size-7 shrink-0 place-items-center self-center rounded-full bg-sk-accent text-[0.8125rem] font-extrabold text-sk-on-accent" aria-hidden>
                  {thread.unreadCount}
                </span>
              ) : null}
              {unread ? <span className="sr-only">{thread.unreadCount === 1 ? "1 new message" : `${thread.unreadCount} new messages`}</span> : null}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Announcements as rows. Unread ones (for a recipient) carry a blue dot and a bold first line. */
export function AnnouncementRows({ role, announcements }: { role: MessagesRole; announcements: Announcement[] }) {
  return (
    <ul aria-label="Announcements" className="flex flex-col gap-2.5">
      {announcements.map((announcement, index) => {
        const unread = announcement.isRecipient && !announcement.readAt
        const from = announcement.isMine ? "You" : announcement.senderName
        const reach = announcement.canManage && announcement.recipientCount !== null ? announcement.recipientCount : null
        const read = announcement.readCount ?? 0
        return (
          <li key={announcement.id} className="sk-tile-item" style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}>
            <Link to={announcementHref(role, announcement.id)} className="sk-tile flex items-start gap-3.5 p-4">
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", unread ? "bg-sk-accent text-sk-on-accent" : "bg-white text-sk-ink")} aria-hidden>
                <Megaphone className="size-5" weight="bold" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-bold text-sk-mute">
                    {from} to {audiencePhrase(announcement)}
                  </span>
                  <Time value={announcement.createdAt} />
                </span>
                <span className={cn("mt-1 block leading-snug text-sk-ink", unread ? "font-bold" : "font-medium")}>
                  {firstLine(announcement.body, 110)}
                  {unread ? <span className="sr-only"> (unread)</span> : null}
                </span>
                {reach !== null ? (
                  reach === 0 ? (
                    <span className="mt-1.5 block text-sm text-sk-mute">No one to read it yet</span>
                  ) : (
                    <span className="mt-2 flex items-center gap-2.5 text-sm text-sk-mute">
                      <span aria-hidden className="block h-1.5 w-24 overflow-hidden rounded-full bg-white">
                        <span className="sk-anim-grow block h-full rounded-full bg-sk-ink" style={{ width: `${Math.round((read / reach) * 100)}%` }} />
                      </span>
                      {`Read by ${read} of ${reach}`}
                    </span>
                  )
                ) : null}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Every conversation in the club, for a club admin. Reported ones come first and say so. */
export function OversightRows({ threads }: { threads: OversightThread[] }) {
  return (
    <ul aria-label="Conversations in the club" className="flex flex-col gap-2.5">
      {threads.map((thread, index) => (
        <li key={thread.id} className="sk-tile-item" style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}>
          <Link to={threadHref("club-admin", thread.id)} className={cn("sk-tile flex items-start gap-3.5 p-4", thread.openReportCount > 0 && "sk-tile-flag")}>
            <span className="flex shrink-0 -space-x-2">
              <span className="rounded-full bg-white p-[2px]">
                <Avatar name={thread.coachName} size="md" />
              </span>
              <span className="rounded-full bg-white p-[2px]">
                <Avatar name={thread.athleteName} size="md" />
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-display text-[1.25rem] font-black uppercase leading-none text-sk-ink">
                  {thread.coachName} and {thread.athleteName}
                </span>
                <Time value={thread.lastMessageAt} />
              </span>
              <span className="mt-1 block text-sm text-sk-mute">
                {[thread.teamName, thread.messageCount === 1 ? "1 message" : `${thread.messageCount} messages`, thread.hiddenCount > 0 ? `${thread.hiddenCount} hidden` : null, thread.isOpen ? null : "read only"]
                  .filter(Boolean)
                  .join(", ")}
              </span>
              {thread.openReportCount > 0 ? (
                <span className="mt-1 block text-sm">
                  <StatusText tone="coral">{thread.openReportCount === 1 ? "1 reported message to review" : `${thread.openReportCount} reported messages to review`}</StatusText>
                </span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
