/** The longest message or announcement. The database enforces the same number (messaging_settings.max_length). */
export const MESSAGE_MAX_LENGTH = 1000

/** Said to both people at the top of every thread, and to club admins in oversight. */
export const SAFEGUARDING_LINE = "Club admins can read messages between coaches and athletes."
/** What both people see in place of a message a club admin has hidden. */
export const HIDDEN_MESSAGE_STUB = "Message hidden by a club admin"

export type MessagesRole = "athlete" | "coach" | "club-admin"

/** One conversation between a coach and an athlete, as a row in a list. */
export type ThreadSummary = {
  id: string
  teamId: string | null
  teamName: string | null
  athleteId: string
  athleteName: string
  athleteUserId: string | null
  coachUserId: string | null
  coachName: string
  lastMessageAt: string
  /** Null when the last message was hidden. */
  lastMessagePreview: string | null
  lastMessageHidden: boolean
  lastMessageFromMe: boolean
  unreadCount: number
  canSend: boolean
}

export type ThreadReadOnlyReason = "athlete_left_team" | "coach_not_on_team" | "no_login" | "inactive"

export type ThreadDetail = {
  id: string
  teamId: string | null
  teamName: string | null
  athleteId: string
  athleteName: string
  athleteUserId: string | null
  coachUserId: string | null
  coachName: string
  /** Who is looking: one of the two people, or a club admin reading in oversight. */
  viewerSide: "coach" | "athlete" | "oversight"
  canSend: boolean
  readOnlyReason: ThreadReadOnlyReason | null
  /** When the other person last read the thread. Drives "Seen". */
  otherLastReadAt: string | null
  /** Coach and club admin only: the athlete is under 18 and a guardian email is on file. */
  guardianContactOnFile: boolean
  /** Coach and club admin only: the club's setting for copying guardians in (off in this version). */
  guardianCcEnabled: boolean
}

export type MessageReport = {
  id: string
  reason: string | null
  createdAt: string
  /** Null while a club admin has not looked at it. */
  resolution: "hidden" | "dismissed" | null
}

export type ThreadMessage = {
  id: string
  threadId: string
  senderUserId: string | null
  senderRole: "coach" | "athlete"
  /** Null once hidden. */
  body: string | null
  hiddenAt: string | null
  createdAt: string
  /** The viewer reported this message. */
  reportedByMe: boolean
  /** Club admins only: every report about this message. */
  reports: MessageReport[]
  /** Club admins only: what a hidden message said, and why it was hidden. */
  originalBody: string | null
  hiddenReason: string | null
}

export type ThreadWithMessages = {
  thread: ThreadDetail
  messages: ThreadMessage[]
  /** The viewer's own user id, to tell "mine" from "theirs". Null for a club admin in oversight. */
  viewerUserId: string | null
}

/** A conversation in the club admin's oversight list. */
export type OversightThread = {
  id: string
  teamId: string | null
  teamName: string | null
  athleteId: string
  athleteName: string
  athleteUserId: string | null
  coachUserId: string | null
  coachName: string
  lastMessageAt: string
  messageCount: number
  openReportCount: number
  hiddenCount: number
  isOpen: boolean
}

export type AnnouncementAudience = "team" | "club" | "coaches"

export type Announcement = {
  id: string
  audience: AnnouncementAudience
  teamId: string | null
  teamName: string | null
  senderUserId: string | null
  senderName: string
  senderRole: "coach" | "club-admin"
  body: string
  createdAt: string
  /** The viewer posted it. */
  isMine: boolean
  /** It was sent to the viewer. */
  isRecipient: boolean
  /** When the viewer read it. Null when unread (or when they are not a recipient). */
  readAt: string | null
  /** The viewer may see who has read it: the sender, the team's coaches, club admins. */
  canManage: boolean
  recipientCount: number | null
  readCount: number | null
}

export type AnnouncementRecipient = {
  userId: string
  name: string
  role: "athlete" | "coach" | "club-admin" | null
  athleteId: string | null
  readAt: string | null
}

export type AnnouncementInput = {
  audience: AnnouncementAudience
  /** Required for "team". */
  teamId?: string | null
  body: string
}

export type MessageUnreadCounts = {
  /** Messages from the other person not read yet. */
  direct: number
  /** Announcements received and not read. */
  announcements: number
  /** Club admins: reported messages waiting for a look. 0 for everyone else. */
  openReports: number
}

/** A coach an athlete can message: one of the coaches of their team. */
export type MessageableCoach = {
  userId: string
  name: string
  isLead: boolean
}

/** "Sprint Group", "Whole club", "All coaches". */
export function audienceLabel(announcement: Pick<Announcement, "audience" | "teamName">): string {
  if (announcement.audience === "club") return "Whole club"
  if (announcement.audience === "coaches") return "All coaches"
  return announcement.teamName ?? "Team"
}

/** The same, as it reads inside a sentence: "to the whole club", "to all coaches", "to Sprint Group". */
export function audiencePhrase(announcement: Pick<Announcement, "audience" | "teamName">): string {
  if (announcement.audience === "club") return "the whole club"
  if (announcement.audience === "coaches") return "all coaches"
  return announcement.teamName ?? "the team"
}

export function readOnlyText(reason: ThreadReadOnlyReason | null, viewerSide: ThreadDetail["viewerSide"]): string {
  if (viewerSide === "oversight") return "You are reading this as a club admin. Club admins read conversations and never write in them."
  if (reason === "athlete_left_team") {
    return viewerSide === "athlete" ? "You are no longer on this coach's team, so this conversation is read only." : "This athlete is no longer on your team, so this conversation is read only."
  }
  if (reason === "coach_not_on_team") return "This coach no longer coaches your team, so this conversation is read only."
  if (reason === "no_login") return "This athlete has no login, so they cannot be messaged."
  return "This conversation is read only."
}
