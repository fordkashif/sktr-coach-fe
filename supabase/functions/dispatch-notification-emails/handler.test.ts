// Run with: deno test supabase/functions/dispatch-notification-emails/
// Calls the real handler with a fake Supabase client, a fake Resend and a clock the test controls.
// The fake queue follows the rules of claim_notification_emails / complete_notification_email in
// migration 20261007090000 (those functions have their own tests against a real Postgres). No network needed.
// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */
import { handleDispatchNotificationEmails, SCHEDULER_TOKEN_HEADER, type HandlerDeps } from "./handler.ts"
import { bodyParagraphs, readProviderResponse, renderNotificationEmail } from "./notification-email.ts"
import { notificationTargetPath } from "../_shared/notification-target.ts"
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m) }
function assertEquals(a: unknown, b: unknown) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`expected ${y}\n     got ${x}`) }

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const PLAN = "99999999-9999-4999-8999-999999999999"
const TOKEN = "t".repeat(64)
const eid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

type Row = {
  id: string; tenant_id: string | null; tenant_name: string | null; recipient_user_id: string | null; recipient_email: string
  recipient_role: string | null; event_type: string; subject: string; body: string | null; metadata: any; created_at: string
  status: string; delivery_attempt_count: number; processing_started_at: number | null; next_attempt_at: number | null
  last_error: string | null; provider_message_id: string | null; delivered_at: number | null
  /** What the database would decide at claim time (deactivated recipient, suspended club, switched off, too old). */
  holdBack?: string
}

type World = {
  rows: Row[]
  caller: { id: string } | null
  isPlatformAdmin: boolean
  callerTenant: string | null
  env: Record<string, string | undefined>
  /** One answer per call, the last one repeats. "throw" is a network failure. */
  resend: Array<{ status: number; body: any } | "throw">
  fetchCalls: any[]
  rpcCalls: Array<{ name: string; args: any }>
  nowMs: number
  /** Milliseconds the clock moves on every provider call. */
  sendTakesMs: number
  claimFails?: boolean
  registeredUrl: string | null
  runs: any[]
  sleeps: number[]
}

function row(n: number, over: Partial<Row> = {}): Row {
  return {
    id: eid(n), tenant_id: TENANT_A, tenant_name: "Elite Track Club", recipient_user_id: `user-${n}`, recipient_email: `athlete${n}@example.com`,
    recipient_role: "athlete", event_type: "training_plan_published", subject: "New training plan: Sprint block",
    body: "Your coach published a plan for Sprints. It starts on 12 Oct 2026.", metadata: { plan_id: PLAN }, created_at: "2026-10-07T11:00:00.000Z",
    status: "pending", delivery_attempt_count: 0, processing_started_at: null, next_attempt_at: null, last_error: null, provider_message_id: null, delivered_at: null,
    ...over,
  }
}

function makeWorld(over: Partial<World> = {}): World {
  return {
    rows: [row(1), row(2)], caller: null, isPlatformAdmin: false, callerTenant: null,
    env: { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service-role-key", RESEND_API_KEY: "re_x", NOTIFICATION_FROM_EMAIL: "hello@sktr.test", PUBLIC_APP_URL: "https://app.sktr.test/some/path" },
    resend: [{ status: 200, body: { id: "msg_1" } }], fetchCalls: [], rpcCalls: [], nowMs: Date.parse("2026-10-07T12:00:00.000Z"), sendTakesMs: 0,
    registeredUrl: null, runs: [], sleeps: [],
    ...over,
  }
}

// claim_notification_emails, in JavaScript. It runs to completion without awaiting, as the SQL function
// runs under row locks, so two handler runs interleaving their awaits still get different rows.
function claim(w: World, args: any): Row[] {
  const out: Row[] = []
  const candidates = w.rows
    .filter((r) => (r.status === "pending" || r.status === "failed") && r.delivery_attempt_count < 5)
    .filter((r) => r.processing_started_at === null || r.processing_started_at < w.nowMs - 600_000)
    .filter((r) => args.p_ignore_backoff || r.next_attempt_at === null || r.next_attempt_at <= w.nowMs)
    .filter((r) => !args.p_tenant_id || r.tenant_id === args.p_tenant_id)
    .filter((r) => !args.p_event_ids || args.p_event_ids.includes(r.id))
    .slice(0, args.p_limit)
  for (const r of candidates) {
    if (r.holdBack) { r.status = "suppressed"; r.last_error = r.holdBack; continue }
    r.processing_started_at = w.nowMs
    r.delivery_attempt_count += 1
    out.push({ ...r })
  }
  return out
}

function complete(w: World, args: any): boolean {
  const r = w.rows.find((x) => x.id === args.p_event_id)
  if (!r || r.processing_started_at === null || !(r.status === "pending" || r.status === "failed")) return false
  if (args.p_sent) { r.status = "sent"; r.delivered_at = w.nowMs; r.provider_message_id = args.p_provider_message_id; r.last_error = null; r.next_attempt_at = null }
  else {
    r.status = "failed"; r.last_error = args.p_error
    if (args.p_retry) r.next_attempt_at = w.nowMs + 60_000 * 2 ** r.delivery_attempt_count
    else { r.next_attempt_at = null; r.delivery_attempt_count = Math.max(r.delivery_attempt_count, 5) }
  }
  r.processing_started_at = null
  return true
}

function deps(w: World): HandlerDeps {
  return {
    getEnv: (n) => w.env[n],
    createUserClient: () => ({
      auth: { getUser: () => Promise.resolve(w.caller ? { data: { user: w.caller }, error: null } : { data: { user: null }, error: { message: "bad jwt" } }) },
      from: (t: string) => {
        if (t !== "platform_admin_contacts") throw new Error("unexpected table " + t)
        const b: any = { select: () => b, limit: () => b, maybeSingle: () => Promise.resolve({ data: w.isPlatformAdmin ? { id: "pac-1" } : null, error: null }) }
        return b
      },
      rpc: (name: string) => {
        if (name === "current_tenant_id") return Promise.resolve({ data: w.callerTenant, error: null })
        return Promise.resolve({ data: null, error: { message: "unexpected rpc " + name } })
      },
    }),
    createServiceClient: () => ({
      rpc: (name: string, args: any) => {
        w.rpcCalls.push({ name, args })
        if (name === "verify_notification_scheduler_token") return Promise.resolve({ data: args.p_token === TOKEN, error: null })
        if (name === "register_notification_dispatch_url") { w.registeredUrl = args.p_url; return Promise.resolve({ data: true, error: null }) }
        if (name === "record_notification_dispatch_run") { w.runs.push(args); return Promise.resolve({ data: null, error: null }) }
        if (name === "claim_notification_emails") {
          if (w.claimFails) return Promise.resolve({ data: null, error: { message: "db down" } })
          return Promise.resolve({ data: claim(w, args), error: null })
        }
        if (name === "complete_notification_email") return Promise.resolve({ data: complete(w, args), error: null })
        return Promise.resolve({ data: null, error: { message: "unexpected rpc " + name } })
      },
      from: (t: string) => {
        if (t !== "notification_events") throw new Error("unexpected table " + t)
        let patch: any = null
        const filters: Array<(r: any) => boolean> = []
        const b: any = {
          update(p: any) { patch = p; return b },
          eq(c: string, v: any) { filters.push((r) => (c === "channel" ? true : r[c] === v)); return b },
          then(res: any, rej: any) { w.rows.filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: null, error: null }).then(res, rej) },
        }
        return b
      },
    }),
    fetch: ((url: string, init: any) => {
      const answer = w.resend[Math.min(w.fetchCalls.length, w.resend.length - 1)]
      w.fetchCalls.push({ url, init, body: JSON.parse(init.body), headers: init.headers })
      w.nowMs += w.sendTakesMs
      // The provider answers a tick later, which is where two runs at once would trip over each other.
      return new Promise((resolve, reject) => setTimeout(() => (answer === "throw" ? reject(new Error("network down")) : resolve(new Response(JSON.stringify(answer.body), { status: answer.status }))), 1))
    }) as any,
    now: () => new Date(w.nowMs),
    sleep: (ms) => { w.sleeps.push(ms); return Promise.resolve() },
  }
}

type CallInit = { method?: string; token?: string | null; bearer?: string | null; body?: unknown }
async function call(w: World, init: CallInit = {}) {
  const headers: Record<string, string> = {}
  if (init.token !== undefined && init.token !== null) headers[SCHEDULER_TOKEN_HEADER] = init.token
  if (init.bearer !== undefined && init.bearer !== null) headers.Authorization = `Bearer ${init.bearer}`
  const method = init.method ?? "POST"
  const res = await handleDispatchNotificationEmails(new Request("https://fn/dispatch-notification-emails", { method, headers, body: method === "POST" ? JSON.stringify(init.body ?? {}) : undefined }), deps(w))
  return { status: res.status, body: await res.json().catch(() => null) }
}
const scheduler = (w: World, body?: unknown) => call(w, { token: TOKEN, body })
const statuses = (w: World) => w.rows.map((r) => r.status)

Deno.test("OPTIONS and wrong method", async () => {
  assertEquals((await call(makeWorld(), { method: "OPTIONS" })).status, 200)
  const r = await call(makeWorld(), { method: "GET" }); assertEquals([r.status, r.body.code], [405, "method_not_allowed"])
})
Deno.test("missing Supabase environment", async () => {
  const w = makeWorld(); w.env.SUPABASE_SERVICE_ROLE_KEY = undefined
  const r = await scheduler(w); assertEquals([r.status, r.body.code], [500, "server_misconfigured"])
})
Deno.test("nobody: no token and no sign-in", async () => {
  const w = makeWorld(); const r = await call(w)
  assertEquals([r.status, r.body.code], [401, "not_authenticated"]); assertEquals(w.fetchCalls.length, 0); assertEquals(statuses(w), ["pending", "pending"])
})
Deno.test("bad, empty or stale scheduler token is refused and sends nothing, even with a valid sign-in next to it", async () => {
  for (const token of ["wrong", "", "t".repeat(63)]) {
    const w = makeWorld({ caller: { id: "admin" }, isPlatformAdmin: true })
    const r = await call(w, { token, bearer: "jwt" })
    assertEquals([r.status, r.body.code], [401, "bad_scheduler_token"]); assertEquals(w.fetchCalls.length, 0)
    assertEquals(w.rows.every((x) => x.delivery_attempt_count === 0), true)
  }
})
Deno.test("bad jwt", async () => {
  const r = await call(makeWorld(), { bearer: "jwt" }); assertEquals([r.status, r.body.code], [401, "not_authenticated"])
})
Deno.test("scheduler: sends everything, records each as sent, registers its address and the run", async () => {
  const w = makeWorld(); const r = await scheduler(w)
  assertEquals([r.status, r.body.ok, r.body.mode, r.body.processed, r.body.sent, r.body.failed], [200, true, "scheduler", 2, 2, 0])
  assertEquals(r.body.results, []) // the scheduler is told counts, not who was emailed
  assertEquals(statuses(w), ["sent", "sent"]); assertEquals(w.rows[0].provider_message_id, "msg_1"); assertEquals(w.rows[0].processing_started_at, null)
  assertEquals(w.registeredUrl, "https://proj.supabase.co/functions/v1/dispatch-notification-emails")
  assertEquals(w.runs.length, 1); assertEquals([w.runs[0].p_mode, w.runs[0].p_summary.sent], ["scheduler", 2])
  assertEquals(w.sleeps, [550]) // paced: one pause between two sends
})
Deno.test("the email: recipient, sender, deep link from PUBLIC_APP_URL, settings link, plain text, idempotency key", async () => {
  const w = makeWorld({ rows: [row(1)] }); await scheduler(w)
  const c = w.fetchCalls[0]
  assertEquals(c.url, "https://api.resend.com/emails")
  assertEquals(c.headers.Authorization, "Bearer re_x"); assertEquals(c.headers["Idempotency-Key"], `sktr-notification-${eid(1)}`)
  assertEquals([c.body.from, c.body.to, c.body.subject], ["SKTR Coach <hello@sktr.test>", ["athlete1@example.com"], "New training plan: Sprint block"])
  assert(c.body.html.includes('href="https://app.sktr.test/athlete/training-plan"'), "button deep link")
  assert(c.body.html.includes('href="https://app.sktr.test/settings/notifications"'), "settings link")
  assert(c.body.html.includes("Open your plan") && c.body.html.includes("#2152ff") && c.body.html.includes("Outfit"), "look")
  assert(c.body.html.includes("on behalf of Elite Track Club"), "club line")
  assert(c.body.text.includes("https://app.sktr.test/athlete/training-plan") && c.body.text.includes("https://app.sktr.test/settings/notifications") && c.body.text.includes("It starts on 12 Oct 2026."), "text alternative")
  assert(!c.body.html.includes("some/path"), "only the origin of PUBLIC_APP_URL is used")
  assert(!c.body.html.includes("—") && !c.body.text.includes("—"), "no em dash")
})
Deno.test("nothing a person typed becomes markup or a link", async () => {
  const w = makeWorld({ rows: [row(1, { subject: 'Hi <script>alert(1)</script>', body: '<a href="https://evil.test">click</a>\nsecond line', tenant_name: "<b>Club</b>", metadata: { session_date: "2026-10-06\"><img>", plan_id: "x" }, event_type: "session_note_added" })] })
  await scheduler(w); const html = w.fetchCalls[0].body.html as string
  assert(!html.includes("<script>") && !html.includes('<a href="https://evil.test"') && !html.includes("<b>Club</b>") && !html.includes("<img>"), "escaped")
  assert(html.includes("&lt;script&gt;") && html.includes("second line"), "kept as text")
  assert(html.includes('href="https://app.sktr.test/athlete/log"'), "a malformed date is dropped from the link")
})
Deno.test("provider failure, then the retry succeeds: one email, attempt counted, never sent twice", async () => {
  const w = makeWorld({ rows: [row(1)], resend: [{ status: 500, body: { message: "upstream exploded" } }, { status: 200, body: { id: "msg_2" } }] })
  let r = await scheduler(w)
  assertEquals([r.body.sent, r.body.failed], [0, 1]); assertEquals([w.rows[0].status, w.rows[0].last_error, w.rows[0].delivery_attempt_count], ["failed", "upstream exploded", 1])
  assertEquals(w.rows[0].next_attempt_at, w.nowMs + 120_000)
  r = await scheduler(w); assertEquals(r.body.processed, 0); assertEquals(w.fetchCalls.length, 1) // still waiting out the delay
  w.nowMs += 121_000
  r = await scheduler(w); assertEquals([r.body.sent, w.rows[0].status, w.rows[0].delivery_attempt_count, w.rows[0].provider_message_id], [1, "sent", 2, "msg_2"])
  r = await scheduler(w); assertEquals(r.body.processed, 0); assertEquals(w.fetchCalls.length, 2)
  assertEquals(w.fetchCalls[0].headers["Idempotency-Key"], w.fetchCalls[1].headers["Idempotency-Key"])
})
Deno.test("network failure is retried later; five failures and it stops for good", async () => {
  const w = makeWorld({ rows: [row(1)], resend: ["throw"] })
  for (let i = 1; i <= 7; i += 1) { await scheduler(w); w.nowMs += 4_000_000 }
  assertEquals([w.rows[0].status, w.rows[0].delivery_attempt_count, w.rows[0].last_error], ["failed", 5, "network down"]); assertEquals(w.fetchCalls.length, 5)
})
Deno.test("an address the provider will never accept is not retried", async () => {
  const w = makeWorld({ rows: [row(1), row(2)], resend: [{ status: 422, body: { message: "Invalid `to` field." } }, { status: 200, body: { id: "ok" } }] })
  const r = await scheduler(w); assertEquals([r.body.sent, r.body.failed], [1, 1])
  assertEquals([w.rows[0].status, w.rows[0].delivery_attempt_count, w.rows[0].next_attempt_at], ["failed", 5, null]); assertEquals(w.rows[1].status, "sent")
  w.nowMs += 9_000_000; await scheduler(w); assertEquals(w.fetchCalls.length, 2)
})
Deno.test("rate limited: the run stops, the rest of the batch goes back untouched and is sent next time", async () => {
  const w = makeWorld({ rows: [row(1), row(2), row(3)], resend: [{ status: 429, body: { message: "Too many requests" } }, { status: 200, body: { id: "ok" } }] })
  let r = await scheduler(w)
  assertEquals([r.body.processed, r.body.sent, r.body.failed, r.body.stopped], [1, 0, 1, "provider"]); assertEquals(w.fetchCalls.length, 1)
  assertEquals(w.rows.map((x) => [x.status, x.delivery_attempt_count, x.processing_started_at]), [["failed", 1, null], ["pending", 0, null], ["pending", 0, null]])
  r = await scheduler(w); assertEquals(r.body.sent, 2); assertEquals(statuses(w), ["failed", "sent", "sent"])
})
Deno.test("already claimed by another run: not sent again; an abandoned claim comes back after ten minutes", async () => {
  const w = makeWorld({ rows: [row(1, { processing_started_at: Date.parse("2026-10-07T11:59:00.000Z"), delivery_attempt_count: 1 }), row(2)] })
  let r = await scheduler(w); assertEquals(r.body.sent, 1); assertEquals(w.fetchCalls.map((c) => c.body.to[0]), ["athlete2@example.com"])
  w.nowMs += 601_000
  r = await scheduler(w); assertEquals(r.body.sent, 1); assertEquals(w.fetchCalls.length, 2); assertEquals(w.rows[0].delivery_attempt_count, 2)
})
Deno.test("held back by the database (switched off, deactivated recipient, suspended club): never reaches the provider", async () => {
  const w = makeWorld({ rows: [
    row(1, { holdBack: "Not sent: turned off in the recipient's notification settings." }),
    row(2, { holdBack: "Not sent: the recipient is no longer an active member of the club." }),
    row(3, { holdBack: "Not sent: the club is suspended or cancelled." }),
    row(4),
  ] })
  const r = await scheduler(w)
  assertEquals([r.body.processed, r.body.sent], [1, 1]); assertEquals(statuses(w), ["suppressed", "suppressed", "suppressed", "sent"])
  assertEquals(w.fetchCalls.map((c) => c.body.to[0]), ["athlete4@example.com"])
})
Deno.test("missing PUBLIC_APP_URL (or provider settings): 503, nothing claimed, no attempt used", async () => {
  for (const missing of ["PUBLIC_APP_URL", "RESEND_API_KEY", "NOTIFICATION_FROM_EMAIL"]) {
    const w = makeWorld(); w.env[missing] = undefined
    const r = await scheduler(w)
    assertEquals([r.status, r.body.code, r.body.missing], [503, "email_not_configured", [missing]])
    assertEquals(w.fetchCalls.length, 0); assertEquals(w.rows.map((x) => [x.status, x.delivery_attempt_count]), [["pending", 0], ["pending", 0]])
    assertEquals(w.rpcCalls.some((c) => c.name === "claim_notification_emails"), false)
  }
  const w = makeWorld(); w.env.PUBLIC_APP_URL = "javascript:alert(1)"
  assertEquals((await scheduler(w)).status, 503)
})
Deno.test("local preview: nothing is sent, rows are marked sent, the platform admin gets the links", async () => {
  const w = makeWorld({ caller: { id: "admin" }, isPlatformAdmin: true }); w.env.RESEND_API_KEY = undefined; w.env.NOTIFICATION_FROM_EMAIL = undefined; w.env.PUBLIC_APP_URL = "http://localhost:3000"
  const r = await call(w, { bearer: "jwt" })
  assertEquals([r.status, r.body.preview, r.body.sent], [200, true, 2]); assertEquals(w.fetchCalls.length, 0)
  assertEquals(r.body.results[0], { id: eid(1), status: "sent", actionLink: "http://localhost:3000/athlete/training-plan", recipientEmail: "athlete1@example.com", subject: "New training plan: Sprint block" })
})
Deno.test("platform admin flush: everything, including rows waiting for a retry; limit and eventIds are honoured", async () => {
  const base = () => makeWorld({ caller: { id: "admin" }, isPlatformAdmin: true, rows: [row(1, { status: "failed", delivery_attempt_count: 1, next_attempt_at: Date.parse("2026-10-07T12:30:00.000Z") }), row(2, { tenant_id: TENANT_B }), row(3, { tenant_id: null, tenant_name: null })] })
  let w = base(); let r = await call(w, { bearer: "jwt" })
  assertEquals([r.body.mode, r.body.sent], ["platform-admin", 3]); assertEquals(r.body.results.length, 3)
  w = base(); r = await call(w, { bearer: "jwt", body: { limit: 1 } }); assertEquals(r.body.sent, 1)
  w = base(); r = await call(w, { bearer: "jwt", body: { eventIds: [eid(2), "not-a-uuid"] } }); assertEquals(r.body.results.map((x: any) => x.id), [eid(2)])
})
Deno.test("member (the app's fallback): only their own club's queue, and no names come back", async () => {
  const w = makeWorld({ caller: { id: "coach" }, callerTenant: TENANT_A, rows: [row(1), row(2, { tenant_id: TENANT_B }), row(3, { tenant_id: null }), row(4, { status: "failed", delivery_attempt_count: 1, next_attempt_at: Date.parse("2026-10-07T12:30:00.000Z") })] })
  const r = await call(w, { bearer: "jwt", body: { eventIds: [eid(2)], limit: 500 } })
  assertEquals([r.status, r.body.mode, r.body.sent, r.body.results], [200, "member", 1, []])
  assertEquals(statuses(w), ["sent", "pending", "pending", "failed"]) // other club, platform level and backing-off rows untouched
  assertEquals(w.fetchCalls.map((c) => c.body.to[0]), ["athlete1@example.com"])
})
Deno.test("deactivated member, member of a suspended club, or a signed-in user with no club: refused", async () => {
  const w = makeWorld({ caller: { id: "someone" }, callerTenant: null })
  const r = await call(w, { bearer: "jwt" }); assertEquals([r.status, r.body.code], [403, "not_allowed"]); assertEquals(w.fetchCalls.length, 0)
})
Deno.test("the service role key as bearer starts a scheduler run (used by the deploy workflow); the anon key does not", async () => {
  let w = makeWorld(); let r = await call(w, { bearer: "service-role-key" }); assertEquals([r.status, r.body.mode, r.body.sent], [200, "scheduler", 2])
  w = makeWorld(); r = await call(w, { bearer: "anon" }); assertEquals(r.status, 401)
})
Deno.test("two runs at the same moment: every email goes out exactly once", async () => {
  const w = makeWorld({ rows: Array.from({ length: 23 }, (_, i) => row(i + 1)) })
  const [a, b] = await Promise.all([scheduler(w), scheduler(w)])
  assertEquals(a.body.sent + b.body.sent, 23); assert(a.body.sent > 0 && b.body.sent > 0, "both runs did some of the work")
  const recipients = w.fetchCalls.map((c) => c.body.to[0])
  assertEquals(new Set(recipients).size, 23); assertEquals(recipients.length, 23)
  assertEquals(w.rows.every((x) => x.status === "sent" && x.delivery_attempt_count === 1), true)
})
Deno.test("a run stops at its time budget and leaves the rest for the next one", async () => {
  const w = makeWorld({ rows: Array.from({ length: 40 }, (_, i) => row(i + 1)), sendTakesMs: 3_000 })
  const r = await scheduler(w)
  assertEquals([r.body.stopped, r.body.sent], ["time_budget", 10]); assertEquals(w.rows.filter((x) => x.status === "pending" && x.processing_started_at === null).length, 30)
})
Deno.test("queue unavailable", async () => {
  const w = makeWorld({ claimFails: true }); const r = await scheduler(w); assertEquals([r.status, r.body.code], [500, "queue_unavailable"])
})
Deno.test("pure: where each notification goes", () => {
  const A = "11111111-1111-4111-8111-111111111111", T = "22222222-2222-4222-8222-222222222222"
  assertEquals(notificationTargetPath("training_plan_published", { plan_id: PLAN }, "athlete"), "/athlete/training-plan")
  assertEquals(notificationTargetPath("training_plan_updated", {}, "athlete"), "/athlete/training-plan")
  assertEquals(notificationTargetPath("test_week_published", {}, "athlete"), "/athlete/test-week")
  assertEquals(notificationTargetPath("session_note_added", { session_date: "2026-10-06" }, "athlete"), "/athlete/log?date=2026-10-06")
  assertEquals(notificationTargetPath("athlete_session_completed", { athlete_ids: [A], team_id: T }, "coach"), `/coach/athletes/${A}`)
  assertEquals(notificationTargetPath("athlete_session_completed", { athlete_ids: [A, PLAN], team_id: T }, "coach"), `/coach/teams/${T}`)
  assertEquals(notificationTargetPath("athlete_test_results_submitted", { team_id: T }, "coach"), "/coach/test-week")
  assertEquals(notificationTargetPath("athlete_low_readiness", { athlete_id: A }, "coach"), `/coach/athletes/${A}`)
  assertEquals(notificationTargetPath("athlete_invite_accepted", { team_id: T }, "coach"), `/coach/teams/${T}`)
  assertEquals(notificationTargetPath("athlete_invite_accepted", { team_id: T }, "club-admin"), "/club-admin/teams")
  assertEquals(notificationTargetPath("coach_invite_accepted", {}, "club-admin"), "/club-admin/users")
  assertEquals(notificationTargetPath("coach_team_assigned", { team_id: T }, "coach"), `/coach/teams/${T}`)
  assertEquals(notificationTargetPath("coach_team_removed", { removed_team_id: T }, "coach"), "/coach/teams")
  assertEquals(notificationTargetPath("package_request_reviewed", {}, "club-admin"), "/club-admin/billing")
  assertEquals(notificationTargetPath("club_reactivated", {}, "club-admin"), "/club-admin/dashboard")
  assertEquals(notificationTargetPath("tenant_provision_request_submitted", {}, "platform-admin"), "/platform-admin/requests")
  assertEquals(notificationTargetPath("something_new", {}, "athlete"), "/notifications")
  assertEquals(notificationTargetPath("athlete_low_readiness", { athlete_id: "../../login" }, "coach"), "/coach/teams")
})
Deno.test("pure: body paragraphs, provider answers, rendering with no body or club", () => {
  assertEquals(bodyParagraphs("tenant_provision_request_submitted", "Organization: X | Requestor: Y"), ["Organization: X", "Requestor: Y"])
  assertEquals(bodyParagraphs("session_note_added", "a | b"), ["a | b"]); assertEquals(bodyParagraphs("x", null), [])
  assertEquals(readProviderResponse(200, { id: "m" }), { sent: true, messageId: "m" })
  assertEquals(readProviderResponse(422, null), { sent: false, error: "Email provider answered 422.", retry: false, stop: false })
  assertEquals(readProviderResponse(401, { message: "bad key" }), { sent: false, error: "bad key", retry: true, stop: true })
  assertEquals(readProviderResponse(503, {}), { sent: false, error: "Email provider answered 503.", retry: true, stop: false })
  const email = renderNotificationEmail({ ...row(1), body: null, tenant_name: null, tenant_id: null, recipient_role: "platform-admin", event_type: "tenant_provision_request_submitted", subject: "New club request" } as any, "https://app.sktr.test")
  assert(email.html.includes("Sent by SKTR Coach.") && email.html.includes("https://app.sktr.test/platform-admin/requests") && email.html.includes("Review the request"))
})
