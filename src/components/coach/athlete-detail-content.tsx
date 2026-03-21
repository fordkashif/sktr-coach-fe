"use client"

import { FilterHorizontalIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useMemo, useState } from "react"
import { BarChart, LineChart } from "@mui/x-charts"
import { ReadinessBadge } from "@/components/badges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  mockLogs,
  mockPRs,
  mockTestWeekResults,
  mockTrendSeries,
  type Athlete,
  type LogEntry,
  type PR,
  type TestWeekResult,
  type TrendPoint,
} from "@/lib/mock-data"

const logTypes = ["All", "Strength", "Run", "Splits", "Jumps", "Throws"] as const
type LogTypeFilter = (typeof logTypes)[number]

const chartSx = {
  "& .MuiChartsAxis-line, & .MuiChartsAxis-tick": {
    stroke: "#cbd5e1",
  },
  "& .MuiChartsAxis-tickLabel": {
    fill: "#64748b",
    fontSize: 11,
    fontFamily: "inherit",
  },
  "& .MuiChartsGrid-line": {
    stroke: "#dbe4f0",
    strokeDasharray: "4 6",
  },
  "& .MuiBarElement-root": {
    rx: 8,
    ry: 8,
  },
  "& .MuiLineElement-root": {
    strokeLinecap: "round",
  },
}

const ageGroupFor = (age: number) => {
  if (age <= 18) return "U20"
  if (age <= 22) return "U23"
  return "Senior"
}

export type AthleteDetailData = {
  prs: PR[]
  logs: LogEntry[]
  testWeek: TestWeekResult | null
  trend: TrendPoint[]
}

type CoachAthleteDetailContentProps = {
  athlete: Athlete
  data?: AthleteDetailData
}

export function CoachAthleteDetailContent({ athlete, data }: CoachAthleteDetailContentProps) {
  const [logType, setLogType] = useState<LogTypeFilter>("All")
  const [dateRange, setDateRange] = useState("Last 7 days")

  useEffect(() => {
    ;(window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }).__PACELAB_MOBILE_DETAIL_MODE = true
    window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: true } }))
    return () => {
      ;(window as typeof window & { __PACELAB_MOBILE_DETAIL_MODE?: boolean }).__PACELAB_MOBILE_DETAIL_MODE = false
      window.dispatchEvent(new CustomEvent("pacelab:mobile-detail-mode", { detail: { active: false } }))
    }
  }, [])

  const athletePrs = data?.prs ?? mockPRs.filter((pr) => pr.athleteId === athlete.id)
  const topPrs = athletePrs.slice(0, 4)
  const athleteLogs = data?.logs ?? mockLogs.filter((log) => log.athleteId === athlete.id)

  const filteredLogs = useMemo(() => {
    if (logType === "All") return athleteLogs
    return athleteLogs.filter((log) => log.type === logType)
  }, [athleteLogs, logType])

  const logSummary = athleteLogs.reduce<Record<string, number>>((acc, log) => {
    acc[log.type] = (acc[log.type] ?? 0) + 1
    return acc
  }, {})

  const testWeek = data?.testWeek ?? mockTestWeekResults.find((row) => row.athleteId === athlete.id) ?? null
  const trend = data?.trend ?? mockTrendSeries[athlete.id] ?? []
  const latestReadinessDate = trend[trend.length - 1]?.date ?? athlete.lastWellness
  const totalLogs = athleteLogs.length
  const logMixRows = Object.entries(logSummary)
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => ({ type, count }))
  const trendDates = trend.map((point) =>
    new Date(point.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  )
  const overviewMetrics = [
    { label: "Age group", value: ageGroupFor(athlete.age) },
    { label: "Primary event", value: athlete.primaryEvent },
    { label: "Log entries", value: totalLogs },
    { label: "Latest check-in", value: latestReadinessDate },
  ]

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="space-y-4 pt-1">
        <div className="flex items-start gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-[24px] bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] text-lg font-semibold text-white shadow-[0_14px_30px_rgba(31,140,255,0.24)]">
            {athlete.name
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div className="min-w-0 space-y-2">
            <h1 className="text-[2.35rem] leading-[0.95] font-semibold tracking-[-0.07em] text-slate-950 sm:text-[2.8rem]">
              {athlete.name}
            </h1>
            <p className="max-w-xl text-[0.95rem] leading-6 text-slate-600">
              Coach-facing athlete detail for readiness, recent work, testing movement, and performance progression.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <ReadinessBadge status={athlete.readiness} />
              <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                {athlete.primaryEvent}
              </span>
              <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                {ageGroupFor(athlete.age)}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
          <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
            <div className="space-y-1 border-b border-slate-200 pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current signal</p>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Coach Summary</h2>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-4">
                <p className="text-sm text-slate-500">Plan adherence</p>
                <p className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-slate-950">{athlete.adherence}%</p>
                <div className="mt-3 h-2 rounded-full bg-slate-200">
                  <div
                    className="h-2 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)]"
                    style={{ width: `${athlete.adherence}%` }}
                  />
                </div>
              </div>
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-4">
                <p className="text-sm text-slate-500">Testing status</p>
                <p className="mt-1 text-xl font-semibold tracking-[-0.04em] text-slate-950">
                  {testWeek ? "Latest results loaded" : "No current test week"}
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  {testWeek ? `30m ${testWeek.thirtyM?.value ?? "-"} | CMJ ${testWeek.cmj?.value ?? "-"}` : "No recent benchmark data available."}
                </p>
              </div>
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-4">
                <p className="text-sm text-slate-500">Last wellness</p>
                <p className="mt-1 text-xl font-semibold tracking-[-0.04em] text-slate-950">{athlete.lastWellness}</p>
              </div>
              <div className="rounded-[20px] border border-slate-200 bg-[#fbfcfe] p-4">
                <p className="text-sm text-slate-500">Recent work mix</p>
                <p className="mt-1 text-xl font-semibold tracking-[-0.04em] text-slate-950">{totalLogs} entries</p>
                <p className="mt-2 text-sm text-slate-500">
                  {logMixRows[0] ? `${logMixRows[0].type} is the dominant recent work type.` : "No recent work logged."}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {overviewMetrics.map((item) => (
              <div key={item.label} className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                <p className="mt-2 text-lg font-semibold tracking-[-0.04em] text-slate-950">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </header>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto rounded-[22px] border border-slate-200 bg-white p-2 shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
          <TabsTrigger value="overview" className="rounded-full px-4 py-2 data-[state=active]:bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] data-[state=active]:text-white data-[state=active]:shadow-[0_10px_22px_rgba(31,140,255,0.22)]">Overview</TabsTrigger>
          <TabsTrigger value="logs" className="rounded-full px-4 py-2 data-[state=active]:bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] data-[state=active]:text-white data-[state=active]:shadow-[0_10px_22px_rgba(31,140,255,0.22)]">Logs</TabsTrigger>
          <TabsTrigger value="test-weeks" className="rounded-full px-4 py-2 data-[state=active]:bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] data-[state=active]:text-white data-[state=active]:shadow-[0_10px_22px_rgba(31,140,255,0.22)]">Test Weeks</TabsTrigger>
          <TabsTrigger value="trends" className="rounded-full px-4 py-2 data-[state=active]:bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] data-[state=active]:text-white data-[state=active]:shadow-[0_10px_22px_rgba(31,140,255,0.22)]">Trends</TabsTrigger>
          <TabsTrigger value="prs" className="rounded-full px-4 py-2 data-[state=active]:bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] data-[state=active]:text-white data-[state=active]:shadow-[0_10px_22px_rgba(31,140,255,0.22)]">PRs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <section className="grid gap-4 xl:grid-cols-5">
            <div className="space-y-4 xl:col-span-3">
              <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">Performance Summary</h2>
                  <p className="text-sm text-slate-500">Top personal records currently visible to the coach.</p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {topPrs.map((pr) => (
                    <div key={pr.id} className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-slate-950">{pr.event}</p>
                        <Badge variant="outline" className="rounded-full border-slate-200 text-slate-600">{pr.type}</Badge>
                      </div>
                      <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">{pr.bestValue}</p>
                      <p className="text-xs text-slate-500">{pr.date}</p>
                    </div>
                  ))}
                  {topPrs.length === 0 ? <p className="text-sm text-slate-500">No PRs recorded yet.</p> : null}
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">Recent Work Mix</h2>
                  <p className="text-sm text-slate-500">Recent activity distribution for strength, running, and event work.</p>
                </div>
                <div className="mt-4 overflow-hidden rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] p-2.5">
                  {logMixRows.length > 0 ? (
                    <BarChart
                      dataset={logMixRows}
                      xAxis={[{ scaleType: "band", dataKey: "type" }]}
                      yAxis={[{ min: 0 }]}
                      series={[{ dataKey: "count", label: "Entries", color: "#1f8cff" }]}
                      grid={{ horizontal: true }}
                      margin={{ left: 28, right: 16, top: 18, bottom: 24 }}
                      height={240}
                      sx={chartSx}
                    />
                  ) : (
                    <div className="px-4 py-6 text-sm text-slate-500">No recent logs available.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4 xl:col-span-2">
              <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">Readiness Snapshot</h2>
                  <p className="text-sm text-slate-500">Current coach-facing health and plan adherence view.</p>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-3.5">
                    <p className="text-sm text-slate-500">Status</p>
                    <div className="mt-2">
                      <ReadinessBadge status={athlete.readiness} />
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-3.5">
                    <p className="text-sm text-slate-500">Plan Adherence</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">{athlete.adherence}%</p>
                  </div>
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-3.5">
                    <p className="text-sm text-slate-500">Last wellness</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">{athlete.lastWellness}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">Test Week Snapshot</h2>
                  <p className="text-sm text-slate-500">Most recent results from the latest test window.</p>
                </div>
                {testWeek ? (
                  <div className="mt-4 space-y-2">
                    {[
                      { label: "30m", result: testWeek.thirtyM?.value, trend: testWeek.thirtyM?.change },
                      { label: "Flying 30m", result: testWeek.flyingThirtyM?.value, trend: testWeek.flyingThirtyM?.change },
                      { label: "150m", result: testWeek.oneHundredFiftyM?.value, trend: testWeek.oneHundredFiftyM?.change },
                    ].map((item) => (
                      <div key={item.label} className="rounded-[18px] border border-slate-200 bg-slate-50 p-3.5">
                        <p className="font-medium text-slate-950">{item.label}</p>
                        <p className="text-sm text-slate-500">
                          {item.result ?? "-"} | Trend {item.trend ?? "-"}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">No test week results found for this athlete.</p>
                )}
              </div>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <section className="space-y-4 rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Logs</h2>
                <p className="text-sm text-slate-500">Filter by date range and log type.</p>
              </div>
              <Drawer>
                <DrawerTrigger asChild>
                  <Button type="button" size="icon" variant="outline" className="border-slate-200 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950 md:hidden" aria-label="Open log filters">
                    <HugeiconsIcon icon={FilterHorizontalIcon} className="size-5" />
                  </Button>
                </DrawerTrigger>
                <DrawerContent>
                  <DrawerHeader className="text-left">
                    <DrawerTitle>Filter Logs</DrawerTitle>
                    <DrawerDescription>Choose a date range and log type for this athlete.</DrawerDescription>
                  </DrawerHeader>
                  <div className="space-y-3 px-4 pb-2">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Date range</p>
                      <Select value={dateRange} onValueChange={setDateRange}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Last 7 days">Last 7 days</SelectItem>
                          <SelectItem value="Last 30 days">Last 30 days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Log type</p>
                      <Select value={logType} onValueChange={(value) => setLogType(value as LogTypeFilter)}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {logTypes.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DrawerFooter>
                    <Button type="button" variant="outline" className="border-slate-200 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950" onClick={() => { setDateRange("Last 7 days"); setLogType("All") }}>
                      Clear filters
                    </Button>
                    <DrawerClose asChild>
                      <Button type="button" className="bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] text-white shadow-[0_10px_22px_rgba(31,140,255,0.22)] hover:opacity-95">Apply filters</Button>
                    </DrawerClose>
                  </DrawerFooter>
                </DrawerContent>
              </Drawer>
            </div>
            <div className="space-y-4">
              <div className="hidden gap-3 sm:grid-cols-2 md:grid">
                <Select value={dateRange} onValueChange={setDateRange}>
                  <SelectTrigger className="w-full border-slate-200 bg-slate-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Last 7 days">Last 7 days</SelectItem>
                    <SelectItem value="Last 30 days">Last 30 days</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={logType} onValueChange={(value) => setLogType(value as LogTypeFilter)}>
                  <SelectTrigger className="w-full border-slate-200 bg-slate-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {logTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:hidden">
                <p className="text-xs text-slate-500">Showing: {dateRange} | {logType}</p>
              </div>
              <div className="space-y-2">
                {filteredLogs.map((log) => (
                  <div key={log.id} className="rounded-[18px] border border-slate-200 bg-white p-3.5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                    <p className="font-medium text-slate-950">{log.title}</p>
                    <p className="text-xs text-slate-500">
                      {log.type} | {log.date}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{log.details}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="test-weeks">
          <section className="space-y-3 rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Test Weeks</h2>
              <p className="text-sm text-slate-500">Current week compared with previous trend arrows.</p>
            </div>
            <div>
              {testWeek ? (
                <>
                  <div className="space-y-2 md:hidden">
                    {[
                      { label: "30m", result: testWeek.thirtyM?.value, trend: testWeek.thirtyM?.change },
                      { label: "Flying 30m", result: testWeek.flyingThirtyM?.value, trend: testWeek.flyingThirtyM?.change },
                      { label: "150m", result: testWeek.oneHundredFiftyM?.value, trend: testWeek.oneHundredFiftyM?.change },
                      { label: "Squat 1RM", result: testWeek.squat1RM?.value, trend: testWeek.squat1RM?.change },
                      { label: "CMJ", result: testWeek.cmj?.value, trend: testWeek.cmj?.change },
                    ].map((item) => (
                      <div key={item.label} className="rounded-[18px] border border-slate-200 bg-white p-3.5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                        <p className="font-medium text-slate-950">{item.label}</p>
                        <p className="text-sm text-slate-700">Result: {item.result ?? "-"}</p>
                        <p className="text-xs text-slate-500">Trend: {item.trend ?? "-"}</p>
                      </div>
                    ))}
                  </div>
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Test</TableHead>
                          <TableHead>Result</TableHead>
                          <TableHead>Trend</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell>30m</TableCell>
                          <TableCell>{testWeek.thirtyM?.value ?? "-"}</TableCell>
                          <TableCell>{testWeek.thirtyM?.change ?? "-"}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Flying 30m</TableCell>
                          <TableCell>{testWeek.flyingThirtyM?.value ?? "-"}</TableCell>
                          <TableCell>{testWeek.flyingThirtyM?.change ?? "-"}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>150m</TableCell>
                          <TableCell>{testWeek.oneHundredFiftyM?.value ?? "-"}</TableCell>
                          <TableCell>{testWeek.oneHundredFiftyM?.change ?? "-"}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Squat 1RM</TableCell>
                          <TableCell>{testWeek.squat1RM?.value ?? "-"}</TableCell>
                          <TableCell>{testWeek.squat1RM?.change ?? "-"}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>CMJ</TableCell>
                          <TableCell>{testWeek.cmj?.value ?? "-"}</TableCell>
                          <TableCell>{testWeek.cmj?.change ?? "-"}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">No test week results found for this athlete.</p>
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="prs">
          <section className="space-y-3 rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
            <div>
              <h2 className="text-base font-semibold text-slate-950">PRs</h2>
              <p className="text-sm text-slate-500">Personal records by event.</p>
            </div>
            <div className="space-y-2 md:hidden">
              {athletePrs.map((pr) => (
                <div key={pr.id} className="rounded-[18px] border border-slate-200 bg-white p-3.5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-950">{pr.event}</p>
                    <Badge variant="outline" className="rounded-full border-slate-200 text-slate-600">{pr.type}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{pr.bestValue}</p>
                  <p className="text-xs text-slate-500">{pr.wind ? `Legal (${pr.wind})` : pr.legal ? "Legal" : "N/A"}</p>
                  <p className="text-xs text-slate-500">{pr.date}</p>
                </div>
              ))}
            </div>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Best Value</TableHead>
                    <TableHead>Legal/Wind</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Training vs Competition</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {athletePrs.map((pr) => (
                    <TableRow key={pr.id}>
                      <TableCell>{pr.event}</TableCell>
                      <TableCell>{pr.bestValue}</TableCell>
                      <TableCell>{pr.wind ? `Legal (${pr.wind})` : pr.legal ? "Legal" : "N/A"}</TableCell>
                      <TableCell>{pr.date}</TableCell>
                      <TableCell>{pr.type}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <section className="space-y-3 rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Progress Trends</h2>
              <p className="text-sm text-slate-500">Readiness, fatigue, and load trend lines.</p>
            </div>
            <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] p-2.5">
              <LineChart
                xAxis={[{ scaleType: "point", data: trendDates }]}
                yAxis={[{ min: 0, max: 100 }]}
                series={[
                  { data: trend.map((point) => point.readiness), label: "Readiness", color: "#1f8cff", curve: "monotoneX" },
                  { data: trend.map((point) => point.fatigue), label: "Fatigue", color: "#0f172a", curve: "monotoneX" },
                  { data: trend.map((point) => point.trainingLoad), label: "Load", color: "#4759ff", curve: "monotoneX" },
                ]}
                grid={{ horizontal: true }}
                margin={{ left: 28, right: 16, top: 18, bottom: 24 }}
                height={320}
                sx={chartSx}
              />
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}
