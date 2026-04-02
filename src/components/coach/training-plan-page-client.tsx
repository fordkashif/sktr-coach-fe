"use client"

import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, Delete01Icon, MoreHorizontalIcon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { EventGroupBadge } from "@/components/badges"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyStateCard } from "@/components/ui/empty-state-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StandardPageHeader } from "@/components/ui/standard-page-header"
import { Textarea } from "@/components/ui/textarea"
import { publishTrainingPlanForCurrentCoach } from "@/lib/data/training-plan/training-plan-data"
import { mockAthletes, mockTeams, mockTrainingPlans } from "@/lib/mock-data"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"
import { cn } from "@/lib/utils"

type Role = "coach" | "athlete" | "club-admin"
type EventGroup = "Sprint" | "Mid" | "Distance" | "Jumps" | "Throws"

type WizardStep = 1 | 2 | 3
type PlanSource = "template" | "copy" | "blank"
type ProgramBuildMode = "simple" | "advanced"
type WeekViewMode = "calendar" | "list"
type SessionType = "Track" | "Gym" | "Recovery" | "Technical" | "Mixed"
type BlockType =
  | "Warm Up"
  | "Sprint"
  | "Tempo"
  | "Intervals"
  | "Speed Endurance"
  | "Technique"
  | "Hills"
  | "Technical Drills"
  | "Full Throws"
  | "Special Strength"
  | "Med Ball"
  | "Approach Work"
  | "Takeoff"
  | "Plyos"
  | "Full Jumps"
  | "Strength"
  | "Power"
  | "Accessories"
  | "Mobility"
  | "Physio"
  | "Massage"
  | "Ice bath"
type AssignTarget = "team" | "subgroup" | "selected"

interface PlanBasics {
  planName: string
  teamId: string
  startDate: string
  durationWeeks: number
  trainingDaysPerWeek: number
  buildMode: ProgramBuildMode
  notes: string
}

interface ExerciseRow {
  id: string
  name: string
  sets: string
  reps: string
  load: string
  notes: string
}

interface SessionBlock {
  id: string
  type: BlockType
  title: string
  content: string
  exerciseDraft: {
    name: string
    sets: string
    reps: string
    load: string
    notes: string
  }
  exerciseRows: ExerciseRow[]
  fields: {
    distance?: string
    reps?: string
    pace?: string
    rest?: string
  }
}

interface SessionDay {
  id: string
  week: number
  dayIndex: number
  label: string
  dateIso: string
  isTrainingDay: boolean
  title: string
  sessionType: SessionType
  time: string
  location: string
  notes: string
  exerciseDraft: ExerciseRow
  exerciseRows: ExerciseRow[]
  blocks: SessionBlock[]
}

interface TrainingPlanListItem {
  id: string
  name: string
  teamId: string
  startDate: string
  weeks: number
  status: "Draft" | "Published"
  isMock: boolean
  previewDays?: SessionDay[]
}

interface CoachTrainingPlanPageClientProps {
  initialRole: Role
  initialCoachTeamId: string | null
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const DURATION_OPTIONS = [4, 6, 8]
const TRAINING_DAYS_OPTIONS = [5, 6, 7]
const SESSION_TYPES: SessionType[] = ["Track", "Gym", "Recovery", "Technical", "Mixed"]
const ASSIGNMENT_STORAGE_KEY = "pacelab:plan-publish-history"
const DRAFT_STORAGE_KEY = "pacelab:plan-draft"

const TEMPLATE_LIBRARY: Record<EventGroup, { title: string; type: SessionType; blocks: BlockType[] }[]> = {
  Sprint: [
    { title: "Acceleration + Weights", type: "Track", blocks: ["Sprint", "Strength"] },
    { title: "Tempo + Mobility", type: "Recovery", blocks: ["Tempo", "Mobility"] },
    { title: "Speed Endurance", type: "Track", blocks: ["Speed Endurance", "Power"] },
  ],
  Mid: [
    { title: "Threshold Intervals", type: "Track", blocks: ["Intervals", "Tempo"] },
    { title: "Technique + Gym", type: "Mixed", blocks: ["Technique", "Strength"] },
    { title: "Race Pace Session", type: "Track", blocks: ["Speed Endurance", "Mobility"] },
  ],
  Distance: [
    { title: "Long Run + Core", type: "Track", blocks: ["Tempo", "Accessories"] },
    { title: "VO2 Intervals", type: "Track", blocks: ["Intervals", "Mobility"] },
    { title: "Hills + Mobility", type: "Track", blocks: ["Hills", "Mobility"] },
  ],
  Jumps: [
    { title: "Approach + Plyos", type: "Technical", blocks: ["Approach Work", "Plyos"] },
    { title: "Takeoff Mechanics", type: "Technical", blocks: ["Takeoff", "Technique"] },
    { title: "Power + Strength", type: "Gym", blocks: ["Power", "Strength"] },
  ],
  Throws: [
    { title: "Technical Drills + Med Ball", type: "Technical", blocks: ["Technical Drills", "Med Ball"] },
    { title: "Full Throws + Strength", type: "Mixed", blocks: ["Full Throws", "Strength"] },
    { title: "Special Strength", type: "Gym", blocks: ["Special Strength", "Power"] },
  ],
}

const EVENT_GROUP_OPTIONS: Array<{ value: EventGroup; label: string }> = [
  { value: "Sprint", label: "Sprint" },
  { value: "Mid", label: "Middle" },
  { value: "Distance", label: "Distance" },
  { value: "Jumps", label: "Jumps" },
  { value: "Throws", label: "Throws" },
]

const ALL_BLOCK_TYPES: BlockType[] = [
  "Warm Up",
  "Sprint",
  "Tempo",
  "Intervals",
  "Speed Endurance",
  "Technique",
  "Hills",
  "Technical Drills",
  "Full Throws",
  "Special Strength",
  "Med Ball",
  "Approach Work",
  "Takeoff",
  "Plyos",
  "Full Jumps",
  "Strength",
  "Power",
  "Accessories",
  "Mobility",
  "Physio",
  "Massage",
  "Ice bath",
]

const QUICK_BLOCKS_BY_EVENT_GROUP: Record<EventGroup, BlockType[]> = {
  Sprint: ["Warm Up", "Sprint", "Speed Endurance", "Strength", "Power", "Mobility"],
  Mid: ["Warm Up", "Tempo", "Intervals", "Strength", "Mobility", "Physio"],
  Distance: ["Warm Up", "Tempo", "Intervals", "Strength", "Mobility", "Physio"],
  Jumps: ["Warm Up", "Approach Work", "Takeoff", "Plyos", "Strength", "Mobility"],
  Throws: ["Warm Up", "Technical Drills", "Full Throws", "Strength", "Power", "Mobility"],
}

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(dateIso: string, days: number) {
  const date = new Date(dateIso)
  date.setDate(date.getDate() + days)
  return date
}

function formatShortDate(dateIso: string) {
  return new Date(dateIso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatWeekRange(days: SessionDay[]) {
  if (days.length === 0) return "No days scheduled"
  const sortedDays = [...days].sort((left, right) => left.dayIndex - right.dayIndex)
  const start = new Date(sortedDays[0].dateIso)
  const end = new Date(sortedDays[sortedDays.length - 1].dateIso)
  const sameMonth = start.getMonth() === end.getMonth()
  const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const endLabel = end.toLocaleDateString(undefined, { month: sameMonth ? undefined : "short", day: "numeric" })
  return `${startLabel} - ${endLabel}`
}

function cloneSessionDays(days: SessionDay[]) {
  return days.map((day) => ({
    ...day,
    blocks: day.blocks.map((block) => ({
      ...block,
      content: block.content,
      exerciseDraft: { ...block.exerciseDraft },
      exerciseRows: block.exerciseRows.map((row) => ({ ...row })),
      fields: { ...block.fields },
    })),
    exerciseDraft: { ...day.exerciseDraft },
    exerciseRows: day.exerciseRows.map((row) => ({ ...row })),
  }))
}

function sessionTypeClassName(sessionType: SessionType) {
  switch (sessionType) {
    case "Track":
      return "border-l-sky-500 bg-sky-500/10 text-sky-700"
    case "Gym":
      return "border-l-amber-500 bg-amber-500/10 text-amber-700"
    case "Recovery":
      return "border-l-[#1f8cff] bg-[#eef5ff] text-[#1f5fd1]"
    case "Technical":
      return "border-l-violet-500 bg-violet-500/10 text-violet-700"
    case "Mixed":
      return "border-l-rose-500 bg-rose-500/10 text-rose-700"
    default:
      return "border-l-border bg-muted text-foreground"
  }
}

const AVATAR_SWATCHES = [
  "bg-[#dbeafe] text-[#1d4ed8]",
  "bg-[#ede9fe] text-[#6d28d9]",
  "bg-[#e0f2fe] text-[#0369a1]",
  "bg-[#fee2e2] text-[#b91c1c]",
  "bg-[#fef3c7] text-[#b45309]",
]

function athleteInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function newBlock(type: BlockType): SessionBlock {
  return {
    id: makeId("block"),
    type,
    title: type,
    content: "",
    exerciseDraft: {
      name: "",
      sets: "",
      reps: "",
      load: "",
      notes: "",
    },
    exerciseRows: [],
    fields: {},
  }
}

function dayStatus(day: SessionDay): "Empty" | "Draft" | "Ready" {
  if (!day.isTrainingDay) return "Ready"
  if (!day.title && day.blocks.length === 0 && day.exerciseRows.length === 0) return "Empty"
  if (day.title && (day.blocks.length >= 2 || day.exerciseRows.length >= 1)) return "Ready"
  return "Draft"
}

function createSkeleton(basics: PlanBasics, source: PlanSource, templateGroup: EventGroup): SessionDay[] {
  const days: SessionDay[] = []
  const templates = TEMPLATE_LIBRARY[templateGroup]

  for (let week = 1; week <= basics.durationWeeks; week += 1) {
    for (let dayIndex = 0; dayIndex < basics.trainingDaysPerWeek; dayIndex += 1) {
      const dayDate = addDays(basics.startDate, (week - 1) * 7 + dayIndex)
      const isTrainingDay = true
      const template = templates[(dayIndex + week - 1) % templates.length]

      let title = ""
      let sessionType: SessionType = "Track"
      let blocks: SessionBlock[] = []

      if (source === "template") {
        title = template.title
        sessionType = template.type
        blocks = template.blocks.map((blockType) => newBlock(blockType))
      }
      if (source === "copy") {
        title = `${template.title} (Copied)`
        sessionType = template.type
        blocks = template.blocks.map((blockType) => newBlock(blockType))
      }

      days.push({
        id: makeId("day"),
        week,
        dayIndex,
        label: DAYS[dayIndex],
        dateIso: toInputDate(dayDate),
        isTrainingDay,
        title,
        sessionType,
        time: "",
        location: "",
        notes: "",
        exerciseDraft: { id: makeId("draft"), name: "", sets: "", reps: "", load: "", notes: "" },
        exerciseRows: [],
        blocks,
      })
    }
  }

  return days
}

function countAthletesForTarget(target: AssignTarget, teamId: string, subgroup: EventGroup, selectedAthleteIds: string[]) {
  const teamAthletes = mockAthletes.filter((athlete) => athlete.teamId === teamId)
  if (target === "team") return teamAthletes.length
  if (target === "subgroup") return teamAthletes.filter((athlete) => athlete.eventGroup === subgroup).length
  return selectedAthleteIds.length
}

function buildMockProgramDays(startDate: string): SessionDay[] {
  const makeSection = (
    title: string,
    type: BlockType,
    exerciseRows: SessionBlock["exerciseRows"],
  ): SessionBlock => ({
    id: makeId("block"),
    type,
    title,
    content: exerciseRows.map((row) => `${row.name}${row.sets || row.reps ? ` ${[row.sets, row.reps].filter(Boolean).join(" x ")}` : ""}${row.load ? ` @ ${row.load}` : ""}`).join("\n"),
    exerciseDraft: { name: "", sets: "", reps: "", load: "", notes: "" },
    exerciseRows,
    fields: {},
  })

  const monday = toInputDate(addDays(startDate, 0))
  const tuesday = toInputDate(addDays(startDate, 1))
  const wednesday = toInputDate(addDays(startDate, 2))
  const thursday = toInputDate(addDays(startDate, 3))
  const friday = toInputDate(addDays(startDate, 4))

  return [
    {
      id: makeId("day"),
      week: 1,
      dayIndex: 0,
      label: "Mon",
      dateIso: monday,
      isTrainingDay: true,
      title: "Olympic Lift + Squat + Core A",
      sessionType: "Gym",
      time: "",
      location: "Weight Room",
      notes: "December 1, 2026",
      exerciseDraft: { id: makeId("draft"), name: "", sets: "", reps: "", load: "", notes: "" },
      exerciseRows: [],
      blocks: [
        makeSection("Monday Lift", "Strength", [
          { id: makeId("exercise"), name: "Power Cleans", sets: "6", reps: "2", load: "60-70%", notes: "" },
          { id: makeId("exercise"), name: "Box Jumps", sets: "4", reps: "3", load: "", notes: "" },
          { id: makeId("exercise"), name: "Back Squat", sets: "1", reps: "10", load: "60%", notes: "" },
          { id: makeId("exercise"), name: "Back Squat", sets: "1", reps: "6", load: "75%", notes: "" },
          { id: makeId("exercise"), name: "Back Squat", sets: "1", reps: "AMRAP", load: "80%", notes: "" },
          { id: makeId("exercise"), name: "Back Squat", sets: "1", reps: "6", load: "[ADJUSTED]", notes: "" },
          { id: makeId("exercise"), name: "Romanian Deadlift", sets: "2", reps: "6", load: "75%", notes: "" },
          { id: makeId("exercise"), name: "Romanian Deadlift", sets: "1", reps: "1", load: "80%", notes: "" },
        ]),
        makeSection("Core A", "Accessories", [
          { id: makeId("exercise"), name: "Core A", sets: "3", reps: "10", load: "", notes: "" },
        ]),
      ],
    },
    {
      id: makeId("day"),
      week: 1,
      dayIndex: 1,
      label: "Tue",
      dateIso: tuesday,
      isTrainingDay: true,
      title: "Upper Body + Sprints + Core B",
      sessionType: "Mixed",
      time: "",
      location: "Weight Room / Track",
      notes: "December 2, 2026",
      exerciseDraft: { id: makeId("draft"), name: "", sets: "", reps: "", load: "", notes: "" },
      exerciseRows: [],
      blocks: [
        makeSection("Tuesday Lift", "Strength", [
          { id: makeId("exercise"), name: "Push Press", sets: "5", reps: "3", load: "60-70%", notes: "" },
          { id: makeId("exercise"), name: "Bench Press", sets: "1", reps: "10", load: "60%", notes: "" },
          { id: makeId("exercise"), name: "Bench Press", sets: "1", reps: "6", load: "75%", notes: "" },
          { id: makeId("exercise"), name: "Bench Press", sets: "1", reps: "AMRAP", load: "80%", notes: "" },
          { id: makeId("exercise"), name: "Bench Press", sets: "1", reps: "6", load: "[ADJUSTED]", notes: "" },
          { id: makeId("exercise"), name: "Lateral Pull Downs", sets: "2", reps: "10", load: "", notes: "" },
          { id: makeId("exercise"), name: "Wrist Curls", sets: "2", reps: "10", load: "", notes: "" },
          { id: makeId("exercise"), name: "Pectoral Flyes", sets: "2", reps: "10", load: "", notes: "" },
        ]),
        makeSection("Sprints", "Sprint", [
          { id: makeId("exercise"), name: "Sprints", sets: "8", reps: "20m", load: "", notes: "" },
        ]),
        makeSection("Core B", "Accessories", [
          { id: makeId("exercise"), name: "Core B", sets: "3", reps: "10", load: "", notes: "" },
        ]),
      ],
    },
    {
      id: makeId("day"),
      week: 1,
      dayIndex: 2,
      label: "Wed",
      dateIso: wednesday,
      isTrainingDay: true,
      title: "Shoulder Circuit + Snatch Pull Series + Core C",
      sessionType: "Gym",
      time: "",
      location: "Weight Room",
      notes: "December 3, 2026",
      exerciseDraft: { id: makeId("draft"), name: "", sets: "", reps: "", load: "", notes: "" },
      exerciseRows: [],
      blocks: [
        makeSection("Shoulder Circuit", "Accessories", [
          { id: makeId("exercise"), name: "Front Lateral Raises", sets: "2", reps: "10", load: "10lbs", notes: "" },
          { id: makeId("exercise"), name: "Side Lateral Raises", sets: "2", reps: "10", load: "10lbs", notes: "" },
          { id: makeId("exercise"), name: "Internal Rotation", sets: "2", reps: "10", load: "Resistance Band", notes: "" },
          { id: makeId("exercise"), name: "External Rotation", sets: "2", reps: "10", load: "Resistance Band", notes: "" },
          { id: makeId("exercise"), name: "Bartwists", sets: "3", reps: "10", load: "135lbs", notes: "" },
          { id: makeId("exercise"), name: "Plate Walk", sets: "3", reps: "10", load: "35lbs", notes: "" },
        ]),
        makeSection("Power Pull Series", "Power", [
          { id: makeId("exercise"), name: "Power Snatch", sets: "6", reps: "2", load: "60-70%", notes: "" },
          { id: makeId("exercise"), name: "Clean Pulls", sets: "1", reps: "6", load: "50%", notes: "" },
          { id: makeId("exercise"), name: "Clean Pulls", sets: "1", reps: "6", load: "60%", notes: "" },
          { id: makeId("exercise"), name: "Clean Pulls", sets: "1", reps: "AMRAP", load: "80%", notes: "" },
          { id: makeId("exercise"), name: "Clean Pulls", sets: "1", reps: "6", load: "[ADJUSTED]", notes: "" },
          { id: makeId("exercise"), name: "Box Jump", sets: "5", reps: "5", load: "", notes: "" },
        ]),
        makeSection("Core C", "Accessories", [
          { id: makeId("exercise"), name: "Core C", sets: "3", reps: "30 sec", load: "", notes: "" },
        ]),
      ],
    },
    {
      id: makeId("day"),
      week: 1,
      dayIndex: 3,
      label: "Thu",
      dateIso: thursday,
      isTrainingDay: true,
      title: "Jerk + Acceleration",
      sessionType: "Mixed",
      time: "",
      location: "Weight Room / Track",
      notes: "December 4, 2026",
      exerciseDraft: { id: makeId("draft"), name: "", sets: "", reps: "", load: "", notes: "" },
      exerciseRows: [],
      blocks: [
        makeSection("Thursday Lift", "Power", [
          { id: makeId("exercise"), name: "Behind Neck Jerk", sets: "6", reps: "3", load: "60-70%", notes: "" },
        ]),
        makeSection("Sprints", "Sprint", [
          { id: makeId("exercise"), name: "Sprints", sets: "8", reps: "20m", load: "", notes: "" },
        ]),
      ],
    },
    {
      id: makeId("day"),
      week: 1,
      dayIndex: 4,
      label: "Fri",
      dateIso: friday,
      isTrainingDay: true,
      title: "Snatch + Bench + Front Squat + Core B",
      sessionType: "Gym",
      time: "",
      location: "Weight Room",
      notes: "December 5, 2026",
      exerciseDraft: { id: makeId("draft"), name: "", sets: "", reps: "", load: "", notes: "" },
      exerciseRows: [],
      blocks: [
        makeSection("Friday Lift", "Strength", [
          { id: makeId("exercise"), name: "Power Snatch", sets: "4", reps: "2", load: "60-70%", notes: "" },
          { id: makeId("exercise"), name: "Power Cleans", sets: "4", reps: "2", load: "60-70%", notes: "" },
          { id: makeId("exercise"), name: "Pulse Bench [2]", sets: "4", reps: "2", load: "75%", notes: "" },
          { id: makeId("exercise"), name: "Bench Press", sets: "1", reps: "AMRAP", load: "80%", notes: "" },
          { id: makeId("exercise"), name: "Bench Press", sets: "1", reps: "6", load: "[ADJUSTED]", notes: "" },
          { id: makeId("exercise"), name: "Medball Slam", sets: "3", reps: "10", load: "10kg", notes: "" },
          { id: makeId("exercise"), name: "Front Squat", sets: "1", reps: "10", load: "60%", notes: "" },
          { id: makeId("exercise"), name: "Front Squat", sets: "1", reps: "6", load: "75%", notes: "" },
          { id: makeId("exercise"), name: "Front Squat", sets: "1", reps: "AMRAP", load: "80%", notes: "" },
          { id: makeId("exercise"), name: "Front Squat", sets: "1", reps: "6", load: "[ADJUSTED]", notes: "" },
          { id: makeId("exercise"), name: "Romanian Deadlift", sets: "2", reps: "6", load: "75%", notes: "" },
          { id: makeId("exercise"), name: "Romanian Deadlift", sets: "1", reps: "1", load: "80%", notes: "" },
          { id: makeId("exercise"), name: "Wrist Curls", sets: "3", reps: "20", load: "", notes: "" },
          { id: makeId("exercise"), name: "Calf Raises", sets: "3", reps: "AMRAP", load: "", notes: "" },
        ]),
        makeSection("Core B", "Accessories", [
          { id: makeId("exercise"), name: "Core B", sets: "3", reps: "10", load: "", notes: "" },
        ]),
      ],
    },
  ]
}

export default function CoachTrainingPlanPageClient({
  initialRole,
  initialCoachTeamId,
}: CoachTrainingPlanPageClientProps) {
  const scopedTeamId = useMemo(
    () => (initialRole === "coach" ? initialCoachTeamId : null),
    [initialCoachTeamId, initialRole]
  )

  const [view, setView] = useState<"list" | "wizard">("list")
  const [step, setStep] = useState<WizardStep>(1)
  const [basics, setBasics] = useState<PlanBasics>({
    planName: "",
    teamId: scopedTeamId ?? mockTeams[0]?.id ?? "",
    startDate: toInputDate(new Date()),
    durationWeeks: 4,
    trainingDaysPerWeek: 5,
    buildMode: "simple",
    notes: "",
  })
  const [source, setSource] = useState<PlanSource>("template")
  const [templateGroup, setTemplateGroup] = useState<EventGroup>("Sprint")
  const [copySourcePlanId, setCopySourcePlanId] = useState<string>("mock-program-dec-1-2026")
  const [days, setDays] = useState<SessionDay[]>([])
  const [activeWeek, setActiveWeek] = useState(1)
  const [weekViewMode, setWeekViewMode] = useState<WeekViewMode>("calendar")
  const [editingDayId, setEditingDayId] = useState<string | null>(null)
  const sessionEditorRef = useRef<HTMLElement | null>(null)
  const [showSessionDetails, setShowSessionDetails] = useState(false)
  const [previewPlanId, setPreviewPlanId] = useState<string | null>(null)
  const [previewWeek, setPreviewWeek] = useState(1)
  const [previewSelectedDayId, setPreviewSelectedDayId] = useState<string | null>(null)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [pendingTrainingDaysPerWeek, setPendingTrainingDaysPerWeek] = useState<number | null>(null)
  const [draggedDayId, setDraggedDayId] = useState<string | null>(null)
  const [dragOverDayId, setDragOverDayId] = useState<string | null>(null)

  const [assignTarget, setAssignTarget] = useState<AssignTarget>("team")
  const [assignSubgroup, setAssignSubgroup] = useState<EventGroup>("Sprint")
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>([])
  const [visibilityStart, setVisibilityStart] = useState<"immediate" | "scheduled">("immediate")
  const [visibilityDate, setVisibilityDate] = useState(toInputDate(new Date()))
  const [athletePermissions, setAthletePermissions] = useState<"none" | "read-only">("none")
  const [publishedCount, setPublishedCount] = useState<number | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [createdPlans, setCreatedPlans] = useState<TrainingPlanListItem[]>([])
  const backendMode = getBackendMode()

  const isScopedCoach = initialRole === "coach" && Boolean(scopedTeamId)
  const effectiveTeamId = scopedTeamId ?? basics.teamId
  const effectiveTeam = mockTeams.find((team) => team.id === effectiveTeamId)
  const teamAthletes = mockAthletes.filter((athlete) => athlete.teamId === effectiveTeamId)
  const availableTemplateGroups = useMemo(
    () => (isScopedCoach && effectiveTeam ? [effectiveTeam.eventGroup] : EVENT_GROUP_OPTIONS.map((option) => option.value)),
    [effectiveTeam, isScopedCoach],
  )

  const activeWeekDays = days.filter((day) => day.week === activeWeek)
  const editingDay = editingDayId ? days.find((day) => day.id === editingDayId) ?? null : null
  const quickBlockOptions = QUICK_BLOCKS_BY_EVENT_GROUP[effectiveTeam?.eventGroup ?? templateGroup]

  const trainingDays = days.filter((day) => day.isTrainingDay)
  const nonEmptyTrainingDays = trainingDays.filter((day) => dayStatus(day) !== "Empty")
  const completenessRatio = trainingDays.length > 0 ? nonEmptyTrainingDays.length / trainingDays.length : 0
  const canPublish = completenessRatio >= 0.6
  const configuredDaysCount = nonEmptyTrainingDays.length
  const listedPlans = useMemo(
    () => [
      {
        id: "mock-program-dec-1-2026",
        name: "December 1-5, 2026 Strength + Sprint Block",
        teamId: effectiveTeamId,
        startDate: "2026-12-01",
        weeks: 1,
        status: "Published" as const,
        isMock: true,
      },
      {
        id: "mock-program-jan-5-2026",
        name: "January 5-30, 2026 General Preparation Block",
        teamId: effectiveTeamId,
        startDate: "2026-01-05",
        weeks: 4,
        status: "Published" as const,
        isMock: true,
      },
      ...createdPlans,
      ...mockTrainingPlans
        .filter((plan) => (scopedTeamId ? plan.teamId === scopedTeamId : true))
        .map((plan) => ({
          id: plan.id,
          name: plan.name,
          teamId: plan.teamId,
          startDate: plan.startDate,
          weeks: plan.weeks,
          status: "Published" as const,
          isMock: false,
        })),
    ],
    [createdPlans, effectiveTeamId, scopedTeamId],
  )
  const previewPlan = listedPlans.find((plan) => plan.id === previewPlanId) ?? null
  const previewPlanTeam = previewPlan ? mockTeams.find((team) => team.id === previewPlan.teamId) : null
  const copySourcePlan = listedPlans.find((plan) => plan.id === copySourcePlanId) ?? null
  const previewPlanDays = useMemo(() => {
    if (!previewPlan) return []
    if (previewPlan.previewDays?.length) return cloneSessionDays(previewPlan.previewDays)
    if (previewPlan.id === "mock-program-dec-1-2026") return buildMockProgramDays(previewPlan.startDate)
    return createSkeleton(
      {
        planName: previewPlan.name,
        teamId: previewPlan.teamId,
        startDate: previewPlan.startDate,
        durationWeeks: previewPlan.weeks,
        trainingDaysPerWeek: 5,
        buildMode: "advanced",
        notes: "",
      },
      "template",
      previewPlanTeam?.eventGroup ?? "Sprint",
    )
  }, [previewPlan, previewPlanTeam])
  const previewWeekDays = previewPlanDays.filter((day) => day.week === previewWeek)
  const previewSelectedDay = previewWeekDays.find((day) => day.id === previewSelectedDayId) ?? previewWeekDays[0] ?? null
  const assignedCount = isScopedCoach
    ? teamAthletes.length
    : countAthletesForTarget(assignTarget, effectiveTeamId, assignSubgroup, selectedAthleteIds)

  const buildDaysFromSource = (
    nextSource: PlanSource,
    nextBasics: PlanBasics,
    nextTemplateGroup: EventGroup,
    selectedPlanId: string,
  ) => {
    if (nextBasics.buildMode === "simple") {
      return createSkeleton(nextBasics, "blank", nextTemplateGroup)
    }

    if (nextSource === "copy") {
      const plan = listedPlans.find((item) => item.id === selectedPlanId)
      if (!plan) return createSkeleton(nextBasics, "template", nextTemplateGroup)
      if (plan.previewDays?.length) return cloneSessionDays(plan.previewDays)
      if (plan.id === "mock-program-dec-1-2026") return buildMockProgramDays(plan.startDate)

      const team = mockTeams.find((candidate) => candidate.id === plan.teamId)
      return createSkeleton(
        {
          planName: nextBasics.planName,
          teamId: nextBasics.teamId,
          startDate: nextBasics.startDate,
          durationWeeks: nextBasics.durationWeeks,
          trainingDaysPerWeek: nextBasics.trainingDaysPerWeek,
          buildMode: nextBasics.buildMode,
          notes: nextBasics.notes,
        },
        "template",
        team?.eventGroup ?? nextTemplateGroup,
      )
    }

    return createSkeleton(nextBasics, nextSource, nextTemplateGroup)
  }

  const updateDay = (dayId: string, updater: (day: SessionDay) => SessionDay) => {
    setDays((prev) => prev.map((day) => (day.id === dayId ? updater(day) : day)))
  }

  const updateBlock = (dayId: string, blockId: string, updater: (block: SessionBlock) => SessionBlock) => {
    updateDay(dayId, (day) => ({
      ...day,
      blocks: day.blocks.map((block) => (block.id === blockId ? updater(block) : block)),
    }))
  }

  const addBlockToDay = (dayId: string, type: BlockType) => {
    updateDay(dayId, (day) => ({ ...day, blocks: [...day.blocks, newBlock(type)] }))
  }

  const saveDraft = () => {
    const key = tenantStorageKey(DRAFT_STORAGE_KEY)
    window.localStorage.setItem(
      key,
      JSON.stringify({ basics, source, templateGroup, days, updatedAt: new Date().toISOString() }),
    )
  }

  const handleBasicsNext = () => {
    if (!basics.planName.trim() || !basics.startDate) return
    if (days.length === 0) {
      setDays(buildDaysFromSource(source, basics, templateGroup, copySourcePlanId))
      setActiveWeek(1)
    }
    setStep(2)
  }

  const regeneratePlanStructure = () => {
    setDays(buildDaysFromSource(source, basics, templateGroup, copySourcePlanId))
    setActiveWeek(1)
    setEditingDayId(null)
    setShowRegenerateConfirm(false)
  }

  const applyTrainingDaysPerWeek = (nextTrainingDaysPerWeek: number) => {
    setBasics((prev) => {
      const nextBasics = { ...prev, trainingDaysPerWeek: nextTrainingDaysPerWeek }
      if (days.length > 0) {
        setDays(buildDaysFromSource(source, nextBasics, templateGroup, copySourcePlanId))
        setActiveWeek(1)
        setEditingDayId(null)
      }
      return nextBasics
    })
    setPendingTrainingDaysPerWeek(null)
  }

  const handleTrainingDaysPerWeekChange = (nextTrainingDaysPerWeek: number) => {
    if (nextTrainingDaysPerWeek === basics.trainingDaysPerWeek) return
    if (days.length === 0) {
      setBasics((prev) => ({ ...prev, trainingDaysPerWeek: nextTrainingDaysPerWeek }))
      return
    }
    setPendingTrainingDaysPerWeek(nextTrainingDaysPerWeek)
  }

  const openReview = () => {
    if (!canPublish) return
    setEditingDayId(null)
    setPublishError(null)
    setStep(3)
  }

  const openWizard = () => {
    setView("wizard")
    setStep(1)
    setPublishedCount(null)
    setPublishError(null)
    setIsPublishing(false)
    setEditingDayId(null)
    setShowSessionDetails(false)
    setDays([])
    setActiveWeek(1)
  }

  const requestRegeneratePlanStructure = () => {
    if (days.length === 0) {
      regeneratePlanStructure()
      return
    }
    setShowRegenerateConfirm(true)
  }

  const openPlanInBuilder = (plan: TrainingPlanListItem) => {
    const team = mockTeams.find((candidate) => candidate.id === plan.teamId)
    const nextDays = plan.previewDays?.length
      ? cloneSessionDays(plan.previewDays)
      : plan.id === "mock-program-dec-1-2026"
        ? buildMockProgramDays(plan.startDate)
        : createSkeleton(
            {
              planName: plan.name,
              teamId: plan.teamId,
              startDate: plan.startDate,
              durationWeeks: plan.weeks,
              trainingDaysPerWeek: 5,
              buildMode: "advanced",
              notes: "",
            },
            "template",
            team?.eventGroup ?? "Sprint",
          )

    setBasics({
      planName: plan.name,
      teamId: plan.teamId,
      startDate: plan.startDate,
      durationWeeks: plan.weeks,
      trainingDaysPerWeek: Math.max(
        1,
        nextDays.filter((day) => day.week === 1 && day.isTrainingDay).length,
      ),
      buildMode: nextDays.some((day) => day.exerciseRows.length > 0) ? "simple" : "advanced",
      notes: "",
    })
    setSource("template")
    setTemplateGroup(team?.eventGroup ?? "Sprint")
    setCopySourcePlanId(plan.id)
    setDays(nextDays)
    setActiveWeek(1)
    setWeekViewMode("calendar")
    setEditingDayId(null)
    setPublishedCount(null)
    setPublishError(null)
    setView("wizard")
    setStep(2)
  }

  const openSessionEditor = (dayId: string) => {
    setEditingDayId(dayId)
  }

  const duplicateFromLastWeek = (day: SessionDay) => {
    if (day.week <= 1) return
    const sourceDay = days.find((item) => item.week === day.week - 1 && item.dayIndex === day.dayIndex)
    if (!sourceDay) return
    updateDay(day.id, (current) => ({
      ...current,
      title: sourceDay.title,
      sessionType: sourceDay.sessionType,
      time: sourceDay.time,
      location: sourceDay.location,
      notes: sourceDay.notes,
      exerciseDraft: { ...sourceDay.exerciseDraft, id: makeId("draft") },
      exerciseRows: sourceDay.exerciseRows.map((row) => ({ ...row, id: makeId("exercise") })),
      blocks: sourceDay.blocks.map((block) => ({ ...block, id: makeId("block") })),
    }))
  }

  const clearDay = (dayId: string) => {
    updateDay(dayId, (day) => ({
      ...day,
      title: "",
      notes: "",
      exerciseRows: [],
      exerciseDraft: { ...day.exerciseDraft, name: "", sets: "", reps: "", load: "", notes: "" },
      blocks: [],
    }))
  }

  const reorderSessionWithinWeek = (sourceDayId: string, targetDayId: string) => {
    if (sourceDayId === targetDayId) return
    setDays((prev) => {
      const sourceDay = prev.find((day) => day.id === sourceDayId)
      const targetDay = prev.find((day) => day.id === targetDayId)
      if (!sourceDay || !targetDay || sourceDay.week !== targetDay.week) return prev

      const payloadFor = (day: SessionDay) => ({
        title: day.title,
        sessionType: day.sessionType,
        time: day.time,
        location: day.location,
        notes: day.notes,
        exerciseDraft: { ...day.exerciseDraft, id: makeId("draft") },
        exerciseRows: day.exerciseRows.map((row) => ({ ...row, id: makeId("exercise") })),
        blocks: cloneSessionDays([{ ...day, blocks: day.blocks }])[0].blocks,
      })

      const weekTrainingDays = prev
        .filter((day) => day.week === sourceDay.week && day.isTrainingDay)
        .sort((left, right) => left.dayIndex - right.dayIndex)
      const sourceIndex = weekTrainingDays.findIndex((day) => day.id === sourceDayId)
      const targetIndex = weekTrainingDays.findIndex((day) => day.id === targetDayId)
      if (sourceIndex === -1 || targetIndex === -1) return prev

      const reorderedPayloads = weekTrainingDays.map((day) => payloadFor(day))
      const [movedPayload] = reorderedPayloads.splice(sourceIndex, 1)
      reorderedPayloads.splice(targetIndex, 0, movedPayload)

      return prev.map((day) => {
        const weekIndex = weekTrainingDays.findIndex((item) => item.id === day.id)
        if (weekIndex === -1) return day
        return {
          ...day,
          ...reorderedPayloads[weekIndex],
        }
      })
    })
    setDraggedDayId(null)
    setDragOverDayId(null)
  }

  const copySessionToNextDay = () => {
    if (!editingDay) return
    const nextDay = days.find((day) => day.week === editingDay.week && day.dayIndex > editingDay.dayIndex && day.isTrainingDay)
    if (!nextDay) return
    updateDay(nextDay.id, () => ({
      ...editingDay,
      id: nextDay.id,
      dateIso: nextDay.dateIso,
      label: nextDay.label,
      dayIndex: nextDay.dayIndex,
      exerciseDraft: { ...editingDay.exerciseDraft, id: makeId("draft") },
      exerciseRows: editingDay.exerciseRows.map((row) => ({ ...row, id: makeId("exercise") })),
      blocks: editingDay.blocks.map((block) => ({ ...block, id: makeId("block") })),
    }))
  }

  const repeatWeekly = () => {
    if (!editingDay) return
    setDays((prev) =>
      prev.map((day) => {
        if (day.dayIndex !== editingDay.dayIndex || day.week === editingDay.week || !day.isTrainingDay) return day
        return {
          ...day,
          title: editingDay.title,
          sessionType: editingDay.sessionType,
          time: editingDay.time,
          location: editingDay.location,
          notes: editingDay.notes,
          blocks: editingDay.blocks.map((block) => ({ ...block, id: makeId("block") })),
        }
      }),
    )
  }

  const createABDays = () => {
    if (!editingDay) return
    const startWeek = editingDay.week
    setDays((prev) =>
      prev.map((day) => {
        if (day.week !== startWeek || !day.isTrainingDay) return day
        const title = day.dayIndex % 2 === 0 ? "Lift A" : "Lift B"
        const templateBlock = day.dayIndex % 2 === 0 ? "Strength" : "Power"
        return {
          ...day,
          title,
          sessionType: "Gym",
          blocks: [newBlock(templateBlock)],
        }
      }),
    )
  }

  const useTemplateBlock = () => {
    if (!editingDayId) return
    updateDay(editingDayId, (day) => ({
      ...day,
      blocks: [...day.blocks, newBlock("Strength")],
    }))
  }

  const publishPlan = async () => {
    if (isPublishing || !canPublish) return
    setPublishError(null)

    let publishedPlanId = makeId("plan")
    let count = countAthletesForTarget(assignTarget, effectiveTeamId, assignSubgroup, selectedAthleteIds)

    if (backendMode === "supabase") {
      const summarizeExerciseRows = (rows: ExerciseRow[]) =>
        rows
          .map((row) => [row.name, row.sets && row.reps ? `${row.sets} x ${row.reps}` : row.reps || row.sets, row.load ? `@ ${row.load}` : ""].filter(Boolean).join(" "))
          .filter((line) => line.length > 0)
          .slice(0, 6)

      const summarizeBlock = (block: SessionBlock) => {
        if (block.content.trim().length > 0) return `${block.title}: ${block.content.trim()}`
        const exerciseSummary = summarizeExerciseRows(block.exerciseRows)
        if (exerciseSummary.length > 0) return `${block.title}: ${exerciseSummary.join(" | ")}`
        return block.title
      }

      const buildDayFocus = (day: SessionDay) => {
        const primaryBlocks = day.blocks.map((block) => block.title).filter((value) => value.trim().length > 0).slice(0, 2)
        if (primaryBlocks.length > 0) return primaryBlocks.join(" + ")
        if (day.exerciseRows.length > 0) return "Structured session"
        return day.title || "Programmed session"
      }

      setIsPublishing(true)
      const publishResult = await (async () => {
        try {
          return await publishTrainingPlanForCurrentCoach({
            name: basics.planName,
            startDate: basics.startDate,
            weeks: basics.durationWeeks,
            notes: basics.notes.trim() || null,
            teamId: effectiveTeamId || null,
            visibilityStart,
            visibilityDate: visibilityStart === "scheduled" ? visibilityDate : null,
            assignTarget,
            assignSubgroup: assignTarget === "subgroup" ? assignSubgroup : null,
            selectedAthleteIds: assignTarget === "selected" ? selectedAthleteIds : [],
            structure: Array.from({ length: basics.durationWeeks }, (_, index) => index + 1).map((weekNumber) => ({
              weekNumber,
              emphasis: null,
              status: weekNumber === 1 ? "current" : "up-next",
              days: days
                .filter((day) => day.week === weekNumber && day.isTrainingDay)
                .sort((left, right) => left.dayIndex - right.dayIndex)
                .map((day) => {
                  const exerciseSummary = summarizeExerciseRows(day.exerciseRows)
                  const blockPreview = day.blocks.length > 0 ? day.blocks.map(summarizeBlock) : exerciseSummary
                  return {
                    dayIndex: day.dayIndex,
                    dayLabel: day.label,
                    date: day.dateIso,
                    title: day.title || `${day.label} Session`,
                    sessionType: day.sessionType,
                    focus: buildDayFocus(day),
                    status: dayStatus(day) === "Ready" ? "scheduled" : "up-next",
                    durationMinutes: null,
                    location: day.location.trim() || null,
                    coachNote: day.notes.trim() || null,
                    isTrainingDay: day.isTrainingDay,
                    blockPreview: blockPreview.length > 0 ? blockPreview : [day.title || "Programmed session"],
                  }
                }),
            })),
          })
        } finally {
          setIsPublishing(false)
        }
      })()

      if (!publishResult.ok) {
        setPublishError(publishResult.error.message)
        return
      }

      publishedPlanId = publishResult.data.planId
      count = publishResult.data.assignedCount
    }

    setPublishedCount(count)

    if (backendMode !== "supabase") {
      const key = tenantStorageKey(ASSIGNMENT_STORAGE_KEY)
      const current = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown[]
      const next = {
        planName: basics.planName,
        teamId: effectiveTeamId,
        assignTarget,
        assignSubgroup,
        selectedAthleteIds,
        visibilityStart,
        visibilityDate,
        athletePermissions,
        publishedCount: count,
        publishedAt: new Date().toISOString(),
      }
      window.localStorage.setItem(key, JSON.stringify([next, ...current].slice(0, 50)))
    }
    setCreatedPlans((prev) => [
      {
        id: publishedPlanId,
        name: basics.planName,
        teamId: effectiveTeamId,
        startDate: basics.startDate,
        weeks: basics.durationWeeks,
        status: "Published",
        isMock: false,
        previewDays: cloneSessionDays(days),
      },
      ...prev,
    ])
  }

  useEffect(() => {
    if (!listedPlans.some((plan) => plan.id === previewPlanId)) {
      setPreviewPlanId(null)
    }
  }, [listedPlans, previewPlanId])

  useEffect(() => {
    if (!previewPlan) {
      setPreviewWeek(1)
      return
    }
    if (previewWeek > previewPlan.weeks) {
      setPreviewWeek(1)
    }
  }, [previewPlan, previewWeek])

  useEffect(() => {
    if (!previewWeekDays.length) {
      setPreviewSelectedDayId(null)
      return
    }

    if (!previewWeekDays.some((day) => day.id === previewSelectedDayId)) {
      setPreviewSelectedDayId(previewWeekDays[0]?.id ?? null)
    }
  }, [previewSelectedDayId, previewWeekDays])

  useEffect(() => {
    if (!listedPlans.some((plan) => plan.id === copySourcePlanId)) {
      setCopySourcePlanId(listedPlans[0]?.id ?? "mock-program-dec-1-2026")
    }
  }, [copySourcePlanId, listedPlans])

  useEffect(() => {
    if (!isScopedCoach) return
    setAssignTarget("team")
    setAssignSubgroup(effectiveTeam?.eventGroup ?? "Sprint")
    setSelectedAthleteIds([])
  }, [effectiveTeam?.eventGroup, isScopedCoach])

  useEffect(() => {
    if (isScopedCoach && effectiveTeam?.eventGroup) {
      setTemplateGroup(effectiveTeam.eventGroup)
      return
    }
    if (!availableTemplateGroups.includes(templateGroup)) {
      setTemplateGroup(availableTemplateGroups[0] ?? "Sprint")
    }
  }, [availableTemplateGroups, effectiveTeam?.eventGroup, isScopedCoach, templateGroup])

  useEffect(() => {
    if (!listedPlans.some((plan) => plan.id === copySourcePlanId)) {
      setCopySourcePlanId(listedPlans[0]?.id ?? "mock-program-dec-1-2026")
    }
  }, [copySourcePlanId, listedPlans])

  useEffect(() => {
    setShowSessionDetails(false)
  }, [editingDayId])

  useEffect(() => {
    if (!editingDayId || typeof window === "undefined" || window.innerWidth >= 1024) return

    requestAnimationFrame(() => {
      sessionEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }, [editingDayId])

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
      if (view !== "wizard") return
      if (editingDayId) {
        setEditingDayId(null)
        return
      }
      setView("list")
    }

    window.addEventListener("pacelab:mobile-detail-back", handleMobileDetailBack)
    return () => {
      window.removeEventListener("pacelab:mobile-detail-back", handleMobileDetailBack)
    }
  }, [editingDayId, view])

  if (view === "list") {
    return (
      <div className="mx-auto w-full max-w-8xl space-y-6 p-4 sm:p-6">
        <StandardPageHeader
          eyebrow="Coach programs"
          title="Training Plans"
          description={`Browse plans and create a new one.${effectiveTeam ? ` Viewing ${effectiveTeam.name}.` : ""}`}
          trailing={
            <Button
              type="button"
              onClick={openWizard}
              className="h-12 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
            >
              <HugeiconsIcon icon={Add01Icon} className="size-4" />
              Create program
            </Button>
          }
        />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-3">
            {listedPlans.length === 0 ? (
              <EmptyStateCard
                eyebrow="Plans"
                title="No training plans exist yet."
                description="This team has not published or drafted any plan in the current workspace."
                hint="Start with a blank plan or use the create action to build the first week structure."
                icon={<HugeiconsIcon icon={Search01Icon} className="size-5" />}
                className="rounded-[26px] bg-white px-5 py-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)]"
                contentClassName="gap-3"
                actions={
                  <Button type="button" className="h-10 rounded-full px-4" onClick={openWizard}>
                    Create first plan
                  </Button>
                }
              />
            ) : null}
            {listedPlans.map((plan) => {
              const teamName = mockTeams.find((team) => team.id === plan.teamId)?.name ?? "Assigned team"
              const isSelected = previewPlan?.id === plan.id
              const planAthletes = mockAthletes.filter((athlete) => athlete.teamId === plan.teamId)
              return (
                <article
                  key={plan.id}
                  className={cn(
                    "rounded-[26px] border bg-white px-4 py-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)] transition-all sm:px-5",
                    isSelected ? "border-[#1f8cff] shadow-[0_18px_48px_rgba(31,140,255,0.12)]" : "border-slate-200",
                  )}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (typeof window !== "undefined" && window.innerWidth < 1280) {
                      openPlanInBuilder(plan)
                    }
                  }}
                  onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && typeof window !== "undefined" && window.innerWidth < 1280) {
                      event.preventDefault()
                      openPlanInBuilder(plan)
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {teamName}
                        </span>
                        <span className="inline-flex rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                          {plan.weeks} week{plan.weeks === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className="text-[1.15rem] font-semibold leading-tight tracking-[-0.03em] text-slate-950">{plan.name}</p>
                      <p className="text-sm text-slate-500">Starts {plan.startDate}</p>
                      <div className="flex items-center gap-3 pt-1">
                        <div className="flex -space-x-2">
                          {planAthletes.slice(0, 5).map((athlete, index) => (
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
                          {planAthletes.length > 5 ? (
                            <div className="flex size-8 items-center justify-center rounded-full border-2 border-white bg-slate-950 text-[11px] font-semibold text-white shadow-sm">
                              +{planAthletes.length - 5}
                            </div>
                          ) : null}
                        </div>
                        <p className="text-xs text-slate-500">
                          {planAthletes.length} athlete{planAthletes.length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-3 py-1.5 text-xs font-semibold",
                        plan.status === "Published" ? "bg-[#1f8cff] text-white" : "bg-slate-100 text-slate-700",
                      )}
                    >
                      {plan.status}
                    </span>
                  </div>
                  <div className="mt-4 hidden flex-wrap gap-2 xl:flex">
                    <Button
                      type="button"
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      className={cn(
                        "h-11 rounded-full px-5",
                        isSelected
                          ? "bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] text-white shadow-[0_12px_28px_rgba(31,140,255,0.24)] hover:opacity-95"
                          : "",
                      )}
                      onClick={() => {
                        setPreviewPlanId(plan.id)
                        setPreviewWeek(1)
                      }}
                    >
                      Preview
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 rounded-full border-slate-200 px-5 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950"
                      onClick={() => openPlanInBuilder(plan)}
                    >
                      Open
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>

          {previewPlan ? (
            <aside className="hidden overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.06)] xl:block">
              <div className="bg-[linear-gradient(135deg,#081528_0%,#0b1f39_58%,#14386f_100%)] px-5 py-5 text-white">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6fb6ff]">Plan Preview</p>
                <h2 className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-[-0.04em]">{previewPlan.name}</h2>
                <p className="mt-2 text-sm text-white/72">
                  {previewPlanTeam?.name ?? "Assigned team"} | {previewPlan.weeks} weeks | starts {previewPlan.startDate}
                </p>
              </div>

              <div className="space-y-4 px-5 py-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Weeks</p>
                    <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{previewPlan.weeks}</p>
                  </div>
                  <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Status</p>
                    <p className="mt-2 text-base font-semibold text-slate-950">{previewPlan.status}</p>
                  </div>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {Array.from({ length: previewPlan.weeks }, (_, index) => index + 1).map((weekNumber) => (
                    <Button
                      key={weekNumber}
                      type="button"
                      size="sm"
                      variant={previewWeek === weekNumber ? "default" : "outline"}
                      className={cn(
                        "h-10 rounded-full px-4",
                        previewWeek === weekNumber ? "bg-slate-950 text-white hover:bg-slate-950" : "",
                      )}
                      onClick={() => setPreviewWeek(weekNumber)}
                    >
                      Week {weekNumber}
                    </Button>
                  ))}
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <div className="border-b border-slate-200 pb-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Week {previewWeek}</p>
                    <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">{formatWeekRange(previewWeekDays)}</p>
                  </div>

                  <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-5 gap-2">
                      {previewWeekDays.map((day) => {
                        const isSelected = previewSelectedDay?.id === day.id
                        return (
                          <button
                            key={day.id}
                            type="button"
                            onClick={() => setPreviewSelectedDayId(day.id)}
                            className={cn(
                              "rounded-[18px] border px-2 py-3 text-left transition",
                              isSelected
                                ? "border-[#1f8cff] bg-[#eaf3ff] shadow-[0_10px_24px_rgba(31,140,255,0.12)]"
                                : "border-slate-200 bg-white hover:border-slate-300",
                            )}
                          >
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{day.label}</p>
                            <p className="mt-1 text-base font-semibold tracking-[-0.03em] text-slate-950">
                              {new Date(day.dateIso).getDate()}
                            </p>
                            <div className="mt-3 space-y-1">
                              <div className={cn("h-1.5 rounded-full", day.blocks.length > 0 || day.exerciseRows.length > 0 ? "bg-[#1f8cff]" : "bg-slate-200")} />
                              <p className="text-[11px] text-slate-500">
                                {day.exerciseRows.length > 0 ? `${day.exerciseRows.length} exercises` : day.blocks.length > 0 ? `${day.blocks.length} blocks` : "Empty"}
                              </p>
                            </div>
                          </button>
                        )
                      })}
                    </div>

                    {previewSelectedDay ? (
                      <div className="rounded-[20px] border border-slate-200 bg-white p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                              {previewSelectedDay.label} | {formatShortDate(previewSelectedDay.dateIso)}
                            </p>
                            <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">
                              {previewSelectedDay.title || "No session title"}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                              dayStatus(previewSelectedDay) === "Ready"
                                ? "bg-[#eef5ff] text-[#1f5fd1]"
                                : "bg-slate-100 text-slate-600",
                            )}
                          >
                            {dayStatus(previewSelectedDay)}
                          </span>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2 py-1 text-xs font-medium",
                              sessionTypeClassName(previewSelectedDay.sessionType),
                            )}
                          >
                            {previewSelectedDay.sessionType}
                          </span>
                          {previewSelectedDay.location ? <span className="text-xs text-slate-500">{previewSelectedDay.location}</span> : null}
                          {previewSelectedDay.time ? <span className="text-xs text-slate-500">{previewSelectedDay.time}</span> : null}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-1">
                          {previewSelectedDay.exerciseRows.length > 0 ? (
                            <>
                              {previewSelectedDay.exerciseRows.slice(0, 5).map((row) => (
                                <Badge key={row.id} variant="outline">
                                  {row.name}
                                </Badge>
                              ))}
                              {previewSelectedDay.exerciseRows.length > 5 ? <Badge variant="outline">+{previewSelectedDay.exerciseRows.length - 5} more</Badge> : null}
                            </>
                          ) : (
                            <>
                              {previewSelectedDay.blocks.slice(0, 5).map((block) => (
                                <Badge key={block.id} variant="outline">
                                  {block.type}
                                </Badge>
                              ))}
                              {previewSelectedDay.blocks.length > 5 ? <Badge variant="outline">+{previewSelectedDay.blocks.length - 5} more</Badge> : null}
                              {previewSelectedDay.blocks.length === 0 ? (
                                <p className="text-xs text-slate-500">No program details scheduled for this day.</p>
                              ) : null}
                            </>
                          )}
                        </div>

                        {previewSelectedDay.notes ? (
                          <div className="mt-4 rounded-[16px] bg-slate-50 px-3 py-3 text-sm text-slate-600">
                            {previewSelectedDay.notes}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </aside>
          ) : (
            <aside className="hidden rounded-[30px] border border-dashed border-slate-200 bg-white px-5 py-6 shadow-[0_18px_48px_rgba(15,23,42,0.04)] xl:block">
              <div className="space-y-4">
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Plan Preview</p>
                  <h2 className="mt-3 text-[1.4rem] font-semibold tracking-[-0.04em] text-slate-950">No Plan Selected</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    Choose a plan from the list to preview its week layout and inspect the scheduled program by day.
                  </p>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <div className="border-b border-slate-200 pb-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Week Preview</p>
                    <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">Select a plan to begin</p>
                  </div>

                  <div className="mt-4 grid grid-cols-5 gap-2">
                    {["Mon", "Tue", "Wed", "Thu", "Fri"].map((label) => (
                      <div key={label} className="rounded-[18px] border border-slate-200 bg-white px-2 py-3 opacity-70">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
                        <div className="mt-6 h-1.5 rounded-full bg-slate-200" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2 pt-1">
        <h1 className="text-[2.35rem] leading-[0.95] font-semibold tracking-[-0.07em] text-slate-950 sm:text-[2.8rem]">
          Create Training Plan
        </h1>
        <p className="max-w-xl text-[0.95rem] leading-6 text-slate-600">
          Set up the plan, shape the week structure, then review before publishing.
          {scopedTeamId ? ` Scoped to ${effectiveTeam?.name ?? scopedTeamId}.` : ""}
        </p>
      </header>

      <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: 1, label: "Setup" },
            { value: 2, label: "Build" },
            { value: 3, label: "Review" },
          ].map((item) => (
            <div key={item.value} className="space-y-2">
              <div className={cn("h-2 rounded-full", step >= item.value ? "bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)]" : "bg-slate-100")} />
              <p className={cn("text-center text-xs font-medium", step >= item.value ? "text-slate-950" : "text-slate-400")}>{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      {step === 1 ? (
        <section className="space-y-5 rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.05)]">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Step 1</p>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">Setup</h2>
            <p className="text-sm text-slate-500">
              {isScopedCoach ? "Define the plan context for your assigned group." : "Define the plan context and who it will be assigned to."}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Plan Name</Label>
              <Input
                placeholder="U20 Outdoor Base 1"
                value={basics.planName}
                onChange={(event) => setBasics((prev) => ({ ...prev, planName: event.target.value }))}
              />
            </div>
            {scopedTeamId ? null : (
              <div className="space-y-2">
                <Label>Team</Label>
                <Select value={basics.teamId} onValueChange={(value) => setBasics((prev) => ({ ...prev, teamId: value }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {mockTeams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={basics.startDate}
                onChange={(event) => setBasics((prev) => ({ ...prev, startDate: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Duration (weeks)</Label>
              <Select
                value={String(basics.durationWeeks)}
                onValueChange={(value) => setBasics((prev) => ({ ...prev, durationWeeks: Number(value) }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value} weeks
                    </SelectItem>
                  ))}
                  <SelectItem value="10">10 weeks</SelectItem>
                  <SelectItem value="12">12 weeks</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Training Days Per Week</Label>
              <Select
                value={String(basics.trainingDaysPerWeek)}
                onValueChange={(value) => handleTrainingDaysPerWeekChange(Number(value))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRAINING_DAYS_OPTIONS.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Build Mode</Label>
              <Select
                value={basics.buildMode}
                onValueChange={(value) => setBasics((prev) => ({ ...prev, buildMode: value as ProgramBuildMode }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="simple">Simple</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                {basics.buildMode === "simple"
                  ? "Simple mode uses flat exercise rows for the whole program."
                  : "Advanced mode uses structured blocks for the whole program."}
              </p>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Notes (optional)</Label>
              <Textarea
                className="min-h-[104px] rounded-[22px] border-slate-200 bg-slate-50/70 shadow-none"
                rows={3}
                placeholder="Optional plan notes"
                value={basics.notes}
                onChange={(event) => setBasics((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
            <div className="space-y-1">
              <h3 className="font-semibold text-slate-950">{isScopedCoach ? "Publishing" : "Assignment"}</h3>
              <p className="text-sm text-slate-500">
                {isScopedCoach ? "This plan is locked to your assigned team." : "Set the target now so the plan is built for the right group."}
              </p>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {isScopedCoach ? (
                <div className="space-y-2">
                  <Label>Team</Label>
                  <Input value={effectiveTeam?.name ?? "Assigned team"} readOnly />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Assign to</Label>
                    <Select value={assignTarget} onValueChange={(value) => setAssignTarget(value as AssignTarget)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="team">Whole team</SelectItem>
                        <SelectItem value="subgroup">Subgroup</SelectItem>
                        <SelectItem value="selected">Selected athletes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Team</Label>
                    <Input value={effectiveTeam?.name ?? "Assigned team"} readOnly />
                  </div>

                  {assignTarget === "subgroup" ? (
                    <div className="space-y-2">
                      <Label>Subgroup</Label>
                      <Select value={assignSubgroup} onValueChange={(value) => setAssignSubgroup(value as EventGroup)}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
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
                  <div className="space-y-2 md:col-span-2">
                    <Label>Selected athletes</Label>
                      <div className="grid gap-2 rounded-[20px] border border-slate-200 bg-white p-3 sm:grid-cols-2">
                        {teamAthletes.map((athlete) => (
                          <button
                            key={athlete.id}
                            type="button"
                            className={cn(
                              "flex items-center justify-between rounded-[16px] border px-3 py-2 text-left",
                              selectedAthleteIds.includes(athlete.id) ? "border-[#1f8cff] bg-[#eef5ff]" : "border-slate-200 bg-white",
                            )}
                            onClick={() =>
                              setSelectedAthleteIds((prev) =>
                                prev.includes(athlete.id) ? prev.filter((id) => id !== athlete.id) : [...prev, athlete.id],
                              )
                            }
                          >
                            <span className="text-sm font-medium">{athlete.name}</span>
                            <EventGroupBadge group={athlete.eventGroup} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              <div className="space-y-2">
                <Label>Visibility start</Label>
                <Select value={visibilityStart} onValueChange={(value) => setVisibilityStart(value as "immediate" | "scheduled")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="immediate">Immediate</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {visibilityStart === "scheduled" ? (
                <div className="space-y-2">
                  <Label>Scheduled date</Label>
                  <Input type="date" value={visibilityDate} onChange={(event) => setVisibilityDate(event.target.value)} />
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Athlete permissions</Label>
                <Select value={athletePermissions} onValueChange={(value) => setAthletePermissions(value as "none" | "read-only")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="read-only">Read only comments</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" type="button" className="h-11 rounded-full border-slate-200 px-5 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950" onClick={saveDraft}>
              Save Draft
            </Button>
            <Button type="button" className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95" onClick={handleBasicsNext}>
              Continue to Build
              <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
            </Button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.05)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Step 2</p>
                <h2 className="text-lg font-semibold tracking-tight text-slate-950">Build</h2>
                <p className="text-sm text-slate-500">
                  {basics.buildMode === "simple"
                    ? "Build the program week by week with direct exercise rows."
                    : "Choose the starting structure, then adjust the weeks directly."}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" type="button" className="h-11 rounded-full border-slate-200 px-5 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950" onClick={() => setStep(1)}>
                  <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
                  Back to Setup
                </Button>
                {basics.buildMode === "advanced" ? (
                  <Button type="button" variant="outline" className="h-11 rounded-full border-slate-200 px-5 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950" onClick={requestRegeneratePlanStructure}>
                    Regenerate from source
                  </Button>
                ) : null}
                <Button type="button" className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95" onClick={openReview} disabled={!canPublish}>
                  Continue to Review
                  <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              {basics.buildMode === "advanced" ? (
                <div className="grid gap-3 md:grid-cols-3">
                  {[
                    { id: "template", title: "Start from Template", description: "Auto-generate the initial weekly structure." },
                    { id: "copy", title: "Copy Existing Plan", description: "Start from a real plan instead of a label-only template." },
                    { id: "blank", title: "Blank Plan", description: "Start with empty training days and fill them yourself." },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={cn(
                        "rounded-[22px] border p-4 text-left transition",
                        source === option.id ? "border-[#1f8cff] bg-[#eef5ff] shadow-[0_10px_24px_rgba(31,140,255,0.1)]" : "border-slate-200 bg-slate-50",
                      )}
                      onClick={() => setSource(option.id as PlanSource)}
                    >
                      <p className="font-medium text-slate-950">{option.title}</p>
                      <p className="mt-1 text-sm text-slate-500">{option.description}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-medium text-slate-950">Simple Mode</p>
                  <p className="mt-1 text-sm text-slate-500">
                    This builder uses flat exercise rows for each training day. No templates or block structure are applied.
                  </p>
                </div>
              )}

              <div className="grid gap-3">
                {basics.buildMode === "advanced" && source === "template" ? (
                  <div className="space-y-2">
                    <Label>Template group</Label>
                    {isScopedCoach && effectiveTeam ? (
                      <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-sm font-medium text-slate-950">{effectiveTeam.eventGroup}</p>
                        <p className="mt-1 text-xs text-slate-500">Locked to your assigned coaching group.</p>
                      </div>
                    ) : (
                      <Select value={templateGroup} onValueChange={(value) => setTemplateGroup(value as EventGroup)}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EVENT_GROUP_OPTIONS.filter((option) => availableTemplateGroups.includes(option.value)).map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                ) : null}

                {basics.buildMode === "advanced" && source === "copy" ? (
                  <div className="space-y-2">
                    <Label>Plan to copy</Label>
                    <Select value={copySourcePlanId} onValueChange={setCopySourcePlanId}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {listedPlans.map((plan) => (
                          <SelectItem key={plan.id} value={plan.id}>
                            {plan.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {copySourcePlan ? `Copying structure from ${copySourcePlan.name}.` : "Pick a source plan to clone."}
                    </p>
                  </div>
                ) : null}

                <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current target</p>
                  <p className="mt-2 text-sm text-slate-500">
                    {effectiveTeam?.name ?? "Assigned team"} | {basics.durationWeeks} weeks | {assignedCount} athletes
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-950">Week Builder</h2>
              <p className="text-sm text-slate-500">
                Review the week in a calendar on desktop or use the stacked list to edit session details.
              </p>
            </div>
            <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
              {Math.round(completenessRatio * 100)}% complete
            </span>
          </div>

          <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Build Summary</p>
            <div className="mt-3 grid gap-3 text-sm text-slate-500 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <p>Assignment</p>
                <p className="font-medium text-slate-950">
                  {assignTarget === "team" ? "Whole team" : assignTarget === "subgroup" ? `${assignSubgroup} subgroup` : "Selected athletes"}
                </p>
                <p>{assignedCount} athletes targeted</p>
              </div>
              <div>
                <p>{basics.buildMode === "simple" ? "Mode" : "Source"}</p>
                <p className="font-medium text-slate-950">
                  {basics.buildMode === "simple"
                    ? "Simple row builder"
                    : source === "template"
                      ? `${templateGroup} template`
                      : source === "copy"
                        ? copySourcePlan?.name ?? "Copied plan"
                        : "Blank build"}
                </p>
              </div>
              <div>
                <p>Progress</p>
                <p className="font-medium text-slate-950">{configuredDaysCount} configured days</p>
                <p>{Math.round(completenessRatio * 100)}% publish readiness</p>
              </div>
              <div>
                <p>Visibility</p>
                <p className="font-medium text-slate-950">{visibilityStart === "scheduled" ? visibilityDate : "Immediate"}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {Array.from({ length: basics.durationWeeks }, (_, index) => index + 1).map((weekNumber) => (
                <Button
                  key={weekNumber}
                  type="button"
                  size="sm"
                  variant={activeWeek === weekNumber ? "default" : "outline"}
                  className={cn(
                    activeWeek === weekNumber
                      ? ""
                      : "border-slate-200 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950",
                  )}
                  onClick={() => setActiveWeek(weekNumber)}
                >
                  Week {weekNumber}
                </Button>
              ))}
            </div>

            <div className="hidden items-center gap-2 lg:flex">
              <Button
                type="button"
                size="sm"
                variant={weekViewMode === "calendar" ? "default" : "outline"}
                onClick={() => setWeekViewMode("calendar")}
              >
                Calendar
              </Button>
              <Button
                type="button"
                size="sm"
                variant={weekViewMode === "list" ? "default" : "outline"}
                onClick={() => setWeekViewMode("list")}
              >
                List
              </Button>
              <Button type="button" size="sm" className="rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-4 text-white hover:opacity-95" disabled={!canPublish} onClick={openReview}>
                Continue to Review
              </Button>
            </div>
          </div>

          {weekViewMode === "calendar" ? (
            <section className="hidden rounded-3xl border bg-card p-5 lg:block">
              <div className="flex items-end justify-between gap-6 border-b pb-5">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Week {activeWeek}</p>
                  <h3 className="text-2xl font-semibold tracking-tight">{formatWeekRange(activeWeekDays)}</h3>
                </div>
                <p className="max-w-md text-right text-sm leading-6 text-muted-foreground">
                  {basics.buildMode === "simple"
                    ? "Scan the full week here, then open a day to edit direct exercise rows."
                    : "Scan the full week here, then open a day when you need to adjust sections or timing."}
                </p>
              </div>

              <div
                className="mt-5 grid items-stretch gap-4"
                style={{ gridTemplateColumns: `repeat(${Math.max(activeWeekDays.length, 1)}, minmax(0, 1fr))` }}
              >
                {activeWeekDays.map((day) => (
                  <article
                    key={day.id}
                    role="button"
                    tabIndex={0}
                    draggable={day.isTrainingDay}
                    onClick={() => openSessionEditor(day.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        openSessionEditor(day.id)
                      }
                    }}
                    onDragStart={(event) => {
                      if (!day.isTrainingDay) return
                      event.dataTransfer.effectAllowed = "move"
                      setDraggedDayId(day.id)
                      setDragOverDayId(day.id)
                    }}
                    onDragOver={(event) => {
                      if (!draggedDayId || draggedDayId === day.id) return
                      event.preventDefault()
                      setDragOverDayId(day.id)
                    }}
                    onDragLeave={() => {
                      if (dragOverDayId === day.id) {
                        setDragOverDayId(null)
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (!draggedDayId) return
                      reorderSessionWithinWeek(draggedDayId, day.id)
                    }}
                    onDragEnd={() => {
                      setDraggedDayId(null)
                      setDragOverDayId(null)
                    }}
                    className={cn(
                      "flex min-h-[28rem] min-w-0 cursor-pointer flex-col rounded-3xl border border-l-4 p-4 shadow-sm transition-all duration-150 outline-none",
                      sessionTypeClassName(day.sessionType),
                      day.isTrainingDay ? "bg-background hover:-translate-y-1 hover:shadow-md" : "bg-muted/40",
                      editingDayId === day.id ? "ring-2 ring-primary ring-offset-2" : "",
                      dragOverDayId === day.id && draggedDayId !== day.id ? "ring-2 ring-dashed ring-primary/70 ring-offset-2" : "",
                      draggedDayId === day.id ? "opacity-60" : "",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-lg font-semibold leading-tight">
                          {day.label} <span className="text-muted-foreground">{formatShortDate(day.dateIso)}</span>
                        </p>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{day.location || "Location TBD"}</p>
                      </div>
                      <Badge variant={dayStatus(day) === "Ready" ? "default" : "secondary"}>{dayStatus(day)}</Badge>
                    </div>

                    <div className="mt-5 space-y-4">
                      <div className="space-y-3">
                        <p className="text-base font-semibold leading-6">{day.title || (day.isTrainingDay ? "No session title" : "Recovery / Rest")}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2 py-1 text-xs font-medium",
                              sessionTypeClassName(day.sessionType),
                            )}
                          >
                            {day.sessionType}
                          </span>
                          {day.time ? <span className="text-xs text-muted-foreground">{day.time}</span> : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {basics.buildMode === "simple" ? (
                          day.exerciseRows.length > 0 ? (
                            <>
                              <Badge variant="outline">{day.exerciseRows.length} exercises</Badge>
                              {day.exerciseRows.slice(0, 2).map((row) => (
                                <Badge key={row.id} variant="outline">
                                  {row.name}
                                </Badge>
                              ))}
                              {day.exerciseRows.length > 2 ? <Badge variant="outline">+{day.exerciseRows.length - 2} more</Badge> : null}
                            </>
                          ) : (
                            <div className="w-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">No exercises yet</p>
                              <p className="mt-1 text-xs leading-5 text-slate-500">Add exercise rows to turn this day into a structured session.</p>
                            </div>
                          )
                        ) : (
                          <>
                            {day.blocks.slice(0, 3).map((block) => (
                              <Badge key={block.id} variant="outline">
                                {block.type}
                              </Badge>
                            ))}
                            {day.blocks.length > 3 ? <Badge variant="outline">+{day.blocks.length - 3} more</Badge> : null}
                            {day.blocks.length === 0 ? (
                              <div className="w-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3">
                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">No sections yet</p>
                                <p className="mt-1 text-xs leading-5 text-slate-500">Add blocks to define the main parts of this session.</p>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>

                      {day.notes ? (
                        <div className="rounded-2xl border bg-background/70 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Notes</p>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">{day.notes}</p>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-auto space-y-3 pt-5">
                      <div className="rounded-2xl border bg-background/70 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Interaction</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {basics.buildMode === "simple"
                            ? "Click anywhere to open. Drag this card onto another day to move the whole day's prescription."
                            : "Click anywhere to open. Drag this card onto another day to swap sessions."}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full rounded-2xl whitespace-normal py-2 text-xs"
                        onClick={(event) => {
                          event.stopPropagation()
                          duplicateFromLastWeek(day)
                        }}
                        disabled={day.week <= 1}
                      >
                        Duplicate from last week
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <div className={cn("space-y-3", weekViewMode === "calendar" ? "lg:hidden" : "")}>
            {activeWeekDays.map((day) => (
              <div key={day.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {day.label} | {formatShortDate(day.dateIso)}
                    </p>
                    <p className="text-sm text-muted-foreground">{day.title || "No session title"}</p>
                  </div>
                  <Badge variant={dayStatus(day) === "Ready" ? "default" : "secondary"}>{dayStatus(day)}</Badge>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {basics.buildMode === "simple" ? (
                    day.exerciseRows.length > 0 ? (
                      <>
                        <Badge variant="outline">{day.exerciseRows.length} exercises</Badge>
                        {day.exerciseRows.slice(0, 2).map((row) => (
                          <Badge key={row.id} variant="outline">
                            {row.name}
                          </Badge>
                        ))}
                      </>
                    ) : (
                      <div className="w-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">No exercises yet</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">Add exercise rows before publishing this day.</p>
                      </div>
                    )
                  ) : (
                    <>
                      {day.blocks.slice(0, 3).map((block) => (
                        <Badge key={block.id} variant="outline">
                          {block.type}
                        </Badge>
                      ))}
                      {day.blocks.length === 0 ? (
                        <div className="w-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">No blocks yet</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">Add blocks to define the flow of this session.</p>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <Button type="button" variant="outline" onClick={() => openSessionEditor(day.id)}>
                    Edit Session
                  </Button>
                  <Button type="button" variant="outline" onClick={() => duplicateFromLastWeek(day)} disabled={day.week <= 1}>
                    Duplicate from last week
                  </Button>
                  <Button type="button" variant="outline" onClick={() => clearDay(day.id)}>
                    Clear day
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="sticky bottom-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
            <div className="rounded-xl border bg-background/95 p-2 backdrop-blur">
              <Button
                type="button"
                className="h-11 w-full rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
                disabled={!canPublish}
                onClick={openReview}
              >
                Continue to Review
              </Button>
              {!canPublish ? (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Add sessions to at least 60% of training days before publishing.
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {step === 2 && editingDay ? (
        <section ref={sessionEditorRef} className="space-y-4 rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Session Editor</h2>
              <p className="text-sm text-muted-foreground">
                Week {editingDay.week} | {editingDay.label} | {formatShortDate(editingDay.dateIso)}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="icon" aria-label="Quick tools">
                  <HugeiconsIcon icon={MoreHorizontalIcon} className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={copySessionToNextDay}>Copy session to next day</DropdownMenuItem>
                <DropdownMenuItem onClick={repeatWeekly}>Repeat weekly</DropdownMenuItem>
                <DropdownMenuItem onClick={createABDays}>Create A/B days</DropdownMenuItem>
                {basics.buildMode === "advanced" ? <DropdownMenuItem onClick={useTemplateBlock}>Use template block</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {basics.buildMode === "simple" ? (
            <>
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <div className="space-y-2">
                    <Label>Session Title</Label>
                    <Input
                      value={editingDay.title}
                      onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, title: event.target.value }))}
                      placeholder="Monday Strength"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-slate-200 text-slate-700 hover:border-[#c8d9ff] hover:bg-[#f6f9ff] hover:text-[#1f5fd1]"
                    onClick={() => setShowSessionDetails((prev) => !prev)}
                  >
                    {showSessionDetails ? "Hide details" : "Details"}
                  </Button>
                </div>

                {showSessionDetails ? (
                  <div className="grid gap-4 border-t border-slate-200 pt-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Time (optional)</Label>
                      <Input
                        value={editingDay.time}
                        onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, time: event.target.value }))}
                        placeholder="07:30"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Location (optional)</Label>
                      <Input
                        value={editingDay.location}
                        onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, location: event.target.value }))}
                        placeholder="Track A"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Session Notes (optional)</Label>
                      <Textarea
                        value={editingDay.notes}
                        onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, notes: event.target.value }))}
                        placeholder="Optional context for staff or athletes."
                        rows={3}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-950">Exercises</h3>
                    <p className="text-sm text-slate-500">Add the day exactly as you would write it in a notebook or spreadsheet.</p>
                  </div>
                  <>
                    <Drawer>
                      <DrawerTrigger asChild>
                        <Button type="button" size="sm" className="md:hidden">
                          <HugeiconsIcon icon={Add01Icon} className="size-4" />
                          Add exercise
                        </Button>
                      </DrawerTrigger>
                      <DrawerContent className="max-h-[85dvh]">
                        <DrawerHeader className="text-left">
                          <DrawerTitle>Add Exercise</DrawerTitle>
                          <DrawerDescription>Add one direct exercise row to this day.</DrawerDescription>
                        </DrawerHeader>
                        <div className="overflow-y-auto px-4 pb-4">
                          <div className="grid gap-3">
                            <div className="space-y-2">
                              <Label>Exercise</Label>
                              <Input
                                value={editingDay.exerciseDraft.name}
                                onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, name: event.target.value } }))}
                                placeholder="Power Cleans"
                              />
                            </div>
                            <div className="grid gap-3 grid-cols-3">
                              <div className="space-y-2">
                                <Label>Sets</Label>
                                <Input value={editingDay.exerciseDraft.sets} onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, sets: event.target.value } }))} placeholder="6" />
                              </div>
                              <div className="space-y-2">
                                <Label>Reps</Label>
                                <Input value={editingDay.exerciseDraft.reps} onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, reps: event.target.value } }))} placeholder="2" />
                              </div>
                              <div className="space-y-2">
                                <Label>% / Load</Label>
                                <Input value={editingDay.exerciseDraft.load} onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, load: event.target.value } }))} placeholder="60-70%" />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label>Note</Label>
                              <Input value={editingDay.exerciseDraft.notes} onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, notes: event.target.value } }))} placeholder="BW / adjusted / cue" />
                            </div>
                            <DrawerClose asChild>
                              <Button
                                type="button"
                                onClick={() =>
                                  updateDay(editingDay.id, (day) => {
                                    if (!day.exerciseDraft.name.trim()) return day
                                    return {
                                      ...day,
                                      exerciseRows: [
                                        ...day.exerciseRows,
                                        { ...day.exerciseDraft, id: makeId("exercise"), name: day.exerciseDraft.name.trim() },
                                      ],
                                      exerciseDraft: { ...day.exerciseDraft, name: "", sets: "", reps: "", load: "", notes: "" },
                                    }
                                  })
                                }
                              >
                                Add row
                              </Button>
                            </DrawerClose>
                          </div>
                        </div>
                      </DrawerContent>
                    </Drawer>

                    <Dialog>
                      <DialogTrigger asChild>
                        <Button type="button" size="sm" variant="outline" className="hidden border-slate-200 text-slate-700 hover:border-[#c8d9ff] hover:bg-[#f6f9ff] hover:text-[#1f5fd1] md:inline-flex">
                          <HugeiconsIcon icon={Add01Icon} className="size-4" />
                          Add exercise
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-lg">
                        <DialogHeader className="text-left">
                          <DialogTitle>Add Exercise</DialogTitle>
                          <DialogDescription>Add one direct exercise row to this day.</DialogDescription>
                        </DialogHeader>
                        <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
                          <div className="space-y-2">
                            <Label>Exercise</Label>
                            <Input value={editingDay.exerciseDraft.name} onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, name: event.target.value } }))} placeholder="Power Cleans" />
                          </div>
                          <div className="grid gap-3 grid-cols-3">
                            <div className="space-y-2">
                              <Label>Sets</Label>
                              <Input value={editingDay.exerciseDraft.sets} onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, sets: event.target.value } }))} placeholder="6" />
                            </div>
                            <div className="space-y-2">
                              <Label>Reps</Label>
                              <Input value={editingDay.exerciseDraft.reps} onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, reps: event.target.value } }))} placeholder="2" />
                            </div>
                            <div className="space-y-2">
                              <Label>% / Load</Label>
                              <Input value={editingDay.exerciseDraft.load} onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, load: event.target.value } }))} placeholder="60-70%" />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>Note</Label>
                            <Input value={editingDay.exerciseDraft.notes} onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, exerciseDraft: { ...day.exerciseDraft, notes: event.target.value } }))} placeholder="BW / adjusted / cue" />
                          </div>
                          <DialogClose asChild>
                            <Button
                              type="button"
                              onClick={() =>
                                updateDay(editingDay.id, (day) => {
                                  if (!day.exerciseDraft.name.trim()) return day
                                  return {
                                    ...day,
                                    exerciseRows: [
                                      ...day.exerciseRows,
                                      { ...day.exerciseDraft, id: makeId("exercise"), name: day.exerciseDraft.name.trim() },
                                    ],
                                    exerciseDraft: { ...day.exerciseDraft, name: "", sets: "", reps: "", load: "", notes: "" },
                                  }
                                })
                              }
                            >
                              Add row
                            </Button>
                          </DialogClose>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="pb-2 font-medium">Exercise</th>
                        <th className="pb-2 font-medium">Sets</th>
                        <th className="pb-2 font-medium">Reps</th>
                        <th className="pb-2 font-medium">% / Load</th>
                        <th className="pb-2 font-medium">Note</th>
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {editingDay.exerciseRows.map((row) => (
                        <tr key={row.id} className="border-b border-slate-100 last:border-b-0">
                          <td className="py-3 pr-3 font-medium text-slate-950">{row.name}</td>
                          <td className="py-3 pr-3 text-slate-600">{row.sets || "-"}</td>
                          <td className="py-3 pr-3 text-slate-600">{row.reps || "-"}</td>
                          <td className="py-3 pr-3 text-slate-600">{row.load || "-"}</td>
                          <td className="py-3 pr-3 text-slate-600">{row.notes || "-"}</td>
                          <td className="py-3 text-right">
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="border-slate-200 text-slate-700 hover:border-[#c8d9ff] hover:bg-[#f6f9ff] hover:text-[#1f5fd1]"
                              aria-label="Delete exercise row"
                              onClick={() =>
                                updateDay(editingDay.id, (day) => ({
                                  ...day,
                                  exerciseRows: day.exerciseRows.filter((item) => item.id !== row.id),
                                }))
                              }
                            >
                              <HugeiconsIcon icon={Delete01Icon} className="size-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {editingDay.exerciseRows.length === 0 ? (
                    <EmptyStateCard
                      eyebrow="Session rows"
                      title="No exercises have been added yet."
                      description="This day is still empty at the row level, so it will not show a structured exercise list."
                      hint="Use the fields above to add the first exercise row."
                      icon={<HugeiconsIcon icon={Search01Icon} className="size-5" />}
                      className="rounded-[18px] border-dashed bg-slate-50 px-4 py-5 shadow-none"
                      contentClassName="gap-2"
                    />
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingDayId(null)}><HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />Back to Week Builder</Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={copySessionToNextDay}>Duplicate Session</Button>
                  <Button type="button" onClick={() => setEditingDayId(null)}>Done</Button>
                </div>
              </div>
            </>
          ) : (
            <>
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-2">
                <Label>Session Title</Label>
                <Input
                  value={editingDay.title}
                  onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, title: event.target.value }))}
                  placeholder="Acceleration + Weights"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="border-slate-200 text-slate-700 hover:border-[#c8d9ff] hover:bg-[#f6f9ff] hover:text-[#1f5fd1]"
                onClick={() => setShowSessionDetails((prev) => !prev)}
              >
                {showSessionDetails ? "Hide details" : "Details"}
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Session Type</Label>
              <div className="flex flex-wrap gap-2">
                {SESSION_TYPES.map((type) => (
                  <Button
                    key={type}
                    type="button"
                    variant={editingDay.sessionType === type ? "default" : "outline"}
                    size="sm"
                    className={editingDay.sessionType === type ? "" : "border-slate-200 text-slate-700 hover:border-[#c8d9ff] hover:bg-[#f6f9ff] hover:text-[#1f5fd1]"}
                    onClick={() => updateDay(editingDay.id, (day) => ({ ...day, sessionType: type }))}
                  >
                    {type}
                  </Button>
                ))}
              </div>
            </div>

            {showSessionDetails ? (
              <div className="grid gap-4 border-t border-slate-200 pt-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Time (optional)</Label>
                  <Input
                    value={editingDay.time}
                    onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, time: event.target.value }))}
                    placeholder="07:30"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Location (optional)</Label>
                  <Input
                    value={editingDay.location}
                    onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, location: event.target.value }))}
                    placeholder="Track A"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Session Notes (optional)</Label>
                  <Textarea
                    value={editingDay.notes}
                    onChange={(event) => updateDay(editingDay.id, (day) => ({ ...day, notes: event.target.value }))}
                    placeholder="Optional context for staff or athletes."
                    rows={3}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Program Blocks</h3>
                <p className="text-sm text-muted-foreground">Start with the main work for the day. Add extra structure only when you need it.</p>
              </div>
              <>
                <div className="hidden flex-wrap gap-2 md:flex">
                  {quickBlockOptions.map((type) => (
                    <Button
                      key={type}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-slate-200 text-slate-700 hover:border-[#c8d9ff] hover:bg-[#f6f9ff] hover:text-[#1f5fd1]"
                      onClick={() => addBlockToDay(editingDay.id, type)}
                    >
                      <HugeiconsIcon icon={Add01Icon} className="size-4" />
                      {type}
                    </Button>
                  ))}
                </div>
                <Drawer>
                  <DrawerTrigger asChild>
                    <Button type="button" size="sm" className="md:hidden">
                      <HugeiconsIcon icon={Add01Icon} className="size-4" />
                      Add block
                    </Button>
                  </DrawerTrigger>
                  <DrawerContent className="max-h-[85dvh]">
                    <DrawerHeader className="text-left">
                      <DrawerTitle>Add Program Block</DrawerTitle>
                      <DrawerDescription>Choose the main block you want to add to this session.</DrawerDescription>
                    </DrawerHeader>
                    <div className="overflow-y-auto px-4 pb-4">
                      <div className="grid gap-2">
                        {ALL_BLOCK_TYPES.map((type) => (
                          <DrawerClose asChild key={type}>
                            <Button
                              type="button"
                              variant="outline"
                              className="justify-start"
                              onClick={() => addBlockToDay(editingDay.id, type)}
                            >
                              {type}
                            </Button>
                          </DrawerClose>
                        ))}
                      </div>
                    </div>
                  </DrawerContent>
                </Drawer>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button type="button" size="sm" variant="outline" className="hidden border-slate-200 text-slate-700 hover:border-[#c8d9ff] hover:bg-[#f6f9ff] hover:text-[#1f5fd1] md:inline-flex">
                      <HugeiconsIcon icon={Add01Icon} className="size-4" />
                      More blocks
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-xl">
                    <DialogHeader className="text-left">
                      <DialogTitle>Add Program Block</DialogTitle>
                      <DialogDescription>Choose the kind of block you want to build for this day.</DialogDescription>
                    </DialogHeader>
                    <div className="grid max-h-[70vh] gap-2 overflow-y-auto pr-1">
                      {ALL_BLOCK_TYPES.map((type) => (
                        <DialogClose asChild key={type}>
                          <Button
                            type="button"
                            variant="outline"
                            className="justify-start"
                            onClick={() => addBlockToDay(editingDay.id, type)}
                          >
                            {type}
                          </Button>
                        </DialogClose>
                      ))}
                    </div>
                  </DialogContent>
                </Dialog>
              </>
            </div>

            {editingDay.blocks.map((block, index) => (
              <div key={block.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="w-full space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="border border-slate-200 bg-slate-100 text-slate-700">
                        {block.type}
                      </Badge>
                    </div>
                    <Label>Block title</Label>
                    <Input
                      value={block.title}
                      onChange={(event) => updateBlock(editingDay.id, block.id, (current) => ({ ...current, title: event.target.value }))}
                    />
                  </div>
                  <div className="flex gap-1 pt-6">
                    <Button type="button" size="icon" variant="outline" className="border-slate-200 text-slate-700 hover:border-[#c8d9ff] hover:bg-[#f6f9ff] hover:text-[#1f5fd1]" onClick={() => updateDay(editingDay.id, (day) => {
                      if (index === 0) return day
                      const blocks = [...day.blocks]
                      ;[blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]]
                      return { ...day, blocks }
                    })} disabled={index === 0} aria-label="Move block up">
                      <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
                    </Button>
                    <Button type="button" size="icon" variant="outline" className="border-slate-200 text-slate-700 hover:border-[#c8d9ff] hover:bg-[#f6f9ff] hover:text-[#1f5fd1]" onClick={() => updateDay(editingDay.id, (day) => {
                      if (index === day.blocks.length - 1) return day
                      const blocks = [...day.blocks]
                      ;[blocks[index + 1], blocks[index]] = [blocks[index], blocks[index + 1]]
                      return { ...day, blocks }
                    })} disabled={index === editingDay.blocks.length - 1} aria-label="Move block down">
                      <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
                    </Button>
                    <Button type="button" size="icon" variant="outline" className="border-slate-200 text-slate-700 hover:border-[#c8d9ff] hover:bg-[#f6f9ff] hover:text-[#1f5fd1]" onClick={() => updateDay(editingDay.id, (day) => ({ ...day, blocks: day.blocks.filter((item) => item.id !== block.id) }))} aria-label="Delete block">
                      <HugeiconsIcon icon={Delete01Icon} className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Programming Notes</Label>
                  <Textarea
                    value={block.content}
                    onChange={(event) => updateBlock(editingDay.id, block.id, (current) => ({ ...current, content: event.target.value }))}
                    placeholder="Write the block the way a coach actually builds it. Example: 4 x 30m starts, full rest. Med ball throws 3 x 6."
                    rows={5}
                  />
                </div>

                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Exercise Rows</Label>
                    <>
                      <Drawer>
                        <DrawerTrigger asChild>
                          <Button type="button" size="sm" variant="outline" className="border-slate-200 text-slate-700 hover:border-[#c8d9ff] hover:bg-[#f6f9ff] hover:text-[#1f5fd1] md:hidden">
                            <HugeiconsIcon icon={Add01Icon} className="size-4" />
                            Add exercise
                          </Button>
                        </DrawerTrigger>
                        <DrawerContent className="max-h-[85dvh]">
                          <DrawerHeader className="text-left">
                            <DrawerTitle>Add Exercise Row</DrawerTitle>
                            <DrawerDescription>
                              Add structured rows when this block needs exact prescription.
                            </DrawerDescription>
                          </DrawerHeader>
                          <div className="overflow-y-auto px-4 pb-4">
                            <div className="grid gap-3">
                              <div className="space-y-2">
                                <Label>Exercise / Drill</Label>
                                <Input
                                  value={block.exerciseDraft.name}
                                  onChange={(event) =>
                                    updateBlock(editingDay.id, block.id, (current) => ({
                                      ...current,
                                      exerciseDraft: { ...current.exerciseDraft, name: event.target.value },
                                    }))
                                  }
                                  placeholder="Power Cleans"
                                />
                              </div>
                              <div className="grid gap-3 grid-cols-3">
                                <div className="space-y-2">
                                  <Label>Sets</Label>
                                  <Input
                                    value={block.exerciseDraft.sets}
                                    onChange={(event) =>
                                      updateBlock(editingDay.id, block.id, (current) => ({
                                        ...current,
                                        exerciseDraft: { ...current.exerciseDraft, sets: event.target.value },
                                      }))
                                    }
                                    placeholder="6"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Reps</Label>
                                  <Input
                                    value={block.exerciseDraft.reps}
                                    onChange={(event) =>
                                      updateBlock(editingDay.id, block.id, (current) => ({
                                        ...current,
                                        exerciseDraft: { ...current.exerciseDraft, reps: event.target.value },
                                      }))
                                    }
                                    placeholder="2"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>% / Load / Target</Label>
                                  <Input
                                    value={block.exerciseDraft.load}
                                    onChange={(event) =>
                                      updateBlock(editingDay.id, block.id, (current) => ({
                                        ...current,
                                        exerciseDraft: { ...current.exerciseDraft, load: event.target.value },
                                      }))
                                    }
                                    placeholder="60-70%"
                                  />
                                </div>
                              </div>
                              <div className="space-y-2">
                                <Label>Notes / Cue</Label>
                                <Input
                                  value={block.exerciseDraft.notes}
                                  onChange={(event) =>
                                    updateBlock(editingDay.id, block.id, (current) => ({
                                      ...current,
                                      exerciseDraft: { ...current.exerciseDraft, notes: event.target.value },
                                    }))
                                  }
                                  placeholder="AMRAP / adjusted / cues"
                                />
                              </div>
                              <DrawerClose asChild>
                                <Button
                                  type="button"
                                  onClick={() =>
                                    updateBlock(editingDay.id, block.id, (current) => {
                                      if (!current.exerciseDraft.name.trim()) return current
                                      return {
                                        ...current,
                                        exerciseRows: [
                                          ...current.exerciseRows,
                                          {
                                            id: makeId("exercise"),
                                            name: current.exerciseDraft.name.trim(),
                                            sets: current.exerciseDraft.sets,
                                            reps: current.exerciseDraft.reps,
                                            load: current.exerciseDraft.load,
                                            notes: current.exerciseDraft.notes,
                                          },
                                        ],
                                        exerciseDraft: {
                                          name: "",
                                          sets: "",
                                          reps: "",
                                          load: "",
                                          notes: "",
                                        },
                                      }
                                    })
                                  }
                                >
                                  Add row
                                </Button>
                              </DrawerClose>
                            </div>
                          </div>
                        </DrawerContent>
                      </Drawer>

                      <Dialog>
                        <DialogTrigger asChild>
                          <Button type="button" size="sm" variant="outline" className="hidden border-slate-200 text-slate-700 hover:border-[#c8d9ff] hover:bg-[#f6f9ff] hover:text-[#1f5fd1] md:inline-flex">
                            <HugeiconsIcon icon={Add01Icon} className="size-4" />
                            Add exercise
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg">
                          <DialogHeader className="text-left">
                            <DialogTitle>Add Exercise Row</DialogTitle>
                            <DialogDescription>
                              Add structured rows when this block needs exact prescription.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
                            <div className="space-y-2">
                              <Label>Exercise / Drill</Label>
                              <Input
                                value={block.exerciseDraft.name}
                                onChange={(event) =>
                                  updateBlock(editingDay.id, block.id, (current) => ({
                                    ...current,
                                    exerciseDraft: { ...current.exerciseDraft, name: event.target.value },
                                  }))
                                }
                                placeholder="Power Cleans"
                              />
                            </div>
                            <div className="grid gap-3 grid-cols-3">
                              <div className="space-y-2">
                                <Label>Sets</Label>
                                <Input
                                  value={block.exerciseDraft.sets}
                                  onChange={(event) =>
                                    updateBlock(editingDay.id, block.id, (current) => ({
                                      ...current,
                                      exerciseDraft: { ...current.exerciseDraft, sets: event.target.value },
                                    }))
                                  }
                                  placeholder="6"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Reps</Label>
                                <Input
                                  value={block.exerciseDraft.reps}
                                  onChange={(event) =>
                                    updateBlock(editingDay.id, block.id, (current) => ({
                                      ...current,
                                      exerciseDraft: { ...current.exerciseDraft, reps: event.target.value },
                                    }))
                                  }
                                  placeholder="2"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>% / Load / Target</Label>
                                <Input
                                  value={block.exerciseDraft.load}
                                  onChange={(event) =>
                                    updateBlock(editingDay.id, block.id, (current) => ({
                                      ...current,
                                      exerciseDraft: { ...current.exerciseDraft, load: event.target.value },
                                    }))
                                  }
                                  placeholder="60-70%"
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label>Notes / Cue</Label>
                              <Input
                                value={block.exerciseDraft.notes}
                                onChange={(event) =>
                                  updateBlock(editingDay.id, block.id, (current) => ({
                                    ...current,
                                    exerciseDraft: { ...current.exerciseDraft, notes: event.target.value },
                                  }))
                                }
                                placeholder="AMRAP / adjusted / cues"
                              />
                            </div>
                            <DialogClose asChild>
                              <Button
                                type="button"
                                onClick={() =>
                                  updateBlock(editingDay.id, block.id, (current) => {
                                    if (!current.exerciseDraft.name.trim()) return current
                                    return {
                                      ...current,
                                      exerciseRows: [
                                        ...current.exerciseRows,
                                        {
                                          id: makeId("exercise"),
                                          name: current.exerciseDraft.name.trim(),
                                          sets: current.exerciseDraft.sets,
                                          reps: current.exerciseDraft.reps,
                                          load: current.exerciseDraft.load,
                                          notes: current.exerciseDraft.notes,
                                        },
                                      ],
                                      exerciseDraft: {
                                        name: "",
                                        sets: "",
                                        reps: "",
                                        load: "",
                                        notes: "",
                                      },
                                    }
                                  })
                                }
                              >
                                Add row
                              </Button>
                            </DialogClose>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </>
                  </div>

                  <div className="space-y-2">
                    {block.exerciseRows.map((row) => (
                      <div key={row.id} className="rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{row.name}</p>
                            <p className="text-xs text-muted-foreground">
                              Sets {row.sets || "-"} | Reps {row.reps || "-"} | {row.load || "No load"}
                            </p>
                            {row.notes ? <p className="mt-1 text-xs text-muted-foreground">{row.notes}</p> : null}
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="border-slate-200 text-slate-700 hover:border-[#c8d9ff] hover:bg-[#f6f9ff] hover:text-[#1f5fd1]"
                            aria-label="Delete exercise row"
                            onClick={() =>
                              updateBlock(editingDay.id, block.id, (current) => ({
                                ...current,
                                exerciseRows: current.exerciseRows.filter((item) => item.id !== row.id),
                              }))
                            }
                          >
                            <HugeiconsIcon icon={Delete01Icon} className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {block.exerciseRows.length === 0 ? (
                      <EmptyStateCard
                        eyebrow="Block detail"
                        title="No exercise rows are attached to this block."
                        description="That is valid when the block only needs summary guidance, but add rows when you need exact sets, reps, or loads."
                        icon={<HugeiconsIcon icon={Search01Icon} className="size-5" />}
                        className="rounded-[18px] border-dashed bg-slate-50 px-4 py-4 shadow-none"
                        contentClassName="gap-2"
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" onClick={() => setEditingDayId(null)}><HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />Back to Week Builder</Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={copySessionToNextDay}>Duplicate Session</Button>
              <Button type="button" onClick={() => setEditingDayId(null)}>Done</Button>
            </div>
          </div>
            </>
          )}
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.05)]">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Step 3</p>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">Review</h2>
            <p className="text-sm text-slate-500">Confirm the plan scope, structure, and delivery settings before publishing.</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-slate-500">Plan</p>
                  <p className="font-semibold text-slate-950">{basics.planName}</p>
                  <p className="text-sm text-slate-500">
                    {effectiveTeam?.name ?? "Assigned team"} | starts {basics.startDate}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Structure</p>
                  <p className="font-semibold text-slate-950">{basics.durationWeeks} weeks</p>
                  <p className="text-sm text-slate-500">
                    {basics.trainingDaysPerWeek} training days per week | {Math.round(completenessRatio * 100)}% complete
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">{basics.buildMode === "simple" ? "Mode" : "Source"}</p>
                  <p className="font-semibold text-slate-950">
                    {basics.buildMode === "simple" ? "Simple row builder" : source === "template" ? "Template" : source === "copy" ? "Copied plan" : "Blank build"}
                  </p>
                  <p className="text-sm text-slate-500">
                    {basics.buildMode === "simple"
                      ? "Flat exercise rows across the whole program."
                      : source === "copy"
                        ? copySourcePlan?.name ?? "No source selected"
                        : source === "template"
                          ? `${templateGroup} template`
                          : "Built from scratch"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Delivery</p>
                  <p className="font-semibold text-slate-950">{assignedCount} athletes</p>
                  <p className="text-sm text-slate-500">
                    {assignTarget === "team" ? "Whole team" : assignTarget === "subgroup" ? `${assignSubgroup} subgroup` : "Selected athletes"}
                    {visibilityStart === "scheduled" ? ` | visible ${visibilityDate}` : " | visible immediately"}
                  </p>
                </div>
              </div>

              <div className="rounded-[20px] border border-slate-200 bg-white p-4">
                <p className="text-sm font-medium text-slate-500">Week {activeWeek} snapshot</p>
                <div className="mt-3 space-y-3">
                  {activeWeekDays.map((day) => (
                    <div key={day.id} className="rounded-[18px] border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-slate-950">
                            {day.label} | {formatShortDate(day.dateIso)}
                          </p>
                          <p className="text-sm text-slate-500">{day.title || "No session title"}</p>
                          <p className="text-xs text-slate-400">
                            {basics.buildMode === "simple"
                              ? `${day.exerciseRows.length} exercises`
                              : `${day.blocks.length} blocks`}
                          </p>
                        </div>
                        <Badge variant={dayStatus(day) === "Ready" ? "default" : "secondary"}>{dayStatus(day)}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <aside className="space-y-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div>
                <p className="text-sm font-medium text-slate-500">Publish check</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{Math.round(completenessRatio * 100)}%</p>
                <p className="text-sm text-slate-500">At least 60% of training days need usable session structure.</p>
              </div>

              <div className="rounded-[18px] border border-slate-200 bg-white p-3 text-sm text-slate-500">
                {basics.notes?.trim() ? basics.notes : "No setup notes added."}
              </div>

              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" className="h-11 rounded-full border-slate-200 px-5 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950" onClick={() => setStep(2)}>
                  <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
                  Back to Build
                </Button>
                <Button type="button" className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95" onClick={publishPlan} disabled={!canPublish || isPublishing}>
                  {isPublishing ? "Publishing..." : "Publish"}
                </Button>
              </div>
            </aside>
          </div>

          {publishError ? (
            <div className="rounded-[22px] border border-rose-200 bg-rose-50 p-4">
              <p className="font-semibold text-rose-700">Publish failed</p>
              <p className="mt-1 text-sm text-rose-700">{publishError}</p>
            </div>
          ) : null}

          {publishedCount !== null ? (
            <div className="space-y-3 rounded-[22px] border border-[#c9dcff] bg-[#eef5ff] p-4">
              <p className="font-semibold text-slate-950">Plan published to {publishedCount} athletes</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="h-11 rounded-full border-slate-200 px-5 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950">Share athlete access link</Button>
                <Button type="button" variant="outline" className="h-11 rounded-full border-slate-200 px-5 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950" onClick={() => setStep(2)}>Return to Build</Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <AlertDialog open={showRegenerateConfirm} onOpenChange={setShowRegenerateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate plan structure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the current week layout with a fresh {source === "copy" ? "copy of the selected plan" : source} build.
              Existing week edits will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current build</AlertDialogCancel>
            <AlertDialogAction onClick={regeneratePlanStructure}>Regenerate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingTrainingDaysPerWeek !== null} onOpenChange={(open) => {
        if (!open) setPendingTrainingDaysPerWeek(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply new training day count?</AlertDialogTitle>
            <AlertDialogDescription>
              Changing the weekly training day count will rebuild the current plan structure from the selected source.
              Existing week edits will be replaced with a {pendingTrainingDaysPerWeek ?? basics.trainingDaysPerWeek}-day layout.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current build</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingTrainingDaysPerWeek !== null) {
                  applyTrainingDaysPerWeek(pendingTrainingDaysPerWeek)
                }
              }}
            >
              Rebuild plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
