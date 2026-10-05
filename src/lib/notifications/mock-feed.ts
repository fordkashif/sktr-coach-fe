import type { NotificationItem, NotificationPage } from "@/lib/data/notifications-data"
import type { NotificationRole } from "@/lib/notifications/target"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Demo mode has no backend. Each role gets a few realistic notifications so the bell, the sheet and
 * the /notifications page can be shown and tested. Which ones were read is kept on this device.
 */

type MockSeed = {
  id: string
  eventType: string
  subject: string
  body: string
  /** Minutes before "now". */
  minutesAgo: number
  /** Demo ids are not real ids, so demo items say where they lead. */
  href: string
  read?: boolean
}

const DAY = 24 * 60

const SEEDS: Record<NotificationRole, MockSeed[]> = {
  athlete: [
    {
      id: "mock-athlete-plan",
      eventType: "training_plan_published",
      subject: "New training plan: Speed block",
      body: "Your coach published a plan for Sprint Group. It starts on Monday.",
      minutesAgo: 35,
      href: "/athlete/training-plan",
    },
    {
      id: "mock-athlete-note",
      eventType: "session_note_added",
      subject: "Coach Rivera left a note on your session",
      body: "Acceleration and block starts, today. Open the session to read it.",
      minutesAgo: 3 * 60,
      href: "/athlete/log",
    },
    {
      id: "mock-athlete-test-week",
      eventType: "test_week_published",
      subject: "Test week: Autumn testing",
      body: "Your coach opened a test week for Sprint Group. It runs for five days.",
      minutesAgo: DAY + 4 * 60,
      href: "/athlete/test-week",
      read: true,
    },
    {
      id: "mock-athlete-team",
      eventType: "athlete_team_added",
      subject: "You were added to Sprint Group",
      body: "Plans and test weeks for this team will now show up for you.",
      minutesAgo: 9 * DAY,
      href: "/athlete/home",
      read: true,
    },
  ],
  coach: [
    {
      id: "mock-coach-readiness",
      eventType: "athlete_low_readiness",
      subject: "David Okafor reported low readiness",
      body: "Their check-in for today needs a look before training (Sprint Group).",
      minutesAgo: 20,
      href: "/coach/athletes/a3",
    },
    {
      id: "mock-coach-sessions",
      eventType: "athlete_session_completed",
      subject: "3 athletes finished a session",
      body: "Marcus Johnson, Sarah Chen and Sophia Kim (Sprint Group)",
      minutesAgo: 2 * 60,
      href: "/coach/teams/t1",
    },
    {
      id: "mock-coach-results",
      eventType: "athlete_test_results_submitted",
      subject: "Sarah Chen submitted test week results",
      body: "Autumn testing",
      minutesAgo: DAY + 2 * 60,
      href: "/coach/test-week",
      read: true,
    },
    {
      id: "mock-coach-invite",
      eventType: "athlete_invite_accepted",
      subject: "Sophia Kim joined Sprint Group",
      body: "They accepted your invite and can now see the team's plan.",
      minutesAgo: 6 * DAY,
      href: "/coach/teams/t1",
      read: true,
    },
  ],
  "club-admin": [
    {
      id: "mock-admin-coach-invite",
      eventType: "coach_invite_accepted",
      subject: "Coach invite accepted",
      body: "jordan.blake@example.com accepted the coach invite for Throws Group.",
      minutesAgo: 50,
      href: "/club-admin/users",
    },
    {
      id: "mock-admin-package",
      eventType: "package_request_reviewed",
      subject: "Package request approved",
      body: "Your club is now on the Pro package.",
      minutesAgo: DAY + 60,
      href: "/club-admin/billing",
    },
    {
      id: "mock-admin-athlete-invite",
      eventType: "athlete_invite_accepted",
      subject: "Athlete invite accepted",
      body: "A new athlete joined Distance Group.",
      minutesAgo: 4 * DAY,
      href: "/club-admin/teams",
      read: true,
    },
  ],
  "platform-admin": [
    {
      id: "mock-platform-request",
      eventType: "tenant_provision_request_submitted",
      subject: "New club request",
      body: "Kingston Harriers asked to join SKTR Coach.",
      minutesAgo: 90,
      href: "/platform-admin/requests",
    },
    {
      id: "mock-platform-request-2",
      eventType: "tenant_provision_request_submitted",
      subject: "New club request",
      body: "Blue Mountain Athletics asked to join SKTR Coach.",
      minutesAgo: 3 * DAY,
      href: "/platform-admin/requests",
      read: true,
    },
  ],
}

const STORAGE_KEY = "pacelab:mock-notifications-read"

function storageKey(role: NotificationRole) {
  return `${tenantStorageKey(STORAGE_KEY)}:${role}`
}

function loadReadIds(role: NotificationRole): Set<string> {
  try {
    const stored = window.localStorage.getItem(storageKey(role))
    const parsed = stored ? (JSON.parse(stored) as unknown) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [])
  } catch {
    return new Set()
  }
}

function saveReadIds(role: NotificationRole, ids: Set<string>) {
  try {
    window.localStorage.setItem(storageKey(role), JSON.stringify([...ids]))
  } catch {
    // Storage can be blocked. Read state then lasts for this visit only.
  }
}

/** Read state for a visit where storage is blocked. */
const sessionRead: Partial<Record<NotificationRole, Set<string>>> = {}

function readIds(role: NotificationRole): Set<string> {
  const stored = loadReadIds(role)
  for (const id of sessionRead[role] ?? []) stored.add(id)
  return stored
}

/** Fixed for the visit, so "Load more" pages line up. */
const MOCK_NOW = Date.now()

function allItems(role: NotificationRole): NotificationItem[] {
  const now = MOCK_NOW
  const read = readIds(role)
  return (SEEDS[role] ?? []).map((seed) => {
    const isRead = Boolean(seed.read) || read.has(seed.id)
    return {
      id: seed.id,
      eventType: seed.eventType,
      subject: seed.subject,
      body: seed.body,
      state: isRead ? "read" : "unread",
      createdAt: new Date(now - seed.minutesAgo * 60_000).toISOString(),
      readAt: isRead ? new Date(now).toISOString() : null,
      href: seed.href,
    }
  })
}

export function getMockNotificationFeed(params: { role: NotificationRole; limit: number; before: string | null }): NotificationPage {
  const items = allItems(params.role).filter((item) => !params.before || item.createdAt < params.before)
  return { items: items.slice(0, params.limit), hasMore: items.length > params.limit }
}

export function getMockUnreadNotificationCount(role: NotificationRole): number {
  return allItems(role).filter((item) => item.state === "unread").length
}

export function markMockNotificationsRead(role: NotificationRole, ids: string[]) {
  const next = readIds(role)
  ids.forEach((id) => next.add(id))
  sessionRead[role] = next
  saveReadIds(role, next)
}

export function markAllMockNotificationsRead(role: NotificationRole) {
  markMockNotificationsRead(
    role,
    (SEEDS[role] ?? []).map((seed) => seed.id),
  )
}
