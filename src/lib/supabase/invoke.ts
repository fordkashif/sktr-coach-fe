import type { SupabaseClient } from "@supabase/supabase-js"

type InvokeOptions = Parameters<SupabaseClient["functions"]["invoke"]>[1]

/** The message shown when the server no longer accepts this device's sign-in and a refresh did not help. */
export const SIGN_IN_ENDED_MESSAGE = "Your sign-in on this device has ended. Sign out, sign in again, then retry."

function statusOf(error: unknown): number | null {
  const status = (error as { context?: { status?: unknown } } | null)?.context?.status
  return typeof status === "number" ? status : null
}

/**
 * Calls a server function as the signed-in person. The database accepts an access token until it
 * expires, but a server function checks the sign-in itself, so a token whose sign-in was ended
 * elsewhere (signed out on another device, password changed) is refused with 401 there while
 * everything else still works. When that happens, get a fresh token and try once more. If no fresh
 * token can be had, say so in plain words instead of passing on the function's own message.
 */
export async function invokeSignedIn<T = unknown>(client: SupabaseClient, name: string, options?: InvokeOptions) {
  const first = await client.functions.invoke<T>(name, options)
  if (!first.error || statusOf(first.error) !== 401) return first

  const refreshed = await client.auth.refreshSession()
  if (refreshed.error || !refreshed.data.session) {
    return { data: null, error: Object.assign(new Error(SIGN_IN_ENDED_MESSAGE), { signInEnded: true as const }) }
  }
  const second = await client.functions.invoke<T>(name, options)
  if (second.error && statusOf(second.error) === 401) {
    return { data: null, error: Object.assign(new Error(SIGN_IN_ENDED_MESSAGE), { signInEnded: true as const }) }
  }
  return second
}
