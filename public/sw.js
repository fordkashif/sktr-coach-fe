/*
 * SKTR Coach service worker. Deliberately small.
 *
 * What it does
 *   - Page loads (navigations): network first. When the network answers, a copy of the app shell
 *     (index.html) is kept. When it does not, the kept shell is served so the app still opens;
 *     if there is no kept shell yet, /offline.html is shown.
 *   - Hashed build files under /assets/: cache first. Their names change on every build, so a
 *     cached file can never be stale.
 *   - Everything else: not touched at all. The browser handles it as if this file did not exist.
 *
 * What it never does
 *   - It never answers, stores or even looks at a request to another origin. The Supabase API,
 *     auth and storage all live on another origin, so they always go straight to the network.
 *   - It never handles anything except GET.
 *
 * Updates
 *   - A new deploy cannot leave people on an old build: the page itself always comes from the
 *     network when there is one, and it points at the new hashed files.
 *   - A changed sw.js installs at once (skipWaiting) and takes over open tabs (clients.claim).
 *     The page shows a "Reload" prompt when that happens; nothing reloads on its own.
 *   - Bump VERSION to throw away everything cached by earlier versions.
 *
 * Push notifications (the last section of this file)
 *   - "push": shows the notification the server sent (title, body, the screen to open, a tag so a
 *     newer one about the same thing replaces the older one). The server sends fixed sentences
 *     only: no message text and no health details ever reach this file.
 *   - "notificationclick": brings an open SKTR Coach window to the front and takes it to that
 *     screen, or opens one.
 *   - "pushsubscriptionchange": the browser replaced the subscription. A new one is made with the
 *     same key and open windows are told, so the app can tell the server. With no window open the
 *     app does it the next time it starts (src/lib/push/push-client.ts).
 *   - None of this touches fetch handling or the caches above.
 */
const VERSION = "v2"
const SHELL_CACHE = `sktr-shell-${VERSION}`
const ASSET_CACHE = `sktr-assets-${VERSION}`
const SHELL_KEY = "/"
const OFFLINE_URL = "/offline.html"
const MAX_ASSETS = 160

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        Promise.all([
          cache.add(new Request(OFFLINE_URL, { cache: "reload" })),
          // Best effort: the shell is also stored on the first successful page load.
          fetch(new Request(SHELL_KEY, { cache: "reload" }))
            .then((response) => (isShell(response) ? cache.put(SHELL_KEY, response) : undefined))
            .catch(() => undefined),
        ]),
      )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("sktr-") && key !== SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

function isShell(response) {
  return Boolean(response && response.ok && response.type === "basic" && (response.headers.get("content-type") || "").includes("text/html"))
}

async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    // Every route of this single page app is served the same index.html, so one copy is enough.
    if (isShell(response) && !response.redirected) {
      cache.put(SHELL_KEY, response.clone()).catch(() => undefined)
    }
    return response
  } catch (error) {
    const shell = await cache.match(SHELL_KEY)
    if (shell) return shell
    const offline = await cache.match(OFFLINE_URL)
    if (offline) return offline
    throw error
  }
}

async function trimAssets(cache) {
  const keys = await cache.keys()
  // Oldest first. Files from old builds fall out once there are too many.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((key) => cache.delete(key)))
}

async function handleAsset(request) {
  const cache = await caches.open(ASSET_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && response.type === "basic") {
    cache
      .put(request, response.clone())
      .then(() => trimAssets(cache))
      .catch(() => undefined)
  }
  return response
}

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return

  const url = new URL(request.url)
  // Another origin (Supabase API, auth, storage, analytics, images): never touched.
  if (url.origin !== self.location.origin) return
  // Belt and braces, in case an API is ever served from this origin.
  if (/^\/(api|auth|rest|storage|functions|realtime)\//.test(url.pathname)) return
  if (request.headers.has("authorization")) return

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request))
    return
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(handleAsset(request))
  }
})

// Push notifications ------------------------------------------------------------------------------

const PUSH_ICON = "/icons/icon-192.png"
const PUSH_BADGE = "/icons/badge-96.png"
const PUSH_FALLBACK = { title: "SKTR Coach", body: "You have a new notification.", url: "/notifications", tag: "notification" }

/** Only a path inside this app: one leading "/", no host, no scheme. */
function safeAppPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.length > 300) return PUSH_FALLBACK.url
  return value
}

function readPush(event) {
  let data = null
  try {
    data = event.data ? event.data.json() : null
  } catch (error) {
    data = null
  }
  const text = (value, fallback, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback)
  return {
    title: text(data && data.title, PUSH_FALLBACK.title, 80),
    body: text(data && data.body, PUSH_FALLBACK.body, 200),
    url: safeAppPath(data && data.url),
    tag: text(data && data.tag, PUSH_FALLBACK.tag, 120),
  }
}

self.addEventListener("push", (event) => {
  const message = readPush(event)
  // A push must always show something: browsers end a subscription that receives silently.
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      // A newer notification about the same thing replaces the older one and alerts again.
      renotify: true,
      icon: PUSH_ICON,
      badge: PUSH_BADGE,
      data: { url: message.url },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const path = safeAppPath(event.notification.data && event.notification.data.url)
  const target = new URL(path, self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const own = windows.filter((client) => new URL(client.url).origin === self.location.origin)
      // The window in front if there is one, otherwise any.
      const open = own.find((client) => client.focused) || own.find((client) => client.visibilityState === "visible") || own[0]
      if (open) {
        const focused = await open.focus().catch(() => open)
        const moved = focused && "navigate" in focused ? await focused.navigate(target).catch(() => null) : null
        // A window this worker does not control yet cannot be moved: ask the page to go there itself.
        if (!moved && focused) focused.postMessage({ type: "sktr-open-path", path })
        if (moved || focused) return
      }
      await self.clients.openWindow(target)
    }),
  )
})

self.addEventListener("pushsubscriptionchange", (event) => {
  const previous = event.oldSubscription
  event.waitUntil(
    (async () => {
      try {
        let current = event.newSubscription || (await self.registration.pushManager.getSubscription())
        if (!current && previous && previous.options && previous.options.applicationServerKey) {
          current = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: previous.options.applicationServerKey })
        }
      } catch (error) {
        // Without a new subscription the app makes one the next time it opens.
      }
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      windows.forEach((client) => client.postMessage({ type: "sktr-push-subscription-changed" }))
    })(),
  )
})
