"use client"

import { useEffect, useState } from "react"
import { ChatCircle, Megaphone } from "@phosphor-icons/react"
import { useNavigate } from "react-router-dom"
import { AnnouncementRows, ThreadRows, useMessagesTab } from "@/components/messages/lists"
import { Button, EmptyState, LinkButton, Notice, PersonPicker, Screen, ScreenHeader, Section, Sheet, SkeletonRows, Tabs } from "@/components/sk"
import { useAvatarLookup } from "@/lib/account-store"
import { useCoachPermissions, useCoachTeamScope } from "@/lib/coach-teams"
import { getStaffAthletes, type StaffAthlete } from "@/lib/data/competition/staff-roster"
import { messageAthleteHref, newAnnouncementHref } from "@/lib/data/messages/links"
import { getAnnouncements, getMessageThreads } from "@/lib/data/messages/messages-data"
import type { Announcement, ThreadSummary } from "@/lib/data/messages/types"

const TABS = ["direct", "announcements"] as const

export default function CoachMessagesPage() {
  const { coachTeamId, coachTeams, coachTeamsLoading } = useCoachTeamScope()
  // One screen per team: switching team starts clean, never the last team's conversations.
  return <CoachMessages key={coachTeamId ?? "all"} teamId={coachTeamId} teamName={coachTeams.find((team) => team.id === coachTeamId)?.name ?? null} waiting={coachTeamsLoading} />
}

function CoachMessages({ teamId, teamName, waiting }: { teamId: string | null; teamName: string | null; waiting: boolean }) {
  // An assistant coach reads the team's announcements. Direct messages only when the team allows it.
  const permissions = useCoachPermissions(teamId)
  const navigate = useNavigate()
  const avatarOf = useAvatarLookup()
  const [tab, setTab] = useMessagesTab(TABS, "direct")
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [roster, setRoster] = useState<StaffAthlete[] | null>(null)

  useEffect(() => {
    if (waiting) return
    let cancelled = false
    void Promise.all([getMessageThreads({ teamId }), getAnnouncements({ teamId })]).then(([threadResult, announcementResult]) => {
      if (cancelled) return
      if (threadResult.ok) setThreads(threadResult.data)
      else setError(threadResult.error.message)
      if (announcementResult.ok) setAnnouncements(announcementResult.data)
      else setError(announcementResult.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [teamId, waiting])

  // The roster is only needed once the coach wants to start a conversation.
  useEffect(() => {
    if (!picking || roster !== null) return
    let cancelled = false
    void getStaffAthletes({ teamId }).then((result) => {
      if (!cancelled) setRoster(result.ok ? result.data : [])
    })
    return () => {
      cancelled = true
    }
  }, [picking, roster, teamId])

  const unreadThreads = (threads ?? []).filter((thread) => thread.unreadCount > 0).length
  const unreadAnnouncements = (announcements ?? []).filter((item) => item.isRecipient && !item.readAt).length
  const loading = (threads === null || announcements === null) && !error
  const lede = loading
    ? "Getting your messages..."
    : unreadThreads + unreadAnnouncements === 0
      ? `${teamName ? `${teamName}. ` : ""}Announcements to your team and one to one messages with your athletes. Nothing new.`
      : `${teamName ? `${teamName}. ` : ""}${[unreadThreads > 0 ? `${unreadThreads} ${unreadThreads === 1 ? "athlete has" : "athletes have"} written to you` : null, unreadAnnouncements > 0 ? `${unreadAnnouncements} new ${unreadAnnouncements === 1 ? "announcement" : "announcements"}` : null].filter(Boolean).join(", ")}.`

  return (
    <Screen>
      <ScreenHeader
        title="Messages"
        lede={lede}
        actions={
          <>
            {permissions.canMessageAthletes ? (
              <Button onClick={() => setPicking(true)} variant={permissions.canPostAnnouncements ? "secondary" : "primary"}>
                <ChatCircle className="size-[18px]" weight="bold" aria-hidden />
                Message an athlete
              </Button>
            ) : null}
            {permissions.canPostAnnouncements ? (
              <LinkButton to={newAnnouncementHref("coach")} variant="primary">
                <Megaphone className="size-[18px]" weight="bold" aria-hidden />
                New announcement
              </LinkButton>
            ) : null}
          </>
        }
      />

      <Tabs
        label="Messages"
        value={tab}
        onChange={setTab}
        options={[
          { value: "direct", label: "Direct", count: unreadThreads || undefined },
          { value: "announcements", label: "Announcements", count: unreadAnnouncements || undefined },
        ]}
      />

      {error ? <Notice tone="error">Your messages could not be loaded. {error}</Notice> : null}

      {tab === "direct" ? (
        <Section title="Athletes" hint="One to one with an athlete on your team. Club admins can read these conversations.">
          {threads === null && !error ? (
            <SkeletonRows rows={3} leading label="Loading conversations" />
          ) : (threads ?? []).length > 0 ? (
            <ThreadRows role="coach" threads={threads ?? []} />
          ) : (
            <EmptyState
              title="No conversations yet"
              body={
                permissions.canMessageAthletes
                  ? "Pick an athlete to ask how a session went or to sort out a change. They are told in the app and by email."
                  : "On this team assistant coaches do not message athletes directly. The lead coach or a club admin can turn that on."
              }
              action={
                permissions.canMessageAthletes ? (
                  <Button size="sm" onClick={() => setPicking(true)}>
                    Message an athlete
                  </Button>
                ) : undefined
              }
            />
          )}
        </Section>
      ) : (
        <Section title="Announcements" hint="One message to the whole team. Open one to see who has read it.">
          {announcements === null && !error ? (
            <SkeletonRows rows={3} label="Loading announcements" />
          ) : (announcements ?? []).length > 0 ? (
            <AnnouncementRows role="coach" announcements={announcements ?? []} />
          ) : (
            <EmptyState
              title="No announcements yet"
              body={permissions.canPostAnnouncements ? "Tell the whole team something once: training moved, kit to bring, where to meet." : "Announcements the lead coach sends to the team show up here."}
              action={
                permissions.canPostAnnouncements ? (
                  <LinkButton to={newAnnouncementHref("coach")} size="sm">
                    New announcement
                  </LinkButton>
                ) : undefined
              }
            />
          )}
        </Section>
      )}

      <Sheet open={picking} onOpenChange={setPicking} title="Message an athlete" description={teamName ? `Athletes on ${teamName}.` : "Athletes on your teams."}>
        {roster === null ? (
          <SkeletonRows rows={5} leading label="Loading the roster" />
        ) : (
          <PersonPicker
            label="Athlete to message"
            value={null}
            onChange={(athleteId) => {
              setPicking(false)
              navigate(messageAthleteHref(athleteId))
            }}
            empty="No athletes on this roster yet."
            people={roster.map((athlete) => ({
              id: athlete.id,
              name: athlete.name,
              avatarSrc: avatarOf({ athleteId: athlete.id, userId: athlete.userId }),
              detail: athlete.primaryEvent ?? undefined,
              unavailable: athlete.hasLogin ? undefined : "No login",
            }))}
          />
        )}
      </Sheet>
    </Screen>
  )
}
