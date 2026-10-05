"use client"

import { useEffect, useState } from "react"
import { firstLine } from "@/components/messages/format"
import { LinkButton, Notice } from "@/components/sk"
import { announcementHref, messagesHomeHref } from "@/lib/data/messages/links"
import { getAnnouncements } from "@/lib/data/messages/messages-data"
import type { Announcement, MessagesRole } from "@/lib/data/messages/types"

/**
 * One line on a home screen while there is an announcement the person has not read ("training
 * moved to 5pm"). Renders nothing otherwise, and nothing while it loads, so the screen never grows
 * a line it has nothing to put in. Reading the announcement clears it.
 */
export function UnreadAnnouncementsNotice({ role }: { role: MessagesRole }) {
  const [unread, setUnread] = useState<Announcement[]>([])

  useEffect(() => {
    let cancelled = false
    void getAnnouncements().then((result) => {
      if (!cancelled && result.ok) setUnread(result.data.filter((item) => item.isRecipient && !item.readAt))
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (unread.length === 0) return null
  const latest = unread[0]
  return (
    <Notice
      action={
        <LinkButton size="sm" variant="quiet" to={unread.length === 1 ? announcementHref(role, latest.id) : messagesHomeHref(role, "announcements")}>
          {unread.length === 1 ? "Read" : "Read all"}
        </LinkButton>
      }
    >
      {unread.length === 1 ? `${latest.senderName}: ${firstLine(latest.body, 120)}` : `${unread.length} new announcements. Latest from ${latest.senderName}: ${firstLine(latest.body, 80)}`}
    </Notice>
  )
}
