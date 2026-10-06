"use client"

import { useEffect, useState } from "react"
import { useLocation } from "react-router-dom"
import { ReportPrintSheet, ReportSheet } from "@/components/reports/report-sheet"
import { Button, EmptyState, Screen, SkeletonRows, printPage } from "@/components/sk"
import type { AthleteReportSnapshot } from "@/lib/data/reports/athlete-report"
import { getSharedReport } from "@/lib/data/reports/athlete-report-data"

/**
 * A report opened from a private link, without signing in. The token is the part of the address
 * after "#", which the browser keeps to itself. The page shows the report and nothing else about
 * the club. A wrong link, a link that has ended and a link that was stopped all look the same.
 */

// One read per token per visit, so an open is counted once even when the screen renders twice.
const reads = new Map<string, Promise<AthleteReportSnapshot | "not-found" | "error">>()

function readOnce(token: string) {
  let read = reads.get(token)
  if (!read) {
    read = getSharedReport(token).then((result) => (result.ok ? (result.data ?? "not-found") : "error"))
    reads.set(token, read)
  }
  return read
}

export default function SharedReportPage() {
  const { hash } = useLocation()
  const token = hash.replace(/^#/, "").trim()
  const [state, setState] = useState<AthleteReportSnapshot | "loading" | "not-found" | "error">("loading")

  useEffect(() => {
    let cancelled = false
    setState("loading")
    void readOnce(token).then((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    // A private page: keep it out of search engines and do not pass its address on.
    const previous = document.title
    document.title = "Report"
    const tags = [
      ["robots", "noindex, nofollow"],
      ["referrer", "no-referrer"],
    ].map(([name, content]) => {
      const tag = document.createElement("meta")
      tag.name = name
      tag.content = content
      document.head.appendChild(tag)
      return tag
    })
    return () => {
      document.title = previous
      tags.forEach((tag) => tag.remove())
    }
  }, [])

  return (
    <main id="main-content" data-shared-report={typeof state === "string" ? state : "found"}>
      <Screen width="narrow">
        {state === "loading" ? (
          <SkeletonRows rows={6} label="Opening the report" />
        ) : state === "not-found" || state === "error" ? (
          <>
            <h1 className="sk-title-compact">{state === "error" ? "The report could not be opened" : "This report is not available"}</h1>
            <EmptyState
              title={state === "error" ? "Something went wrong on the way" : "The link does not open a report"}
              body={
                state === "error"
                  ? "Check your connection and open the link again."
                  : "It may be mistyped, it may have ended, or the coach may have stopped it. Ask the coach for a new link."
              }
            />
          </>
        ) : (
          <>
            <ReportSheet snapshot={state} titleAs="h1" headingAs="h2" />
            <div className="flex flex-col gap-3 border-t border-sk-line pt-5">
              <div>
                <Button onClick={() => printPage()}>Print or save as PDF</Button>
              </div>
              <p className="text-sm text-sk-mute">Shared privately by the coach through SKTR Coach. This link is for you: please do not pass it on. It stops working on its own.</p>
            </div>
            <ReportPrintSheet snapshot={state} />
          </>
        )}
      </Screen>
    </main>
  )
}
