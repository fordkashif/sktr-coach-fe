/**
 * Turns raw Supabase auth / RPC errors into short messages a coach can act on.
 * Supabase does not say whether an email exists (by design), so wrong password
 * and unknown email share one message.
 */

type ErrorLike = { message?: string; code?: string; status?: number; name?: string } | string | null | undefined

const CONNECTION_MESSAGE = "We could not reach SKTR Coach. Check your connection and try again."

function parts(error: ErrorLike) {
  if (!error) return { message: "", code: "", status: undefined as number | undefined, name: "" }
  if (typeof error === "string") return { message: error, code: "", status: undefined as number | undefined, name: "" }
  return { message: error.message ?? "", code: error.code ?? "", status: error.status, name: error.name ?? "" }
}

function isConnectionError(error: ErrorLike) {
  const { message, status, name } = parts(error)
  return (
    name === "AuthRetryableFetchError" ||
    status === 0 ||
    /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out/i.test(message)
  )
}

function isRateLimited(error: ErrorLike) {
  const { message, code, status } = parts(error)
  return status === 429 || /rate_limit/i.test(code) || /rate limit|too many requests|only request this after/i.test(message)
}

export function describeSignInError(error: ErrorLike): string {
  const { message, code } = parts(error)
  if (isConnectionError(error)) return CONNECTION_MESSAGE
  if (isRateLimited(error)) return "Too many attempts. Wait a minute, then try again."
  if (code === "invalid_credentials" || /invalid login credentials|invalid email or password/i.test(message)) {
    return "That email and password do not match. Check both and try again, or reset your password."
  }
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
    return "This email has not been confirmed yet. Open the link in your invite email, then sign in."
  }
  if (code === "user_banned" || /banned|disabled|deactivated/i.test(message)) {
    return "This account has been turned off. Ask your club admin to restore your access."
  }
  if (code === "validation_failed" || /missing email|invalid email|unable to validate email/i.test(message)) {
    return "Enter the email address you use for SKTR Coach."
  }
  return "Sign in did not work. Try again in a moment."
}

export function describeAuthLinkError(error: ErrorLike): string {
  const { message, code } = parts(error)
  if (isConnectionError(error)) return CONNECTION_MESSAGE
  if (/code verifier|flow state|same browser/i.test(message) || code === "flow_state_not_found" || code === "bad_code_verifier") {
    return "Open this link in the same browser you requested it from, or send yourself a new link."
  }
  return "This link has expired or was already used. Send yourself a new one."
}

export function describePasswordResetError(error: ErrorLike): string {
  const { message, code } = parts(error)
  if (isConnectionError(error)) return CONNECTION_MESSAGE
  if (isRateLimited(error)) return "You just asked for a reset link. Wait a minute before asking again."
  if (code === "same_password" || /different from the old password/i.test(message)) {
    return "Choose a password you have not used on this account before."
  }
  if (code === "weak_password" || /weak password|password should/i.test(message)) {
    return "That password is too easy to guess. Use at least 8 characters with a mix of letters and numbers."
  }
  if (/session.*(missing|not established)|expired|invalid|otp|token|code verifier|flow state/i.test(message)) {
    return describeAuthLinkError(error)
  }
  if (/at least 8 characters|do not match|email is required/i.test(message)) return message
  return "We could not reset your password. Try again in a moment."
}

/** Messages raised by submit_tenant_provision_request that are already plain enough to show. */
const REQUEST_FIELD_MESSAGES: Array<[RegExp, string]> = [
  [/requestor name is required/i, "Add your first and last name."],
  [/requestor email is required/i, "Add your work email."],
  [/organization name is required/i, "Add the name of your club or organization."],
  [/invalid requested plan/i, "Choose a package."],
  [/job title is required/i, "Add your job title."],
  [/organization type is required/i, "Choose an organization type."],
  [/region is required/i, "Add your country or region."],
  [/coach count/i, "Enter how many coaches you expect, 0 or more."],
  [/athlete count/i, "Enter how many athletes you expect, 0 or more."],
]

export function describeAccessRequestError(error: ErrorLike): string {
  const { message } = parts(error)
  if (isConnectionError(error)) return CONNECTION_MESSAGE
  if (isRateLimited(error)) return "Too many requests from this device. Wait a minute, then try again."
  if (/pending request already exists/i.test(message)) {
    return "We already have a request from this email for this club. It is in review, so there is no need to send it again."
  }
  for (const [pattern, friendly] of REQUEST_FIELD_MESSAGES) {
    if (pattern.test(message)) return friendly
  }
  return "We could not send your request. Try again in a moment."
}
