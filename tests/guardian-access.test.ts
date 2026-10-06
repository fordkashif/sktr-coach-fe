import test from "node:test"
import assert from "node:assert/strict"
import { evaluateAccess } from "../src/lib/access-control"
import { ageOn, asGuardianHealthRule, guardianHealthRule, guardianSeesHealth, healthRuleText } from "../src/lib/guardian/health-visibility"

test("age in whole years, counted to the day", () => {
  assert.equal(ageOn("2010-10-16", "2026-10-15"), 15)
  assert.equal(ageOn("2010-10-16", "2026-10-16"), 16)
  assert.equal(ageOn("2008-10-16", "2026-10-15"), 17)
  assert.equal(ageOn("2008-10-16", "2026-10-16"), 18)
  assert.equal(ageOn("2008-12-31", "2026-01-01"), 17)
  assert.equal(ageOn("2026-01-01", "2026-01-01"), 0)
})

test("a 29 February birthday turns 18 on 1 March in a year without one", () => {
  assert.equal(ageOn("2008-02-29", "2026-02-28"), 17)
  assert.equal(ageOn("2008-02-29", "2026-03-01"), 18)
})

test("no age without a usable date of birth", () => {
  assert.equal(ageOn(null, "2026-10-16"), null)
  assert.equal(ageOn("", "2026-10-16"), null)
  assert.equal(ageOn("16/10/2010", "2026-10-16"), null)
  assert.equal(ageOn("2010-13-01", "2026-10-16"), null)
  assert.equal(ageOn("2030-01-01", "2026-10-16"), null)
  assert.equal(ageOn("2010-10-16", "today"), null)
})

test("health is visible for a minor, whatever the switch says", () => {
  assert.equal(guardianHealthRule({ dateOfBirth: "2012-03-01", adultOptIn: false, today: "2026-10-16" }), "minor")
  assert.equal(guardianHealthRule({ dateOfBirth: "2012-03-01", adultOptIn: true, today: "2026-10-16" }), "minor")
  assert.equal(guardianSeesHealth("minor"), true)
})

test("health is hidden for an adult unless the athlete switched it on", () => {
  assert.equal(guardianHealthRule({ dateOfBirth: "2000-05-01", adultOptIn: false, today: "2026-10-16" }), "adult_not_opted_in")
  assert.equal(guardianHealthRule({ dateOfBirth: "2000-05-01", adultOptIn: true, today: "2026-10-16" }), "adult_opted_in")
  assert.equal(guardianSeesHealth("adult_not_opted_in"), false)
  assert.equal(guardianSeesHealth("adult_opted_in"), true)
})

test("the rule changes on the 18th birthday, not before", () => {
  assert.equal(guardianHealthRule({ dateOfBirth: "2008-10-16", adultOptIn: false, today: "2026-10-15" }), "minor")
  assert.equal(guardianHealthRule({ dateOfBirth: "2008-10-16", adultOptIn: false, today: "2026-10-16" }), "adult_not_opted_in")
})

test("an unknown date of birth hides health, even with the switch on", () => {
  assert.equal(guardianHealthRule({ dateOfBirth: null, adultOptIn: true, today: "2026-10-16" }), "unknown_age")
  assert.equal(guardianHealthRule({ dateOfBirth: "not a date", adultOptIn: true, today: "2026-10-16" }), "unknown_age")
  assert.equal(guardianSeesHealth("unknown_age"), false)
})

test("an unknown rule from the server is read as hidden", () => {
  assert.equal(asGuardianHealthRule("minor"), "minor")
  assert.equal(asGuardianHealthRule("adult_opted_in"), "adult_opted_in")
  assert.equal(asGuardianHealthRule("something new"), "unknown_age")
  assert.equal(asGuardianHealthRule(null), "unknown_age")
})

test("the coach is told to add the date of birth when it is missing", () => {
  assert.match(healthRuleText("unknown_age", "Liam", "coach"), /Add the date of birth/)
  assert.match(healthRuleText("minor", "Mia", "guardian"), /under 18/)
  assert.match(healthRuleText("adult_not_opted_in", "Marcus", "guardian"), /theirs to share/)
  for (const rule of ["minor", "adult_opted_in", "adult_not_opted_in", "unknown_age"] as const) {
    for (const reader of ["guardian", "coach", "athlete"] as const) assert.ok(!healthRuleText(rule, "Mia", reader).includes(String.fromCharCode(8212)))
  }
})

const guardian = { isAuthenticated: true, role: "guardian" as const, tenantId: "club-1" }

test("a guardian opens the guardian screens, the account and notifications, and nothing else", () => {
  for (const pathname of ["/guardian/home", "/guardian/plan", "/guardian/results", "/guardian/health", "/account", "/notifications"]) {
    assert.equal(evaluateAccess({ pathname, ...guardian }).allowed, true, pathname)
  }
  for (const pathname of ["/coach/dashboard", "/coach/athletes/a1", "/athlete/home", "/athlete/wellness", "/club-admin/users", "/platform-admin/dashboard"]) {
    const result = evaluateAccess({ pathname, ...guardian })
    assert.equal(result.allowed, false, pathname)
    assert.equal(result.redirectTo, "/login", pathname)
  }
})

test("no other role opens the guardian screens", () => {
  for (const role of ["athlete", "coach", "club-admin"] as const) {
    assert.equal(evaluateAccess({ pathname: "/guardian/home", isAuthenticated: true, role, tenantId: "club-1" }).allowed, false, role)
  }
  assert.equal(evaluateAccess({ pathname: "/guardian/home", isAuthenticated: true, role: "platform-admin", tenantId: null }).allowed, false)
  assert.equal(evaluateAccess({ pathname: "/guardian/home", isAuthenticated: false, role: null, tenantId: null }).redirectTo, "/login")
})

test("a guardian of a paused or closed club, or one whose access was turned off, gets the notice", () => {
  assert.equal(evaluateAccess({ pathname: "/guardian/home", ...guardian, tenantLifecycleStatus: "suspended" }).blocked, "club-suspended")
  assert.equal(evaluateAccess({ pathname: "/guardian/home", ...guardian, tenantLifecycleStatus: "closed" }).blocked, "club-closed")
  assert.equal(evaluateAccess({ pathname: "/guardian/home", ...guardian, tenantLifecycleStatus: "cancelled" }).blocked, "club-cancelled")
  assert.equal(evaluateAccess({ pathname: "/account", ...guardian, memberActive: false }).blocked, "member-inactive")
})
