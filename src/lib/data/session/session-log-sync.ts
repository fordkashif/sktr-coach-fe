import type { DataError } from "@/lib/data/result"
import { saveSessionCompletion, saveSessionRowLogs } from "@/lib/data/session/session-log-data"
import type { SessionRowLog } from "@/lib/data/session/types"
import { getCookieValue, USER_COOKIE } from "@/lib/auth-session"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Autosave for the athlete log, built for a phone with a bad signal at the track.
 *
 * Every change is written to localStorage first, then sent. Anything that has not reached the
 * backend stays in the outbox and is retried (on a timer, and as soon as the phone is back online),
 * including after a reload. The screen shows the sync state so the athlete knows where they stand.
 *
 * The outbox belongs to the person signed in on this device, not to the club: a phone shared by two
 * athletes once sent the first athlete's unsent sets under the second one's sign-in. The database
 * refused them (nobody may log into someone else's session), and the refused sets then blocked
 * every save after them. Outboxes written before this change (one per club) are still sent, but on
 * their own: what the database refuses there is left for its owner and never blocks anything.
 */

export type SyncState = {
  status: "saved" | "saving" | "retrying" | "failed"
  /** Set when status is "failed": the backend refused the save, so retrying on its own will not help. */
  message: string | null
}

export type PendingCompletion = { completionDate: string; rpe: number | null; comment: string | null; durationMinutes?: number | null }

type Outbox = {
  logs: Record<string, { sessionId: string; log: SessionRowLog }>
  completions: Record<string, PendingCompletion>
}

const STORAGE_KEY = "pacelab:session-log-outbox:v1"
const SEND_DELAY_MS = 500
const RETRY_MIN_MS = 3000
const RETRY_MAX_MS = 20000

let state: SyncState = { status: "saved", message: null }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight = false
let again = false
let retryDelay = RETRY_MIN_MS
let listening = false

/** This device's outbox for the person signed in. Null when nobody is (then the club-wide key, as before). */
function personKey(): string {
  const user = getCookieValue(USER_COOKIE)?.trim().toLowerCase()
  return user ? `${tenantStorageKey(STORAGE_KEY)}:${user}` : tenantStorageKey(STORAGE_KEY)
}

/** The outbox from before it was kept per person (one per club on this device). */
function legacyKey(): string | null {
  const key = tenantStorageKey(STORAGE_KEY)
  return key === personKey() ? null : key
}

function readOutboxAt(key: string): Outbox {
  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? (JSON.parse(raw) as Partial<Outbox>) : null
    return {
      logs: parsed?.logs && typeof parsed.logs === "object" ? parsed.logs : {},
      completions: parsed?.completions && typeof parsed.completions === "object" ? parsed.completions : {},
    }
  } catch {
    return { logs: {}, completions: {} }
  }
}

function writeOutboxAt(key: string, outbox: Outbox) {
  try {
    if (isEmpty(outbox)) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(outbox))
  } catch {
    // Storage full or blocked: the entry is still sent from memory on this attempt.
  }
}

function readOutbox(): Outbox {
  return readOutboxAt(personKey())
}

function writeOutbox(outbox: Outbox) {
  writeOutboxAt(personKey(), outbox)
}

/** Old outbox sessions the database refused for the person signed in now: not tried again this visit. */
const legacyRefused = new Set<string>()

function isEmpty(outbox: Outbox) {
  return Object.keys(outbox.logs).length === 0 && Object.keys(outbox.completions).length === 0
}

function setState(next: SyncState) {
  if (next.status === state.status && next.message === state.message) return
  state = next
  for (const listener of listeners) listener()
}

function schedule(delay: number) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flushSessionOutbox()
  }, delay)
}

function ensureListening() {
  if (listening || typeof window === "undefined") return
  listening = true
  window.addEventListener("online", () => {
    retryDelay = RETRY_MIN_MS
    void flushSessionOutbox()
  })
}

function logKey(sessionId: string, log: SessionRowLog) {
  return `${sessionId}|${log.rowId}|${log.setIndex}`
}

/** The backend said no (signed out, not allowed, bad value). Waiting will not fix these. */
function isRefusal(error: DataError) {
  return error.code === "FORBIDDEN" || error.code === "VALIDATION" || error.code === "NOT_FOUND" || error.code === "UNAUTHORIZED"
}

export function subscribeSyncState(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSyncState() {
  return state
}

export function queueRowLog(sessionId: string, log: SessionRowLog) {
  ensureListening()
  const outbox = readOutbox()
  outbox.logs[logKey(sessionId, log)] = { sessionId, log }
  writeOutbox(outbox)
  if (state.status === "saved") setState({ status: "saving", message: null })
  if (!inFlight) schedule(SEND_DELAY_MS)
  else again = true
}

export function queueCompletion(sessionId: string, completion: PendingCompletion) {
  ensureListening()
  const outbox = readOutbox()
  outbox.completions[sessionId] = completion
  writeOutbox(outbox)
  if (state.status === "saved") setState({ status: "saving", message: null })
}

/** Unsent entries for a session, laid over what the backend returned so nothing typed is lost on reload. */
export function pendingForSession(sessionId: string): { logs: SessionRowLog[]; completion: PendingCompletion | null } {
  if (typeof window === "undefined") return { logs: [], completion: null }
  const outbox = readOutbox()
  // Session ids belong to one athlete, so old entries for this session are this athlete's own.
  const legacy = legacyKey()
  const old = legacy ? readOutboxAt(legacy) : { logs: {}, completions: {} }
  const logs = new Map<string, SessionRowLog>()
  for (const source of [old, outbox]) {
    for (const [key, entry] of Object.entries(source.logs)) if (entry.sessionId === sessionId) logs.set(key, entry.log)
  }
  return {
    logs: [...logs.values()],
    completion: outbox.completions[sessionId] ?? old.completions[sessionId] ?? null,
  }
}

/**
 * Sends what is left in an outbox written before outboxes were kept per person. It may hold another
 * athlete's sets: what the database refuses stays for its owner, is not tried again this visit, and
 * never changes what the screen says.
 */
async function flushLegacyOutbox(): Promise<void> {
  const key = legacyKey()
  if (!key) return
  const old = readOutboxAt(key)
  if (isEmpty(old)) return
  const sessions = new Set([...Object.values(old.logs).map((entry) => entry.sessionId), ...Object.keys(old.completions)])
  for (const sessionId of sessions) {
    if (legacyRefused.has(sessionId)) continue
    const entries = Object.entries(old.logs).filter(([, entry]) => entry.sessionId === sessionId)
    let ok = true
    if (entries.length > 0) {
      const result = await saveSessionRowLogs(
        sessionId,
        entries.map(([, entry]) => entry.log),
      )
      ok = result.ok
      if (!result.ok && isRefusal(result.error)) legacyRefused.add(sessionId)
    }
    const completion = old.completions[sessionId]
    if (ok && completion) {
      const result = await saveSessionCompletion({ sessionId, ...completion })
      if (!result.ok) {
        ok = false
        if (isRefusal(result.error)) legacyRefused.add(sessionId)
      }
    }
    if (ok) {
      const current = readOutboxAt(key)
      for (const [entryKey] of entries) delete current.logs[entryKey]
      delete current.completions[sessionId]
      writeOutboxAt(key, current)
    }
  }
}

/** Sends everything in the outbox. Resolves true when the outbox is empty afterwards. */
export async function flushSessionOutbox(): Promise<boolean> {
  if (typeof window === "undefined") return true
  ensureListening()
  if (inFlight) {
    again = true
    return false
  }
  const snapshot = readOutbox()
  if (isEmpty(snapshot)) {
    setState({ status: "saved", message: null })
    return true
  }

  inFlight = true
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (state.status !== "retrying") setState({ status: "saving", message: null })

  // A refusal is kept over a passing network error: it is what the person needs to know about.
  let failure: DataError | null = null
  const noteFailure = (error: DataError) => {
    if (!failure || (isRefusal(error) && !isRefusal(failure))) failure = error
  }
  const sentLogKeys: Array<[string, string]> = []
  const sentCompletions: Array<[string, string]> = []
  const failedSessions = new Set<string>()

  const bySession = new Map<string, Array<[string, SessionRowLog]>>()
  for (const [key, entry] of Object.entries(snapshot.logs)) {
    bySession.set(entry.sessionId, [...(bySession.get(entry.sessionId) ?? []), [key, entry.log]])
  }
  // Each session on its own: one that is refused does not hold up the others.
  for (const [sessionId, entries] of bySession) {
    const result = await saveSessionRowLogs(
      sessionId,
      entries.map(([, log]) => log),
    )
    if (result.ok) for (const [key, log] of entries) sentLogKeys.push([key, JSON.stringify(log)])
    else {
      failedSessions.add(sessionId)
      noteFailure(result.error)
    }
  }
  // Results go first: a completion is only sent once the sets it summarises are in.
  for (const [sessionId, completion] of Object.entries(snapshot.completions)) {
    if (failedSessions.has(sessionId)) continue
    const result = await saveSessionCompletion({ sessionId, ...completion })
    if (result.ok) sentCompletions.push([sessionId, JSON.stringify(completion)])
    else noteFailure(result.error)
  }

  await flushLegacyOutbox().catch(() => undefined)

  // Only drop what was sent and has not changed while the request was in the air.
  const current = readOutbox()
  for (const [key, sent] of sentLogKeys) {
    if (current.logs[key] && JSON.stringify(current.logs[key].log) === sent) delete current.logs[key]
  }
  for (const [sessionId, sent] of sentCompletions) {
    if (current.completions[sessionId] && JSON.stringify(current.completions[sessionId]) === sent) delete current.completions[sessionId]
  }
  writeOutbox(current)
  inFlight = false

  if (failure) {
    const reason: DataError = failure
    if (isRefusal(reason)) {
      setState({ status: "failed", message: reason.message })
    } else {
      setState({ status: "retrying", message: null })
      schedule(retryDelay)
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
    }
    again = false
    return false
  }

  retryDelay = RETRY_MIN_MS
  if (again || !isEmpty(current)) {
    again = false
    return flushSessionOutbox()
  }
  setState({ status: "saved", message: null })
  return true
}

/** Call when the log screen opens: picks up anything left unsent by an earlier visit. */
export function resumeSessionOutbox() {
  if (typeof window === "undefined") return
  ensureListening()
  if (!isEmpty(readOutbox())) void flushSessionOutbox()
  else void flushLegacyOutbox().catch(() => undefined)
}
