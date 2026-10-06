import { preparePhoto } from "@/lib/image-resize"
import { PHOTO_MAX_EDGE, checkPickedFile, checkVideoLength, mediaKindOf, type MediaKind } from "@/lib/data/session/session-media"

/** A picked file made ready to send: a photo resized, a video measured. */
export type PreparedMedia = {
  kind: MediaKind
  blob: Blob
  contentType: string
  bytes: number
  width: number | null
  height: number | null
  durationSeconds: number | null
}

const READ_TIMEOUT_MS = 10000

/**
 * Length and size of a video, read from its header in the browser. Nothing is uploaded and the
 * clip is not played. Null when the browser cannot open it.
 */
export function readVideoMeta(file: Blob): Promise<{ durationSeconds: number; width: number | null; height: number | null } | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null)
    const url = URL.createObjectURL(file)
    const video = document.createElement("video")
    let settled = false
    const finish = (value: { durationSeconds: number; width: number | null; height: number | null } | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute("src")
      video.load()
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), READ_TIMEOUT_MS)
    const report = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return false
      finish({ durationSeconds: video.duration, width: video.videoWidth || null, height: video.videoHeight || null })
      return true
    }
    video.preload = "metadata"
    video.muted = true
    video.playsInline = true
    video.onloadedmetadata = () => {
      if (report()) return
      // A clip recorded in the browser has no length in its header. Jumping to the end makes the browser work it out.
      video.ondurationchange = () => void report()
      video.ontimeupdate = () => void report()
      try {
        video.currentTime = 1e7
      } catch {
        finish(null)
      }
    }
    video.onerror = () => finish(null)
    video.src = url
  })
}

/** Checks a picked file against the limits and gets it ready. On a refusal the message is in plain words. */
export async function prepareMediaFile(file: File | Blob): Promise<{ ok: true; data: PreparedMedia } | { ok: false; message: string }> {
  const picked = checkPickedFile({ type: file.type, size: file.size })
  if (!picked.ok) return picked
  const kind = mediaKindOf(file.type)

  if (kind === "photo") {
    const photo = await preparePhoto(file, PHOTO_MAX_EDGE)
    if (!photo.ok) {
      return {
        ok: false,
        message:
          photo.error === "too-large"
            ? "That photo is too large. Choose a smaller one."
            : photo.error === "wrong-type"
              ? "Choose a photo (JPEG, PNG, HEIC or WebP)."
              : "This phone could not open that photo. Try another one.",
      }
    }
    return { ok: true, data: { kind: "photo", blob: photo.data.blob, contentType: photo.data.contentType, bytes: photo.data.blob.size, width: photo.data.width, height: photo.data.height, durationSeconds: null } }
  }

  const meta = await readVideoMeta(file)
  const length = checkVideoLength(meta?.durationSeconds ?? null)
  if (!length.ok) return length
  const contentType = file.type.toLowerCase().split(";")[0].trim()
  return {
    ok: true,
    data: { kind: "video", blob: file, contentType, bytes: file.size, width: meta?.width ?? null, height: meta?.height ?? null, durationSeconds: meta?.durationSeconds ?? null },
  }
}
