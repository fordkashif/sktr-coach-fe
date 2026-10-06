import type {
  GuardianAnnouncement,
  GuardianAttendanceRow,
  GuardianCalendarItem,
  GuardianCoach,
  GuardianHealth,
  GuardianPlanDay,
  GuardianResults,
  GuardianWeek,
} from "@/lib/data/guardian/types"
import { mockAthleteTeam, mockGuardianHealthRule } from "@/lib/data/guardian/mock-guardian-store"
import { guardianSeesHealth } from "@/lib/guardian/health-visibility"
import { mockAthletes, mockPRs, mockTestWeekResults } from "@/lib/mock-data"

/** Demo content for the guardian screens: one athlete at a time, dated around today. */

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + days)
  return iso(date)
}

function today() {
  return iso(new Date())
}

const WEEK_BY_GROUP: Record<string, Array<{ title: string; focus: string; blocks: string[] } | null>> = {
  Throws: [
    { title: "Technique and medicine ball", focus: "Rhythm through the circle", blocks: ["Warm-up and mobility", "Stand throws 8 x", "Full throws 10 x", "Medicine ball 3 x 8"] },
    { title: "Gym: strength", focus: "Lower body", blocks: ["Back squat 4 x 5", "Clean pull 4 x 3", "Core circuit"] },
    null,
    { title: "Full throws", focus: "Competition rhythm", blocks: ["Warm-up", "Full throws 12 x", "Short sprints 4 x 20 m"] },
    { title: "Gym: power", focus: "Upper body", blocks: ["Bench press 4 x 4", "Push press 3 x 5", "Rotational throws 3 x 6"] },
    { title: "Easy throws and recovery", focus: "Light and loose", blocks: ["Drills 20 min", "Easy throws 6 x", "Stretching"] },
    null,
  ],
  default: [
    { title: "Acceleration and block starts", focus: "First 30 m", blocks: ["Warm-up and drills", "Block starts 6 x 30 m", "Flying 20 m 4 x"] },
    { title: "Gym: strength", focus: "Lower body", blocks: ["Trap bar deadlift 4 x 4", "Split squat 3 x 6", "Core circuit"] },
    null,
    { title: "Speed endurance", focus: "Holding form", blocks: ["Warm-up", "3 x 150 m, full recovery", "Cool-down"] },
    { title: "Technique", focus: "Relaxed top speed", blocks: ["Wicket runs 6 x", "Bends 4 x 60 m"] },
    { title: "Tempo and recovery", focus: "Easy running", blocks: ["8 x 100 m tempo", "Stretching"] },
    null,
  ],
}

/** Monday of the week a day is in. */
export function weekStartOf(day: string): string {
  const date = new Date(`${day}T12:00:00`)
  const offset = (date.getDay() + 6) % 7
  return addDays(day, -offset)
}

export function mockGuardianWeek(athleteId: string, weekStart: string): GuardianWeek {
  const team = mockAthleteTeam(athleteId)
  const template = WEEK_BY_GROUP[team?.eventGroup ?? ""] ?? WEEK_BY_GROUP.default
  const now = today()
  const healthVisible = guardianSeesHealth(mockGuardianHealthRule(athleteId))
  const days: GuardianPlanDay[] = template.map((slot, index) => {
    const date = addDays(weekStart, index)
    if (!slot) return { date, title: null, focus: null, blocks: [], state: "rest", skipReason: null }
    // One skipped session in a past week keeps the demo honest: Tuesday's gym was missed for a cold.
    const skipped = index === 1 && date < now
    const state = skipped ? "skipped" : date < now ? "done" : date === now ? "today" : "planned"
    return { date, title: slot.title, focus: slot.focus, blocks: slot.blocks, state, skipReason: skipped && healthVisible ? "sick" : null }
  })
  return {
    from: weekStart,
    to: addDays(weekStart, 6),
    planName: team?.eventGroup === "Throws" ? "Throws: competition block" : "Speed block",
    days,
    done: days.filter((day) => day.state === "done").length,
    skipped: days.filter((day) => day.state === "skipped").length,
    planned: days.filter((day) => day.state !== "rest").length,
  }
}

export function mockGuardianCoaches(athleteId: string): GuardianCoach[] {
  const team = mockAthleteTeam(athleteId)
  if (team?.id === "t4") {
    return [
      { name: "Coach Rivera", role: "lead", email: "coach@pacelab.local" },
      { name: "Coach Asha", role: "assistant", email: null },
    ]
  }
  return [{ name: "Coach Smith", role: "lead", email: null }]
}

export function mockGuardianResults(athleteId: string): GuardianResults {
  const athlete = mockAthletes.find((item) => item.id === athleteId)
  const event = athlete?.primaryEvent ?? "100m"
  const records = mockPRs.filter((record) => record.athleteId === athleteId)
  const now = today()
  const throws = athlete?.eventGroup === "Throws"
  const marks = throws ? ["13.42m", "13.18m", "12.95m"] : ["11.34s", "11.41s", "11.52s"]
  const tests = mockTestWeekResults.find((result) => result.athleteId === athleteId)
  return {
    upcoming: [
      { id: `mock-comp-${athleteId}-1`, name: "National Stadium Open", startDate: addDays(now, 9), endDate: addDays(now, 9), place: "National Stadium, Kingston", events: [event] },
      { id: `mock-comp-${athleteId}-2`, name: "Club Championships", startDate: addDays(now, 30), endDate: addDays(now, 31), place: "Stadium East", events: [] },
    ],
    results: [
      { id: `mock-res-${athleteId}-1`, eventLabel: event, mark: marks[0], date: addDays(now, -6), source: "Competition", where: "Spring Classic", place: 2, wind: throws ? null : "+0.8" },
      { id: `mock-res-${athleteId}-2`, eventLabel: event, mark: marks[1], date: addDays(now, -20), source: "Competition", where: "Development Meet", place: 4, wind: throws ? null : "+1.1" },
      { id: `mock-res-${athleteId}-3`, eventLabel: event, mark: marks[2], date: addDays(now, -41), source: "Training", where: null, place: null, wind: null },
    ],
    records: records.length > 0 ? records.map((record) => ({ eventLabel: record.event, mark: record.bestValue, date: addDays(now, -6) })) : [{ eventLabel: event, mark: marks[0], date: addDays(now, -6) }],
    goals: [
      { id: `mock-goal-${athleteId}-1`, eventLabel: event, target: throws ? "14.00m" : "11.20s", targetDate: addDays(now, 75), achievedOn: null },
      { id: `mock-goal-${athleteId}-2`, eventLabel: "Back squat", target: "90kg", targetDate: null, achievedOn: addDays(now, -15) },
    ],
    testWeeks: [
      {
        id: `mock-tw-${athleteId}`,
        name: "Autumn test week",
        startDate: addDays(now, -14),
        endDate: addDays(now, -8),
        status: "closed",
        tests: tests
          ? [
              { name: "30 m sprint", value: tests.thirtyM?.value ?? null },
              { name: "Flying 30 m", value: tests.flyingThirtyM?.value ?? null },
              { name: "Back squat", value: tests.squat1RM?.value ?? null },
              { name: "Jump height", value: tests.cmj?.value ?? null },
            ]
          : [
              { name: "30 m sprint", value: "4.41s" },
              { name: "Standing long jump", value: "2.38m" },
              { name: "Overhead shot throw", value: null },
            ],
      },
    ],
  }
}

export function mockGuardianAttendance(athleteId: string): GuardianAttendanceRow[] {
  const healthVisible = guardianSeesHealth(mockGuardianHealthRule(athleteId))
  const now = today()
  const pattern: Array<[number, GuardianAttendanceRow["status"], string | null]> = [
    [-1, "present", null],
    [-2, "present", null],
    [-4, "late", null],
    [-6, "absent", "At home with a cold"],
    [-7, "present", null],
    [-8, "present", null],
    [-11, "excused", "School exam"],
    [-13, "present", null],
  ]
  return pattern.map(([offset, status, reason]) => ({ date: addDays(now, offset), status, reason: healthVisible ? reason : null }))
}

export function mockGuardianAnnouncements(teamNames: string[]): GuardianAnnouncement[] {
  const now = new Date()
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000).toISOString()
  const team = teamNames[0] ?? "Your team"
  return [
    { id: "mock-ann-1", body: "Saturday's session moves to 9 in the morning. Bring spikes and a water bottle.", from: team, createdAt: at(5) },
    { id: "mock-ann-2", body: "Club kit orders close on Friday. Order forms are at the front desk.", from: "Whole club", createdAt: at(52) },
    { id: "mock-ann-3", body: "Well done to everyone who competed at the Spring Classic.", from: team, createdAt: at(150) },
  ]
}

export function mockGuardianCalendar(athleteId: string): GuardianCalendarItem[] {
  const now = today()
  const results = mockGuardianResults(athleteId)
  return [
    { id: "mock-ev-1", kind: "event" as const, title: "Team photo", startsOn: addDays(now, 3), endsOn: addDays(now, 3), startTime: "17:00", place: "Main track" },
    ...results.upcoming.map((meet) => ({ id: meet.id, kind: "competition" as const, title: meet.name, startsOn: meet.startDate, endsOn: meet.endDate, startTime: null, place: meet.place })),
    { id: "mock-ev-2", kind: "event" as const, title: "Parents evening", startsOn: addDays(now, 16), endsOn: addDays(now, 16), startTime: "18:30", place: "Clubhouse" },
    { id: "mock-tw-next", kind: "test-week" as const, title: "Winter test week", startsOn: addDays(now, 40), endsOn: addDays(now, 46), startTime: null, place: null },
  ].sort((left, right) => left.startsOn.localeCompare(right.startsOn))
}

export function mockGuardianHealth(athleteId: string): GuardianHealth {
  const rule = mockGuardianHealthRule(athleteId)
  if (!guardianSeesHealth(rule)) return { visible: false, rule, checkIns: [], painReports: [], availability: [], medicalNotes: null }
  const now = today()
  return {
    visible: true,
    rule,
    checkIns: [
      { date: now, readiness: "green", sleepHours: 8.5, note: null },
      { date: addDays(now, -1), readiness: "green", sleepHours: 8, note: null },
      { date: addDays(now, -2), readiness: "yellow", sleepHours: 6.5, note: "Tired after the school trip" },
      { date: addDays(now, -3), readiness: "green", sleepHours: 8, note: null },
      { date: addDays(now, -5), readiness: "yellow", sleepHours: 7, note: null },
    ],
    painReports: [{ id: "mock-pain-1", areas: ["Right shoulder"], severity: 2, startedOn: addDays(now, -9), impact: "modified", open: false, note: "Sore after throws, fine with lighter work" }],
    availability: [{ id: "mock-av-1", kind: "sick", startsOn: addDays(now, -6), endsOn: addDays(now, -6), note: "Cold", current: false }],
    medicalNotes: "Mild asthma. Carries an inhaler.",
  }
}
