/**
 * Photos and short videos on a session log: the rules, with nothing from the browser or the
 * backend in here so they can be tested on their own. The same limits are enforced again by the
 * database (20261016110000_session_media.sql).
 */

export type MediaKind = "photo" | "video"

export const MEDIA_BUCKET = "session-media"
export const MAX_MEDIA_PER_SESSION = 6
export const MAX_MEDIA_PER_ATHLETE = 200
export const VIDEO_MAX_SECONDS = 30
/** A phone rounds a "30 second" clip either way, so half a second over still passes. */
export const VIDEO_SECONDS_SLACK = 0.5
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024
export const PHOTO_MAX_EDGE = 1600
/** Largest original photo we try to open. It is resized before it leaves the phone. */
export const PHOTO_MAX_INPUT_BYTES = 30 * 1024 * 1024
export const CAPTION_MAX_LENGTH = 200
export const COMMENT_MAX_LENGTH = 500
/** How much may wait on the phone for a connection. Two full length videos and some photos. */
export const WAITING_MAX_BYTES = 120 * 1024 * 1024
/** How long a link to view a file works. Long enough to watch a clip, short enough not to be passed around. */
export const VIEW_LINK_SECONDS = 600
/** Links written into "download my data" last longer, so the files can be saved. */
export const EXPORT_LINK_SECONDS = 3600

export const VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" }
export const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/webp": "webp" }

export type SessionMediaItem = {
  id: string
  sessionId: string
  /** The exercise it belongs to. Null: it is about the whole session. */
  rowId: string | null
  kind: MediaKind
  path: string
  contentType: string
  bytes: number
  durationSeconds: number | null
  width: number | null
  height: number | null
  caption: string | null
  coachComment: string | null
  coachCommentAt: string | null
  createdAt: string
  /** True when a coach or club admin added it while logging the session for the athlete. */
  addedByStaff: boolean
  /** A link that works for a few minutes (or an object URL in the demo). Null when it could not be made. */
  url: string | null
}

/** "photo" or "video" from a file's type. Null for anything else (a PDF, audio). */
export function mediaKindOf(type: string | null | undefined): MediaKind | null {
  const value = (type ?? "").toLowerCase()
  if (value.startsWith("image/")) return "photo"
  if (value.startsWith("video/")) return "video"
  return null
}

/** The file ending for a type we store. Null when we do not store that type. */
export function mediaExtension(contentType: string): string | null {
  const value = contentType.toLowerCase().split(";")[0].trim()
  return PHOTO_TYPES[value] ?? VIDEO_TYPES[value] ?? null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** "<tenant>/<athlete>/<session>/<file id>.<ext>". Null when any part is not what it should be. */
export function buildMediaPath(parts: { tenantId: string; athleteId: string; sessionId: string; fileId: string; contentType: string }): string | null {
  const extension = mediaExtension(parts.contentType)
  const ids = [parts.tenantId, parts.athleteId, parts.sessionId, parts.fileId].map((value) => value.toLowerCase())
  if (!extension || ids.some((value) => !UUID.test(value))) return null
  return `${ids.join("/")}.${extension}`
}

export function parseMediaPath(path: string): { tenantId: string; athleteId: string; sessionId: string; fileId: string; extension: string } | null {
  const parts = path.split("/")
  if (parts.length !== 4) return null
  const [tenantId, athleteId, sessionId, file] = parts
  const dot = file.lastIndexOf(".")
  if (dot < 0) return null
  const fileId = file.slice(0, dot)
  const extension = file.slice(dot + 1)
  if (![tenantId, athleteId, sessionId, fileId].every((value) => UUID.test(value))) return null
  if (!Object.values(PHOTO_TYPES).includes(extension) && !Object.values(VIDEO_TYPES).includes(extension)) return null
  return { tenantId, athleteId, sessionId, fileId, extension }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB"
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  const mb = bytes / (1024 * 1024)
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`
}

/** "12 s", or "1 min 5 s" for anything a minute or longer. */
export function formatClipLength(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return ""
  const whole = Math.max(1, Math.round(seconds))
  if (whole < 60) return `${whole} s`
  const rest = whole % 60
  return rest ? `${Math.floor(whole / 60)} min ${rest} s` : `${Math.floor(whole / 60)} min`
}

/** The size a picture is drawn at so its longer side is at most `maxEdge`. Never scales up. */
export function fitWithin(width: number, height: number, maxEdge: number = PHOTO_MAX_EDGE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 }
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export type MediaCheck = { ok: true } | { ok: false; message: string }

const OK: MediaCheck = { ok: true }

/** Is there room for one more? `sessionCount` includes what is still uploading or waiting. */
export function checkRoom(counts: { sessionCount: number; athleteCount: number | null }): MediaCheck {
  if (counts.sessionCount >= MAX_MEDIA_PER_SESSION) {
    return { ok: false, message: `A session can have up to ${MAX_MEDIA_PER_SESSION} photos and videos. Remove one to add another.` }
  }
  if (counts.athleteCount !== null && counts.athleteCount >= MAX_MEDIA_PER_ATHLETE) {
    return { ok: false, message: `You have reached the limit of ${MAX_MEDIA_PER_ATHLETE} photos and videos. Remove some older ones to add more.` }
  }
  return OK
}

/** The file as picked, before anything is read from it. */
export function checkPickedFile(file: { type: string; size: number }): MediaCheck {
  const kind = mediaKindOf(file.type)
  if (!kind) return { ok: false, message: "Choose a photo or a video. Other files cannot be added." }
  if (file.size <= 0) return { ok: false, message: "That file is empty. Choose another one." }
  if (kind === "photo") {
    if (/svg|gif/i.test(file.type)) return { ok: false, message: "Choose a photo (JPEG, PNG, HEIC or WebP). Drawings and animations cannot be added." }
    if (file.size > PHOTO_MAX_INPUT_BYTES) return { ok: false, message: `That photo is too large (${formatBytes(file.size)}). Choose one under ${formatBytes(PHOTO_MAX_INPUT_BYTES)}.` }
    return OK
  }
  if (file.size > VIDEO_MAX_BYTES) {
    return { ok: false, message: `That video is ${formatBytes(file.size)}. The most is ${formatBytes(VIDEO_MAX_BYTES)}. Record a shorter clip or lower the camera quality.` }
  }
  if (!mediaExtension(file.type)) {
    return { ok: false, message: "That kind of video cannot be added. Record it with the phone camera (MP4 or MOV)." }
  }
  return OK
}

/** A video once its length has been read. `durationSeconds` null means the phone could not read it. */
export function checkVideoLength(durationSeconds: number | null): MediaCheck {
  if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { ok: false, message: "This phone could not read that video. Record it again with the camera, or choose another one." }
  }
  if (durationSeconds > VIDEO_MAX_SECONDS + VIDEO_SECONDS_SLACK) {
    return { ok: false, message: `That video is ${formatClipLength(durationSeconds)} long. The most is ${VIDEO_MAX_SECONDS} seconds. Trim it to the rep you want to show.` }
  }
  return OK
}

/** "Video, 12 s" or "Photo", with the exercise when there is one. */
export function mediaLabel(item: { kind: MediaKind; durationSeconds: number | null }, exercise?: string | null): string {
  const base = item.kind === "video" ? ["Video", formatClipLength(item.durationSeconds)].filter(Boolean).join(", ") : "Photo"
  return exercise ? `${base}, ${exercise}` : base
}

/** "2 videos, 1 photo". Empty when there is nothing. */
export function mediaCountLabel(items: Array<{ kind: MediaKind }>): string {
  const videos = items.filter((item) => item.kind === "video").length
  const photos = items.length - videos
  return [videos ? `${videos} ${videos === 1 ? "video" : "videos"}` : null, photos ? `${photos} ${photos === 1 ? "photo" : "photos"}` : null].filter(Boolean).join(", ")
}

/* ---------- The upload queue --------------------------------------------------------------------- */

/**
 * waiting    kept on the phone, no connection (or its turn has not come)
 * uploading  being sent, with `progress` from 0 to 1
 * failed     the backend said no, or the connection dropped: `message` says which, "Try again" resends
 */
export type UploadStatus = "waiting" | "uploading" | "failed"

export type PendingUpload = {
  id: string
  sessionId: string
  /** Set when a coach is logging for this athlete. Null: the signed-in athlete. */
  athleteId: string | null
  rowId: string | null
  kind: MediaKind
  contentType: string
  bytes: number
  durationSeconds: number | null
  width: number | null
  height: number | null
  caption: string | null
  createdAt: string
  status: UploadStatus
  progress: number
  message: string | null
  /** False when the file is only in memory: it is lost if the page closes before it is sent. */
  kept: boolean
}

export function waitingBytes(queue: Array<Pick<PendingUpload, "bytes" | "kept">>): number {
  return queue.reduce((sum, entry) => sum + (entry.kept ? entry.bytes : 0), 0)
}

/** Can the phone hold one more file while it waits? */
export function canHold(queue: Array<Pick<PendingUpload, "bytes" | "kept">>, bytes: number, cap: number = WAITING_MAX_BYTES): boolean {
  return waitingBytes(queue) + bytes <= cap
}

/**
 * What to do with a file that could not be kept on the phone (storage full, private browsing, or
 * over our own cap). Online it is sent straight from memory. Offline there is nowhere to put it.
 */
export function unkeptPlan(online: boolean): { send: boolean; message: string | null } {
  return online
    ? { send: true, message: null }
    : { send: false, message: "You are offline and this phone has no room to keep it until you are back online. Add it again when you have a connection." }
}

/** The next upload to send: one at a time, oldest first. Nothing while offline or while one is in the air. */
export function nextToSend(queue: PendingUpload[], online: boolean): PendingUpload | null {
  if (!online || queue.some((entry) => entry.status === "uploading")) return null
  return [...queue].filter((entry) => entry.status === "waiting").sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0] ?? null
}

export type UploadEvent =
  | { type: "start" }
  | { type: "progress"; fraction: number }
  /** `refused`: the backend said no, so sending it again on its own will not help. */
  | { type: "error"; message: string; refused: boolean }
  | { type: "retry" }
  | { type: "offline" }

/** How one upload moves between states. Unknown moves leave it as it is. */
export function stepUpload(entry: PendingUpload, event: UploadEvent): PendingUpload {
  switch (event.type) {
    case "start":
      return entry.status === "waiting" ? { ...entry, status: "uploading", progress: 0, message: null } : entry
    case "progress":
      return entry.status === "uploading" ? { ...entry, progress: Math.min(1, Math.max(entry.progress, event.fraction)) } : entry
    case "error":
      if (entry.status !== "uploading") return entry
      // A dropped connection goes back to waiting and is sent again by itself. A refusal needs the person.
      return event.refused ? { ...entry, status: "failed", progress: 0, message: event.message } : { ...entry, status: "waiting", progress: 0, message: null }
    case "retry":
      return entry.status === "failed" ? { ...entry, status: "waiting", progress: 0, message: null } : entry
    case "offline":
      return entry.status === "uploading" ? { ...entry, status: "waiting", progress: 0, message: null } : entry
  }
}

/** The few words shown beside an upload. */
export function uploadStatusText(entry: Pick<PendingUpload, "status" | "progress" | "kept">, online: boolean): string {
  if (entry.status === "uploading") return `Uploading, ${Math.round(entry.progress * 100)}%`
  if (entry.status === "failed") return "Could not upload"
  return online ? "Waiting to upload" : "Waiting to upload when you are back online"
}
