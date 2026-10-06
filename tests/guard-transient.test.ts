import assert from "node:assert/strict"
import test from "node:test"
import { isTransientAuthError } from "../src/lib/supabase/transient-auth-error"

test("a failure to reach the auth server is not a sign out", () => {
  assert.equal(isTransientAuthError({ name: "AuthRetryableFetchError", status: 0 }), true)
  assert.equal(isTransientAuthError({ name: "AuthApiError", status: 503 }), true)
  assert.equal(isTransientAuthError({ name: "AuthApiError", status: 0 }), true)
})

test("a clear answer from the auth server is taken at its word", () => {
  assert.equal(isTransientAuthError({ name: "AuthApiError", status: 400 }), false)
  assert.equal(isTransientAuthError({ name: "AuthSessionMissingError", status: 400 }), false)
  assert.equal(isTransientAuthError(null), false)
  assert.equal(isTransientAuthError(undefined), false)
})
