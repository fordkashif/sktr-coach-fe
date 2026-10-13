import test from "node:test"
import assert from "node:assert/strict"
import { answerFromBundle, bundleTarget, type AppStartBundle } from "../src/lib/supabase/app-start"
import { createReadCache } from "../src/lib/supabase/read-cache"

const BASE = "https://proj.supabase.co/rest/v1"
const UID = "00000000-0000-4000-8000-000000000001"
const TENANT = "00000000-0000-4000-8000-0000000000aa"
const AUTH = { authorization: "Bearer a", apikey: "anon" }

const bundle: AppStartBundle = {
  uid: UID,
  profiles: [{ user_id: UID, tenant_id: TENANT, role: "athlete", display_name: "Kashif", is_active: true }],
  athletes: [{ id: "ath-1", user_id: UID, tenant_id: TENANT, team_id: "team-1", first_name: "Kashif", teams: { name: "Throw Squad" } }],
  unit_preferences: [],
  club_unit_defaults: [{ tenant_id: TENANT, weight_unit: "kg", height_unit: "cm" }],
  club_profiles: [{ tenant_id: TENANT, timezone: "America/Jamaica", password_set_at: null }],
  "rpc:get_current_account": [{ account_kind: "member", role: "athlete", display_name: "Kashif", avatar_path: null }],
  "rpc:get_message_unread_counts": [{ thread_id: "t", unread: 2 }],
}

const get = (path: string, headers: Record<string, string> = {}) => bundleTarget(`${BASE}/${path}`, "GET", new Headers({ ...AUTH, ...headers }), null)
const rpc = (name: string, body = "{}") => bundleTarget(`${BASE}/rpc/${name}`, "POST", new Headers(AUTH), body)

test("own rows: every shape of 'my athlete record' is answered from one row", () => {
  const shapes = ["id", "id,team_id", "id,first_name", "id,tenant_id,team_id", "id,tenant_id", "team_id,teams(name)"]
  for (const select of shapes) {
    const target = get(`athletes?select=${encodeURIComponent(select)}&user_id=eq.${UID}`)
    assert.ok(target, select)
    const answer = answerFromBundle(bundle, target) as Array<Record<string, unknown>>
    assert.equal(answer.length, 1, select)
    assert.deepEqual(Object.keys(answer[0]), select.split(",").map((part) => part.replace("(name)", "")), select)
  }
  const withTeam = answerFromBundle(bundle, get(`athletes?select=team_id,teams(name)&user_id=eq.${UID}`)!) as Array<Record<string, unknown>>
  assert.deepEqual(withTeam[0], { team_id: "team-1", teams: { name: "Throw Squad" } })
})

test("own rows are only answered when the request asks for the caller's own rows", () => {
  // Someone else's id, or no user filter at all: only the server knows.
  assert.equal(answerFromBundle(bundle, get(`profiles?select=role&user_id=eq.someone-else`)!), null)
  assert.equal(answerFromBundle(bundle, get(`profiles?select=role&tenant_id=eq.${TENANT}`)!), null)
  // An extra equals filter is applied, and can give no rows.
  assert.deepEqual(answerFromBundle(bundle, get(`profiles?select=role&user_id=eq.${UID}&is_active=eq.true`)!), [{ role: "athlete" }])
  assert.deepEqual(answerFromBundle(bundle, get(`profiles?select=role&user_id=eq.${UID}&is_active=eq.false`)!), [])
})

test("anything the bundle cannot answer exactly goes to the server", () => {
  assert.equal(get(`athletes?select=id&user_id=eq.${UID}&order=created_at.desc`), null, "ordering")
  assert.equal(get(`athletes?select=id&user_id=in.(${UID})`), null, "a filter other than equals")
  assert.equal(get(`athletes?select=id,sessions(id)&user_id=eq.${UID}`), null, "another embedded table")
  assert.equal(get(`athletes?select=full:first_name&user_id=eq.${UID}`), null, "a renamed column")
  assert.equal(get(`athletes?select=id&user_id=eq.${UID}&limit=5`), null, "a limit other than 1")
  assert.equal(get(`athletes?select=id&user_id=eq.${UID}`, { prefer: "count=exact" }), null, "a count")
  assert.equal(get(`athletes?select=id&user_id=eq.${UID}`, { accept: "application/vnd.pgrst.object+json" }), null, "a single object")
  assert.equal(get(`sessions?select=id&athlete_id=eq.x`), null, "a table the bundle does not hold")
  assert.equal(rpc("get_current_account", '{"x":1}'), null, "a function called with arguments")
  assert.equal(rpc("skip_my_session"), null, "a function the bundle does not hold")
  // A column the bundle row does not have (for example a newer column): the server answers.
  assert.equal(answerFromBundle(bundle, get(`athletes?select=id,not_a_column&user_id=eq.${UID}`)!), null)
  // A part the database could not give (null) is never answered.
  assert.equal(answerFromBundle({ ...bundle, profiles: null }, get(`profiles?select=role&user_id=eq.${UID}`)!), null)
})

test("club rows are answered only when the bundle holds all of them", () => {
  assert.deepEqual(answerFromBundle(bundle, get("club_profiles?select=timezone&limit=1")!), [{ timezone: "America/Jamaica" }])
  assert.deepEqual(answerFromBundle(bundle, get(`club_profiles?select=password_set_at&tenant_id=eq.${TENANT}`)!), [{ password_set_at: null }])
  const many = { ...bundle, club_profiles: [1, 2, 3].map((n) => ({ tenant_id: `t${n}`, timezone: "UTC" })) }
  assert.equal(answerFromBundle(many, get("club_profiles?select=timezone&limit=1")!), null)
  const two = { ...bundle, club_profiles: [1, 2].map((n) => ({ tenant_id: `t${n}`, timezone: "UTC" })) }
  assert.equal(answerFromBundle(two, get("club_profiles?select=timezone&limit=1")!), null, "limit 1 with two rows: the server picks")
})

test("functions: answered as the server sends them", () => {
  assert.deepEqual(answerFromBundle(bundle, rpc("get_current_account")!), bundle["rpc:get_current_account"])
  assert.equal(rpc("get_message_unread_counts")?.live, true)
  assert.equal(answerFromBundle(bundle, rpc("get_visible_avatars")!), null, "missing from the bundle")
})

function fakeServer(bundleStatus = 200) {
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push(`${init?.method ?? "GET"} ${url.replace(BASE, "")}`)
    if (url.endsWith("/rpc/get_app_start")) {
      return new Response(bundleStatus === 200 ? JSON.stringify(bundle) : "{}", { status: bundleStatus, headers: { "content-type": "application/json" } })
    }
    return new Response(JSON.stringify([{ from: "server" }]), { status: 200, headers: { "content-type": "application/json" } })
  }
  return { fetchImpl, calls }
}

test("opening the app: the start-up requests together cost one request", async () => {
  const server = fakeServer()
  const cache = createReadCache(server.fetchImpl, { appStart: true })
  const requests = [
    cache.fetch(`${BASE}/athletes?select=id&user_id=eq.${UID}`, { method: "GET", headers: AUTH }),
    cache.fetch(`${BASE}/athletes?select=id,team_id&user_id=eq.${UID}`, { method: "GET", headers: AUTH }),
    cache.fetch(`${BASE}/profiles?select=user_id,tenant_id,role&user_id=eq.${UID}`, { method: "GET", headers: AUTH }),
    cache.fetch(`${BASE}/club_profiles?select=timezone&limit=1`, { method: "GET", headers: AUTH }),
    cache.fetch(`${BASE}/rpc/get_current_account`, { method: "POST", headers: AUTH, body: "{}" }),
    cache.fetch(`${BASE}/sessions?select=id&athlete_id=eq.ath-1`, { method: "GET", headers: AUTH }),
  ]
  const answers = await Promise.all(requests.map(async (request) => (await request).json()))
  assert.deepEqual(server.calls, ["POST /rpc/get_app_start", "GET /sessions?select=id&athlete_id=eq.ath-1"])
  assert.deepEqual(answers[0], [{ id: "ath-1" }])
  assert.deepEqual(answers[3], [{ timezone: "America/Jamaica" }])
  assert.deepEqual(answers[5], [{ from: "server" }])
})

test("a database without the bundle: requests go to the server, and it is not asked for again soon", async () => {
  const server = fakeServer(404)
  const cache = createReadCache(server.fetchImpl, { appStart: true })
  const first = await (await cache.fetch(`${BASE}/athletes?select=id&user_id=eq.${UID}`, { method: "GET", headers: AUTH })).json()
  assert.deepEqual(first, [{ from: "server" }])
  cache.clear()
  await cache.fetch(`${BASE}/profiles?select=role&user_id=eq.${UID}`, { method: "GET", headers: AUTH })
  assert.deepEqual(server.calls, ["POST /rpc/get_app_start", `GET /athletes?select=id&user_id=eq.${UID}`, `GET /profiles?select=role&user_id=eq.${UID}`])
})

test("after a save the bundle is asked for again, never reused", async () => {
  const server = fakeServer()
  const cache = createReadCache(server.fetchImpl, { appStart: true })
  await cache.fetch(`${BASE}/athletes?select=id&user_id=eq.${UID}`, { method: "GET", headers: AUTH })
  await cache.fetch(`${BASE}/unit_preferences`, { method: "POST", headers: AUTH, body: "{}" })
  await cache.fetch(`${BASE}/athletes?select=id&user_id=eq.${UID}`, { method: "GET", headers: AUTH })
  assert.deepEqual(server.calls, ["POST /rpc/get_app_start", "POST /unit_preferences", "POST /rpc/get_app_start"])
})

test("live counts never start a bundle on their own", async () => {
  const server = fakeServer()
  const cache = createReadCache(server.fetchImpl, { appStart: true })
  await cache.fetch(`${BASE}/rpc/get_message_unread_counts`, { method: "POST", headers: AUTH, body: "{}" })
  assert.deepEqual(server.calls, ["POST /rpc/get_message_unread_counts"])
})
