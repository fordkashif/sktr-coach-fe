/**
 * Addresses of the messaging screens. Other screens link here instead of building paths by hand:
 * the roster or an athlete's page can offer "Message" with messageAthleteHref(athlete.id).
 */

import type { MessagesRole } from "@/lib/data/messages/types"

/** The Messages screen of a role. A club admin who also coaches uses the coach screens for their own conversations. */
export function messagesHomeHref(role: MessagesRole, tab?: "direct" | "announcements" | "oversight"): string {
  const base = role === "athlete" ? "/athlete/messages" : role === "club-admin" ? "/club-admin/messages" : "/coach/messages"
  return tab ? `${base}?tab=${tab}` : base
}

/**
 * A coach's conversation with one athlete. Opens the existing thread or starts one. The database
 * refuses it unless the athlete is on a team the coach is assigned to and has a login; the screen
 * then says why. Check `canMessageAthlete` first to show "No login" instead of a dead link.
 */
export function messageAthleteHref(athleteId: string): string {
  return `/coach/messages/with/${encodeURIComponent(athleteId)}`
}

/** An athlete's conversation with one of the coaches of their team. */
export function messageCoachHref(coachUserId: string): string {
  return `/athlete/messages/coach/${encodeURIComponent(coachUserId)}`
}

/** False for a managed athlete with no login: show "No login" and disable the action. */
export function canMessageAthlete(athlete: { userId?: string | null; hasLogin?: boolean }): boolean {
  return athlete.hasLogin ?? Boolean(athlete.userId)
}

export function threadHref(role: MessagesRole, threadId: string): string {
  return `${messagesHomeHref(role)}/t/${encodeURIComponent(threadId)}`
}

export function announcementHref(role: MessagesRole, announcementId: string): string {
  return `${messagesHomeHref(role)}/a/${encodeURIComponent(announcementId)}`
}

export function newAnnouncementHref(role: Exclude<MessagesRole, "athlete">): string {
  return `${messagesHomeHref(role)}/a/new`
}
