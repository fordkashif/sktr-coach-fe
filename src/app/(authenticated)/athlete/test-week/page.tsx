"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, CheckmarkCircle02Icon, StarAward02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { getCurrentAthletePrRecords } from "@/lib/data/pr/pr-data"
import type { PrRecord } from "@/lib/data/pr/types"
import { getLatestBenchmarkSnapshotForCurrentAthlete } from "@/lib/data/test-week/test-week-data"
import { mockAthletes, mockPRs, mockTestDefinitions, mockTestWeekResults, onSubmitTestWeek } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"
import {
  getCurrentAthleteActiveTestWeekContext,
  submitCurrentAthleteTestWeekResults
} from "@/lib/data/test-week/test-week-data"

type TestSubmission = Record<string, string>

const PR_OVERRIDE_STORAGE_KEY = "pacelab:pr-overrides"
const TEST_WEEK_STORAGE_KEY = "pacelab:test-week-submission"

export default function AthleteTestWeekPage() {
  const backendMode = getBackendMode()
  const athlete = mockAthletes[0]
  const [activeTests, setActiveTests] = useState<string[]>([...mockTestDefinitions])
  const [values, setValues] = useState<TestSubmission>(Object.fromEntries(mockTestDefinitions.map((test) => [test, ""])))
  const [prUpdates, setPrUpdates] = useState<string[]>([])
  const [backendPrs, setBackendPrs] = useState<PrRecord[]>([])
  const [backendBenchmarks, setBackendBenchmarks] = useState<Record<string, string>>({})
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [submittedAt, setSubmittedAt] = useState<string | null>(() => {
    if (typeof window === "undefined") return null
    if (backendMode === "supabase") return null
    return window.localStorage.getItem(tenantStorageKey(TEST_WEEK_STORAGE_KEY))
  })

  const athletePrs =
    backendMode === "supabase"
      ? backendPrs.map((pr) => ({
          event: pr.event,
          bestValue: pr.bestValue,
        }))
      : mockPRs
          .filter((pr) => pr.athleteId === athlete.id)
          .map((pr) => ({ event: pr.event, bestValue: pr.bestValue }))
  const lastBenchmarks = backendMode === "supabase" ? null : mockTestWeekResults.find((row) => row.athleteId === athlete.id)
  const completionCount = activeTests.filter((test) => values[test]?.trim()).length

  useEffect(() => {
    setValues((current) => {
      const next: TestSubmission = {}
      activeTests.forEach((test) => {
        next[test] = current[test] ?? ""
      })
      return next
    })
  }, [activeTests])

  useEffect(() => {
    if (backendMode !== "supabase") return

    void (async () => {
      const [contextResult, prsResult, benchmarkResult] = await Promise.all([
        getCurrentAthleteActiveTestWeekContext(),
        getCurrentAthletePrRecords(),
        getLatestBenchmarkSnapshotForCurrentAthlete(),
      ])

      if (!contextResult.ok) {
        setSubmissionError(contextResult.error.message)
        return
      }

      if (!contextResult.data) {
        setActiveTests([])
        return
      }

      setActiveTests(contextResult.data.tests.map((test) => test.name))
      if (contextResult.data.lastSubmittedAt) {
        setSubmittedAt(new Date(contextResult.data.lastSubmittedAt).toLocaleString())
      }

      if (!prsResult.ok) {
        setSubmissionError((current) => current ?? prsResult.error.message)
      } else {
        setBackendPrs(prsResult.data)
      }

      if (!benchmarkResult.ok) {
        setSubmissionError((current) => current ?? benchmarkResult.error.message)
      } else {
        setBackendBenchmarks(
          Object.fromEntries((benchmarkResult.data?.results ?? []).map((row) => [row.label.toLowerCase(), row.valueText])),
        )
      }
    })()
  }, [backendMode])

  const benchmarkCards = useMemo(
    () => [
      {
        label: "30m",
        value: backendMode === "supabase" ? backendBenchmarks["30m sprint"] ?? backendBenchmarks["30m"] ?? "-" : lastBenchmarks?.thirtyM?.value ?? "-",
      },
      {
        label: "Flying 30m",
        value:
          backendMode === "supabase"
            ? backendBenchmarks["flying 30m"] ?? backendBenchmarks["flying 30"] ?? "-"
            : lastBenchmarks?.flyingThirtyM?.value ?? "-",
      },
      {
        label: "150m",
        value:
          backendMode === "supabase"
            ? backendBenchmarks["150m"] ?? backendBenchmarks["150m sprint"] ?? "-"
            : lastBenchmarks?.oneHundredFiftyM?.value ?? "-",
      },
      {
        label: "Squat 1RM",
        value:
          backendMode === "supabase"
            ? backendBenchmarks["back squat 1rm"] ?? backendBenchmarks["squat 1rm"] ?? "-"
            : lastBenchmarks?.squat1RM?.value ?? "-",
      },
      {
        label: "CMJ",
        value:
          backendMode === "supabase"
            ? backendBenchmarks["cmj"] ?? backendBenchmarks["counter movement jump"] ?? "-"
            : lastBenchmarks?.cmj?.value ?? "-",
      },
    ],
    [backendBenchmarks, backendMode, lastBenchmarks],
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmitTestWeek()
    setSubmissionError(null)

    const updates: string[] = []

    athletePrs.forEach((pr) => {
      const next = values[pr.event]
      if (!next) return
      if (next !== pr.bestValue) {
        updates.push(`${pr.event}: ${pr.bestValue} -> ${next}`)
      }
    })

    if (values["CMJ"] && !athletePrs.some((pr) => pr.event === "CMJ")) {
      updates.push(`CMJ: added new benchmark ${values["CMJ"]}`)
    }

    if (backendMode === "supabase") {
      const submission = await submitCurrentAthleteTestWeekResults(values)
      if (!submission.ok) {
        setSubmissionError(submission.error.message)
        return
      }
      setSubmittedAt(new Date(submission.data.submittedAt).toLocaleString())
    } else {
      const key = tenantStorageKey(PR_OVERRIDE_STORAGE_KEY)
      const existing = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, string>
      const nextOverrides = { ...existing }
      Object.entries(values).forEach(([eventName, value]) => {
        if (value.trim()) {
          nextOverrides[eventName] = value.trim()
        }
      })
      window.localStorage.setItem(key, JSON.stringify(nextOverrides))

      const submissionStamp = new Date().toLocaleString()
      window.localStorage.setItem(tenantStorageKey(TEST_WEEK_STORAGE_KEY), submissionStamp)
      setSubmittedAt(submissionStamp)
    }

    setPrUpdates(updates)
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="mobile-hero-surface">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mobile-pill-accent">Testing</span>
            <span className="mobile-pill-muted">{activeTests.length} benchmarks</span>
          </div>
          <h1 className="mobile-hero-title">Test Week</h1>
          <p className="mobile-hero-copy">
            Submit benchmark results, review likely PR movement, and hand the testing block back to your coach for review.
          </p>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="mobile-card-primary">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Submission</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Enter Results</h2>
              <p className="text-sm text-slate-500">Fill the active battery and submit once the block is complete.</p>
            </div>
            <div className="mobile-card-utility text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Completion</p>
              <p className="mt-1 text-2xl font-semibold tracking-[-0.05em] text-slate-950">{completionCount}/{activeTests.length}</p>
            </div>
          </div>

          <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
            {submissionError ? (
              <div className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {submissionError}
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {activeTests.map((test) => (
                <div key={test} className="mobile-card-utility space-y-2">
                  <Label htmlFor={test} className="text-sm font-medium text-slate-950">{test}</Label>
                  <Input
                    id={test}
                    placeholder="4.01s or 6.51m"
                    value={values[test]}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [test]: event.target.value,
                      }))
                    }
                    className="h-12 rounded-[16px] border-slate-200 bg-white text-slate-950"
                  />
                </div>
              ))}
            </div>
            <Button type="submit" className="mobile-action-primary h-12 w-full">
              Submit results
            </Button>
          </form>
        </div>

        <div className="space-y-5">
          <div className="mobile-card-primary">
            <div className="mobile-surface-heading">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Last Benchmarks</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Previous Testing</h2>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {benchmarkCards.map((item) => (
                <div key={item.label} className="mobile-stat-card">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
                  <p className="mt-1.5 text-lg font-semibold tracking-[-0.03em] text-slate-950">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mobile-card-primary">
            <div className="mobile-surface-heading">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Coach Review</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Submission State</h2>
            </div>
            <div className="mt-4 space-y-3">
              {submittedAt ? (
                <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />
                    Results submitted
                  </div>
                  <p className="mt-2 text-sm text-emerald-700/80">Submitted {submittedAt}. Your coach can now review the testing block and compare any PR movement.</p>
                </div>
              ) : (
                <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                  <p className="text-sm text-slate-500">Submit the active battery to move this test week into coach review.</p>
                </div>
              )}

              <Button asChild variant="outline" className="mobile-action-secondary w-full">
                <Link to="/athlete/trends">
                  Open progress
                  <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="mobile-card-primary">
          <div className="mobile-surface-heading">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">PR Detection</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Likely Record Changes</h2>
          </div>
          <div className="mt-4 space-y-3">
            {prUpdates.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                <p className="text-sm text-slate-500">Submit results to detect PR movement automatically.</p>
              </div>
            ) : (
              prUpdates.map((update) => (
                <div key={update} className="mobile-card-utility text-sm font-medium text-slate-950">
                  {update}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mobile-card-primary">
          <div className="mobile-surface-heading">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Workflow</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Related Actions</h2>
          </div>
          <div className="mt-4 grid gap-3">
            {[
              { label: "Back to progress", href: "/athlete/trends", icon: ArrowRight01Icon },
              { label: "View PRs", href: "/athlete/prs", icon: StarAward02Icon },
              { label: "Open today", href: "/athlete/home", icon: ArrowRight01Icon },
            ].map((item) => (
              <Button key={item.href} asChild variant="outline" className="mobile-action-secondary">
                <Link to={item.href}>
                  {item.label}
                  <HugeiconsIcon icon={item.icon} className="size-4" />
                </Link>
              </Button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
