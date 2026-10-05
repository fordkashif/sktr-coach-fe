"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus } from "@phosphor-icons/react"
import { useMyAvailability } from "@/components/athlete/availability"
import { Button, EmptyState, LinkButton, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows, StatusText, type StateTone } from "@/components/sk"
import { availabilityCovers } from "@/lib/data/athlete/availability-data"
import { listAthleteSessions } from "@/lib/data/session/session-log-data"
import { skippedLabel, type AthleteSessionRef } from "@/lib/data/session/types"
import { addDaysIso, todayIso } from "@/lib/data/training-plan/plan-builder-model"

const HISTORY_DAYS = 84

function parseDay(dateIso: string) {
  return new Date(`${dateIso}T00:00:00Z`)
}

function monthLabel(dateIso: string) {
  return parseDay(dateIso).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })
}

function dayLabel(dateIso: string) {
  return parseDay(dateIso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
}

/** Past sessions, newest first: what was done, skipped or missed, with the effort given. */
export default function AthleteSessionHistoryPage() {
  const today = todayIso()
  const availability = useMyAvailability()
  const [sessions, setSessions] = useState<AthleteSessionRef[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    void listAthleteSessions(addDaysIso(today, -HISTORY_DAYS), today).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setSessions(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [today, reloadToken])

  const months = useMemo(() => {
    const groups = new Map<string, AthleteSessionRef[]>()
    for (const session of sessions ?? []) {
      const key = session.date.slice(0, 7)
      groups.set(key, [...(groups.get(key) ?? []), session])
    }
    return [...groups.entries()]
  }, [sessions])

  const stateOf = (session: AthleteSessionRef): { tone: StateTone; label: string } => {
    if (session.status === "completed") return { tone: "green", label: "Done" }
    if (session.status === "skipped") return { tone: "neutral", label: skippedLabel(session.skipReason) }
    if (session.origin === "athlete") return { tone: "blue", label: "Not finished" }
    if (session.date === today) return { tone: "blue", label: session.status === "in-progress" ? "Started" : "Today" }
    if (availability.periods.some((period) => availabilityCovers(period, session.date))) return { tone: "neutral", label: "Excused" }
    return { tone: "coral", label: "Missed" }
  }

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: "/athlete/log", label: "Log" }}
        title="Session history"
        lede="The last 12 weeks: what you did, skipped and missed."
        actions={
          <LinkButton size="sm" to="/athlete/log/new">
            <Plus className="size-4" weight="bold" aria-hidden />
            Add a session
          </LinkButton>
        }
      />

      {error ? (
        <Notice
          tone="error"
          action={
            <Button size="sm" onClick={() => setReloadToken((value) => value + 1)}>
              Try again
            </Button>
          }
        >
          Could not load your history. {error}
        </Notice>
      ) : sessions === null ? (
        <Section title="Sessions">
          <SkeletonRows rows={6} label="Getting your history" />
        </Section>
      ) : sessions.length === 0 ? (
        <Section aria-label="Sessions">
          <EmptyState
            title="No sessions yet"
            body="Sessions from your plan and sessions you add yourself show up here once their day has come."
            action={
              <LinkButton size="sm" to="/athlete/training-plan">
                Open your plan
              </LinkButton>
            }
          />
        </Section>
      ) : (
        months.map(([key, items]) => (
          <Section key={key} title={monthLabel(`${key}-01`)} meta={`${items.filter((item) => item.status === "completed").length} done`}>
            <List>
              {items.map((session) => {
                const state = stateOf(session)
                const params = new URLSearchParams()
                if (session.date !== today) params.set("date", session.date)
                if (session.origin === "athlete") params.set("session", session.id)
                const query = params.toString()
                return (
                  <ListRow
                    key={session.id}
                    data-history={session.title}
                    to={query ? `/athlete/log?${query}` : "/athlete/log"}
                    title={session.title}
                    subtitle={[dayLabel(session.date), session.origin === "athlete" ? "added by you" : null, session.rpe ? `effort ${session.rpe} of 10` : null].filter(Boolean).join(", ")}
                    trailing={<StatusText tone={state.tone}>{state.label}</StatusText>}
                  />
                )
              })}
            </List>
          </Section>
        ))
      )}
    </Screen>
  )
}
