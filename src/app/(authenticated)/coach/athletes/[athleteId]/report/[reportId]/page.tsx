"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { CopyLinkButton } from "@/components/coach/add-athletes-dialog"
import { reportQueuePosition } from "@/components/reports/report-queue"
import { ReportPrintSheet, ReportSheet } from "@/components/reports/report-sheet"
import {
  ActionRow,
  Button,
  Choices,
  Dialog,
  Field,
  InlineConfirm,
  Input,
  LinkButton,
  List,
  ListRow,
  Notice,
  RowMenu,
  Screen,
  ScreenHeader,
  ScreenSkeleton,
  Section,
  Split,
  StatusDot,
  StatusText,
  Textarea,
  notify,
  notifyError,
  printPage,
  type StateTone,
} from "@/components/sk"
import { loadCoachAthleteDetail } from "@/lib/data/coach/athlete-detail-data"
import {
  HEALTH_CONSENT_LINE,
  includesHealth,
  REPORT_LINK_DEFAULT_DAYS,
  REPORT_SUMMARY_MAX,
  reportDayText,
  reportRangeText,
  type ReportLinkDays,
  type ReportLinkState,
} from "@/lib/data/reports/athlete-report"
import {
  createAthleteReportLink,
  deleteAthleteReport,
  getAthleteReport,
  revokeAthleteReportLink,
  shareAthleteReportWithAthlete,
  updateAthleteReportSummary,
  type AthleteReport,
  type ReportLink,
} from "@/lib/data/reports/athlete-report-data"

const LINK_STATE: Record<ReportLinkState, { label: string; tone: StateTone }> = {
  active: { label: "Works", tone: "green" },
  expired: { label: "Ended", tone: "neutral" },
  revoked: { label: "Stopped", tone: "neutral" },
}

const LINK_DAY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
]

function dayOf(timestamp: string) {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function linkLine(link: ReportLink) {
  const opened = link.openCount === 0 ? "Not opened yet" : `Opened ${link.openCount} ${link.openCount === 1 ? "time" : "times"}${link.lastOpenedAt ? `, last on ${dayOf(link.lastOpenedAt)}` : ""}`
  const ends = link.state === "revoked" ? `Stopped ${link.revokedAt ? dayOf(link.revokedAt) : ""}`.trim() : link.state === "expired" ? `Ended ${dayOf(link.expiresAt)}` : `Works until ${dayOf(link.expiresAt)}`
  return `${ends}. ${opened}.`
}

type Guardian = { name: string | null; email: string | null }

function NewLinkDialog({
  open,
  onOpenChange,
  report,
  guardian,
  onMade,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: AthleteReport
  guardian: Guardian | null
  onMade: () => void
}) {
  const [madeFor, setMadeFor] = useState(guardian?.name ?? "")
  const [days, setDays] = useState(String(REPORT_LINK_DEFAULT_DAYS))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<{ url: string; madeFor: string; expiresAt: string } | null>(null)
  const athleteName = report.snapshot.athlete.name
  const health = includesHealth(report.sections)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await createAthleteReportLink(report.id, madeFor, Number(days) as ReportLinkDays)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setMade({ url: result.data.url, madeFor: result.data.link.madeFor, expiresAt: result.data.link.expiresAt })
    onMade()
  }

  const mailto = made && guardian?.email
    ? `mailto:${encodeURIComponent(guardian.email)}?subject=${encodeURIComponent(`Report about ${athleteName}`)}&body=${encodeURIComponent(
        `Hello${made.madeFor ? ` ${made.madeFor}` : ""},\n\nHere is my report about ${athleteName} for ${reportRangeText(report.period)}. The link is private and works until ${dayOf(made.expiresAt)}:\n\n${made.url}\n\n${report.snapshot.coachName}`,
      )}`
    : null

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={made ? "Link made" : "Make a private link"}
      description={made ? undefined : `Whoever has the link can read this report about ${athleteName} without signing in. Nothing else about the club is shown.`}
    >
      {made ? (
        <div className="flex flex-col gap-4" data-report-link-made>
          <Notice tone="success">
            For {made.madeFor}, until {dayOf(made.expiresAt)}
            <span className="mt-0.5 block font-normal">Copy it now. For safety it is not stored, so it cannot be shown again. You can stop it at any time.</span>
          </Notice>
          <Field label="Private link">
            <Input readOnly value={made.url} onFocus={(event) => event.currentTarget.select()} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <CopyLinkButton text={made.url} variant="primary" />
            {mailto ? (
              <a href={mailto} className="sk-link inline-flex min-h-11 items-center px-1 text-[0.9375rem]">
                Email it to {guardian?.email}
              </a>
            ) : null}
            <Button variant="quiet" size="sm" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
          {mailto ? <p className="text-sm text-sk-mute">Email opens your own mail app with the link filled in. SKTR Coach does not send it for you.</p> : null}
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <Field label="Who is it for" hint="Shown beside the link so you know who has it. For example: Dana Reid, mother.">
            <Input required maxLength={120} value={madeFor} onChange={(event) => setMadeFor(event.target.value)} />
          </Field>
          <Choices label="The link works for" value={days} onChange={setDays} columns={3} options={LINK_DAY_OPTIONS} />
          {health ? <Notice tone="warning">This report includes health information. {HEALTH_CONSENT_LINE.replace("This is health information. ", "")}</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy || !madeFor.trim()}>
              {busy ? "Making..." : "Make link"}
            </Button>
            <Button variant="quiet" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

/** A saved report: read it, change the summary until it is shared, share it, print it, duplicate or delete it. */
export default function CoachAthleteReportPage() {
  const { athleteId = "", reportId = "" } = useParams()
  const navigate = useNavigate()
  const [report, setReport] = useState<AthleteReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [athlete, setAthlete] = useState<{ hasLogin: boolean; guardian: Guardian | null } | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<"share" | "delete" | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkKey, setLinkKey] = useState(0)

  const load = useCallback(async () => {
    const result = await getAthleteReport(reportId)
    if (result.ok) {
      setReport(result.data)
      setError(null)
    } else {
      setError(result.error.message)
    }
    return result
  }, [reportId])

  useEffect(() => {
    setReport(null)
    setEditing(false)
    void load().then((result) => {
      // A draft with nothing written yet opens ready to write.
      if (result.ok && result.data.canEdit && !result.data.summary) {
        setDraft("")
        setEditing(true)
      }
    })
  }, [load])

  useEffect(() => {
    let cancelled = false
    void loadCoachAthleteDetail(athleteId).then((result) => {
      if (cancelled || !result.ok) return
      const details = result.data.privateDetails
      setAthlete({ hasLogin: result.data.athlete.hasLogin, guardian: details && (details.guardianName || details.guardianEmail) ? { name: details.guardianName, email: details.guardianEmail } : null })
    })
    return () => {
      cancelled = true
    }
  }, [athleteId])

  const backTo = `/coach/athletes/${athleteId}`
  if (!report && !error) return <ScreenSkeleton />
  if (!report) {
    return (
      <Screen>
        <ScreenHeader back={{ to: backTo, label: "Athlete" }} title="Report" />
        <Notice tone="error">{error}</Notice>
      </Screen>
    )
  }

  const name = report.snapshot.athlete.name
  const first = name.split(" ")[0] || name
  const health = includesHealth(report.sections)
  const queue = reportQueuePosition(report.id)
  const shared = Boolean(report.sharedWithAthleteAt)
  const activeLinks = report.links.filter((link) => link.state === "active").length

  const saveSummary = async () => {
    setBusy(true)
    const result = await updateAthleteReportSummary(report.id, draft)
    setBusy(false)
    if (!result.ok) {
      notifyError(result.error.message)
      return
    }
    setEditing(false)
    notify("Summary saved")
    void load()
  }

  const share = async () => {
    setBusy(true)
    const result = await shareAthleteReportWithAthlete(report.id)
    setBusy(false)
    setConfirm(null)
    if (!result.ok) {
      notifyError(result.error.message)
      return
    }
    notify(`Shared with ${first}`)
    setEditing(false)
    void load()
  }

  const remove = async () => {
    setBusy(true)
    const result = await deleteAthleteReport(report.id)
    setBusy(false)
    if (!result.ok) {
      setConfirm(null)
      notifyError(result.error.message)
      return
    }
    notify("Report deleted")
    navigate(backTo, { replace: true })
  }

  const revoke = async (linkId: string) => {
    setBusy(true)
    const result = await revokeAthleteReportLink(linkId)
    setBusy(false)
    setRevoking(null)
    if (!result.ok) {
      notifyError(result.error.message)
      return
    }
    notify("Link stopped")
    void load()
  }

  const status = shared
    ? `Shared with ${first} on ${dayOf(report.sharedWithAthleteAt as string)}`
    : report.links.length > 0
      ? `Shared by link${activeLinks > 0 ? "" : " (no link works now)"}`
      : "Not shared yet"

  return (
    <Screen>
      <ScreenHeader
        back={{ to: backTo, label: name }}
        fact={queue ? `Draft ${queue.index + 1} of ${queue.total}` : undefined}
        title={`Report, ${reportRangeText(report.period)}`}
        lede={
          <>
            About {name}. Saved {dayOf(report.createdAt)} by {report.authorName}.
            <span className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.9375rem]" data-report-status>
              <StatusText tone={shared || activeLinks > 0 ? "green" : "neutral"}>{status}</StatusText>
            </span>
          </>
        }
        actions={
          <>
            {queue?.next ? <LinkButton to={`/coach/athletes/${queue.next.athleteId}/report/${queue.next.reportId}`}>Next: {queue.next.name}</LinkButton> : null}
            <Button onClick={() => printPage()}>Print or save as PDF</Button>
            <RowMenu
              label="More for this report"
              items={[
                { label: "Duplicate for the next period", onSelect: () => navigate(`/coach/athletes/${athleteId}/report?copy=${report.id}`) },
                { label: "Delete", onSelect: () => setConfirm("delete") },
              ]}
            />
          </>
        }
      />

      {confirm === "delete" ? (
        <InlineConfirm
          question={shared || report.links.length > 0 ? `Delete this report? ${first} and anyone with a link can no longer open it.` : "Delete this report?"}
          confirmLabel="Delete report"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

      <Split
        main={
          <>
            {editing ? (
              <Section title="Your summary" hint="You can change it until the report is shared.">
                <Field label="Summary" hint={`${draft.trim().length} of ${REPORT_SUMMARY_MAX} characters`}>
                  <Textarea rows={8} maxLength={REPORT_SUMMARY_MAX} value={draft} onChange={(event) => setDraft(event.target.value)} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => void saveSummary()}>
                    {busy ? "Saving..." : "Save summary"}
                  </Button>
                  <Button variant="quiet" size="sm" disabled={busy} onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </Section>
            ) : null}
            <Section
              aria-label="The report"
              title="The report"
              action={
                report.canEdit && !editing ? (
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => {
                      setDraft(report.summary)
                      setEditing(true)
                    }}
                  >
                    Edit summary
                  </Button>
                ) : undefined
              }
              hint={report.canEdit ? undefined : "Shared, so it can no longer be changed. Duplicate it to write a new one."}
            >
              <ReportSheet snapshot={editing ? { ...report.snapshot, summary: draft.trim() } : report.snapshot} />
            </Section>
          </>
        }
        side={
          <>
            <Section title={`Share with ${first}`} hint={`${first} sees it under Progress, read only, and can print it.`} data-report-share-athlete>
              {shared ? (
                <List aria-label="Shared in the app">
                  <ListRow leading={<StatusDot tone="green" />} title={`${first} can see it`} subtitle={`Since ${dayOf(report.sharedWithAthleteAt as string)}`} />
                </List>
              ) : athlete && !athlete.hasLogin ? (
                <p className="text-[0.9375rem] text-sk-mute">{first} has no login, so there is nothing to share in the app. Print it or make a link for a parent or guardian.</p>
              ) : confirm === "share" ? (
                <InlineConfirm
                  question={`Share with ${first}? They are told, and the report can no longer be changed.${health ? " It includes health information." : ""}`}
                  confirmLabel="Share"
                  cancelLabel="Not yet"
                  busy={busy}
                  onConfirm={() => void share()}
                  onCancel={() => setConfirm(null)}
                />
              ) : (
                <div>
                  <Button variant="primary" size="sm" disabled={editing} onClick={() => setConfirm("share")}>
                    Share with {first}
                  </Button>
                </div>
              )}
            </Section>

            <Section
              title="Share with a parent or guardian"
              hint="A private link that opens this report without signing in. It ends on its own and you can stop it."
              data-report-links
            >
              {health ? <Notice tone="warning">{HEALTH_CONSENT_LINE}</Notice> : null}
              {report.links.length > 0 ? (
                <List aria-label="Private links">
                  {report.links.map((link) => (
                    <ActionRow
                      key={link.id}
                      data-report-link={link.state}
                      title={link.madeFor}
                      subtitle={linkLine(link)}
                      trailing={<StatusText tone={LINK_STATE[link.state].tone}>{LINK_STATE[link.state].label}</StatusText>}
                      actions={link.state === "active" && revoking !== link.id ? <RowMenu label={`More for the link for ${link.madeFor}`} items={[{ label: "Stop this link", onSelect: () => setRevoking(link.id) }]} /> : undefined}
                      below={
                        revoking === link.id ? (
                          <InlineConfirm
                            question={`Stop the link for ${link.madeFor}? It stops working at once.`}
                            confirmLabel="Stop link"
                            busy={busy}
                            onConfirm={() => void revoke(link.id)}
                            onCancel={() => setRevoking(null)}
                          />
                        ) : undefined
                      }
                    />
                  ))}
                </List>
              ) : null}
              <div>
                <Button
                  size="sm"
                  disabled={editing}
                  onClick={() => {
                    setLinkKey((current) => current + 1)
                    setLinkOpen(true)
                  }}
                >
                  Make a link
                </Button>
              </div>
              {athlete?.guardian ? (
                <p className="text-sm text-sk-mute">
                  On file: {[athlete.guardian.name, athlete.guardian.email].filter(Boolean).join(", ")}. See <Link className="sk-link" to={`${backTo}?tab=details`}>Details</Link>.
                </p>
              ) : null}
            </Section>

            <Section title="Made on" hint={`The numbers are as they were on ${reportDayText(report.snapshot.savedOn)}. They do not change when ${first} trains or competes again.`}>
              <div>
                <LinkButton size="sm" variant="quiet" to={`/coach/athletes/${athleteId}/report?copy=${report.id}`}>
                  Duplicate for the next period
                </LinkButton>
              </div>
            </Section>
          </>
        }
      />

      <NewLinkDialog key={linkKey} open={linkOpen} onOpenChange={setLinkOpen} report={report} guardian={athlete?.guardian ?? null} onMade={() => void load()} />
      <ReportPrintSheet snapshot={report.snapshot} />
    </Screen>
  )
}
