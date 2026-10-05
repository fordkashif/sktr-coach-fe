import type { PostgrestError } from "@supabase/supabase-js"
import { ACCESS_PAUSED_MESSAGE, isAccessPausedError } from "@/lib/access-paused"

export type DataErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION"
  | "UNKNOWN"

export type DataError = {
  code: DataErrorCode
  message: string
  cause?: unknown
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: DataError }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function err<T = never>(code: DataErrorCode, message: string, cause?: unknown): Result<T> {
  return { ok: false, error: { code, message, cause } }
}

/**
 * Shown when the database refuses a write. The raw text ("new row violates row-level security policy...")
 * means nothing to a coach, and the usual cause is a team they are not, or are no longer, assigned to.
 * The original error stays in `cause`.
 */
export const FORBIDDEN_MESSAGE =
  "You do not have access to do that. Your access or team assignments may have changed, so reload and try again. Coaches can only change the teams they are assigned to."

export function mapPostgrestError(error: PostgrestError): DataError {
  // Deactivated member, or a suspended or cancelled club. Checked first: it shares SQLSTATE 42501 with
  // the row-level security refusal below, but the advice about team assignments would be wrong here.
  if (isAccessPausedError(error)) {
    return { code: "FORBIDDEN", message: ACCESS_PAUSED_MESSAGE, cause: error }
  }
  if (error.code === "PGRST116") {
    return { code: "NOT_FOUND", message: error.message, cause: error }
  }
  if (error.code === "23505") {
    return { code: "CONFLICT", message: error.message, cause: error }
  }
  if (error.code === "42501" || error.message.toLowerCase().includes("row-level security")) {
    return { code: "FORBIDDEN", message: FORBIDDEN_MESSAGE, cause: error }
  }
  if (error.code === "22P02" || error.code === "23514") {
    return { code: "VALIDATION", message: error.message, cause: error }
  }

  return { code: "UNKNOWN", message: error.message, cause: error }
}
