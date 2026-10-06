import { useMemo, useState, type ReactNode } from "react"
import { CalendarPlus } from "@phosphor-icons/react"
import {
  ActionRow,
  Avatar,
  Button,
  DayLabel,
  EmptyState,
  Fact,
  FactList,
  InlineConfirm,
  LinkButton,
  List,
  ListRow,
  MonthGrid,
  Notice,
  RowMenu,
  Sheet,
  SkeletonRows,
  StatusDot,
  StatusText,
  WeekPager,
  notify,
  notifyError,
  type MonthGridDay,
} from "@/components/sk"
import { useIsMobile } from "@/hooks/use-mobile"
import { deleteClubEvent } from "@/lib/data/calendar/club-events-data"
import type { CalendarTeam } from "@/lib/data/calendar/calendar-data"
import { downloadIcsForItem } from "@/lib/data/calendar/ics-download"
import {
  buildAgenda,
  buildMonthGrid,
  canManageEvent,
  dayAriaLabel,
  isSpan,
  itemSubtitle,
  itemTone,
  longDayLabel,
  monthBounds,
  monthLabel,
  monthOf,
  rangeLabel,
  shiftMonth,
  timeRangeLabel,
  weekdayShort,
  type CalendarItem,
  type CalendarViewer,
  type ClubEvent,
} from "@/lib/data/calendar/model"
import { EventFormDialog } from "./event-form-dialog"

export type CalendarLayout = "agenda" | "month"

/** Who may add and change club events on this calendar. Leave out for athletes, who only read. */
export type CalendarEventTools = {
  viewer: CalendarViewer
  /** The teams an event can be for (a coach: the teams they coach; a club admin: every team). */
  teams: CalendarTeam[]
  /** Ticked when a new event is started from here. */
  defaultTeamIds: string[]
}

const KIND_WORD: Partial<Record<CalendarItem["kind"], string>> = { "test-week": "Test week", competition: "Competition", event: "Club event" }

function canAddToPhone(item: CalendarItem) {
  return Boolean(item.sourceId) && (item.kind === "competition" || item.kind === "test-week" || item.kind === "event")
}

function attendanceHref(item: CalendarItem, day: string) {
  return `/coach/teams/${item.teamId}/attendance?date=${day}`
}

/**
 * The calendar itself: a month pager, then either the agenda (a list, the default on a phone) or the
 * month grid with a sheet for the tapped day. The same board is the team calendar, the athlete's
 * calendar and the club calendar; the screen around it decides what is in `items`.
 */
export function CalendarBoard({
  label,
  items,
  loading,
  error,
  warnings = [],
  month,
  onMonthChange,
  today,
  layout,
  switcher,
  timezone,
  eventTools,
  eventDialog,
  onEventDialogChange,
  emptyBody,
}: {
  /** "Team calendar": names the grid and list for screen readers. */
  label: string
  items: CalendarItem[]
  loading: boolean
  error: string | null
  warnings?: string[]
  month: string
  onMonthChange: (month: string) => void
  today: string
  layout: CalendarLayout
  /** The view switch (a Segmented), shown above the pager. */
  switcher?: ReactNode
  timezone: string
  eventTools?: CalendarEventTools
  /** The add or edit form: null when closed. Kept by the screen so its header button can open it. */
  eventDialog?: { event: ClubEvent | null; day: string | null } | null
  onEventDialogChange?: (next: { event: ClubEvent | null; day: string | null } | null) => void
  emptyBody: string
}) {
  const isMobile = useIsMobile()
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [openEventId, setOpenEventId] = useState<string | null>(null)
  const [openUnavailable, setOpenUnavailable] = useState<{ item: CalendarItem; day: string } | null>(null)
  const [showEarlier, setShowEarlier] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const bounds = monthBounds(month)
  const isCurrentMonth = month === monthOf(today)
  const grid = useMemo(() => buildMonthGrid(month, items, today), [items, month, today])
  // This month opens at today: what is already over is one tap away. Something that began earlier and
  // is still running (a test week, a camp) is listed under today.
  const fromToday = isCurrentMonth && !showEarlier
  const upcoming = useMemo(() => buildAgenda(items, fromToday ? today : bounds.from, bounds.to), [bounds.from, bounds.to, fromToday, items, today])
  const earlierCount = useMemo(() => (fromToday ? items.filter((item) => item.endsOn < today && item.endsOn >= bounds.from).length : 0), [bounds.from, fromToday, items, today])

  const openEvent = openEventId ? (items.find((item) => item.kind === "event" && item.sourceId === openEventId) ?? null) : null
  const dayItems = openDay ? (grid.weeks.flat().find((cell) => cell.date === openDay)?.items ?? []) : []

  const addToPhone = (item: CalendarItem) => {
    if (downloadIcsForItem(item, timezone)) notify("Calendar file downloaded", "Open it to add this to your phone or computer calendar.")
    else notifyError("This cannot be added to a calendar")
  }

  const closeSheets = () => {
    setOpenDay(null)
    setOpenUnavailable(null)
  }

  const row = (item: CalendarItem, day: string, leading: ReactNode) => {
    const subtitle =
      item.kind === "unavailable" ? [isSpan(item) ? rangeLabel(item.startsOn, item.endsOn) : null, "Open to see who"].filter(Boolean).join(", ") : itemSubtitle(item) || KIND_WORD[item.kind] || undefined
    const trailing = item.state ? <StatusText tone={item.state.tone}>{item.state.label}</StatusText> : undefined
    const title = (
      <span className="flex items-center gap-2">
        <StatusDot tone={itemTone(item)} size="sm" />
        <span className="min-w-0">{item.title}</span>
      </span>
    )
    const shared = { leading, title, subtitle, trailing, "data-kind": item.kind }
    const menu = canAddToPhone(item) ? <RowMenu label={`More for ${item.title}`} items={[{ label: "Add to my calendar", onSelect: () => addToPhone(item) }]} /> : undefined
    if (item.kind === "event") return <ActionRow key={item.key} {...shared} onClick={() => setOpenEventId(item.sourceId ?? null)} actions={menu} />
    if (item.kind === "unavailable") return <ActionRow key={item.key} {...shared} onClick={() => setOpenUnavailable({ item, day })} />
    if (item.to) return <ActionRow key={item.key} {...shared} to={item.to} actions={menu} />
    return <ActionRow key={item.key} {...shared} actions={menu} />
  }

  const gridDays: MonthGridDay[][] = grid.weeks.map((week) =>
    week.map((cell) => ({
      date: cell.date,
      dayNumber: cell.dayNumber,
      inMonth: cell.inMonth,
      isToday: cell.isToday,
      label: dayAriaLabel(cell),
      spans: cell.spans.map((span) => (span ? { key: span.item.key, title: span.item.title, isStart: span.isStart, isEnd: span.isEnd, showTitle: span.showTitle } : null)),
      lines: cell.singles.map((item) => ({ key: item.key, title: item.kind === "session-count" ? `${item.title}: ${item.detail}` : item.title, tone: itemTone(item) })),
      dots: cell.dots,
    })),
  )

  const event = openEvent?.event ?? null
  const mayManage = Boolean(event && eventTools && canManageEvent(event, eventTools.viewer))
  const teamNames = new Map((eventTools?.teams ?? []).map((team) => [team.id, team.name]))

  const removeEvent = async () => {
    if (!event || !eventTools) return
    setDeleting(true)
    const result = await deleteClubEvent(event.id, eventTools.viewer)
    setDeleting(false)
    setConfirmDelete(false)
    if (!result.ok) return notifyError("The event was not deleted", result.error.message)
    setOpenEventId(null)
    notify("Event deleted")
  }

  return (
    <>
      {error ? <Notice tone="error">The calendar could not be loaded. {error}</Notice> : null}
      {warnings.map((warning) => (
        <Notice key={warning} tone="warning">
          {warning}
        </Notice>
      ))}

      <section aria-label={label} className="flex flex-col gap-3">
        {switcher ? <div>{switcher}</div> : null}
        <WeekPager
          title={monthLabel(month)}
          subtitle={isCurrentMonth ? "This month" : undefined}
          previousLabel="Previous month"
          nextLabel="Next month"
          onPrevious={() => onMonthChange(shiftMonth(month, -1))}
          onNext={() => onMonthChange(shiftMonth(month, 1))}
          action={
            !isCurrentMonth ? (
              <Button variant="quiet" size="sm" onClick={() => onMonthChange(monthOf(today))}>
                Today
              </Button>
            ) : null
          }
        />

        {loading ? (
          <SkeletonRows rows={6} label="Loading the calendar" />
        ) : layout === "month" ? (
          <>
            <MonthGrid weeks={gridDays} selected={openDay} onSelect={setOpenDay} label={`${label}, ${monthLabel(month)}`} />
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-sk-mute">
              <span className="inline-flex items-center gap-1.5">
                <StatusDot tone="neutral" size="sm" /> Session
              </span>
              <span className="inline-flex items-center gap-1.5">
                <StatusDot tone="blue" size="sm" /> Test week, competition or event
              </span>
              {items.some((item) => item.kind === "unavailable") ? (
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot tone="amber" size="sm" /> Athletes unavailable
                </span>
              ) : null}
              {items.some((item) => item.state?.tone === "green") ? (
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot tone="green" size="sm" /> Done
                </span>
              ) : null}
              {items.some((item) => item.state?.tone === "coral") ? (
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot tone="coral" size="sm" /> Missed
                </span>
              ) : null}
            </p>
          </>
        ) : (
          <>
            {earlierCount > 0 ? (
              <div className="-ml-2.5">
                <Button variant="quiet" size="sm" onClick={() => setShowEarlier(true)}>
                  Show earlier days in {monthLabel(month).split(" ")[0]}
                </Button>
              </div>
            ) : null}
            {upcoming.length > 0 ? (
              <List ordered aria-label={`${label}, ${monthLabel(month)}`}>
                {upcoming.flatMap((day) =>
                  day.items.map((item, index) =>
                    row(
                      item,
                      day.date,
                      index === 0 ? <DayLabel weekday={weekdayShort(day.date)} number={Number(day.date.slice(8))} today={day.date === today} /> : <span className="w-9" aria-hidden />,
                    ),
                  ),
                )}
              </List>
            ) : (
              <EmptyState title={isCurrentMonth && earlierCount > 0 ? "Nothing else this month" : `Nothing in ${monthLabel(month)}`} body={emptyBody} />
            )}
          </>
        )}
      </section>

      {/* The tapped day of the month grid. */}
      <Sheet
        open={openDay !== null && openUnavailable === null && openEventId === null}
        onOpenChange={(open) => (open ? null : setOpenDay(null))}
        side={isMobile ? "bottom" : "right"}
        title={openDay ? longDayLabel(openDay) : "Day"}
        description={openDay === today ? "Today" : undefined}
        footer={
          eventTools && openDay ? (
            <Button
              onClick={() => {
                const day = openDay
                setOpenDay(null)
                onEventDialogChange?.({ event: null, day })
              }}
            >
              <CalendarPlus className="size-5" weight="bold" aria-hidden />
              Add event on this day
            </Button>
          ) : undefined
        }
      >
        {dayItems.length > 0 ? <List aria-label="On this day">{dayItems.map((item) => row(item, openDay ?? item.startsOn, null))}</List> : <EmptyState title="Nothing on this day" body={emptyBody} />}
      </Sheet>

      {/* Who is unavailable. Names only: the reason stays on the athlete's own screen. */}
      <Sheet
        open={openUnavailable !== null}
        onOpenChange={(open) => (open ? null : setOpenUnavailable(null))}
        side={isMobile ? "bottom" : "right"}
        title="Unavailable"
        description={openUnavailable ? (isSpan(openUnavailable.item) ? `${rangeLabel(openUnavailable.item.startsOn, openUnavailable.item.endsOn)}. Injured, sick or away.` : `${longDayLabel(openUnavailable.item.startsOn)}. Injured, sick or away.`) : undefined}
        footer={
          openUnavailable?.item.teamId ? (
            <LinkButton to={attendanceHref(openUnavailable.item, openUnavailable.day)} onClick={closeSheets}>
              Open attendance for {rangeLabel(openUnavailable.day, openUnavailable.day)}
            </LinkButton>
          ) : undefined
        }
      >
        <List aria-label="Athletes unavailable">{(openUnavailable?.item.names ?? []).map((name) => <ListRow key={name} leading={<Avatar name={name} size="sm" />} title={name} />)}</List>
      </Sheet>

      {/* One club event. */}
      <Sheet
        open={openEvent !== null}
        onOpenChange={(open) => {
          if (open) return
          setOpenEventId(null)
          setConfirmDelete(false)
        }}
        side={isMobile ? "bottom" : "right"}
        title={openEvent?.title ?? "Club event"}
        description="Club event"
        footer={
          openEvent ? (
            <>
              {mayManage && event ? (
                <>
                  <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={confirmDelete}>
                    Delete
                  </Button>
                  <Button
                    onClick={() => {
                      setOpenEventId(null)
                      onEventDialogChange?.({ event, day: null })
                    }}
                  >
                    Edit
                  </Button>
                </>
              ) : null}
              <Button variant="primary" onClick={() => addToPhone(openEvent)}>
                <CalendarPlus className="size-5" weight="bold" aria-hidden />
                Add to my calendar
              </Button>
            </>
          ) : undefined
        }
      >
        {openEvent && event ? (
          <>
            <FactList aria-label="Event details">
              <Fact label="When">{[isSpan(openEvent) ? rangeLabel(event.startsOn, event.endsOn) : longDayLabel(event.startsOn), timeRangeLabel(event.startTime, event.endTime) || "All day"].join(", ")}</Fact>
              <Fact label="Where" empty="No place given">
                {event.place}
              </Fact>
              <Fact label="For">
                {event.audience === "club"
                  ? "The whole club"
                  : event.teamIds
                      .map((id) => teamNames.get(id))
                      .filter(Boolean)
                      .join(", ") || openEvent.detail || "Your team"}
              </Fact>
              {event.note ? (
                <Fact label="Note" stack>
                  {event.note}
                </Fact>
              ) : null}
            </FactList>
            {confirmDelete ? (
              <InlineConfirm className="mt-4" question="Delete this event? It disappears from every calendar it is on." confirmLabel="Delete event" onConfirm={() => void removeEvent()} onCancel={() => setConfirmDelete(false)} busy={deleting} />
            ) : null}
          </>
        ) : null}
      </Sheet>

      {eventTools && eventDialog ? (
        <EventFormDialog
          key={eventDialog.event?.id ?? `new-${eventDialog.day ?? ""}`}
          event={eventDialog.event}
          day={eventDialog.day ?? (isCurrentMonth ? today : bounds.from)}
          tools={eventTools}
          onClose={() => onEventDialogChange?.(null)}
        />
      ) : null}
    </>
  )
}
