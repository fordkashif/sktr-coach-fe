"use client"

import { useEffect, useState } from "react"
import { EmptyState, List, ListRow, Notice, Screen, ScreenHeader, ScreenSkeleton, Section, SkeletonRows } from "@/components/sk"
import { getGuardianAnnouncements } from "@/lib/data/guardian/guardian-data"
import type { GuardianAnnouncement } from "@/lib/data/guardian/types"
import { useGuardianChildren } from "@/lib/guardian/children-store"

function when(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
}

/** Announcements to the teams of the athletes a guardian follows, and to the whole club. Read only: a guardian messages nobody. */
export default function GuardianNewsPage() {
  const { children, loading } = useGuardianChildren()
  const [items, setItems] = useState<GuardianAnnouncement[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    let cancelled = false
    setItems(null)
    setError(null)
    void getGuardianAnnouncements(children).then((result) => {
      if (cancelled) return
      if (result.ok) setItems(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [children, loading])

  if (loading) return <ScreenSkeleton />

  return (
    <Screen width="narrow">
      <ScreenHeader title="Announcements" lede="What the coach and the club posted to the team. To reach the coach, use the contact shown on Home." />
      {error ? <Notice tone="error">{`Announcements could not be loaded. ${error}`}</Notice> : null}
      <Section aria-label="Announcements">
        {!items ? (
          error ? null : (
            <SkeletonRows rows={3} />
          )
        ) : items.length === 0 ? (
          <EmptyState title="No announcements yet" body="What the coach or the club posts to the team shows here." />
        ) : (
          <List aria-label="Announcements">
            {items.map((item) => (
              <ListRow key={item.id} title={<span className="whitespace-pre-wrap font-normal">{item.body}</span>} subtitle={`${item.from}, ${when(item.createdAt)}`} data-announcement={item.id} />
            ))}
          </List>
        )}
      </Section>
    </Screen>
  )
}
