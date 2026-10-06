import type { ReactNode } from "react"
import { CalendarBoard, type CalendarLayout } from "@/components/calendar/calendar-board"
import { CalendarFeedSection } from "@/components/calendar/feed-section"
import { useCalendarData, useCalendarMonth, useClubTimezone } from "@/components/calendar/use-calendar"
import { Screen, ScreenHeader, Segmented } from "@/components/sk"
import { loadAthleteCalendar } from "@/lib/data/calendar/calendar-data"

export type AthletePlanView = "week" | CalendarLayout

/** The switch on the athlete's Plan screen: the week list of the plan, or the calendar as a list or a month. */
export function AthletePlanViewSwitch({ value, onChange }: { value: AthletePlanView; onChange: (next: AthletePlanView) => void }) {
  return (
    <Segmented
      label="Plan view"
      value={value}
      onChange={onChange}
      options={[
        { value: "week", label: "Week" },
        { value: "agenda", label: "Agenda" },
        { value: "month", label: "Month" },
      ]}
    />
  )
}

/**
 * The athlete's own calendar, shown in place of the week list on the Plan screen: their sessions
 * with what happened to each, test weeks, the competitions they are in and club events.
 */
export function AthleteCalendarScreen({ layout, switcher, notice }: { layout: CalendarLayout; switcher: ReactNode; notice?: ReactNode }) {
  const { month, setMonth, today } = useCalendarMonth()
  const timezone = useClubTimezone()
  const calendar = useCalendarData(month, "me", (range) => loadAthleteCalendar({ range, today }))
  return (
    <Screen>
      <ScreenHeader title="Your calendar" lede="Your sessions, test weeks, competitions and club events." />
      {notice}
      <CalendarBoard
        label="Your calendar"
        items={calendar.data?.items ?? []}
        loading={calendar.loading}
        error={calendar.error}
        warnings={calendar.data?.warnings}
        month={month}
        onMonthChange={setMonth}
        today={today}
        layout={layout}
        switcher={switcher}
        timezone={timezone}
        emptyBody="Sessions from your plan, test weeks, the competitions you are entered in and club events show up here."
      />
      <CalendarFeedSection role="athlete" />
    </Screen>
  )
}
