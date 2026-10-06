"use client"

import type { ReactNode } from "react"
import { EmptyState, Notice, Screen, ScreenHeader, ScreenSkeleton, Section } from "@/components/sk"
import type { GuardianChild } from "@/lib/data/guardian/types"
import { useGuardianChildren } from "@/lib/guardian/children-store"

/** "Sat 14 Jun" from "2026-06-14". */
export function shortDay(day: string) {
  const date = new Date(`${day.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
}

/** "14 Jun" or "14 to 16 Jun". */
export function dayRange(from: string, to: string) {
  const start = new Date(`${from.slice(0, 10)}T12:00:00`)
  const end = new Date(`${to.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(start.getTime())) return from
  const month = (date: Date) => date.toLocaleDateString(undefined, { month: "short" })
  if (Number.isNaN(end.getTime()) || from.slice(0, 10) === to.slice(0, 10)) return `${start.getDate()} ${month(start)}`
  if (start.getMonth() === end.getMonth()) return `${start.getDate()} to ${end.getDate()} ${month(end)}`
  return `${start.getDate()} ${month(start)} to ${end.getDate()} ${month(end)}`
}

/**
 * The frame every guardian screen about one athlete shares: it waits for the list of athletes the
 * guardian follows, says so plainly when there are none (access is by invite from the club), and
 * otherwise hands the selected athlete to the screen.
 */
export function GuardianChildScreen({
  title,
  width,
  children,
}: {
  /** The screen's title while it waits, and when there is nobody to show. */
  title: string
  width?: "default" | "narrow"
  children: (child: GuardianChild) => ReactNode
}) {
  const { selected, loading, error, children: list } = useGuardianChildren()
  if (loading) return <ScreenSkeleton />
  if (!selected) {
    return (
      <Screen width={width ?? "narrow"}>
        <ScreenHeader title={title} />
        {error ? <Notice tone="error">{`We could not load the athletes you follow. ${error}`}</Notice> : null}
        {!error && list.length === 0 ? (
          <Section aria-label="No athletes">
            <EmptyState
              title="You are not following an athlete right now"
              body="A club adds you to an athlete by invite, and can end that access. If you expected to see someone here, contact their coach or the club."
            />
          </Section>
        ) : null}
      </Screen>
    )
  }
  return <>{children(selected)}</>
}
