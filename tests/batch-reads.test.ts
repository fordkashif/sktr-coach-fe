import test from "node:test"
import assert from "node:assert/strict"
import { batchableRead, type BatchTableRead } from "../src/lib/supabase/batch-reads"
import { createReadCache } from "../src/lib/supabase/read-cache"

const BASE = "https://proj.supabase.co/rest/v1"
const AUTH = { authorization: "Bearer a", apikey: "anon" }
const read = (path: string, headers: Record<string, string> = {}) => batchableRead(`${BASE}/${path}`, "GET", new Headers({ ...AUTH, ...headers })) as BatchTableRead | null

test("plain reads are turned into batch form", () => {
  assert.deepEqual(read("teams?select=id,name&tenant_id=eq.t1&status=eq.active"), {
    t: "teams",
    c: ["id", "name"],
    f: [
      ["tenant_id", "eq", "t1"],
      ["status", "eq", "active"],
    ],
    o: [],
    l: null,
  })
  assert.deepEqual(read("sessions?select=*&athlete_id=in.(a,b)&scheduled_for=gte.2026-10-01&scheduled_for=lte.2026-10-31&order=scheduled_for.desc.nullslast,id&limit=50"), {
    t: "sessions",
    c: "*",
    f: [
      ["athlete_id", "in", ["a", "b"]],
      ["scheduled_for", "gte", "2026-10-01"],
      ["scheduled_for", "lte", "2026-10-31"],
    ],
    o: [
      ["scheduled_for", "desc", "nullslast"],
      ["id", "asc", null],
    ],
    l: 50,
  })
  assert.deepEqual(read("athletes?select=id&user_id=not.is.null&archived_at=is.null")?.f, [
    ["user_id", "not.is", "null"],
    ["archived_at", "is", "null"],
  ])
  assert.deepEqual(read("athletes?select=id&id=in.()")?.f, [["id", "in", []]])
  // Paging (offset and limit), as .range() sends it.
  const page = read("athletes?select=id&order=first_name.asc,id.asc&offset=1000&limit=1000")
  assert.equal(page?.x, 1000)
  assert.equal(page?.l, 1000)
})

test("anything else goes to the server on its own", () => {
  const cases: Array<[string, Record<string, string>?]> = [
    ["athletes?select=id,teams(name)"],
    ["athletes?select=full:first_name"],
    ["athletes?select=id::text"],
    ["athletes?select=id&or=(a.eq.1,b.eq.2)"],
    ["athletes?select=id&first_name=ilike.*kash*"],
    ["athletes?select=id&teams.name=eq.x"],
    ["athletes?select=id&first_name=in.(\"a,b\",c)"],
    ["athletes?select=id&id=not.eq.1"],
    ["athletes?select=id", { prefer: "count=exact" }],
    ["athletes?select=id", { accept: "application/vnd.pgrst.object+json" }],
    ["athletes?select=id", { "accept-profile": "storage" }],
    ["rpc/get_current_account"],
  ]
  for (const [path, headers] of cases) assert.equal(read(path, headers), null, path)
  assert.equal(batchableRead(`${BASE}/athletes?select=id`, "POST", new Headers(AUTH)), null, "writes")
})

function fakeServer(options: { batchStatus?: number; failIndex?: number } = {}) {
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input).replace(BASE, "")
    calls.push(`${init?.method ?? "GET"} ${url}`)
    if (url === "/rpc/batch_reads") {
      if (options.batchStatus && options.batchStatus !== 200) return new Response("{}", { status: options.batchStatus })
      const { p_reads } = JSON.parse(String(init?.body)) as { p_reads: Array<{ t: string }> }
      return new Response(JSON.stringify(p_reads.map((r, index) => (index === options.failIndex ? { ok: false } : { ok: true, rows: [{ from: "batch", table: r.t }] }))), { status: 200 })
    }
    return new Response(JSON.stringify([{ from: "server" }]), { status: 200 })
  }
  return { fetchImpl, calls }
}

const getAll = (cache: ReturnType<typeof createReadCache>, paths: string[]) =>
  Promise.all(paths.map(async (path) => (await cache.fetch(`${BASE}/${path}`, { method: "GET", headers: AUTH })).json()))

test("reads that start together go as one request", async () => {
  const server = fakeServer()
  const cache = createReadCache(server.fetchImpl, { batch: true })
  const answers = await getAll(cache, ["teams?select=id", "athletes?select=id", "profiles?select=user_id", "athletes?select=id,teams(name)"])
  // The read that cannot be batched goes out straight away; the others wait for the batch.
  assert.deepEqual(server.calls, ["GET /athletes?select=id,teams(name)", "POST /rpc/batch_reads"])
  assert.deepEqual(answers[0], [{ from: "batch", table: "teams" }])
  assert.deepEqual(answers[3], [{ from: "server" }])
  // Kept like any other read.
  await getAll(cache, ["teams?select=id"])
  assert.equal(server.calls.length, 2)
})

test("a read on its own goes out as it is", async () => {
  const server = fakeServer()
  const cache = createReadCache(server.fetchImpl, { batch: true })
  await getAll(cache, ["teams?select=id"])
  assert.deepEqual(server.calls, ["GET /teams?select=id"])
})

test("a read that fails inside the batch is sent again on its own", async () => {
  const server = fakeServer({ failIndex: 1 })
  const cache = createReadCache(server.fetchImpl, { batch: true })
  const answers = await getAll(cache, ["teams?select=id", "athletes?select=id"])
  assert.deepEqual(server.calls, ["POST /rpc/batch_reads", "GET /athletes?select=id"])
  assert.deepEqual(answers[1], [{ from: "server" }])
})

test("a database without batch_reads: reads go one by one, and it is not tried again soon", async () => {
  const server = fakeServer({ batchStatus: 404 })
  const cache = createReadCache(server.fetchImpl, { batch: true })
  await getAll(cache, ["teams?select=id", "athletes?select=id"])
  await getAll(cache, ["profiles?select=id", "sessions?select=id"])
  assert.deepEqual(server.calls, ["POST /rpc/batch_reads", "GET /teams?select=id", "GET /athletes?select=id", "GET /profiles?select=id", "GET /sessions?select=id"])
})

test("different sign-ins are never batched together", async () => {
  const server = fakeServer()
  const cache = createReadCache(server.fetchImpl, { batch: true })
  await Promise.all([
    cache.fetch(`${BASE}/teams?select=id`, { method: "GET", headers: { authorization: "Bearer a", apikey: "anon" } }),
    cache.fetch(`${BASE}/athletes?select=id`, { method: "GET", headers: { authorization: "Bearer b", apikey: "anon" } }),
  ])
  assert.deepEqual(server.calls.sort(), ["GET /athletes?select=id", "GET /teams?select=id"])
})

test("read-only database functions are batched; anything else is not", () => {
  const readOnly = (name: string) => name === "get_tenant_member_emails" || name === "training_load_weeks"
  const fn = (path: string, body: string | null, headers: Record<string, string> = {}) =>
    batchableRead(`${BASE}/rpc/${path}`, "POST", new Headers({ ...AUTH, ...headers }), body, readOnly)
  assert.deepEqual(fn("get_tenant_member_emails", "{}"), { r: "get_tenant_member_emails", a: {} })
  assert.deepEqual(fn("training_load_weeks", '{"p_team_id":null,"p_weeks":12,"p_as_of":"2026-10-12"}'), {
    r: "training_load_weeks",
    a: { p_team_id: null, p_weeks: 12, p_as_of: "2026-10-12" },
  })
  assert.equal(fn("skip_my_session", "{}"), null, "not on the read-only list")
  assert.equal(fn("training_load_weeks", '{"p_ids":["a","b"]}'), null, "a list as an argument")
  assert.equal(fn("training_load_weeks", '{"p x":1}'), null, "a strange argument name")
  assert.equal(fn("get_tenant_member_emails", "{}", { prefer: "count=exact" }), null, "a count")
  assert.equal(fn("get_tenant_member_emails", "{}", { accept: "application/vnd.pgrst.object+json" }), null, "a single object")
})
