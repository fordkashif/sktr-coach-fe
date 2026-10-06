import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { withAccessPausedSignal } from "@/lib/access-paused"
import { getSupabasePublicConfig } from "@/lib/supabase/config"
import { isFlushingForPageHide } from "@/lib/undo-queue"

let browserClient: SupabaseClient | null = null

export function getBrowserSupabaseClient() {
  if (browserClient) return browserClient

  const config = getSupabasePublicConfig()
  if (!config) return null

  browserClient = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
    // Lets the route guard react the moment the database says this member is locked out.
    // keepalive while the tab closes with a delete still waiting on "Undo" (src/lib/undo-queue.ts).
    global: { fetch: withAccessPausedSignal((input, init) => fetch(input, isFlushingForPageHide() ? { ...init, keepalive: true } : init)) },
  })

  return browserClient
}
