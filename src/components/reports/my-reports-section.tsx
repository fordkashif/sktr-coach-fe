"use client"

import { useEffect, useState } from "react"
import { List, ListRow, Section } from "@/components/sk"
import { reportRangeText } from "@/lib/data/reports/athlete-report"
import { listMyReports, type MyReport } from "@/lib/data/reports/athlete-report-data"

function dayOf(timestamp: string) {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/**
 * "Reports from your coach" on the athlete's Progress screen. Shows nothing at all until a coach
 * has shared one, so the screen does not grow an empty section.
 */
export function MyReportsSection() {
  const [reports, setReports] = useState<MyReport[]>([])

  useEffect(() => {
    let cancelled = false
    void listMyReports().then((result) => {
      if (!cancelled && result.ok) setReports(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (reports.length === 0) return null
  return (
    <Section title="Reports from your coach" data-my-reports>
      <List aria-label="Reports from your coach">
        {reports.map((report) => (
          <ListRow key={report.id} to={`/athlete/reports/${report.id}`} title={reportRangeText(report.period)} subtitle={`From ${report.authorName}, shared ${dayOf(report.sharedAt)}`} />
        ))}
      </List>
    </Section>
  )
}
