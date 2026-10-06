"use client"

import { useEffect, useState } from "react"
import { GuardianChildScreen, dayRange } from "@/components/guardian/guardian-frame"
import { DayLabel, EmptyState, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { getGuardianCalendar } from "@/lib/data/guardian/guardian-data"
import type { GuardianCalendarItem, GuardianChild } from "@/lib/data/guardian/types"

const KIND_WORD: Record<GuardianCalendarItem["kind"], string> = { event: "Team event", competition: "Competition", "test-week": "Test week" }

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
          <EmptyState title="Nothing on the calendar" body="Events the coach or the club adds for the team show here." />
        ) : (
          <List aria-label="Coming up">
            {items.map((item) => {
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
        )}
      </Section>
    </Screen>
  )
}

/** The team calendar of the athlete a guardian follows, as a list of what is coming up. Read only. */
export default function GuardianCalendarPage() {
  return <GuardianChildScreen title="Calendar">{(child) => <ChildCalendar child={child} />}</GuardianChildScreen>
}
