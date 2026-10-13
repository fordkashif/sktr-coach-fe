import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { ACCESS_PAUSED_EVENT, withAccessPausedSignal } from "@/lib/access-paused"
import { markBundleAnswer, markServerFetch, noteBundleFetch, timedFetch } from "@/lib/perf/timing-log"
import { countInFlight } from "@/lib/supabase/in-flight"
import { getSupabasePublicConfig } from "@/lib/supabase/config"
import { createReadCache, type ReadCache } from "@/lib/supabase/read-cache"
import { isFlushingForPageHide } from "@/lib/undo-queue"

let browserClient: SupabaseClient | null = null
let readCache: ReadCache | null = null

/**
 * Forget the reads the screens have been sharing (src/lib/supabase/read-cache.ts), so the next
 * question goes to the database. Writes do this by themselves; call it when something changed
 * elsewhere, like a live update arriving.
 */
export function clearSharedReads() {
  readCache?.clear()
}

function clearOnReturn() {
  if (typeof window === "undefined") return
  // Back in the app after a while: what others changed in the meantime should show.
  window.addEventListener("focus", clearSharedReads)
  window.addEventListener("online", clearSharedReads)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") clearSharedReads()
  })
  // Access paused: what this person may see has changed. (Signing out is handled below. Shared
  // reads are keyed by the sign-in token, so a different person never gets someone else's answer.)
  window.addEventListener(ACCESS_PAUSED_EVENT, clearSharedReads)
}

export function getBrowserSupabaseClient() {
  if (browserClient) return browserClient

  const config = getSupabasePublicConfig()
  if (!config) return null

  // keepalive while the tab closes with a delete still waiting on "Undo" (src/lib/undo-queue.ts).
  readCache = createReadCache(
    markServerFetch((input, init) => fetch(input, isFlushingForPageHide() ? { ...init, keepalive: true } : init)),
    // The app's start-up questions are answered from one request (src/lib/supabase/app-start.ts).
    { appStart: true, onBundleAnswer: markBundleAnswer, onBundleFetched: noteBundleFetch },
  )

  browserClient = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
    // Lets the route guard react the moment the database says this member is locked out.
    // Identical reads from different screens share one answer (src/lib/supabase/read-cache.ts).
    // With on-phone timing switched on (?timing=1), each call is also measured (src/lib/perf/timing-log.ts).
    global: { fetch: countInFlight(timedFetch(withAccessPausedSignal(readCache.fetch))) },
  })

  browserClient.auth.onAuthStateChange((event) => {
    // Not SIGNED_IN: it also fires every time the app opens with a saved sign-in, mid-load.
    if (event === "SIGNED_OUT" || event === "USER_UPDATED") clearSharedReads()
  })
  clearOnReturn()

  return browserClient
}
