import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

/** The coach's roster: search, the four ways to add athletes, moving team and availability. Mock mode. */

test("coach searches and filters the roster", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/coach/teams/t1")

  const main = page.locator("#main-content")
  await expect(page.getByRole("heading", { level: 1, name: "Sprint Group" })).toBeVisible()
  await expect(main.getByRole("row")).toHaveCount(5)

  await page.getByLabel("Search athletes").fill("sar")
  await expect(main.getByRole("row")).toHaveCount(2)
  await expect(main).toContainText("Sarah Chen")
  await expect(main).toContainText("Showing 1 of 4")

  await page.getByLabel("Search athletes").fill("")
  await page.getByRole("radiogroup", { name: "Readiness" }).getByRole("radio", { name: "Watch" }).click()
  await expect(main.getByRole("row")).toHaveCount(2)
  await expect(main).toContainText("David Okafor")
  await page.getByRole("radiogroup", { name: "Readiness" }).getByRole("radio", { name: "Review" }).click()
  await expect(main).toContainText("No athletes match")
  await page.getByRole("button", { name: "Show everyone" }).click()
  await expect(main.getByRole("row")).toHaveCount(5)

  // A row opens the athlete.
  await main.getByRole("link", { name: /Marcus Johnson/ }).click()
  await expect(page).toHaveURL(/\/coach\/athletes\/a1$/)
  await expect(page.getByRole("heading", { level: 1, name: "Marcus Johnson" })).toBeVisible()
})

test("coach invites a mixed list at once and sees each line's outcome", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/teams/t1")
  await page.getByRole("button", { name: "Add athletes" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("tab", { name: "List" }).click()
  await dialog
    .getByLabel("Athletes, one per line")
    .fill(["maya@example.com", "Jordan Reid, jordan@example.com", "not an email", "athlete@pacelab.local", "coach@pacelab.local", "maya@example.com"].join("\n"))

  await expect(dialog.locator("[data-bulk-count]")).toContainText("2 ready to invite, 4 will be skipped")
  await expect(dialog.locator('[data-line-status="on_team"]')).toContainText("Already on the team")
  await expect(dialog.locator('[data-line-status="staff_account"]')).toContainText("Coach or admin account")
  await expect(dialog.locator('[data-line-status="invalid"]')).toHaveCount(2)

  await dialog.getByRole("button", { name: "Send 2 invites" }).click()
  await expect(dialog.locator("[data-bulk-summary]")).toContainText("2 invites sent")
  await expect(dialog.locator('[data-line-status="sent"]')).toHaveCount(2)
  await dialog.getByRole("button", { name: "Close" }).click()

  await page.getByRole("tab", { name: /Invites/ }).click()
  await expect(page.locator('[data-invite="maya@example.com"]')).toContainText("Waiting")
  await expect(page.locator('[data-invite="jordan@example.com"]')).toContainText("Jordan Reid")
  await expect(page.locator('[data-invite="jordan@example.com"] [data-invite-email-status]')).toContainText("Emailed")

  // Asking again does not invite the same people twice.
  await page.getByRole("button", { name: "Add athletes" }).click()
  await dialog.getByRole("tab", { name: "List" }).click()
  await dialog.getByLabel("Athletes, one per line").fill("maya@example.com")
  await expect(dialog.locator('[data-line-status="invited"]')).toContainText("Already invited")
  await expect(dialog.getByRole("button", { name: "Send invites" })).toBeDisabled()
})

test("coach shows a QR join code, a new athlete joins with it, and the code can be turned off", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/teams/t1")
  await page.getByRole("button", { name: "Add athletes" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("tab", { name: "QR code" }).click()
  await dialog.getByRole("button", { name: "Create join code" }).click()

  const qr = dialog.getByRole("img", { name: "QR code to join Sprint Group" })
  await expect(qr).toBeVisible()
  const link = await dialog.getByLabel("Or share the link").inputValue()
  expect(link).toMatch(/\/join\/[0-9a-f]{32}$/)
  // The QR code carries exactly the link shown under it.
  await expect(qr).toHaveAttribute("data-qr-value", link)
  await expect(dialog).toContainText("0 of")

  // Someone who is not signed in opens the link.
  await page.context().clearCookies()
  await page.goto(new URL(link).pathname)
  await expect(page.getByRole("heading", { level: 1, name: "Join Sprint Group" })).toBeVisible()
  await expect(page.locator("body")).toContainText("Elite Track Club")
  await page.getByLabel("Full name").fill("Nia Newcomer")
  await page.getByRole("button", { name: "Join the team" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "You are in" })).toBeVisible()

  // A wrong code says nothing about any team.
  await page.goto("/join/ffffffffffffffffffffffffffffffff")
  await expect(page.getByRole("heading", { level: 1, name: "We could not find that join code" })).toBeVisible()
  await expect(page.locator("body")).not.toContainText("Sprint Group")

  // The coach sees the new athlete and turns the code off.
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/teams/t1")
  await expect(page.locator("#main-content")).toContainText("Nia Newcomer")
  await page.getByRole("button", { name: "Add athletes" }).click()
  await dialog.getByRole("tab", { name: "QR code" }).click()
  await expect(dialog).toContainText("1 of")
  await dialog.getByRole("button", { name: "Turn off" }).click()
  await dialog.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Turn off" }).click()
  await expect(dialog.getByRole("button", { name: "Create join code" })).toBeVisible()

  await page.context().clearCookies()
  await page.goto(new URL(link).pathname)
  await expect(page.getByRole("heading", { level: 1, name: "This join code was turned off" })).toBeVisible()
})

test("coach adds an athlete without a login, enters a result for them and gives them a login", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/teams/t1")
  await page.getByRole("button", { name: "Add athletes" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("tab", { name: "No login" }).click()
  await dialog.getByRole("button", { name: "Add athlete" }).click()
  await expect(dialog).toContainText("Enter their first name.")
  await dialog.getByLabel("First name").fill("Tia")
  await dialog.getByLabel("Last name").fill("Small")
  await dialog.getByLabel(/Date of birth/).fill("2016-05-01")
  await dialog.getByLabel(/Main event/).fill("60m")
  await dialog.getByLabel(/Parent or guardian/).fill("Pat Small")
  await dialog.getByRole("button", { name: "Add athlete" }).click()
  await expect(dialog).toContainText("Tia Small is on the roster")
  await dialog.getByRole("button", { name: "Close" }).click()

  const main = page.locator("#main-content")
  await expect(main.getByRole("row").filter({ hasText: "Tia Small" })).toContainText("no login")
  await main.getByRole("link", { name: /Tia Small/ }).click()
  await expect(page.locator("[data-athlete-status]")).toContainText("No check-ins yet")

  // A result, entered by the coach with the form athletes use.
  await page.getByRole("link", { name: "Add result" }).click()
  await page.getByLabel("Event").selectOption({ label: "100m" })
  await page.getByRole("textbox", { name: "Time" }).fill("14.82")
  await page.getByRole("button", { name: "Save result" }).click()
  await expect(main).toContainText("14.82s is Tia's first 100m result")
  await expect(main.getByRole("row").filter({ hasText: "100m" })).toContainText("Personal best")

  await page.getByRole("tab", { name: "Details" }).click()
  await expect(main).toContainText("No login. You enter results and availability for them")
  await expect(main).toContainText("Pat Small")
  await page.getByRole("button", { name: "Give them a login" }).click()
  await page.getByRole("dialog").getByLabel(/Their email/).fill("tia.small@example.com")
  await page.getByRole("dialog").getByRole("button", { name: "Send login invite" }).click()
  await expect(page.getByRole("dialog")).toContainText("Invite emailed to")
})

test("coach on two teams sets availability and moves an athlete between them", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1", coachTeamIds: ["t1", "t4"] })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/coach/athletes/a3")
  const main = page.locator("#main-content")
  await expect(page.getByRole("heading", { level: 1, name: "David Okafor" })).toBeVisible()

  await page.getByRole("button", { name: "Set availability" }).first().click()
  await page.getByRole("dialog").getByRole("radio", { name: "Sick" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Save availability" }).click()
  await expect(page.locator("[data-athlete-status]")).toContainText("Sick until further notice")
  await page.getByRole("button", { name: "Mark available again" }).click()
  await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Mark available" }).click()
  await expect(page.locator("[data-athlete-status]")).toContainText("Available")

  await page.getByRole("tab", { name: "Details" }).click()
  await page.getByRole("button", { name: "Move to another team" }).click()
  await expect(page.getByRole("dialog").getByLabel("Move to")).toContainText("Throws Group")
  await page.getByRole("dialog").getByRole("button", { name: "Move athlete" }).click()
  await expect(main).toContainText("David Okafor moved to Throws Group")

  await page.goto("/coach/teams/t4")
  await expect(main).toContainText("David Okafor")
  await page.goto("/coach/teams/t1")
  await expect(page.getByRole("heading", { level: 1, name: "Sprint Group" })).toBeVisible()
  await expect(main).not.toContainText("David Okafor")
  // Nothing scrolls sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
})
