import test from "node:test"
import assert from "node:assert/strict"
import { evaluateAccess } from "../src/lib/access-control"
import { ACCESS_PAUSED_MESSAGE, isAccessPausedError } from "../src/lib/access-paused"
import { describeAccessRequestError } from "../src/lib/auth-errors"

test("allows public routes without auth", () => {
  const result = evaluateAccess({
    pathname: "/login",
    isAuthenticated: false,
    role: null,
    tenantId: null,
  })

  assert.equal(result.allowed, true)
})

test("blocks unauthenticated access to protected routes", () => {
  const result = evaluateAccess({
    pathname: "/athlete/home",
    isAuthenticated: false,
    role: null,
    tenantId: null,
  })

  assert.equal(result.allowed, false)
  assert.equal(result.reason, "unauthenticated")
})

test("blocks missing tenant on authenticated routes", () => {
  const result = evaluateAccess({
    pathname: "/coach/dashboard",
    isAuthenticated: true,
    role: "coach",
    tenantId: null,
  })

  assert.equal(result.allowed, false)
  assert.equal(result.reason, "missing-tenant")
})

test("prevents athlete from escalating to coach path", () => {
  const result = evaluateAccess({
    pathname: "/coach/dashboard",
    isAuthenticated: true,
    role: "athlete",
    tenantId: "elite-track-club",
  })

  assert.equal(result.allowed, false)
  assert.equal(result.reason, "forbidden-role")
})

test("prevents coach from escalating to club-admin path", () => {
  const result = evaluateAccess({
    pathname: "/club-admin/dashboard",
    isAuthenticated: true,
    role: "coach",
    tenantId: "elite-track-club",
  })

  assert.equal(result.allowed, false)
  assert.equal(result.reason, "forbidden-role")
})

test("allows club-admin on club-admin route", () => {
  const result = evaluateAccess({
    pathname: "/club-admin/dashboard",
    isAuthenticated: true,
    role: "club-admin",
    tenantId: "elite-track-club",
  })

  assert.equal(result.allowed, true)
})

test("allows platform-admin on platform-admin route without tenant context", () => {
  const result = evaluateAccess({
    pathname: "/platform-admin/dashboard",
    isAuthenticated: true,
    role: "platform-admin",
    tenantId: null,
  })

  assert.equal(result.allowed, true)
})

test("prevents club-admin from escalating to platform-admin path", () => {
  const result = evaluateAccess({
    pathname: "/platform-admin/dashboard",
    isAuthenticated: true,
    role: "club-admin",
    tenantId: "elite-track-club",
  })

  assert.equal(result.allowed, false)
  assert.equal(result.reason, "forbidden-role")
})

test("prevents platform-admin from entering tenant-scoped club-admin path", () => {
  const result = evaluateAccess({
    pathname: "/club-admin/dashboard",
    isAuthenticated: true,
    role: "platform-admin",
    tenantId: "platform",
  })

  assert.equal(result.allowed, false)
  assert.equal(result.reason, "forbidden-role")
})

test("shows the paused notice to members of a suspended club instead of redirecting", () => {
  for (const [role, pathname] of [
    ["athlete", "/athlete/home"],
    ["coach", "/coach/dashboard"],
    ["club-admin", "/club-admin/dashboard"],
  ] as const) {
    const result = evaluateAccess({
      pathname,
      isAuthenticated: true,
      role,
      tenantId: "tenant-1",
      // A suspended club admin cannot read club_profiles, so onboarding looks incomplete. The notice must win.
      clubAdminOnboardingComplete: false,
      clubAdminLifecycleStatus: role === "club-admin" ? "suspended" : null,
      tenantLifecycleStatus: "suspended",
    })

    assert.equal(result.allowed, false)
    assert.equal(result.blocked, "club-suspended")
    assert.equal(result.redirectTo, undefined)
  }
})

test("shows the notice for a cancelled club and for a deactivated member", () => {
  const cancelled = evaluateAccess({
    pathname: "/coach/dashboard",
    isAuthenticated: true,
    role: "coach",
    tenantId: "tenant-1",
    tenantLifecycleStatus: "cancelled",
  })
  assert.equal(cancelled.blocked, "club-cancelled")

  const inactive = evaluateAccess({
    pathname: "/athlete/home",
    isAuthenticated: true,
    role: "athlete",
    tenantId: "tenant-1",
    tenantLifecycleStatus: "active",
    memberActive: false,
  })
  assert.equal(inactive.allowed, false)
  assert.equal(inactive.blocked, "member-inactive")
})

test("does not block active clubs, clubs with no record, or the platform admin", () => {
  for (const tenantLifecycleStatus of ["active", "active_onboarding", null]) {
    const result = evaluateAccess({
      pathname: "/coach/dashboard",
      isAuthenticated: true,
      role: "coach",
      tenantId: "tenant-1",
      tenantLifecycleStatus,
    })
    assert.equal(result.allowed, true)
  }

  const platformAdmin = evaluateAccess({
    pathname: "/platform-admin/dashboard",
    isAuthenticated: true,
    role: "platform-admin",
    tenantId: null,
    tenantLifecycleStatus: "suspended",
  })
  assert.equal(platformAdmin.allowed, true)
})

// The database's one refusal for a locked-out member (migration 20261006180000) and the public club
// request form's refusals (20261006181000): what the browser recognises and what it shows.

test("recognises the database's access_paused refusal by hint or by message, and nothing else", () => {
  assert.equal(isAccessPausedError({ code: "42501", hint: "access_paused", message: "Your access is paused. Either..." }), true)
  assert.equal(isAccessPausedError({ message: "Your access is paused. Reload the page." }), true)
  assert.equal(isAccessPausedError({ code: "42501", message: 'new row violates row-level security policy for table "teams"' }), false)
  assert.equal(isAccessPausedError({ code: "PT429", hint: "rate_limited", message: "Too many requests. Try again later." }), false)
  assert.equal(isAccessPausedError(null), false)
  assert.match(ACCESS_PAUSED_MESSAGE, /^Your access is paused\./)
})

test("request form: a rate limit shows the friendly try-again-later message", () => {
  const friendly = "Too many requests right now. Please try again later."
  assert.equal(describeAccessRequestError({ code: "PT429", message: "Too many requests. Try again later.", hint: "rate_limited" } as never), friendly)
  assert.equal(describeAccessRequestError({ message: "Too many requests. Try again later." }), friendly)
  assert.equal(describeAccessRequestError({ status: 429, message: "" }), friendly)
})

test("request form: server-side validation refusals become plain sentences, never raw database text", () => {
  const cases: Array<[string, RegExp]> = [
    ["Requestor email is not valid", /does not look like an email/],
    ["Organization website must be a web address starting with http:// or https://", /web address like yourclub\.com/],
    ["Desired start date is not valid", /start date/],
    ["Notes is too long (maximum 1000 characters)", /notes are too long/],
    ["Organization name is too long (maximum 160 characters)", /too long/],
    ["Job title contains characters that are not allowed", /characters we cannot accept/],
    ["Expected coach count must be between 0 and 100000", /how many coaches/],
    ["Expected athlete count must be between 0 and 100000", /how many athletes/],
    ["Expected seats must be between 0 and 200000", /coaches and athletes/],
    ["A pending request already exists for this organization and email", /already have a request/],
    ["Requestor name is required", /first and last name/],
    ["something nobody planned for", /could not send your request/],
  ]
  for (const [raw, expected] of cases) {
    const shown = describeAccessRequestError({ message: raw })
    assert.match(shown, expected, raw)
    assert.notEqual(shown, raw)
  }
})
