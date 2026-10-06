"use client"

import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ReportPrintSheet, ReportSheet } from "@/components/reports/report-sheet"
import { saveReportQueue } from "@/components/reports/report-queue"
import {
  Button,
  CheckRow,
  Choices,
  DateRangeFields,
  Field,
  InlineConfirm,
  List,
  Notice,
  Screen,
  ScreenHeader,
  ScreenSkeleton,
  Section,
  SkeletonRows,
  Split,
  Textarea,
  notify,
  notifyError,
  printPage,
} from "@/components/sk"
import { getTeamRoster } from "@/lib/data/coach/roster-data"
import {
  buildAthleteReportSnapshot,
  cleanReportSections,
  DEFAULT_REPORT_SECTIONS,
  HEALTH_CONSENT_LINE,
  includesHealth,
  nextReportRange,
  REPORT_PERIOD_OPTIONS,
  REPORT_SECTIONS,
  REPORT_SUMMARY_MAX,
  reportRangeFor,
  reportRangeProblem,
  reportRangeText,
  type ReportPeriodKind,
  type ReportRange,
  type ReportSectionKey,
} from "@/lib/data/reports/athlete-report"
import { createTeamReportDrafts, getAthleteReport, loadAthleteReportContext, saveAthleteReport, type AthleteReportContext } from "@/lib/data/reports/athlete-report-data"
import { todayIso } from "@/lib/data/training-plan/plan-builder-model"

/**
 * Create a report about one athlete: choose the period and the sections, write the summary, and
 * see the sheet as it will be saved. With ?copy=<report> it starts from an earlier report: the
 * same sections, the period that follows it, and an empty summary.
 */
export default function CoachCreateAthleteReportPage() {
  const { athleteId = "" } = useParams()
  const [search] = useSearchParams()
  const copyFrom = search.get("copy")
  const navigate = useNavigate()
  const today = todayIso()

  const [kind, setKind] = useState<ReportPeriodKind>("4w")
  const [custom, setCustom] = useState<ReportRange>(() => reportRangeFor("4w", today))
  const [sections, setSections] = useState<ReportSectionKey[]>(DEFAULT_REPORT_SECTIONS)
  const [summary, setSummary] = useState("")
  const [context, setContext] = useState<AthleteReportContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [teamConfirm, setTeamConfirm] = useState(false)
  const [teamBusy, setTeamBusy] = useState(false)

  const season = context?.season ?? null
  const range = useMemo(() => (kind === "custom" ? custom : reportRangeFor(kind, today, season)), [custom, kind, season, today])
  const rangeProblem = reportRangeProblem(range, today)
  const health = includesHealth(sections)

  // Starting from an earlier report.
  useEffect(() => {
    if (!copyFrom) return
    let cancelled = false
    void getAthleteReport(copyFrom).then((result) => {
      if (cancelled || !result.ok) return
      setSections(result.data.sections)
      setKind("custom")
      setCustom(nextReportRange(result.data.period, todayIso()))
      setCopied(reportRangeText(result.data.period))
    })
    return () => {
      cancelled = true
    }
  }, [copyFrom])

  const rangeKey = `${range.from}|${range.to}`
  useEffect(() => {
    if (rangeProblem) return
    let cancelled = false
    setRefreshing(true)
    const [from, to] = rangeKey.split("|")
    void loadAthleteReportContext(athleteId, { from, to }, { health }).then((result) => {
      if (cancelled) return
      setRefreshing(false)
      if (result.ok) {
        setContext(result.data)
        setLoadError(null)
      } else {
        setLoadError(result.error.message)
      }
    })
    return () => {
      cancelled = true
    }
  }, [athleteId, health, rangeKey, rangeProblem])

  const snapshot = useMemo(() => (context ? buildAthleteReportSnapshot(context.source, { range, sections, summary, today }) : null), [context, range, sections, summary, today])

  const backTo = `/coach/athletes/${athleteId}`
  if (!context && !loadError) return <ScreenSkeleton />
  if (!context || !snapshot) {
    return (
      <Screen>
        <ScreenHeader back={{ to: backTo, label: "Athlete" }} title="New report" />
        <Notice tone="error">Could not load this athlete: {loadError}</Notice>
      </Screen>
    )
  }

  const { athlete } = context.source
  const first = athlete.name.split(" ")[0] || athlete.name
  const teamId = context.teamId

  const toggle = (key: ReportSectionKey, on: boolean) => setSections((current) => cleanReportSections(on ? [...current, key] : current.filter((item) => item !== key)))

  const save = async () => {
    if (rangeProblem) return
    setSaving(true)
    setSaveError(null)
    const result = await saveAthleteReport({ athleteId, range, sections, summary, snapshot })
    setSaving(false)
    if (!result.ok) {
      setSaveError(result.error.message)
      return
    }
    notify("Report saved")
    navigate(`/coach/athletes/${athleteId}/report/${result.data.reportId}`, { replace: true })
  }

  const makeTeamDrafts = async () => {
    if (!teamId || rangeProblem) return
    setTeamBusy(true)
    const roster = await getTeamRoster(teamId)
    if (!roster.ok) {
      setTeamBusy(false)
      setTeamConfirm(false)
      notifyError(roster.error.message)
      return
    }
    const result = await createTeamReportDrafts(
      roster.data.athletes.map((item) => item.id),
      range,
      sections,
    )
    setTeamBusy(false)
    setTeamConfirm(false)
    if (!result.ok || result.data.made.length === 0) {
      notifyError(result.ok ? "No drafts could be made." : result.error.message)
      return
    }
    const names = new Map(roster.data.athletes.map((item) => [item.id, item.name]))
    const queue = result.data.made.map((item) => ({ ...item, name: names.get(item.athleteId) ?? "Athlete" }))
    saveReportQueue(queue)
    notify(`${queue.length} ${queue.length === 1 ? "draft" : "drafts"} made${result.data.failed.length > 0 ? `, ${result.data.failed.length} could not be made` : ""}`)
    // Start with this athlete when they are in the team, otherwise the first.
    const start = queue.find((item) => item.athleteId === athleteId) ?? queue[0]
    navigate(`/coach/athletes/${start.athleteId}/report/${start.reportId}`)
  }

  const ordinary = REPORT_SECTIONS.filter((section) => !section.health && section.key !== "summary")
  const healthSections = REPORT_SECTIONS.filter((section) => section.health)

  return (
    <Screen>
      <ScreenHeader
        back={{ to: backTo, label: athlete.name }}
        title="New report"
        lede={`About ${athlete.name}${athlete.teamName ? `, ${athlete.teamName}` : ""}. Saving keeps the report exactly as it is in the preview.`}
        actions={
          <>
            <Button onClick={() => printPage()}>Print or save as PDF</Button>
            <Button variant="primary" disabled={saving || Boolean(rangeProblem)} onClick={() => void save()}>
              {saving ? "Saving..." : "Save report"}
            </Button>
          </>
        }
      />

      {copied ? <Notice tone="info">Started from the report for {copied}: the same sections, the period after it. The summary is yours to write.</Notice> : null}
      {saveError ? <Notice tone="error">Could not save the report: {saveError}</Notice> : null}
      {loadError ? <Notice tone="error">Could not load the latest data: {loadError}</Notice> : null}

      <Split
        className="lg:[&>div:first-child]:flex-[1_1_0%] lg:[&>div:last-child]:flex-[1.45_1_0%]"
        main={
          <>
            <Section title="Period" hint={rangeProblem ?? `${reportRangeText(range)}${kind === "season" && season ? `, ${season.name}` : ""}`}>
              <Choices label="Period" hideLabel value={kind} onChange={setKind} columns={2} options={REPORT_PERIOD_OPTIONS} />
              {kind === "custom" ? <DateRangeFields value={custom} onChange={setCustom} max={today} /> : null}
              {kind === "season" && !season ? <p className="text-[0.9375rem] text-sk-mute">The club has no season set for today, so this is the calendar year so far.</p> : null}
            </Section>

            <Section title="Your summary" hint={`What you want ${first}${context.isMinor ? " and their parent or guardian" : ""} to take from this period.`}>
              <Field label="Summary" hint={`${summary.trim().length} of ${REPORT_SUMMARY_MAX} characters. You can change it until the report is shared.`}>
                <Textarea rows={9} maxLength={REPORT_SUMMARY_MAX} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="How the period went, what improved, what to work on next." />
              </Field>
            </Section>

            <Section title="What to include" hint="Your private coach notes are never part of a report.">
              <List aria-label="Sections to include">
                {ordinary.map((section) => (
                  <CheckRow key={section.key} checked={sections.includes(section.key)} onChange={(on) => toggle(section.key, on)} title={section.label} subtitle={section.detail} />
                ))}
              </List>
            </Section>

            <Section title="Health information" hint={HEALTH_CONSENT_LINE} data-report-health>
              <List aria-label="Health sections to include">
                {healthSections.map((section) => (
                  <CheckRow key={section.key} checked={sections.includes(section.key)} onChange={(on) => toggle(section.key, on)} title={section.label} subtitle={section.detail} />
                ))}
              </List>
            </Section>

            {teamId ? (
              <Section title="The whole team" hint="Make a draft for every athlete on the team with this period and these sections, then write the summaries one after another.">
                {teamConfirm ? (
                  <InlineConfirm
                    question={`Make a draft report for each athlete on ${athlete.teamName ?? "the team"}, for ${reportRangeText(range)}?`}
                    confirmLabel={teamBusy ? "Making drafts..." : "Make drafts"}
                    cancelLabel="Cancel"
                    busy={teamBusy}
                    onConfirm={() => void makeTeamDrafts()}
                    onCancel={() => setTeamConfirm(false)}
                  />
                ) : (
                  <div>
                    <Button size="sm" disabled={Boolean(rangeProblem)} onClick={() => setTeamConfirm(true)}>
                      Create reports for the team
                    </Button>
                  </div>
                )}
              </Section>
            ) : null}
          </>
        }
        side={
          <Section title="Preview" meta={refreshing ? "Updating..." : undefined} hint="This is the sheet that is saved, shared and printed." data-report-preview>
            {refreshing && !snapshot ? <SkeletonRows rows={6} label="Loading the preview" /> : <ReportSheet snapshot={snapshot} />}
          </Section>
        }
      />

      <ReportPrintSheet snapshot={snapshot} />
    </Screen>
  )
}
