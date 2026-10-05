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
  isCoachOrAdmin: boolean
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
    caller: { id: "user-1" }, callerTenant: TENANT_A, isClubAdmin: true, isCoachOrAdmin: true, prefEnabled: true,
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
      rpc: (name: string) => Promise.resolve({ data: name === "current_tenant_id" ? w.callerTenant : name === "is_club_admin" ? w.isClubAdmin : w.isCoachOrAdmin, error: null }),
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
  const w = makeWorld({ isClubAdmin: false, isCoachOrAdmin: false }, {}, "athlete_invites")
  const r = await call(w, { kind: "athlete", inviteId: INVITE }); assertEquals([r.status, r.body.code], [403, "not_allowed"])
})
Deno.test("not allowed: inactive member or suspended club (no current tenant)", async () => {
  const r = await call(makeWorld({ callerTenant: null, isClubAdmin: false, isCoachOrAdmin: false })); assertEquals(r.body.code, "not_allowed")
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
Deno.test("success: athlete invite sent by a coach", async () => {
  const w = makeWorld({ isClubAdmin: false }, {}, "athlete_invites")
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
