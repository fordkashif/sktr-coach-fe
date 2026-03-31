export type Role = "coach" | "athlete" | "club-admin" | "platform-admin"

export type EventGroup = "Sprint" | "Mid" | "Distance" | "Jumps" | "Throws"

export type Readiness = "green" | "yellow" | "red"

export interface Athlete {
  id: string
  name: string
  age: number
  eventGroup: EventGroup
  primaryEvent: string
  readiness: Readiness
  adherence: number
  lastWellness: string
  teamId: string
}

export interface Team {
  id: string
  name: string
  eventGroup: EventGroup
  athleteCount: number
  disciplines?: string[]
}

export interface PR {
  id: string
  athleteId: string
  athleteName: string
  event: string
  category: EventGroup | "Strength"
  bestValue: string
  previousValue?: string
  date: string
  legal: boolean
  wind?: string
  type: "Training" | "Competition"
}

export interface WellnessEntry {
  id: string
  athleteId: string
  date: string
  sleep: number
  soreness: number
  fatigue: number
  mood: number
  stress: number
  notes?: string
  readiness: Readiness
}

export interface LogEntry {
  id: string
  athleteId: string
  type: "Strength" | "Run" | "Splits" | "Jumps" | "Throws"
  title: string
  date: string
  details: string
}

export interface TestWeekResult {
  athleteId: string
  athleteName: string
  thirtyM?: { value: string; change: "up" | "down" | "same" }
  flyingThirtyM?: { value: string; change: "up" | "down" | "same" }
  oneHundredFiftyM?: { value: string; change: "up" | "down" | "same" }
  squat1RM?: { value: string; change: "up" | "down" | "same" }
  cmj?: { value: string; change: "up" | "down" | "same" }
}

export interface TrainingPlanSummary {
  id: string
  name: string
  teamId: string
  startDate: string
  weeks: number
  assignedTo: "team" | "athlete"
  assignedAthleteIds?: string[]
}

export interface AthletePlanDay {
  id: string
  dayLabel: string
  date: string
  title: string
  type: "Track" | "Gym" | "Recovery" | "Technical" | "Mixed"
  focus: string
  status: "completed" | "scheduled" | "up-next"
  duration: string
  location: string
  coachNote?: string
  blockPreview: string[]
}

export interface AthletePlanWeek {
  weekNumber: number
  emphasis: string
  status: "completed" | "current" | "up-next"
  days: AthletePlanDay[]
}

export interface AthleteTrainingPlanDetail {
  planId: string
  weeks: AthletePlanWeek[]
}

export interface TrendPoint {
  date: string
  readiness: number
  fatigue: number
  trainingLoad: number
}

export interface SessionTargetRow {
  label: string
  target: string
  helper?: string
}

export interface SessionBlock {
  id: string
  type: "Strength" | "Run" | "Sprint" | "Jumps" | "Throws"
  name: string
  focus: string
  coachNote: string
  previousResult?: string
  rest?: string
  rows: SessionTargetRow[]
}

export interface CurrentSession {
  id: string
  title: string
  status: "not-started" | "in-progress" | "completed"
  scheduledFor: string
  estimatedDuration: string
  coachNote: string
  blocks: SessionBlock[]
}

export const mockTeams: Team[] = [
  { id: "t1", name: "Sprint Group", eventGroup: "Sprint", athleteCount: 12, disciplines: ["100m", "200m", "400m", "Hurdles"] },
  { id: "t2", name: "Distance Group", eventGroup: "Distance", athleteCount: 10, disciplines: ["800m", "1500m", "5000m"] },
  { id: "t3", name: "Jumps Group", eventGroup: "Jumps", athleteCount: 8, disciplines: ["Long Jump", "High Jump", "Triple Jump"] },
  { id: "t4", name: "Throws Group", eventGroup: "Throws", athleteCount: 12, disciplines: ["Shot Put", "Discus", "Javelin"] },
]

export function getTeamDisciplineLabel(team: Team | null | undefined) {
  if (!team) return ""
  if (team.disciplines?.length) return team.disciplines.join(" / ")
  return team.eventGroup
}

export const mockAthletes: Athlete[] = [
  { id: "a1", name: "Marcus Johnson", age: 22, eventGroup: "Sprint", primaryEvent: "100m", readiness: "green", adherence: 92, lastWellness: "8:15 AM", teamId: "t1" },
  { id: "a2", name: "Sarah Chen", age: 20, eventGroup: "Sprint", primaryEvent: "200m", readiness: "green", adherence: 88, lastWellness: "7:45 AM", teamId: "t1" },
  { id: "a3", name: "David Okafor", age: 23, eventGroup: "Sprint", primaryEvent: "400m", readiness: "yellow", adherence: 75, lastWellness: "9:00 AM", teamId: "t1" },
  { id: "a4", name: "Emily Rodriguez", age: 21, eventGroup: "Distance", primaryEvent: "1500m", readiness: "green", adherence: 95, lastWellness: "6:30 AM", teamId: "t2" },
  { id: "a5", name: "James Wright", age: 24, eventGroup: "Distance", primaryEvent: "5000m", readiness: "yellow", adherence: 70, lastWellness: "8:00 AM", teamId: "t2" },
  { id: "a6", name: "Ava Thompson", age: 19, eventGroup: "Jumps", primaryEvent: "Long Jump", readiness: "green", adherence: 85, lastWellness: "7:30 AM", teamId: "t3" },
  { id: "a7", name: "Noah Martinez", age: 22, eventGroup: "Jumps", primaryEvent: "High Jump", readiness: "red", adherence: 60, lastWellness: "Yesterday", teamId: "t3" },
  { id: "a8", name: "Mia Anderson", age: 21, eventGroup: "Throws", primaryEvent: "Shot Put", readiness: "green", adherence: 90, lastWellness: "8:30 AM", teamId: "t4" },
  { id: "a9", name: "Liam Patel", age: 23, eventGroup: "Throws", primaryEvent: "Discus", readiness: "yellow", adherence: 72, lastWellness: "9:15 AM", teamId: "t4" },
  { id: "a10", name: "Sophia Kim", age: 20, eventGroup: "Sprint", primaryEvent: "100m Hurdles", readiness: "green", adherence: 88, lastWellness: "7:00 AM", teamId: "t1" },
]

export const mockPRs: PR[] = [
  { id: "pr1", athleteId: "a1", athleteName: "Marcus Johnson", event: "100m", category: "Sprint", bestValue: "10.28s", previousValue: "10.41s", date: "Feb 18, 2026", legal: true, wind: "+1.2", type: "Competition" },
  { id: "pr2", athleteId: "a2", athleteName: "Sarah Chen", event: "200m", category: "Sprint", bestValue: "23.15s", previousValue: "23.42s", date: "Feb 20, 2026", legal: true, wind: "+0.8", type: "Competition" },
  { id: "pr3", athleteId: "a6", athleteName: "Ava Thompson", event: "Long Jump", category: "Jumps", bestValue: "6.45m", previousValue: "6.32m", date: "Feb 17, 2026", legal: true, wind: "+1.0", type: "Training" },
  { id: "pr4", athleteId: "a8", athleteName: "Mia Anderson", event: "Shot Put", category: "Throws", bestValue: "16.20m", previousValue: "15.85m", date: "Feb 22, 2026", legal: true, type: "Competition" },
  { id: "pr5", athleteId: "a1", athleteName: "Marcus Johnson", event: "Back Squat", category: "Strength", bestValue: "185kg", previousValue: "180kg", date: "Feb 19, 2026", legal: true, type: "Training" },
  { id: "pr6", athleteId: "a4", athleteName: "Emily Rodriguez", event: "1500m", category: "Mid", bestValue: "4:12.5", previousValue: "4:15.8", date: "Feb 21, 2026", legal: true, type: "Competition" },
  { id: "pr7", athleteId: "a7", athleteName: "Noah Martinez", event: "High Jump", category: "Jumps", bestValue: "2.10m", previousValue: "2.05m", date: "Feb 16, 2026", legal: true, type: "Training" },
  { id: "pr8", athleteId: "a3", athleteName: "David Okafor", event: "400m", category: "Sprint", bestValue: "46.82s", previousValue: "47.15s", date: "Feb 23, 2026", legal: true, type: "Competition" },
]

export const mockWellness: WellnessEntry[] = [
  { id: "w1", athleteId: "a1", date: "2026-02-25", sleep: 8, soreness: 2, fatigue: 2, mood: 4, stress: 2, readiness: "green" },
  { id: "w2", athleteId: "a2", date: "2026-02-25", sleep: 7, soreness: 3, fatigue: 2, mood: 4, stress: 2, readiness: "green" },
  { id: "w3", athleteId: "a3", date: "2026-02-25", sleep: 6, soreness: 3, fatigue: 4, mood: 3, stress: 3, readiness: "yellow" },
  { id: "w4", athleteId: "a7", date: "2026-02-24", sleep: 5, soreness: 4, fatigue: 4, mood: 2, stress: 4, notes: "Knee pain after practice", readiness: "red" },
]

export const mockLogs: LogEntry[] = [
  { id: "l1", athleteId: "a1", type: "Strength", title: "Lower Body Power", date: "Feb 25, 2026", details: "Back Squat 3x5 @ 170kg, RDL 3x8 @ 120kg" },
  { id: "l2", athleteId: "a1", type: "Run", title: "Speed Endurance", date: "Feb 24, 2026", details: "4x150m @ 95%, Rest 8min" },
  { id: "l3", athleteId: "a1", type: "Splits", title: "Block Starts", date: "Feb 23, 2026", details: "10m: 1.82s, 20m: 3.01s, 30m: 4.05s" },
  { id: "l4", athleteId: "a2", type: "Run", title: "Tempo 200s", date: "Feb 25, 2026", details: "6x200m @ 80%, Rest 3min" },
  { id: "l5", athleteId: "a6", type: "Jumps", title: "Long Jump Practice", date: "Feb 25, 2026", details: "Full approach: 6.45m, 6.32m, 6.20m, 6.38m" },
  { id: "l6", athleteId: "a8", type: "Throws", title: "Shot Put Drill", date: "Feb 25, 2026", details: "Standing throws: 14.5m, 14.8m, 15.0m. Full: 16.2m PR" },
]

export const mockTestWeekResults: TestWeekResult[] = [
  { athleteId: "a1", athleteName: "Marcus Johnson", thirtyM: { value: "4.05s", change: "up" }, flyingThirtyM: { value: "2.89s", change: "up" }, oneHundredFiftyM: { value: "16.8s", change: "same" }, squat1RM: { value: "185kg", change: "up" }, cmj: { value: "72cm", change: "up" } },
  { athleteId: "a2", athleteName: "Sarah Chen", thirtyM: { value: "4.22s", change: "up" }, flyingThirtyM: { value: "3.05s", change: "same" }, oneHundredFiftyM: { value: "17.5s", change: "up" }, squat1RM: { value: "120kg", change: "up" }, cmj: { value: "58cm", change: "same" } },
  { athleteId: "a3", athleteName: "David Okafor", thirtyM: { value: "4.10s", change: "down" }, flyingThirtyM: { value: "3.02s", change: "down" }, oneHundredFiftyM: { value: "16.2s", change: "up" }, squat1RM: { value: "175kg", change: "same" }, cmj: { value: "68cm", change: "down" } },
  { athleteId: "a10", athleteName: "Sophia Kim", thirtyM: { value: "4.35s", change: "up" }, flyingThirtyM: { value: "3.18s", change: "up" }, oneHundredFiftyM: { value: "18.1s", change: "same" }, squat1RM: { value: "105kg", change: "up" }, cmj: { value: "52cm", change: "up" } },
]

export const mockCurrentSession: CurrentSession = {
  id: "session-2026-03-18-a1",
  title: "Speed Day - Block Starts + Accel",
  status: "in-progress",
  scheduledFor: "March 18, 2026",
  estimatedDuration: "75 min",
  coachNote: "Stay crisp through the first two blocks and keep lifting volume explosive, not grinding.",
  blocks: [
    {
      id: "block-1",
      type: "Sprint",
      name: "Block Starts",
      focus: "Explosive first three steps",
      coachNote: "Full reset between reps. Quality matters more than chasing times.",
      previousResult: "Last session: 10m 1.82s, 20m 3.01s, 30m 4.05s",
      rest: "2-3 min",
      rows: [
        { label: "Rep 1", target: "30m from blocks", helper: "Log 10m, 20m, and 30m splits" },
        { label: "Rep 2", target: "30m from blocks", helper: "Stay low through drive phase" },
        { label: "Rep 3", target: "30m from blocks", helper: "Max intent, relaxed face" },
        { label: "Rep 4", target: "30m from blocks", helper: "Cut rep if quality drops" },
      ],
    },
    {
      id: "block-2",
      type: "Run",
      name: "Acceleration Build",
      focus: "Progressive rise through 60m",
      coachNote: "Target 95% rhythm with clean mechanics, not strain.",
      previousResult: "Last session: 3x60m between 7.01s and 7.08s",
      rest: "5 min",
      rows: [
        { label: "Rep 1", target: "60m @ 95%", helper: "Record time and any technical note" },
        { label: "Rep 2", target: "60m @ 95%", helper: "Stay tall after 30m" },
        { label: "Rep 3", target: "60m @ 95%", helper: "Preserve posture under fatigue" },
      ],
    },
    {
      id: "block-3",
      type: "Strength",
      name: "Power Cleans",
      focus: "High force, low grind",
      coachNote: "Bar speed stays fast. Stop loading up if the catch gets slow.",
      previousResult: "Best recent working set: 110kg x 3",
      rest: "2 min",
      rows: [
        { label: "Set 1", target: "3 reps @ 95kg" },
        { label: "Set 2", target: "3 reps @ 100kg" },
        { label: "Set 3", target: "3 reps @ 105kg" },
        { label: "Set 4", target: "3 reps @ 105kg" },
      ],
    },
    {
      id: "block-4",
      type: "Jumps",
      name: "Bounds",
      focus: "Elastic contacts and posture",
      coachNote: "Keep contacts sharp and rhythm consistent across the full distance.",
      previousResult: "Last session: 3x40m completed clean with low contact time",
      rest: "90 sec",
      rows: [
        { label: "Set 1", target: "40m continuous bounds", helper: "Add quality note or distance if tracked" },
        { label: "Set 2", target: "40m continuous bounds", helper: "Stay reactive off the ground" },
        { label: "Set 3", target: "40m continuous bounds", helper: "Do not force extra length" },
      ],
    },
  ],
}

export const mockTrainingPlans: TrainingPlanSummary[] = [
  {
    id: "plan-1",
    name: "Spring Build Phase",
    teamId: "t1",
    startDate: "2026-03-02",
    weeks: 4,
    assignedTo: "team",
  },
  {
    id: "plan-2",
    name: "Jump Power Microcycle",
    teamId: "t3",
    startDate: "2026-03-09",
    weeks: 2,
    assignedTo: "athlete",
    assignedAthleteIds: ["a6", "a7"],
  },
]

export const mockAthleteTrainingPlanDetails: AthleteTrainingPlanDetail[] = [
  {
    planId: "plan-1",
    weeks: [
      {
        weekNumber: 1,
        emphasis: "Acceleration entry + weight room reintroduction",
        status: "completed",
        days: [
          {
            id: "plan-1-w1-mon",
            dayLabel: "Mon",
            date: "2026-03-02",
            title: "Acceleration + Lower Strength",
            type: "Mixed",
            focus: "First-step mechanics and squat intent",
            status: "completed",
            duration: "80 min",
            location: "Track / Weight Room",
            coachNote: "Keep intensity moderate and rhythm sharp.",
            blockPreview: ["Starts 4x20m", "Sled accel 4x15m", "Back squat 4x4"],
          },
          {
            id: "plan-1-w1-tue",
            dayLabel: "Tue",
            date: "2026-03-03",
            title: "Tempo + Mobility",
            type: "Recovery",
            focus: "Restore tissue quality and aerobic support",
            status: "completed",
            duration: "55 min",
            location: "Track",
            blockPreview: ["6x200m tempo", "Mobility circuit", "Core reset"],
          },
          {
            id: "plan-1-w1-wed",
            dayLabel: "Wed",
            date: "2026-03-04",
            title: "Max Velocity + Cleans",
            type: "Mixed",
            focus: "Upright mechanics and bar speed",
            status: "completed",
            duration: "75 min",
            location: "Track / Weight Room",
            blockPreview: ["Flying 30m", "Wickets", "Power cleans 5x2"],
          },
          {
            id: "plan-1-w1-thu",
            dayLabel: "Thu",
            date: "2026-03-05",
            title: "Recovery Flush",
            type: "Recovery",
            focus: "Unload and restore",
            status: "completed",
            duration: "40 min",
            location: "Recovery Room",
            blockPreview: ["Bike flush", "Mobility", "Soft tissue"],
          },
          {
            id: "plan-1-w1-fri",
            dayLabel: "Fri",
            date: "2026-03-06",
            title: "Speed Endurance + Upper Strength",
            type: "Mixed",
            focus: "Maintain mechanics under fatigue",
            status: "completed",
            duration: "85 min",
            location: "Track / Weight Room",
            blockPreview: ["3x120m", "Bench press 4x4", "Med ball throws"],
          },
        ],
      },
      {
        weekNumber: 2,
        emphasis: "Acceleration and power consolidation",
        status: "current",
        days: [
          {
            id: "plan-1-w2-mon",
            dayLabel: "Mon",
            date: "2026-03-09",
            title: "Speed Day - Block Starts + Accel",
            type: "Track",
            focus: "Explosive drive phase and clean technical rhythm",
            status: "completed",
            duration: "75 min",
            location: "Track",
            coachNote: "Treat the first block as quality work, not a conditioning set.",
            blockPreview: ["Block starts 4x30m", "Acceleration 3x60m", "Bounding 3x40m"],
          },
          {
            id: "plan-1-w2-tue",
            dayLabel: "Tue",
            date: "2026-03-10",
            title: "Lift + Core",
            type: "Gym",
            focus: "Explosive triple extension",
            status: "completed",
            duration: "60 min",
            location: "Weight Room",
            blockPreview: ["Power cleans 4x3", "RDL 3x6", "Core circuit"],
          },
          {
            id: "plan-1-w2-wed",
            dayLabel: "Wed",
            date: "2026-03-11",
            title: "Tempo / Regeneration",
            type: "Recovery",
            focus: "Restore between intensity days",
            status: "completed",
            duration: "45 min",
            location: "Track",
            blockPreview: ["6x100m tempo", "Mobility", "Breathing reset"],
          },
          {
            id: "plan-1-w2-thu",
            dayLabel: "Thu",
            date: "2026-03-12",
            title: "Power + Technical Contacts",
            type: "Technical",
            focus: "Elastic qualities and ground contacts",
            status: "scheduled",
            duration: "70 min",
            location: "Track",
            coachNote: "Stay springy. Stop if contacts get heavy.",
            blockPreview: ["Wickets", "Bounds", "Short hill accelerations"],
          },
          {
            id: "plan-1-w2-fri",
            dayLabel: "Fri",
            date: "2026-03-13",
            title: "Speed Endurance",
            type: "Track",
            focus: "Maintain posture through longer reps",
            status: "up-next",
            duration: "80 min",
            location: "Track",
            blockPreview: ["3x150m", "2x80m float-fast", "Cooldown strides"],
          },
          {
            id: "plan-1-w2-sat",
            dayLabel: "Sat",
            date: "2026-03-14",
            title: "Lift - Lower Power",
            type: "Gym",
            focus: "High output without grind",
            status: "up-next",
            duration: "55 min",
            location: "Weight Room",
            blockPreview: ["Hang clean 4x2", "Split squat 3x5", "Jumps 3x3"],
          },
        ],
      },
      {
        weekNumber: 3,
        emphasis: "Speed endurance and lifting density",
        status: "up-next",
        days: [
          {
            id: "plan-1-w3-mon",
            dayLabel: "Mon",
            date: "2026-03-16",
            title: "Acceleration + Cleans",
            type: "Mixed",
            focus: "Power off the ground",
            status: "up-next",
            duration: "75 min",
            location: "Track / Weight Room",
            blockPreview: ["2x3x20m", "Cleans", "Pogo series"],
          },
          {
            id: "plan-1-w3-tue",
            dayLabel: "Tue",
            date: "2026-03-17",
            title: "Recovery / Tissue",
            type: "Recovery",
            focus: "Unload",
            status: "up-next",
            duration: "40 min",
            location: "Recovery Room",
            blockPreview: ["Flush bike", "Mobility", "Soft tissue"],
          },
          {
            id: "plan-1-w3-wed",
            dayLabel: "Wed",
            date: "2026-03-18",
            title: "Speed Endurance Main Set",
            type: "Track",
            focus: "Hold mechanics at high velocity",
            status: "up-next",
            duration: "85 min",
            location: "Track",
            blockPreview: ["4x120m", "2x60m", "Cooldown"],
          },
        ],
      },
      {
        weekNumber: 4,
        emphasis: "Sharpen + test week lead-in",
        status: "up-next",
        days: [
          {
            id: "plan-1-w4-mon",
            dayLabel: "Mon",
            date: "2026-03-23",
            title: "Pre-test speed touch",
            type: "Track",
            focus: "Stay fresh",
            status: "up-next",
            duration: "55 min",
            location: "Track",
            blockPreview: ["Starts", "Wickets", "Low volume sprint"],
          },
        ],
      },
    ],
  },
  {
    planId: "plan-2",
    weeks: [
      {
        weekNumber: 1,
        emphasis: "Approach rhythm and jump power",
        status: "current",
        days: [
          {
            id: "plan-2-w1-mon",
            dayLabel: "Mon",
            date: "2026-03-09",
            title: "Approach Build",
            type: "Technical",
            focus: "Approach consistency",
            status: "completed",
            duration: "70 min",
            location: "Runway",
            blockPreview: ["Approach checks", "6 approach runs", "Short jump pop-offs"],
          },
          {
            id: "plan-2-w1-wed",
            dayLabel: "Wed",
            date: "2026-03-11",
            title: "Jump Power",
            type: "Mixed",
            focus: "Elastic force and takeoff feel",
            status: "scheduled",
            duration: "75 min",
            location: "Runway / Weight Room",
            blockPreview: ["Bounds", "Full jumps", "Trap bar jumps"],
          },
        ],
      },
      {
        weekNumber: 2,
        emphasis: "Competition rhythm",
        status: "up-next",
        days: [
          {
            id: "plan-2-w2-mon",
            dayLabel: "Mon",
            date: "2026-03-16",
            title: "Approach and pop-up",
            type: "Technical",
            focus: "Consistency under meet rhythm",
            status: "up-next",
            duration: "60 min",
            location: "Runway",
            blockPreview: ["Approach marks", "4 pop-ups", "Landing drills"],
          },
        ],
      },
    ],
  },
]

export const mockTrendSeries: Record<string, TrendPoint[]> = {
  a1: [
    { date: "2026-02-20", readiness: 86, fatigue: 28, trainingLoad: 74 },
    { date: "2026-02-21", readiness: 82, fatigue: 32, trainingLoad: 70 },
    { date: "2026-02-22", readiness: 78, fatigue: 37, trainingLoad: 83 },
    { date: "2026-02-23", readiness: 84, fatigue: 29, trainingLoad: 76 },
    { date: "2026-02-24", readiness: 88, fatigue: 24, trainingLoad: 68 },
    { date: "2026-02-25", readiness: 91, fatigue: 20, trainingLoad: 62 },
  ],
  a2: [
    { date: "2026-02-20", readiness: 80, fatigue: 31, trainingLoad: 72 },
    { date: "2026-02-21", readiness: 81, fatigue: 29, trainingLoad: 73 },
    { date: "2026-02-22", readiness: 79, fatigue: 33, trainingLoad: 75 },
    { date: "2026-02-23", readiness: 84, fatigue: 27, trainingLoad: 68 },
    { date: "2026-02-24", readiness: 85, fatigue: 25, trainingLoad: 66 },
    { date: "2026-02-25", readiness: 87, fatigue: 23, trainingLoad: 64 },
  ],
  a7: [
    { date: "2026-02-20", readiness: 64, fatigue: 58, trainingLoad: 77 },
    { date: "2026-02-21", readiness: 60, fatigue: 62, trainingLoad: 80 },
    { date: "2026-02-22", readiness: 58, fatigue: 65, trainingLoad: 84 },
    { date: "2026-02-23", readiness: 56, fatigue: 67, trainingLoad: 82 },
    { date: "2026-02-24", readiness: 52, fatigue: 70, trainingLoad: 79 },
    { date: "2026-02-25", readiness: 55, fatigue: 66, trainingLoad: 74 },
  ],
}

export const mockTestDefinitions = [
  "30m",
  "Flying 30m",
  "150m",
  "Long Jump",
  "Shot Put",
  "Squat 1RM",
  "CMJ",
] as const

// Placeholder handlers
export const onCreateTestWeek = () => { console.log("Create test week") }
export const onGenerateInvite = () => { console.log("Generate invite") }
export const onSaveWellness = () => { console.log("Save wellness") }
export const onSaveLog = () => { console.log("Save log") }
export const onPublishPlan = () => { console.log("Publish plan") }
export const onAssignTrainingPlan = () => { console.log("Assign training plan") }
export const onSubmitTestWeek = () => { console.log("Submit test week") }
