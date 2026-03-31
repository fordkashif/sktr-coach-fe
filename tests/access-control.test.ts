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
