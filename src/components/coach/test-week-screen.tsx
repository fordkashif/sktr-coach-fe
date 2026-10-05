"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CaretRight,
  PencilSimple,
  Plus,
  Timer,
  Trash,
  Trophy,
} from "@phosphor-icons/react"
import { EmptyState, Initials, Meter, PageHeader, Panel, Segmented, Stat, Tag, type TagTone } from "@/components/sk"
import { cn } from "@/lib/utils"

/**
 * Test weeks: the one presentation used by both backend modes.
 * The mock client and the Supabase client each supply rows and handlers;
 * everything a coach sees and clicks lives here so the two cannot drift.
 */

export type TestUnit = "time" | "distance" | "weight" | "height" | "score"
export type TestWeekStatus = "draft" | "published" | "closed"
export type ResultChange = "up" | "down" | "same"

export type TestWeekRow = {
  id: string
  name: string
  teamId: string | null
  startDate: string
  endDate: string
  status: TestWeekStatus
  isArchived: boolean
  testCount: number
  /** Athletes on the assigned team. Null when the team is unknown. */
  athleteCount: number | null
  /** Athletes who have submitted at least one result. */
  submittedCount: number
}

export type TestWeekTeamOption = { id: string; name: string; athleteCount: number }

export type TestWeekTest = { id: string; name: string; unit: TestUnit; dayIndex: number }

export type TestWeekAthleteRow = {
  athleteId: string
  name: string
  primaryEvent: string | null
  /** False when the athlete has since left the assigned team. */
  onRoster: boolean
  submittedAt: string | null
  results: Record<string, { value: string; numeric: number | null; change: ResultChange | null }>
}

export type TestWeekDetail = { tests: TestWeekTest[]; athletes: TestWeekAthleteRow[] }

export type TestWeekSaveInput = {
  id: string | null
  name: string
  teamId: string
  startDate: string
  endDate: string
  publish: boolean
  tests: Array<{ id: string | null; name: string; unit: TestUnit; dayIndex: number; scheduledDate: string }>
}

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; message: string }

export type TestWeekScreenProps = {
  weeks: TestWeekRow[]
  teams: TestWeekTeamOption[]
  /** Set for a coach who only works with one team. Hides the team picker. */
  lockedTeamId: string | null
  isLoading: boolean
  loadError: string | null
  /** Tests a new week starts with on day 1, by team. */
  starterTests: (teamId: string) => Array<{ name: string; unit: TestUnit }>
  loadDetail: (testWeekId: string) => Promise<ActionResult<TestWeekDetail>>
  onSave: (input: TestWeekSaveInput) => Promise<ActionResult<{ id: string }>>
  onPublish: (testWeekId: string) => Promise<ActionResult>
  onSetArchived: (testWeekId: string, archived: boolean) => Promise<ActionResult>
  onDelete: (testWeekId: string) => Promise<ActionResult>
}

type View = { kind: "list" } | { kind: "detail"; id: string } | { kind: "builder"; id: string | null }
type DraftTest = { key: string; id: string | null; name: string; unit: TestUnit; dayIndex: number }
type Draft = { id: string | null; name: string; teamId: string; startDate: string; endDate: string; tests: DraftTest[] }

const UNIT_OPTIONS: Array<{ value: TestUnit; label: string }> = [
  { value: "time", label: "Time" },
  { value: "distance", label: "Distance" },
  { value: "weight", label: "Weight" },
  { value: "height", label: "Height" },
  { value: "score", label: "Score" },
]

const QUICK_TESTS: Array<{ name: string; unit: TestUnit }> = [
  { name: "30m", unit: "time" },
  { name: "Flying 30m", unit: "time" },
  { name: "150m", unit: "time" },
  { name: "Squat 1RM", unit: "weight" },
  { name: "CMJ", unit: "height" },
  { name: "Long Jump", unit: "distance" },
  { name: "Shot Put", unit: "distance" },
]

const MAX_DAYS = 31

function toInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseDate(iso: string) {
  const date = new Date(`${iso}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function addDays(iso: string, days: number) {
  const date = parseDate(iso) ?? new Date()
  date.setDate(date.getDate() + days)
  return toInputDate(date)
}

function dayCount(startDate: string, endDate: string) {
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  if (!start || !end || end < start) return 1
  return Math.min(Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1, MAX_DAYS)
}

function shortDate(iso: string, withYear = false) {
  const date = parseDate(iso)
  if (!date) return iso
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) })
}

function weekdayDate(iso: string) {
  const date = parseDate(iso)
  if (!date) return iso
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function dateWindow(startDate: string, endDate: string) {
  if (startDate === endDate) return shortDate(startDate, true)
  return `${shortDate(startDate)} to ${shortDate(endDate, true)}`
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

function unitLabel(unit: TestUnit) {
  return UNIT_OPTIONS.find((option) => option.value === unit)?.label ?? unit
}

function makeKey() {
  return `t-${Math.random().toString(36).slice(2, 10)}`
}

function statusOf(week: Pick<TestWeekRow, "status" | "isArchived">): { label: string; tone: TagTone } {
  if (week.isArchived) return { label: "Archived", tone: "plain" }
  if (week.status === "published") return { label: "Published", tone: "green" }
  if (week.status === "closed") return { label: "Closed", tone: "plain" }
  return { label: "Draft", tone: "yellow" }
}

function numericOf(result: { value: string; numeric: number | null }) {
  if (result.numeric !== null && Number.isFinite(result.numeric)) return result.numeric
  const parsed = Number.parseFloat(result.value.replace(",", ".").replace(/[^\d.-]/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
      {children}
    </p>
  )
}

function Change({ change }: { change: ResultChange | null }) {
  if (change === "up") return <ArrowUp className="size-4 shrink-0 text-sk-green" weight="bold" aria-label="Improved" />
  if (change === "down") return <ArrowDown className="size-4 shrink-0 text-sk-coral" weight="bold" aria-label="Dropped" />
  return null
}

export function TestWeekScreen(props: TestWeekScreenProps) {
  const { weeks, teams, lockedTeamId, isLoading, loadError } = props
  const [view, setView] = useState<View>({ kind: "list" })
  const [listFilter, setListFilter] = useState<"active" | "archived">("active")
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [detailState, setDetailState] = useState<{ id: string; detail: TestWeekDetail | null; error: string | null } | null>(null)
  const [detailVersion, setDetailVersion] = useState(0)

  const teamName = (teamId: string | null) => teams.find((team) => team.id === teamId)?.name ?? "No team"
  const lockedTeam = teams.find((team) => team.id === lockedTeamId) ?? null
  const inSubview = view.kind !== "list"

  // The app shell swaps the mobile tab bar for a Back button while a detail or builder is open.
  useEffect(() => {
    const target = window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }
    target.__PACELAB_MOBILE_DETAIL_MODE = inSubview
    window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: inSubview } }))
    return () => {
      target.__PACELAB_MOBILE_DETAIL_MODE = false
      window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: false } }))
    }
  }, [inSubview])

  const goTo = (next: View) => {
    setActionError(null)
    if (next.kind !== "detail") setNotice(null)
    setView(next)
    window.scrollTo?.({ top: 0 })
    document.querySelector("main")?.scrollTo?.({ top: 0 })
  }

  useEffect(() => {
    if (!inSubview) return
    const handleBack = () => {
      setActionError(null)
      setNotice(null)
      setView((current) => (current.kind === "builder" && current.id ? { kind: "detail", id: current.id } : { kind: "list" }))
    }
    window.addEventListener("pacelab:mobile-detail-back", handleBack)
    return () => window.removeEventListener("pacelab:mobile-detail-back", handleBack)
  }, [inSubview])

  const detailId = view.kind === "detail" ? view.id : null
  const { loadDetail } = props
  useEffect(() => {
    if (!detailId) return
    let cancelled = false
    setDetailState((current) => (current?.id === detailId ? current : { id: detailId, detail: null, error: null }))
    void loadDetail(detailId).then((result) => {
      if (cancelled) return
      setDetailState(
        result.ok ? { id: detailId, detail: result.data, error: null } : { id: detailId, detail: null, error: result.message },
      )
    })
    return () => {
      cancelled = true
    }
  }, [detailId, detailVersion, loadDetail])

  const openNew = () => {
    const teamId = lockedTeamId ?? teams[0]?.id ?? ""
    const today = toInputDate(new Date())
    setDraft({
      id: null,
      name: "",
      teamId,
      startDate: today,
      endDate: addDays(today, 4),
      tests: props.starterTests(teamId).map((test) => ({ key: makeKey(), id: null, name: test.name, unit: test.unit, dayIndex: 0 })),
    })
    goTo({ kind: "builder", id: null })
  }

  const openEdit = (week: TestWeekRow, detail: TestWeekDetail) => {
    setDraft({
      id: week.id,
      name: week.name,
      teamId: week.teamId ?? lockedTeamId ?? teams[0]?.id ?? "",
      startDate: week.startDate,
      endDate: week.endDate,
      tests: detail.tests.map((test) => ({ key: test.id, id: test.id, name: test.name, unit: test.unit, dayIndex: test.dayIndex })),
    })
    goTo({ kind: "builder", id: week.id })
  }

  const run = async (action: () => Promise<ActionResult<unknown>>, after: () => void) => {
    setBusy(true)
    setActionError(null)
    const result = await action()
    setBusy(false)
    if (!result.ok) {
      setActionError(result.message)
      return
    }
    after()
  }

  /* ------------------------------ List ------------------------------ */

  if (view.kind === "list") {
    const activeWeeks = weeks.filter((week) => !week.isArchived)
    const archivedWeeks = weeks.filter((week) => week.isArchived)
    const shownWeeks = listFilter === "archived" && archivedWeeks.length > 0 ? archivedWeeks : activeWeeks
    const openWeeks = activeWeeks.filter((week) => week.status === "published")
    const draftWeeks = activeWeeks.filter((week) => week.status === "draft")
    const scope = lockedTeam ? ` for ${lockedTeam.name}` : ""
    const lede = isLoading
      ? "Loading your test weeks."
      : activeWeeks.length === 0
        ? `No test weeks${scope} yet. Set one up and athletes can start submitting results.`
        : `${plural(activeWeeks.length, "test week")}${scope}. ${openWeeks.length} published${draftWeeks.length > 0 ? `, ${plural(draftWeeks.length, "draft")}` : ""}.`

    return (
      <div className="sk-page">
        {loadError ? <Alert>Could not load test weeks: {loadError}</Alert> : null}
        {actionError ? <Alert>{actionError}</Alert> : null}

        <PageHeader
          title="Test weeks"
          lede={lede}
          actions={
            <button type="button" className="sk-btn sk-btn-primary" onClick={openNew} disabled={isLoading}>
              <Plus className="size-5" weight="bold" />
              New test week
            </button>
          }
        />

        {archivedWeeks.length > 0 ? (
          <Segmented
            label="Show"
            value={listFilter}
            onChange={setListFilter}
            options={[
              { value: "active", label: `Active (${activeWeeks.length})` },
              { value: "archived", label: `Archived (${archivedWeeks.length})` },
            ]}
          />
        ) : null}

        {isLoading ? (
          <Panel>
            <p className="text-sm font-semibold text-sk-mute">Loading test weeks...</p>
          </Panel>
        ) : shownWeeks.length === 0 ? (
          <EmptyState
            icon={<Timer className="size-6" weight="fill" />}
            title="No test weeks yet"
            body="A test week is a set of tests, such as 30m or squat 1RM, that your athletes complete over a few days. Results land here as they submit."
            action={
              <button type="button" className="sk-btn sk-btn-ink sk-btn-sm" onClick={openNew}>
                Set up a test week
              </button>
            }
          />
        ) : (
          <Panel flush>
            <ul>
              {shownWeeks.map((week) => {
                const status = statusOf(week)
                const total = week.athleteCount ?? 0
                const showProgress = week.status !== "draft" && total > 0
                return (
                  <li key={week.id} className="border-b border-sk-line last:border-b-0">
                    <button
                      type="button"
                      onClick={() => goTo({ kind: "detail", id: week.id })}
                      className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sk-blue sm:grid-cols-[minmax(0,1fr)_minmax(150px,220px)_auto] sm:px-6"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-lg font-bold tracking-[-0.01em] text-sk-ink group-hover:text-sk-blue">{week.name}</span>
                        <span className="mt-0.5 block text-sm text-sk-mute">
                          {teamName(week.teamId)}, {dateWindow(week.startDate, week.endDate)}
                        </span>
                        <span className="block text-sm text-sk-mute">
                          {plural(week.testCount, "test")}
                          {week.athleteCount !== null ? `, ${plural(week.athleteCount, "athlete")}` : ""}
                        </span>
                      </span>
                      <span className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                        {showProgress ? (
                          <>
                            <span className="mb-1.5 flex items-baseline justify-between text-sm">
                              <span className="text-sk-mute">Submitted</span>
                              <span className="font-bold tabular-nums text-sk-ink">
                                {week.submittedCount} of {total}
                              </span>
                            </span>
                            <Meter value={(week.submittedCount / total) * 100} tone={week.submittedCount >= total ? "green" : "blue"} />
                          </>
                        ) : (
                          <span className="text-sm text-sk-mute">
                            {week.status === "draft" ? "Not visible to athletes yet" : "No athletes on this team"}
                          </span>
                        )}
                      </span>
                      <span className="col-start-2 row-start-1 flex items-center gap-2 sm:col-start-auto sm:row-start-auto">
                        <Tag tone={status.tone}>{status.label}</Tag>
                        <CaretRight className="size-4 text-sk-mute" weight="bold" aria-hidden />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Panel>
        )}
      </div>
    )
  }

  /* ----------------------------- Builder ---------------------------- */

  if (view.kind === "builder" && draft) {
    const editingWeek = draft.id ? (weeks.find((week) => week.id === draft.id) ?? null) : null
    return (
      <Builder
        key={draft.id ?? "new"}
        draft={draft}
        setDraft={(update) => {
          setActionError(null)
          setDraft((current) => (current ? update(current) : current))
        }}
        editingWeek={editingWeek}
        teams={teams}
        lockedTeam={lockedTeam}
        busy={busy}
        error={actionError}
        setError={setActionError}
        onCancel={() => goTo(draft.id ? { kind: "detail", id: draft.id } : { kind: "list" })}
        onSubmit={(input) =>
          void run(
            async () => {
              const result = await props.onSave(input)
              if (result.ok) {
                const athletes = teams.find((team) => team.id === input.teamId)?.athleteCount ?? 0
                setNotice(
                  input.publish && editingWeek?.status !== "published"
                    ? `Test week published to ${plural(athletes, "athlete")}.`
                    : input.id
                      ? "Changes saved."
                      : "Draft saved. Publish it when you are ready for athletes to see it.",
                )
                setDetailVersion((version) => version + 1)
                setView({ kind: "detail", id: result.data.id })
                document.querySelector("main")?.scrollTo?.({ top: 0 })
              }
              return result
            },
            () => {},
          )
        }
      />
    )
  }

  /* ------------------------------ Detail ---------------------------- */

  const week = view.kind === "detail" ? (weeks.find((candidate) => candidate.id === view.id) ?? null) : null
  const backButton = (
    <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm -ml-3 hidden lg:inline-flex" onClick={() => goTo({ kind: "list" })}>
      <ArrowLeft className="size-4" weight="bold" />
      All test weeks
    </button>
  )

  if (!week) {
    return (
      <div className="sk-page">
        {backButton}
        <PageHeader title="Test week" />
        {isLoading ? (
          <Panel>
            <p className="text-sm font-semibold text-sk-mute">Loading...</p>
          </Panel>
        ) : (
          <EmptyState
            title="This test week is not here any more"
            body="It may have been deleted, or it belongs to another team."
            action={
              <button type="button" className="sk-btn sk-btn-ink sk-btn-sm" onClick={() => goTo({ kind: "list" })}>
                Back to test weeks
              </button>
            }
          />
        )}
      </div>
    )
  }

  const status = statusOf(week)
  const detail = detailState?.id === week.id ? detailState.detail : null
  const detailError = detailState?.id === week.id ? detailState.error : null
  const isDraft = week.status === "draft" && !week.isArchived

  return (
    <div className="sk-page">
      {backButton}
      {actionError ? <Alert>{actionError}</Alert> : null}
      {notice ? (
        <p role="status" className="rounded-2xl bg-sk-green-tint px-4 py-3 text-sm font-semibold text-[#07673f]">
          {notice}
        </p>
      ) : null}

      <PageHeader
        title={week.name}
        lede={`${teamName(week.teamId)}, ${dateWindow(week.startDate, week.endDate)}.`}
        actions={
          <>
            {week.isArchived ? (
              <button
                type="button"
                className="sk-btn sk-btn-quiet"
                disabled={busy}
                onClick={() => void run(() => props.onSetArchived(week.id, false), () => setNotice("Restored from the archive."))}
              >
                Restore
              </button>
            ) : (
              <>
                {isDraft ? (
                  <button
                    type="button"
                    className="sk-btn sk-btn-primary"
                    disabled={busy || week.testCount === 0}
                    onClick={() =>
                      void run(
                        () => props.onPublish(week.id),
                        () => setNotice(`Test week published to ${plural(week.athleteCount ?? 0, "athlete")}.`),
                      )
                    }
                  >
                    Publish
                  </button>
                ) : null}
                <button type="button" className="sk-btn sk-btn-quiet" disabled={busy || !detail} onClick={() => detail && openEdit(week, detail)}>
                  <PencilSimple className="size-5" weight="bold" />
                  Edit
                </button>
                <button
                  type="button"
                  className="sk-btn sk-btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Archive "${week.name}"? Athletes will no longer see it.`)) return
                    void run(() => props.onSetArchived(week.id, true), () => goTo({ kind: "list" }))
                  }}
                >
                  <Archive className="size-5" weight="bold" />
                  Archive
                </button>
              </>
            )}
            <button
              type="button"
              className="sk-btn sk-btn-danger"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Delete "${week.name}" for good? Submitted results are deleted too. This cannot be undone.`)) return
                void run(() => props.onDelete(week.id), () => goTo({ kind: "list" }))
              }}
            >
              <Trash className="size-5" weight="bold" />
              Delete
            </button>
          </>
        }
      >
        <Tag tone={status.tone}>{status.label}</Tag>
      </PageHeader>

      {detailError ? <Alert>Could not load this test week: {detailError}</Alert> : null}

      {detail ? (
        <DetailBody week={week} detail={detail} />
      ) : detailError ? null : (
        <Panel>
          <p className="text-sm font-semibold text-sk-mute">Loading results...</p>
        </Panel>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function DetailBody({ week, detail }: { week: TestWeekRow; detail: TestWeekDetail }) {
  const [lens, setLens] = useState<"athlete" | "test">("athlete")
  const days = dayCount(week.startDate, week.endDate)
  const multiDay = new Set(detail.tests.map((test) => test.dayIndex)).size > 1
  const submitted = detail.athletes.filter((athlete) => athlete.submittedAt)
  const waiting = detail.athletes.filter((athlete) => !athlete.submittedAt && athlete.onRoster)
  const isDraft = week.status === "draft"

  const testsByDay = useMemo(() => {
    const groups = new Map<number, TestWeekTest[]>()
    for (const test of detail.tests) groups.set(test.dayIndex, [...(groups.get(test.dayIndex) ?? []), test])
    return [...groups.entries()].sort((left, right) => left[0] - right[0])
  }, [detail.tests])

  const byTest = detail.tests.map((test) => {
    let best: { athlete: string; value: string; numeric: number } | null = null
    let count = 0
    for (const athlete of detail.athletes) {
      const result = athlete.results[test.id]
      if (!result) continue
      count += 1
      const numeric = numericOf(result)
      if (numeric === null) continue
      if (!best || (test.unit === "time" ? numeric < best.numeric : numeric > best.numeric)) {
        best = { athlete: athlete.name, value: result.value, numeric }
      }
    }
    return { test, best, count }
  })

  return (
    <>
      <section aria-label="Progress" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat tone="blue" label="Submitted" value={submitted.length} hint={`of ${plural(detail.athletes.length, "athlete")}`} />
        <Stat
          tone={!isDraft && waiting.length > 0 ? "coral" : "plain"}
          label="Still to submit"
          value={isDraft ? 0 : waiting.length}
          hint={isDraft ? "Not published yet" : waiting.length === 0 ? "Everyone is in" : "Waiting on results"}
        />
        <Stat label="Tests" value={detail.tests.length} hint={multiDay ? "Across the week" : "All on one day"} />
        <Stat label="Days" value={days} hint={dateWindow(week.startDate, week.endDate)} />
      </section>

      <div className="space-y-5">
        <Panel
          title="Results"
          hint={isDraft ? undefined : `${submitted.length} of ${detail.athletes.length} submitted`}
          className="min-w-0"
          action={
            detail.athletes.length > 0 && detail.tests.length > 0 ? (
              <Segmented
                label="Results view"
                value={lens}
                onChange={setLens}
                options={[
                  { value: "athlete", label: "By athlete" },
                  { value: "test", label: "By test" },
                ]}
              />
            ) : null
          }
        >
          {detail.athletes.length === 0 ? (
            <EmptyState
              title="No athletes on this team yet"
              body="Invite athletes to the team and they will show up here, ready to submit."
              className="border-0 bg-sk-canvas"
            />
          ) : detail.tests.length === 0 ? (
            <EmptyState title="No tests yet" body="Edit this test week to add the tests athletes should complete." className="border-0 bg-sk-canvas" />
          ) : lens === "athlete" ? (
            <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
              <table className="w-full text-left" style={{ minWidth: `${220 + detail.tests.length * 96}px` }}>
                <thead>
                  <tr className="border-b border-sk-line text-sm text-sk-mute">
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Athlete
                    </th>
                    {detail.tests.map((test) => (
                      <th key={test.id} scope="col" className="px-2 py-2 text-right align-bottom font-semibold">
                        {test.name}
                        {multiDay ? <span className="block text-xs font-medium">Day {test.dayIndex + 1}</span> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.athletes.map((athlete) => (
                    <tr key={athlete.athleteId} className="border-b border-sk-line last:border-b-0">
                      <th scope="row" className="py-3.5 pr-4 font-normal">
                        <span className="flex items-center gap-3">
                          <Initials name={athlete.name} size="sm" />
                          <span className="min-w-0">
                            <span className="block whitespace-nowrap font-bold text-sk-ink">{athlete.name}</span>
                            <span className="block whitespace-nowrap text-sm text-sk-mute">
                              {athlete.submittedAt
                                ? `Submitted ${new Date(athlete.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                                : isDraft
                                  ? (athlete.primaryEvent ?? "Assigned")
                                  : "Not submitted"}
                              {athlete.onRoster ? "" : ", left the team"}
                            </span>
                          </span>
                        </span>
                      </th>
                      {detail.tests.map((test) => {
                        const result = athlete.results[test.id]
                        return (
                          <td key={test.id} className="px-2 py-3.5 text-right">
                            {result ? (
                              <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap font-semibold tabular-nums text-sk-ink">
                                {result.value}
                                <Change change={result.change} />
                              </span>
                            ) : (
                              <span className="text-sk-mute" aria-label="No result">
                                n/a
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
              <table className="w-full min-w-[480px] text-left">
                <thead>
                  <tr className="border-b border-sk-line text-sm text-sk-mute">
                    <th scope="col" className="py-2 pr-4 font-semibold">Test</th>
                    <th scope="col" className="px-2 py-2 font-semibold">Best mark</th>
                    <th scope="col" className="px-2 py-2 font-semibold">Leader</th>
                    <th scope="col" className="py-2 pl-2 text-right font-semibold">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {byTest.map(({ test, best, count }) => (
                    <tr key={test.id} className="border-b border-sk-line last:border-b-0">
                      <th scope="row" className="py-3.5 pr-4 font-normal">
                        <span className="block font-bold text-sk-ink">{test.name}</span>
                        <span className="block text-sm text-sk-mute">
                          {unitLabel(test.unit)}
                          {multiDay ? `, day ${test.dayIndex + 1}` : ""}
                        </span>
                      </th>
                      <td className="px-2 py-3.5">
                        {best ? (
                          <span className="inline-flex items-center gap-1.5 text-lg font-extrabold tabular-nums text-sk-ink">
                            <Trophy className="size-4 text-[#c48a00]" weight="fill" aria-hidden />
                            {best.value}
                          </span>
                        ) : (
                          <span className="text-sk-mute">n/a</span>
                        )}
                      </td>
                      <td className="px-2 py-3.5 font-semibold text-sk-ink">{best?.athlete ?? <span className="font-normal text-sk-mute">No results yet</span>}</td>
                      <td className="py-3.5 pl-2 text-right font-semibold tabular-nums text-sk-ink">
                        {count} of {detail.athletes.length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Tests by day" hint={plural(detail.tests.length, "test")} className="min-w-0">
          {testsByDay.length === 0 ? (
            <p className="text-sm text-sk-mute">Nothing scheduled yet.</p>
          ) : (
            <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
              {testsByDay.map(([dayIndex, tests]) => (
                <div key={dayIndex}>
                  <h3 className="sk-label">
                    Day {dayIndex + 1}, {weekdayDate(addDays(week.startDate, dayIndex))}
                  </h3>
                  <ul className="mt-1">
                    {tests.map((test) => (
                      <li key={test.id} className="sk-row py-2.5">
                        <span className="font-semibold text-sk-ink">{test.name}</span>
                        <span className="text-sm text-sk-mute">{unitLabel(test.unit)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */

function Builder({
  draft,
  setDraft,
  editingWeek,
  teams,
  lockedTeam,
  busy,
  error,
  setError,
  onCancel,
  onSubmit,
}: {
  draft: Draft
  setDraft: (update: (current: Draft) => Draft) => void
  editingWeek: TestWeekRow | null
  teams: TestWeekTeamOption[]
  lockedTeam: TestWeekTeamOption | null
  busy: boolean
  error: string | null
  setError: (message: string | null) => void
  onCancel: () => void
  onSubmit: (input: TestWeekSaveInput) => void
}) {
  const fieldId = useId()
  const [activeDay, setActiveDay] = useState(0)
  const focusKey = useRef<string | null>(null)
  const days = dayCount(draft.startDate, draft.endDate)
  const day = Math.min(activeDay, days - 1)
  const team = lockedTeam ?? teams.find((candidate) => candidate.id === draft.teamId) ?? null
  const isPublished = editingWeek?.status === "published"
  const hasResults = (editingWeek?.submittedCount ?? 0) > 0
  const dayTests = draft.tests.filter((test) => Math.min(test.dayIndex, days - 1) === day)
  const namedTests = draft.tests.filter((test) => test.name.trim())
  const usedDays = new Set(namedTests.map((test) => Math.min(test.dayIndex, days - 1))).size
  const quickAdds = QUICK_TESTS.filter(
    (quick) => !dayTests.some((test) => test.name.trim().toLowerCase() === quick.name.toLowerCase()),
  )

  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }))
  const patchTest = (key: string, next: Partial<DraftTest>) =>
    setDraft((current) => ({ ...current, tests: current.tests.map((test) => (test.key === key ? { ...test, ...next } : test)) }))
  const addTest = (seed?: { name: string; unit: TestUnit }) => {
    const key = makeKey()
    if (!seed) focusKey.current = key
    setDraft((current) => ({
      ...current,
      tests: [...current.tests, { key, id: null, name: seed?.name ?? "", unit: seed?.unit ?? "time", dayIndex: day }],
    }))
  }

  const submit = (publish: boolean) => {
    if (!draft.name.trim()) return setError("Give the test week a name.")
    if (!draft.teamId) return setError("Choose a team for this test week.")
    if (!parseDate(draft.startDate) || !parseDate(draft.endDate)) return setError("Set a start and end date.")
    if (draft.endDate < draft.startDate) return setError("The end date cannot be before the start date.")
    const span = Math.round((parseDate(draft.endDate)!.getTime() - parseDate(draft.startDate)!.getTime()) / 86_400_000) + 1
    if (span > MAX_DAYS) return setError(`A test week can run for ${MAX_DAYS} days at most.`)
    if (namedTests.length === 0) return setError("Add at least one test.")

    const seen = new Set<string>()
    const tests: TestWeekSaveInput["tests"] = []
    for (const test of namedTests) {
      const dayIndex = Math.min(test.dayIndex, days - 1)
      const signature = `${dayIndex}:${test.name.trim().toLowerCase()}`
      if (seen.has(signature)) {
        setActiveDay(dayIndex)
        return setError(`"${test.name.trim()}" is listed twice on day ${dayIndex + 1}. Rename or remove one.`)
      }
      seen.add(signature)
      tests.push({ id: test.id, name: test.name.trim(), unit: test.unit, dayIndex, scheduledDate: addDays(draft.startDate, dayIndex) })
    }

    setError(null)
    onSubmit({ id: draft.id, name: draft.name.trim(), teamId: draft.teamId, startDate: draft.startDate, endDate: draft.endDate, publish, tests })
  }

  return (
    <div className="sk-page">
      <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm -ml-3 hidden lg:inline-flex" onClick={onCancel}>
        <ArrowLeft className="size-4" weight="bold" />
        {draft.id ? "Back to results" : "All test weeks"}
      </button>

      <PageHeader
        title={draft.id ? "Edit test week" : "New test week"}
        lede="Name it, set the dates, then add the tests for each day."
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] xl:items-start">
        <Panel title="Details">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor={`${fieldId}-name`} className="sk-label block">
                Test week name
              </label>
              <input
                id={`${fieldId}-name`}
                className="sk-field"
                value={draft.name}
                placeholder="Week 4 testing"
                onChange={(event) => patch({ name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor={`${fieldId}-team`} className="sk-label block">
                Team
              </label>
              {lockedTeam ? (
                <p id={`${fieldId}-team`} className="flex h-11 items-center rounded-[14px] bg-sk-canvas px-3.5 font-semibold text-sk-ink">
                  {lockedTeam.name}
                </p>
              ) : (
                <select id={`${fieldId}-team`} className="sk-field" value={draft.teamId} onChange={(event) => patch({ teamId: event.target.value })}>
                  {teams.length === 0 ? <option value="">No teams yet</option> : null}
                  {teams.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-sm text-sk-mute">
                {team ? `Goes to the whole team, ${plural(team.athleteCount, "athlete")}.` : "Choose who this is for."}
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-start`} className="sk-label block">
                Start date
              </label>
              <input
                id={`${fieldId}-start`}
                type="date"
                className="sk-field"
                value={draft.startDate}
                onChange={(event) => patch({ startDate: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-end`} className="sk-label block">
                End date
              </label>
              <input
                id={`${fieldId}-end`}
                type="date"
                className="sk-field"
                value={draft.endDate}
                min={draft.startDate}
                onChange={(event) => patch({ endDate: event.target.value })}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Tests" hint="Pick a day, then add what athletes should complete on it." className="min-w-0">
          <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
            <div role="tablist" aria-label="Day" className="sk-seg">
              {Array.from({ length: days }, (_, index) => {
                const count = draft.tests.filter((test) => test.name.trim() && Math.min(test.dayIndex, days - 1) === index).length
                return (
                  <button
                    key={index}
                    type="button"
                    role="tab"
                    aria-selected={index === day}
                    data-active={index === day}
                    className="sk-seg-item whitespace-nowrap"
                    onClick={() => setActiveDay(index)}
                  >
                    Day {index + 1}
                    {count > 0 ? <span className="ml-1.5 tabular-nums text-sk-blue">{count}</span> : null}
                  </button>
                )
              })}
            </div>
          </div>

          <h3 className="sk-h3 mt-5">{weekdayDate(addDays(draft.startDate, day))}</h3>

          {dayTests.length === 0 ? (
            <p className="mt-3 rounded-2xl bg-sk-canvas px-4 py-4 text-sm text-sk-mute">
              Nothing on day {day + 1} yet. Add a test below, or leave it as a rest day.
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {dayTests.map((test, index) => (
                <li key={test.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
                  <input
                    className="sk-field"
                    aria-label={`Test ${index + 1} name`}
                    placeholder="Test name, for example 300m"
                    value={test.name}
                    autoFocus={focusKey.current === test.key}
                    onChange={(event) => patchTest(test.key, { name: event.target.value })}
                  />
                  <select
                    className="sk-field col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto"
                    aria-label={`Test ${index + 1} unit`}
                    value={test.unit}
                    onChange={(event) => patchTest(test.key, { unit: event.target.value as TestUnit })}
                  >
                    {UNIT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="sk-btn sk-btn-ghost w-11 px-0"
                    aria-label={`Remove ${test.name.trim() || `test ${index + 1}`}`}
                    onClick={() => setDraft((current) => ({ ...current, tests: current.tests.filter((item) => item.key !== test.key) }))}
                  >
                    <Trash className="size-5" weight="bold" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-sk-line pt-4">
            <button type="button" className="sk-btn sk-btn-ink sk-btn-sm" onClick={() => addTest()}>
              <Plus className="size-4" weight="bold" />
              Add test
            </button>
            {quickAdds.map((quick) => (
              <button key={quick.name} type="button" className="sk-btn sk-btn-quiet sk-btn-sm" onClick={() => addTest(quick)}>
                <Plus className="size-4" weight="bold" aria-hidden />
                <span className="sr-only">Add </span>
                {quick.name}
              </button>
            ))}
          </div>

          {hasResults ? (
            <p className="mt-4 rounded-2xl bg-sk-yellow-tint px-4 py-3 text-sm font-semibold text-[#7a5600]">
              {plural(editingWeek?.submittedCount ?? 0, "athlete has", "athletes have")} already submitted. Removing a test also removes its results.
            </p>
          ) : null}
        </Panel>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      <div className="flex flex-col gap-3 rounded-[20px] border border-sk-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <p className="text-sm text-sk-ink-2">
          <span className="font-bold text-sk-ink">{plural(namedTests.length, "test")}</span> over {plural(usedDays, "day")}
          {team ? ` for ${plural(team.athleteCount, "athlete")}` : ""}.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="sk-btn sk-btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {isPublished ? (
            <button type="button" className="sk-btn sk-btn-primary" onClick={() => submit(true)} disabled={busy}>
              {busy ? "Saving..." : "Save changes"}
            </button>
          ) : (
            <>
              <button type="button" className="sk-btn sk-btn-quiet" onClick={() => submit(false)} disabled={busy}>
                {draft.id ? "Save changes" : "Save draft"}
              </button>
              <button type="button" className={cn("sk-btn sk-btn-primary")} onClick={() => submit(true)} disabled={busy}>
                {busy ? "Publishing..." : "Publish test week"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
