/**
 * The one refusal the database gives a signed-in member who is locked out: their own access was
 * turned off, or their club is suspended or cancelled (migration 20261006180000). It always arrives as
 * SQLSTATE 42501 with hint "access_paused" and a message that is already plain language.
 */

export const ACCESS_PAUSED_HINT = "access_paused"

/** Fired on window when any request comes back with that refusal, so the route guard can re-check. */
export const ACCESS_PAUSED_EVENT = "sktr:access-paused"

export const ACCESS_PAUSED_MESSAGE =
  "Your access is paused. Either your club's access is paused or has ended, or a club admin turned your access off. Reload the page to see what to do next."

type ErrorLike = { message?: string | null; hint?: string | null; code?: string | null } | null | undefined

export function isAccessPausedError(error: ErrorLike): boolean {
  if (!error) return false
  return error.hint === ACCESS_PAUSED_HINT || /^your access is paused\b/i.test(error.message ?? "")
}

/**
 * Wraps fetch for the Supabase client. When the database answers with the access_paused refusal, the
 * member was locked out while the app was open, so the route guard is told to look again and swaps
 * the screen for the "access paused" / "access turned off" notice. The response itself is returned
 * untouched; only failed responses are inspected.
 */
export function withAccessPausedSignal(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init)
    if (response.status === 403 || response.status === 401) {
      try {
        const body = (await response.clone().json()) as ErrorLike
        if (isAccessPausedError(body) && typeof window !== "undefined") {
          window.dispatchEvent(new Event(ACCESS_PAUSED_EVENT))
        }
      } catch {
        // Not JSON: nothing to recognise.
      }
    }
    return response
  }
}
