import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { CalendarPlus } from "@phosphor-icons/react"
import { CalendarBoard, type CalendarLayout } from "@/components/calendar/calendar-board"
import { CalendarFeedSection } from "@/components/calendar/feed-section"
import { useCalendarData, useCalendarMonth, useClubTimezone } from "@/components/calendar/use-calendar"
import { Button, FilterChips, Screen, ScreenHeader, Segmented } from "@/components/sk"
import { useIsMobile } from "@/hooks/use-mobile"
import { filterClubCalendar, loadClubCalendar } from "@/lib/data/calendar/calendar-data"
import type { ClubEvent } from "@/lib/data/calendar/model"

/** The club calendar: every team together, with a team filter, and where a club admin adds club events. */
export default function ClubAdminCalendarPage() {
  const isMobile = useIsMobile()
  const [searchParams, setSearchParams] = useSearchParams()
  const { month, setMonth, today } = useCalendarMonth()
  const timezone = useClubTimezone()
  const [eventDialog, setEventDialog] = useState<{ event: ClubEvent | null; day: string | null } | null>(null)
  const calendar = useCalendarData(month, "club", (range) => loadClubCalendar({ range }))

  const teams = useMemo(() => calendar.data?.teams ?? [], [calendar.data])
  const teamParam = searchParams.get("team")
  const teamId = teams.some((team) => team.id === teamParam) ? teamParam : null
  const items = useMemo(() => filterClubCalendar(calendar.data?.items ?? [], teamId), [calendar.data, teamId])

  const setParam = (name: string, value: string | null) => {
    const params = new URLSearchParams(searchParams)
    if (value) params.set(name, value)
    else params.delete(name)
    setSearchParams(params, { replace: true })
  }
  const param = searchParams.get("show")
  const layout: CalendarLayout = param === "month" || param === "agenda" ? param : isMobile ? "agenda" : "month"

  return (
    <Screen>
      <ScreenHeader
        back={{ to: "/club-admin/dashboard", label: "Dashboard" }}
        title="Club calendar"
        lede="Test weeks, competitions and club events of every team, with how many sessions each team has planned per day."
        actions={
          <Button variant="primary" onClick={() => setEventDialog({ event: null, day: null })}>
            <CalendarPlus className="size-5" weight="bold" aria-hidden />
            Add event
          </Button>
        }
      />

      {teams.length > 1 ? (
        <FilterChips
          label="Team"
          value={teamId ?? "all"}
          onChange={(next) => setParam("team", next === "all" ? null : next)}
          options={[{ value: "all", label: "All teams" }, ...teams.map((team) => ({ value: team.id, label: team.name }))]}
        />
      ) : null}

      <CalendarBoard
        label="Club calendar"
        items={items}
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
            onChange={(next) => setParam("show", next)}
            options={[
              { value: "agenda", label: "Agenda" },
              { value: "month", label: "Month" },
            ]}
          />
        }
        timezone={timezone}
        eventTools={{ viewer: { role: "club-admin", teamIds: [] }, teams, defaultTeamIds: teamId ? [teamId] : [] }}
        eventDialog={eventDialog}
        onEventDialogChange={setEventDialog}
        emptyBody="Test weeks, competitions, club events and planned sessions show up here."
      />

      <CalendarFeedSection role="club-admin" />
    </Screen>
  )
}
