import { getCookieValue, ROLE_COOKIE } from "@/lib/auth-session"
import { mockAthleteUserId, MOCK_SELF_ATHLETE_USER_ID } from "@/lib/data/competition/staff-roster"
import type {
  Announcement,
  AnnouncementAudience,
  AnnouncementInput,
  AnnouncementRecipient,
  MessageUnreadCounts,
  OversightThread,
  ThreadMessage,
  ThreadSummary,
  ThreadWithMessages,
} from "@/lib/data/messages/types"
import { MESSAGE_MAX_LENGTH } from "@/lib/data/messages/types"
import { err, ok, type Result } from "@/lib/data/result"
import { mockAthletes, mockTeams } from "@/lib/mock-data"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Mock mode only: messages and announcements kept in this browser, shared by the demo coach, the
 * demo athlete (Marcus Johnson) and the demo club admin, so what one posts the others see after
 * switching role. It follows the same rules as the database functions in
 * supabase/migrations/20261009110000_messaging_and_competition_staff.sql. Supabase mode never
 * loads this file.
 */

export const MOCK_COACH_USER_ID = "mock-coach-user"
export const MOCK_COACH_DISPLAY_NAME = "Andre Campbell"
export const MOCK_CLUB_ADMIN_USER_ID = "mock-club-admin-user"
const MOCK_CLUB_ADMIN_NAME = "Dana Whyte"
const MOCK_SELF_ATHLETE_ID = "a1"
const MOCK_MINOR_ATHLETE_ID = "a2"
const STORAGE_KEY = "pacelab:messages-v1"

type StoredThread = {
  id: string
  teamId: string
  coachUserId: string
  athleteId: string
  coachLastReadAt: string | null
  athleteLastReadAt: string | null
}

type StoredMessage = {
  id: string
  threadId: string
  senderUserId: string
  senderRole: "coach" | "athlete"
  body: string | null
  originalBody: string | null
  hiddenAt: string | null
  hiddenReason: string | null
  createdAt: string
}

type StoredReport = {
  id: string
  messageId: string
  threadId: string
  reporterUserId: string
  reason: string | null
  createdAt: string
  resolution: "hidden" | "dismissed" | null
}

type StoredAnnouncement = {
  id: string
  audience: AnnouncementAudience
  teamId: string | null
  senderUserId: string
  senderName: string
  senderRole: "coach" | "club-admin"
  body: string
  createdAt: string
  recipients: Array<{ userId: string; readAt: string | null }>
}

type MockMessagesState = {
  threads: StoredThread[]
  messages: StoredMessage[]
  reports: StoredReport[]
  announcements: StoredAnnouncement[]
}

type Viewer = { role: "coach" | "athlete" | "club-admin"; userId: string; name: string; athleteId: string | null }

function viewer(): Viewer {
  const role = getCookieValue(ROLE_COOKIE)
  if (role === "athlete") return { role: "athlete", userId: MOCK_SELF_ATHLETE_USER_ID, name: athleteName(MOCK_SELF_ATHLETE_ID), athleteId: MOCK_SELF_ATHLETE_ID }
  if (role === "club-admin") return { role: "club-admin", userId: MOCK_CLUB_ADMIN_USER_ID, name: MOCK_CLUB_ADMIN_NAME, athleteId: null }
  return { role: "coach", userId: MOCK_COACH_USER_ID, name: MOCK_COACH_DISPLAY_NAME, athleteId: null }
}

function athleteName(athleteId: string) {
  return mockAthletes.find((athlete) => athlete.id === athleteId)?.name ?? "An athlete"
}

function teamName(teamId: string | null) {
  return mockTeams.find((team) => team.id === teamId)?.name ?? null
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function newId(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
  return `${prefix}-${random}`
}

function seed(): MockMessagesState {
  const message = (id: string, threadId: string, senderRole: "coach" | "athlete", senderUserId: string, body: string, minutes: number): StoredMessage => ({
    id,
    threadId,
    senderRole,
    senderUserId,
    body,
    originalBody: null,
    hiddenAt: null,
    hiddenReason: null,
    createdAt: minutesAgo(minutes),
  })
  const DAY = 24 * 60
  const sarah = mockAthleteUserId("a2") as string
  const david = mockAthleteUserId("a3") as string
  const mia = mockAthleteUserId("a8") as string
  const liam = mockAthleteUserId("a9") as string
  return {
    threads: [
      { id: "mock-thread-marcus", teamId: "t1", coachUserId: MOCK_COACH_USER_ID, athleteId: "a1", coachLastReadAt: minutesAgo(170), athleteLastReadAt: minutesAgo(DAY + 60) },
      { id: "mock-thread-sarah", teamId: "t1", coachUserId: MOCK_COACH_USER_ID, athleteId: "a2", coachLastReadAt: minutesAgo(2 * DAY), athleteLastReadAt: minutesAgo(50) },
      { id: "mock-thread-mia", teamId: "t4", coachUserId: MOCK_COACH_USER_ID, athleteId: "a8", coachLastReadAt: minutesAgo(5 * 60), athleteLastReadAt: minutesAgo(6 * 60) },
    ],
    messages: [
      message("mock-msg-1", "mock-thread-marcus", "coach", MOCK_COACH_USER_ID, "How did the knee feel after yesterday's session?", DAY + 150),
      message("mock-msg-2", "mock-thread-marcus", "athlete", MOCK_SELF_ATHLETE_USER_ID, "Better. A little stiff on the bends but no pain.", DAY + 120),
      message("mock-msg-3", "mock-thread-marcus", "coach", MOCK_COACH_USER_ID, "Good. Keep today easy and tell me how the warm-up goes.", 180),
      message("mock-msg-4", "mock-thread-sarah", "coach", MOCK_COACH_USER_ID, "Nice work on the 150s on Tuesday.", 2 * DAY + 30),
      message("mock-msg-5", "mock-thread-sarah", "athlete", sarah, "Can I move my Thursday session to the morning? I have an exam at 4.", 50),
      message("mock-msg-6", "mock-thread-mia", "coach", MOCK_COACH_USER_ID, "Bring your own shot on Saturday, the club ones are being checked.", 7 * 60),
      message("mock-msg-7", "mock-thread-mia", "athlete", mia, "Will do, thanks.", 5 * 60 + 30),
    ],
    reports: [],
    announcements: [
      {
        id: "mock-announcement-club",
        audience: "club",
        teamId: null,
        senderUserId: MOCK_CLUB_ADMIN_USER_ID,
        senderName: MOCK_CLUB_ADMIN_NAME,
        senderRole: "club-admin",
        body: "Club championships entries close on Friday. Tell your coach which events you want.",
        createdAt: minutesAgo(DAY + 3 * 60),
        recipients: [
          { userId: MOCK_COACH_USER_ID, readAt: null },
          { userId: MOCK_SELF_ATHLETE_USER_ID, readAt: minutesAgo(DAY) },
          { userId: sarah, readAt: minutesAgo(DAY + 60) },
          { userId: david, readAt: null },
          { userId: mia, readAt: minutesAgo(20 * 60) },
          { userId: liam, readAt: null },
        ],
      },
      {
        id: "mock-announcement-sprint",
        audience: "team",
        teamId: "t1",
        senderUserId: MOCK_COACH_USER_ID,
        senderName: MOCK_COACH_DISPLAY_NAME,
        senderRole: "coach",
        body: "Training moved to 5pm on Thursday. Same track, bring spikes.",
        createdAt: minutesAgo(2 * 60),
        recipients: [
          { userId: MOCK_SELF_ATHLETE_USER_ID, readAt: null },
          { userId: sarah, readAt: minutesAgo(70) },
          { userId: david, readAt: null },
        ],
      },
      {
        id: "mock-announcement-throws",
        audience: "team",
        teamId: "t4",
        senderUserId: MOCK_COACH_USER_ID,
        senderName: MOCK_COACH_DISPLAY_NAME,
        senderRole: "coach",
        body: "Throws cage is closed on Monday. We meet in the gym at 4:30 instead.",
        createdAt: minutesAgo(4 * 60),
        recipients: [
          { userId: mia, readAt: minutesAgo(3 * 60) },
          { userId: liam, readAt: null },
        ],
      },
    ],
  }
}

let memory: MockMessagesState | null = null

function load(): MockMessagesState {
  if (typeof window === "undefined") return memory ?? (memory = seed())
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(STORAGE_KEY))
    if (raw) {
      const parsed = JSON.parse(raw) as MockMessagesState
      if (parsed && Array.isArray(parsed.threads) && Array.isArray(parsed.messages) && Array.isArray(parsed.announcements)) {
        return { ...parsed, reports: parsed.reports ?? [] }
      }
    }
  } catch {
    /* fall through to a fresh demo */
  }
  const seeded = seed()
  save(seeded)
  return seeded
}

function save(state: MockMessagesState) {
  memory = state
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(tenantStorageKey(STORAGE_KEY), JSON.stringify(state))
  } catch {
    /* storage full or blocked: the demo still works for this page view */
  }
}

function update(change: (state: MockMessagesState) => MockMessagesState): MockMessagesState {
  const next = change(load())
  save(next)
  return next
}

function cleanBody(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("")
    .filter((character) => character === "\n" || character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function isOpen(thread: StoredThread) {
  const athlete = mockAthletes.find((item) => item.id === thread.athleteId)
  return Boolean(athlete) && athlete?.teamId === thread.teamId && mockAthleteUserId(thread.athleteId) !== null
}

function canRead(thread: StoredThread, me: Viewer) {
  if (me.role === "club-admin") return true
  if (me.role === "athlete") return thread.athleteId === me.athleteId
  return thread.coachUserId === me.userId
}

function myLastRead(thread: StoredThread, me: Viewer) {
  return me.role === "athlete" ? thread.athleteLastReadAt : thread.coachLastReadAt
}

function unreadIn(state: MockMessagesState, thread: StoredThread, me: Viewer) {
  const since = myLastRead(thread, me) ?? ""
  return state.messages.filter((item) => item.threadId === thread.id && item.senderUserId !== me.userId && !item.hiddenAt && item.createdAt > since).length
}

function lastMessageOf(state: MockMessagesState, threadId: string) {
  return state.messages.filter((item) => item.threadId === threadId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1) ?? null
}

/* ---------- Reads ---------------------------------------------------------------------------------- */

export function mockUnreadCounts(): MessageUnreadCounts {
  const state = load()
  const me = viewer()
  const direct =
    me.role === "club-admin" ? 0 : state.threads.filter((thread) => canRead(thread, me)).reduce((sum, thread) => sum + unreadIn(state, thread, me), 0)
  const announcements = state.announcements.filter((item) => item.recipients.some((recipient) => recipient.userId === me.userId && !recipient.readAt)).length
  const openReports = me.role === "club-admin" ? new Set(state.reports.filter((report) => !report.resolution).map((report) => report.messageId)).size : 0
  return { direct, announcements, openReports }
}

export function mockThreads(teamId: string | null | undefined): ThreadSummary[] {
  const state = load()
  const me = viewer()
  if (me.role === "club-admin") return []
  return state.threads
    .filter((thread) => canRead(thread, me) && (!teamId || thread.teamId === teamId))
    .flatMap((thread) => {
      const last = lastMessageOf(state, thread.id)
      if (!last) return []
      return [
        {
          id: thread.id,
          teamId: thread.teamId,
          teamName: teamName(thread.teamId),
          athleteId: thread.athleteId,
          athleteName: athleteName(thread.athleteId),
          athleteUserId: mockAthleteUserId(thread.athleteId),
          coachUserId: thread.coachUserId,
          coachName: MOCK_COACH_DISPLAY_NAME,
          lastMessageAt: last.createdAt,
          lastMessagePreview: last.body ? last.body.slice(0, 140) : null,
          lastMessageHidden: Boolean(last.hiddenAt),
          lastMessageFromMe: last.senderUserId === me.userId,
          unreadCount: unreadIn(state, thread, me),
          canSend: isOpen(thread),
        },
      ]
    })
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
}

export function mockOversightThreads(): OversightThread[] {
  const state = load()
  if (viewer().role !== "club-admin") return []
  return state.threads
    .flatMap((thread) => {
      const messages = state.messages.filter((item) => item.threadId === thread.id)
      const last = lastMessageOf(state, thread.id)
      if (!last) return []
      return [
        {
          id: thread.id,
          teamId: thread.teamId,
          teamName: teamName(thread.teamId),
          athleteId: thread.athleteId,
          athleteName: athleteName(thread.athleteId),
          athleteUserId: mockAthleteUserId(thread.athleteId),
          coachUserId: thread.coachUserId,
          coachName: MOCK_COACH_DISPLAY_NAME,
          lastMessageAt: last.createdAt,
          messageCount: messages.length,
          openReportCount: new Set(state.reports.filter((report) => report.threadId === thread.id && !report.resolution).map((report) => report.messageId)).size,
          hiddenCount: messages.filter((item) => item.hiddenAt).length,
          isOpen: isOpen(thread),
        },
      ]
    })
    .sort((a, b) => Number(b.openReportCount > 0) - Number(a.openReportCount > 0) || b.lastMessageAt.localeCompare(a.lastMessageAt))
}

export function mockThread(threadId: string): ThreadWithMessages | null {
  const state = load()
  const me = viewer()
  const thread = state.threads.find((item) => item.id === threadId)
  if (!thread || !canRead(thread, me)) return null
  const open = isOpen(thread)
  const side = me.role === "club-admin" ? "oversight" : me.role
  const athlete = mockAthletes.find((item) => item.id === thread.athleteId)
  const messages: ThreadMessage[] = state.messages
    .filter((item) => item.threadId === thread.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((item) => {
      const reports = state.reports.filter((report) => report.messageId === item.id)
      return {
        id: item.id,
        threadId: item.threadId,
        senderUserId: item.senderUserId,
        senderRole: item.senderRole,
        body: item.body,
        hiddenAt: item.hiddenAt,
        createdAt: item.createdAt,
        reportedByMe: reports.some((report) => report.reporterUserId === me.userId),
        reports: side === "oversight" ? reports.map((report) => ({ id: report.id, reason: report.reason, createdAt: report.createdAt, resolution: report.resolution })) : [],
        originalBody: side === "oversight" ? item.originalBody : null,
        hiddenReason: side === "oversight" ? item.hiddenReason : null,
      }
    })
  return {
    viewerUserId: side === "oversight" ? null : me.userId,
    messages,
    thread: {
      id: thread.id,
      teamId: thread.teamId,
      teamName: teamName(thread.teamId),
      athleteId: thread.athleteId,
      athleteName: athleteName(thread.athleteId),
      athleteUserId: mockAthleteUserId(thread.athleteId),
      coachUserId: thread.coachUserId,
      coachName: MOCK_COACH_DISPLAY_NAME,
      viewerSide: side,
      canSend: open && side !== "oversight",
      readOnlyReason: open ? null : mockAthleteUserId(thread.athleteId) === null ? "no_login" : "athlete_left_team",
      otherLastReadAt: side === "coach" ? thread.athleteLastReadAt : side === "athlete" ? thread.coachLastReadAt : null,
      // The demo has one athlete under 18 with a guardian on file, so the line can be seen.
      guardianContactOnFile: side !== "athlete" && athlete?.id === MOCK_MINOR_ATHLETE_ID,
      guardianCcEnabled: false,
    },
  }
}

/* ---------- Writes --------------------------------------------------------------------------------- */

export function mockOpenThread(target: { athleteId?: string | null; coachUserId?: string | null }): Result<string> {
  const me = viewer()
  if (me.role === "club-admin") return err("FORBIDDEN", "You can only message athletes on a team you coach.")
  const athleteId = me.role === "athlete" ? me.athleteId : (target.athleteId ?? null)
  const athlete = mockAthletes.find((item) => item.id === athleteId)
  if (!athlete) return err("FORBIDDEN", me.role === "athlete" ? "You can only message the coaches of your own team." : "You can only message athletes on a team you coach.")
  if (me.role === "athlete" && target.coachUserId !== MOCK_COACH_USER_ID) return err("FORBIDDEN", "You can only message the coaches of your own team.")
  if (mockAthleteUserId(athlete.id) === null) return err("FORBIDDEN", "This athlete has no login yet, so they cannot be messaged.")
  const existing = load().threads.find((thread) => thread.athleteId === athlete.id && thread.coachUserId === MOCK_COACH_USER_ID)
  if (existing) {
    if (existing.teamId !== athlete.teamId) update((state) => ({ ...state, threads: state.threads.map((thread) => (thread.id === existing.id ? { ...thread, teamId: athlete.teamId } : thread)) }))
    return ok(existing.id)
  }
  const thread: StoredThread = { id: newId("thread"), teamId: athlete.teamId, coachUserId: MOCK_COACH_USER_ID, athleteId: athlete.id, coachLastReadAt: null, athleteLastReadAt: null }
  update((state) => ({ ...state, threads: [...state.threads, thread] }))
  return ok(thread.id)
}

export function mockSendMessage(threadId: string, text: string): Result<string> {
  const me = viewer()
  const state = load()
  const thread = state.threads.find((item) => item.id === threadId)
  const isParticipant = thread && ((me.role === "coach" && thread.coachUserId === me.userId) || (me.role === "athlete" && thread.athleteId === me.athleteId))
  if (!thread || !isParticipant) return err("FORBIDDEN", "You are not part of this conversation.")
  if (!isOpen(thread)) return err("FORBIDDEN", "This conversation is read only. Nothing more can be sent in it.")
  const body = cleanBody(text)
  if (!body) return err("VALIDATION", "Write a message first.")
  if (body.length > MESSAGE_MAX_LENGTH) return err("VALIDATION", `Keep the message to ${MESSAGE_MAX_LENGTH} characters.`)
  const hourAgo = minutesAgo(60)
  if (state.messages.filter((item) => item.senderUserId === me.userId && item.createdAt > hourAgo).length >= 30) {
    return err("VALIDATION", "You have sent a lot of messages in the last hour. Wait a little, then try again.")
  }
  const now = new Date().toISOString()
  const message: StoredMessage = { id: newId("msg"), threadId, senderUserId: me.userId, senderRole: me.role as "coach" | "athlete", body, originalBody: null, hiddenAt: null, hiddenReason: null, createdAt: now }
  update((current) => ({
    ...current,
    messages: [...current.messages, message],
    threads: current.threads.map((item) =>
      item.id === threadId ? { ...item, coachLastReadAt: me.role === "coach" ? now : item.coachLastReadAt, athleteLastReadAt: me.role === "athlete" ? now : item.athleteLastReadAt } : item,
    ),
  }))
  return ok(message.id)
}

export function mockMarkThreadRead(threadId: string): void {
  const me = viewer()
  if (me.role === "club-admin") return
  const now = new Date().toISOString()
  update((state) => ({
    ...state,
    threads: state.threads.map((thread) => {
      if (thread.id !== threadId || !canRead(thread, me)) return thread
      return me.role === "coach" ? { ...thread, coachLastReadAt: now } : { ...thread, athleteLastReadAt: now }
    }),
  }))
}

export function mockReportMessage(messageId: string, reason: string | null): Result<string> {
  const me = viewer()
  const state = load()
  const message = state.messages.find((item) => item.id === messageId)
  const thread = message ? state.threads.find((item) => item.id === message.threadId) : null
  if (!message || !thread || me.role === "club-admin" || !canRead(thread, me)) return err("FORBIDDEN", "You can only report a message in one of your own conversations.")
  if (message.senderUserId === me.userId) return err("VALIDATION", "You cannot report your own message.")
  const existing = state.reports.find((report) => report.messageId === messageId && report.reporterUserId === me.userId)
  if (existing) return ok(existing.id)
  const report: StoredReport = { id: newId("report"), messageId, threadId: thread.id, reporterUserId: me.userId, reason: reason?.trim().slice(0, 300) || null, createdAt: new Date().toISOString(), resolution: null }
  update((current) => ({ ...current, reports: [...current.reports, report] }))
  return ok(report.id)
}

export function mockHideMessage(messageId: string, reason: string | null): Result<null> {
  if (viewer().role !== "club-admin") return err("FORBIDDEN", "Only a club admin can hide a message.")
  const now = new Date().toISOString()
  update((state) => ({
    ...state,
    messages: state.messages.map((item) =>
      item.id === messageId && !item.hiddenAt ? { ...item, originalBody: item.body, body: null, hiddenAt: now, hiddenReason: reason?.trim().slice(0, 300) || null } : item,
    ),
    reports: state.reports.map((report) => (report.messageId === messageId && !report.resolution ? { ...report, resolution: "hidden" as const } : report)),
  }))
  return ok(null)
}

export function mockDismissReports(messageId: string): Result<null> {
  if (viewer().role !== "club-admin") return err("FORBIDDEN", "Only a club admin can review a report.")
  update((state) => ({
    ...state,
    reports: state.reports.map((report) => (report.messageId === messageId && !report.resolution ? { ...report, resolution: "dismissed" as const } : report)),
  }))
  return ok(null)
}

/* ---------- Announcements ---------------------------------------------------------------------------- */

function canManage(announcement: StoredAnnouncement, me: Viewer) {
  if (me.role === "club-admin") return true
  if (me.role === "coach") return announcement.senderUserId === me.userId || announcement.audience === "team"
  return false
}

function toAnnouncement(item: StoredAnnouncement, me: Viewer): Announcement {
  const mine = item.recipients.find((recipient) => recipient.userId === me.userId)
  const manage = canManage(item, me)
  return {
    id: item.id,
    audience: item.audience,
    teamId: item.teamId,
    teamName: teamName(item.teamId),
    senderUserId: item.senderUserId,
    senderName: item.senderName,
    senderRole: item.senderRole,
    body: item.body,
    createdAt: item.createdAt,
    isMine: item.senderUserId === me.userId,
    isRecipient: Boolean(mine),
    readAt: mine?.readAt ?? null,
    canManage: manage,
    recipientCount: manage ? item.recipients.length : null,
    readCount: manage ? item.recipients.filter((recipient) => recipient.readAt).length : null,
  }
}

export function mockAnnouncements(teamId: string | null | undefined): Announcement[] {
  const me = viewer()
  return load()
    .announcements.map((item) => toAnnouncement(item, me))
    .filter((item) => (item.isRecipient || item.canManage) && (!teamId || item.audience !== "team" || item.teamId === teamId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function mockAnnouncementRecipients(announcementId: string): AnnouncementRecipient[] {
  const me = viewer()
  const item = load().announcements.find((announcement) => announcement.id === announcementId)
  if (!item || !canManage(item, me)) return []
  return item.recipients
    .map((recipient): AnnouncementRecipient => {
      const athlete = mockAthletes.find((candidate) => mockAthleteUserId(candidate.id) === recipient.userId)
      if (athlete) return { userId: recipient.userId, name: athlete.name, role: "athlete", athleteId: athlete.id, readAt: recipient.readAt }
      if (recipient.userId === MOCK_COACH_USER_ID) return { userId: recipient.userId, name: MOCK_COACH_DISPLAY_NAME, role: "coach", athleteId: null, readAt: recipient.readAt }
      return { userId: recipient.userId, name: MOCK_CLUB_ADMIN_NAME, role: "club-admin", athleteId: null, readAt: recipient.readAt }
    })
    .sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)) || a.name.localeCompare(b.name))
}

export function mockPostAnnouncement(input: AnnouncementInput): Result<string> {
  const me = viewer()
  if (me.role === "athlete") return err("FORBIDDEN", "Only a coach or a club admin can post an announcement.")
  if (input.audience !== "team" && me.role !== "club-admin") return err("FORBIDDEN", "Only a club admin can post to the whole club or to all coaches.")
  if (input.audience === "team" && !mockTeams.some((team) => team.id === input.teamId)) return err("FORBIDDEN", "You can only post to a team you coach.")
  const body = cleanBody(input.body)
  if (!body) return err("VALIDATION", "Write the announcement first.")
  if (body.length > MESSAGE_MAX_LENGTH) return err("VALIDATION", `Keep the announcement to ${MESSAGE_MAX_LENGTH} characters.`)

  const athleteUsers = mockAthletes
    .filter((athlete) => input.audience === "club" || (input.audience === "team" && athlete.teamId === input.teamId))
    .map((athlete) => mockAthleteUserId(athlete.id))
    .filter((id): id is string => Boolean(id))
  const staff = input.audience === "club" ? [MOCK_COACH_USER_ID, MOCK_CLUB_ADMIN_USER_ID] : [MOCK_COACH_USER_ID]
  const recipients = [...new Set([...(input.audience === "coaches" ? [] : athleteUsers), ...staff])].filter((id) => id !== me.userId)

  const announcement: StoredAnnouncement = {
    id: newId("announcement"),
    audience: input.audience,
    teamId: input.audience === "team" ? (input.teamId ?? null) : null,
    senderUserId: me.userId,
    senderName: me.name,
    senderRole: me.role as "coach" | "club-admin",
    body,
    createdAt: new Date().toISOString(),
    recipients: recipients.map((userId) => ({ userId, readAt: null })),
  }
  update((state) => ({ ...state, announcements: [...state.announcements, announcement] }))
  return ok(announcement.id)
}

export function mockMarkAnnouncementRead(announcementId: string): void {
  const me = viewer()
  const now = new Date().toISOString()
  update((state) => ({
    ...state,
    announcements: state.announcements.map((item) =>
      item.id === announcementId ? { ...item, recipients: item.recipients.map((recipient) => (recipient.userId === me.userId && !recipient.readAt ? { ...recipient, readAt: now } : recipient)) } : item,
    ),
  }))
}
