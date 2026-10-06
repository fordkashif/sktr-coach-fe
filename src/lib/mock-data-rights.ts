import { getCookieValue, TENANT_COOKIE } from "@/lib/auth-session"
import { deletionDateAfter } from "@/lib/data-rights"
import { MOCK_CREDENTIALS } from "@/lib/mock-auth"

/**
 * Mock mode stores for personal data rights and club exit: closed clubs, the club owner, and
 * accounts that deleted themselves. All in localStorage, shared by every demo role in the same
 * browser (a platform admin sees the club a club admin closed).
 */

const CLOSURES_KEY = "pacelab:club-closures"
const OWNERS_KEY = "pacelab:club-owners"
const DELETED_ACCOUNTS_KEY = "pacelab:mock-deleted-accounts"
const EXPORT_LOG_KEY = "pacelab:mock-data-exports"

export type MockClubClosure = {
  tenantId: string
  clubName: string
  closedAt: string
  deleteAfter: string
  closedByName: string
  memberCount: number
  athleteCount: number
  reopenedAt: string | null
  /** Set when a platform admin deleted the club for good. The record stays so the club stays shut. */
  deletedAt: string | null
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as T | null
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function mockTenantId() {
  return getCookieValue(TENANT_COOKIE) ?? MOCK_CREDENTIALS.clubAdmin.tenantId
}

/* ---------- Closed clubs ---------------------------------------------------------------------------- */

export function loadMockClubClosures(): MockClubClosure[] {
  const list = read<MockClubClosure[]>(CLOSURES_KEY, [])
  return Array.isArray(list) ? list : []
}

/** The closure that keeps a club shut: closed and not reopened, or deleted. */
export function getMockClubClosure(tenantId: string | null): MockClubClosure | null {
  if (!tenantId) return null
  return loadMockClubClosures().find((item) => item.tenantId === tenantId && !item.reopenedAt) ?? null
}

export function closeMockClub(input: { tenantId: string; clubName: string; closedByName: string; memberCount: number; athleteCount: number }): MockClubClosure | null {
  const closedAt = new Date().toISOString()
  const closure: MockClubClosure = { ...input, closedAt, deleteAfter: deletionDateAfter(closedAt), reopenedAt: null, deletedAt: null }
  const rest = loadMockClubClosures().filter((item) => item.tenantId !== input.tenantId || item.reopenedAt)
  return write(CLOSURES_KEY, [closure, ...rest]) ? closure : null
}

export function reopenMockClub(tenantId: string): boolean {
  const list = loadMockClubClosures()
  const target = list.find((item) => item.tenantId === tenantId && !item.reopenedAt && !item.deletedAt)
  if (!target) return false
  target.reopenedAt = new Date().toISOString()
  return write(CLOSURES_KEY, list)
}

export function deleteMockClosedClub(tenantId: string): boolean {
  const list = loadMockClubClosures()
  const target = list.find((item) => item.tenantId === tenantId && !item.reopenedAt && !item.deletedAt)
  if (!target) return false
  target.deletedAt = new Date().toISOString()
  return write(CLOSURES_KEY, list)
}

/* ---------- Club owner ------------------------------------------------------------------------------ */

/** The owner's email. The demo club is owned by the demo club admin until ownership is transferred. */
export function getMockClubOwnerEmail(tenantId: string): string {
  const owners = read<Record<string, string>>(OWNERS_KEY, {})
  return owners[tenantId] ?? MOCK_CREDENTIALS.clubAdmin.email
}

export function setMockClubOwnerEmail(tenantId: string, email: string): boolean {
  const owners = read<Record<string, string>>(OWNERS_KEY, {})
  return write(OWNERS_KEY, { ...owners, [tenantId]: email.trim().toLowerCase() })
}

/* ---------- Deleted accounts ------------------------------------------------------------------------ */

export function isMockAccountDeleted(email: string | null | undefined): boolean {
  if (!email) return false
  const list = read<string[]>(DELETED_ACCOUNTS_KEY, [])
  return Array.isArray(list) && list.includes(email.trim().toLowerCase())
}

export function markMockAccountDeleted(email: string): boolean {
  const list = read<string[]>(DELETED_ACCOUNTS_KEY, [])
  return write(DELETED_ACCOUNTS_KEY, [...new Set([...(Array.isArray(list) ? list : []), email.trim().toLowerCase()])])
}

/* ---------- Export log (stands in for the audit entries of people who are not club admins) ---------- */

export type MockExportLogEntry = { at: string; email: string; kind: "personal" | "club"; includeHealth: boolean }

export function loadMockExportLog(): MockExportLogEntry[] {
  const list = read<MockExportLogEntry[]>(EXPORT_LOG_KEY, [])
  return Array.isArray(list) ? list : []
}

export function logMockExport(entry: Omit<MockExportLogEntry, "at">) {
  write(EXPORT_LOG_KEY, [{ ...entry, at: new Date().toISOString() }, ...loadMockExportLog()].slice(0, 100))
}
