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
 */
const VERSION = "v1"
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
