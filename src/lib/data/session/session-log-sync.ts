import type { DataError } from "@/lib/data/result"
import { saveSessionCompletion, saveSessionRowLogs } from "@/lib/data/session/session-log-data"
import type { SessionRowLog } from "@/lib/data/session/types"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Autosave for the athlete log, built for a phone with a bad signal at the track.
 *
 * Every change is written to localStorage first, then sent. Anything that has not reached the
 * backend stays in the outbox and is retried (on a timer, and as soon as the phone is back online),
 * including after a reload. The screen shows the sync state so the athlete knows where they stand.
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

function readOutbox(): Outbox {
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(STORAGE_KEY))
    const parsed = raw ? (JSON.parse(raw) as Partial<Outbox>) : null
    return {
      logs: parsed?.logs && typeof parsed.logs === "object" ? parsed.logs : {},
      completions: parsed?.completions && typeof parsed.completions === "object" ? parsed.completions : {},
    }
  } catch {
    return { logs: {}, completions: {} }
  }
}

function writeOutbox(outbox: Outbox) {
  try {
    window.localStorage.setItem(tenantStorageKey(STORAGE_KEY), JSON.stringify(outbox))
  } catch {
    // Storage full or blocked: the entry is still sent from memory on this attempt.
  }
}

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
  return {
    logs: Object.values(outbox.logs)
      .filter((entry) => entry.sessionId === sessionId)
      .map((entry) => entry.log),
    completion: outbox.completions[sessionId] ?? null,
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

  let failure: DataError | null = null
  const sentLogKeys: Array<[string, string]> = []
  const sentCompletions: Array<[string, string]> = []

  const bySession = new Map<string, Array<[string, SessionRowLog]>>()
  for (const [key, entry] of Object.entries(snapshot.logs)) {
    bySession.set(entry.sessionId, [...(bySession.get(entry.sessionId) ?? []), [key, entry.log]])
  }
  for (const [sessionId, entries] of bySession) {
    const result = await saveSessionRowLogs(
      sessionId,
      entries.map(([, log]) => log),
    )
    if (result.ok) for (const [key, log] of entries) sentLogKeys.push([key, JSON.stringify(log)])
    else failure = result.error
  }
  // Results go first: a completion is only sent once the sets it summarises are in.
  if (!failure) {
    for (const [sessionId, completion] of Object.entries(snapshot.completions)) {
      const result = await saveSessionCompletion({ sessionId, ...completion })
      if (result.ok) sentCompletions.push([sessionId, JSON.stringify(completion)])
      else failure = result.error
    }
  }

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
    if (isRefusal(failure)) {
      setState({ status: "failed", message: failure.message })
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
}
