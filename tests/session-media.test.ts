import test from "node:test"
import assert from "node:assert/strict"
import {
  MAX_MEDIA_PER_ATHLETE,
  MAX_MEDIA_PER_SESSION,
  VIDEO_MAX_BYTES,
  WAITING_MAX_BYTES,
  buildMediaPath,
  canHold,
  checkPickedFile,
  checkRoom,
  checkVideoLength,
  fitWithin,
  formatBytes,
  formatClipLength,
  mediaCountLabel,
  mediaExtension,
  mediaKindOf,
  mediaLabel,
  nextToSend,
  parseMediaPath,
  stepUpload,
  unkeptPlan,
  uploadStatusText,
  waitingBytes,
  type PendingUpload,
} from "../src/lib/data/session/session-media"

const T = "11111111-1111-4111-8111-111111111111"
const A = "22222222-2222-4222-8222-222222222222"
const S = "33333333-3333-4333-8333-333333333333"
const F = "44444444-4444-4444-8444-444444444444"

function upload(patch: Partial<PendingUpload> = {}): PendingUpload {
  return {
    id: F,
    sessionId: S,
    athleteId: null,
    rowId: null,
    kind: "video",
    contentType: "video/mp4",
    bytes: 1000,
    durationSeconds: 10,
    width: 720,
    height: 1280,
    caption: null,
    createdAt: "2026-10-05T10:00:00.000Z",
    status: "waiting",
    progress: 0,
    message: null,
    kept: true,
    ...patch,
  }
}

test("kind and file ending come from the type", () => {
  assert.equal(mediaKindOf("image/heic"), "photo")
  assert.equal(mediaKindOf("VIDEO/MP4"), "video")
  assert.equal(mediaKindOf("application/pdf"), null)
  assert.equal(mediaKindOf(""), null)
  assert.equal(mediaExtension("image/jpeg"), "jpg")
  assert.equal(mediaExtension("video/quicktime"), "mov")
  assert.equal(mediaExtension("video/webm;codecs=vp8"), "webm")
  assert.equal(mediaExtension("image/png"), null)
  assert.equal(mediaExtension("video/x-matroska"), null)
})

test("a path is tenant, athlete, session, file and nothing else", () => {
  const path = buildMediaPath({ tenantId: T, athleteId: A, sessionId: S, fileId: F, contentType: "video/mp4" })
  assert.equal(path, `${T}/${A}/${S}/${F}.mp4`)
  assert.deepEqual(parseMediaPath(path as string), { tenantId: T, athleteId: A, sessionId: S, fileId: F, extension: "mp4" })
  // Upper case ids are lowered, the way the database writes them.
  assert.equal(buildMediaPath({ tenantId: T.toUpperCase(), athleteId: A, sessionId: S, fileId: F, contentType: "image/jpeg" }), `${T}/${A}/${S}/${F}.jpg`)
})

test("a path cannot be built from anything that is not an id, or for a type we do not store", () => {
  assert.equal(buildMediaPath({ tenantId: "..", athleteId: A, sessionId: S, fileId: F, contentType: "image/jpeg" }), null)
  assert.equal(buildMediaPath({ tenantId: T, athleteId: `${A}/x`, sessionId: S, fileId: F, contentType: "image/jpeg" }), null)
  assert.equal(buildMediaPath({ tenantId: T, athleteId: A, sessionId: "mock:2026-10-05", fileId: F, contentType: "image/jpeg" }), null)
  assert.equal(buildMediaPath({ tenantId: T, athleteId: A, sessionId: S, fileId: F, contentType: "image/svg+xml" }), null)
  assert.equal(parseMediaPath(`${T}/${A}/${S}/../x.jpg`), null)
  assert.equal(parseMediaPath(`${T}/${A}/${F}.jpg`), null)
  assert.equal(parseMediaPath(`${T}/${A}/${S}/${F}.exe`), null)
  assert.equal(parseMediaPath(`${T}/${A}/${S}/${F}`), null)
})

test("room: six in a session, two hundred for an athlete", () => {
  assert.deepEqual(checkRoom({ sessionCount: MAX_MEDIA_PER_SESSION - 1, athleteCount: 10 }), { ok: true })
  const sessionFull = checkRoom({ sessionCount: MAX_MEDIA_PER_SESSION, athleteCount: 10 })
  assert.equal(sessionFull.ok, false)
  assert.match(sessionFull.ok ? "" : sessionFull.message, /up to 6 photos and videos/)
  const athleteFull = checkRoom({ sessionCount: 0, athleteCount: MAX_MEDIA_PER_ATHLETE })
  assert.match(athleteFull.ok ? "" : athleteFull.message, /limit of 200/)
  // The count could not be read: the database still checks, so the app does not block.
  assert.deepEqual(checkRoom({ sessionCount: 0, athleteCount: null }), { ok: true })
})

test("a picked file: only photos and videos, a video at most 50 MB, in plain words", () => {
  assert.deepEqual(checkPickedFile({ type: "image/jpeg", size: 4_000_000 }), { ok: true })
  assert.deepEqual(checkPickedFile({ type: "image/heic", size: 4_000_000 }), { ok: true })
  assert.deepEqual(checkPickedFile({ type: "video/mp4", size: VIDEO_MAX_BYTES }), { ok: true })
  const tooBig = checkPickedFile({ type: "video/mp4", size: VIDEO_MAX_BYTES + 1 })
  assert.match(tooBig.ok ? "" : tooBig.message, /The most is 50 MB/)
  const pdf = checkPickedFile({ type: "application/pdf", size: 10 })
  assert.match(pdf.ok ? "" : pdf.message, /Choose a photo or a video/)
  assert.equal(checkPickedFile({ type: "image/svg+xml", size: 10 }).ok, false)
  assert.equal(checkPickedFile({ type: "image/gif", size: 10 }).ok, false)
  assert.equal(checkPickedFile({ type: "video/x-msvideo", size: 10 }).ok, false)
  assert.equal(checkPickedFile({ type: "video/mp4", size: 0 }).ok, false)
})

test("a video: at most 30 seconds, with half a second of slack, and unreadable is refused", () => {
  assert.deepEqual(checkVideoLength(12.4), { ok: true })
  assert.deepEqual(checkVideoLength(30), { ok: true })
  assert.deepEqual(checkVideoLength(30.4), { ok: true })
  const long = checkVideoLength(31)
  assert.match(long.ok ? "" : long.message, /31 s long\. The most is 30 seconds/)
  assert.match(((r) => (r.ok ? "" : r.message))(checkVideoLength(95)), /1 min 35 s long/)
  assert.equal(checkVideoLength(null).ok, false)
  assert.equal(checkVideoLength(Number.POSITIVE_INFINITY).ok, false)
  assert.equal(checkVideoLength(0).ok, false)
})

test("a photo is fitted inside 1600 pixels and never made bigger", () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 1600, height: 1200 })
  assert.deepEqual(fitWithin(3000, 4000), { width: 1200, height: 1600 })
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 })
  assert.deepEqual(fitWithin(10000, 10), { width: 1600, height: 2 })
  assert.deepEqual(fitWithin(0, 100), { width: 0, height: 0 })
})

test("sizes, lengths and labels read plainly", () => {
  assert.equal(formatBytes(500), "1 KB")
  assert.equal(formatBytes(240_000), "234 KB")
  assert.equal(formatBytes(4_400_000), "4.2 MB")
  assert.equal(formatBytes(VIDEO_MAX_BYTES), "50 MB")
  assert.equal(formatClipLength(12.4), "12 s")
  assert.equal(formatClipLength(0.3), "1 s")
  assert.equal(formatClipLength(60), "1 min")
  assert.equal(formatClipLength(null), "")
  assert.equal(mediaLabel({ kind: "video", durationSeconds: 12.4 }, "Back squat"), "Video, 12 s, Back squat")
  assert.equal(mediaLabel({ kind: "photo", durationSeconds: null }), "Photo")
  assert.equal(mediaCountLabel([{ kind: "video" }, { kind: "photo" }, { kind: "video" }]), "2 videos, 1 photo")
  assert.equal(mediaCountLabel([{ kind: "photo" }]), "1 photo")
  assert.equal(mediaCountLabel([]), "")
})

test("the phone holds waiting files up to a cap, counting only what is really kept", () => {
  const queue = [upload({ bytes: 50_000_000 }), upload({ id: "b", bytes: 40_000_000 }), upload({ id: "c", bytes: 99_000_000, kept: false })]
  assert.equal(waitingBytes(queue), 90_000_000)
  assert.equal(canHold(queue, WAITING_MAX_BYTES - 90_000_000), true)
  assert.equal(canHold(queue, WAITING_MAX_BYTES - 90_000_000 + 1), false)
  assert.equal(canHold([], 1, 0), false)
})

test("a file the phone cannot keep is sent straight away online, and refused with a reason offline", () => {
  assert.deepEqual(unkeptPlan(true), { send: true, message: null })
  const offline = unkeptPlan(false)
  assert.equal(offline.send, false)
  assert.match(offline.message ?? "", /offline and this phone has no room/)
})

test("uploads go one at a time, oldest first, and never while offline", () => {
  const first = upload({ id: "first", createdAt: "2026-10-05T10:00:00.000Z" })
  const second = upload({ id: "second", createdAt: "2026-10-05T10:01:00.000Z" })
  assert.equal(nextToSend([second, first], true)?.id, "first")
  assert.equal(nextToSend([second, first], false), null)
  assert.equal(nextToSend([{ ...first, status: "uploading" }, second], true), null)
  assert.equal(nextToSend([{ ...first, status: "failed" }, second], true)?.id, "second")
  assert.equal(nextToSend([{ ...first, status: "failed" }], true), null)
  assert.equal(nextToSend([], true), null)
})

test("an upload moves waiting, uploading, and back or to failed", () => {
  const waiting = upload()
  const sending = stepUpload(waiting, { type: "start" })
  assert.equal(sending.status, "uploading")
  assert.equal(stepUpload(sending, { type: "progress", fraction: 0.4 }).progress, 0.4)
  // Progress never runs backwards and never passes 1.
  assert.equal(stepUpload({ ...sending, progress: 0.6 }, { type: "progress", fraction: 0.4 }).progress, 0.6)
  assert.equal(stepUpload(sending, { type: "progress", fraction: 3 }).progress, 1)
  // A dropped connection waits and goes again by itself.
  const dropped = stepUpload({ ...sending, progress: 0.7 }, { type: "error", message: "The connection dropped.", refused: false })
  assert.deepEqual([dropped.status, dropped.progress, dropped.message], ["waiting", 0, null])
  // A refusal stays put with its reason until the person tries again.
  const refused = stepUpload(sending, { type: "error", message: "A session can have up to 6.", refused: true })
  assert.deepEqual([refused.status, refused.message], ["failed", "A session can have up to 6."])
  assert.equal(stepUpload(refused, { type: "start" }).status, "failed")
  const again = stepUpload(refused, { type: "retry" })
  assert.deepEqual([again.status, again.message], ["waiting", null])
  assert.equal(stepUpload(sending, { type: "offline" }).status, "waiting")
  // Moves that make no sense change nothing.
  assert.equal(stepUpload(waiting, { type: "progress", fraction: 0.5 }), waiting)
  assert.equal(stepUpload(waiting, { type: "retry" }), waiting)
  assert.equal(stepUpload(waiting, { type: "error", message: "x", refused: true }), waiting)
})

test("the words beside an upload say where it stands", () => {
  assert.equal(uploadStatusText(upload({ status: "uploading", progress: 0.42 }), true), "Uploading, 42%")
  assert.equal(uploadStatusText(upload(), true), "Waiting to upload")
  assert.equal(uploadStatusText(upload(), false), "Waiting to upload when you are back online")
  assert.equal(uploadStatusText(upload({ status: "failed" }), true), "Could not upload")
})
