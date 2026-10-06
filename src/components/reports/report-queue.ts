/**
 * The drafts made by "Create reports for the team", kept for this visit so the coach can write
 * the summaries one after another. Only ids and names: the reports themselves are saved normally.
 */
export type ReportQueueItem = { athleteId: string; reportId: string; name: string }

const KEY = "pacelab:report-draft-queue:v1"

export function saveReportQueue(queue: ReportQueueItem[]) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(queue))
  } catch {
    // Without storage the drafts are still listed on each athlete's screen.
  }
}

export function loadReportQueue(): ReportQueueItem[] {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]") as unknown
    return Array.isArray(parsed) ? (parsed as ReportQueueItem[]).filter((item) => item && typeof item.reportId === "string" && typeof item.athleteId === "string") : []
  } catch {
    return []
  }
}

/** Where a report sits in the queue, and the draft after it. Null when it is not one of the drafts. */
export function reportQueuePosition(reportId: string): { index: number; total: number; next: ReportQueueItem | null } | null {
  const queue = loadReportQueue()
  const index = queue.findIndex((item) => item.reportId === reportId)
  if (index === -1) return null
  return { index, total: queue.length, next: queue[index + 1] ?? null }
}
