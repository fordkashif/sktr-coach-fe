"use client"

import { AnnouncementCompose } from "@/components/messages/announcement-compose"
import { EmptyState, LinkButton, Screen, ScreenHeader, Section } from "@/components/sk"
import { useCoachTeamScope } from "@/lib/coach-teams"

export default function CoachNewAnnouncementPage() {
  const { role, coachTeamId, coachTeams, coachTeamsLoading } = useCoachTeamScope()
  const team = coachTeams.find((item) => item.id === coachTeamId) ?? null
  // A club admin posts from their own screen, where they choose who it is for.
  if (role === "club-admin") return <AnnouncementCompose role="club-admin" team={null} />
  if (!team && !coachTeamsLoading) {
    return (
      <Screen width="narrow">
        <ScreenHeader back={{ to: "/coach/messages?tab=announcements", label: "Announcements" }} title="New announcement" />
        <Section title="You are not on a team yet">
          <EmptyState
            title="An announcement goes to a team you coach"
            body="Ask a club admin to add you to a team, then post from here."
            action={
              <LinkButton to="/coach/messages" size="sm">
                Back to messages
              </LinkButton>
            }
          />
        </Section>
      </Screen>
    )
  }
  return <AnnouncementCompose key={team?.id ?? "none"} role="coach" team={team ? { id: team.id, name: team.name } : null} />
}
