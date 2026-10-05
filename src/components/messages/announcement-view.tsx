"use client"

import { useEffect, useState } from "react"
import { useLocation } from "react-router-dom"
import { exactTime, listTime } from "@/components/messages/format"
import { Avatar, EmptyState, LinkButton, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows, Stat, StatStrip, StatusText } from "@/components/sk"
import { useAvatarLookup } from "@/lib/account-store"
import { messagesHomeHref } from "@/lib/data/messages/links"
import { getAnnouncement, getAnnouncementRecipients, markAnnouncementRead } from "@/lib/data/messages/messages-data"
import { audiencePhrase, type Announcement, type AnnouncementRecipient, type MessagesRole } from "@/lib/data/messages/types"

const ROLE_WORD: Record<string, string> = { athlete: "Athlete", coach: "Coach", "club-admin": "Club admin" }

/**
 * One announcement. A recipient reads it here (opening it marks it read). Its sender, the team's
 * coaches and club admins also see how many have read it and who has not.
 */
export function AnnouncementView({ role, announcementId }: { role: MessagesRole; announcementId: string }) {
  const avatarOf = useAvatarLookup()
  const [announcement, setAnnouncement] = useState<Announcement | null | undefined>(undefined)
  const [recipients, setRecipients] = useState<AnnouncementRecipient[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const justPosted = Boolean((useLocation().state as { posted?: boolean } | null)?.posted)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await getAnnouncement(announcementId)
      if (cancelled) return
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setAnnouncement(result.data)
      if (!result.data) return
      if (result.data.isRecipient && !result.data.readAt) void markAnnouncementRead(announcementId)
      if (result.data.canManage) {
        const list = await getAnnouncementRecipients(announcementId)
        if (!cancelled) setRecipients(list.ok ? list.data : [])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [announcementId])

  const backTo = messagesHomeHref(role, "announcements")

  if (announcement === undefined && !error) {
    return (
      <Screen width="narrow">
        <ScreenHeader back={{ to: backTo, label: "Announcements" }} title="Announcement" />
        <Section aria-label="Loading">
          <SkeletonRows rows={3} label="Loading the announcement" />
        </Section>
      </Screen>
    )
  }

  if (!announcement) {
    return (
      <Screen width="narrow">
        <ScreenHeader back={{ to: backTo, label: "Announcements" }} title="Announcement" />
        {error ? (
          <Notice tone="error">This announcement could not be loaded. {error}</Notice>
        ) : (
          <Section title="This announcement is not available">
            <EmptyState
              title="It was not sent to you"
              body="Your announcements list shows everything you have received."
              action={
                <LinkButton to={backTo} size="sm">
                  Back to announcements
                </LinkButton>
              }
            />
          </Section>
        )}
      </Screen>
    )
  }

  const unreadList = (recipients ?? []).filter((recipient) => !recipient.readAt)
  const readList = (recipients ?? []).filter((recipient) => recipient.readAt)
  const from = announcement.isMine ? "you" : announcement.senderName
  const personRow = (recipient: AnnouncementRecipient) => (
    <ListRow
      key={recipient.userId}
      leading={<Avatar name={recipient.name} src={avatarOf({ athleteId: recipient.athleteId, userId: recipient.userId })} size="sm" />}
      title={recipient.name}
      subtitle={recipient.role && recipient.role !== "athlete" ? ROLE_WORD[recipient.role] : undefined}
      trailing={
        recipient.readAt ? (
          <time dateTime={recipient.readAt} title={exactTime(recipient.readAt)} className="font-normal text-sk-mute">
            {listTime(recipient.readAt)}
          </time>
        ) : undefined
      }
    />
  )

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: backTo, label: "Announcements" }}
        fact={`To ${audiencePhrase(announcement)}`}
        title="Announcement"
        lede={
          <>
            From {from},{" "}
            <time dateTime={announcement.createdAt} title={exactTime(announcement.createdAt)}>
              {listTime(announcement.createdAt).replace(/^[A-Z]/, (letter) => letter.toLowerCase())}
            </time>
          </>
        }
      />

      {justPosted ? <Notice tone="success">Posted. Everyone it went to has been told in the app and by email.</Notice> : null}

      <Section aria-label="What it says">
        <p className="whitespace-pre-wrap break-words text-[1.0625rem] leading-relaxed text-sk-ink [overflow-wrap:anywhere]" data-announcement-body>
          {announcement.body}
        </p>
        {!announcement.canManage ? <p className="mt-3 text-sm text-sk-mute">Announcements are one way. To reply, message your coach.</p> : null}
      </Section>

      {announcement.canManage ? (
        <>
          <StatStrip aria-label="Who has read it">
            <Stat label="Read" value={announcement.readCount ?? 0} of={announcement.recipientCount ?? 0} />
            <Stat label="Not read yet" value={(announcement.recipientCount ?? 0) - (announcement.readCount ?? 0)} />
          </StatStrip>

          <Section title="Not read yet" meta={recipients ? `${unreadList.length}` : undefined}>
            {recipients === null ? (
              <SkeletonRows rows={3} leading label="Loading who has read it" />
            ) : unreadList.length > 0 ? (
              <List aria-label="People who have not read it">{unreadList.map(personRow)}</List>
            ) : (
              <p className="py-2">
                <StatusText tone="green">{(announcement.recipientCount ?? 0) === 0 ? "It went to no one: nobody on this team has a login yet" : "Everyone has read it"}</StatusText>
              </p>
            )}
          </Section>

          {readList.length > 0 ? (
            <Section title="Read" meta={`${readList.length}`}>
              <List aria-label="People who have read it">{readList.map(personRow)}</List>
            </Section>
          ) : null}
        </>
      ) : null}
    </Screen>
  )
}
