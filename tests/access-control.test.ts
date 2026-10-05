import test from "node:test"
import assert from "node:assert/strict"
import { evaluateAccess } from "../src/lib/access-control"

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
