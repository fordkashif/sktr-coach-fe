import { addRecent, parseRecent } from "@/lib/search/model"

/**
 * Recent searches. They stay on this device and never go to the server. Storage can be blocked
 * or full (a private window), so every read and write is wrapped and search works without it.
 */
const KEY = "sktr:recent-searches"

/** One list per account on the device, so a shared phone does not show another person's searches. */
function keyFor(owner: string | null | undefined) {
  return `${KEY}:${(owner ?? "").trim().toLowerCase() || "me"}`
}

export function readRecentSearches(owner: string | null | undefined): string[] {
  try {
    return parseRecent(window.localStorage.getItem(keyFor(owner)))
  } catch {
    return []
  }
}

export function rememberSearch(owner: string | null | undefined, query: string): string[] {
  const next = addRecent(readRecentSearches(owner), query)
  try {
    window.localStorage.setItem(keyFor(owner), JSON.stringify(next))
  } catch {
    /* not stored: the list just starts empty next time */
  }
  return next
}

export function clearRecentSearches(owner: string | null | undefined) {
  try {
    window.localStorage.removeItem(keyFor(owner))
  } catch {
    /* nothing to clear */
  }
}
