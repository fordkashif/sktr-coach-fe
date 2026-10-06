import { ToastAction } from "@/components/ui/toast"
import { toast } from "@/components/ui/use-toast"

/**
 * Registers the service worker (public/sw.js) that lets the installed app open offline.
 *
 * Only in production builds, and only when the app talks to the real backend: mock (demo) builds,
 * which are also what the Playwright suite runs against, do not register it unless
 * VITE_ENABLE_SW is "true". Set VITE_ENABLE_SW to "false" to turn it off everywhere.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return

  const flag = import.meta.env.VITE_ENABLE_SW
  if (flag === "false") return
  if (import.meta.env.VITE_BACKEND_MODE !== "supabase" && flag !== "true") return

  // True when a worker already controlled this page, so a change of controller means an update
  // and not the very first install.
  const hadController = Boolean(navigator.serviceWorker.controller)
  let prompted = false

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || prompted) return
    prompted = true
    toast({
      title: "SKTR Coach was updated",
      description: "Reload to use the new version.",
      duration: 60_000,
      action: (
        <ToastAction altText="Reload the app" onClick={() => window.location.reload()}>
          Reload
        </ToastAction>
      ),
    })
  })

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        // An installed app can stay open for days: look for a new version whenever it comes back to the front.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void registration.update().catch(() => undefined)
        })
      })
      .catch(() => {
        // The app works the same without it.
      })
  })
}

/** True when this build registers the service worker (see registerServiceWorker above). */
function serviceWorkerAllowed(): boolean {
  if (!import.meta.env.PROD) return false
  const flag = import.meta.env.VITE_ENABLE_SW
  if (flag === "false") return false
  return import.meta.env.VITE_BACKEND_MODE === "supabase" || flag === "true"
}

/**
 * The app's service worker registration, for push notifications (src/lib/push/push-client.ts).
 * Push needs the worker, so when a person turns push on before the page finished loading (the
 * worker is registered on "load"), it is registered here. Null where this build has no worker
 * (development and demo builds) or the browser has none. Never throws.
 */
export async function getAppServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null
  try {
    const existing = await navigator.serviceWorker.getRegistration("/")
    if (existing) return existing
    if (!serviceWorkerAllowed()) return null
    await navigator.serviceWorker.register("/sw.js", { scope: "/" })
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}
