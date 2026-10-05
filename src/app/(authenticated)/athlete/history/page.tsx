"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus } from "@phosphor-icons/react"
import { useMyAvailability } from "@/components/athlete/availability"
import {
  Button,
  DayLabel,
  EmptyState,
  FilterChips,
  LinkButton,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  SkeletonRows,
  StatusText,
  type StateTone,
} from "@/components/sk"
import { availabilityCovers } from "@/lib/data/athlete/availability-data"
import {
  addDays,
  groupByWeek,
  matchesFilter,
  relativeWeekName,
  sessionOutcome,
  weekStartOf,
  type HistoryFilter,
  type SessionHistoryEntry,
  type SessionOutcome,
} from "@/lib/data/history/session-history"
import { loadSessionHistory } from "@/lib/data/history/session-history-data"
import { skippedLabel } from "@/lib/data/session/types"
import { todayIso } from "@/lib/data/training-plan/plan-builder-model"

/** How many weeks one "show earlier" step goes back. The first load is the same size. */
const WEEKS_PER_PAGE = 8

function utcDay(day: string) {
  return new Date(`${day}T00:00:00Z`)
}

function shortDay(day: string, withYear: boolean) {
  return utcDay(day).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC", ...(withYear ? { year: "numeric" } : {}) })
}

function weekTitle(weekStart: string, weekEnd: string, today: string) {
  const relative = relativeWeekName(weekStart, today)
  if (relative) return relative
  const otherYear = weekEnd.slice(0, 4) !== today.slice(0, 4)
  return `${shortDay(weekStart, false)} to ${shortDay(weekEnd, otherYear)}`
}

type Row = SessionHistoryEntry & { outcome: SessionOutcome }

/** The athlete's past sessions, newest first, grouped by week. A row opens that session's log. */
export default function AthleteHistoryPage() {
  const today = todayIso()
  const availability = useMyAvailability()
  const [sessions, setSessions] = useState<SessionHistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<HistoryFilter>("all")
  /** The Monday the loaded history starts on. */
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reachedStart, setReachedStart] = useState(false)

  const firstFrom = addDays(weekStartOf(today), -7 * (WEEKS_PER_PAGE - 1))

  const loadFirst = useCallback(async () => {
    setError(null)
    const result = await loadSessionHistory(firstFrom, today)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setSessions(result.data)
    setLoadedFrom(firstFrom)
    setReachedStart(false)
  }, [firstFrom, today])

  useEffect(() => {
    void loadFirst()
  }, [loadFirst])

  const loadEarlier = async () => {
    if (!loadedFrom || loadingMore) return
    setLoadingMore(true)
    setError(null)
    const from = addDays(loadedFrom, -7 * WEEKS_PER_PAGE)
    const result = await loadSessionHistory(from, addDays(loadedFrom, -1))
    setLoadingMore(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setLoadedFrom(from)
    if (result.data.length === 0) setReachedStart(true)
    else setSessions((current) => [...(current ?? []), ...result.data])
  }

  const rows = useMemo<Row[]>(
    () =>
      (sessions ?? []).map((session) => ({
        ...session,
        outcome: sessionOutcome(session, today, availability.periods.some((period) => availabilityCovers(period, session.date))),
      })),
    [sessions, today, availability.periods],
  )

  const counts = useMemo(() => {
    const count = (outcome: SessionOutcome) => rows.filter((row) => row.outcome === outcome).length
    return { done: count("done"), skipped: count("skipped"), missed: count("missed") }
  }, [rows])

  const weeks = useMemo(() => groupByWeek(rows.filter((row) => matchesFilter(row.outcome, filter))), [rows, filter])

  const stateOf = (row: Row): { tone: StateTone; label: string } => {
    if (row.outcome === "done") return { tone: "green", label: "Done" }
    if (row.outcome === "skipped") return { tone: "neutral", label: skippedLabel(row.skipReason) }
    if (row.outcome === "missed") return { tone: "coral", label: "Missed" }
    if (row.outcome === "excused") return { tone: "neutral", label: "Excused" }
    if (row.date === today && row.origin !== "athlete") return { tone: "blue", label: row.status === "in-progress" ? "Started" : "Today" }
    return { tone: "blue", label: "Not finished" }
  }

  const sinceText = loadedFrom ? shortDay(loadedFrom, loadedFrom.slice(0, 4) !== today.slice(0, 4)) : ""
  const filterWord = filter === "done" ? "done" : filter === "skipped" ? "skipped" : "missed"

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: "/athlete/trends", label: "Progress" }}
        title="History"
        lede={`Your past sessions${sinceText ? ` since ${sinceText}` : ""}, newest first. Open one to see or change what you logged.`}
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
            sessions === null ? (
              <Button size="sm" onClick={() => void loadFirst()}>
                Try again
              </Button>
            ) : undefined
          }
        >
          Could not load your history. {error}
        </Notice>
      ) : null}

      {sessions === null ? (
        error ? null : (
          <Section title="Sessions">
            <SkeletonRows rows={6} leading label="Getting your history" />
          </Section>
        )
      ) : (
        <>
          {rows.length > 0 ? (
            <>
              <FilterChips<HistoryFilter>
                label="Show"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All", count: rows.length },
                  { value: "done", label: "Done", count: counts.done },
                  { value: "skipped", label: "Skipped", count: counts.skipped },
                  { value: "missed", label: "Missed", count: counts.missed },
                ]}
              />
            </>
          ) : null}

          {rows.length === 0 ? (
            <Section aria-label="Sessions">
              <EmptyState
                title={reachedStart ? "No sessions yet" : `No sessions since ${sinceText}`}
                body="Sessions from your plan and sessions you add yourself show up here once their day has come."
                action={
                  <LinkButton size="sm" to="/athlete/training-plan">
                    Open your plan
                  </LinkButton>
                }
              />
            </Section>
          ) : weeks.length === 0 ? (
            <Section aria-label="Sessions">
              <EmptyState
                title={`No ${filterWord} sessions since ${sinceText}`}
                body="Show all sessions, or look further back."
                action={
                  <Button size="sm" onClick={() => setFilter("all")}>
                    Show all
                  </Button>
                }
              />
            </Section>
          ) : (
            weeks.map((week) => {
              const done = week.items.filter((row) => row.outcome === "done").length
              return (
                <Section key={week.weekStart} title={weekTitle(week.weekStart, week.weekEnd, today)} meta={filter === "all" ? `${done} of ${week.items.length} done` : undefined}>
                  <List>
                    {week.items.map((row) => {
                      const state = stateOf(row)
                      const params = new URLSearchParams()
                      if (row.date !== today) params.set("date", row.date)
                      if (row.origin === "athlete") params.set("session", row.id)
                      const query = params.toString()
                      const day = utcDay(row.date)
                      const facts = [row.origin === "athlete" ? "Added by you" : null, row.rpe ? `Effort ${row.rpe} of 10` : null].filter(Boolean).join(", ")
                      return (
                        <ListRow
                          key={row.id}
                          data-session={row.title}
                          data-history={row.title}
                          data-outcome={row.outcome}
                          to={query ? `/athlete/log?${query}` : "/athlete/log"}
                          leading={<DayLabel weekday={day.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })} number={day.getUTCDate()} today={row.date === today} />}
                          title={
                            <>
                              <span className="sr-only">{day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}, </span>
                              {row.title}
                            </>
                          }
                          subtitle={
                            <>
                              <StatusText tone={state.tone}>{state.label}</StatusText>
                              {facts ? <span className="block">{facts}</span> : null}
                              {row.summary ? <span className="block">{row.summary}</span> : row.outcome === "done" ? <span className="block">Finished with nothing written down</span> : null}
                            </>
                          }
                        />
                      )
                    })}
                  </List>
                </Section>
              )
            })
          )}

          <Section aria-label="Earlier sessions">
            {reachedStart ? (
              <p className="sk-list-sub">That is everything. There are no sessions before {sinceText}.</p>
            ) : (
              <Button onClick={() => void loadEarlier()} disabled={loadingMore}>
                {loadingMore ? "Getting earlier sessions..." : "Show earlier sessions"}
              </Button>
            )}
          </Section>
        </>
      )}
    </Screen>
  )
}
