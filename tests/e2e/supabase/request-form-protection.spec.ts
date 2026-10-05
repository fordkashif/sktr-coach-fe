import { expect, test } from "@playwright/test"
import { hasRoleCredential } from "../helpers/supabase-auth"
import { getCurrentTenantIdForRole, getRoleAccessToken } from "../helpers/supabase-rest"

// What the public API must refuse or silently drop after 20261006180000 / 20261006181000.
// These talk to the REST API directly, as a visitor would with the public anon key.
//
// Note for whoever runs this suite many times a day: every real submission of the request form counts
// towards the limits in public.request_form_settings (5 per network address per 24 hours by default).
// The checks below never store a request, so they do not use the limit up, but platform-admin.spec.ts
// submits one real request per run. On a test project either raise per_ip_max or run
//   delete from public.request_form_attempts;
// in the SQL editor when "Too many requests right now" shows up.

const supabaseUrl = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY

function headers(token: string) {
  return { apikey: anonKey as string, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
}

function rpc(name: string, body: Record<string, unknown>, token = anonKey as string) {
  return fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, { method: "POST", headers: headers(token), body: JSON.stringify(body) })
}

const validRequest = (nonce: number) => ({
  p_requestor_name: "E2E Protection",
  p_requestor_email: `protection-${nonce}@pacelab.local`,
  p_organization_name: `E2E Protection Org ${nonce}`,
  p_notes: null,
  p_requested_plan: "starter",
  p_expected_seats: 22,
  p_job_title: "Head coach",
  p_organization_type: "Club",
  p_organization_website: null,
  p_region: "Jamaica",
  p_expected_coach_count: 2,
  p_expected_athlete_count: 20,
  p_desired_start_date: null,
})

test.describe("public API protection", () => {
  test.skip(!supabaseUrl || !anonKey, "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.")

  test("request form: honeypot and too-fast submissions report success", async () => {
    const nonce = Date.now()
    const honeypot = await rpc("submit_tenant_provision_request", { ...validRequest(nonce), p_reference_code: "http://spam.example", p_fill_ms: 9000 })
    expect(honeypot.status).toBe(200)
    const tooFast = await rpc("submit_tenant_provision_request", { ...validRequest(nonce + 1), p_reference_code: null, p_fill_ms: 150 })
    expect(tooFast.status).toBe(200)
  })

  test("request form: bad input is refused with a readable message, not stored", async () => {
    const nonce = Date.now()
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ p_requestor_email: "not-an-email" }, /email is not valid/i],
      [{ p_organization_website: "javascript:alert(1)" }, /website/i],
      [{ p_organization_name: "x".repeat(500) }, /too long/i],
      [{ p_expected_athlete_count: 2_000_000 }, /athlete count/i],
      [{ p_notes: "n".repeat(5000) }, /too long/i],
    ]
    for (const [override, expected] of cases) {
      const response = await rpc("submit_tenant_provision_request", { ...validRequest(nonce), ...override, p_reference_code: null, p_fill_ms: 9000 })
      expect(response.ok, JSON.stringify(override)).toBe(false)
      expect(((await response.json()) as { message?: string }).message ?? "").toMatch(expected)
    }
  })

  test("the first, unprotected version of the request function is gone", async () => {
    const response = await rpc("submit_tenant_provision_request", {
      p_requestor_name: "Old Door",
      p_requestor_email: `old-door-${Date.now()}@pacelab.local`,
      p_organization_name: `Old Door ${Date.now()}`,
      p_notes: null,
      p_requested_plan: "starter",
      p_expected_seats: 25,
    })
    // The only function left needs a job title, type, region and head counts, so this cannot store anything.
    expect(response.ok).toBe(false)
  })

  test("visitors cannot create account requests or probe notification settings", async () => {
    const accountRequest = await rpc("submit_account_request", { p_full_name: "Spam", p_email: "spam@pacelab.local", p_organization: "Elite Track Club" })
    expect(accountRequest.ok).toBe(false)
    const probe = await rpc("notification_channel_enabled", { p_channel: "email", p_event_type: "x", p_recipient_user_id: null, p_recipient_email: "someone@pacelab.local" })
    expect(probe.ok).toBe(false)
  })

  test("a signed-in athlete cannot add an account request to their own club", async () => {
    test.skip(!hasRoleCredential("athlete"), "Missing athlete Supabase credentials.")
    const [token, tenantId] = await Promise.all([getRoleAccessToken("athlete"), getCurrentTenantIdForRole("athlete")])
    const response = await fetch(`${supabaseUrl}/rest/v1/account_requests`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ tenant_id: tenantId, full_name: "Spam", email: "spam@pacelab.local", organization: "x", desired_role: "coach", status: "pending" }),
    })
    expect(response.ok).toBe(false)
  })

  test("an active member is told they are an active member; the guard function is not public", async () => {
    test.skip(!hasRoleCredential("athlete"), "Missing athlete Supabase credentials.")
    const token = await getRoleAccessToken("athlete")
    const asMember = await rpc("caller_is_active_member", {}, token)
    expect(asMember.status).toBe(200)
    expect(await asMember.json()).toBe(true)
    const asVisitor = await rpc("caller_is_active_member", {})
    expect(asVisitor.ok).toBe(false)
    const internal = await rpc("tenant_access_blocked", { p_tenant_id: "00000000-0000-4000-8000-000000000000" }, token)
    expect(internal.ok).toBe(false)
  })
})
