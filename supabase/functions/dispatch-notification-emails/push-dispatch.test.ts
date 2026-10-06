// Run with: deno test supabase/functions/dispatch-notification-emails/
// The push part of a dispatch run, through the real handler: a fake Supabase client that follows
// the rules of claim_push_deliveries / complete_push_delivery (those have their own tests against a
// real Postgres), a fake push service, real VAPID keys made for the test and a real browser-side
// decryption of what was posted. No network needed.
// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */
import { handleDispatchNotificationEmails, SCHEDULER_TOKEN_HEADER, type HandlerDeps } from "./handler.ts"
import { pushTargetPath } from "./push-dispatch.ts"
import { base64UrlDecode, base64UrlEncode, decryptPushPayload, type PushKeyPair } from "../_shared/web-push.ts"
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m) }
function assertEquals(a: unknown, b: unknown) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`expected ${y}\n     got ${x}`) }

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const THREAD = "99999999-9999-4999-8999-999999999999"
const TOKEN = "t".repeat(64)
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

async function makeKeyPair(): Promise<PushKeyPair & { publicText: string; privateText: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
  const privateKey = base64UrlDecode(jwk.d!)
  return { publicKey, privateKey, publicText: base64UrlEncode(publicKey), privateText: base64UrlEncode(privateKey) }
}

type PushRow = {
  id: string; subscription_id: string; endpoint: string; p256dh: string; auth: string; recipient_user_id: string; recipient_role: string | null
  event_type: string; subject: string | null; metadata: any; created_at: string; attempt_count: number; tenant_id: string | null
  status: string; processing_started_at: number | null; last_error: string | null
  /** Set after a "retry": the database would not hand the row out again before its next attempt time. */
  waiting?: boolean
}
type World = {
  pushes: PushRow[]
  emails: any[]
  env: Record<string, string | undefined>
  caller: { id: string } | null
  callerTenant: string | null
  /** One answer per push request, the last one repeats. */
  pushAnswers: Array<number | "throw">
  pushCalls: Array<{ url: string; headers: Record<string, string>; body: Uint8Array; redirect: unknown }>
  emailCalls: any[]
  rpcCalls: Array<{ name: string; args: any }>
  suppressed: string[]
  released: string[]
  nowMs: number
  claimFails?: boolean
  device: Awaited<ReturnType<typeof makeKeyPair>>
  auth: string
}

async function makeWorld(over: Partial<World> = {}): Promise<World> {
  const vapid = await makeKeyPair()
  const device = await makeKeyPair()
  const auth = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))
  const w: World = {
    pushes: [], emails: [], caller: null, callerTenant: null, pushAnswers: [201], pushCalls: [], emailCalls: [], rpcCalls: [], suppressed: [], released: [],
    nowMs: Date.parse("2026-10-16T12:00:00.000Z"), device, auth,
    env: {
      SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      RESEND_API_KEY: "re_x", NOTIFICATION_FROM_EMAIL: "hello@sktr.test", PUBLIC_APP_URL: "https://app.sktr.test",
      VAPID_PUBLIC_KEY: vapid.publicText, VAPID_PRIVATE_KEY: vapid.privateText, VAPID_SUBJECT: "mailto:owner@sktr.test",
    },
    ...over,
  }
  return w
}

function push(w: World, n: number, over: Partial<PushRow> = {}): PushRow {
  const r: PushRow = {
    id: pid(n), subscription_id: `sub-${n}`, endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, p256dh: w.device.publicText, auth: w.auth,
    recipient_user_id: `user-${n}`, recipient_role: "athlete", event_type: "direct_message_received", subject: "New message from Coach Rivera",
    metadata: { thread_id: THREAD }, created_at: "2026-10-16T11:59:00.000Z", attempt_count: 0, tenant_id: TENANT_A, status: "pending", processing_started_at: null, last_error: null,
    ...over,
  }
  w.pushes.push(r)
  return r
}

function email(n: number) {
  return {
    id: pid(1000 + n), tenant_id: TENANT_A, tenant_name: "Elite Track Club", recipient_user_id: `user-${n}`, recipient_email: `a${n}@example.com`, recipient_role: "athlete",
    event_type: "training_plan_published", subject: "New training plan", body: "Body", metadata: {}, created_at: "2026-10-16T11:00:00.000Z",
    status: "pending", delivery_attempt_count: 0, processing_started_at: null as number | null,
  }
}

function deps(w: World): HandlerDeps {
  return {
    getEnv: (n) => w.env[n],
    createUserClient: () => ({
      auth: { getUser: () => Promise.resolve(w.caller ? { data: { user: w.caller }, error: null } : { data: { user: null }, error: { message: "bad jwt" } }) },
      from: () => { const b: any = { select: () => b, limit: () => b, maybeSingle: () => Promise.resolve({ data: null, error: null }) }; return b },
      rpc: (name: string) => Promise.resolve(name === "current_tenant_id" ? { data: w.callerTenant, error: null } : { data: null, error: { message: "unexpected rpc " + name } }),
    }),
    createServiceClient: () => ({
      rpc: (name: string, args: any) => {
        w.rpcCalls.push({ name, args })
        const ok = (data: unknown) => Promise.resolve({ data, error: null })
        if (name === "verify_notification_scheduler_token") return ok(args.p_token === TOKEN)
        if (name === "register_notification_dispatch_url" || name === "record_notification_dispatch_run") return ok(true)
        if (name === "suppress_pending_push_deliveries") {
          w.pushes.filter((r) => r.status === "pending" && r.processing_started_at === null).forEach((r) => { r.status = "suppressed"; r.last_error = args.p_reason })
          w.suppressed.push(args.p_reason); return ok(1)
        }
        if (name === "claim_push_deliveries") {
          if (w.claimFails) return Promise.resolve({ data: null, error: { message: "db down" } })
          // Runs to completion without awaiting, as the SQL function runs under row locks.
          const rows = w.pushes.filter((r) => (r.status === "pending" || r.status === "failed") && r.processing_started_at === null && r.attempt_count < 3 && !r.waiting)
            .filter((r) => !args.p_tenant_id || r.tenant_id === args.p_tenant_id).slice(0, args.p_limit)
          rows.forEach((r) => { r.processing_started_at = w.nowMs; r.attempt_count += 1 })
          return ok(rows.map((r) => ({ ...r })))
        }
        if (name === "complete_push_delivery") {
          const r = w.pushes.find((x) => x.id === args.p_delivery_id)
          if (!r || r.processing_started_at === null) return ok(false)
          r.status = args.p_result === "retry" ? "failed" : args.p_result; r.last_error = args.p_error; r.processing_started_at = null
          if (args.p_result === "retry") r.waiting = true
          if (args.p_result === "failed") r.attempt_count = 3
          return ok(true)
        }
        if (name === "release_push_delivery") {
          const r = w.pushes.find((x) => x.id === args.p_delivery_id)!
          r.processing_started_at = null; r.attempt_count -= 1; w.released.push(r.id); return ok(true)
        }
        if (name === "claim_notification_emails") {
          const rows = w.emails.filter((r) => r.status === "pending" && r.processing_started_at === null).slice(0, args.p_limit)
          rows.forEach((r) => { r.processing_started_at = w.nowMs; r.delivery_attempt_count += 1 })
          return ok(rows.map((r) => ({ ...r })))
        }
        if (name === "complete_notification_email") {
          const r = w.emails.find((x) => x.id === args.p_event_id); r.status = args.p_sent ? "sent" : "failed"; r.processing_started_at = null; return ok(true)
        }
        return Promise.resolve({ data: null, error: { message: "unexpected rpc " + name } })
      },
      from: () => { const b: any = { update: () => b, eq: () => b, then: (res: any) => Promise.resolve({ data: null, error: null }).then(res) }; return b },
    }),
    fetch: ((url: string, init: any) => {
      if (url === "https://api.resend.com/emails") {
        w.emailCalls.push(JSON.parse(init.body))
        return Promise.resolve(new Response(JSON.stringify({ id: "msg" }), { status: 200 }))
      }
      const answer = w.pushAnswers[Math.min(w.pushCalls.length, w.pushAnswers.length - 1)]
      w.pushCalls.push({ url, headers: init.headers, body: init.body, redirect: init.redirect })
      return new Promise((resolve, reject) => setTimeout(() => (answer === "throw" ? reject(new Error("network down")) : resolve(new Response(null, { status: answer }))), 1))
    }) as any,
    now: () => new Date(w.nowMs),
    sleep: () => Promise.resolve(),
  }
}

async function run(w: World, init: { bearer?: string } = {}) {
  const headers: Record<string, string> = init.bearer ? { Authorization: `Bearer ${init.bearer}` } : { [SCHEDULER_TOKEN_HEADER]: TOKEN }
  const res = await handleDispatchNotificationEmails(new Request("https://fn/dispatch-notification-emails", { method: "POST", headers, body: "{}" }), deps(w))
  return { status: res.status, body: await res.json() }
}

async function opened(w: World, index = 0) {
  const text = new TextDecoder().decode(await decryptPushPayload(w.pushCalls[index].body, w.device, w.auth))
  return { text, json: JSON.parse(text) as { title: string; body: string; url: string; tag: string } }
}

Deno.test("push: sent to each device, recorded as sent, and the email queue is worked in the same run", async () => {
  const w = await makeWorld(); push(w, 1); push(w, 2, { recipient_role: "coach" }); w.emails.push(email(1))
  const r = await run(w)
  assertEquals([r.status, r.body.sent, r.body.push], [200, 1, { configured: true, processed: 2, sent: 2, failed: 0, gone: 0, stopped: null }])
  assertEquals(w.pushes.map((p) => p.status), ["sent", "sent"]); assertEquals(w.emails[0].status, "sent")
  assertEquals(w.pushCalls.map((c) => c.url).sort(), ["https://fcm.googleapis.com/fcm/send/device-1", "https://fcm.googleapis.com/fcm/send/device-2"])
})

Deno.test("push: the request a push service gets (VAPID, aes128gcm, TTL, urgency, topic, no redirects)", async () => {
  const w = await makeWorld(); push(w, 1); await run(w)
  const c = w.pushCalls[0]
  assert(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/.test(c.headers.Authorization), c.headers.Authorization)
  assert(c.headers.Authorization.endsWith(`k=${w.env.VAPID_PUBLIC_KEY}`))
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(c.headers.Authorization.split("t=")[1].split(",")[0].split(".")[1])))
  assertEquals([claims.aud, claims.sub, claims.exp], ["https://fcm.googleapis.com", "mailto:owner@sktr.test", w.nowMs / 1000 + 12 * 3600])
  assertEquals([c.headers["Content-Encoding"], c.headers["Content-Type"], c.headers.TTL, c.headers.Urgency, c.redirect], ["aes128gcm", "application/octet-stream", "86400", "high", "manual"])
  assert(/^[\w-]{32}$/.test(c.headers.Topic))
})

Deno.test("push: what the device shows for a message is the sender and nothing of the message", async () => {
  const w = await makeWorld(); push(w, 1); await run(w)
  const { json, text } = await opened(w)
  assertEquals(json, { title: "New message", body: "You have a new message from Coach Rivera.", url: `/athlete/messages/t/${THREAD}`, tag: `direct_message_received:${THREAD}` })
  assertEquals(Object.keys(JSON.parse(text)).sort(), ["body", "tag", "title", "url"])
})

Deno.test("push: a pain report says nothing about who or what, and typed text never travels", async () => {
  const A = "11111111-1111-4111-8111-111111111111"
  const w = await makeWorld()
  push(w, 1, { event_type: "athlete_pain_reported", recipient_role: "coach", subject: "Maya Chen reported hamstring pain (7 of 10)", metadata: { athlete_id: A, area: "hamstring", severity: 7 } })
  push(w, 2, { event_type: "announcement_posted", subject: "Announcement: Bring spikes, Maya is injured", metadata: {} })
  push(w, 3, { event_type: "training_plan_published", subject: "New training plan: Secret block", metadata: {} })
  push(w, 4, { event_type: "some_future_event", recipient_role: "guardian", subject: "Something private", metadata: {} })
  await run(w)
  const byUrl = async (n: number) => opened(w, w.pushCalls.findIndex((c) => c.url.endsWith(`device-${n}`)))
  const pain = await byUrl(1)
  assertEquals(pain.json, { title: "An athlete needs a look", body: "A report came in from one of your teams. Open SKTR Coach to read it.", url: `/coach/athletes/${A}`, tag: `athlete_update:${A}` })
  for (const n of [1, 2, 3, 4]) {
    const { text } = await byUrl(n)
    for (const word of ["Maya", "hamstring", "pain", "7 of 10", "spikes", "injured", "Secret", "private"]) assert(!text.includes(word), `${word} leaked in push ${n}: ${text}`)
  }
  // A role and an event this code has never heard of still get a push, to the notifications page.
  assertEquals((await byUrl(4)).json, { title: "SKTR Coach", body: "You have a new notification.", url: "/notifications", tag: "some_future_event" })
})

Deno.test("push: 404 and 410 report the device as gone", async () => {
  for (const status of [404, 410]) {
    const w = await makeWorld({ pushAnswers: [status] }); push(w, 1); w.emails.push(email(1))
    const r = await run(w)
    assertEquals(r.body.push, { configured: true, processed: 1, sent: 0, failed: 1, gone: 1, stopped: null })
    assertEquals(w.rpcCalls.find((c) => c.name === "complete_push_delivery")!.args.p_result, "gone")
    assertEquals(w.emails[0].status, "sent")
  }
})

Deno.test("push: a push service that is down never holds an email back, and the push is retried later", async () => {
  const w = await makeWorld({ pushAnswers: ["throw"] }); push(w, 1); w.emails.push(email(1)); w.emails.push(email(2))
  const r = await run(w)
  assertEquals([r.status, r.body.sent, r.body.push.sent, r.body.push.failed], [200, 2, 0, 1])
  assertEquals(w.rpcCalls.find((c) => c.name === "complete_push_delivery")!.args, { p_delivery_id: pid(1), p_result: "retry", p_error: "network down" })
  const again = await makeWorld({ pushAnswers: [503] }); push(again, 1); await run(again)
  assertEquals(again.rpcCalls.find((c) => c.name === "complete_push_delivery")!.args.p_result, "retry")
})

Deno.test("push: a refusal (403, 400, 413) is final for that message and does not stop the others", async () => {
  const w = await makeWorld({ pushAnswers: [403, 201] }); push(w, 1); push(w, 2)
  const r = await run(w)
  assertEquals([r.body.push.sent, r.body.push.failed, r.body.push.stopped], [1, 1, null])
  assertEquals(w.pushes.map((p) => p.status).sort(), ["failed", "sent"])
})

Deno.test("push: 429 stops the push part, hands back what was not tried, and email still goes", async () => {
  const w = await makeWorld({ pushAnswers: [429] })
  for (let n = 1; n <= 14; n += 1) push(w, n)
  w.emails.push(email(1))
  const r = await run(w)
  assertEquals([r.body.push.stopped, r.body.push.processed, r.body.sent], ["push_service_busy", 6, 1])
  assertEquals(w.released.length, 8)
  assertEquals(w.pushes.filter((p) => p.processing_started_at !== null).length, 0) // nothing left claimed
  assertEquals(w.pushes.filter((p) => w.released.includes(p.id)).every((p) => p.attempt_count === 0), true)
})

Deno.test("push: nothing is posted twice in one run or by two runs at the same moment", async () => {
  const w = await makeWorld(); for (let n = 1; n <= 30; n += 1) push(w, n)
  const [a, b] = await Promise.all([run(w), run(w)])
  assertEquals(a.body.push.sent + b.body.push.sent, 30)
  assertEquals(new Set(w.pushCalls.map((c) => c.url)).size, 30); assertEquals(w.pushCalls.length, 30)
})

Deno.test("push: keys missing means off. What waits is cleared, nothing is posted, email is unaffected", async () => {
  for (const missing of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
    const w = await makeWorld(); w.env[missing] = undefined; push(w, 1); w.emails.push(email(1))
    const r = await run(w)
    assertEquals([r.status, r.body.sent, r.body.push], [200, 1, { configured: false, processed: 0, sent: 0, failed: 0, gone: 0, stopped: null, problem: "missing" }])
    assertEquals([w.pushCalls.length, w.pushes[0].status, w.suppressed.length], [0, "suppressed", 1])
    assertEquals(w.rpcCalls.some((c) => c.name === "claim_push_deliveries"), false)
  }
})

Deno.test("push: wrong keys are found before anything is claimed", async () => {
  const other = await makeKeyPair()
  for (const [name, value, problem] of [["VAPID_PRIVATE_KEY", other.privateText, "keys_do_not_match"], ["VAPID_PUBLIC_KEY", "not a key", "bad_public_key"], ["VAPID_PRIVATE_KEY", "abc", "bad_private_key"], ["VAPID_SUBJECT", "someone", "bad_subject"]] as const) {
    const w = await makeWorld(); w.env[name] = value; push(w, 1)
    const r = await run(w)
    assertEquals([r.body.push.configured, r.body.push.problem, w.pushCalls.length], [false, problem, 0])
  }
})

Deno.test("push: goes out where email is not set up", async () => {
  const w = await makeWorld(); w.env.RESEND_API_KEY = undefined; push(w, 1)
  const r = await run(w)
  assertEquals([r.status, r.body.code, r.body.push.sent], [503, "email_not_configured", 1]); assertEquals(w.pushes[0].status, "sent")
})

Deno.test("push: an address that is not a push service is never posted to", async () => {
  const w = await makeWorld()
  push(w, 1, { endpoint: "https://internal.example.com/admin" }); push(w, 2, { endpoint: "https://fcm.googleapis.com.evil.example/x" }); push(w, 3, { endpoint: "http://fcm.googleapis.com/fcm/send/x" })
  const r = await run(w)
  assertEquals([w.pushCalls.length, r.body.push.failed, w.pushes.map((p) => p.status)], [0, 3, ["failed", "failed", "failed"]])
})

Deno.test("push: a member's run only touches their own club's queue", async () => {
  const w = await makeWorld({ caller: { id: "u" }, callerTenant: TENANT_A }); push(w, 1); push(w, 2, { tenant_id: TENANT_B })
  const r = await run(w, { bearer: "jwt" })
  assertEquals([r.body.mode, r.body.push.sent, w.pushes.map((p) => p.status)], ["member", 1, ["sent", "pending"]])
  assertEquals(w.rpcCalls.filter((c) => c.name === "claim_push_deliveries").every((c) => c.args.p_tenant_id === TENANT_A), true)
})

Deno.test("push: nobody without a token or a sign-in reaches the push queue", async () => {
  const w = await makeWorld(); push(w, 1)
  const res = await handleDispatchNotificationEmails(new Request("https://fn/x", { method: "POST", body: "{}" }), deps(w))
  assertEquals([res.status, w.pushCalls.length, w.rpcCalls.length], [401, 0, 0])
  const bad = await handleDispatchNotificationEmails(new Request("https://fn/x", { method: "POST", headers: { [SCHEDULER_TOKEN_HEADER]: "wrong" }, body: "{}" }), deps(w))
  assertEquals([bad.status, w.pushCalls.length], [401, 0])
})

Deno.test("push: an unreadable queue is reported and email still goes", async () => {
  const w = await makeWorld({ claimFails: true }); push(w, 1); w.emails.push(email(1))
  const r = await run(w)
  assertEquals([r.status, r.body.sent, r.body.push.problem, r.body.push.stopped], [200, 1, "queue_unavailable", "queue_unavailable"])
})

Deno.test("push: where it opens", () => {
  assertEquals(pushTargetPath({ event_type: "push_test", metadata: {}, recipient_role: "coach" }), "/settings/notifications")
  assertEquals(pushTargetPath({ event_type: "reminder_checkin", metadata: {}, recipient_role: "athlete" }), "/athlete/wellness")
  assertEquals(pushTargetPath({ event_type: "direct_message_received", metadata: { thread_id: THREAD }, recipient_role: "coach" }), `/coach/messages/t/${THREAD}`)
  assertEquals(pushTargetPath({ event_type: "anything", metadata: null, recipient_role: null }), "/notifications")
})
