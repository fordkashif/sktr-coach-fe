import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode, getSupabasePublicConfig } from "@/lib/supabase/config"

export function initializeSupabaseRuntime() {
  if (getBackendMode() !== "supabase") return

  const config = getSupabasePublicConfig()
  if (!config) {
    console.warn("[supabase] VITE_BACKEND_MODE is 'supabase' but public config is missing.")
    return
  }

  getBrowserSupabaseClient()
}
