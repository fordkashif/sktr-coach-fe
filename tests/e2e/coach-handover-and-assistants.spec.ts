import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

// Each test uses its own demo club, so what one test changes is not there for the next.
async function asAdmin(page: Page, tenantId: string) {
  await seedMockSession(page, { role: "club-admin", tenantId })
  await page.setViewportSize({ width: 1440, height: 900 })
}

/** The demo coach on Sprint Group (t1), with a role on that team. */
async function asCoach(page: Page, tenantId: string, role: "lead" | "coach" | "assistant") {
  await seedMockSession(page, { role: "coach", tenantId, coachTeamId: "t1" })
  await page.addInitScript((value) => window.localStorage.setItem("pacelab:mock-coach-team-roles", JSON.stringify({ t1: value })), role)
  await page.setViewportSize({ width: 1440, height: 900 })
}

const auditLog = (page: Page, tenantId: string) => page.evaluate((key) => window.localStorage.getItem(key) ?? "", `pacelab:audit-logs:${tenantId}`)

async function openStaffMenu(page: Page, name: string, email: string) {
  const row = page.locator(`[data-person="${email}"]`)
  await row.getByRole("button", { name: `More for ${name}` }).click()
  return row
}

test("removing a coach who still coaches opens the handover step, and nothing changes until it is confirmed", async ({ page }) => {
  await asAdmin(page, "handover-remove")
  await page.goto("/club-admin/users")

  const row = await openStaffMenu(page, "Coach Rivera", "coach.rivera@pacelab.local")
  await page.getByRole("menuitem", { name: "Remove from club" }).click()

  const dialog = page.getByRole("dialog", { name: "Hand over teams, then remove Coach Rivera" })
  await expect(dialog).toContainText("Coach Rivera still coaches teams")
  await expect(dialog).toContainText("Coach Rivera is lead coach here. Nobody else coaches it.")
  await expect(dialog.locator("[data-handover-effects]")).toContainText("are closed, with a line saying they no longer coach the team")
  await expect(dialog.locator("[data-handover-effects]")).toContainText("The new coach does not see them")

  // A coach who is leaving cannot keep a team, and a team with nobody else cannot just stay as it is.
  const choice = dialog.locator('[data-handover-team="Sprint Group"]')
  await expect(choice.locator("option")).toHaveText(["Choose what happens", "Club Admin (you) takes over as lead (joins the team)", "Coach Smith takes over as lead (joins the team)"])

  // Without an answer for the team, nothing is sent.
  await dialog.getByRole("button", { name: "Hand over and remove" }).click()
  await expect(dialog).toContainText("Choose what happens to Sprint Group.")
  await expect(row).toBeVisible()

  // Cancelling leaves everything where it was.
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(row).toContainText("Sprint Group")

  await openStaffMenu(page, "Coach Rivera", "coach.rivera@pacelab.local")
  await page.getByRole("menuitem", { name: "Remove from club" }).click()
  await choice.selectOption({ label: "Coach Smith takes over as lead (joins the team)" })
  await dialog.getByRole("button", { name: "Hand over and remove" }).click()

  await expect(row).toHaveCount(0)
  await expect(page.locator('[data-person="coach.smith@pacelab.local"]')).toContainText("Sprint Group")
  const log = await auditLog(page, "handover-remove")
  expect(log).toContain("coach_handover")
  expect(log).toContain("Sprint Group to Coach Smith (lead). Then removed from the club.")
  expect(log).toContain("member_removed")

  // The team was never without a coach: Coach Smith leads it now.
  await page.goto("/club-admin/teams")
  await expect(page.locator('[data-team="Sprint Group"]')).toContainText("Coach Smith")
  await expect(page.locator('[data-team="Sprint Group"]')).not.toContainText("No lead coach")

  // The athlete keeps the conversation, closed, with a line saying why.
  await seedMockSession(page, { role: "athlete", tenantId: "handover-remove" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/athlete/messages/t/mock-thread-marcus")
  await expect(page.locator("[data-system-message]")).toHaveText("Coach Rivera no longer coaches this team")
  await expect(page.getByText("How did the knee feel after yesterday's session?")).toBeVisible()
  await expect(page.getByText("This coach no longer coaches your team, so this conversation is read only.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0)
})

test("deactivating a coach who still coaches hands the team over first", async ({ page }) => {
  await asAdmin(page, "handover-deactivate")
  await page.goto("/club-admin/users")

  const row = await openStaffMenu(page, "Coach Smith", "coach.smith@pacelab.local")
  await page.getByRole("menuitem", { name: "Deactivate" }).click()
  const dialog = page.getByRole("dialog", { name: "Hand over teams, then deactivate Coach Smith" })
  await dialog.locator('[data-handover-team="Distance Group"]').selectOption({ label: "Coach Rivera takes over as lead (joins the team)" })
  await dialog.getByRole("button", { name: "Hand over and deactivate" }).click()

  await expect(row).toContainText("Deactivated")
  await expect(row).toContainText("No team")
  await expect(page.locator('[data-person="coach.rivera@pacelab.local"]')).toContainText("Distance Group")
  expect(await auditLog(page, "handover-deactivate")).toContain("Distance Group to Coach Rivera (lead). Then deactivated.")

  // With no team left, reactivating and deactivating again is the plain confirmation.
  await openStaffMenu(page, "Coach Smith", "coach.smith@pacelab.local")
  await page.getByRole("menuitem", { name: "Reactivate" }).click()
  await expect(row).toContainText("Active")
  await openStaffMenu(page, "Coach Smith", "coach.smith@pacelab.local")
  await expect(page.getByRole("menuitem", { name: "Hand over teams" })).toHaveCount(0)
  await page.getByRole("menuitem", { name: "Deactivate" }).click()
  await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Deactivate" }).click()
  await expect(row).toContainText("Deactivated")
})

test("hand over teams without removing the coach, or leave a team with its remaining coaches", async ({ page }) => {
  await asAdmin(page, "handover-standalone")

  // Put Coach Smith on Sprint Group as a second coach, so the team could also stay as it is.
  await page.goto("/club-admin/teams?team=t1")
  await page.getByRole("button", { name: "Edit team" }).click()
  const form = page.getByRole("dialog", { name: "Edit team" })
  await form.getByRole("checkbox", { name: "Coach Smith" }).check()
  await form.getByRole("button", { name: "Save changes" }).click()
  await expect(page.locator('[data-team-coach="Coach Smith"]')).toHaveAttribute("data-team-coach-role", "coach")

  await page.goto("/club-admin/users")
  const row = await openStaffMenu(page, "Coach Rivera", "coach.rivera@pacelab.local")
  await page.getByRole("menuitem", { name: "Hand over teams" }).click()
  const dialog = page.getByRole("dialog", { name: "Hand over Coach Rivera's teams" })
  const choice = dialog.locator('[data-handover-team="Sprint Group"]')
  await expect(dialog).toContainText("Also coaching: Coach Smith.")
  await expect(choice.locator("option")).toHaveText([
    "Choose what happens",
    "Club Admin (you) takes over as lead (joins the team)",
    "Coach Smith takes over as lead",
    "No new lead, stays with Coach Smith",
    "Coach Rivera keeps this team",
  ])

  // Keeping every team is not a handover.
  await choice.selectOption({ label: "Coach Rivera keeps this team" })
  await dialog.getByRole("button", { name: "Hand over teams" }).click()
  await expect(dialog).toContainText("Choose at least one team to hand over.")

  await choice.selectOption({ label: "Coach Smith takes over as lead" })
  await dialog.getByRole("button", { name: "Hand over teams" }).click()
  await expect(dialog).toHaveCount(0)

  // Coach Rivera is still in the club, with no team, and is no longer offered a handover.
  await expect(row).toContainText("Active")
  await expect(row).toContainText("No team")
  await openStaffMenu(page, "Coach Rivera", "coach.rivera@pacelab.local")
  await expect(page.getByRole("menuitem", { name: "Hand over teams" })).toHaveCount(0)
  await page.keyboard.press("Escape")

  await page.goto("/club-admin/teams?team=t1")
  await expect(page.locator('[data-team-coach="Coach Smith"]')).toHaveAttribute("data-team-coach-role", "lead")
  await expect(page.locator('[data-team-coach="Coach Rivera"]')).toHaveCount(0)
  expect(await auditLog(page, "handover-standalone")).toContain("Sprint Group to Coach Smith (lead)")
})

test("the invite link in the handover step opens the staff invite", async ({ page }) => {
  await asAdmin(page, "handover-invite")
  await page.goto("/club-admin/users")
  await openStaffMenu(page, "Coach Rivera", "coach.rivera@pacelab.local")
  await page.getByRole("menuitem", { name: "Remove from club" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Invite a new coach first" }).click()
  await expect(page.getByRole("dialog", { name: "Invite staff" })).toBeVisible()
  // The coach was not touched.
  await page.getByRole("dialog", { name: "Invite staff" }).getByRole("button", { name: "Close" }).first().click()
  await expect(page.locator('[data-person="coach.rivera@pacelab.local"]')).toContainText("Sprint Group")
})

test("club admin picks a role when assigning a coach, changes it later and sets the two assistant switches", async ({ page }) => {
  await asAdmin(page, "assistant-roles")
  await page.goto("/club-admin/teams?team=t1")

  // Assign Coach Smith as an assistant from the team form.
  await page.getByRole("button", { name: "Edit team" }).click()
  const form = page.getByRole("dialog", { name: "Edit team" })
  await form.getByRole("checkbox", { name: "Coach Smith" }).check()
  await expect(form).toContainText("An assistant sees the team, takes attendance, logs sessions and enters test results")
  await form.getByLabel("Coach Smith", { exact: true }).last().selectOption({ label: "Assistant coach" })
  await form.getByRole("button", { name: "Save changes" }).click()

  const smith = page.locator('[data-team-coach="Coach Smith"]')
  await expect(smith).toHaveAttribute("data-team-coach-role", "assistant")
  await expect(smith).toContainText("Assistant coach")
  await expect(page.locator('[data-team-coach="Coach Rivera"]')).toContainText("Lead coach")

  // The form remembers the role.
  await page.getByRole("button", { name: "Edit team" }).click()
  await expect(form.getByLabel("Coach Smith", { exact: true }).last()).toHaveValue("assistant")
  await form.getByRole("button", { name: "Cancel" }).click()

  // Change it later from the coach's menu.
  await smith.getByRole("button", { name: "More for Coach Smith" }).click()
  await expect(page.getByRole("menuitem")).toHaveText(["Make lead coach", "Make coach", "Remove from team"])
  await page.getByRole("menuitem", { name: "Make coach" }).click()
  await expect(smith).toHaveAttribute("data-team-coach-role", "coach")

  // Making the second coach lead moves the first lead down, so there is one lead.
  await smith.getByRole("button", { name: "More for Coach Smith" }).click()
  await page.getByRole("menuitem", { name: "Make lead coach" }).click()
  await expect(smith).toHaveAttribute("data-team-coach-role", "lead")
  await expect(page.locator('[data-team-coach="Coach Rivera"]')).toHaveAttribute("data-team-coach-role", "coach")

  // Both switches are off until the admin turns them on, and they stay as set.
  const messaging = page.getByRole("checkbox", { name: /Assistants can message athletes/ })
  const health = page.getByRole("checkbox", { name: /Assistants can see health information/ })
  await expect(messaging).not.toBeChecked()
  await expect(health).not.toBeChecked()
  await health.check()
  await expect(health).toBeChecked()
  await page.reload()
  await expect(page.getByRole("checkbox", { name: /Assistants can see health information/ })).toBeChecked()
  await expect(page.getByRole("checkbox", { name: /Assistants can message athletes/ })).not.toBeChecked()
  const log = await auditLog(page, "assistant-roles")
  expect(log).toContain("team_assistant_settings")
  expect(log).toContain("assistants can see health information: yes")
})

test("an assistant coach sees and records, with no buttons for what is not theirs", async ({ page }) => {
  await asCoach(page, "assistant-view", "assistant")
  await page.goto("/coach/dashboard")

  // One quiet line, and no planning actions.
  await expect(page.locator("[data-assistant-line]")).toHaveText("You are an assistant coach on this team.")
  await expect(page.getByRole("link", { name: "Build a plan" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "New test week" })).toHaveCount(0)
  const nav = page.getByRole("navigation").first()
  await expect(nav.getByRole("link", { name: "Plans" })).toHaveCount(0)
  await expect(nav.getByRole("link", { name: "Reports" })).toHaveCount(0)
  await expect(nav.getByRole("link", { name: "Athletes" })).toBeVisible()
  await expect(nav.getByRole("link", { name: "Test weeks" })).toBeVisible()
  // No health columns on the dashboard.
  await expect(page.getByRole("columnheader", { name: "Readiness" })).toHaveCount(0)
  await expect(page.getByRole("columnheader", { name: "Adherence" })).toBeVisible()

  // The roster: attendance yes, inviting and squads no.
  await page.goto("/coach/teams/t1")
  await expect(page.getByRole("link", { name: "Take attendance" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Add athletes" })).toHaveCount(0)
  await expect(page.getByRole("tab", { name: /Invites/ })).toHaveCount(0)
  await expect(page.getByRole("columnheader", { name: "Readiness" })).toHaveCount(0)
  await page.getByRole("tab", { name: /Squads/ }).click()
  await expect(page.getByRole("button", { name: "New squad" })).toHaveCount(0)

  // One athlete: training and results, log a session, no health, no roster actions.
  await page.goto("/coach/athletes/a1")
  await expect(page.getByRole("link", { name: "Log a session" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Add result" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /availability/i })).toHaveCount(0)
  await expect(page.getByRole("tab", { name: /Wellness/ })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Recent sessions" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Coach notes" })).toHaveCount(0)
  await page.getByRole("tab", { name: "Details" }).click()
  await expect(page.getByRole("heading", { name: "Contacts" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Move to another team" })).toHaveCount(0)

  // Test weeks: results can be entered, nothing can be set up.
  await page.goto("/coach/test-week")
  await expect(page.getByRole("heading", { name: "Test weeks" })).toBeVisible()
  await expect(page.getByRole("button", { name: "New test week" })).toHaveCount(0)

  // Messages: announcements are read, nothing can be started.
  await page.goto("/coach/messages")
  await expect(page.getByRole("button", { name: "Message an athlete" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "New announcement" })).toHaveCount(0)

  // Typing the address of a screen that is not theirs gets a plain explanation, not a broken page.
  for (const [path, title] of [
    ["/coach/training-plan", "Plans are with the lead coach"],
    ["/coach/training-plan/exercises", "This is with the lead coach"],
    ["/coach/reports", "Reports are with the lead coach"],
    ["/coach/messages/with/a1", "Messaging is off for assistant coaches"],
    ["/coach/messages/a/new", "Announcements are with the lead coach"],
  ] as const) {
    await page.goto(path)
    await expect(page.getByRole("heading", { name: title })).toBeVisible()
    await expect(page.locator("[data-assistant-gate]")).toContainText("You are an assistant coach on Sprint Group.")
    await expect(page.getByRole("link", { name: "Back to the dashboard" })).toBeVisible()
  }
})

test("a lead coach and a coach see everything they did before", async ({ page }) => {
  for (const role of ["lead", "coach"] as const) {
    await asCoach(page, `full-rights-${role}`, role)
    await page.goto("/coach/dashboard")
    await expect(page.locator("[data-assistant-line]")).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Build a plan" })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Readiness" })).toBeVisible()
    const nav = page.getByRole("navigation").first()
    await expect(nav.getByRole("link", { name: "Plans" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Reports" })).toBeVisible()

    await page.goto("/coach/teams/t1")
    await expect(page.getByRole("button", { name: "Add athletes" })).toBeVisible()
    await expect(page.getByRole("tab", { name: /Invites/ })).toBeVisible()

    await page.goto("/coach/athletes/a1")
    await expect(page.getByRole("link", { name: "Add result" })).toBeVisible()
    await expect(page.getByRole("tab", { name: /Wellness/ })).toBeVisible()

    await page.goto("/coach/training-plan")
    await expect(page.locator("[data-assistant-gate]")).toHaveCount(0)
    await page.goto("/coach/messages")
    await expect(page.getByRole("button", { name: "Message an athlete" })).toBeVisible()
    await expect(page.getByRole("link", { name: "New announcement" })).toBeVisible()
  }
})

test("the two team switches open health and messaging for an assistant, and nothing else", async ({ page }) => {
  // The club admin turns both on for Sprint Group.
  await asAdmin(page, "assistant-switches")
  await page.goto("/club-admin/teams?team=t1")
  await page.getByRole("checkbox", { name: /Assistants can see health information/ }).check()
  await page.getByRole("checkbox", { name: /Assistants can message athletes/ }).check()
  await expect(page.getByRole("checkbox", { name: /Assistants can message athletes/ })).toBeChecked()

  await asCoach(page, "assistant-switches", "assistant")
  await page.goto("/coach/athletes/a1")
  await expect(page.getByRole("tab", { name: /Wellness/ })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Coach notes" })).toBeVisible()
  await page.getByRole("tab", { name: "Details" }).click()
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible()
  // Still not theirs.
  await expect(page.getByRole("button", { name: "Move to another team" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Add result" })).toHaveCount(0)

  await page.goto("/coach/messages")
  await expect(page.getByRole("button", { name: "Message an athlete" })).toBeVisible()
  await expect(page.getByRole("link", { name: "New announcement" })).toHaveCount(0)
  await page.goto("/coach/training-plan")
  await expect(page.getByRole("heading", { name: "Plans are with the lead coach" })).toBeVisible()
})

test("a coach asks for a handover, and a club admin sees the request", async ({ page }) => {
  await asCoach(page, "handover-request", "lead")
  await page.goto("/coach/teams/t1")

  await page.getByRole("button", { name: "Ask a club admin to hand it over" }).click()
  const dialog = page.getByRole("dialog", { name: "Ask to hand over Sprint Group" })
  await expect(dialog).toContainText("They choose who takes over, and you keep coaching the team until they do.")
  await dialog.getByLabel(/Note for the club admins/).fill("Moving abroad in June.")
  await dialog.getByRole("button", { name: "Send request" }).click()
  await expect(page.locator("[data-handover-request-sent]")).toContainText("to hand over Sprint Group")
  // The coach is still on the team: asking moves nothing.
  await expect(page.getByRole("button", { name: "Add athletes" })).toBeVisible()

  await asAdmin(page, "handover-request")
  await page.goto("/club-admin/users")
  const request = page.locator("[data-handover-request]")
  await expect(request).toContainText("asked to hand over Sprint Group")
  await expect(request).toContainText("Moving abroad in June.")
  await page.getByRole("button", { name: "Set aside" }).click()
  await expect(request).toHaveCount(0)
  expect(await auditLog(page, "handover-request")).toContain("coach_handover_requested")
})

test("handover and the assistant view fit a phone", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin", tenantId: "handover-phone" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/club-admin/users")
  await page.locator('[data-person="coach.rivera@pacelab.local"]').getByRole("button", { name: "More for Coach Rivera" }).click()
  await page.getByRole("menuitem", { name: "Hand over teams" }).click()
  await expect(page.getByRole("dialog", { name: "Hand over Coach Rivera's teams" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()

  await page.goto("/club-admin/teams?team=t1")
  await expect(page.getByRole("checkbox", { name: /Assistants can message athletes/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await seedMockSession(page, { role: "coach", tenantId: "handover-phone", coachTeamId: "t1" })
  await page.addInitScript(() => window.localStorage.setItem("pacelab:mock-coach-team-roles", JSON.stringify({ t1: "assistant" })))
  await page.goto("/coach/dashboard")
  await expect(page.locator("[data-assistant-line]")).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
