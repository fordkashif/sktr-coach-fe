"use client"

import { useEffect, useState } from "react"
import { ChatCircle } from "@phosphor-icons/react"
import { useNavigate } from "react-router-dom"
import { AnnouncementRows, ThreadRows, useMessagesTab } from "@/components/messages/lists"
import { Button, EmptyState, Notice, PersonPicker, Screen, ScreenHeader, Section, Sheet, SkeletonRows, Tabs } from "@/components/sk"
import { useAvatarLookup } from "@/lib/account-store"
import { messageCoachHref } from "@/lib/data/messages/links"
import { getAnnouncements, getMessageableCoaches, getMessageThreads } from "@/lib/data/messages/messages-data"
import type { Announcement, MessageableCoach, ThreadSummary } from "@/lib/data/messages/types"

const TABS = ["announcements", "direct"] as const

export default function AthleteMessagesPage() {
  const navigate = useNavigate()
  const avatarOf = useAvatarLookup()
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null)
  const [coaches, setCoaches] = useState<MessageableCoach[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([getMessageThreads(), getAnnouncements(), getMessageableCoaches()]).then(([threadResult, announcementResult, coachResult]) => {
      if (cancelled) return
      if (threadResult.ok) setThreads(threadResult.data)
      else setError(threadResult.error.message)
      if (announcementResult.ok) setAnnouncements(announcementResult.data)
      else setError(announcementResult.error.message)
      setCoaches(coachResult.ok ? coachResult.data : [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const unreadThreads = (threads ?? []).filter((thread) => thread.unreadCount > 0).length
  const unreadAnnouncements = (announcements ?? []).filter((item) => item.isRecipient && !item.readAt).length
  // Open on whatever is new: a coach's message first, otherwise the announcements.
  const [tab, setTab] = useMessagesTab(TABS, unreadThreads > 0 && unreadAnnouncements === 0 ? "direct" : "announcements")
  const loading = (threads === null || announcements === null) && !error
  const lede = loading
    ? "Getting your messages..."
    : unreadThreads + unreadAnnouncements === 0
      ? "Announcements from your coach and club, and your conversations with your coaches. Nothing new."
      : `${[unreadAnnouncements > 0 ? `${unreadAnnouncements} new ${unreadAnnouncements === 1 ? "announcement" : "announcements"}` : null, unreadThreads > 0 ? `${unreadThreads === 1 ? "a new message" : "new messages"} from your coach` : null].filter(Boolean).join(" and ")}.`.replace(/^./, (letter) => letter.toUpperCase())

  const startMessage = () => {
    if (coaches && coaches.length === 1) navigate(messageCoachHref(coaches[0].userId))
    else setPicking(true)
  }
  const canMessage = coaches !== null && coaches.length > 0

  return (
    <Screen>
      <ScreenHeader
        title="Messages"
        lede={lede}
        actions={
          <Button variant="primary" onClick={startMessage} disabled={!canMessage}>
            <ChatCircle className="size-[18px]" weight="bold" aria-hidden />
            Message a coach
          </Button>
        }
      />

      <Tabs
        label="Messages"
        value={tab}
        onChange={setTab}
        options={[
          { value: "announcements", label: "Announcements", count: unreadAnnouncements || undefined },
          { value: "direct", label: "Coaches", count: unreadThreads || undefined },
        ]}
      />

      {error ? <Notice tone="error">Your messages could not be loaded. {error}</Notice> : null}
      {coaches !== null && coaches.length === 0 ? <Notice tone="info">You are not on a team yet, so there is no coach to message. Join a team from your profile menu.</Notice> : null}

      {tab === "announcements" ? (
        <Section title="Announcements" hint="From your coach and your club. They are one way: to reply, message your coach.">
          {announcements === null && !error ? (
            <SkeletonRows rows={3} label="Loading announcements" />
          ) : (announcements ?? []).length > 0 ? (
            <AnnouncementRows role="athlete" announcements={announcements ?? []} />
          ) : (
            <EmptyState title="No announcements yet" body="When your coach or club has something for the whole team, like a change of time or place, it shows up here." />
          )}
        </Section>
      ) : (
        <Section title="Your coaches" hint="One to one with a coach of your team. Club admins can read these conversations.">
          {threads === null && !error ? (
            <SkeletonRows rows={2} leading label="Loading conversations" />
          ) : (threads ?? []).length > 0 ? (
            <ThreadRows role="athlete" threads={threads ?? []} />
          ) : (
            <EmptyState
              title="No conversations yet"
              body="Ask your coach about a session, or tell them how something felt."
              action={
                canMessage ? (
                  <Button size="sm" onClick={startMessage}>
                    Message a coach
                  </Button>
                ) : undefined
              }
            />
          )}
        </Section>
      )}

      <Sheet open={picking} onOpenChange={setPicking} side="bottom" title="Message a coach" description="The coaches of your team.">
        <PersonPicker
          label="Coach to message"
          value={null}
          onChange={(coachUserId) => {
            setPicking(false)
            navigate(messageCoachHref(coachUserId))
          }}
          people={(coaches ?? []).map((coach) => ({ id: coach.userId, name: coach.name, avatarSrc: avatarOf({ userId: coach.userId }), detail: coach.isLead ? "Lead coach" : "Coach" }))}
        />
      </Sheet>
    </Screen>
  )
}
