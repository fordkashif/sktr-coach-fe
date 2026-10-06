// Two people editing the same thing: pure logic, no DOM and no network.
// A record is saved with the updated_at it was loaded with. When the stored value has moved on,
// someone else saved in between, and the app asks instead of overwriting their work.
import type { DataError } from "@/lib/data/result"

export type EditKind = "plan" | "test-week" | "team" | "club-profile"

/** What the editor remembers from the moment the record was opened. */
export type EditStamp = {
  /** Null when the record has never been changed (demo data) or does not exist yet. */
  updatedAt: string | null
  changedByName: string | null
  changedBySelf: boolean
}

export type EditConflict = {
  kind: EditKind
  changedAt: string | null
  /** Null when it was the server, or the name cannot be read. */
  changedByName: string | null
  /** The same account on another device or tab. */
  changedBySelf: boolean
}

const NOUNS: Record<EditKind, string> = { plan: "plan", "test-week": "test week", team: "team", "club-profile": "club profile" }

export function editKindNoun(kind: EditKind): string {
  return NOUNS[kind]
}

function instant(value: string | null | undefined): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

/**
 * True when the stored record is not the one the editor loaded.
 * `expected` undefined means the editor is not tracking this record (a new one, or an older
 * caller): never stale. Null means "loaded, and it had never been changed".
 * Compared as instants, so "+00:00" and "Z" spellings of one moment are equal.
 */
export function isStaleWrite(expected: string | null | undefined, current: string | null | undefined): boolean {
  if (expected === undefined) return false
  const want = instant(expected)
  const have = instant(current)
  if (want === null && have === null) return false
  return want !== have
}

/** "just now", "2 minutes ago", "1 hour ago", "3 days ago", then the date. Empty when the time is not known. */
export function agoText(changedAt: string | null | undefined, now: Date = new Date()): string {
  const time = instant(changedAt)
  if (time === null) return ""
  const seconds = Math.max(0, Math.round((now.getTime() - time) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`
  return `on ${new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
}

/** "Andre changed this plan 2 minutes ago." */
export function conflictSentence(conflict: EditConflict, now: Date = new Date()): string {
  const noun = editKindNoun(conflict.kind)
  const ago = agoText(conflict.changedAt, now)
  const when = ago ? ` ${ago}` : " since you opened it"
  const name = conflict.changedByName?.trim()
  if (conflict.changedBySelf) return `You changed this ${noun}${when}, on another device or tab.`
  if (name) return `${name} changed this ${noun}${when}.`
  return `This ${noun} was changed${when}.`
}

/** The error a save returns when it would overwrite someone else's change. */
export function editConflictError(conflict: EditConflict): DataError {
  return { code: "CONFLICT", message: `${conflictSentence(conflict)} Your changes were not saved over it.`, cause: { editConflict: conflict } }
}

/** The conflict carried by a failed save, or null when it failed for another reason. */
export function readEditConflict(error: DataError | null | undefined): EditConflict | null {
  if (!error || error.code !== "CONFLICT") return null
  const cause = error.cause as { editConflict?: EditConflict } | null | undefined
  const conflict = cause && typeof cause === "object" ? cause.editConflict : null
  return conflict && typeof conflict === "object" && typeof conflict.kind === "string" ? conflict : null
}
