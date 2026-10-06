import { useState } from "react"
import { Navigate, useSearchParams } from "react-router-dom"
import { CalendarPlus } from "@phosphor-icons/react"
import { CalendarBoard, type CalendarLayout } from "@/components/calendar/calendar-board"
import { CalendarFeedSection } from "@/components/calendar/feed-section"
import { useCalendarData, useCalendarMonth, useClubTimezone } from "@/components/calendar/use-calendar"
import { PlansNav } from "@/components/coach/training-plan/plans-nav"
import { Button, EmptyState, Screen, ScreenHeader, ScreenSkeleton, Section, Segmented } from "@/components/sk"
import { useIsMobile } from "@/hooks/use-mobile"
import { useCoachTeamScope } from "@/lib/coach-teams"
import { loadTeamCalendar } from "@/lib/data/calendar/calendar-data"
import type { ClubEvent } from "@/lib/data/calendar/model"

/** The coach's team calendar: everything dated for the team that is selected in the top bar. */
export default function CoachTeamCalendarPage() {
  const { role, coachTeamId, coachTeams, coachTeamsLoading } = useCoachTeamScope()
  const isMobile = useIsMobile()
  const [searchParams, setSearchParams] = useSearchParams()
  const { month, setMonth, today } = useCalendarMonth()
  const timezone = useClubTimezone()
  const [eventDialog, setEventDialog] = useState<{ event: ClubEvent | null; day: string | null } | null>(null)

  const team = coachTeams.find((candidate) => candidate.id === coachTeamId) ?? null
  const calendar = useCalendarData(month, team?.id ?? "", (range) =>
    team ? loadTeamCalendar({ team: { id: team.id, name: team.name }, range }) : Promise.resolve({ ok: true as const, data: { items: [], events: [], teams: [], warnings: [] } }),
  )

  // A club admin has no single team: their calendar is the club's.
  if (role === "club-admin") return <Navigate to="/club-admin/calendar" replace />
  if (coachTeamsLoading) return <ScreenSkeleton />

  const param = searchParams.get("show")
  const layout: CalendarLayout = param === "month" || param === "agenda" ? param : isMobile ? "agenda" : "month"
  const setLayout = (next: CalendarLayout) => {
    const params = new URLSearchParams(searchParams)
    params.set("show", next)
    setSearchParams(params, { replace: true })
  }

  if (!team) {
    return (
      <Screen>
        <ScreenHeader title="Calendar" />
        <PlansNav />
        <Section aria-label="Calendar">
          <EmptyState title="No team yet" body="When a club admin assigns you to a team, its sessions, test weeks, competitions and club events show up here." />
        </Section>
      </Screen>
    )
  }

  return (
    <Screen>
      <ScreenHeader
        title="Calendar"
        lede={`${team.name}: sessions, test weeks, competitions, club events and who is unavailable.`}
        actions={
          <Button onClick={() => setEventDialog({ event: null, day: null })}>
            <CalendarPlus className="size-5" weight="bold" aria-hidden />
            Add event
          </Button>
        }
      />
      <PlansNav />

      <CalendarBoard
        label={`${team.name} calendar`}
        items={calendar.data?.items ?? []}
        loading={calendar.loading}
        error={calendar.error}
        warnings={calendar.data?.warnings}
        month={month}
        onMonthChange={setMonth}
        today={today}
        layout={layout}
        switcher={
          <Segmented
            label="Calendar view"
            value={layout}
            onChange={setLayout}
            options={[
              { value: "agenda", label: "Agenda" },
              { value: "month", label: "Month" },
            ]}
          />
        }
        timezone={timezone}
        eventTools={{ viewer: { role: "coach", teamIds: coachTeams.map((candidate) => candidate.id) }, teams: coachTeams.map((candidate) => ({ id: candidate.id, name: candidate.name })), defaultTeamIds: [team.id] }}
        eventDialog={eventDialog}
        onEventDialogChange={setEventDialog}
        emptyBody="Planned sessions, test weeks, competitions and club events for this team show up here."
      />

      <CalendarFeedSection role="coach" />
    </Screen>
  )
}
