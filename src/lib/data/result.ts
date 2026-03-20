import type { PostgrestError } from "@supabase/supabase-js"

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

export function mapPostgrestError(error: PostgrestError): DataError {
  if (error.code === "PGRST116") {
    return { code: "NOT_FOUND", message: error.message, cause: error }
  }
  if (error.code === "23505") {
    return { code: "CONFLICT", message: error.message, cause: error }
  }
  if (error.code === "42501") {
    return { code: "FORBIDDEN", message: error.message, cause: error }
  }
  if (error.code === "22P02" || error.code === "23514") {
    return { code: "VALIDATION", message: error.message, cause: error }
  }

  if (error.message.toLowerCase().includes("row-level security")) {
    return { code: "FORBIDDEN", message: error.message, cause: error }
  }

  return { code: "UNKNOWN", message: error.message, cause: error }
}
