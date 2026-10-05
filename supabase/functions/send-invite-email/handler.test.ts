// Run with: deno test supabase/functions/send-invite-email/
// Calls the real handler with a fake Supabase client, a fake Resend and a fixed clock. No network needed.
// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */
import { handleSendInviteEmail, type HandlerDeps } from "./handler.ts"
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m) }
function assertEquals(a: unknown, b: unknown) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`expected ${y}\n     got ${x}`) }

const INVITE = "11111111-1111-4111-8111-111111111111"
const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const NOW = new Date("2026-10-06T12:00:00.000Z")

type World = {
  tables: Record<string, any[]>
  caller: { id: string } | null
  callerTenant: string | null
  isClubAdmin: boolean
  /** Teams the caller is an assigned coach of, as is_team_coach() would answer. */
  coachTeamIds: string[]
  /** Makes the is_team_coach call fail, as it would before the coach team scope migration has run. */
  teamCoachRpcFails?: boolean
  rpcCalls: Array<{ name: string; args: unknown }>
  prefEnabled: boolean
  env: Record<string, string | undefined>
  resend: { status: number; body: any } | "throw"
  fetchCalls: any[]
}

function makeWorld(over: Partial<World> = {}, invite: Record<string, unknown> = {}, table = "coach_invites"): World {
  const w: World = {
    tables: {
      coach_invites: [], athlete_invites: [],
      tenants: [{ id: TENANT_A, name: "Elite Track Club" }],
      teams: [{ id: "team-1", name: "Sprints <A>" }],
      profiles: [{ user_id: "user-1", display_name: "Dana Admin", role: "club-admin" }],
      audit_events: [],
    },
    caller: { id: "user-1" }, callerTenant: TENANT_A, isClubAdmin: true, coachTeamIds: [], rpcCalls: [], prefEnabled: true,
    env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "svc", RESEND_API_KEY: "re_x", NOTIFICATION_FROM_EMAIL: "hello@sktr.test", PUBLIC_APP_URL: "https://app.sktr.test/some/path" },
    resend: { status: 200, body: { id: "msg_1" } }, fetchCalls: [],
    ...over,
  }
  w.tables[table].push({ id: INVITE, tenant_id: TENANT_A, team_id: "team-1", email: "New.Coach@Example.com", status: "pending", expires_at: "2026-10-20T12:00:00.000Z", email_send_count: 0, last_email_attempt_at: null, last_email_sent_at: null, last_email_error: null, ...invite })
  return w
}

function query(w: World, table: string) {
  const filters: Array<(r: any) => boolean> = []
  let op: "select" | "update" | "insert" = "select"
  let patch: any = null
  const run = () => {
    const rows = w.tables[table].filter((r) => filters.every((f) => f(r)))
    if (op === "update") rows.forEach((r) => Object.assign(r, patch))
    return rows.map((r) => ({ ...r }))
  }
  const b: any = {
    select() { return b },
    update(p: any) { op = "update"; patch = p; return b },
    insert(row: any) { w.tables[table].push(row); return Promise.resolve({ data: null, error: null }) },
    eq(c: string, v: any) { filters.push((r) => r[c] === v); return b },
    lt(c: string, v: any) { filters.push((r) => r[c] < v); return b },
    or(expr: string) {
      const m = expr.match(/^last_email_attempt_at\.is\.null,last_email_attempt_at\.lt\."(.+)"$/)
      if (!m) throw new Error("unexpected or(): " + expr)
      filters.push((r) => r.last_email_attempt_at === null || r.last_email_attempt_at < m[1]); return b
    },
    maybeSingle() { const rows = run(); return Promise.resolve({ data: rows[0] ?? null, error: null }) },
    then(res: any, rej: any) { return Promise.resolve({ data: run(), error: null }).then(res, rej) },
  }
  return b
}

function deps(w: World): HandlerDeps {
  return {
    getEnv: (n) => w.env[n],
    createUserClient: () => ({
      auth: { getUser: () => Promise.resolve(w.caller ? { data: { user: w.caller }, error: null } : { data: { user: null }, error: { message: "bad jwt" } }) },
      rpc: (name: string, args?: any) => {
        w.rpcCalls.push({ name, args })
        if (name === "current_tenant_id") return Promise.resolve({ data: w.callerTenant, error: null })
        if (name === "is_club_admin") return Promise.resolve({ data: w.isClubAdmin, error: null })
        if (name === "is_team_coach") {
          if (w.teamCoachRpcFails) return Promise.resolve({ data: null, error: { message: "function is_team_coach does not exist" } })
          return Promise.resolve({ data: w.coachTeamIds.includes(args?.p_team_id), error: null })
        }
        return Promise.resolve({ data: null, error: { message: "unexpected rpc " + name } })
      },
    }),
    createServiceClient: () => ({
      from: (t: string) => query(w, t),
      rpc: () => Promise.resolve({ data: w.prefEnabled, error: null }),
    }),
    fetch: ((url: string, init: any) => {
      w.fetchCalls.push({ url, init, body: JSON.parse(init.body) })
      if (w.resend === "throw") return Promise.reject(new Error("network down"))
      return Promise.resolve(new Response(JSON.stringify(w.resend.body), { status: w.resend.status }))
    }) as any,
    now: () => NOW,
  }
}

async function call(w: World, body: unknown = { kind: "coach", inviteId: INVITE }, init: { method?: string; auth?: boolean } = {}) {
  const res = await handleSendInviteEmail(new Request("https://fn/send-invite-email", {
    method: init.method ?? "POST",
    headers: init.auth === false ? {} : { Authorization: "Bearer jwt" },
    body: (init.method ?? "POST") === "POST" ? JSON.stringify(body) : undefined,
  }), deps(w))
  return { status: res.status, body: res.status === 200 && res.headers.get("Content-Type") === null ? null : await res.json().catch(() => null), headers: res.headers }
}

Deno.test("OPTIONS and wrong method", async () => {
  assertEquals((await call(makeWorld(), null, { method: "OPTIONS" })).status, 200)
  const r = await call(makeWorld(), null, { method: "GET" }); assertEquals([r.status, r.body.code], [405, "method_not_allowed"])
})
Deno.test("no auth header / bad jwt", async () => {
  let r = await call(makeWorld(), undefined, { auth: false }); assertEquals([r.status, r.body.code], [401, "not_authenticated"])
  r = await call(makeWorld({ caller: null })); assertEquals([r.status, r.body.code], [401, "not_authenticated"])
})
Deno.test("invalid payload", async () => {
  for (const body of [{}, { kind: "admin", inviteId: INVITE }, { kind: "coach", inviteId: "nope" }, "x"]) {
    const r = await call(makeWorld(), body); assertEquals([r.status, r.body.code], [400, "invalid_request"])
  }
})
Deno.test("missing supabase env", async () => {
  const w = makeWorld(); w.env.SUPABASE_SERVICE_ROLE_KEY = undefined
  const r = await call(w); assertEquals([r.status, r.body.code], [500, "server_misconfigured"])
})
Deno.test("not allowed: coach cannot send a coach invite", async () => {
  const w = makeWorld({ isClubAdmin: false }); const r = await call(w)
  assertEquals([r.status, r.body.code], [403, "not_allowed"]); assertEquals(w.fetchCalls.length, 0)
})
Deno.test("not allowed: athlete cannot send an athlete invite", async () => {
  const w = makeWorld({ isClubAdmin: false }, {}, "athlete_invites")
  const r = await call(w, { kind: "athlete", inviteId: INVITE }); assertEquals([r.status, r.body.code], [403, "not_allowed"])
})
Deno.test("not allowed: coach cannot send the athlete invite of a team they are not assigned to", async () => {
  // Coach Rivera coaches team-2 (Sprints). The invite is for team-1 (Coach Smith's team) in the same club.
  const w = makeWorld({ isClubAdmin: false, coachTeamIds: ["team-2"] }, {}, "athlete_invites")
  const r = await call(w, { kind: "athlete", inviteId: INVITE })
  assertEquals([r.status, r.body.code], [403, "not_allowed"]); assertEquals(w.fetchCalls.length, 0)
  assertEquals(w.rpcCalls.filter((c) => c.name === "is_team_coach").map((c) => c.args), [{ p_team_id: "team-1" }])
  assertEquals([w.tables.athlete_invites[0].email_send_count, w.tables.audit_events.length], [0, 0])
  // Same answer as an invite that does not exist.
  const missing = await call(makeWorld({ isClubAdmin: false, coachTeamIds: ["team-2"] }, {}, "athlete_invites"), { kind: "athlete", inviteId: "22222222-2222-4222-8222-222222222222" })
  assertEquals([r.status, r.body.error], [missing.status, missing.body.error])
})
Deno.test("not allowed: coach with no team assignment cannot send an athlete invite", async () => {
  const w = makeWorld({ isClubAdmin: false, coachTeamIds: [] }, {}, "athlete_invites")
  const r = await call(w, { kind: "athlete", inviteId: INVITE }); assertEquals([r.status, r.body.code], [403, "not_allowed"]); assertEquals(w.fetchCalls.length, 0)
})
Deno.test("not allowed: team check that cannot be answered counts as no", async () => {
  const w = makeWorld({ isClubAdmin: false, coachTeamIds: ["team-1"], teamCoachRpcFails: true }, {}, "athlete_invites")
  const r = await call(w, { kind: "athlete", inviteId: INVITE }); assertEquals([r.status, r.body.code], [403, "not_allowed"]); assertEquals(w.fetchCalls.length, 0)
})
Deno.test("not allowed: assigned coach of another club's team is never asked about, and is refused", async () => {
  const w = makeWorld({ isClubAdmin: false, callerTenant: TENANT_B, coachTeamIds: ["team-1"] }, {}, "athlete_invites")
  const r = await call(w, { kind: "athlete", inviteId: INVITE }); assertEquals([r.status, r.body.code], [403, "not_allowed"])
  assertEquals(w.rpcCalls.filter((c) => c.name === "is_team_coach").length, 0)
})
Deno.test("not allowed: being assigned to a team does not let a coach send a coach invite", async () => {
  const w = makeWorld({ isClubAdmin: false, coachTeamIds: ["team-1"] })
  const r = await call(w); assertEquals([r.status, r.body.code], [403, "not_allowed"]); assertEquals(w.fetchCalls.length, 0)
})
Deno.test("success: club admin sends an athlete invite for any team of the club without a team check", async () => {
  const w = makeWorld({ coachTeamIds: [] }, {}, "athlete_invites")
  const r = await call(w, { kind: "athlete", inviteId: INVITE }); assertEquals(r.status, 200); assertEquals(w.fetchCalls.length, 1)
  assertEquals(w.rpcCalls.filter((c) => c.name === "is_team_coach").length, 0)
})
Deno.test("not allowed: inactive member or suspended club (no current tenant)", async () => {
  const r = await call(makeWorld({ callerTenant: null, isClubAdmin: false })); assertEquals(r.body.code, "not_allowed")
})
Deno.test("wrong tenant and unknown invite look identical", async () => {
  const a = await call(makeWorld({ callerTenant: TENANT_B }))
  const b = await call(makeWorld(), { kind: "coach", inviteId: "22222222-2222-4222-8222-222222222222" })
  assertEquals([a.status, a.body.code, a.body.error], [403, "not_allowed", b.body.error]); assertEquals(b.status, 403)
  // kind mismatch: athlete invite id sent as coach
  const c = await call(makeWorld({}, {}, "athlete_invites")); assertEquals(c.body.code, "not_allowed")
})
Deno.test("not sendable: expired, revoked, accepted, status expired, no email", async () => {
  for (const [inv, reason] of [[{ expires_at: "2026-10-06T11:59:59.000Z" }, "expired"], [{ status: "revoked" }, "revoked"], [{ status: "accepted" }, "accepted"], [{ status: "expired" }, "expired"], [{ email: null }, "no_email"]] as const) {
    const w = makeWorld({}, inv); const r = await call(w)
    assertEquals([r.status, r.body.code, r.body.reason], [409, "invite_not_sendable", reason]); assertEquals(w.fetchCalls.length, 0)
  }
})
Deno.test("provider not configured (hosted url) and missing app url", async () => {
  let w = makeWorld(); w.env.RESEND_API_KEY = undefined
  let r = await call(w); assertEquals([r.status, r.body.code, r.body.missing], [503, "email_not_configured", ["RESEND_API_KEY"]])
  assertEquals(w.tables.coach_invites[0].last_email_error, "email_not_configured"); assertEquals(w.tables.coach_invites[0].last_email_attempt_at, null)
  w = makeWorld(); w.env.PUBLIC_APP_URL = undefined
  r = await call(w); assertEquals([r.body.code, r.body.missing], ["email_not_configured", ["PUBLIC_APP_URL"]])
  w = makeWorld(); w.env.PUBLIC_APP_URL = "javascript:alert(1)"
  r = await call(w); assertEquals(r.body.code, "email_not_configured")
})
Deno.test("recipient opted out", async () => {
  const w = makeWorld({ prefEnabled: false }); const r = await call(w)
  assertEquals([r.status, r.body.code], [409, "recipient_opted_out"]); assertEquals(w.fetchCalls.length, 0)
})
Deno.test("rate limited: cooldown and max sends", async () => {
  let w = makeWorld({}, { last_email_attempt_at: "2026-10-06T11:59:30.000Z", email_send_count: 1 })
  let r = await call(w); assertEquals([r.status, r.body.code, r.body.reason, r.body.retryAfterSeconds, r.headers.get("Retry-After")], [429, "rate_limited", "cooldown", 30, "30"])
  w = makeWorld({}, { email_send_count: 5, last_email_attempt_at: "2026-10-01T00:00:00.000Z" })
  r = await call(w); assertEquals([r.status, r.body.code, r.body.reason], [429, "rate_limited", "max_sends"]); assertEquals(w.fetchCalls.length, 0)
})
Deno.test("provider error releases the slot and audits", async () => {
  for (const resend of [{ status: 422, body: { message: "domain not verified" } }, "throw"] as const) {
    const w = makeWorld({ resend }); const r = await call(w)
    assertEquals([r.status, r.body.code], [502, "provider_failure"])
    assert(!JSON.stringify(r.body).includes("domain not verified"))
    const row = w.tables.coach_invites[0]
    assertEquals([row.last_email_attempt_at, row.email_send_count, row.last_email_error, row.last_email_sent_at], [null, 0, "provider_failure", null])
    assertEquals(w.tables.audit_events[0].action, "coach_invite_email_failed")
    // retry immediately works once the provider recovers
    w.resend = { status: 200, body: { id: "msg_2" } }
    assertEquals((await call(w)).status, 200)
  }
})
Deno.test("success: coach, then immediate resend is rate limited, later resend audited as resent", async () => {
  const w = makeWorld()
  const r = await call(w, { kind: "coach", inviteId: INVITE, appBaseUrl: "https://evil.example", email: "attacker@evil.example" })
  assertEquals([r.status, r.body.ok, r.body.sendCount, r.body.resend, r.body.recipientEmail], [200, true, 1, false, "new.coach@example.com"])
  assertEquals(r.body.actionLink, undefined)
  const sent = w.fetchCalls[0].body
  assertEquals(sent.to, ["new.coach@example.com"]); assertEquals(sent.from, "SKTR Coach <hello@sktr.test>")
  assert(sent.text.includes(`https://app.sktr.test/invite/coach/${INVITE}`)); assert(!JSON.stringify(sent).includes("evil.example"))
  assert(sent.html.includes("Sprints &lt;A&gt;")); assert(!sent.html.includes("Sprints <A>"))
  assertEquals(sent.subject, "Dana Admin invited you to coach at Elite Track Club")
  const row = w.tables.coach_invites[0]
  assertEquals([row.email_send_count, row.last_email_error, row.last_email_sent_at, row.last_email_attempt_at], [1, null, NOW.toISOString(), NOW.toISOString()])
  assertEquals([w.tables.audit_events[0].action, w.tables.audit_events[0].tenant_id, w.tables.audit_events[0].target], ["coach_invite_email_sent", TENANT_A, "new.coach@example.com"])
  const again = await call(w); assertEquals([again.status, again.body.code], [429, "rate_limited"]); assertEquals(w.fetchCalls.length, 1)
  row.last_email_attempt_at = "2026-10-06T11:00:00.000Z"
  const later = await call(w); assertEquals([later.status, later.body.sendCount, later.body.resend], [200, 2, true])
  assertEquals(w.tables.audit_events[1].action, "coach_invite_email_resent")
})
Deno.test("success: athlete invite sent by a coach assigned to that team", async () => {
  const w = makeWorld({ isClubAdmin: false, coachTeamIds: ["team-1"] }, {}, "athlete_invites")
  w.tables.profiles[0] = { user_id: "user-1", display_name: "Coach Kay", role: "coach" }
  const r = await call(w, { kind: "athlete", inviteId: INVITE }); assertEquals(r.status, 200)
  const sent = w.fetchCalls[0].body
  assert(sent.text.includes(`https://app.sktr.test/athlete/claim/${INVITE}`))
  assertEquals(sent.subject, "Coach Kay invited you to join Sprints <A> at Elite Track Club")
  assertEquals([w.tables.audit_events[0].action, w.tables.audit_events[0].actor_role], ["athlete_invite_email_sent", "coach"])
})
Deno.test("two simultaneous requests send one email", async () => {
  const w = makeWorld(); const [a, b] = await Promise.all([call(w), call(w)])
  assertEquals([a.status, b.status].sort(), [200, 429]); assertEquals(w.fetchCalls.length, 1)
})
Deno.test("local preview: localhost app url without provider sends nothing, returns link", async () => {
  const w = makeWorld(); w.env.RESEND_API_KEY = undefined; w.env.NOTIFICATION_FROM_EMAIL = undefined; w.env.PUBLIC_APP_URL = "http://localhost:3007"
  const r = await call(w); assertEquals([r.status, r.body.preview, r.body.actionLink], [200, true, `http://localhost:3007/invite/coach/${INVITE}`]); assertEquals(w.fetchCalls.length, 0)
})

// ---- Batch mode: { kind, inviteIds } ------------------------------------------------------------
const I2 = "22222222-2222-4222-8222-222222222222"
const I3 = "33333333-3333-4333-8333-333333333333"
const I4 = "44444444-4444-4444-8444-444444444444"
const I5 = "55555555-5555-4555-8555-555555555555"
function batchWorld(over: Partial<World> = {}) {
  const w = makeWorld({ isClubAdmin: false, coachTeamIds: ["team-1"], ...over }, { email: "a1@example.com" }, "athlete_invites")
  w.tables.teams.push({ id: "team-2", name: "Throws" })
  const base = { tenant_id: TENANT_A, team_id: "team-1", status: "pending", expires_at: "2026-10-20T12:00:00.000Z", email_send_count: 0, last_email_attempt_at: null, last_email_sent_at: null, last_email_error: null }
  w.tables.athlete_invites.push(
    { ...base, id: I2, email: "a2@example.com" },
    { ...base, id: I3, email: "a3@example.com", team_id: "team-2" },          // a team this coach is not on
    { ...base, id: I4, email: "a4@example.com", status: "revoked" },
    { ...base, id: I5, email: "a5@example.com", tenant_id: TENANT_B },        // another club
  )
  return w
}
Deno.test("batch: invalid payloads", async () => {
  const tooMany = Array.from({ length: 26 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
  for (const body of [{ kind: "athlete", inviteIds: [] }, { kind: "athlete", inviteIds: "x" }, { kind: "athlete", inviteIds: [INVITE, "nope"] }, { kind: "admin", inviteIds: [INVITE] }, { kind: "athlete", inviteIds: tooMany }, { kind: "athlete", inviteIds: [INVITE, 7] }]) {
    const w = batchWorld(); const r = await call(w, body)
    assertEquals([r.status, r.body.code], [400, "invalid_request"]); assertEquals(w.fetchCalls.length, 0)
  }
})
Deno.test("batch: needs a signed-in caller, like a single send", async () => {
  let r = await call(batchWorld(), { kind: "athlete", inviteIds: [INVITE] }, { auth: false }); assertEquals([r.status, r.body.code], [401, "not_authenticated"])
  r = await call(batchWorld({ caller: null }), { kind: "athlete", inviteIds: [INVITE] }); assertEquals([r.status, r.body.code], [401, "not_authenticated"])
})
Deno.test("batch: every invite gets the single-send checks, results come back per invite and in order", async () => {
  const w = batchWorld()
  const r = await call(w, { kind: "athlete", inviteIds: [INVITE, I2, I3, I4, I5, "99999999-9999-4999-8999-999999999999", INVITE] })
  assertEquals([r.status, r.body.ok, r.body.batch, r.body.sent, r.body.failed], [200, true, true, 2, 4])
  assertEquals(r.body.results.map((x: any) => [x.inviteId, x.ok, x.code ?? null]), [
    [INVITE, true, null],
    [I2, true, null],
    [I3, false, "not_allowed"],            // other team of the same club
    [I4, false, "invite_not_sendable"],    // cancelled
    [I5, false, "not_allowed"],            // other club
    ["99999999-9999-4999-8999-999999999999", false, "not_allowed"],   // does not exist: same answer
  ])
  // The repeated id was sent once.
  assertEquals(w.fetchCalls.map((c) => c.body.to[0]), ["a1@example.com", "a2@example.com"])
  assertEquals(w.tables.athlete_invites.map((row) => row.email_send_count), [1, 1, 0, 0, 0])
  assertEquals(w.tables.audit_events.map((e) => [e.action, e.target]), [["athlete_invite_email_sent", "a1@example.com"], ["athlete_invite_email_sent", "a2@example.com"]])
  // is_team_coach was asked once per team, never for the other club's invite.
  assertEquals(w.rpcCalls.filter((c) => c.name === "is_team_coach").map((c: any) => c.args.p_team_id), ["team-1", "team-2"])
  // Refusals look the same whether the invite exists or not.
  assertEquals(r.body.results[2].error, r.body.results[5].error)
})
Deno.test("batch: per-invite rate limits still apply", async () => {
  const w = batchWorld()
  w.tables.athlete_invites[0].last_email_attempt_at = "2026-10-06T11:59:30.000Z"   // sent 30 seconds ago
  w.tables.athlete_invites[1].email_send_count = 5                                  // at the maximum
  const r = await call(w, { kind: "athlete", inviteIds: [INVITE, I2] })
  assertEquals(r.body.results.map((x: any) => [x.ok, x.code, x.reason, x.retryAfterSeconds ?? null]), [[false, "rate_limited", "cooldown", 30], [false, "rate_limited", "max_sends", null]])
  assertEquals(w.fetchCalls.length, 0)
  // Sending the same batch twice in a row sends nothing the second time.
  const w2 = batchWorld()
  assertEquals((await call(w2, { kind: "athlete", inviteIds: [INVITE, I2] })).body.sent, 2)
  const again = await call(w2, { kind: "athlete", inviteIds: [INVITE, I2] })
  assertEquals([again.body.sent, again.body.results.map((x: any) => x.code)], [0, ["rate_limited", "rate_limited"]]); assertEquals(w2.fetchCalls.length, 2)
})
Deno.test("batch: one provider failure does not stop the rest, and can be retried", async () => {
  const w = batchWorld({ isClubAdmin: true })
  let calls = 0
  const d = deps(w)
  const realFetch = d.fetch
  d.fetch = ((url: string, init: any) => {
    calls += 1
    if (calls === 2) { w.fetchCalls.push({ url, init, body: JSON.parse(init.body) }); return Promise.resolve(new Response(JSON.stringify({ message: "rate limit exceeded" }), { status: 429 })) }
    return realFetch(url, init)
  }) as any
  const slept: number[] = []
  d.sleep = (ms) => { slept.push(ms); return Promise.resolve() }
  const res = await handleSendInviteEmail(new Request("https://fn/send-invite-email", { method: "POST", headers: { Authorization: "Bearer jwt" }, body: JSON.stringify({ kind: "athlete", inviteIds: [INVITE, I2, I3] }) }), d)
  const body = await res.json()
  assertEquals(body.results.map((x: any) => [x.ok, x.code ?? null]), [[true, null], [false, "provider_failure"], [true, null]])
  assert(!JSON.stringify(body).includes("rate limit exceeded"))
  // It paused before the second and third provider call, not before the first.
  assertEquals(slept.length, 2)
  // The failed one gave its slot back, so a retry right away goes out.
  const row = w.tables.athlete_invites[1]
  assertEquals([row.email_send_count, row.last_email_attempt_at, row.last_email_error], [0, null, "provider_failure"])
  const retry = await call(w, { kind: "athlete", inviteIds: [I2] })
  assertEquals([retry.body.sent, retry.body.results[0].sendCount], [1, 1])
})
Deno.test("batch: a coach cannot batch coach invites, a club admin of another club gets nothing", async () => {
  const w = makeWorld({ isClubAdmin: false, coachTeamIds: ["team-1"] })
  let r = await call(w, { kind: "coach", inviteIds: [INVITE] }); assertEquals([r.status, r.body.sent, r.body.results[0].code], [200, 0, "not_allowed"]); assertEquals(w.fetchCalls.length, 0)
  const other = batchWorld({ isClubAdmin: true, callerTenant: TENANT_B })
  r = await call(other, { kind: "athlete", inviteIds: [INVITE, I2] }); assertEquals(r.body.results.map((x: any) => x.code), ["not_allowed", "not_allowed"]); assertEquals(other.fetchCalls.length, 0)
})
Deno.test("batch: email not configured is reported per invite", async () => {
  const w = batchWorld(); w.env.RESEND_API_KEY = undefined
  const r = await call(w, { kind: "athlete", inviteIds: [INVITE, I2] })
  assertEquals([r.status, r.body.sent, r.body.results.map((x: any) => x.code)], [200, 0, ["email_not_configured", "email_not_configured"]])
})
