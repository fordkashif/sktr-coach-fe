export type BackendMode = "mock" | "supabase"

export type SupabasePublicConfig = {
  url: string
  anonKey: string
}

export function getBackendMode(): BackendMode {
  return import.meta.env.VITE_BACKEND_MODE === "supabase" ? "supabase" : "mock"
}

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!url || !anonKey) return null
  return { url, anonKey }
}

export function isSupabaseEnabled() {
  return getBackendMode() === "supabase" && Boolean(getSupabasePublicConfig())
}
