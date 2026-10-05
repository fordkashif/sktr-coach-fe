import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"
import { isAccessPausedError } from "@/lib/access-paused"
import type {
  Announcement,
  AnnouncementAudience,
  AnnouncementInput,
  AnnouncementRecipient,
  MessageableCoach,
  MessageReport,
  MessageUnreadCounts,
  OversightThread,
  ThreadDetail,
  ThreadMessage,
  ThreadReadOnlyReason,
  ThreadSummary,
  ThreadWithMessages,
} from "@/lib/data/messages/types"
import { MESSAGE_MAX_LENGTH } from "@/lib/data/messages/types"
import { kickNotificationEmails } from "@/lib/data/notifications-data"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * Messaging: announcements (a coach to a team, a club admin to the club) and direct messages
 * between one coach and one athlete.
 *
 * Every write is a database function (supabase/migrations/20261009110000_messaging_and_competition_staff.sql)
 * that checks who is asking: a coach only reaches athletes on teams they are assigned to, an athlete
 * only the coaches of their own team, club admins read every conversation and write in none.
 * Messages cannot be edited or deleted. Reads of the messages themselves go straight to the table,
 * where the row policies apply the same rules (and so does Realtime).
 *
 * Mock mode keeps the same shapes in the browser (mock-messages-store.ts, loaded on demand).
 */

export const MESSAGES_CHANGED_EVENT = "pacelab:messages-changed"

function isMock() {
  return getBackendMode() !== "supabase"
}

const mockStore = () => import("@/lib/data/messages/mock-messages-store")

type ClientResolution = { ok: true; client: SupabaseClient } | { ok: false; error: DataError }

function requireClient(operation: string): ClientResolution {
  const client = getBrowserSupabaseClient()
  if (!client) return { ok: false, error: { code: "UNKNOWN", message: `[${operation}] Supabase client is not configured.` } }
  return { ok: true, client }
}

/** The unread badge listens for this. Fired after anything that changes what is unread. */
function announceChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(MESSAGES_CHANGED_EVENT))
}

/**
 * The messaging functions refuse with a sentence written for the person ("You can only message
 * athletes on a team you coach."). Those are passed on as they are; anything else goes through the
 * usual mapping.
 */
function mapMessagingError(error: PostgrestError): DataError {
  if (isAccessPausedError(error)) return mapPostgrestError(error)
  const technical = /row-level security|permission denied|violates|does not exist$/i.test(error.message)
  if (error.code === "54000") return { code: "VALIDATION", message: error.message, cause: error }
  if ((error.code === "23514" || error.code === "22023") && !technical) return { code: "VALIDATION", message: error.message, cause: error }
  if (error.code === "42501" && !technical) return { code: "FORBIDDEN", message: error.message, cause: error }
  return mapPostgrestError(error)
}

function validateBody(text: string, what: "message" | "announcement"): string | null {
  const body = text.trim()
  if (!body) return what === "message" ? "Write a message first." : "Write the announcement first."
  if (body.length > MESSAGE_MAX_LENGTH) return `Keep the ${what} to ${MESSAGE_MAX_LENGTH} characters.`
  return null
}

/* ---------- Unread counts ---------------------------------------------------------------------------- */

export async function getMessageUnreadCounts(): Promise<Result<MessageUnreadCounts>> {
  if (isMock()) return ok((await mockStore()).mockUnreadCounts())
  const clientResult = requireClient("getMessageUnreadCounts")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("get_message_unread_counts")
  if (error) return { ok: false, error: mapMessagingError(error) }
  const row = ((data as Array<{ direct_unread: number; announcements_unread: number; open_reports: number }> | null) ?? [])[0]
  return ok({ direct: row?.direct_unread ?? 0, announcements: row?.announcements_unread ?? 0, openReports: row?.open_reports ?? 0 })
}

/* ---------- Direct messages --------------------------------------------------------------------------- */

type ThreadListRow = {
  thread_id: string
  team_id: string | null
  team_name: string | null
  athlete_id: string
  athlete_name: string | null
  athlete_user_id: string | null
  coach_user_id: string | null
  coach_name: string | null
  last_message_at: string
  last_message_preview: string | null
  last_message_hidden: boolean | null
  last_message_from_me: boolean | null
  unread_count: number | null
  can_send: boolean | null
}

/** The signed-in person's conversations, newest first. A coach passes the selected team. */
export async function getMessageThreads(params?: { teamId?: string | null }): Promise<Result<ThreadSummary[]>> {
  if (isMock()) return ok((await mockStore()).mockThreads(params?.teamId))
  const clientResult = requireClient("getMessageThreads")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("get_message_threads", { p_team_id: params?.teamId ?? null })
  if (error) return { ok: false, error: mapMessagingError(error) }
  return ok(
    ((data as ThreadListRow[] | null) ?? []).map((row) => ({
      id: row.thread_id,
      teamId: row.team_id,
      teamName: row.team_name,
      athleteId: row.athlete_id,
      athleteName: row.athlete_name ?? "An athlete",
      athleteUserId: row.athlete_user_id,
      coachUserId: row.coach_user_id,
      coachName: row.coach_name ?? "Coach",
      lastMessageAt: row.last_message_at,
      lastMessagePreview: row.last_message_preview,
      lastMessageHidden: Boolean(row.last_message_hidden),
      lastMessageFromMe: Boolean(row.last_message_from_me),
      unreadCount: row.unread_count ?? 0,
      canSend: Boolean(row.can_send),
    })),
  )
}

/**
 * Finds or starts the conversation with one athlete (a coach) or with one coach (an athlete) and
 * returns its id. Refused for anyone the caller may not message; the error says why.
 */
export async function openMessageThread(target: { athleteId: string } | { coachUserId: string }): Promise<Result<string>> {
  if (isMock()) return (await mockStore()).mockOpenThread(target)
  const clientResult = requireClient("openMessageThread")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("open_message_thread", {
    p_athlete_id: "athleteId" in target ? target.athleteId : null,
    p_coach_user_id: "coachUserId" in target ? target.coachUserId : null,
  })
  if (error) return { ok: false, error: mapMessagingError(error) }
  return ok(data as string)
}

type ThreadRow = {
  thread_id: string
  team_id: string | null
  team_name: string | null
  athlete_id: string
  athlete_name: string | null
  athlete_user_id: string | null
  coach_user_id: string | null
  coach_name: string | null
  viewer_side: ThreadDetail["viewerSide"]
  can_send: boolean | null
  read_only_reason: ThreadReadOnlyReason | null
  other_last_read_at: string | null
  guardian_contact_on_file: boolean | null
  guardian_cc_enabled: boolean | null
}

type MessageRow = {
  id: string
  thread_id: string
  sender_user_id: string | null
  sender_role: "coach" | "athlete"
  body: string | null
  hidden_at: string | null
  created_at: string
}

/** One conversation with its messages, oldest first. Null when it does not exist or the viewer may not read it. */
export async function getMessageThread(threadId: string): Promise<Result<ThreadWithMessages | null>> {
  if (isMock()) return ok((await mockStore()).mockThread(threadId))
  const clientResult = requireClient("getMessageThread")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client

  const [header, messages, session] = await Promise.all([
    client.rpc("get_message_thread", { p_thread_id: threadId }),
    client.from("messages").select("id, thread_id, sender_user_id, sender_role, body, hidden_at, created_at").eq("thread_id", threadId).order("created_at", { ascending: true }).limit(2000),
    client.auth.getSession(),
  ])
  if (header.error) return { ok: false, error: mapMessagingError(header.error) }
  const row = ((header.data as ThreadRow[] | null) ?? [])[0]
  if (!row) return ok(null)
  if (messages.error) return { ok: false, error: mapMessagingError(messages.error) }

  // Reports: a participant gets their own (to show "Reported"), a club admin all of them.
  // The text of a hidden message: club admins only. Both are decided by the row policies.
  const [reports, moderation] = await Promise.all([
    client.from("message_reports").select("id, message_id, reporter_user_id, reason, resolution, created_at").eq("thread_id", threadId).limit(2000),
    row.viewer_side === "oversight"
      ? client.from("message_moderation").select("message_id, original_body, reason").eq("thread_id", threadId).limit(2000)
      : Promise.resolve({ data: [], error: null }),
  ])
  const userId = session.data.session?.user.id ?? null
  type ReportRow = { id: string; message_id: string; reporter_user_id: string | null; reason: string | null; resolution: MessageReport["resolution"]; created_at: string }
  const reportRows = (reports.error ? [] : ((reports.data as ReportRow[] | null) ?? []))
  const moderationRows = (moderation.error ? [] : ((moderation.data as Array<{ message_id: string; original_body: string; reason: string | null }> | null) ?? []))
  const hiddenById = new Map(moderationRows.map((item) => [item.message_id, item]))
  const oversight = row.viewer_side === "oversight"

  const list: ThreadMessage[] = ((messages.data as MessageRow[] | null) ?? []).map((message) => {
    const own = reportRows.filter((report) => report.message_id === message.id)
    return {
      id: message.id,
      threadId: message.thread_id,
      senderUserId: message.sender_user_id,
      senderRole: message.sender_role,
      body: message.body,
      hiddenAt: message.hidden_at,
      createdAt: message.created_at,
      reportedByMe: own.some((report) => report.reporter_user_id === userId),
      reports: oversight ? own.map((report) => ({ id: report.id, reason: report.reason, createdAt: report.created_at, resolution: report.resolution })) : [],
      originalBody: hiddenById.get(message.id)?.original_body ?? null,
      hiddenReason: hiddenById.get(message.id)?.reason ?? null,
    }
  })

  return ok({
    viewerUserId: oversight ? null : userId,
    messages: list,
    thread: {
      id: row.thread_id,
      teamId: row.team_id,
      teamName: row.team_name,
      athleteId: row.athlete_id,
      athleteName: row.athlete_name ?? "An athlete",
      athleteUserId: row.athlete_user_id,
      coachUserId: row.coach_user_id,
      coachName: row.coach_name ?? "Coach",
      viewerSide: row.viewer_side,
      canSend: Boolean(row.can_send),
      readOnlyReason: row.read_only_reason,
      otherLastReadAt: row.other_last_read_at,
      guardianContactOnFile: Boolean(row.guardian_contact_on_file),
      guardianCcEnabled: Boolean(row.guardian_cc_enabled),
    },
  })
}

/** Sends one message. The other person is told in-app and, at most once an hour per conversation, by email. */
export async function sendDirectMessage(threadId: string, text: string): Promise<Result<{ messageId: string }>> {
  const invalid = validateBody(text, "message")
  if (invalid) return err("VALIDATION", invalid)
  if (isMock()) {
    const result = (await mockStore()).mockSendMessage(threadId, text)
    if (!result.ok) return result
    announceChange()
    return ok({ messageId: result.data })
  }
  const clientResult = requireClient("sendDirectMessage")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("send_direct_message", { p_thread_id: threadId, p_body: text })
  if (error) return { ok: false, error: mapMessagingError(error) }
  // Sends the email this may have queued without waiting for the scheduler.
  kickNotificationEmails()
  announceChange()
  return ok({ messageId: data as string })
}

/** "I have read this conversation." Quiet: a failure only means the badge catches up later. */
export async function markMessageThreadRead(threadId: string): Promise<void> {
  if (isMock()) {
    ;(await mockStore()).mockMarkThreadRead(threadId)
    announceChange()
    return
  }
  const client = getBrowserSupabaseClient()
  if (!client) return
  try {
    await client.rpc("mark_message_thread_read", { p_thread_id: threadId })
  } catch {
    // The next visit marks it.
  }
  announceChange()
}

/** Report the other person's message to the club's admins. */
export async function reportMessage(messageId: string, reason?: string | null): Promise<Result<null>> {
  if (isMock()) {
    const result = (await mockStore()).mockReportMessage(messageId, reason ?? null)
    return result.ok ? ok(null) : result
  }
  const clientResult = requireClient("reportMessage")
  if (!clientResult.ok) return clientResult
  const { error } = await clientResult.client.rpc("report_message", { p_message_id: messageId, p_reason: reason?.trim() || null })
  if (error) return { ok: false, error: mapMessagingError(error) }
  kickNotificationEmails()
  return ok(null)
}

/**
 * Listens for changes to one conversation (a new message, a hidden message, the other person
 * reading it) through Supabase Realtime, which applies the row policies. Calls `onChange` with no
 * details; the caller reloads. Returns the function that stops listening. Without Realtime this
 * does nothing and the screen's own refresh on focus and on a timer covers it.
 */
export function subscribeToMessageThread(threadId: string, onChange: () => void): () => void {
  if (isMock()) return () => {}
  const client = getBrowserSupabaseClient()
  if (!client) return () => {}
  let stopped = false
  let channel: ReturnType<SupabaseClient["channel"]> | null = null
  try {
    const notify = () => {
      if (!stopped) onChange()
    }
    channel = client
      .channel(`message-thread:${threadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` }, notify)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "message_threads", filter: `id=eq.${threadId}` }, notify)
      .subscribe()
  } catch {
    // No Realtime: polling covers it.
  }
  return () => {
    stopped = true
    if (channel) {
      try {
        void client.removeChannel(channel)
      } catch {
        // Already gone.
      }
    }
  }
}

/** The coaches of the signed-in athlete's team: who they can message. Empty with no team. */
export async function getMessageableCoaches(): Promise<Result<MessageableCoach[]>> {
  if (isMock()) {
    const { MOCK_COACH_USER_ID, MOCK_COACH_DISPLAY_NAME } = await mockStore()
    return ok([{ userId: MOCK_COACH_USER_ID, name: MOCK_COACH_DISPLAY_NAME, isLead: true }])
  }
  const clientResult = requireClient("getMessageableCoaches")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("get_current_athlete_team_coaches")
  if (error) return { ok: false, error: mapMessagingError(error) }
  return ok(
    ((data as Array<{ user_id: string; display_name: string | null; is_primary: boolean | null }> | null) ?? []).map((row) => ({
      userId: row.user_id,
      name: row.display_name?.trim() || "Coach",
      isLead: Boolean(row.is_primary),
    })),
  )
}

/* ---------- Oversight (club admins) --------------------------------------------------------------------- */

type OversightRow = {
  thread_id: string
  team_id: string | null
  team_name: string | null
  athlete_id: string
  athlete_name: string | null
  athlete_user_id: string | null
  coach_user_id: string | null
  coach_name: string | null
  last_message_at: string
  message_count: number | null
  open_report_count: number | null
  hidden_count: number | null
  is_open: boolean | null
}

/** Every conversation in the club, the ones with a reported message first. Club admins only. */
export async function getOversightThreads(): Promise<Result<OversightThread[]>> {
  if (isMock()) return ok((await mockStore()).mockOversightThreads())
  const clientResult = requireClient("getOversightThreads")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("get_message_oversight_threads")
  if (error) return { ok: false, error: mapMessagingError(error) }
  return ok(
    ((data as OversightRow[] | null) ?? []).map((row) => ({
      id: row.thread_id,
      teamId: row.team_id,
      teamName: row.team_name,
      athleteId: row.athlete_id,
      athleteName: row.athlete_name ?? "An athlete",
      athleteUserId: row.athlete_user_id,
      coachUserId: row.coach_user_id,
      coachName: row.coach_name ?? "Coach",
      lastMessageAt: row.last_message_at,
      messageCount: row.message_count ?? 0,
      openReportCount: row.open_report_count ?? 0,
      hiddenCount: row.hidden_count ?? 0,
      isOpen: Boolean(row.is_open),
    })),
  )
}

/** Hide a message. Both people then see "Message hidden by a club admin". Written to the club's activity log. */
export async function hideMessage(messageId: string, reason?: string | null): Promise<Result<null>> {
  if (isMock()) {
    const result = (await mockStore()).mockHideMessage(messageId, reason ?? null)
    if (result.ok) announceChange()
    return result
  }
  const clientResult = requireClient("hideMessage")
  if (!clientResult.ok) return clientResult
  const { error } = await clientResult.client.rpc("hide_message", { p_message_id: messageId, p_reason: reason?.trim() || null })
  if (error) return { ok: false, error: mapMessagingError(error) }
  announceChange()
  return ok(null)
}

/** A reported message was looked at and stays. Closes its reports. */
export async function dismissMessageReports(messageId: string): Promise<Result<null>> {
  if (isMock()) {
    const result = (await mockStore()).mockDismissReports(messageId)
    if (result.ok) announceChange()
    return result
  }
  const clientResult = requireClient("dismissMessageReports")
  if (!clientResult.ok) return clientResult
  const { error } = await clientResult.client.rpc("dismiss_message_reports", { p_message_id: messageId })
  if (error) return { ok: false, error: mapMessagingError(error) }
  announceChange()
  return ok(null)
}

/** The club's setting for copying guardians in on messages to athletes under 18. Off unless a later version turns it on. */
export async function getGuardianCcEnabled(): Promise<Result<boolean>> {
  if (isMock()) return ok(false)
  const clientResult = requireClient("getGuardianCcEnabled")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.from("club_profiles").select("guardian_cc_enabled").maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(Boolean((data as { guardian_cc_enabled?: boolean | null } | null)?.guardian_cc_enabled))
}

/* ---------- Announcements ------------------------------------------------------------------------------- */

type AnnouncementRow = {
  announcement_id: string
  audience: AnnouncementAudience
  team_id: string | null
  team_name: string | null
  sender_user_id: string | null
  sender_name: string | null
  sender_role: "coach" | "club-admin"
  body: string
  created_at: string
  is_mine: boolean | null
  is_recipient: boolean | null
  read_at: string | null
  can_manage: boolean | null
  recipient_count: number | null
  read_count: number | null
}

/** Announcements the viewer received, posted or may manage, newest first. A coach passes the selected team. */
export async function getAnnouncements(params?: { teamId?: string | null }): Promise<Result<Announcement[]>> {
  if (isMock()) return ok((await mockStore()).mockAnnouncements(params?.teamId))
  const clientResult = requireClient("getAnnouncements")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("get_announcements", { p_team_id: params?.teamId ?? null })
  if (error) return { ok: false, error: mapMessagingError(error) }
  return ok(
    ((data as AnnouncementRow[] | null) ?? []).map((row) => ({
      id: row.announcement_id,
      audience: row.audience,
      teamId: row.team_id,
      teamName: row.team_name,
      senderUserId: row.sender_user_id,
      senderName: row.sender_name ?? (row.sender_role === "coach" ? "Coach" : "Club admin"),
      senderRole: row.sender_role,
      body: row.body,
      createdAt: row.created_at,
      isMine: Boolean(row.is_mine),
      isRecipient: Boolean(row.is_recipient),
      readAt: row.read_at,
      canManage: Boolean(row.can_manage),
      recipientCount: row.recipient_count,
      readCount: row.read_count,
    })),
  )
}

/** One announcement the viewer may see. Null when there is none. */
export async function getAnnouncement(announcementId: string): Promise<Result<Announcement | null>> {
  const all = await getAnnouncements()
  if (!all.ok) return all
  return ok(all.data.find((item) => item.id === announcementId) ?? null)
}

/** Who an announcement went to, the ones who have not read it first. Empty for someone who may not see that. */
export async function getAnnouncementRecipients(announcementId: string): Promise<Result<AnnouncementRecipient[]>> {
  if (isMock()) return ok((await mockStore()).mockAnnouncementRecipients(announcementId))
  const clientResult = requireClient("getAnnouncementRecipients")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("get_announcement_recipients", { p_announcement_id: announcementId })
  if (error) return { ok: false, error: mapMessagingError(error) }
  type Row = { recipient_user_id: string; recipient_name: string | null; recipient_role: AnnouncementRecipient["role"]; athlete_id: string | null; read_at: string | null }
  return ok(
    ((data as Row[] | null) ?? []).map((row) => ({
      userId: row.recipient_user_id,
      name: row.recipient_name ?? "Member",
      role: row.recipient_role,
      athleteId: row.athlete_id,
      readAt: row.read_at,
    })),
  )
}

/** Post an announcement. Every recipient is told in-app and by email. */
export async function postAnnouncement(input: AnnouncementInput): Promise<Result<{ announcementId: string }>> {
  const invalid = validateBody(input.body, "announcement")
  if (invalid) return err("VALIDATION", invalid)
  if (input.audience === "team" && !input.teamId) return err("VALIDATION", "Choose the team this is for.")
  if (isMock()) {
    const result = (await mockStore()).mockPostAnnouncement(input)
    if (!result.ok) return result
    announceChange()
    return ok({ announcementId: result.data })
  }
  const clientResult = requireClient("postAnnouncement")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("post_announcement", {
    p_audience: input.audience,
    p_body: input.body,
    p_team_id: input.audience === "team" ? input.teamId : null,
  })
  if (error) return { ok: false, error: mapMessagingError(error) }
  kickNotificationEmails()
  announceChange()
  return ok({ announcementId: data as string })
}

/** "I have read this announcement." Quiet, like markMessageThreadRead. */
export async function markAnnouncementRead(announcementId: string): Promise<void> {
  if (isMock()) {
    ;(await mockStore()).mockMarkAnnouncementRead(announcementId)
    announceChange()
    return
  }
  const client = getBrowserSupabaseClient()
  if (!client) return
  try {
    await client.rpc("mark_announcement_read", { p_announcement_id: announcementId })
  } catch {
    // The next visit marks it.
  }
  announceChange()
}
