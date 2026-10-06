"use client"

import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { ReportPrintSheet, ReportSheet } from "@/components/reports/report-sheet"
import { Button, EmptyState, LinkButton, Screen, ScreenHeader, ScreenSkeleton, Section, printPage } from "@/components/sk"
import { reportRangeText } from "@/lib/data/reports/athlete-report"
import { getMyReport, type MyReport } from "@/lib/data/reports/athlete-report-data"

/** A report the athlete's coach shared with them: read only, printable. */
export default function AthleteReportPage() {
  const { reportId = "" } = useParams()
  const [report, setReport] = useState<MyReport | null>(null)
  const [missing, setMissing] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setReport(null)
    setMissing(null)
    void getMyReport(reportId).then((result) => {
      if (cancelled) return
      if (result.ok) setReport(result.data)
      else setMissing(result.error.code === "NOT_FOUND" ? "not-found" : result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [reportId])

  if (!report && !missing) return <ScreenSkeleton />
  if (!report) {
    return (
      <Screen width="narrow">
        <ScreenHeader back={{ to: "/athlete/trends", label: "Progress" }} title="Report from your coach" />
        <Section aria-label="Report">
          <EmptyState
            title="This report is not here"
            body={missing === "not-found" ? "Your coach may have removed it. Reports your coach shares with you are listed under Progress." : `Could not load it: ${missing}`}
            action={
              <LinkButton to="/athlete/trends" size="sm">
                Back to Progress
              </LinkButton>
            }
          />
        </Section>
      </Screen>
    )
  }

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: "/athlete/trends", label: "Progress" }}
        title="Report from your coach"
        lede={`${reportRangeText(report.period)}, from ${report.authorName}.`}
        actions={<Button onClick={() => printPage()}>Print or save as PDF</Button>}
      />
      <Section aria-label="The report">
        <ReportSheet snapshot={report.snapshot} headingAs="h2" />
      </Section>
      <ReportPrintSheet snapshot={report.snapshot} />
    </Screen>
  )
}
