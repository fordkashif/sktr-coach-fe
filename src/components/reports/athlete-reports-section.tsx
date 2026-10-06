"use client"

import { useEffect, useState } from "react"
import { EmptyState, LinkButton, List, ListRow, Section, SkeletonRows, StatusDot } from "@/components/sk"
import { reportRangeText } from "@/lib/data/reports/athlete-report"
import { ATHLETE_REPORTS_CHANGED_EVENT, listAthleteReports, type AthleteReport } from "@/lib/data/reports/athlete-report-data"

function dayOf(timestamp: string) {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function sharedLine(report: AthleteReport, first: string) {
  const links = report.links.filter((link) => link.state === "active").length
  const parts = [report.sharedWithAthleteAt ? `shared with ${first}` : null, links > 0 ? `${links} ${links === 1 ? "link" : "links"}` : null].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : report.links.length > 0 ? "links ended" : report.summary ? "not shared" : "draft, no summary yet"
}

/** The saved reports about one athlete on the coach's athlete screen: period, date, author, and whether it is shared. */
export function AthleteReportsSection({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  const [reports, setReports] = useState<AthleteReport[] | null>(null)
  const first = athleteName.split(" ")[0] || athleteName
  const createPath = `/coach/athletes/${athleteId}/report`

  useEffect(() => {
    let cancelled = false
    const load = () =>
      void listAthleteReports(athleteId).then((result) => {
        // A read that fails leaves the section empty; the rest of the athlete screen is unaffected.
        if (!cancelled) setReports(result.ok ? result.data : [])
      })
    load()
    window.addEventListener(ATHLETE_REPORTS_CHANGED_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(ATHLETE_REPORTS_CHANGED_EVENT, load)
    }
  }, [athleteId])

  return (
    <Section
      title="Reports"
      data-athlete-reports
      action={
        reports && reports.length > 0 ? (
          <LinkButton to={createPath} variant="quiet" size="sm">
            Create report
          </LinkButton>
        ) : undefined
      }
    >
      {reports === null ? (
        <SkeletonRows rows={2} label="Loading reports" />
      ) : reports.length === 0 ? (
        <EmptyState
          title="No reports yet"
          body={`Write up a period for ${first}: your summary with their attendance, training, results and goals. Share it in the app, by a private link, or on paper.`}
          action={
            <LinkButton to={createPath} size="sm">
              Create report
            </LinkButton>
          }
        />
      ) : (
        <List aria-label="Saved reports">
          {reports.map((report) => (
            <ListRow
              key={report.id}
              data-report={report.id}
              to={`/coach/athletes/${athleteId}/report/${report.id}`}
              leading={<StatusDot tone={report.sharedWithAthleteAt || report.links.some((link) => link.state === "active") ? "green" : "neutral"} />}
              title={reportRangeText(report.period)}
              subtitle={`Saved ${dayOf(report.createdAt)} by ${report.authorName}, ${sharedLine(report, first)}`}
            />
          ))}
        </List>
      )}
    </Section>
  )
}
