import { mockCurrentSession, type SessionBlock } from "@/lib/mock-data"

export const SESSION_PROGRESS_STORAGE_KEY = "pacelab:athlete-session-progress"
export const SESSION_COMPLETIONS_STORAGE_KEY = "pacelab:athlete-session-completions"

export type SessionProgress = {
  sessionId: string
  currentBlockIndex: number
  completedBlockIds: string[]
  values: Record<string, string>
  blockNotes: Record<string, string>
}

export function defaultSessionProgress(options?: { sessionId?: string }): SessionProgress {
  return {
    sessionId: options?.sessionId ?? mockCurrentSession.id,
    currentBlockIndex: 0,
    completedBlockIds: [],
    values: {},
    blockNotes: {},
  }
}

export function progressForCurrentSession(
  raw: string | null,
  options?: { sessionId?: string; blockCount?: number },
): SessionProgress {
  const sessionId = options?.sessionId ?? mockCurrentSession.id
  const blockCount = Math.max(options?.blockCount ?? mockCurrentSession.blocks.length, 1)
  if (!raw) return defaultSessionProgress({ sessionId })
  try {
    const parsed = JSON.parse(raw) as SessionProgress
    if (parsed.sessionId !== sessionId) return defaultSessionProgress({ sessionId })
    return {
      sessionId: parsed.sessionId,
      currentBlockIndex: Math.min(Math.max(parsed.currentBlockIndex ?? 0, 0), Math.max(blockCount - 1, 0)),
      completedBlockIds: parsed.completedBlockIds ?? [],
      values: parsed.values ?? {},
      blockNotes: parsed.blockNotes ?? {},
    }
  } catch {
    return defaultSessionProgress({ sessionId })
  }
}

export function sessionRowKey(blockId: string, rowIndex: number, field: string) {
  return `${blockId}:${rowIndex}:${field}`
}

export function blockHasInputs(progress: SessionProgress, block: SessionBlock) {
  return block.rows.some((_, rowIndex) =>
    ["primary", "secondary", "effort"].some((field) => Boolean(progress.values[sessionRowKey(block.id, rowIndex, field)]?.trim())),
  )
}

export function blockStatus(progress: SessionProgress, block: SessionBlock) {
  if (progress.completedBlockIds.includes(block.id)) return "completed"
  if (blockHasInputs(progress, block)) return "in-progress"
  return "up-next"
}

export function dateKeyLocal(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function parseSessionCompletions(raw: string | null) {
  if (!raw) return [] as string[]

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [] as string[]

    return parsed
      .filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort()
  } catch {
    return [] as string[]
  }
}
