"use client"

import { useEffect, useState } from "react"
import { clubToday } from "@/lib/club-day"
import { GuardianChildScreen, dayRange } from "@/components/guardian/guardian-frame"
import { Countdown, DayLabel, EmptyState, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { getGuardianCalendar } from "@/lib/data/guardian/guardian-data"
import type { GuardianCalendarItem, GuardianChild } from "@/lib/data/guardian/types"

const KIND_WORD: Record<GuardianCalendarItem["kind"], string> = { event: "Team event", competition: "Competition", "test-week": "Test week" }

/** Whole days from the club's today to a YYYY-MM-DD day. */
function daysUntil(day: string) {
  return Math.round((new Date(`${day}T12:00:00`).getTime() - new Date(`${clubToday()}T12:00:00`).getTime()) / 86_400_000)
}

function ChildCalendar({ child }: { child: GuardianChild }) {
  const [items, setItems] = useState<GuardianCalendarItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError(null)
    void getGuardianCalendar(child).then((result) => {
      if (cancelled) return
      if (result.ok) setItems(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [child])

  return (
    <Screen width="narrow">
      <ScreenHeader fact={child.teamName ?? undefined} title="Calendar" lede={`What is coming up for ${child.firstName}: team events, competitions and test weeks.`} />
      {error ? <Notice tone="error">{`The calendar could not be loaded. ${error}`}</Notice> : null}
      <Section title="Coming up">
        {!items ? (
          error ? null : (
            <SkeletonRows rows={4} leading />
          )
        ) : items.length === 0 ? (
          <EmptyState title="Nothing on the calendar" />
        ) : (
          <>
          <div className="sk-tile flex items-end justify-between gap-4 p-5" data-calendar-next={items[0].title}>
            <div className="min-w-0">
              <p className="text-sm font-bold text-sk-mute">Next, {KIND_WORD[items[0].kind].toLowerCase()}</p>
              <p className="mt-1 font-display text-[1.75rem] font-black uppercase leading-none text-sk-ink">{items[0].title}</p>
              <p className="mt-1.5 text-sm text-sk-mute">{[dayRange(items[0].startsOn, items[0].endsOn), items[0].startTime, items[0].place].filter(Boolean).join(", ")}</p>
            </div>
            <Countdown days={daysUntil(items[0].startsOn)} className="shrink-0 text-right" />
          </div>
          {items.length > 1 ? (
          <List aria-label="After that" className="mt-3">
            {items.slice(1).map((item) => {
              const date = new Date(`${item.startsOn}T12:00:00`)
              return (
                <ListRow
                  key={`${item.kind}-${item.id}`}
                  leading={<DayLabel weekday={date.toLocaleDateString(undefined, { month: "short" })} number={date.getDate()} />}
                  title={item.title}
                  subtitle={[KIND_WORD[item.kind], item.startsOn !== item.endsOn ? dayRange(item.startsOn, item.endsOn) : item.startTime, item.place].filter(Boolean).join(", ")}
                  data-calendar-kind={item.kind}
                />
              )
            })}
          </List>
          ) : null}
          </>
        )}
      </Section>
    </Screen>
  )
}

/** The team calendar of the athlete a guardian follows, as a list of what is coming up. Read only. */
export default function GuardianCalendarPage() {
  return <GuardianChildScreen title="Calendar">{(child) => <ChildCalendar child={child} />}</GuardianChildScreen>
}
