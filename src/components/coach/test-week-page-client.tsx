"use client"

import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, Delete01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyStateCard } from "@/components/ui/empty-state-card"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { EventGroup, mockAthletes, mockTeams, mockTestWeekResults, onCreateTestWeek, type Role } from "@/lib/mock-data"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { cn } from "@/lib/utils"

type Step = 1 | 2 | 3
type AssignTarget = "team" | "subgroup" | "selected"
type DetailResultsFilter = "event" | "athlete"

interface TestDefinition {
  id: string
  name: string
  unit: "time" | "distance" | "weight" | "height"
}

interface TestWeekDraft {
  name: string
  teamId: string
  startDate: string
  endDate: string
  notes: string
}

interface TestWeekListItem {
  id: string
  name: string
  teamId: string
  startDate: string
  endDate: string
  testCount: number
  status: "Draft" | "Published"
}

interface CoachTestWeekPageClientProps {
  initialRole: Role
  initialCoachTeamId: string | null
}

interface DetailMetric {
  label: string
  bestMark: string
  leader: string
  completed: string
  movement: string
}

interface AthleteDetailResult {
  athleteId: string
  athleteName: string
  primaryEvent: string
  submittedAt: string
  results: Array<{ label: string; value: string; movement: string }>
}

interface TestWeekDetailData {
  phase: "results" | "structure"
  tests: TestDefinition[]
  metrics: DetailMetric[]
  athleteRows: AthleteDetailResult[]
}

const INITIAL_TESTS: TestDefinition[] = [
  { id: "test-30m", name: "30m", unit: "time" },
  { id: "test-flying30", name: "Flying 30m", unit: "time" },
  { id: "test-150m", name: "150m", unit: "time" },
  { id: "test-lj", name: "Long Jump", unit: "distance" },
  { id: "test-shot", name: "Shot Put", unit: "distance" },
  { id: "test-squat", name: "Squat 1RM", unit: "weight" },
  { id: "test-cmj", name: "CMJ", unit: "height" },
]

const TEST_WEEK_HISTORY_KEY = "pacelab:test-week-history"
const STEP_META = [
  { value: 1, label: "Setup" },
  { value: 2, label: "Build" },
  { value: 3, label: "Publish" },
] as const

const AVATAR_SWATCHES = [
  "bg-[#dbeafe] text-[#1d4ed8]",
  "bg-[#ede9fe] text-[#6d28d9]",
  "bg-[#e0f2fe] text-[#0369a1]",
  "bg-[#fee2e2] text-[#b91c1c]",
  "bg-[#fef3c7] text-[#b45309]",
]

const WIZARD_CARD =
  "rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]"
const WIZARD_SUBCARD = "rounded-[22px] border border-slate-200 bg-[#fbfcfe] p-4"
const PRIMARY_ACTION =
  "border-0 bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
const SECONDARY_ACTION = "border-slate-200 bg-white text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff]"

const SPRINT_TEMPLATE_TESTS: TestDefinition[] = [
  { id: "test-30m", name: "30m", unit: "time" },
  { id: "test-flying30", name: "Flying 30m", unit: "time" },
  { id: "test-150m", name: "150m", unit: "time" },
  { id: "test-squat", name: "Squat 1RM", unit: "weight" },
  { id: "test-cmj", name: "CMJ", unit: "height" },
]

const JUMPS_TEMPLATE_TESTS: TestDefinition[] = [
  { id: "test-lj", name: "Long Jump", unit: "distance" },
  { id: "test-cmj", name: "CMJ", unit: "height" },
  { id: "test-squat", name: "Squat 1RM", unit: "weight" },
  { id: "test-bounds", name: "5 Bound", unit: "distance" },
]

const THROWS_TEMPLATE_TESTS: TestDefinition[] = [
  { id: "test-shot", name: "Shot Put", unit: "distance" },
  { id: "test-discus", name: "Discus", unit: "distance" },
  { id: "test-javelin", name: "Javelin", unit: "distance" },
  { id: "test-cmj", name: "CMJ", unit: "height" },
  { id: "test-squat", name: "Squat 1RM", unit: "weight" },
]

function athleteInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

const MOCK_TEST_WEEKS: TestWeekListItem[] = [
  {
    id: "mock-test-week-1",
    name: "January Speed Testing",
    teamId: "t1",
    startDate: "2026-01-12",
    endDate: "2026-01-16",
    testCount: 5,
    status: "Published",
  },
  {
    id: "mock-test-week-2",
    name: "February Power + Jump Check",
    teamId: "t3",
    startDate: "2026-02-09",
    endDate: "2026-02-13",
    testCount: 4,
    status: "Published",
  },
  {
    id: "mock-test-week-3",
    name: "March Throwing Benchmark",
    teamId: "t4",
    startDate: "2026-03-02",
    endDate: "2026-03-06",
    testCount: 6,
    status: "Published",
  },
]

function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatFriendlyDate(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`)
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function formatFriendlyDateWindow(startDate: string, endDate: string) {
  return `${formatFriendlyDate(startDate)} to ${formatFriendlyDate(endDate)}`
}

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function getTemplateTestsForEventGroup(eventGroup?: EventGroup | null) {
  if (eventGroup === "Throws") return THROWS_TEMPLATE_TESTS
  if (eventGroup === "Jumps") return JUMPS_TEMPLATE_TESTS
  return SPRINT_TEMPLATE_TESTS
}

function cloneTests(testsToClone: TestDefinition[]) {
  return testsToClone.map((test) => ({ ...test }))
}

const MOCK_DETAIL_DATA: Record<string, TestWeekDetailData> = {
  "mock-test-week-1": {
    phase: "results",
    tests: cloneTests(SPRINT_TEMPLATE_TESTS),
    metrics: [
      { label: "30m", bestMark: "4.05s", leader: "Marcus Johnson", completed: "4 / 4 submitted", movement: "2 improved" },
      { label: "Flying 30m", bestMark: "2.89s", leader: "Marcus Johnson", completed: "4 / 4 submitted", movement: "2 improved" },
      { label: "150m", bestMark: "16.2s", leader: "David Okafor", completed: "4 / 4 submitted", movement: "1 improved" },
      { label: "CMJ", bestMark: "72cm", leader: "Marcus Johnson", completed: "4 / 4 submitted", movement: "2 improved" },
    ],
    athleteRows: mockTestWeekResults.map((row) => ({
      athleteId: row.athleteId,
      athleteName: row.athleteName,
      primaryEvent: mockAthletes.find((athlete) => athlete.id === row.athleteId)?.primaryEvent ?? "Assigned event",
      submittedAt: "Submitted Mar 12 at 9:15 AM",
      results: [
        { label: "30m", value: row.thirtyM?.value ?? "-", movement: row.thirtyM?.change ?? "same" },
        { label: "Flying 30m", value: row.flyingThirtyM?.value ?? "-", movement: row.flyingThirtyM?.change ?? "same" },
        { label: "150m", value: row.oneHundredFiftyM?.value ?? "-", movement: row.oneHundredFiftyM?.change ?? "same" },
        { label: "CMJ", value: row.cmj?.value ?? "-", movement: row.cmj?.change ?? "same" },
      ],
    })),
  },
  "mock-test-week-2": {
    phase: "results",
    tests: cloneTests(JUMPS_TEMPLATE_TESTS),
    metrics: [
      { label: "Long Jump", bestMark: "6.45m", leader: "Ava Thompson", completed: "2 / 2 submitted", movement: "1 improved" },
      { label: "CMJ", bestMark: "61cm", leader: "Ava Thompson", completed: "2 / 2 submitted", movement: "1 improved" },
      { label: "5 Bound", bestMark: "14.82m", leader: "Ava Thompson", completed: "2 / 2 submitted", movement: "stable" },
    ],
    athleteRows: [
      {
        athleteId: "a6",
        athleteName: "Ava Thompson",
        primaryEvent: "Long Jump",
        submittedAt: "Submitted Feb 13 at 10:05 AM",
        results: [
          { label: "Long Jump", value: "6.45m", movement: "up" },
          { label: "CMJ", value: "61cm", movement: "up" },
          { label: "5 Bound", value: "14.82m", movement: "same" },
        ],
      },
      {
        athleteId: "a7",
        athleteName: "Noah Martinez",
        primaryEvent: "High Jump",
        submittedAt: "Submitted Feb 13 at 10:22 AM",
        results: [
          { label: "High Jump", value: "2.10m", movement: "up" },
          { label: "CMJ", value: "58cm", movement: "same" },
          { label: "Approach pop", value: "8.6 / 10", movement: "down" },
        ],
      },
    ],
  },
  "mock-test-week-3": {
    phase: "results",
    tests: cloneTests(THROWS_TEMPLATE_TESTS),
    metrics: [
      { label: "Shot Put", bestMark: "16.20m", leader: "Mia Anderson", completed: "2 / 2 submitted", movement: "1 improved" },
      { label: "Discus", bestMark: "49.80m", leader: "Liam Patel", completed: "2 / 2 submitted", movement: "1 improved" },
      { label: "CMJ", bestMark: "51cm", leader: "Mia Anderson", completed: "2 / 2 submitted", movement: "stable" },
    ],
    athleteRows: [
      {
        athleteId: "a8",
        athleteName: "Mia Anderson",
        primaryEvent: "Shot Put",
        submittedAt: "Submitted Mar 5 at 8:42 AM",
        results: [
          { label: "Shot Put", value: "16.20m", movement: "up" },
          { label: "Discus", value: "44.15m", movement: "same" },
          { label: "CMJ", value: "51cm", movement: "same" },
        ],
      },
      {
        athleteId: "a9",
        athleteName: "Liam Patel",
        primaryEvent: "Discus",
        submittedAt: "Submitted Mar 5 at 9:08 AM",
        results: [
          { label: "Discus", value: "49.80m", movement: "up" },
          { label: "Shot Put", value: "14.62m", movement: "same" },
          { label: "CMJ", value: "47cm", movement: "down" },
        ],
      },
    ],
  },
}

export default function CoachTestWeekPageClient({
  initialRole,
  initialCoachTeamId,
}: CoachTestWeekPageClientProps) {
  const scopedTeamId = useMemo(
    () => (initialRole === "coach" ? initialCoachTeamId : null),
    [initialCoachTeamId, initialRole]
  )
  const today = new Date()
  const [view, setView] = useState<"list" | "detail" | "wizard">("list")
  const [step, setStep] = useState<Step>(1)
  const [selectedTestWeekId, setSelectedTestWeekId] = useState<string | null>(null)
  const [detailResultsFilter, setDetailResultsFilter] = useState<DetailResultsFilter>("event")
  const [draft, setDraft] = useState<TestWeekDraft>({
    name: "",
    teamId: scopedTeamId ?? mockTeams[0]?.id ?? "",
    startDate: toInputDate(today),
    endDate: toInputDate(addDays(today, 4)),
    notes: "",
  })
  const [tests, setTests] = useState<TestDefinition[]>(INITIAL_TESTS)
  const [newTestName, setNewTestName] = useState("")
  const [newTestUnit, setNewTestUnit] = useState<TestDefinition["unit"]>("time")
  const [assignTarget, setAssignTarget] = useState<AssignTarget>("team")
  const [assignSubgroup, setAssignSubgroup] = useState<EventGroup>("Sprint")
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>([])
  const [publishedCount, setPublishedCount] = useState<number | null>(null)
  const [createdTestWeeks, setCreatedTestWeeks] = useState<TestWeekListItem[]>([])

  const isScopedCoach = initialRole === "coach" && Boolean(scopedTeamId)
  const effectiveTeamId = scopedTeamId ?? draft.teamId
  const effectiveTeam = mockTeams.find((team) => team.id === effectiveTeamId)
  const teamAthletes = mockAthletes.filter((athlete) => athlete.teamId === effectiveTeamId)

  const getAssignedCount = () => {
    if (isScopedCoach) return teamAthletes.length
    if (assignTarget === "team") return teamAthletes.length
    if (assignTarget === "subgroup") return teamAthletes.filter((athlete) => athlete.eventGroup === assignSubgroup).length
    return selectedAthleteIds.length
  }

  const assignedCount = getAssignedCount()
  const testsByUnit = tests.reduce<Record<TestDefinition["unit"], number>>(
    (acc, test) => {
      acc[test.unit] += 1
      return acc
    },
    { time: 0, distance: 0, weight: 0, height: 0 },
  )
  const listedTestWeeks = useMemo(
    () => [
      ...createdTestWeeks,
      ...MOCK_TEST_WEEKS.filter((testWeek) => (scopedTeamId ? testWeek.teamId === scopedTeamId : true)),
    ],
    [createdTestWeeks, scopedTeamId],
  )
  const selectedTestWeek = listedTestWeeks.find((testWeek) => testWeek.id === selectedTestWeekId) ?? null

  const openWizard = () => {
    setView("wizard")
    setStep(1)
    setPublishedCount(null)
  }

  const openDetail = (testWeekId: string) => {
    setDetailResultsFilter("event")
    setSelectedTestWeekId(testWeekId)
    setView("detail")
  }

  const openWizardForEdit = (testWeek: TestWeekListItem) => {
    const team = mockTeams.find((item) => item.id === testWeek.teamId)
    const detailData = MOCK_DETAIL_DATA[testWeek.id]
    setDraft({
      name: testWeek.name,
      teamId: testWeek.teamId,
      startDate: testWeek.startDate,
      endDate: testWeek.endDate,
      notes: "",
    })
    setTests(cloneTests(detailData?.tests ?? getTemplateTestsForEventGroup(team?.eventGroup)))
    setPublishedCount(null)
    setStep(2)
    setView("wizard")
  }

  const addTest = () => {
    if (!newTestName.trim()) return
    setTests((prev) => [...prev, { id: makeId("test"), name: newTestName.trim(), unit: newTestUnit }])
    setNewTestName("")
    setNewTestUnit("time")
  }

  const removeTest = (id: string) => {
    setTests((prev) => prev.filter((test) => test.id !== id))
  }

  useEffect(() => {
    if (!isScopedCoach) return
    setAssignTarget("team")
    setAssignSubgroup(effectiveTeam?.eventGroup ?? "Sprint")
    setSelectedAthleteIds([])
  }, [effectiveTeam?.eventGroup, isScopedCoach])

  useEffect(() => {
    ;(window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }).__PACELAB_MOBILE_DETAIL_MODE = view !== "list"
    window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: view !== "list" } }))
    return () => {
      ;(window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }).__PACELAB_MOBILE_DETAIL_MODE = false
      window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: false } }))
    }
  }, [view])

  useEffect(() => {
    const handleMobileDetailBack = () => {
      if (view === "detail" || view === "wizard") {
        setSelectedTestWeekId(null)
        setView("list")
      }
    }

    window.addEventListener("pacelab:mobile-detail-back", handleMobileDetailBack)
    return () => {
      window.removeEventListener("pacelab:mobile-detail-back", handleMobileDetailBack)
    }
  }, [view])

  const publishTestWeek = () => {
    onCreateTestWeek()
    setPublishedCount(assignedCount)
    const created: TestWeekListItem = {
      id: makeId("tw"),
      name: draft.name,
      teamId: effectiveTeamId,
      startDate: draft.startDate,
      endDate: draft.endDate,
      testCount: tests.length,
      status: "Published",
    }
    setCreatedTestWeeks((prev) => [created, ...prev])
    const key = tenantStorageKey(TEST_WEEK_HISTORY_KEY)
    const current = JSON.parse(window.localStorage.getItem(key) ?? "[]") as TestWeekListItem[]
    window.localStorage.setItem(key, JSON.stringify([created, ...current].slice(0, 50)))
  }

  if (view === "list") {
    return (
      <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
        <section className="space-y-4 pt-1">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <h1 className="text-[2.35rem] leading-[0.95] font-semibold tracking-[-0.07em] text-slate-950 sm:text-[2.8rem]">Test Weeks</h1>
              <p className="max-w-xl text-[0.95rem] leading-6 text-slate-600">
                Build and publish testing blocks.
                {effectiveTeam ? ` Viewing ${effectiveTeam.name}.` : ""}
              </p>
            </div>
            <Button
              type="button"
              aria-label="Create test week"
              onClick={openWizard}
              className="mt-0.5 flex size-14 shrink-0 items-center justify-center rounded-[24px] bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_14px_34px_rgba(31,140,255,0.32),0_0_28px_rgba(71,89,255,0.18)] hover:opacity-95"
            >
              <HugeiconsIcon icon={Add01Icon} className="size-5" />
            </Button>
          </div>

        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            {listedTestWeeks.length === 0 ? (
              <EmptyStateCard
                eyebrow="Test weeks"
                title="No test weeks yet."
                description="No testing windows have been created for this team scope yet."
                hint="Start with a first test week so coaches can compare athlete movement across repeated benchmarks."
                icon={<HugeiconsIcon icon={Add01Icon} className="size-5" />}
                actions={
                  <Button type="button" className={PRIMARY_ACTION} onClick={openWizard}>
                    Create first test week
                  </Button>
                }
              />
            ) : null}
            {listedTestWeeks.map((testWeek) => {
              const teamName = mockTeams.find((team) => team.id === testWeek.teamId)?.name ?? "Assigned team"
              const testWeekAthletes = mockAthletes.filter((athlete) => athlete.teamId === testWeek.teamId)
              return (
                <article
                  key={testWeek.id}
                  className="rounded-[26px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(15,23,42,0.08)] sm:px-5"
                >
                  <button type="button" className="w-full text-left" onClick={() => openDetail(testWeek.id)}>
                    <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {teamName}
                        </span>
                        <span className="inline-flex rounded-full bg-[#eef5ff] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1f5fd1]">
                          {testWeek.testCount} test{testWeek.testCount === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className="text-[1.15rem] font-semibold leading-tight tracking-[-0.03em] text-slate-950">{testWeek.name}</p>
                      <p className="text-sm text-slate-500">
                        {testWeek.startDate} to {testWeek.endDate}
                      </p>
                      <div className="flex items-center gap-3 pt-1">
                        <div className="flex -space-x-2">
                          {testWeekAthletes.slice(0, 5).map((athlete, index) => (
                            <div
                              key={athlete.id}
                              className={cn(
                                "flex size-8 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold shadow-sm",
                                AVATAR_SWATCHES[index % AVATAR_SWATCHES.length],
                              )}
                              title={athlete.name}
                            >
                              {athleteInitials(athlete.name)}
                            </div>
                          ))}
                          {testWeekAthletes.length > 5 ? (
                            <div className="flex size-8 items-center justify-center rounded-full border-2 border-white bg-slate-950 text-[11px] font-semibold text-white shadow-sm">
                              +{testWeekAthletes.length - 5}
                            </div>
                          ) : null}
                        </div>
                        <p className="text-xs text-slate-500">
                          {testWeekAthletes.length} athlete{testWeekAthletes.length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white">
                      {testWeek.status}
                    </span>
                    </div>
                  </button>
                </article>
              )
            })}
          </div>

          <aside className="hidden rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] xl:block">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Current template</p>
              <h2 className="text-lg font-semibold tracking-tight text-slate-950">Assessment mix</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-slate-500">Time tests</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">{testsByUnit.time}</p>
              </div>
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-slate-500">Distance tests</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">{testsByUnit.distance}</p>
              </div>
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                <p className="text-slate-500">Strength / jump tests</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">{testsByUnit.weight + testsByUnit.height}</p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    )
  }

  if (view === "detail" && selectedTestWeek) {
    const detailTeamName = mockTeams.find((team) => team.id === selectedTestWeek.teamId)?.name ?? "Assigned team"
    const detailTeam = mockTeams.find((team) => team.id === selectedTestWeek.teamId)
    const detailAthletes = mockAthletes.filter((athlete) => athlete.teamId === selectedTestWeek.teamId)
    const detailData =
      MOCK_DETAIL_DATA[selectedTestWeek.id] ?? {
        phase: "structure" as const,
        tests: cloneTests(getTemplateTestsForEventGroup(detailTeam?.eventGroup)),
        metrics: [],
        athleteRows: [],
      }
    const hasResults = detailData.phase === "results"
    return (
      <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
        <section className="space-y-4 pt-1">
          <div className="space-y-2">
            <h1 className="text-[2.35rem] leading-[0.95] font-semibold tracking-[-0.07em] text-slate-950 sm:text-[2.8rem]">
              {selectedTestWeek.name}
            </h1>
            <p className="max-w-xl text-[0.95rem] leading-6 text-slate-600">
              {detailTeamName} from {formatFriendlyDateWindow(selectedTestWeek.startDate, selectedTestWeek.endDate)}.
            </p>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {hasResults ? "Results view" : "Build view"}
                  </p>
                  <p className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">
                    {formatFriendlyDateWindow(selectedTestWeek.startDate, selectedTestWeek.endDate)}
                  </p>
                </div>
                <span className="inline-flex rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white">
                  {selectedTestWeek.status}
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-4">
                  <p className="text-sm text-slate-500">Tests configured</p>
                  <p className="mt-1 text-2xl font-semibold tracking-[-0.05em] text-slate-950">{detailData.tests.length}</p>
                </div>
                <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-4">
                  <p className="text-sm text-slate-500">{hasResults ? "Results submitted" : "Athletes in scope"}</p>
                  <p className="mt-1 text-2xl font-semibold tracking-[-0.05em] text-slate-950">
                    {hasResults ? `${detailData.athleteRows.length}/${detailAthletes.length}` : detailAthletes.length}
                  </p>
                </div>
                <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-4">
                  <p className="text-sm text-slate-500">{hasResults ? "Primary lens" : "Next action"}</p>
                  <p className="mt-1 text-xl font-semibold tracking-[-0.04em] text-slate-950">
                    {hasResults ? "By event + athlete" : "Review structure"}
                  </p>
                </div>
              </div>
            </div>

            {hasResults ? (
                <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
                  <div className="space-y-4 border-b border-slate-200 pb-4">
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Results lens</p>
                      <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">
                        {detailResultsFilter === "event" ? "Event Results" : "Athlete Results"}
                      </h2>
                    </div>
                    <div className="inline-flex rounded-full border border-slate-200 bg-[#fbfcfe] p-1">
                      <button
                        type="button"
                        onClick={() => setDetailResultsFilter("event")}
                        className={cn(
                          "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                          detailResultsFilter === "event" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
                        )}
                      >
                        By event
                      </button>
                      <button
                        type="button"
                        onClick={() => setDetailResultsFilter("athlete")}
                        className={cn(
                          "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                          detailResultsFilter === "athlete" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
                        )}
                      >
                        By athlete
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {detailResultsFilter === "event"
                      ? detailData.metrics.map((metric) => (
                          <div key={metric.label} className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-base font-semibold text-slate-950">{metric.label}</p>
                                <p className="mt-1 text-sm text-slate-500">
                                  Best mark: <span className="font-medium text-slate-950">{metric.bestMark}</span> by {metric.leader}
                                </p>
                              </div>
                              <span className="rounded-full bg-[#eef5ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1f5fd1]">
                                {metric.movement}
                              </span>
                            </div>
                            <p className="mt-3 text-sm text-slate-500">{metric.completed}</p>
                          </div>
                        ))
                      : detailData.athleteRows.map((athleteRow, index) => (
                          <div key={athleteRow.athleteId} className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <div className={cn("flex size-10 items-center justify-center rounded-full text-[11px] font-semibold", AVATAR_SWATCHES[index % AVATAR_SWATCHES.length])}>
                                  {athleteInitials(athleteRow.athleteName)}
                                </div>
                                <div>
                                  <p className="font-medium text-slate-950">{athleteRow.athleteName}</p>
                                  <p className="text-sm text-slate-500">{athleteRow.primaryEvent}</p>
                                </div>
                              </div>
                              <span className="text-xs text-slate-500">{athleteRow.submittedAt}</span>
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              {athleteRow.results.map((result) => (
                                <div key={`${athleteRow.athleteId}-${result.label}`} className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm text-slate-500">{result.label}</span>
                                    <span className={cn(
                                      "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
                                      result.movement === "up"
                                        ? "bg-[#eef5ff] text-[#1f5fd1]"
                                        : result.movement === "down"
                                          ? "bg-[#fff1f2] text-[#e11d48]"
                                          : "bg-slate-100 text-slate-600"
                                    )}>
                                      {result.movement}
                                    </span>
                                  </div>
                                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">{result.value}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                  </div>
                </div>
            ) : (
              <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current structure</p>
                    <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Planned Tests + Scope</h2>
                  </div>
                  <Button type="button" className={PRIMARY_ACTION} onClick={() => openWizardForEdit(selectedTestWeek)}>
                    Edit test week
                  </Button>
                </div>
                <div className="mt-4 space-y-3">
                  {detailData.tests.map((test) => (
                    <div key={test.id} className="flex items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-[#fbfcfe] px-4 py-3">
                      <div>
                        <p className="font-medium text-slate-950">{test.name}</p>
                        <p className="text-sm text-slate-500">Unit: {test.unit}</p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Planned
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-[22px] border border-slate-200 bg-[#fbfcfe] p-4">
                  <p className="text-sm text-slate-500">Athletes in scope</p>
                  <div className="mt-3 space-y-2">
                    {detailAthletes.map((athlete, index) => (
                      <div key={athlete.id} className="flex items-center justify-between gap-3 rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className={cn("flex size-9 items-center justify-center rounded-full text-[11px] font-semibold", AVATAR_SWATCHES[index % AVATAR_SWATCHES.length])}>
                            {athleteInitials(athlete.name)}
                          </div>
                          <div>
                            <p className="font-medium text-slate-950">{athlete.name}</p>
                            <p className="text-sm text-slate-500">{athlete.primaryEvent}</p>
                          </div>
                        </div>
                        <span className="text-xs text-slate-500">{athlete.eventGroup}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <aside className="hidden rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] xl:block">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {hasResults ? "Coach summary" : "Template"}
              </p>
              <h2 className="text-lg font-semibold tracking-tight text-slate-950">
                {hasResults ? "Review focus" : "Assessment mix"}
              </h2>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              {hasResults ? (
                <>
                  <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                    <p className="text-slate-500">Use this view for</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">Event winners + athlete review</p>
                  </div>
                  <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                    <p className="text-slate-500">Primary pass</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">Check movement before editing next block</p>
                  </div>
                  <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                    <p className="text-slate-500">Athlete coverage</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">{detailData.athleteRows.length} submitted</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                    <p className="text-slate-500">Time tests</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">
                      {detailData.tests.filter((test) => test.unit === "time").length}
                    </p>
                  </div>
                  <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                    <p className="text-slate-500">Distance tests</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">
                      {detailData.tests.filter((test) => test.unit === "distance").length}
                    </p>
                  </div>
                  <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-3">
                    <p className="text-slate-500">Strength / jump tests</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">
                      {detailData.tests.filter((test) => test.unit === "weight" || test.unit === "height").length}
                    </p>
                  </div>
                </>
              )}
            </div>
          </aside>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2 pt-1">
        <h1 className="text-[2.35rem] leading-[0.95] font-semibold tracking-[-0.07em] text-slate-950 sm:text-[2.8rem]">
          Create Test Week
        </h1>
        <p className="max-w-xl text-[0.95rem] leading-6 text-slate-600">
          Set the window, add tests, and publish.
          {scopedTeamId ? ` Scoped to ${effectiveTeam?.name ?? "assigned team"}.` : ""}
        </p>
      </header>

      <div className="rounded-[22px] border border-slate-200 bg-white p-3 shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
        <div className="grid grid-cols-3 gap-3">
          {STEP_META.map(({ value, label }) => (
            <div key={value} className="space-y-1">
              <div className={cn("h-1.5 rounded-full", step >= value ? "bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)]" : "bg-slate-200")} />
              <div className="text-center">
                <p className="text-xs font-medium text-slate-950">{label}</p>
                <p className="text-[11px] text-slate-500">Step {value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <section className={cn("hidden lg:block", WIZARD_CARD)}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">Team</p>
            <p className="mt-1 text-lg font-semibold">{effectiveTeam?.name ?? "Assigned team"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Tests configured</p>
            <p className="mt-1 text-lg font-semibold">{tests.length}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Testing window</p>
            <p className="mt-1 text-lg font-semibold">{formatFriendlyDateWindow(draft.startDate, draft.endDate)}</p>
          </div>
        </div>
      </section>

      {step === 1 ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className={cn("space-y-4", WIZARD_CARD)}>
            <div>
              <h2 className="text-lg font-semibold">Setup</h2>
              <p className="text-sm text-muted-foreground">
                {isScopedCoach ? "Set the testing window." : "Set the name, team, and dates."}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Test week name</Label>
                <Input value={draft.name} placeholder="Week 4 Testing" onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} />
              </div>
              {scopedTeamId ? null : (
                <div className="space-y-2">
                  <Label>Team</Label>
                  <Select value={draft.teamId} onValueChange={(value) => setDraft((p) => ({ ...p, teamId: value }))}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{mockTeams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Start date</Label>
                <Input type="date" value={draft.startDate} onChange={(e) => setDraft((p) => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>End date</Label>
                <Input type="date" value={draft.endDate} onChange={(e) => setDraft((p) => ({ ...p, endDate: e.target.value }))} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Notes (optional)</Label>
                <Textarea rows={3} value={draft.notes} onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={() => setStep(2)} className={PRIMARY_ACTION}>
                Continue to build
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </Button>
            </div>
          </div>

          <aside className={cn("hidden xl:block", WIZARD_CARD)}>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Summary</p>
              <h3 className="text-lg font-semibold tracking-tight">Context</h3>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className={WIZARD_SUBCARD}>
                <p className="text-muted-foreground">Team</p>
                <p className="mt-1 font-medium">{effectiveTeam?.name ?? "Assigned team"}</p>
              </div>
              <div className={WIZARD_SUBCARD}>
                <p className="text-muted-foreground">Window</p>
                <p className="mt-1 font-medium">{formatFriendlyDateWindow(draft.startDate, draft.endDate)}</p>
              </div>
            </div>
          </aside>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className={cn("space-y-4", WIZARD_CARD)}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Build</h2>
                <p className="text-sm text-muted-foreground">Add and adjust tests.</p>
              </div>
              <Drawer>
                <DrawerTrigger asChild>
                  <Button type="button" size="icon" aria-label="Add test" className={PRIMARY_ACTION}>
                    <HugeiconsIcon icon={Add01Icon} className="size-5" />
                  </Button>
                </DrawerTrigger>
                <DrawerContent>
                  <DrawerHeader className="text-left">
                    <DrawerTitle>Add test</DrawerTitle>
                    <DrawerDescription>Create a custom test definition for this test week.</DrawerDescription>
                  </DrawerHeader>
                  <div className="space-y-3 px-4 pb-2">
                    <div className="space-y-2">
                      <Label>Test name</Label>
                      <Input value={newTestName} onChange={(e) => setNewTestName(e.target.value)} placeholder="e.g. 300m" />
                    </div>
                    <div className="space-y-2">
                      <Label>Unit</Label>
                      <Select value={newTestUnit} onValueChange={(value) => setNewTestUnit(value as TestDefinition["unit"])}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="time">time</SelectItem>
                          <SelectItem value="distance">distance</SelectItem>
                          <SelectItem value="weight">weight</SelectItem>
                          <SelectItem value="height">height</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DrawerFooter>
                    <DrawerClose asChild>
                      <Button type="button" onClick={addTest} className={PRIMARY_ACTION}>Add test</Button>
                    </DrawerClose>
                  </DrawerFooter>
                </DrawerContent>
              </Drawer>
            </div>

            <div className="space-y-2">
              {tests.map((test) => (
                <div key={test.id} className={cn("flex items-center justify-between gap-2", WIZARD_SUBCARD)}>
                  <div>
                    <p className="font-medium">{test.name}</p>
                    <p className="text-xs text-muted-foreground">Type: {test.unit}</p>
                  </div>
                  <Button type="button" size="icon" variant="outline" aria-label="Remove test" onClick={() => removeTest(test.id)} className={SECONDARY_ACTION}>
                    <HugeiconsIcon icon={Delete01Icon} className="size-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(1)} className={SECONDARY_ACTION}>
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
                Back
              </Button>
              <Button type="button" onClick={() => setStep(3)} className={PRIMARY_ACTION}>
                Continue to publish
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </Button>
            </div>
          </div>

          <aside className={cn("hidden xl:block", WIZARD_CARD)}>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Summary</p>
              <h3 className="text-lg font-semibold tracking-tight">Coverage</h3>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className={WIZARD_SUBCARD}>
                <p className="text-muted-foreground">Time tests</p>
                <p className="mt-1 font-medium">{testsByUnit.time}</p>
              </div>
              <div className={WIZARD_SUBCARD}>
                <p className="text-muted-foreground">Distance tests</p>
                <p className="mt-1 font-medium">{testsByUnit.distance}</p>
              </div>
              <div className={WIZARD_SUBCARD}>
                <p className="text-muted-foreground">Strength tests</p>
                <p className="mt-1 font-medium">{testsByUnit.weight}</p>
              </div>
              <div className={WIZARD_SUBCARD}>
                <p className="text-muted-foreground">Jump tests</p>
                <p className="mt-1 font-medium">{testsByUnit.height}</p>
              </div>
            </div>
          </aside>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className={cn("space-y-4", WIZARD_CARD)}>
            <div>
              <h2 className="text-lg font-semibold">{isScopedCoach ? "Publish" : "Review and Publish"}</h2>
              <p className="text-sm text-muted-foreground">
                {isScopedCoach ? "Publish to your assigned team." : "Confirm targeting and publish."}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className={WIZARD_SUBCARD}>
                <p className="text-sm text-muted-foreground">Tests configured</p>
                <p className="mt-1 text-xl font-semibold">{tests.length}</p>
              </div>
              <div className={WIZARD_SUBCARD}>
                <p className="text-sm text-muted-foreground">Testing window</p>
                <p className="mt-1 text-xl font-semibold">{formatFriendlyDateWindow(draft.startDate, draft.endDate)}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Team</Label>
                <Input value={effectiveTeam?.name ?? "Assigned team"} readOnly />
              </div>
              {isScopedCoach ? null : (
                <>
                  <div className="space-y-2">
                    <Label>Assign to</Label>
                    <Select value={assignTarget} onValueChange={(value) => setAssignTarget(value as AssignTarget)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="team">Whole team</SelectItem>
                        <SelectItem value="subgroup">Subgroup</SelectItem>
                        <SelectItem value="selected">Selected athletes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {assignTarget === "subgroup" ? (
                    <div className="space-y-2">
                      <Label>Subgroup</Label>
                      <Select value={assignSubgroup} onValueChange={(value) => setAssignSubgroup(value as EventGroup)}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Sprint">Sprint</SelectItem>
                          <SelectItem value="Mid">Middle</SelectItem>
                          <SelectItem value="Distance">Distance</SelectItem>
                          <SelectItem value="Jumps">Jumps</SelectItem>
                          <SelectItem value="Throws">Throws</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {assignTarget === "selected" ? (
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Selected athletes</Label>
                      <div className={cn("grid gap-2 sm:grid-cols-2", WIZARD_SUBCARD)}>
                        {teamAthletes.map((athlete) => (
                          <button
                            key={athlete.id}
                            type="button"
                            className={cn(
                              "flex items-center justify-between rounded-lg border px-3 py-2 text-left",
                              selectedAthleteIds.includes(athlete.id) ? "border-primary bg-primary/5" : "border-border",
                            )}
                            onClick={() =>
                              setSelectedAthleteIds((prev) =>
                                prev.includes(athlete.id) ? prev.filter((id) => id !== athlete.id) : [...prev, athlete.id],
                              )
                            }
                          >
                            <span className="text-sm font-medium">{athlete.name}</span>
                            <Badge variant="outline">{athlete.eventGroup}</Badge>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(2)} className={SECONDARY_ACTION}>
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
                Back
              </Button>
              <Button type="button" onClick={publishTestWeek} className={PRIMARY_ACTION}>Publish Test Week</Button>
            </div>
            {publishedCount !== null ? (
              <div className="rounded-[22px] border border-[#cfe0ff] bg-[#f7faff] p-4">
                <p className="font-semibold">Test week published to {publishedCount} athletes</p>
                <div className="mt-3 flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setView("list")} className={SECONDARY_ACTION}>View test weeks</Button>
                </div>
              </div>
            ) : null}
          </div>

          <aside className={cn("hidden xl:block", WIZARD_CARD)}>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Summary</p>
              <h3 className="text-lg font-semibold tracking-tight">Publish Check</h3>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className={WIZARD_SUBCARD}>
                <p className="text-muted-foreground">Name</p>
                <p className="mt-1 font-medium">{draft.name || "Untitled test week"}</p>
              </div>
              <div className={WIZARD_SUBCARD}>
                <p className="text-muted-foreground">Tests</p>
                <p className="mt-1 font-medium">{tests.map((test) => test.name).join(", ")}</p>
              </div>
              <div className={WIZARD_SUBCARD}>
                <p className="text-muted-foreground">Audience</p>
                <p className="mt-1 font-medium">
                  {isScopedCoach ? `Whole team (${teamAthletes.length})` : `${assignedCount} athletes targeted`}
                </p>
              </div>
            </div>
          </aside>
        </section>
      ) : null}
    </div>
  )
}
