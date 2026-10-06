// The "Push on this device" section of notification settings, as a state machine. Pure: no
// imports, no DOM. The browser facts are read in push-client.ts and handed in here, so every state
// can be tested (tests/push-notifications.test.ts) and every state has one set of words.

export type PushPermission = "default" | "granted" | "denied"

export type PushEnvironment = {
  /** The app has a public push key (VITE_VAPID_PUBLIC_KEY). Without it nobody can subscribe. */
  configured: boolean
  /** A club admin or platform admin: told when push is not set up. Everyone else sees nothing. */
  isAdmin: boolean
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
  /** iPhone or iPad. There, push only exists inside the app added to the Home Screen. */
  isIos: boolean
  /** Opened from the Home Screen (or installed on a computer), not in a browser tab. */
  isStandalone: boolean
  permission: PushPermission
  /** This browser holds a push subscription and the server knows it. */
  subscribed: boolean
}

export type PushSectionKind = "hidden" | "not-set-up" | "ios-install" | "unsupported" | "blocked" | "off" | "on"

export function pushSectionKind(env: PushEnvironment): PushSectionKind {
  if (!env.configured) return env.isAdmin ? "not-set-up" : "hidden"
  // Safari in a tab on an iPhone has no push at all, whatever it reports: say what to do first.
  if (env.isIos && !env.isStandalone) return "ios-install"
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported"
  if (env.permission === "denied") return "blocked"
  if (env.permission === "granted" && env.subscribed) return "on"
  return "off"
}

export type PushSectionCopy = {
  kind: PushSectionKind
  /** The state in a few words, shown as a dot plus text. Null when there is nothing to show. */
  status: string | null
  tone: "green" | "coral" | "neutral"
  /** One or two plain sentences under the state. */
  detail: string | null
  /** Numbered steps (the iPhone case). */
  steps: string[]
  canTurnOn: boolean
  canTurnOff: boolean
  canTest: boolean
  /** Whether the per update push switches make sense to show. */
  showSwitches: boolean
}

export const PUSH_SECTION_HINT = "Get a notification on this phone or computer when something needs you, even when SKTR Coach is closed."

export function pushSectionCopy(env: PushEnvironment): PushSectionCopy {
  const kind = pushSectionKind(env)
  const base = { kind, steps: [] as string[], canTurnOn: false, canTurnOff: false, canTest: false, showSwitches: true }
  switch (kind) {
    case "hidden":
      return { ...base, status: null, tone: "neutral", detail: null, showSwitches: false }
    case "not-set-up":
      return { ...base, status: null, tone: "neutral", detail: "Push is not set up for this app yet.", showSwitches: false }
    case "ios-install":
      return {
        ...base,
        status: "Add SKTR Coach to your Home Screen first",
        tone: "neutral",
        detail: "On an iPhone or iPad, push only works in the app on your Home Screen (iOS 16.4 or later).",
        steps: ["In Safari, tap the Share button.", "Tap Add to Home Screen, open SKTR Coach from the new icon, then come back to this screen."],
      }
    case "unsupported":
      return {
        ...base,
        status: "Not supported on this browser",
        tone: "neutral",
        detail: "Push works in Chrome, Edge and Firefox, and on an iPhone once SKTR Coach is on the Home Screen. The bell in the app shows everything either way.",
      }
    case "blocked":
      return {
        ...base,
        status: "Blocked in your browser settings",
        tone: "coral",
        detail:
          "Notifications from SKTR Coach are blocked on this device. To unblock: tap the icon next to the address at the top of the browser, open site settings and set Notifications to Allow. In the installed app, open your phone's settings, then SKTR Coach, then Notifications. Then come back here.",
      }
    case "on":
      return { ...base, status: "On for this device", tone: "green", detail: null, canTurnOff: true, canTest: true }
    case "off":
      return {
        ...base,
        status: "Off on this device",
        tone: "neutral",
        detail: env.permission === "granted" ? null : "Your browser will ask if SKTR Coach may send notifications.",
        canTurnOn: true,
      }
  }
}

export type EnablePushFailure = "denied" | "dismissed" | "unsupported" | "browser-not-supported" | "not-installed" | "error"

/** What to say when turning push on did not work. */
export function enableFailureMessage(reason: EnablePushFailure): string {
  switch (reason) {
    case "denied":
      return "Notifications are blocked for SKTR Coach on this device. See below for how to unblock them."
    case "dismissed":
      return "Push was not turned on: the browser's question was closed without an answer. Tap Turn on push to try again."
    case "unsupported":
      return "This browser cannot receive push notifications."
    case "browser-not-supported":
      return "Push is not available for this browser yet. Try Chrome, Edge, Firefox or the app on your Home Screen."
    case "not-installed":
      return "Push could not start on this device. Reload SKTR Coach and try again."
    case "error":
      return "Push could not be turned on. Check your connection and try again."
  }
}

/**
 * "Chrome on Android", "Safari on iPhone", "Edge on Windows". Worked out in the browser so the
 * device list is readable; never used for anything else.
 */
export function deviceLabelFromUserAgent(userAgent: string, options: { standalone?: boolean; touchPoints?: number } = {}): string {
  const ua = userAgent || ""
  const isIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (options.touchPoints ?? 0) > 1)
  const system = /iPhone|iPod/.test(ua)
    ? "iPhone"
    : isIpad
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : ""
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : ""
  if (options.standalone && (system === "iPhone" || system === "iPad")) return `SKTR Coach app on ${system}`
  if (browser && system) return `${browser} on ${system}`
  return browser || system || "This device"
}

/** iPhone, iPod or iPad (an iPad says it is a Mac, but has a touch screen). */
export function isIosUserAgent(userAgent: string, touchPoints = 0): boolean {
  return /iPhone|iPod|iPad/.test(userAgent || "") || (/Macintosh/.test(userAgent || "") && touchPoints > 1)
}

/** "Just now", "5 minutes ago", "3 days ago", then the date. */
export function lastUsedLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "Never"
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return "Never"
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (minutes < 2) return "Just now"
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return days === 1 ? "Yesterday" : `${days} days ago`
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/** The public key as the bytes pushManager.subscribe() wants. Null when it is not a P-256 public key. */
export function vapidKeyBytes(publicKey: string | null | undefined): Uint8Array | null {
  const cleaned = (publicKey ?? "").trim().replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "")
  if (!cleaned || !/^[A-Za-z0-9+/]+$/.test(cleaned) || cleaned.length % 4 === 1) return null
  try {
    const binary = atob(cleaned + "=".repeat((4 - (cleaned.length % 4)) % 4))
    if (binary.length !== 65 || binary.charCodeAt(0) !== 4) return null
    const bytes = new Uint8Array(65)
    for (let index = 0; index < 65; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}
