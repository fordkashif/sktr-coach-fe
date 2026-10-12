import test from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { classifyRequest, createReadCache, LIVE_READ_KEEP_MS, READ_KEEP_MS, READ_ONLY_RPCS } from "../src/lib/supabase/read-cache"

const BASE = "https://proj.supabase.co"
const AUTH = { authorization: "Bearer token-a", apikey: "anon" }

/** A fake network: counts calls, answers with a body that says which call it was. */
function fakeNetwork(options: { status?: number; delayMs?: number } = {}) {
  let calls = 0
  const seen: string[] = []
  let release: (() => void) | null = null
  const fetchImpl: typeof fetch = async (input, init) => {
    calls += 1
    const n = calls
    seen.push(`${init?.method ?? "GET"} ${String(input)}`)
    if (options.delayMs === -1) await new Promise<void>((resolve) => (release = resolve))
    return new Response(JSON.stringify({ call: n }), {
      status: options.status ?? 200,
      headers: { "content-type": "application/json", "content-range": `0-0/${n}` },
    })
  }
  return { fetchImpl, calls: () => calls, seen, release: () => release?.() }
}

function clock(start = 1_000_000) {
  let now = start
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

const get = (path: string, headers: Record<string, string> = AUTH) => [`${BASE}/rest/v1/${path}`, { method: "GET", headers }] as const
const rpc = (name: string, body = "{}") => [`${BASE}/rest/v1/rpc/${name}`, { method: "POST", headers: AUTH, body }] as const

test("identical reads at the same time share one request", async () => {
  const net = fakeNetwork()
  const cache = createReadCache(net.fetchImpl)
  const [a, b, c] = await Promise.all([cache.fetch(...get("profiles?select=role&user_id=eq.1")), cache.fetch(...get("profiles?select=role&user_id=eq.1")), cache.fetch(...get("profiles?select=role&user_id=eq.1"))])
  assert.equal(net.calls(), 1)
  for (const response of [a, b, c]) assert.deepEqual(await response.json(), { call: 1 })
})

test("a read is kept for a short while, then asked again", async () => {
  const net = fakeNetwork()
  const time = clock()
  const cache = createReadCache(net.fetchImpl, { now: time.now })
  await cache.fetch(...get("athletes?select=id"))
  time.advance(READ_KEEP_MS - 1)
  assert.deepEqual(await (await cache.fetch(...get("athletes?select=id"))).json(), { call: 1 })
  time.advance(2)
  assert.deepEqual(await (await cache.fetch(...get("athletes?select=id"))).json(), { call: 2 })
})

test("notification and message reads are kept for less", async () => {
  const net = fakeNetwork()
  const time = clock()
  const cache = createReadCache(net.fetchImpl, { now: time.now })
  await cache.fetch(...rpc("get_message_unread_counts"))
  await cache.fetch(...get("user_notifications?select=id&state=eq.unread"))
  time.advance(LIVE_READ_KEEP_MS + 1)
  await cache.fetch(...rpc("get_message_unread_counts"))
  await cache.fetch(...get("user_notifications?select=id&state=eq.unread"))
  assert.equal(net.calls(), 4)
})

test("a write empties the store, so the next read goes to the database", async () => {
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
    const net = fakeNetwork()
    const cache = createReadCache(net.fetchImpl)
    await cache.fetch(...get("wellness_entries?select=*"))
    await cache.fetch(`${BASE}/rest/v1/wellness_entries`, { method, headers: AUTH, body: "{}" })
    await cache.fetch(...get("wellness_entries?select=*"))
    assert.equal(net.calls(), 3, method)
  }
})

test("a database function not on the read-only list counts as a write", async () => {
  const net = fakeNetwork()
  const cache = createReadCache(net.fetchImpl)
  await cache.fetch(...rpc("get_current_account"))
  await cache.fetch(...rpc("get_current_account"))
  assert.equal(net.calls(), 1, "a read-only function is shared")
  await cache.fetch(...rpc("skip_my_session", '{"p_session_id":"x"}'))
  await cache.fetch(...rpc("get_current_account"))
  assert.equal(net.calls(), 3, "skip_my_session went out and emptied the store")
  // The same write sent twice really goes twice.
  await cache.fetch(...rpc("skip_my_session", '{"p_session_id":"x"}'))
  assert.equal(net.calls(), 4)
})

test("edge functions and uploads empty the store; sign-in calls do not", async () => {
  const net = fakeNetwork()
  const cache = createReadCache(net.fetchImpl)
  await cache.fetch(...get("teams?select=*"))
  await cache.fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: AUTH, body: "{}" })
  await cache.fetch(...get("teams?select=*"))
  assert.equal(net.calls(), 2, "token refresh left the store alone")
  await cache.fetch(`${BASE}/functions/v1/send-invite-email`, { method: "POST", headers: AUTH, body: "{}" })
  await cache.fetch(...get("teams?select=*"))
  assert.equal(net.calls(), 4, "an edge function call emptied it")
  await cache.fetch(`${BASE}/storage/v1/object/media/a.jpg`, { method: "POST", headers: AUTH, body: "x" })
  await cache.fetch(...get("teams?select=*"))
  assert.equal(net.calls(), 6, "an upload emptied it")
})

test("a read already on its way when the store is emptied is answered but not kept", async () => {
  const net = fakeNetwork({ delayMs: -1 })
  const cache = createReadCache(net.fetchImpl)
  const pending = cache.fetch(...get("sessions?select=*"))
  await new Promise((resolve) => setTimeout(resolve, 0))
  cache.clear()
  net.release()
  assert.deepEqual(await (await pending).json(), { call: 1 })
  assert.equal(cache.size(), 0)
})

test("a different sign-in never gets someone else's answer", async () => {
  const net = fakeNetwork()
  const cache = createReadCache(net.fetchImpl)
  await cache.fetch(...get("profiles?select=*", { authorization: "Bearer token-a", apikey: "anon" }))
  const other = await cache.fetch(...get("profiles?select=*", { authorization: "Bearer token-b", apikey: "anon" }))
  assert.deepEqual(await other.json(), { call: 2 })
})

test("errors are passed on as they came and never kept", async () => {
  const net = fakeNetwork({ status: 500 })
  const cache = createReadCache(net.fetchImpl)
  const first = await cache.fetch(...get("teams?select=*"))
  assert.equal(first.status, 500)
  await cache.fetch(...get("teams?select=*"))
  assert.equal(net.calls(), 2)
  assert.equal(cache.size(), 0)
})

test("a count (HEAD) keeps its headers, which is where the count is", async () => {
  const net = fakeNetwork()
  const cache = createReadCache(net.fetchImpl)
  await cache.fetch(`${BASE}/rest/v1/user_notifications?select=id`, { method: "HEAD", headers: { ...AUTH, prefer: "count=exact" } })
  const again = await cache.fetch(`${BASE}/rest/v1/user_notifications?select=id`, { method: "HEAD", headers: { ...AUTH, prefer: "count=exact" } })
  assert.equal(net.calls(), 1)
  assert.equal(again.headers.get("content-range"), "0-0/1")
})

test("cancellable requests and Request objects are passed straight through", async () => {
  const net = fakeNetwork()
  const cache = createReadCache(net.fetchImpl)
  const controller = new AbortController()
  await cache.fetch(`${BASE}/rest/v1/teams?select=*`, { method: "GET", headers: AUTH, signal: controller.signal })
  await cache.fetch(`${BASE}/rest/v1/teams?select=*`, { method: "GET", headers: AUTH, signal: controller.signal })
  assert.equal(net.calls(), 2)
  assert.equal(classifyRequest(new Request(`${BASE}/rest/v1/teams`)).kind, "other")
})

test("every function on the read-only list is declared stable in the database", () => {
  const dir = join(process.cwd(), "supabase", "migrations")
  const sql = readdirSync(dir)
    .sort()
    .map((file) => readFileSync(join(dir, file), "utf8"))
    .join("\n")
  for (const name of READ_ONLY_RPCS) {
    // The newest definition wins, as it does in the database.
    const starts = [...sql.matchAll(new RegExp(`create or replace function public\\.${name}\\(`, "gi"))]
    assert.ok(starts.length > 0, `${name} is not defined in supabase/migrations`)
    const from = starts[starts.length - 1].index ?? 0
    const header = sql.slice(from, sql.indexOf("as $", from))
    assert.match(header, /\bstable\b/i, `${name} must be declared stable to be shared as a read`)
  }
})
