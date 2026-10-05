"use client"

import { useEffect, useState } from "react"
import { Megaphone } from "@phosphor-icons/react"
import { AnnouncementRows, OversightRows, useMessagesTab } from "@/components/messages/lists"
import { EmptyState, LinkButton, Notice, Screen, ScreenHeader, Section, SkeletonRows, Tabs } from "@/components/sk"
import { newAnnouncementHref } from "@/lib/data/messages/links"
import { getAnnouncements, getGuardianCcEnabled, getOversightThreads } from "@/lib/data/messages/messages-data"
import { SAFEGUARDING_LINE, type Announcement, type OversightThread } from "@/lib/data/messages/types"

const TABS = ["announcements", "oversight"] as const

export default function ClubAdminMessagesPage() {
  const [tab, setTab] = useMessagesTab(TABS, "announcements")
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null)
  const [threads, setThreads] = useState<OversightThread[] | null>(null)
  const [guardianCc, setGuardianCc] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([getAnnouncements(), getOversightThreads(), getGuardianCcEnabled()]).then(([announcementResult, threadResult, guardianResult]) => {
      if (cancelled) return
      if (announcementResult.ok) setAnnouncements(announcementResult.data)
      else setError(announcementResult.error.message)
      if (threadResult.ok) setThreads(threadResult.data)
      else setError(threadResult.error.message)
      setGuardianCc(guardianResult.ok ? guardianResult.data : false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const reported = (threads ?? []).reduce((sum, thread) => sum + thread.openReportCount, 0)
  const unreadAnnouncements = (announcements ?? []).filter((item) => item.isRecipient && !item.readAt).length
  const loading = (threads === null || announcements === null) && !error
  const lede = loading
    ? "Getting the club's messages..."
    : reported > 0
      ? `${reported} reported ${reported === 1 ? "message needs" : "messages need"} a look in message oversight.`
      : "Announcements to the club, and read only oversight of every conversation between a coach and an athlete."

  return (
    <Screen>
      <ScreenHeader
        title="Messages"
        lede={lede}
        actions={
          <LinkButton to={newAnnouncementHref("club-admin")} variant="primary">
            <Megaphone className="size-[18px]" weight="bold" aria-hidden />
            New announcement
          </LinkButton>
        }
      />

      <Tabs
        label="Messages"
        value={tab}
        onChange={setTab}
        options={[
          { value: "announcements", label: "Announcements", count: unreadAnnouncements || undefined },
          { value: "oversight", label: "Message oversight", count: reported || undefined },
        ]}
      />

      {error ? <Notice tone="error">The club's messages could not be loaded. {error}</Notice> : null}

      {tab === "announcements" ? (
        <Section title="Announcements" hint="To the whole club, to all coaches or to one team. Open one to see who has read it.">
          {announcements === null && !error ? (
            <SkeletonRows rows={3} label="Loading announcements" />
          ) : (announcements ?? []).length > 0 ? (
            <AnnouncementRows role="club-admin" announcements={announcements ?? []} />
          ) : (
            <EmptyState
              title="No announcements yet"
              body="Tell the whole club something once: an AGM, a kit day, a closed track."
              action={
                <LinkButton to={newAnnouncementHref("club-admin")} size="sm">
                  New announcement
                </LinkButton>
              }
            />
          )}
        </Section>
      ) : (
        <Section
          title="Message oversight"
          hint={`${SAFEGUARDING_LINE} Both people are told so at the top of every conversation. You read; you never write in them.`}
          meta={threads && threads.length > 0 ? `${threads.length} ${threads.length === 1 ? "conversation" : "conversations"}` : undefined}
        >
          {threads === null && !error ? (
            <SkeletonRows rows={4} leading label="Loading conversations" />
          ) : (threads ?? []).length > 0 ? (
            <OversightRows threads={threads ?? []} />
          ) : (
            <EmptyState title="No conversations yet" body="When a coach and an athlete message each other, the conversation is listed here. Reported messages come first." />
          )}
          <p className="mt-4 text-sm text-sk-mute" data-guardian-cc>
            Guardian copies are {guardianCc ? "on" : "off"} for this club: guardians are not sent a copy of messages to athletes under 18.
          </p>
        </Section>
      )}
    </Screen>
  )
}
