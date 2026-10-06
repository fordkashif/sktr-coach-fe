/** Photo types the avatars bucket accepts. Anything else is refused before upload. */
export const AVATAR_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
/** Largest original we try to open. Phone photos are 2 to 8 MB; this leaves room. */
export const AVATAR_MAX_INPUT_BYTES = 20 * 1024 * 1024
/** The bucket limit. A 512px JPEG is far below it; the check is a backstop. */
export const AVATAR_MAX_UPLOAD_BYTES = 2 * 1024 * 1024

export type AvatarImageError = "wrong-type" | "too-large" | "unreadable"

export type PreparedAvatar = { blob: Blob; dataUrl: string }

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  // createImageBitmap applies the photo's EXIF rotation, so portrait phone photos stay upright.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      // Fall through to the <img> path (older Safari).
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error("unreadable"))
      element.src = url
    })
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => undefined }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Crops the photo to a centred square and scales it to `size` pixels as a JPEG.
 * Runs in the browser, so the original (often several MB) never leaves the device.
 */
export async function prepareAvatarImage(
  file: File | Blob,
  size = 512,
  /** "cover" crops to the centre (a face). "contain" keeps the whole picture on white (a logo). */
  fit: "cover" | "contain" = "cover",
): Promise<{ ok: true; data: PreparedAvatar } | { ok: false; error: AvatarImageError }> {
  const type = file.type.toLowerCase()
  if (type && !type.startsWith("image/")) return { ok: false, error: "wrong-type" }
  if (type === "image/svg+xml" || type === "image/gif") return { ok: false, error: "wrong-type" }
  if (file.size > AVATAR_MAX_INPUT_BYTES) return { ok: false, error: "too-large" }

  let decoded: Awaited<ReturnType<typeof decode>>
  try {
    decoded = await decode(file)
  } catch {
    return { ok: false, error: type ? "unreadable" : "wrong-type" }
  }

  try {
    const side = Math.min(decoded.width, decoded.height)
    if (!side) return { ok: false, error: "unreadable" }
    const canvas = document.createElement("canvas")
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext("2d")
    if (!context) return { ok: false, error: "unreadable" }
    // White behind transparent PNGs, which would otherwise turn black as JPEG.
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, size, size)
    context.imageSmoothingQuality = "high"
    if (fit === "contain") {
      // The whole picture, centred, with a small margin so a wide logo does not touch the edge.
      const scale = Math.min((size * 0.92) / decoded.width, (size * 0.92) / decoded.height)
      const width = decoded.width * scale
      const height = decoded.height * scale
      context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height, (size - width) / 2, (size - height) / 2, width, height)
    } else {
      context.drawImage(decoded.source, (decoded.width - side) / 2, (decoded.height - side) / 2, side, side, 0, 0, size, size)
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86))
    if (!blob) return { ok: false, error: "unreadable" }
    if (blob.size > AVATAR_MAX_UPLOAD_BYTES) return { ok: false, error: "too-large" }
    return { ok: true, data: { blob, dataUrl: canvas.toDataURL("image/jpeg", 0.86) } }
  } finally {
    decoded.close()
  }
}

/** Largest original a session photo may be before we try to open it. */
export const PHOTO_MAX_INPUT_BYTES = 30 * 1024 * 1024

export type PreparedPhoto = { blob: Blob; width: number; height: number; contentType: "image/jpeg" }

/**
 * Scales a photo so its longer side is at most `maxEdge` pixels and re-encodes it as a JPEG, with
 * the proportions kept (no crop). For photos attached to a session log. Like the avatar path it
 * runs in the browser, so the original never leaves the device and any location data in it is dropped.
 */
export async function preparePhoto(
  file: File | Blob,
  maxEdge = 1600,
): Promise<{ ok: true; data: PreparedPhoto } | { ok: false; error: AvatarImageError }> {
  const type = file.type.toLowerCase()
  if (type && !type.startsWith("image/")) return { ok: false, error: "wrong-type" }
  if (type === "image/svg+xml" || type === "image/gif") return { ok: false, error: "wrong-type" }
  if (file.size > PHOTO_MAX_INPUT_BYTES) return { ok: false, error: "too-large" }

  let decoded: Awaited<ReturnType<typeof decode>>
  try {
    decoded = await decode(file)
  } catch {
    return { ok: false, error: type ? "unreadable" : "wrong-type" }
  }

  try {
    if (!decoded.width || !decoded.height) return { ok: false, error: "unreadable" }
    const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) return { ok: false, error: "unreadable" }
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, width, height)
    context.imageSmoothingQuality = "high"
    context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
    if (!blob) return { ok: false, error: "unreadable" }
    return { ok: true, data: { blob, width, height, contentType: "image/jpeg" } }
  } finally {
    decoded.close()
  }
}
