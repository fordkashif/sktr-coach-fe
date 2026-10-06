import {
  listPushDeviceRows,
  registerPushDevice,
  removePushDeviceByEndpoint,
  removePushDeviceById,
  sendTestPushToDevice,
} from "@/lib/data/push-subscriptions-data"
import { getAppServiceWorkerRegistration } from "@/lib/pwa"
import {
  deviceLabelFromUserAgent,
  isIosUserAgent,
  vapidKeyBytes,
  type EnablePushFailure,
  type PushEnvironment,
  type PushPermission,
} from "@/lib/push/push-state"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Push notifications on this device: everything that touches the browser (permission, the
 * service worker's push subscription) plus the calls that keep the server's list of devices in
 * step. Screens use this file; the words and the states are in push-state.ts.
 *
 * Nothing here asks for permission on its own. The browser's question appears only inside
 * enablePushOnThisDevice(), which runs from a tap.
 *
 * Demo mode (no backend) keeps a pretend list of devices in localStorage and never creates a
 * real subscription, but it reads the real browser (Notification, PushManager), so every state
 * of the settings section can be seen and tested.
 */

export type PushDevice = {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string
  isThisDevice: boolean
}

export type PushSnapshot = {
  environment: PushEnvironment
  devices: PushDevice[]
  /** The devices could not be read (offline). The rest of the section still works. */
  devicesError: boolean
}

const isMockMode = () => getBackendMode() !== "supabase"

// Markers kept on this device so the app knows, without asking the server, that THIS browser was
// switched on by THIS account. They hold no secret.
const ENDPOINT_KEY = "sktr:push-endpoint"
const USER_KEY = "sktr:push-user"
const SYNCED_AT_KEY = "sktr:push-synced-at"
const MOCK_KEY = "sktr:mock-push"
/** Demo mode only, for tests: "off" makes the app behave as if no push key was configured. */
const MOCK_SETUP_KEY = "sktr:mock-push-setup"
/** Fired by this file whenever the state on this device may have changed. */
export const PUSH_CHANGED_EVENT = "sktr:push-changed"

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Storage can be blocked. Push still works; the app just re-checks with the server more often.
  }
}

function announceChange() {
  try {
    window.dispatchEvent(new CustomEvent(PUSH_CHANGED_EVENT))
  } catch {
    // Nothing listens outside a browser.
  }
}

/** The app's public push key, or null when push is not set up for this build. */
export function pushPublicKey(): string | null {
  const key = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim()
  return key && vapidKeyBytes(key) ? key : null
}

function isConfigured(): boolean {
  if (isMockMode()) return readStorage(MOCK_SETUP_KEY) !== "off"
  return pushPublicKey() !== null
}

function isStandalone(): boolean {
  try {
    const nav = navigator as Navigator & { standalone?: boolean }
    return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches
  } catch {
    return false
  }
}

function currentPermission(): PushPermission {
  try {
    return typeof Notification !== "undefined" ? (Notification.permission as PushPermission) : "default"
  } catch {
    return "default"
  }
}

function thisDeviceLabel(): string {
  return deviceLabelFromUserAgent(navigator.userAgent, { standalone: isStandalone(), touchPoints: navigator.maxTouchPoints })
}

function browserFacts() {
  return {
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    isIos: isIosUserAgent(navigator.userAgent, navigator.maxTouchPoints),
    isStandalone: isStandalone(),
    permission: currentPermission(),
  }
}

// Demo mode ---------------------------------------------------------------------------------------

type MockStore = { devices: Array<Omit<PushDevice, "isThisDevice">>; thisDeviceId: string | null }

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function loadMock(): MockStore {
  const seed: MockStore = {
    devices: [{ id: "mock-device-laptop", label: "Chrome on Windows", createdAt: daysAgo(21), lastUsedAt: daysAgo(3) }],
    thisDeviceId: null,
  }
  const stored = readStorage(tenantStorageKey(MOCK_KEY))
  if (!stored) return seed
  try {
    const parsed = JSON.parse(stored) as Partial<MockStore> | null
    return { devices: Array.isArray(parsed?.devices) ? parsed.devices : seed.devices, thisDeviceId: parsed?.thisDeviceId ?? null }
  } catch {
    return seed
  }
}

function saveMock(store: MockStore) {
  writeStorage(tenantStorageKey(MOCK_KEY), JSON.stringify(store))
}

// The real subscription ----------------------------------------------------------------------------

async function currentSubscription(register: boolean): Promise<{ registration: ServiceWorkerRegistration | null; subscription: PushSubscription | null }> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return { registration: null, subscription: null }
  try {
    const registration = register ? await getAppServiceWorkerRegistration() : ((await navigator.serviceWorker.getRegistration("/")) ?? null)
    if (!registration) return { registration: null, subscription: null }
    return { registration, subscription: await registration.pushManager.getSubscription() }
  } catch {
    return { registration: null, subscription: null }
  }
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false
  const left = new Uint8Array(a)
  return left.length === b.length && left.every((value, index) => value === b[index])
}

function subscriptionKeys(subscription: PushSubscription): { endpoint: string; p256dh: string; auth: string } | null {
  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!json.endpoint || !p256dh || !auth) return null
  return { endpoint: json.endpoint, p256dh, auth }
}

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = (await getBrowserSupabaseClient()?.auth.getSession()) ?? { data: { session: null } }
    return data.session?.user.id ?? null
  } catch {
    return null
  }
}

// What screens call ---------------------------------------------------------------------------------

/** Everything the settings section shows. Reads; never prompts. */
export async function readPushSnapshot(isAdmin: boolean): Promise<PushSnapshot> {
  const facts = browserFacts()
  const configured = isConfigured()

  if (isMockMode()) {
    const store = loadMock()
    const subscribed = store.thisDeviceId !== null && store.devices.some((device) => device.id === store.thisDeviceId)
    return {
      environment: { configured, isAdmin, ...facts, subscribed },
      devices: store.devices.map((device) => ({ ...device, isThisDevice: device.id === store.thisDeviceId })),
      devicesError: false,
    }
  }

  if (!configured) return { environment: { configured, isAdmin, ...facts, subscribed: false }, devices: [], devicesError: false }

  const [{ subscription }, rows] = await Promise.all([currentSubscription(false), listPushDeviceRows()])
  const endpoint = subscription?.endpoint ?? null
  const devices = rows.ok
    ? rows.data.map((row) => ({ id: row.id, label: row.label, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt, isThisDevice: endpoint !== null && row.endpoint === endpoint }))
    : []
  return {
    environment: { configured, isAdmin, ...facts, subscribed: devices.some((device) => device.isThisDevice) },
    devices,
    devicesError: !rows.ok,
  }
}

export type EnablePushResult = { ok: true } | { ok: false; reason: EnablePushFailure }

/**
 * Turns push on for this device. Call it from a tap: this is the one place the browser is asked
 * for permission.
 */
export async function enablePushOnThisDevice(): Promise<EnablePushResult> {
  if (!("Notification" in window)) return { ok: false, reason: "unsupported" }

  let permission: PushPermission
  try {
    permission = (await Notification.requestPermission()) as PushPermission
  } catch {
    return { ok: false, reason: "error" }
  }
  if (permission === "denied") return { ok: false, reason: "denied" }
  if (permission !== "granted") return { ok: false, reason: "dismissed" }

  if (isMockMode()) {
    const store = loadMock()
    const id = store.thisDeviceId ?? `mock-device-${Date.now().toString(36)}`
    const now = new Date().toISOString()
    const rest = store.devices.filter((device) => device.id !== id)
    saveMock({ devices: [{ id, label: thisDeviceLabel(), createdAt: now, lastUsedAt: now }, ...rest], thisDeviceId: id })
    announceChange()
    return { ok: true }
  }

  const keyBytes = vapidKeyBytes(pushPublicKey())
  if (!keyBytes) return { ok: false, reason: "unsupported" }

  const { registration, subscription: existing } = await currentSubscription(true)
  if (!registration) return { ok: false, reason: "not-installed" }

  try {
    let subscription = existing
    // A subscription made with another key (the keys were replaced) cannot be used: start over.
    if (subscription && !sameKey(subscription.options.applicationServerKey, keyBytes)) {
      await subscription.unsubscribe().catch(() => undefined)
      subscription = null
    }
    subscription = subscription ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes as unknown as BufferSource }))

    const keys = subscriptionKeys(subscription)
    if (!keys) return { ok: false, reason: "error" }

    const previous = readStorage(ENDPOINT_KEY)
    const registered = await registerPushDevice({ ...keys, label: thisDeviceLabel(), replacesEndpoint: previous && previous !== keys.endpoint ? previous : null })
    if (!registered.ok) {
      // Do not leave a subscription in the browser that the server does not know.
      await subscription.unsubscribe().catch(() => undefined)
      return { ok: false, reason: registered.reason }
    }

    writeStorage(ENDPOINT_KEY, keys.endpoint)
    writeStorage(USER_KEY, await currentUserId())
    writeStorage(SYNCED_AT_KEY, String(Date.now()))
    announceChange()
    return { ok: true }
  } catch {
    return { ok: false, reason: currentPermission() === "denied" ? "denied" : "error" }
  }
}

function forgetThisDevice() {
  writeStorage(ENDPOINT_KEY, null)
  writeStorage(USER_KEY, null)
  writeStorage(SYNCED_AT_KEY, null)
}

/** Turns push off for this device: the server forgets it and the browser drops the subscription. */
export async function disablePushOnThisDevice(): Promise<{ ok: boolean }> {
  if (isMockMode()) {
    const store = loadMock()
    saveMock({ devices: store.devices.filter((device) => device.id !== store.thisDeviceId), thisDeviceId: null })
    announceChange()
    return { ok: true }
  }

  const { subscription } = await currentSubscription(false)
  const endpoint = subscription?.endpoint ?? readStorage(ENDPOINT_KEY)
  let serverOk = true
  if (endpoint) serverOk = (await removePushDeviceByEndpoint(endpoint)).ok
  // Even when the server could not be reached, the browser stops receiving: the endpoint dies and
  // the server disables the row the first time a push to it is refused.
  if (subscription) await subscription.unsubscribe().catch(() => undefined)
  forgetThisDevice()
  announceChange()
  return { ok: serverOk }
}

/** Removes another of the person's devices from the list. */
export async function removePushDevice(device: PushDevice): Promise<{ ok: boolean }> {
  if (device.isThisDevice) return disablePushOnThisDevice()
  if (isMockMode()) {
    const store = loadMock()
    saveMock({ ...store, devices: store.devices.filter((item) => item.id !== device.id) })
    announceChange()
    return { ok: true }
  }
  const result = await removePushDeviceById(device.id)
  announceChange()
  return { ok: result.ok }
}

export type TestPushOutcome = "sent" | "queued" | "wait" | "not-set-up" | "gone" | "error"

/** Sends a test notification to one device. */
export async function sendTestPush(device: PushDevice): Promise<{ outcome: TestPushOutcome; message?: string }> {
  if (isMockMode()) {
    // Demo mode has no server: show the notification straight from the page when that is allowed.
    try {
      if (device.isThisDevice && currentPermission() === "granted") {
        new Notification("Push is working", { body: "This is a test from SKTR Coach. Notifications will reach this device.", tag: "push_test", icon: "/icons/icon-192.png" })
      }
    } catch {
      // Some browsers only allow notifications from a service worker. The demo still says it was sent.
    }
    return { outcome: "sent" }
  }
  const result = await sendTestPushToDevice(device.id)
  if (!result.ok) return { outcome: "error", message: result.message }
  if (result.outcome === "gone") announceChange()
  return { outcome: result.outcome }
}

export function testPushMessage(outcome: TestPushOutcome, message?: string): { tone: "success" | "info" | "error"; text: string } {
  switch (outcome) {
    case "sent":
      return { tone: "success", text: "Test sent. It should show on that device in a few seconds." }
    case "queued":
      return { tone: "info", text: "Test queued. It should show on that device within a minute." }
    case "wait":
      return { tone: "info", text: "A test was sent a moment ago. Give it a few seconds before sending another." }
    case "not-set-up":
      return { tone: "error", text: "The test could not be sent: push is not fully set up on the server yet." }
    case "gone":
      return { tone: "error", text: "That device no longer accepts notifications. Turn push on again from that device." }
    case "error":
      return { tone: "error", text: message ?? "The test could not be sent. Check your connection and try again." }
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([work, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))])
}

/**
 * Call BEFORE signing out (the server call needs the sign-in). Stops push for this device so the
 * next person to use this browser does not get the last person's notifications. Never throws and
 * never takes more than a few seconds: sign out goes ahead whatever happens here.
 */
export async function removePushOnSignOut(): Promise<void> {
  try {
    if (isMockMode()) {
      const store = loadMock()
      if (store.thisDeviceId) saveMock({ devices: store.devices.filter((device) => device.id !== store.thisDeviceId), thisDeviceId: null })
      return
    }
    if (readStorage(ENDPOINT_KEY) === null && readStorage(USER_KEY) === null) {
      // Push was never turned on in this browser by the app: nothing to look up.
      return
    }
    await withTimeout(disablePushOnThisDevice(), 4000)
  } catch {
    // Sign out must still work.
  } finally {
    if (!isMockMode()) forgetThisDevice()
  }
}

const SYNC_EVERY_MS = 12 * 60 * 60 * 1000

/**
 * Keeps the server's row for this device right. Called when the app opens (signed in) and when the
 * service worker says the browser replaced the subscription. It never prompts: it only acts when
 * permission is already granted and this account turned push on in this browser before.
 *
 *   another account's subscription is still in this browser (their sign out could not reach the
 *   server)                                             it is dropped, so they get nothing here
 *   the browser handed out a new endpoint                the server row is replaced
 *   the subscription expired                             a new one is made and registered
 *   nothing changed                                      "last used" is refreshed twice a day
 */
export async function syncPushSubscription(force = false): Promise<void> {
  try {
    if (isMockMode() || !pushPublicKey()) return
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || currentPermission() !== "granted") return

    const markedUser = readStorage(USER_KEY)
    const markedEndpoint = readStorage(ENDPOINT_KEY)
    const { registration, subscription } = await currentSubscription(false)
    if (!registration) return
    const userId = await currentUserId()
    if (!userId) return

    if (markedUser !== userId) {
      // Not switched on by this account. If a subscription is left over from someone else, end it.
      if (subscription && markedUser !== null) {
        await subscription.unsubscribe().catch(() => undefined)
        forgetThisDevice()
        announceChange()
      }
      return
    }

    const keyBytes = vapidKeyBytes(pushPublicKey())
    if (!keyBytes) return
    let live = subscription
    if (live && !sameKey(live.options.applicationServerKey, keyBytes)) {
      await live.unsubscribe().catch(() => undefined)
      live = null
    }
    const changed = !live || live.endpoint !== markedEndpoint
    const lastSync = Number(readStorage(SYNCED_AT_KEY) ?? 0)
    if (!changed && !force && Date.now() - lastSync < SYNC_EVERY_MS) return

    live = live ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes as unknown as BufferSource }))
    const keys = subscriptionKeys(live)
    if (!keys) return
    const registered = await registerPushDevice({ ...keys, label: thisDeviceLabel(), replacesEndpoint: markedEndpoint && markedEndpoint !== keys.endpoint ? markedEndpoint : null })
    if (!registered.ok) return
    writeStorage(ENDPOINT_KEY, keys.endpoint)
    writeStorage(SYNCED_AT_KEY, String(Date.now()))
    if (changed) announceChange()
  } catch {
    // Push is an extra. The bell is the source of truth.
  }
}

/** Message the service worker posts to open windows when the browser replaced the subscription. */
export const PUSH_SUBSCRIPTION_CHANGED_MESSAGE = "sktr-push-subscription-changed"
/** Message the service worker posts when a tapped notification should open a screen in this window. */
export const PUSH_OPEN_PATH_MESSAGE = "sktr-open-path"

/**
 * Mounted once while someone is signed in (the notification centre does it): syncs when the app
 * opens and when the service worker reports a change. Returns the cleanup.
 */
export function startPushSync(): () => void {
  if (isMockMode() || typeof window === "undefined" || !("serviceWorker" in navigator)) return () => undefined
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; path?: unknown } | null
    if (data?.type === PUSH_SUBSCRIPTION_CHANGED_MESSAGE) void syncPushSubscription(true)
    // A tapped notification whose window the worker could not move itself: go there from the page.
    if (data?.type === PUSH_OPEN_PATH_MESSAGE && typeof data.path === "string" && data.path.startsWith("/") && !data.path.startsWith("//")) {
      window.location.assign(data.path)
    }
  }
  navigator.serviceWorker.addEventListener("message", onMessage)
  void syncPushSubscription()
  return () => navigator.serviceWorker.removeEventListener("message", onMessage)
}
