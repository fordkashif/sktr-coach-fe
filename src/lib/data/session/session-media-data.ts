import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import {
  CAPTION_MAX_LENGTH,
  COMMENT_MAX_LENGTH,
  EXPORT_LINK_SECONDS,
  MEDIA_BUCKET,
  VIEW_LINK_SECONDS,
  buildMediaPath,
  checkRoom,
  type MediaKind,
  type SessionMediaItem,
} from "@/lib/data/session/session-media"
import { dropFile, keepFile, readFile } from "@/lib/data/session/session-media-store"
import { MOCK_ATHLETE_ID } from "@/lib/data/session/session-mock"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode, getSupabasePublicConfig } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Photos and videos on a session log.
 *
 * Supabase: the file goes to the private bucket session-media under
 * <tenant>/<athlete>/<session>/<file>, its record to public.session_media (20261016110000). Files
 * are only ever shown through signed links that stop working after a few minutes.
 * Mock: the file is kept in this browser (IndexedDB) and shown through an object URL, so the
 * whole flow works in the demo, for the athlete and for the demo coach on the same device.
 */

export type MediaUploadInput = {
  /** Also the file name and the record id, so sending the same upload twice never makes two. */
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
  blob: Blob
}

export type MediaUploadOptions = { onProgress?: (fraction: number) => void; signal?: AbortSignal }

/** `refused` on an error: the backend said no, so sending the same thing again will not help. */
export type MediaUploadResult = { ok: true; data: SessionMediaItem } | { ok: false; error: { message: string; refused: boolean; cancelled?: boolean } }

const COLUMNS =
  "id, tenant_id, athlete_id, session_id, session_block_row_id, kind, storage_path, content_type, bytes, duration_seconds, width, height, caption, coach_comment, coach_comment_at, created_by_user_id, created_at"

type MediaRow = {
  id: string
  tenant_id: string
  athlete_id: string
  session_id: string
  session_block_row_id: string | null
  kind: MediaKind
  storage_path: string
  content_type: string
  bytes: number
  duration_seconds: number | string | null
  width: number | null
  height: number | null
  caption: string | null
  coach_comment: string | null
  coach_comment_at: string | null
  created_by_user_id: string | null
  created_at: string
}

function isMock() {
  return getBackendMode() !== "supabase"
}

function offline() {
  return typeof navigator !== "undefined" && navigator.onLine === false
}

/* ---------- Mock ----------------------------------------------------------------------------------- */

type MockRecord = Omit<SessionMediaItem, "url"> & { athleteId: string }

const MOCK_KEY = "pacelab:session-media:v1"
const mockUrls = new Map<string, string>()
/** Files of a browser that cannot keep them (no IndexedDB): they last until the page closes. */
const mockMemory = new Map<string, Blob>()

function readMock(): MockRecord[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(MOCK_KEY)) ?? "[]") as MockRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeMock(records: MockRecord[]): boolean {
  try {
    window.localStorage.setItem(tenantStorageKey(MOCK_KEY), JSON.stringify(records))
    return true
  } catch {
    return false
  }
}

async function mockUrl(id: string): Promise<string | null> {
  const known = mockUrls.get(id)
  if (known) return known
  const blob = mockMemory.get(id) ?? (await readFile(`mock:${id}`))
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  mockUrls.set(id, url)
  return url
}

async function mockItems(records: MockRecord[]): Promise<SessionMediaItem[]> {
  return Promise.all(
    records.map(async (record) => {
      const item: SessionMediaItem & { athleteId?: string } = { ...record, url: await mockUrl(record.id) }
      delete item.athleteId
      return item
    }),
  )
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) return resolve(false)
    const timer = window.setTimeout(() => resolve(true), ms)
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer)
      resolve(false)
    })
  })
}

async function sendMock(input: MediaUploadInput, options: MediaUploadOptions): Promise<MediaUploadResult> {
  if (offline()) return { ok: false, error: { message: "You are offline.", refused: false } }
  const athleteId = input.athleteId ?? MOCK_ATHLETE_ID
  const all = readMock()
  const already = all.find((record) => record.id === input.id)
  if (already) return { ok: true, data: (await mockItems([already]))[0] }
  const room = checkRoom({
    sessionCount: all.filter((record) => record.athleteId === athleteId && record.sessionId === input.sessionId).length,
    athleteCount: all.filter((record) => record.athleteId === athleteId).length,
  })
  if (!room.ok) return { ok: false, error: { message: room.message, refused: true } }

  // The demo has no network to wait for, so the progress is paced to be seen.
  for (const fraction of [0.2, 0.5, 0.8, 1]) {
    if (!(await wait(90, options.signal))) return { ok: false, error: { message: "Cancelled.", refused: true, cancelled: true } }
    if (offline()) return { ok: false, error: { message: "You are offline.", refused: false } }
    options.onProgress?.(fraction)
  }

  if (!(await keepFile(`mock:${input.id}`, input.blob))) mockMemory.set(input.id, input.blob)
  const record: MockRecord = {
    id: input.id,
    athleteId,
    sessionId: input.sessionId,
    rowId: input.rowId,
    kind: input.kind,
    path: `mock/${athleteId}/${input.sessionId}/${input.id}`,
    contentType: input.contentType,
    bytes: input.bytes,
    durationSeconds: input.durationSeconds,
    width: input.width,
    height: input.height,
    caption: input.caption,
    coachComment: null,
    coachCommentAt: null,
    createdAt: new Date().toISOString(),
    addedByStaff: input.athleteId !== null,
  }
  if (!writeMock([...readMock(), record])) return { ok: false, error: { message: "Could not save in this browser. Storage may be full or blocked.", refused: true } }
  return { ok: true, data: (await mockItems([record]))[0] }
}

/* ---------- Supabase ------------------------------------------------------------------------------- */

function toItem(row: MediaRow, url: string | null, athleteUserId: string | null | undefined): SessionMediaItem {
  return {
    id: row.id,
    sessionId: row.session_id,
    rowId: row.session_block_row_id,
    kind: row.kind,
    path: row.storage_path,
    contentType: row.content_type,
    bytes: Number(row.bytes),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    width: row.width,
    height: row.height,
    caption: row.caption,
    coachComment: row.coach_comment,
    coachCommentAt: row.coach_comment_at,
    createdAt: row.created_at,
    // Unknown uploader (their account was deleted) is not claimed to be staff.
    addedByStaff: athleteUserId === undefined ? false : row.created_by_user_id !== null && row.created_by_user_id !== athleteUserId,
    url,
  }
}

async function signedLinks(client: SupabaseClient, paths: string[], seconds: number): Promise<Map<string, string>> {
  const links = new Map<string, string>()
  if (paths.length === 0) return links
  try {
    const { data } = await client.storage.from(MEDIA_BUCKET).createSignedUrls(paths, seconds)
    for (const entry of data ?? []) if (entry.path && entry.signedUrl && !entry.error) links.set(entry.path, entry.signedUrl)
  } catch {
    // The rows still show, without a picture, and the next load tries again.
  }
  return links
}

async function withLinks(client: SupabaseClient, rows: MediaRow[]): Promise<SessionMediaItem[]> {
  const links = await signedLinks(
    client,
    rows.map((row) => row.storage_path),
    VIEW_LINK_SECONDS,
  )
  // Who the athlete is, to tell "added by a coach" apart. One read, and only when there is something to show.
  const athleteIds = [...new Set(rows.map((row) => row.athlete_id))]
  const users = new Map<string, string | null>()
  if (athleteIds.length > 0) {
    const { data } = await client.from("athletes").select("id, user_id").in("id", athleteIds)
    for (const athlete of (data as Array<{ id: string; user_id: string | null }> | null) ?? []) users.set(athlete.id, athlete.user_id)
  }
  return rows.map((row) => toItem(row, links.get(row.storage_path) ?? null, users.has(row.athlete_id) ? users.get(row.athlete_id) : undefined))
}

type Owner = { tenantId: string; athleteId: string }
let cachedSelf: (Owner & { userId: string }) | null = null

/** Whose folder the file goes in: the signed-in athlete's, or the athlete a coach is logging for. */
async function ownerOf(client: SupabaseClient, athleteId: string | null): Promise<Result<Owner>> {
  const { data: auth } = await client.auth.getSession()
  const userId = auth.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "You are signed out. Sign in again to add photos and videos.")
  if (athleteId === null && cachedSelf?.userId === userId) return ok(cachedSelf)
  const query = client.from("athletes").select("id, tenant_id")
  const { data, error } = await (athleteId === null ? query.eq("user_id", userId) : query.eq("id", athleteId)).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return err("NOT_FOUND", "Athlete not found.")
  const owner = { tenantId: data.tenant_id as string, athleteId: data.id as string }
  if (athleteId === null) cachedSelf = { ...owner, userId }
  return ok(owner)
}

/** Sends the file with a progress count and a way to stop it. The storage library offers neither. */
function putFile(url: string, headers: Record<string, string>, blob: Blob, options: MediaUploadOptions): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest()
    request.open("POST", url)
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value)
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) options.onProgress?.(event.loaded / event.total)
    }
    request.onload = () => resolve({ status: request.status, body: request.responseText })
    request.onerror = () => resolve({ status: 0, body: "" })
    request.ontimeout = () => resolve({ status: 0, body: "" })
    request.onabort = () => resolve({ status: -1, body: "" })
    options.signal?.addEventListener("abort", () => request.abort())
    if (options.signal?.aborted) {
      resolve({ status: -1, body: "" })
      return
    }
    request.send(blob)
  })
}

async function sendSupabase(input: MediaUploadInput, options: MediaUploadOptions): Promise<MediaUploadResult> {
  const client = getBrowserSupabaseClient()
  const config = getSupabasePublicConfig()
  if (!client || !config) return { ok: false, error: { message: "Photos and videos are not set up on this site.", refused: true } }
  if (offline()) return { ok: false, error: { message: "You are offline.", refused: false } }

  try {
    const owner = await ownerOf(client, input.athleteId)
    if (!owner.ok) return { ok: false, error: { message: owner.error.message, refused: owner.error.code !== "UNKNOWN" } }
    const path = buildMediaPath({ ...owner.data, sessionId: input.sessionId, fileId: input.id, contentType: input.contentType })
    if (!path) return { ok: false, error: { message: "That kind of file cannot be added.", refused: true } }

    const { data: auth } = await client.auth.getSession()
    const token = auth.session?.access_token
    if (!token) return { ok: false, error: { message: "You are signed out. Sign in again to add photos and videos.", refused: true } }

    const sent = await putFile(
      `${config.url.replace(/\/$/, "")}/storage/v1/object/${MEDIA_BUCKET}/${path}`,
      { Authorization: `Bearer ${token}`, apikey: config.anonKey, "Content-Type": input.contentType, "x-upsert": "false", "cache-control": "max-age=3600" },
      input.blob,
      options,
    )
    if (sent.status === -1) return { ok: false, error: { message: "Cancelled.", refused: true, cancelled: true } }
    // "Duplicate": an earlier try got the file up and lost the answer. Carry on to the record.
    const duplicate = sent.status === 409 || /duplicate|already exists/i.test(sent.body)
    if (!(sent.status >= 200 && sent.status < 300) && !duplicate) {
      if (sent.status === 0 || sent.status >= 500 || sent.status === 408 || sent.status === 429) return { ok: false, error: { message: "The connection dropped.", refused: false } }
      if (sent.status === 413) return { ok: false, error: { message: "That file is too large to upload. The most is 50 MB.", refused: true } }
      if (sent.status === 401) return { ok: false, error: { message: "Your sign-in has ended. Sign in again, then try again.", refused: true } }
      return { ok: false, error: { message: "The upload was not accepted. You may no longer have access to this session.", refused: true } }
    }

    const { data, error } = await client
      .from("session_media")
      .insert({
        id: input.id,
        tenant_id: owner.data.tenantId,
        athlete_id: owner.data.athleteId,
        session_id: input.sessionId,
        session_block_row_id: input.rowId,
        kind: input.kind,
        storage_path: path,
        content_type: input.contentType,
        bytes: input.bytes,
        duration_seconds: input.durationSeconds === null ? null : Math.round(input.durationSeconds * 100) / 100,
        width: input.width,
        height: input.height,
        caption: input.caption?.slice(0, CAPTION_MAX_LENGTH) || null,
      })
      .select(COLUMNS)
      .single()

    if (error) {
      // The record is already there (an earlier try saved it and lost the answer).
      if (error.code === "23505") {
        const existing = await client.from("session_media").select(COLUMNS).eq("id", input.id).maybeSingle()
        if (existing.data) return { ok: true, data: (await withLinks(client, [existing.data as MediaRow]))[0] }
      }
      const refused = Boolean(error.code) && error.code !== "PGRST301" && !/fetch|network/i.test(error.message ?? "")
      if (refused) {
        // Nothing names the file now, so it goes. (A daily job removes it if this does not get through.)
        await client.storage.from(MEDIA_BUCKET).remove([path]).catch(() => undefined)
        const plain = error.code === "P0001" ? error.message : mapPostgrestError(error).message
        return { ok: false, error: { message: plain, refused: true } }
      }
      return { ok: false, error: { message: "The connection dropped.", refused: false } }
    }
    return { ok: true, data: (await withLinks(client, [data as MediaRow]))[0] }
  } catch {
    return { ok: false, error: { message: "The connection dropped.", refused: false } }
  }
}

/* ---------- Public --------------------------------------------------------------------------------- */

export async function sendSessionMedia(input: MediaUploadInput, options: MediaUploadOptions = {}): Promise<MediaUploadResult> {
  return isMock() ? sendMock(input, options) : sendSupabase(input, options)
}

/** The photos and videos of one session, oldest first. `athleteId` is set when a coach is looking. */
export async function listSessionMedia(sessionId: string, athleteId: string | null = null): Promise<Result<SessionMediaItem[]>> {
  if (isMock()) {
    const owner = athleteId ?? MOCK_ATHLETE_ID
    return ok(await mockItems(readMock().filter((record) => record.athleteId === owner && record.sessionId === sessionId)))
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const { data, error } = await client.from("session_media").select(COLUMNS).eq("session_id", sessionId).order("created_at", { ascending: true })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(await withLinks(client, (data as MediaRow[] | null) ?? []))
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** Everything one athlete attached to the given sessions, for the coach's list of logged sessions. */
export async function listAthleteSessionMedia(athleteId: string, sessionIds: string[]): Promise<Result<SessionMediaItem[]>> {
  if (sessionIds.length === 0) return ok([])
  if (isMock()) {
    const wanted = new Set(sessionIds)
    return ok(await mockItems(readMock().filter((record) => record.athleteId === athleteId && wanted.has(record.sessionId))))
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const { data, error } = await client
      .from("session_media")
      .select(COLUMNS)
      .eq("athlete_id", athleteId)
      .in("session_id", sessionIds.slice(0, 200))
      .order("created_at", { ascending: true })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(await withLinks(client, (data as MediaRow[] | null) ?? []))
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** How many items the athlete has in all, for the 200 limit. Null when it could not be counted (the database still checks). */
export async function countAthleteMedia(athleteId: string | null): Promise<number | null> {
  if (isMock()) {
    const owner = athleteId ?? MOCK_ATHLETE_ID
    return readMock().filter((record) => record.athleteId === owner).length
  }
  const client = getBrowserSupabaseClient()
  if (!client) return null
  try {
    const owner = await ownerOf(client, athleteId)
    if (!owner.ok) return null
    const { count, error } = await client.from("session_media").select("id", { count: "exact", head: true }).eq("athlete_id", owner.data.athleteId)
    return error ? null : (count ?? null)
  } catch {
    return null
  }
}

export async function saveMediaCaption(id: string, caption: string): Promise<Result<{ caption: string | null }>> {
  const clean = caption.trim().slice(0, CAPTION_MAX_LENGTH) || null
  if (isMock()) {
    const all = readMock()
    if (!all.some((record) => record.id === id)) return err("NOT_FOUND", "That item is no longer there.")
    if (!writeMock(all.map((record) => (record.id === id ? { ...record, caption: clean } : record)))) return err("UNKNOWN", "Could not save in this browser.")
    return ok({ caption: clean })
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const { data, error } = await client.from("session_media").update({ caption: clean }).eq("id", id).select("id").maybeSingle()
    if (error) return { ok: false, error: mapPostgrestError(error) }
    if (!data) return err("FORBIDDEN", "You cannot change this caption.")
    return ok({ caption: clean })
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** The coach's short comment on one item. Empty removes it. The athlete is told (existing session note notification). */
export async function saveMediaComment(id: string, comment: string): Promise<Result<{ coachComment: string | null; coachCommentAt: string | null }>> {
  const clean = comment.trim().slice(0, COMMENT_MAX_LENGTH) || null
  if (isMock()) {
    const all = readMock()
    if (!all.some((record) => record.id === id)) return err("NOT_FOUND", "That item is no longer there.")
    const at = clean ? new Date().toISOString() : null
    if (!writeMock(all.map((record) => (record.id === id ? { ...record, coachComment: clean, coachCommentAt: at } : record)))) return err("UNKNOWN", "Could not save in this browser.")
    return ok({ coachComment: clean, coachCommentAt: at })
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const { data, error } = await client.rpc("set_session_media_comment", { p_media_id: id, p_comment: clean ?? "" })
    if (error) return { ok: false, error: error.code === "P0001" ? { code: "VALIDATION", message: error.message, cause: error } : mapPostgrestError(error) }
    const saved = (data ?? {}) as { coach_comment?: string | null; coach_comment_at?: string | null }
    return ok({ coachComment: saved.coach_comment ?? null, coachCommentAt: saved.coach_comment_at ?? null })
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** Removes the item and its file. */
export async function removeSessionMedia(item: Pick<SessionMediaItem, "id" | "path">): Promise<Result<null>> {
  if (isMock()) {
    if (!writeMock(readMock().filter((record) => record.id !== item.id))) return err("UNKNOWN", "Could not save in this browser.")
    const url = mockUrls.get(item.id)
    if (url) URL.revokeObjectURL(url)
    mockUrls.delete(item.id)
    mockMemory.delete(item.id)
    await dropFile(`mock:${item.id}`)
    return ok(null)
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    // The file first. If only the record went, the database queues the file for removal anyway.
    await client.storage.from(MEDIA_BUCKET).remove([item.path]).catch(() => undefined)
    const { data, error } = await client.from("session_media").delete().eq("id", item.id).select("id")
    if (error) return { ok: false, error: mapPostgrestError(error) }
    if (((data as unknown[] | null) ?? []).length === 0) return err("FORBIDDEN", "You cannot remove this.")
    return ok(null)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/**
 * For "download my data": each record with a link to its file that works for an hour. The files
 * themselves are not put inside the export (a few videos would make it hundreds of megabytes).
 */
export async function addMediaExportLinks(client: SupabaseClient, rows: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const paths = rows.map((row) => String(row.storage_path ?? "")).filter(Boolean)
  const links = await signedLinks(client, paths, EXPORT_LINK_SECONDS)
  const expires = new Date(Date.now() + EXPORT_LINK_SECONDS * 1000).toISOString()
  return rows.map((row) => {
    const link = links.get(String(row.storage_path ?? "")) ?? null
    return { ...row, download_link: link, download_link_works_until: link ? expires : null }
  })
}
