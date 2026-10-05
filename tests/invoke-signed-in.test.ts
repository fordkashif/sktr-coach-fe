import assert from "node:assert/strict"
import test from "node:test"
import type { SupabaseClient } from "@supabase/supabase-js"
import { invokeSignedIn, SIGN_IN_ENDED_MESSAGE } from "../src/lib/supabase/invoke"

type Reply = { data: unknown; error: unknown }

function fakeClient(replies: Reply[], refreshOk: boolean) {
  const calls = { invoke: 0, refresh: 0 }
  const client = {
    functions: { invoke: async () => replies[calls.invoke++] },
    auth: {
      refreshSession: async () => {
        calls.refresh += 1
        return refreshOk ? { data: { session: {} }, error: null } : { data: { session: null }, error: new Error("gone") }
      },
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

const refused: Reply = { data: null, error: { message: "non-2xx", context: { status: 401 } } }

test("a server function that answers is called once", async () => {
  const { client, calls } = fakeClient([{ data: { ok: true }, error: null }], true)
  const result = await invokeSignedIn(client, "fn")
  assert.deepEqual(result.data, { ok: true })
  assert.deepEqual(calls, { invoke: 1, refresh: 0 })
})

test("a refused sign-in is refreshed and the call is tried once more", async () => {
  const { client, calls } = fakeClient([refused, { data: { ok: true }, error: null }], true)
  const result = await invokeSignedIn(client, "fn")
  assert.deepEqual(result.data, { ok: true })
  assert.deepEqual(calls, { invoke: 2, refresh: 1 })
})

test("when the sign-in cannot be refreshed the person is told to sign in again", async () => {
  const { client, calls } = fakeClient([refused], false)
  const result = await invokeSignedIn(client, "fn")
  assert.equal((result.error as Error).message, SIGN_IN_ENDED_MESSAGE)
  assert.deepEqual(calls, { invoke: 1, refresh: 1 })
})

test("other failures are passed on untouched, with no refresh", async () => {
  const failure: Reply = { data: null, error: { message: "non-2xx", context: { status: 500 } } }
  const { client, calls } = fakeClient([failure], true)
  const result = await invokeSignedIn(client, "fn")
  assert.equal(result.error, failure.error)
  assert.deepEqual(calls, { invoke: 1, refresh: 0 })
})
