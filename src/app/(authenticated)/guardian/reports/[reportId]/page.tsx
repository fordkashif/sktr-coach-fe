"use client"

import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { GuardianChildScreen } from "@/components/guardian/guardian-frame"
import { ReportPrintSheet, ReportSheet } from "@/components/reports/report-sheet"
import { Button, EmptyState, LinkButton, Screen, ScreenHeader, ScreenSkeleton, Section, printPage } from "@/components/sk"
import { getGuardianReport } from "@/lib/data/guardian/guardian-data"
import type { GuardianChild } from "@/lib/data/guardian/types"
import { reportRangeText } from "@/lib/data/reports/athlete-report"
import type { MyReport } from "@/lib/data/reports/athlete-report-data"

function ChildReport({ child, reportId }: { child: GuardianChild; reportId: string }) {
  const [report, setReport] = useState<MyReport | null>(null)
  const [missing, setMissing] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setReport(null)
    setMissing(null)
    void getGuardianReport(child.athleteId, reportId).then((result) => {
      if (cancelled) return
      if (result.ok) setReport(result.data)
      else setMissing(result.error.code === "NOT_FOUND" ? "not-found" : result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [child.athleteId, reportId])

  const back = { to: "/guardian/results", label: "Results" }
  if (!report && !missing) return <ScreenSkeleton />
  if (!report) {
    return (
      <Screen width="narrow">
        <ScreenHeader back={back} title="Report from the coach" />
        <Section aria-label="Report">
          <EmptyState
            title="This report is not here"
            body={missing === "not-found" ? `It may have been removed, or it is about another athlete. Reports shared with ${child.firstName} are listed under Results.` : `Could not load it: ${missing}`}
            action={
              <LinkButton to="/guardian/results" size="sm">
                Back to Results
              </LinkButton>
            }
          />
        </Section>
      </Screen>
    )
  }

  return (
    <Screen width="narrow">
      <ScreenHeader back={back} title="Report from the coach" lede={`${reportRangeText(report.period)}, from ${report.authorName}.`} actions={<Button onClick={() => printPage()}>Print or save as PDF</Button>} />
      <Section aria-label="The report">
        <ReportSheet snapshot={report.snapshot} headingAs="h2" />
      </Section>
      <ReportPrintSheet snapshot={report.snapshot} />
    </Screen>
  )
}

/** A report the coach shared with the athlete, read by their guardian: read only, printable. */
export default function GuardianReportPage() {
  const { reportId = "" } = useParams()
  return <GuardianChildScreen title="Report from the coach">{(child) => <ChildReport child={child} reportId={reportId} />}</GuardianChildScreen>
}
