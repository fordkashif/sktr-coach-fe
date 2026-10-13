/**
 * On-phone timing: what each screen waited for, measured on the person's own phone, network and
 * database. Off unless switched on with a link (?timing=1, off again with ?timing=0), and then it
 * only keeps the last few screens in memory. Nothing is sent anywhere.
 *
 * Records every database call (and whether it went to the server or was answered from the app's
 * kept reads), every code file downloaded, and when the person moved to a new screen.
 */

const STORAGE_KEY = "sktr:timing"

export type TimingCall = {
  label: string
  /** ms since the screen was opened */
  start: number
  /** ms the call took */
  duration: number
  /**
   * "server": went over the network. "kept": answered from the app's kept reads. "bundle": answered
   * from the start-up bundle. "code": a code file.
   */
  source: "server" | "kept" | "bundle" | "code"
  status?: number
}

export type TimingScreen = {
  path: string
  openedAt: number
  calls: TimingCall[]
}

const MAX_SCREENS = 6
let enabledCache: boolean | null = null
const screens: TimingScreen[] = []
const listeners = new Set<() => void>()
const pendingByInit = new WeakMap<object, { server: boolean; bundle?: boolean }>()

function readEnabled(): boolean {
  if (typeof window === "undefined") return false
  try {
    const flag = new URLSearchParams(window.location.search).get("timing")
    if (flag === "1") window.localStorage.setItem(STORAGE_KEY, "1")
    if (flag === "0") window.localStorage.removeItem(STORAGE_KEY)
    return window.localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function timingEnabled(): boolean {
  if (enabledCache === null) enabledCache = readEnabled()
  return enabledCache
}

export function turnTimingOff() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do.
  }
  enabledCache = false
  notify()
}

function notify() {
  listeners.forEach((listener) => listener())
}

export function subscribeTiming(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function timingScreens(): TimingScreen[] {
  return screens
}

function current(): TimingScreen {
  if (screens.length === 0) screens.push({ path: typeof window === "undefined" ? "/" : window.location.pathname, openedAt: 0, calls: [] })
  return screens[screens.length - 1]
}

/** The person moved to another screen: start a new list. */
export function markScreen(path: string) {
  if (!timingEnabled()) return
  const last = screens[screens.length - 1]
  if (last && last.path === path) return
  screens.push({ path, openedAt: performance.now(), calls: [] })
  while (screens.length > MAX_SCREENS) screens.shift()
  // No notify here: this runs while the app frame renders. The first call on the screen updates the view.
}

function add(call: Omit<TimingCall, "start"> & { at: number }) {
  const screen = current()
  screen.calls.push({ label: call.label, start: Math.round(call.at - screen.openedAt), duration: Math.round(call.duration), source: call.source, status: call.status })
  notify()
}

function shortLabel(input: RequestInfo | URL, init?: RequestInit): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  try {
    const url = new URL(raw)
    const method = (init?.method ?? "GET").toUpperCase()
    let path = url.pathname.replace(/^\/rest\/v1\//, "").replace(/^\/auth\/v1\//, "auth/").replace(/^\/functions\/v1\//, "fn/")
    const select = url.searchParams.get("select")
    if (select) path += ` (${select.length > 40 ? `${select.slice(0, 40)}...` : select})`
    return `${method === "GET" ? "" : `${method} `}${path}`
  } catch {
    return raw.slice(0, 80)
  }
}

/** Wraps the app's database fetch: measures each call as the screen sees it. */
export function timedFetch(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (!timingEnabled()) return inner(input, init)
    const at = performance.now()
    const key = init ?? {}
    const marker: { server: boolean; bundle?: boolean } = { server: false }
    pendingByInit.set(key, marker)
    const passInit = init ?? (key as RequestInit)
    try {
      const response = await inner(input, passInit)
      add({ label: shortLabel(input, init), at, duration: performance.now() - at, source: marker.server ? "server" : marker.bundle ? "bundle" : "kept", status: response.status })
      return response
    } catch (error) {
      add({ label: `${shortLabel(input, init)} (failed)`, at, duration: performance.now() - at, source: "server" })
      throw error
    }
  }
}

/** Wraps the network fetch under the kept reads: marks the call as one that went to the server. */
export function markServerFetch(inner: typeof fetch): typeof fetch {
  return (input, init) => {
    if (init) {
      const marker = pendingByInit.get(init)
      if (marker) marker.server = true
    }
    return inner(input, init)
  }
}

/** A request answered from the start-up bundle (called by the shared reads layer). */
export function markBundleAnswer(init: RequestInit | undefined) {
  if (!init) return
  const marker = pendingByInit.get(init)
  if (marker) marker.bundle = true
}

/** The start-up bundle request itself. */
export function noteBundleFetch(startedAt: number, status: number) {
  if (!timingEnabled()) return
  add({ label: "POST rpc/get_app_start (start-up bundle)", at: startedAt, duration: performance.now() - startedAt, source: "server", status })
}

let observing = false
/** Code files downloaded (screens load their code the first time they open). */
export function watchCodeDownloads() {
  if (observing || !timingEnabled() || typeof PerformanceObserver === "undefined") return
  observing = true
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.name.includes("/assets/")) continue
        const resource = entry as PerformanceResourceTiming
        // Served from the phone's cache: no wait worth showing.
        if (resource.transferSize === 0 && resource.duration < 5) continue
        add({ label: `code ${entry.name.split("/").pop()}`, at: entry.startTime, duration: entry.duration, source: "code" })
      }
    }).observe({ type: "resource", buffered: true })
  } catch {
    // Older browsers: database calls are still recorded.
  }
}

/** Plain text of what is recorded, to paste into a message. */
export function timingText(): string {
  return screens
    .map((screen) => {
      const end = screen.calls.reduce((max, call) => Math.max(max, call.start + call.duration), 0)
      const server = screen.calls.filter((call) => call.source === "server").length
      const lines = screen.calls.map((call) => `  +${call.start}ms ${call.duration}ms ${call.source}${call.status && call.status >= 400 ? ` ${call.status}` : ""} ${call.label}`)
      return [`${screen.path}: last answer after ${end} ms, ${server} server calls, ${screen.calls.length} in all`, ...lines].join("\n")
    })
    .join("\n\n")
}
