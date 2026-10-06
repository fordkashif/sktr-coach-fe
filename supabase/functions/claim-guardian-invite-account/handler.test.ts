// Run with: deno test supabase/functions/claim-guardian-invite-account/
// Calls the real handler with a fake Supabase client and a fixed clock. No network needed.
// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */
import { handleClaimGuardianInvite, type ClaimHandlerDeps } from "./handler.ts"
function assertEquals(a: unknown, b: unknown) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`expected ${y}\n     got ${x}`) }

const INVITE = "11111111-1111-4111-8111-111111111111"
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const NOW = new Date("2026-10-16T12:00:00.000Z")

type World = {
  invite: Record<string, unknown> | null
  paused: boolean
  standing: { standing: string; found_user_id: string | null } | "error"
  created: any[]
  createError: string | null
  env: Record<string, string | undefined>
  rpcCalls: Array<{ name: string; args: any }>
}

function makeWorld(over: Partial<World> = {}): World {
  return {
    invite: { id: INVITE, email: "parent@example.com", tenant_id: TENANT, status: "pending", expires_at: "2026-10-30T12:00:00.000Z" },
    paused: false,
    standing: { standing: "new", found_user_id: null },
    created: [], createError: null, rpcCalls: [],
    env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" },
    ...over,
  }
}

function deps(w: World): ClaimHandlerDeps {
  return {
    getEnv: (n) => w.env[n],
    now: () => NOW,
    createServiceClient: () => ({
      from: (table: string) => {
        if (table !== "guardian_invites") throw new Error("unexpected table " + table)
        let id: unknown = null
        const b: any = { select: () => b, eq: (_c: string, v: unknown) => { id = v; return b }, maybeSingle: () => Promise.resolve({ data: w.invite && w.invite.id === id ? { ...w.invite } : null, error: null }) }
        return b
      },
      rpc: (name: string, args: any) => {
        w.rpcCalls.push({ name, args })
        if (name === "tenant_access_blocked") return Promise.resolve({ data: w.paused, error: null })
        if (name === "guardian_email_standing") return Promise.resolve(w.standing === "error" ? { data: null, error: { message: "boom" } } : { data: [w.standing], error: null })
        return Promise.resolve({ data: null, error: { message: "unexpected rpc " + name } })
      },
      auth: { admin: { createUser: (input: any) => {
        if (w.createError) return Promise.resolve({ data: null, error: { message: w.createError } })
        w.created.push(input); return Promise.resolve({ data: { user: { id: "new-user" } }, error: null })
      } } },
    }),
  }
}

const BODY = { inviteId: INVITE, email: " Parent@Example.com ", password: "long enough", displayName: "  Pat   Parent " }
async function call(w: World, body: unknown = BODY, method = "POST") {
  const res = await handleClaimGuardianInvite(new Request("https://fn/claim-guardian-invite-account", { method, body: method === "POST" ? JSON.stringify(body) : undefined }), deps(w))
  return { status: res.status, body: await res.json().catch(() => null) }
}

Deno.test("OPTIONS, wrong method, missing environment", async () => {
  assertEquals((await call(makeWorld(), null, "OPTIONS")).status, 200)
  assertEquals((await call(makeWorld(), null, "GET")).status, 405)
  assertEquals((await call(makeWorld({ env: {} }))).status, 500)
})
Deno.test("bad payloads create nothing", async () => {
  for (const body of [null, {}, { ...BODY, inviteId: "nope" }, { ...BODY, email: "" }, { ...BODY, displayName: " " }, { ...BODY, password: "short" }]) {
    const w = makeWorld(); const r = await call(w, body)
    assertEquals([r.status, w.created.length], [400, 0])
  }
})
Deno.test("unknown, used, cancelled, expired invite and a different email create nothing", async () => {
  let w = makeWorld({ invite: null }); assertEquals([(await call(w)).status, w.created.length], [404, 0])
  for (const patch of [{ status: "accepted" }, { status: "revoked" }, { expires_at: "2026-10-16T11:59:59.000Z" }, { email: "someone-else@example.com" }]) {
    w = makeWorld(); Object.assign(w.invite!, patch)
    assertEquals([(await call(w)).status, w.created.length], [400, 0])
  }
})
Deno.test("a paused or closed club: no account", async () => {
  const w = makeWorld({ paused: true }); const r = await call(w)
  assertEquals([r.status, r.body.code, w.created.length], [403, "access_paused", 0])
})
Deno.test("no mixing of roles: an email that is a coach, admin, athlete or platform admin is refused", async () => {
  for (const standing of ["has_role", "other_club"]) {
    const w = makeWorld({ standing: { standing, found_user_id: "u1" } }); const r = await call(w)
    assertEquals([r.status, r.body.code, w.created.length], [409, "role_mixing", 0])
  }
  // A platform admin contact or approved club requestor with no login yet: still refused.
  const w = makeWorld({ standing: { standing: "has_role", found_user_id: null } })
  assertEquals([(await call(w)).status, w.created.length], [409, 0])
})
Deno.test("an existing account is never touched: sign in instead", async () => {
  for (const standing of ["guardian", "new"]) {
    const w = makeWorld({ standing: { standing, found_user_id: "u1" } }); const r = await call(w)
    assertEquals([r.status, r.body.code, w.created.length], [409, "existing_account", 0])
  }
})
Deno.test("when the email cannot be checked, no account is created", async () => {
  const w = makeWorld({ standing: "error" })
  assertEquals([(await call(w)).status, w.created.length], [503, 0])
})
Deno.test("success: a confirmed account for the invited email, name only in metadata", async () => {
  const w = makeWorld(); const r = await call(w)
  assertEquals([r.status, r.body.mode, r.body.userId], [200, "created", "new-user"])
  assertEquals(w.created, [{ email: "parent@example.com", password: "long enough", email_confirm: true, user_metadata: { display_name: "Pat Parent" } }])
  assertEquals(w.rpcCalls.find((c) => c.name === "guardian_email_standing")!.args, { p_tenant_id: TENANT, p_email: "parent@example.com" })
})
Deno.test("the provider saying the email is taken reads as an existing account", async () => {
  const w = makeWorld({ createError: "A user with this email address has already been registered" }); const r = await call(w)
  assertEquals([r.status, r.body.code], [409, "existing_account"])
})
