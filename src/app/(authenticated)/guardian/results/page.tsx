"use client"

import { useEffect, useState } from "react"
import { GuardianChildScreen, dayRange, shortDay } from "@/components/guardian/guardian-frame"
import { EmptyState, List, ListRow, Notice, Screen, ScreenHeader, Section, SkeletonRows, Split, StatusText } from "@/components/sk"
import { getGuardianReports, getGuardianResults } from "@/lib/data/guardian/guardian-data"
import type { GuardianChild, GuardianResults } from "@/lib/data/guardian/types"
import { reportRangeText } from "@/lib/data/reports/athlete-report"
import type { MyReport } from "@/lib/data/reports/athlete-report-data"

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

  return (
    <Screen>
      <ScreenHeader fact={child.teamName ?? undefined} title={`${child.firstName}'s results`} lede="Competitions, results, records, goals and test weeks. Reports the coach shared are here too." />

      {error ? <Notice tone="error">{`Results could not be loaded. ${error}`}</Notice> : null}

      <Split
        main={
          <>
            <Section title="Coming up">
              {loading ? (
                <SkeletonRows rows={2} />
              ) : !data || data.upcoming.length === 0 ? (
                <EmptyState title="No competition coming up" body="Meets the coach adds for the team show here." />
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

            <Section title="Results" hint="Newest first.">
              {loading ? (
                <SkeletonRows rows={4} />
              ) : !data || data.results.length === 0 ? (
                <EmptyState title="No results yet" body={`Marks from competitions, training and test weeks show here once ${child.firstName} or the coach adds them.`} />
              ) : (
                <List aria-label="Results">
                  {data.results.map((result) => (
                    <ListRow
                      key={result.id}
                      title={result.eventLabel}
                      subtitle={[shortDay(result.date), result.where ?? result.source, result.place ? `Place ${result.place}` : null, result.wind ? `Wind ${result.wind}` : null].filter(Boolean).join(", ")}
                      trailing={<span className="text-lg font-extrabold tabular-nums text-sk-ink">{result.mark}</span>}
                    />
                  ))}
                </List>
              )}
            </Section>

            <Section title="Test weeks">
              {loading ? (
                <SkeletonRows rows={3} />
              ) : !data || data.testWeeks.length === 0 ? (
                <EmptyState title="No test week yet" body="When the coach opens a test week for the team, the tests and results show here." />
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
                          trailing={test.value ? <span className="font-bold tabular-nums text-sk-ink">{test.value}</span> : <span className="text-sm text-sk-mute">No result yet</span>}
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
            <Section title="Records" hint="Best mark in each event.">
              {loading ? (
                <SkeletonRows rows={2} />
              ) : !data || data.records.length === 0 ? (
                <EmptyState title="No records yet" />
              ) : (
                <List aria-label="Records">
                  {data.records.map((record) => (
                    <ListRow key={record.eventLabel} title={record.eventLabel} subtitle={shortDay(record.date)} trailing={<span className="text-lg font-extrabold tabular-nums text-sk-ink">{record.mark}</span>} />
                  ))}
                </List>
              )}
            </Section>

            <Section title="Goals">
              {loading ? (
                <SkeletonRows rows={2} />
              ) : !data || data.goals.length === 0 ? (
                <EmptyState title="No goals set" body={`Goals ${child.firstName} or the coach sets show here.`} />
              ) : (
                <List aria-label="Goals">
                  {data.goals.map((goal) => (
                    <ListRow
                      key={goal.id}
                      title={`${goal.eventLabel}: ${goal.target}`}
                      subtitle={goal.achievedOn ? `Reached on ${shortDay(goal.achievedOn)}` : goal.targetDate ? `By ${shortDay(goal.targetDate)}` : "No date set"}
                      trailing={goal.achievedOn ? <StatusText tone="green">Reached</StatusText> : undefined}
                    />
                  ))}
                </List>
              )}
            </Section>

            <Section title="Reports from the coach" hint={`Reports the coach shared with ${child.firstName}.`}>
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
