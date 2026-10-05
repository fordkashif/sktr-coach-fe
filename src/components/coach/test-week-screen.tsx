import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, DownloadSimple, LockSimple, LockSimpleOpen, PencilSimple, Plus, Trash } from "@phosphor-icons/react"
import {
  Button,
  DataTable,
  EmptyState,
  EntryGrid,
  Field,
  FormActions,
  FormGrid,
  InlineConfirm,
  Input,
  List,
  ListRow,
  Mark,
  Notice,
  RowMenu,
  SaveState,
  Screen,
  ScreenHeader,
  Section,
  Segmented,
  Select,
  SkeletonRows,
  Split,
  Stat,
  StatStrip,
  StatusText,
  TableSub,
  Tabs,
  type DataTableColumn,
  type EntryGridCell,
  type SaveStateValue,
  type StateTone,
} from "@/components/sk"
import { PersonAvatar } from "@/components/account/person-avatar"
import { csvFileName, downloadCsv } from "@/lib/csv"
import { TEST_UNIT_META, checkTestResultEntry, entryTextFor, testWeekResultsCsvRows } from "@/lib/data/test-week/result-entry"

/**
 * Test weeks: the one presentation used by both backend modes.
 * The mock client and the Supabase client each supply rows and handlers;
 * everything a coach sees and clicks lives here so the two cannot drift.
 */
import { useCoachTeams, useTeamSwitchGuard } from "@/lib/coach-teams"

export type TestUnit = "time" | "distance" | "weight" | "height" | "score"
export type TestWeekStatus = "draft" | "published" | "closed"
export type ResultChange = "up" | "down" | "same"
export type ResultEnteredBy = "athlete" | "coach" | "club-admin"

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
  /** Athletes who have at least one result. */
  submittedCount: number
}

export type TestWeekTeamOption = { id: string; name: string; athleteCount: number }

export type TestWeekTest = { id: string; name: string; unit: TestUnit; dayIndex: number }

export type TestWeekResultValue = {
  value: string
  numeric: number | null
  change: ResultChange | null
  /** Who typed it. A coach or club admin can enter results for an athlete. */
  enteredBy?: ResultEnteredBy | null
}

export type TestWeekAthleteRow = {
  athleteId: string
  name: string
  primaryEvent: string | null
  /** False when the athlete has since left the assigned team. */
  onRoster: boolean
  submittedAt: string | null
  results: Record<string, TestWeekResultValue>
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

export type TestWeekResultInput = { testWeekId: string; testId: string; athleteId: string; unit: TestUnit; value: string }
export type TestWeekSavedResult = { value: string; numeric: number | null; enteredBy: ResultEnteredBy | null; submittedAt: string }

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; message: string }

export type TestWeekScreenProps = {
  weeks: TestWeekRow[]
  teams: TestWeekTeamOption[]
  /** Set when the team cannot be changed (a coach with one team). */
  lockedTeamId: string | null
  /** The coach's selected team: the list is for this team and new test weeks start on it. Null for club admins. */
  defaultTeamId?: string | null
  isLoading: boolean
  loadError: string | null
  /** Tests a new week starts with on day 1, by team. */
  starterTests: (teamId: string) => Array<{ name: string; unit: TestUnit }>
  loadDetail: (testWeekId: string) => Promise<ActionResult<TestWeekDetail>>
  onSave: (input: TestWeekSaveInput) => Promise<ActionResult<{ id: string }>>
  onPublish: (testWeekId: string) => Promise<ActionResult>
  /** Close a published week (athletes can no longer enter results) or reopen a closed one. */
  onSetOpen: (testWeekId: string, open: boolean) => Promise<ActionResult>
  /** One result typed by the coach for an athlete. An empty value removes it (data: null). */
  onSaveResult: (input: TestWeekResultInput) => Promise<ActionResult<TestWeekSavedResult | null>>
  onSetArchived: (testWeekId: string, archived: boolean) => Promise<ActionResult>
  onDelete: (testWeekId: string) => Promise<ActionResult>
}

type View = { kind: "list" } | { kind: "detail"; id: string } | { kind: "builder"; id: string | null }
type DraftTest = { key: string; id: string | null; name: string; unit: TestUnit; dayIndex: number }
type Draft = { id: string | null; name: string; teamId: string; startDate: string; endDate: string; tests: DraftTest[] }
type Lens = "athlete" | "test" | "enter"

const UNIT_OPTIONS: Array<{ value: TestUnit; label: string }> = [
  { value: "time", label: "Time (s)" },
  { value: "distance", label: "Distance (m)" },
  { value: "weight", label: "Weight (kg)" },
  { value: "height", label: "Height (cm)" },
  { value: "score", label: "Score (pts)" },
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
  const date = parseDate(iso.slice(0, 10))
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

function makeKey() {
  return `t-${Math.random().toString(36).slice(2, 10)}`
}

function statusOf(week: Pick<TestWeekRow, "status" | "isArchived" | "startDate">): { label: string; tone: StateTone } {
  if (week.isArchived) return { label: "Archived", tone: "neutral" }
  if (week.status === "closed") return { label: "Closed", tone: "neutral" }
  if (week.status === "draft") return { label: "Draft", tone: "amber" }
  if (week.startDate > toInputDate(new Date())) return { label: `Opens ${shortDate(week.startDate)}`, tone: "blue" }
  return { label: "Open", tone: "green" }
}

function numericOf(result: { value: string; numeric: number | null }) {
  if (result.numeric !== null && Number.isFinite(result.numeric)) return result.numeric
  const parsed = Number.parseFloat(result.value.replace(",", ".").replace(/[^\d.-]/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function byStaff(result: TestWeekResultValue | undefined) {
  return result?.enteredBy === "coach" || result?.enteredBy === "club-admin"
}

function Change({ change }: { change: ResultChange | null }) {
  if (change === "up") return <ArrowUp className="size-4 shrink-0 text-sk-green" weight="bold" aria-label="Improved" />
  if (change === "down") return <ArrowDown className="size-4 shrink-0 text-sk-coral" weight="bold" aria-label="Dropped" />
  return null
}

export function TestWeekScreen(props: TestWeekScreenProps) {
  const { weeks, teams, lockedTeamId, isLoading, loadError } = props
  const defaultTeamId = props.defaultTeamId ?? null
  const { syncSelectedTeam } = useCoachTeams()
  const [view, setView] = useState<View>({ kind: "list" })
  const [listFilter, setListFilter] = useState<"active" | "archived">("active")
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | "archive" | "delete" | "close">(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [detailState, setDetailState] = useState<{ id: string; detail: TestWeekDetail | null; error: string | null } | null>(null)
  const [detailVersion, setDetailVersion] = useState(0)

  const teamName = (teamId: string | null) => teams.find((team) => team.id === teamId)?.name ?? "No team"
  const lockedTeam = teams.find((team) => team.id === lockedTeamId) ?? null
  const scopeTeam = lockedTeam ?? teams.find((team) => team.id === defaultTeamId) ?? null

  // Which team the open detail or builder belongs to, and what the builder looked like when it opened.
  const viewTeamId = useRef<string | null>(null)
  const [draftBaseline, setDraftBaseline] = useState<string | null>(null)
  const builderDirty = view.kind === "builder" && draft !== null && JSON.stringify(draft) !== draftBaseline
  useTeamSwitchGuard(builderDirty ? "You have unsaved changes to this test week. Switch team and lose them?" : null)

  // Switching team closes a test week that belongs to another team, so nothing from the last team stays up.
  const latestView = useRef(view)
  useEffect(() => {
    latestView.current = view
  })
  const shownTeamId = useRef(defaultTeamId)
  useLayoutEffect(() => {
    if (shownTeamId.current === defaultTeamId) return
    shownTeamId.current = defaultTeamId
    if (latestView.current.kind === "list" || viewTeamId.current === defaultTeamId) return
    setActionError(null)
    setNotice(null)
    setDraft(null)
    setView({ kind: "list" })
  }, [defaultTeamId])

  const goTo = (next: View) => {
    setActionError(null)
    setConfirm(null)
    if (next.kind !== "detail") setNotice(null)
    if (next.kind === "detail") viewTeamId.current = weeks.find((week) => week.id === next.id)?.teamId ?? viewTeamId.current
    setView(next)
    document.getElementById("main-content")?.scrollTo?.({ top: 0 })
  }

  const detailId = view.kind === "detail" ? view.id : null
  const { loadDetail } = props
  useEffect(() => {
    if (!detailId) return
    let cancelled = false
    setDetailState((current) => (current?.id === detailId ? current : { id: detailId, detail: null, error: null }))
    void loadDetail(detailId).then((result) => {
      if (cancelled) return
      setDetailState(result.ok ? { id: detailId, detail: result.data, error: null } : { id: detailId, detail: null, error: result.message })
    })
    return () => {
      cancelled = true
    }
    // loadDetail changes identity whenever the list reloads. The detail is refetched on demand (detailVersion) instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId, detailVersion])

  const openNew = () => {
    const preferredTeamId = lockedTeamId ?? defaultTeamId
    const teamId = (teams.some((team) => team.id === preferredTeamId) ? preferredTeamId : null) ?? teams[0]?.id ?? ""
    const today = toInputDate(new Date())
    const next: Draft = {
      id: null,
      name: "",
      teamId,
      startDate: today,
      endDate: addDays(today, 4),
      tests: props.starterTests(teamId).map((test) => ({ key: makeKey(), id: null, name: test.name, unit: test.unit, dayIndex: 0 })),
    }
    setDraft(next)
    setDraftBaseline(JSON.stringify(next))
    viewTeamId.current = teamId
    goTo({ kind: "builder", id: null })
  }

  const openEdit = (week: TestWeekRow, detail: TestWeekDetail) => {
    const next: Draft = {
      id: week.id,
      name: week.name,
      teamId: week.teamId ?? lockedTeamId ?? defaultTeamId ?? teams[0]?.id ?? "",
      startDate: week.startDate,
      endDate: week.endDate,
      tests: detail.tests.map((test) => ({ key: test.id, id: test.id, name: test.name, unit: test.unit, dayIndex: test.dayIndex })),
    }
    setDraft(next)
    setDraftBaseline(JSON.stringify(next))
    viewTeamId.current = next.teamId
    goTo({ kind: "builder", id: week.id })
  }

  const run = async (action: () => Promise<ActionResult<unknown>>, after: () => void) => {
    setBusy(true)
    setActionError(null)
    const result = await action()
    setBusy(false)
    setConfirm(null)
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
    const scope = scopeTeam ? ` for ${scopeTeam.name}` : ""
    const lede = isLoading
      ? "Getting your test weeks..."
      : activeWeeks.length === 0
        ? `No test weeks${scope} yet. Set one up and athletes can start entering results.`
        : `${plural(activeWeeks.length, "test week")}${scope}, ${openWeeks.length} open${draftWeeks.length > 0 ? `, ${plural(draftWeeks.length, "draft")}` : ""}.`

    const columns: Array<DataTableColumn<TestWeekRow>> = [
      {
        key: "week",
        header: "Test week",
        cell: (week) => (
          <button type="button" className="cursor-pointer rounded-[6px] text-left hover:text-sk-blue-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue" onClick={() => goTo({ kind: "detail", id: week.id })}>
            {week.name}
            <TableSub>{[scopeTeam ? null : teamName(week.teamId), dateWindow(week.startDate, week.endDate)].filter(Boolean).join(", ")}</TableSub>
          </button>
        ),
      },
      {
        key: "status",
        header: "Status",
        phone: "plain",
        cell: (week) => {
          const status = statusOf(week)
          return <StatusText tone={status.tone}>{status.label}</StatusText>
        },
      },
      { key: "tests", header: "Tests", align: "right", phone: "hide", cell: (week) => week.testCount },
      {
        key: "results",
        header: "Results in",
        align: "right",
        strong: true,
        phone: "trailing",
        cell: (week) => (week.status === "draft" ? <span className="font-normal text-sk-mute">Not sent yet</span> : week.athleteCount ? `${week.submittedCount} of ${week.athleteCount}` : "No athletes"),
      },
    ]

    return (
      <Screen>
        <ScreenHeader
          title="Test weeks"
          lede={lede}
          actions={
            <Button variant="primary" onClick={openNew} disabled={isLoading}>
              <Plus className="size-5" weight="bold" aria-hidden />
              New test week
            </Button>
          }
        />

        {loadError ? <Notice tone="error">Could not load test weeks: {loadError}</Notice> : null}
        {actionError ? <Notice tone="error">{actionError}</Notice> : null}

        <Section
          title={listFilter === "archived" && archivedWeeks.length > 0 ? "Archived" : "Active"}
          action={
            archivedWeeks.length > 0 ? (
              <Segmented
                label="Show"
                value={listFilter}
                onChange={setListFilter}
                options={[
                  { value: "active", label: `Active ${activeWeeks.length}` },
                  { value: "archived", label: `Archived ${archivedWeeks.length}` },
                ]}
              />
            ) : null
          }
        >
          {isLoading ? (
            <SkeletonRows rows={3} label="Loading test weeks" />
          ) : shownWeeks.length === 0 ? (
            <EmptyState
              title="No test weeks yet"
              body="A test week is a set of tests, such as 30m or squat 1RM, that your athletes do over a few days. Results land here as they come in, or you type them in yourself."
              action={
                <Button size="sm" onClick={openNew}>
                  Set up a test week
                </Button>
              }
            />
          ) : (
            <DataTable caption="Test weeks" columns={columns} rows={shownWeeks} rowKey={(week) => week.id} />
          )}
        </Section>
      </Screen>
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
                // Saved for another of the coach's teams: show that team, so this test week is in its list.
                viewTeamId.current = input.teamId
                if (defaultTeamId) syncSelectedTeam(input.teamId)
                setView({ kind: "detail", id: result.data.id })
                document.getElementById("main-content")?.scrollTo?.({ top: 0 })
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
  const back = { onClick: () => goTo({ kind: "list" }), label: "All test weeks" }

  if (!week) {
    return (
      <Screen>
        <ScreenHeader back={back} title="Test week" />
        {isLoading ? (
          <SkeletonRows rows={4} label="Loading test week" />
        ) : (
          <EmptyState
            title="This test week is not here any more"
            body="It may have been deleted, or it belongs to another team."
            action={
              <Button size="sm" onClick={() => goTo({ kind: "list" })}>
                Back to test weeks
              </Button>
            }
          />
        )}
      </Screen>
    )
  }

  const status = statusOf(week)
  const detail = detailState?.id === week.id ? detailState.detail : null
  const detailError = detailState?.id === week.id ? detailState.error : null
  const isDraft = week.status === "draft" && !week.isArchived
  const isOpen = week.status === "published" && !week.isArchived
  const isClosed = week.status === "closed" && !week.isArchived

  const exportCsv = () => {
    if (!detail) return
    downloadCsv(
      csvFileName(week.name, "results"),
      testWeekResultsCsvRows({
        weekName: week.name,
        teamName: teamName(week.teamId),
        startDate: week.startDate,
        endDate: week.endDate,
        status: status.label,
        tests: detail.tests,
        athletes: detail.athletes,
      }),
    )
  }

  return (
    <Screen>
      <ScreenHeader
        back={back}
        fact={<StatusText tone={status.tone}>{status.label}</StatusText>}
        title={week.name}
        lede={`${teamName(week.teamId)}, ${dateWindow(week.startDate, week.endDate)}.`}
        actions={
          <>
            {week.isArchived ? (
              <Button disabled={busy} onClick={() => void run(() => props.onSetArchived(week.id, false), () => setNotice("Restored from the archive."))}>
                Restore
              </Button>
            ) : null}
            {isDraft ? (
              <Button
                variant="primary"
                disabled={busy || week.testCount === 0}
                onClick={() => void run(() => props.onPublish(week.id), () => setNotice(`Test week published to ${plural(week.athleteCount ?? 0, "athlete")}.`))}
              >
                Publish
              </Button>
            ) : null}
            {isOpen ? (
              <Button disabled={busy} onClick={() => setConfirm("close")}>
                <LockSimple className="size-5" weight="bold" aria-hidden />
                Close test week
              </Button>
            ) : null}
            {isClosed ? (
              <Button
                disabled={busy}
                onClick={() => void run(() => props.onSetOpen(week.id, true), () => setNotice("Reopened. Athletes can enter results again, and those with an account have been told."))}
              >
                <LockSimpleOpen className="size-5" weight="bold" aria-hidden />
                Reopen
              </Button>
            ) : null}
            {week.isArchived ? null : (
              <Button disabled={busy || !detail} onClick={() => detail && openEdit(week, detail)}>
                <PencilSimple className="size-5" weight="bold" aria-hidden />
                Edit
              </Button>
            )}
            <RowMenu
              label={`More for ${week.name}`}
              items={[
                { label: "Download results as CSV", onSelect: exportCsv, disabled: !detail || detail.tests.length === 0 },
                ...(week.isArchived ? [] : [{ label: "Archive", onSelect: () => setConfirm("archive"), disabled: busy }]),
                { label: "Delete", danger: true, onSelect: () => setConfirm("delete"), disabled: busy },
              ]}
            />
          </>
        }
      />

      {actionError ? <Notice tone="error">{actionError}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {confirm === "close" ? (
        <InlineConfirm
          question="Close this test week? Athletes can no longer enter or change results. You still can, and you can reopen it."
          confirmLabel="Close test week"
          cancelLabel="Keep it open"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(() => props.onSetOpen(week.id, false), () => setNotice("Closed. Athletes can no longer enter results. You can still correct them here."))}
        />
      ) : null}
      {confirm === "archive" ? (
        <InlineConfirm
          question={`Archive "${week.name}"? Athletes will no longer see it.`}
          confirmLabel="Archive"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(() => props.onSetArchived(week.id, true), () => goTo({ kind: "list" }))}
        />
      ) : null}
      {confirm === "delete" ? (
        <InlineConfirm
          question={`Delete "${week.name}" for good? Its results are deleted too. This cannot be undone.`}
          confirmLabel="Yes, delete"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(() => props.onDelete(week.id), () => goTo({ kind: "list" }))}
        />
      ) : null}

      {detailError ? <Notice tone="error">Could not load this test week: {detailError}</Notice> : null}

      {detail ? (
        <DetailBody
          week={week}
          detail={detail}
          onExport={exportCsv}
          onSaveResult={props.onSaveResult}
          onResultSaved={(athleteId, testId, saved) =>
            setDetailState((current) => {
              if (!current?.detail || current.id !== week.id) return current
              return {
                ...current,
                detail: {
                  ...current.detail,
                  athletes: current.detail.athletes.map((athlete) => {
                    if (athlete.athleteId !== athleteId) return athlete
                    const results = { ...athlete.results }
                    if (saved) results[testId] = { value: saved.value, numeric: saved.numeric, change: null, enteredBy: saved.enteredBy }
                    else delete results[testId]
                    const left = Object.keys(results).length
                    return { ...athlete, results, submittedAt: left === 0 ? null : saved ? saved.submittedAt : athlete.submittedAt }
                  }),
                },
              }
            })
          }
        />
      ) : detailError ? null : (
        <SkeletonRows rows={4} leading label="Loading results" />
      )}
    </Screen>
  )
}

/* ------------------------------------------------------------------ */

type EntryState = { text: string; state: SaveStateValue; message?: string | null }

function DetailBody({
  week,
  detail,
  onExport,
  onSaveResult,
  onResultSaved,
}: {
  week: TestWeekRow
  detail: TestWeekDetail
  onExport: () => void
  onSaveResult: TestWeekScreenProps["onSaveResult"]
  onResultSaved: (athleteId: string, testId: string, saved: TestWeekSavedResult | null) => void
}) {
  const [lens, setLens] = useState<Lens>("athlete")
  // Cells the coach has typed in this visit: what was typed and whether it is saved yet.
  const [entries, setEntries] = useState<Record<string, EntryState>>({})
  const days = dayCount(week.startDate, week.endDate)
  const multiDay = new Set(detail.tests.map((test) => test.dayIndex)).size > 1
  const submitted = detail.athletes.filter((athlete) => athlete.submittedAt || Object.keys(athlete.results).length > 0)
  const waiting = detail.athletes.filter((athlete) => !athlete.submittedAt && Object.keys(athlete.results).length === 0 && athlete.onRoster)
  const isDraft = week.status === "draft"
  const canEnter = !isDraft && !week.isArchived && detail.tests.length > 0 && detail.athletes.length > 0
  const activeLens: Lens = lens === "enter" && !canEnter ? "athlete" : lens

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

  const athleteColumns: Array<DataTableColumn<TestWeekAthleteRow>> = [
    {
      key: "athlete",
      header: "Athlete",
      cell: (athlete) => {
        const values = Object.values(athlete.results)
        const staffCount = values.filter(byStaff).length
        const when = athlete.submittedAt ? shortDate(athlete.submittedAt) : null
        const line =
          values.length === 0
            ? isDraft
              ? (athlete.primaryEvent ?? "Assigned")
              : "No results yet"
            : staffCount === values.length
              ? `Entered by coach${when ? ` ${when}` : ""}`
              : `Submitted${when ? ` ${when}` : ""}${staffCount > 0 ? `, ${staffCount} by coach` : ""}`
        return (
          <span className="flex items-center gap-3">
            <PersonAvatar name={athlete.name} athleteId={athlete.athleteId} size="sm" />
            <span className="min-w-0">
              {athlete.name}
              <TableSub>
                {line}
                {athlete.onRoster ? "" : ", left the team"}
              </TableSub>
            </span>
          </span>
        )
      },
    },
    ...detail.tests.map((test) => ({
      key: test.id,
      header: multiDay ? `${test.name}, day ${test.dayIndex + 1}` : test.name,
      align: "right" as const,
      cell: (athlete: TestWeekAthleteRow) => {
        const result = athlete.results[test.id]
        return result ? (
          <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap font-semibold text-sk-ink">
            {result.value}
            <Change change={result.change} />
          </span>
        ) : (
          <span className="text-sk-faint" aria-label="No result">
            -
          </span>
        )
      },
    })),
  ]

  const testColumns: Array<DataTableColumn<(typeof byTest)[number]>> = [
    {
      key: "test",
      header: "Test",
      cell: ({ test }) => (
        <>
          {test.name}
          <TableSub>
            {TEST_UNIT_META[test.unit].long}
            {multiDay ? `, day ${test.dayIndex + 1}` : ""}
          </TableSub>
        </>
      ),
    },
    { key: "best", header: "Best mark", phone: "trailing", cell: ({ best }) => (best ? <Mark size="sm" value={best.value} /> : <span className="text-sk-mute">None yet</span>) },
    { key: "leader", header: "Leader", cell: ({ best }) => best?.athlete ?? "No results yet" },
    { key: "count", header: "Results in", align: "right", strong: true, cell: ({ count }) => `${count} of ${detail.athletes.length}` },
  ]

  const cellKey = (athleteId: string, testId: string) => `${athleteId}|${testId}`
  const entryAthletes = detail.athletes.filter((athlete) => athlete.onRoster || Object.keys(athlete.results).length > 0)

  const cell = (athleteId: string, testId: string): EntryGridCell => {
    const entry = entries[cellKey(athleteId, testId)]
    const saved = detail.athletes.find((athlete) => athlete.athleteId === athleteId)?.results[testId]
    if (entry && entry.state !== "saved") return { value: entry.text, state: entry.state, message: entry.message }
    return { value: entryTextFor(saved), state: entry?.state ?? "idle", marked: byStaff(saved) }
  }

  const commit = (athleteId: string, testId: string, text: string) => {
    const test = detail.tests.find((candidate) => candidate.id === testId)
    if (!test) return
    const key = cellKey(athleteId, testId)
    setEntries((current) => ({ ...current, [key]: { text, state: "saving" } }))
    void onSaveResult({ testWeekId: week.id, testId, athleteId, unit: test.unit, value: text }).then((result) => {
      if (!result.ok) {
        setEntries((current) => ({ ...current, [key]: { text, state: "error", message: result.message } }))
        return
      }
      onResultSaved(athleteId, testId, result.data)
      setEntries((current) => ({ ...current, [key]: { text, state: "saved" } }))
    })
  }

  const entryStates = Object.values(entries)
  const savingCount = entryStates.filter((entry) => entry.state === "saving").length
  const failedCount = entryStates.filter((entry) => entry.state === "error").length
  const savedCount = entryStates.filter((entry) => entry.state === "saved").length
  const summary: { state: SaveStateValue; text: string } =
    failedCount > 0
      ? { state: "error", text: `${plural(failedCount, "result")} not saved` }
      : savingCount > 0
        ? { state: "saving", text: "Saving..." }
        : savedCount > 0
          ? { state: "saved", text: "All results saved" }
          : { state: "idle", text: "" }

  return (
    <>
      <StatStrip aria-label="Progress">
        <Stat label="Results in" value={submitted.length} of={detail.athletes.length} />
        <Stat label="Still to come" value={isDraft ? 0 : waiting.length} hint={isDraft ? "Not published yet" : waiting.length === 0 ? "Everyone is in" : undefined} />
        <Stat label="Tests" value={detail.tests.length} hint={multiDay ? "Across the week" : "All on one day"} />
        <Stat label="Days" value={days} />
      </StatStrip>

      <Section
        title="Results"
        hint={
          activeLens === "enter"
            ? "Type a result and press Enter to go down or Tab to go across. Each one saves as you leave it."
            : week.status === "closed"
              ? "Closed to athletes. You can still enter and correct results."
              : undefined
        }
        meta={activeLens === "enter" ? <SaveState state={summary.state}>{summary.text}</SaveState> : undefined}
      >
        {detail.athletes.length === 0 ? (
          <EmptyState title="No athletes on this team yet" body="Add or invite athletes to the team and they show up here." />
        ) : detail.tests.length === 0 ? (
          <EmptyState title="No tests yet" body="Edit this test week to add the tests athletes should do." />
        ) : (
          <>
            <Tabs<Lens>
              label="Results view"
              className="mb-1"
              value={activeLens}
              onChange={setLens}
              options={[
                { value: "athlete", label: "By athlete" },
                { value: "test", label: "By test" },
                ...(canEnter ? [{ value: "enter" as const, label: "Enter results" }] : []),
              ]}
            />
            {activeLens === "athlete" ? (
              <DataTable caption="Results by athlete" columns={athleteColumns} rows={detail.athletes} rowKey={(athlete) => athlete.athleteId} />
            ) : activeLens === "test" ? (
              <DataTable caption="Results by test" columns={testColumns} rows={byTest} rowKey={(row) => row.test.id} />
            ) : (
              <>
                <EntryGrid
                  className="mt-2"
                  caption={`Enter results for ${week.name}`}
                  rowHeader="Athlete"
                  rows={entryAthletes.map((athlete) => ({
                    key: athlete.athleteId,
                    label: athlete.name,
                    header: (
                      <span className="flex items-center gap-2.5">
                        <PersonAvatar name={athlete.name} athleteId={athlete.athleteId} size="sm" className="hidden sm:inline-flex" />
                        <span className="min-w-0 truncate">{athlete.name}</span>
                      </span>
                    ),
                  }))}
                  columns={detail.tests.map((test) => ({
                    key: test.id,
                    header: test.name,
                    sub: `${TEST_UNIT_META[test.unit].long}${multiDay ? `, day ${test.dayIndex + 1}` : ""}`,
                  }))}
                  cell={cell}
                  validate={(testId, text) => {
                    const test = detail.tests.find((candidate) => candidate.id === testId)
                    if (!test) return null
                    const checked = checkTestResultEntry(text, test.unit)
                    return checked.ok ? null : checked.message
                  }}
                  onCommit={commit}
                />
                <p className="mt-3 flex items-start gap-2 text-sm text-sk-mute">
                  <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-sk-blue" aria-hidden />
                  Entered by a coach. You can paste a column from a spreadsheet into any cell. Empty a cell to remove a result.
                </p>
              </>
            )}
            <div className="-ml-2.5 mt-2">
              <Button variant="quiet" size="sm" onClick={onExport}>
                <DownloadSimple className="size-4" weight="bold" aria-hidden />
                Download results as CSV
              </Button>
            </div>
          </>
        )}
      </Section>

      <Section title="Tests by day">
        {testsByDay.length === 0 ? (
          <EmptyState title="Nothing scheduled yet" body="Edit this test week to add tests to its days." />
        ) : (
          <List>
            {testsByDay.map(([dayIndex, tests]) => (
              <ListRow
                key={dayIndex}
                leading={<span className="w-12 text-left font-bold text-sk-mute">Day {dayIndex + 1}</span>}
                title={tests.map((test) => test.name).join(", ")}
                subtitle={weekdayDate(addDays(week.startDate, dayIndex))}
                trailing={<span className="font-normal text-sk-mute">{plural(tests.length, "test")}</span>}
              />
            ))}
          </List>
        )}
      </Section>
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
  const [activeDay, setActiveDay] = useState(0)
  const focusKey = useRef<string | null>(null)
  const days = dayCount(draft.startDate, draft.endDate)
  const day = Math.min(activeDay, days - 1)
  const team = lockedTeam ?? teams.find((candidate) => candidate.id === draft.teamId) ?? null
  const isPublished = editingWeek?.status === "published"
  const isClosed = editingWeek?.status === "closed"
  const hasResults = (editingWeek?.submittedCount ?? 0) > 0
  const dayTests = draft.tests.filter((test) => Math.min(test.dayIndex, days - 1) === day)
  const namedTests = draft.tests.filter((test) => test.name.trim())
  const usedDays = new Set(namedTests.map((test) => Math.min(test.dayIndex, days - 1))).size
  const quickAdds = QUICK_TESTS.filter((quick) => !dayTests.some((test) => test.name.trim().toLowerCase() === quick.name.toLowerCase()))

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
    <Screen>
      <ScreenHeader
        back={{ onClick: onCancel, label: draft.id ? "Back to results" : "All test weeks" }}
        title={draft.id ? "Edit test week" : "New test week"}
        lede="Name it, set the dates, then add the tests for each day."
      />

      <Split
        main={
          <Section title="Tests" hint="Pick a day, then add what athletes should do on it." meta={`${plural(namedTests.length, "test")}, ${plural(usedDays, "day")}`}>
            <Tabs<string>
              label="Day"
              className="mt-2"
              value={String(day)}
              onChange={(next) => setActiveDay(Number(next))}
              options={Array.from({ length: days }, (_, index) => {
                const count = draft.tests.filter((test) => test.name.trim() && Math.min(test.dayIndex, days - 1) === index).length
                return { value: String(index), label: `Day ${index + 1}`, count: count > 0 ? count : undefined }
              })}
            />

            <p className="mt-4 text-[0.9375rem] font-semibold text-sk-ink">{weekdayDate(addDays(draft.startDate, day))}</p>

            {dayTests.length === 0 ? (
              <p className="mt-2 text-[0.9375rem] text-sk-mute">Nothing on day {day + 1} yet. Add a test below, or leave it as a rest day.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {dayTests.map((test, index) => (
                  <li key={test.key} className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_2.75rem]">
                    <input
                      className="sk-field"
                      aria-label={`Test ${index + 1} name`}
                      placeholder="Test name, for example 300m"
                      value={test.name}
                      autoFocus={focusKey.current === test.key}
                      enterKeyHint="next"
                      onChange={(event) => patchTest(test.key, { name: event.target.value })}
                      onKeyDown={(event) => {
                        // Enter on the last test starts the next one, so a list can be typed without the mouse.
                        if (event.key !== "Enter") return
                        event.preventDefault()
                        if (index === dayTests.length - 1 && test.name.trim()) addTest()
                      }}
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
                      className="inline-flex size-11 cursor-pointer items-center justify-center rounded-[12px] text-sk-mute transition-colors hover:bg-sk-soft hover:text-sk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
                      aria-label={`Remove ${test.name.trim() || `test ${index + 1}`}`}
                      onClick={() => setDraft((current) => ({ ...current, tests: current.tests.filter((item) => item.key !== test.key) }))}
                    >
                      <Trash className="size-5" weight="bold" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => addTest()}>
                <Plus className="size-4" weight="bold" aria-hidden />
                Add test
              </Button>
              {quickAdds.map((quick) => (
                <Button key={quick.name} size="sm" variant="quiet" onClick={() => addTest(quick)}>
                  <Plus className="size-4" weight="bold" aria-hidden />
                  <span className="sr-only">Add </span>
                  {quick.name}
                </Button>
              ))}
            </div>

            {hasResults ? (
              <Notice tone="warning" className="mt-4">
                {plural(editingWeek?.submittedCount ?? 0, "athlete has", "athletes have")} results already. Removing a test also removes its results.
              </Notice>
            ) : null}
          </Section>
        }
        side={
          <Section title="Details">
            <FormGrid className="mt-2">
              <Field label="Test week name" className="sm:col-span-2">
                <Input value={draft.name} placeholder="Week 4 testing" onChange={(event) => patch({ name: event.target.value })} />
              </Field>
              <Field label="Team" className="sm:col-span-2" hint={team ? `Goes to the whole team, ${plural(team.athleteCount, "athlete")}.` : "Choose who this is for."}>
                <Select value={draft.teamId} disabled={Boolean(lockedTeam)} onChange={(event) => patch({ teamId: event.target.value })}>
                  {teams.length === 0 ? <option value="">No teams yet</option> : null}
                  {teams.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Start date">
                <Input type="date" value={draft.startDate} onChange={(event) => patch({ startDate: event.target.value })} />
              </Field>
              <Field label="End date">
                <Input type="date" value={draft.endDate} min={draft.startDate} onChange={(event) => patch({ endDate: event.target.value })} />
              </Field>
            </FormGrid>
          </Section>
        }
      />

      {error ? <Notice tone="error">{error}</Notice> : null}

      <FormActions>
        <Button variant="quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {isPublished || isClosed ? (
          <Button variant="primary" onClick={() => submit(Boolean(isPublished))} disabled={busy}>
            {busy ? "Saving..." : "Save changes"}
          </Button>
        ) : (
          <>
            <Button onClick={() => submit(false)} disabled={busy}>
              {draft.id ? "Save changes" : "Save draft"}
            </Button>
            <Button variant="primary" onClick={() => submit(true)} disabled={busy}>
              {busy ? "Publishing..." : "Publish test week"}
            </Button>
          </>
        )}
      </FormActions>
    </Screen>
  )
}
