"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { GuardianChildScreen, dayRange, shortDay } from "@/components/guardian/guardian-frame"
import { Bars, EmptyState, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows, Split, StatusText } from "@/components/sk"
import { getGuardianReports, getGuardianResults } from "@/lib/data/guardian/guardian-data"
import type { GuardianChild, GuardianResult, GuardianResults } from "@/lib/data/guardian/types"
import { reportRangeText } from "@/lib/data/reports/athlete-report"
import type { MyReport } from "@/lib/data/reports/athlete-report-data"
import { viewText } from "@/lib/units-view"

/**
 * The event with the most marks (two or more), its last five oldest first, for the bars. A mark in
 * seconds is a time, so lower is better.
 */
function progression(results: GuardianResult[]) {
  const byEvent = new Map<string, GuardianResult[]>()
  for (const result of results) {
    if (!Number.isFinite(Number.parseFloat(result.mark))) continue
    byEvent.set(result.eventLabel, [...(byEvent.get(result.eventLabel) ?? []), result])
  }
  const [event, marks] = [...byEvent.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? []
  if (!event || !marks || marks.length < 2) return null
  const recent = [...marks].sort((a, b) => a.date.localeCompare(b.date)).slice(-5)
  return {
    event,
    lowerIsBetter: /\d\s*s$/.test(recent[0].mark.trim()),
    items: recent.map((result) => ({ key: result.id, label: shortDay(result.date).replace(/^\w+, /, ""), value: Number.parseFloat(result.mark), display: viewText(result.mark) })),
  }
}

function ChildResults({ child }: { child: GuardianChild }) {
  const [data, setData] = useState<GuardianResults | null>(null)
  const [reports, setReports] = useState<MyReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setReports(null)
    setError(null)
    void getGuardianResults(child).then((result) => {
      if (cancelled) return
      if (result.ok) setData(result.data)
      else setError(result.error.message)
    })
    void getGuardianReports(child.athleteId).then((result) => {
      if (!cancelled) setReports(result.ok ? result.data : [])
    })
    return () => {
      cancelled = true
    }
  }, [child])

  const loading = !data && !error
  const progress = data ? progression(data.results) : null

  return (
    <Screen>
      <ScreenHeader fact={child.teamName ?? undefined} title={`${child.firstName}'s results`} />

      {error ? <Notice tone="error">{`Results could not be loaded. ${error}`}</Notice> : null}

      <Split
        main={
          <>
            <Section title="Coming up">
              {loading ? (
                <SkeletonRows rows={2} />
              ) : !data || data.upcoming.length === 0 ? (
                <EmptyState title="No competition coming up" />
              ) : (
                <List aria-label="Upcoming competitions">
                  {data.upcoming.map((meet) => (
                    <ListRow
                      key={meet.id}
                      title={meet.name}
                      subtitle={[dayRange(meet.startDate, meet.endDate), meet.place].filter(Boolean).join(", ")}
                      trailing={meet.events.length > 0 ? <span className="text-right text-sm font-semibold text-sk-ink">{meet.events.join(", ")}</span> : <span className="text-sm text-sk-mute">Not entered</span>}
                      data-competition={meet.id}
                    />
                  ))}
                </List>
              )}
            </Section>

            {progress ? (
              <Section title={`${progress.event}, mark by mark`}>
                <Bars
                  label={`${child.firstName}'s ${progress.event} marks, oldest first`}
                  lowerIsBetter={progress.lowerIsBetter}
                  items={progress.items}
                />
              </Section>
            ) : null}

            <Section title="Results">
              {loading ? (
                <SkeletonRows rows={4} />
              ) : !data || data.results.length === 0 ? (
                <EmptyState title="No results yet" />
              ) : (
                <List aria-label="Results">
                  {data.results.map((result) => (
                    <ListRow
                      key={result.id}
                      title={result.eventLabel}
                      subtitle={[shortDay(result.date), result.where ?? result.source, result.place ? `Place ${result.place}` : null, result.wind ? `Wind ${result.wind}` : null].filter(Boolean).join(", ")}
                      trailing={<span className="text-lg font-extrabold tabular-nums text-sk-ink">{viewText(result.mark)}</span>}
                    />
                  ))}
                </List>
              )}
            </Section>

            <Section title="Test weeks">
              {loading ? (
                <SkeletonRows rows={3} />
              ) : !data || data.testWeeks.length === 0 ? (
                <EmptyState title="No test week yet" />
              ) : (
                data.testWeeks.map((week) => (
                  <div key={week.id} className="pt-2" data-test-week={week.id}>
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-base font-bold text-sk-ink">
                      {week.name}
                      <span className="text-sm font-normal text-sk-mute">{`${dayRange(week.startDate, week.endDate)}, ${week.status === "closed" ? "closed" : "open"}`}</span>
                    </p>
                    <List aria-label={week.name}>
                      {week.tests.map((test) => (
                        <ListRow
                          key={test.name}
                          title={test.name}
                          trailing={test.value ? <span className="font-bold tabular-nums text-sk-ink">{viewText(test.value)}</span> : <span className="text-sm text-sk-mute">No result yet</span>}
                        />
                      ))}
                    </List>
                  </div>
                ))
              )}
            </Section>
          </>
        }
        side={
          <>
            <Section title="Records">
              {loading ? (
                <SkeletonRows rows={2} />
              ) : !data || data.records.length === 0 ? (
                <EmptyState title="No records yet" />
              ) : (
                <ul aria-label="Records" className="grid grid-cols-2 gap-2.5">
                  {data.records.map((record, index) => (
                    <li key={record.eventLabel} className="sk-tile-item">
                      <span className={cn("sk-tile flex h-full flex-col p-4", index === 0 && "sk-tile-accent")} data-record={record.eventLabel}>
                        <span className={cn("text-sm font-bold", index === 0 ? "text-sk-on-accent" : "text-sk-mute")}>{record.eventLabel}</span>
                        <span className="mt-1 font-display text-[2rem] font-black leading-none tabular-nums">{viewText(record.mark)}</span>
                        <span className={cn("mt-auto pt-2 text-[0.8125rem]", index === 0 ? "text-sk-on-accent/85" : "text-sk-mute")}>{shortDay(record.date)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Goals">
              {loading ? (
                <SkeletonRows rows={2} />
              ) : !data || data.goals.length === 0 ? (
                <EmptyState title="No goals set" />
              ) : (
                <List aria-label="Goals">
                  {data.goals.map((goal) => (
                    <ListRow
                      key={goal.id}
                      title={`${goal.eventLabel}: ${viewText(goal.target)}`}
                      subtitle={goal.achievedOn ? `Reached on ${shortDay(goal.achievedOn)}` : goal.targetDate ? `By ${shortDay(goal.targetDate)}` : "No date set"}
                      trailing={goal.achievedOn ? <StatusText tone="green">Reached</StatusText> : undefined}
                    />
                  ))}
                </List>
              )}
            </Section>

            <Section title="Reports from the coach">
              {!reports ? (
                <SkeletonRows rows={1} />
              ) : reports.length === 0 ? (
                <EmptyState title="No report shared yet" />
              ) : (
                <List aria-label="Reports">
                  {reports.map((report) => (
                    <ListRow key={report.id} to={`/guardian/reports/${report.id}`} title={reportRangeText(report.period)} subtitle={`From ${report.authorName}, shared ${shortDay(report.sharedAt)}`} data-report={report.id} />
                  ))}
                </List>
              )}
            </Section>
          </>
        }
      />
    </Screen>
  )
}

/** Competitions, results, records, goals, test weeks and shared reports of the athlete a guardian follows. Read only. */
export default function GuardianResultsPage() {
  return <GuardianChildScreen title="Results">{(child) => <ChildResults child={child} />}</GuardianChildScreen>
}
