import { useCallback, useSyncExternalStore } from "react"

/**
 * Putting SKTR Coach on the Home Screen.
 *
 * The first half of this file is plain logic with no browser in it (which platform this is, whether
 * to offer the install now, what a "Not now" does), unit tested in tests/install-prompt.test.ts.
 * The second half is the browser glue: it keeps the browser's own install event, remembers the
 * person's answer on this device and gives screens one hook, useInstallOffer().
 *
 * Imported from src/main.tsx so the listener for "beforeinstallprompt" is in place before the
 * browser fires it (it fires once, early, and is lost if nobody is listening).
 */

// Pure logic ---------------------------------------------------------------------------------------

export type InstallPlatform = "ios-safari" | "ios-other" | "android" | "desktop" | "unknown"

export type InstallState = {
  /** How many times the person said "Not now" on this device. */
  dismissals: number
  /** When they last said it (milliseconds), or null. */
  lastDismissedAt: number | null
  /** The app was installed from this browser. */
  installed: boolean
}

export const EMPTY_INSTALL_STATE: InstallState = { dismissals: 0, lastDismissedAt: null, installed: false }

const DAY_MS = 24 * 60 * 60 * 1000
export const SNOOZE_DAYS = 14
export const LONG_SNOOZE_DAYS = 90
export const DISMISSALS_BEFORE_LONG_SNOOZE = 3

// Browsers on iPhone other than Safari, and apps that open links in their own window.
const IOS_OTHER_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|GSA\/|YaBrowser|Brave/i
const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|MicroMessenger|musical_ly|TikTok|Bytedance|Snapchat|LinkedInApp|Twitter|Pinterest|Barcelona/i

export function detectInstallPlatform(userAgent: string, touchPoints = 0): InstallPlatform {
  const ua = userAgent || ""
  if (!ua) return "unknown"
  // An iPad says it is a Mac; a Mac has no touch screen.
  const ios = /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)
  if (ios) {
    if (IOS_OTHER_BROWSER.test(ua) || IN_APP_BROWSER.test(ua)) return "ios-other"
    // Safari itself always says "Version/x ... Safari/y". A window inside another app does not.
    return /Version\/[\d.]+.*Safari\//.test(ua) ? "ios-safari" : "ios-other"
  }
  if (/Android/i.test(ua)) return "android"
  return "desktop"
}

/** Can this device be offered the app at all? On a computer only when the browser offers one tap. */
export function platformCanInstall(platform: InstallPlatform, canPrompt: boolean): boolean {
  if (canPrompt) return true
  return platform === "ios-safari" || platform === "ios-other" || platform === "android"
}

/** How long a "Not now" keeps the banner away, given how many times it has been said. */
export function snoozeDays(dismissals: number): number {
  return dismissals >= DISMISSALS_BEFORE_LONG_SNOOZE ? LONG_SNOOZE_DAYS : SNOOZE_DAYS
}

/** Should the banner be shown now, going only by what the person answered before? */
export function shouldOfferInstall(state: InstallState, now: number): boolean {
  if (state.installed) return false
  if (state.lastDismissedAt === null || state.dismissals <= 0) return true
  // A clock that went backwards must not hide the banner for ever.
  if (state.lastDismissedAt > now) return true
  return now - state.lastDismissedAt >= snoozeDays(state.dismissals) * DAY_MS
}

export function dismissInstall(state: InstallState, now: number): InstallState {
  return { ...state, dismissals: state.dismissals + 1, lastDismissedAt: now }
}

export function markInstalled(state: InstallState): InstallState {
  return { ...state, installed: true }
}

/** Reads what was stored. Anything odd counts as "never asked". */
export function parseInstallState(raw: string | null | undefined): InstallState {
  if (!raw) return EMPTY_INSTALL_STATE
  try {
    const value = JSON.parse(raw) as Partial<InstallState> | null
    if (!value || typeof value !== "object") return EMPTY_INSTALL_STATE
    const dismissals = typeof value.dismissals === "number" && Number.isFinite(value.dismissals) && value.dismissals > 0 ? Math.floor(value.dismissals) : 0
    const lastDismissedAt = typeof value.lastDismissedAt === "number" && Number.isFinite(value.lastDismissedAt) ? value.lastDismissedAt : null
    return { dismissals, lastDismissedAt, installed: value.installed === true }
  } catch {
    return EMPTY_INSTALL_STATE
  }
}

// Browser glue -------------------------------------------------------------------------------------

export const INSTALL_STORAGE_KEY = "sktr:install-prompt"

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<unknown>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable"

const hasWindow = typeof window !== "undefined"

let deferredPrompt: BeforeInstallPromptEvent | null = null
let state: InstallState = EMPTY_INSTALL_STATE
let version = 0
const listeners = new Set<() => void>()
const installedListeners = new Set<() => void>()

function readState(): InstallState {
  try {
    return parseInstallState(window.localStorage.getItem(INSTALL_STORAGE_KEY))
  } catch {
    return EMPTY_INSTALL_STATE
  }
}

function writeState(next: InstallState) {
  state = next
  try {
    window.localStorage.setItem(INSTALL_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Private windows and full storage: the answer then lasts until the page is closed.
  }
  changed()
}

function changed() {
  version += 1
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function handleInstalled() {
  deferredPrompt = null
  if (state.installed) {
    changed()
    return
  }
  writeState(markInstalled(state))
  installedListeners.forEach((listener) => listener())
}

/** Runs once each time the app is installed from this page (for the "installed" message). */
export function onAppInstalled(listener: () => void) {
  installedListeners.add(listener)
  return () => {
    installedListeners.delete(listener)
  }
}

const STANDALONE_QUERIES = ["(display-mode: standalone)", "(display-mode: fullscreen)", "(display-mode: minimal-ui)"]

/** True when this window is the installed app and not a browser tab. */
export function isStandalone(): boolean {
  if (!hasWindow) return false
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true
    return typeof window.matchMedia === "function" && STANDALONE_QUERIES.some((query) => window.matchMedia(query).matches)
  } catch {
    return false
  }
}

export function currentInstallPlatform(): InstallPlatform {
  if (!hasWindow) return "unknown"
  return detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints)
}

/** True when the browser handed us its one tap install. */
export function canPromptInstall(): boolean {
  return deferredPrompt !== null
}

/** Opens the browser's own install question. The event can be used once. */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferredPrompt
  if (!event) return "unavailable"
  try {
    await event.prompt()
    const choice = await event.userChoice
    deferredPrompt = null
    if (choice?.outcome === "accepted") {
      // Browsers also send "appinstalled"; whichever comes first counts, the other does nothing.
      handleInstalled()
      return "accepted"
    }
    changed()
    return "dismissed"
  } catch {
    deferredPrompt = null
    changed()
    return "unavailable"
  }
}

/** "Not now": hides the banner for 14 days, and for 90 days from the third time. */
export function snoozeInstall() {
  writeState(dismissInstall(state, Date.now()))
}

if (hasWindow) {
  state = readState()
  window.addEventListener("beforeinstallprompt", (event) => {
    // Keeps the browser's small default bar away so the app can ask at a better moment.
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    // The browser only offers this when the app is not installed, so an earlier install was removed.
    if (state.installed) {
      writeState({ ...state, installed: false })
      return
    }
    changed()
  })
  window.addEventListener("appinstalled", handleInstalled)
  try {
    STANDALONE_QUERIES.forEach((query) => window.matchMedia(query).addEventListener?.("change", changed))
  } catch {
    // Old browsers: the next page load picks it up.
  }
}

export type InstallOffer = {
  /** Show the banner: not installed, this device can install, and not snoozed. */
  visible: boolean
  /** This device can install (ignores the snooze). For the entry in Your account and the sign-in tip. */
  available: boolean
  /** Already on this device: this window is the app, or it was installed from this browser. */
  installed: boolean
  platform: InstallPlatform
  /** One tap install is ready. */
  canPrompt: boolean
  /** The action is a list of steps to follow, not one tap. */
  showSteps: boolean
  install: () => Promise<InstallOutcome>
  snooze: () => void
}

const getVersion = () => version
const getServerVersion = () => 0

export function useInstallOffer(): InstallOffer {
  useSyncExternalStore(subscribe, getVersion, getServerVersion)
  const platform = currentInstallPlatform()
  const canPrompt = canPromptInstall()
  const standalone = isStandalone()
  const installed = standalone || (state.installed && !canPrompt)
  const available = !installed && platformCanInstall(platform, canPrompt)
  const visible = available && shouldOfferInstall(state, Date.now())
  const install = useCallback(() => promptInstall(), [])
  const snooze = useCallback(() => snoozeInstall(), [])
  return { visible, available, installed, platform, canPrompt, showSteps: !canPrompt, install, snooze }
}
