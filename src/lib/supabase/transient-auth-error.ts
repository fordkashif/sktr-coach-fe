/** True for a failure to reach the auth server, as opposed to the server saying "signed out". */
export function isTransientAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const { name, status } = error as { name?: unknown; status?: unknown }
  if (name === "AuthRetryableFetchError") return true
  return typeof status === "number" && (status === 0 || status >= 500)
}
