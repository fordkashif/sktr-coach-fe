import { sendSessionMedia, type MediaUploadInput } from "@/lib/data/session/session-media-data"
import { canHold, nextToSend, stepUpload, unkeptPlan, type PendingUpload, type SessionMediaItem, type UploadEvent } from "@/lib/data/session/session-media"
import { dropFile, keepFile, readFile } from "@/lib/data/session/session-media-store"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Uploads of session photos and videos, built like the log's own outbox (session-log-sync.ts) for
 * a phone with a bad signal at the track.
 *
 * A picked file is first kept on the phone (IndexedDB), then sent, one at a time. With no
 * connection it waits and goes by itself when the phone is back online, also after the app was
 * closed. The log stays usable throughout: nothing here blocks typing results. If the phone
 * cannot keep the file it is sent straight from memory, and if it is offline as well the person
 * is told so instead of the file silently going missing.
 */

const QUEUE_KEY = "pacelab:session-media-uploads:v1"
const RETRY_MIN_MS = 4000
const RETRY_MAX_MS = 30000

let queue: PendingUpload[] = []
let loaded = false
let listening = false
let retryDelay = RETRY_MIN_MS
let retryTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()
const doneListeners = new Set<(item: SessionMediaItem, upload: PendingUpload) => void>()
/** Files that are only in memory, and every file while this page is open (for the preview). */
const memory = new Map<string, Blob>()
const previews = new Map<string, string>()
const controllers = new Map<string, AbortController>()

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false
}

function persist() {
  try {
    // Only what is kept on the phone is worth remembering across a reload.
    window.localStorage.setItem(tenantStorageKey(QUEUE_KEY), JSON.stringify(queue.filter((entry) => entry.kept)))
  } catch {
    // The upload still goes from memory on this visit.
  }
}

function emit() {
  queue = [...queue]
  for (const listener of listeners) listener()
}

function change(id: string, event: UploadEvent) {
  queue = queue.map((entry) => (entry.id === id ? stepUpload(entry, event) : entry))
  persist()
  emit()
}

function load() {
  if (loaded || typeof window === "undefined") return
  loaded = true
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(QUEUE_KEY)) ?? "[]") as PendingUpload[]
    // Whatever was in the air when the page closed starts again.
    queue = (Array.isArray(parsed) ? parsed : []).map((entry) => ({ ...entry, status: entry.status === "failed" ? "failed" : "waiting", progress: 0 }))
  } catch {
    queue = []
  }
}

function ensureListening() {
  if (listening || typeof window === "undefined") return
  listening = true
  window.addEventListener("online", () => {
    retryDelay = RETRY_MIN_MS
    emit()
    void pump()
  })
  window.addEventListener("offline", () => emit())
}

async function blobOf(entry: PendingUpload): Promise<Blob | null> {
  return memory.get(entry.id) ?? (entry.kept ? await readFile(`upload:${entry.id}`) : null)
}

async function forget(id: string) {
  queue = queue.filter((entry) => entry.id !== id)
  memory.delete(id)
  controllers.delete(id)
  const url = previews.get(id)
  if (url) URL.revokeObjectURL(url)
  previews.delete(id)
  persist()
  emit()
  await dropFile(`upload:${id}`)
}

async function pump(): Promise<void> {
  const entry = nextToSend(queue, isOnline())
  if (!entry) return
  const blob = await blobOf(entry)
  if (!blob) {
    // Kept in the list but the file is gone (site data was cleared). Nothing to send.
    await forget(entry.id)
    return pump()
  }
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  const controller = new AbortController()
  controllers.set(entry.id, controller)
  change(entry.id, { type: "start" })
  const input: MediaUploadInput = {
    id: entry.id,
    sessionId: entry.sessionId,
    athleteId: entry.athleteId,
    rowId: entry.rowId,
    kind: entry.kind,
    contentType: entry.contentType,
    bytes: entry.bytes,
    durationSeconds: entry.durationSeconds,
    width: entry.width,
    height: entry.height,
    caption: entry.caption,
    blob,
  }
  const result = await sendSessionMedia(input, { signal: controller.signal, onProgress: (fraction) => change(entry.id, { type: "progress", fraction }) })
  controllers.delete(entry.id)

  if (result.ok) {
    await forget(entry.id)
    retryDelay = RETRY_MIN_MS
    for (const listener of doneListeners) listener(result.data, entry)
    return pump()
  }
  if (result.error.cancelled) return pump()
  // Cancelled while the answer was on its way: it is already out of the list.
  if (!queue.some((item) => item.id === entry.id)) return pump()
  change(entry.id, { type: "error", message: result.error.message, refused: result.error.refused })
  if (result.error.refused) return pump()
  // A dropped connection: try again by itself, a little later each time.
  retryTimer = setTimeout(() => {
    retryTimer = null
    void pump()
  }, retryDelay)
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
}

export function subscribeUploads(listener: () => void) {
  load()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getUploads(): PendingUpload[] {
  load()
  return queue
}

/** Called with the saved item each time an upload gets through. */
export function onUploadDone(listener: (item: SessionMediaItem, upload: PendingUpload) => void) {
  doneListeners.add(listener)
  return () => {
    doneListeners.delete(listener)
  }
}

export type NewUpload = Omit<PendingUpload, "status" | "progress" | "message" | "kept" | "createdAt"> & { blob: Blob }

/** Adds a file that is ready to send. Resolves with a message when the phone has nowhere to put it. */
export async function addUpload(input: NewUpload): Promise<{ ok: true } | { ok: false; message: string }> {
  load()
  ensureListening()
  const { blob, ...rest } = input
  const kept = canHold(queue, input.bytes) && (await keepFile(`upload:${input.id}`, blob))
  if (!kept) {
    const plan = unkeptPlan(isOnline())
    if (!plan.send) return { ok: false, message: plan.message ?? "This phone has no room to keep it." }
  }
  memory.set(input.id, blob)
  queue = [...queue, { ...rest, createdAt: new Date().toISOString(), status: "waiting", progress: 0, message: null, kept }]
  persist()
  emit()
  void pump()
  return { ok: true }
}

/** Stops an upload (also one in the air) and drops the file from the phone. */
export async function cancelUpload(id: string) {
  controllers.get(id)?.abort()
  await forget(id)
  void pump()
}

export function retryUpload(id: string) {
  change(id, { type: "retry" })
  void pump()
}

/** A picture of a waiting upload for the list. Null until the file has been read back after a reload. */
export function uploadPreview(id: string): string | null {
  const known = previews.get(id)
  if (known) return known
  const blob = memory.get(id)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  previews.set(id, url)
  return url
}

/** Call when a log screen opens: sends anything left from an earlier visit and reads its files back for the previews. */
export function resumeUploads() {
  load()
  ensureListening()
  for (const entry of queue) {
    if (entry.kept && !memory.has(entry.id)) {
      void readFile(`upload:${entry.id}`).then((blob) => {
        if (!blob) return
        memory.set(entry.id, blob)
        emit()
      })
    }
  }
  void pump()
}

export function uploadsOnline() {
  return isOnline()
}
