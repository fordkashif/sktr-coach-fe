// Run with: deno test supabase/functions/_shared/
// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */
import { escapeHtml, isClubAccessPaused } from "./club-access.ts"
function assertEquals(a: unknown, b: unknown) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`expected ${y}\n     got ${x}`) }

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
function client(answer: { data?: unknown; error?: unknown } | "throw", calls: any[] = []) {
  return {
    calls,
    rpc(name: string, args: unknown) {
      calls.push({ name, args })
      if (answer === "throw") return Promise.reject(new Error("network down"))
      return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null })
    },
  }
}

Deno.test("suspended or cancelled club: paused", async () => {
  const c = client({ data: true })
  assertEquals(await isClubAccessPaused(c, TENANT), true)
  assertEquals(c.calls, [{ name: "tenant_access_blocked", args: { p_tenant_id: TENANT } }])
})

Deno.test("open club: not paused", async () => {
  assertEquals(await isClubAccessPaused(client({ data: false }), TENANT), false)
})

Deno.test("only a real true counts as paused", async () => {
  assertEquals(await isClubAccessPaused(client({ data: "true" }), TENANT), false)
  assertEquals(await isClubAccessPaused(client({ data: null }), TENANT), false)
})

Deno.test("no answer (function missing, call failed, client threw): not paused, the database decides later", async () => {
  assertEquals(await isClubAccessPaused(client({ error: { code: "PGRST202", message: "Could not find the function" } }), TENANT), false)
  assertEquals(await isClubAccessPaused(client({ data: true, error: { message: "boom" } }), TENANT), false)
  assertEquals(await isClubAccessPaused(client("throw"), TENANT), false)
})

Deno.test("no club id: nothing is asked", async () => {
  const c = client({ data: true })
  assertEquals(await isClubAccessPaused(c, null), false)
  assertEquals(await isClubAccessPaused(c, ""), false)
  assertEquals(c.calls.length, 0)
})

Deno.test("escapeHtml neutralises markup in text that visitors typed", () => {
  assertEquals(
    escapeHtml(`Organization: <a href="https://evil.test">Click & 'win'</a>`),
    "Organization: &lt;a href=&quot;https://evil.test&quot;&gt;Click &amp; &#39;win&#39;&lt;/a&gt;",
  )
})
