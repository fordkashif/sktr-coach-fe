import { expect, test, type Page } from "@playwright/test"
import { seedMockSession, type Role } from "./helpers/session"

// Reminders in mock mode: they show under the bell and in the history, a tap opens the screen the
// reminder is about, the settings list them under "Reminders" with the right defaults, and a club
// admin can set the club's time zone. (When and to whom the database sends them is checked against
// Postgres, not here.)

function bell(page: Page) {
  return page.locator('button[aria-label^="Notifications"]:visible')
}

async function openApp(page: Page, role: Role, path: string) {
  await seedMockSession(page, { role })
  await page.goto(path)
  await expect(bell(page)).toBeVisible()
}

test.describe("reminders on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("athlete: the session reminder is under the bell and opens the log", async ({ page }) => {
    await openApp(page, "athlete", "/athlete/home")
    await bell(page).click()
    const sheet = page.getByRole("dialog", { name: "Notifications" })
    await expect(sheet.getByRole("link", { name: /Your check-in for today is not done \(unread\)/ })).toBeVisible()
    await sheet.getByRole("link", { name: /Today: Acceleration and block starts/ }).click()
    await expect(page).toHaveURL(/\/athlete\/log/)
    await expect(sheet).toBeHidden()
    await expect(bell(page)).toHaveAccessibleName("Notifications, 3 unread")
  })

  test("athlete: the check-in reminder opens the check-in", async ({ page }) => {
    await openApp(page, "athlete", "/athlete/home")
    await bell(page).click()
    await page.getByRole("dialog", { name: "Notifications" }).getByRole("link", { name: /Your check-in for today is not done/ }).click()
    await expect(page).toHaveURL(/\/athlete\/wellness$/)
  })

  test("athlete: the test week reminder is in the history and opens the test week", async ({ page }) => {
    await openApp(page, "athlete", "/notifications")
    const row = page.getByRole("main").getByRole("link", { name: /Autumn testing closes tonight/ })
    await expect(row).toContainText("You still have 2 required tests without a result")
    await row.click()
    await expect(page).toHaveURL(/\/athlete\/test-week$/)
  })

  test("athlete: settings list reminders with daily ones in the app only by default", async ({ page }) => {
    await openApp(page, "athlete", "/settings/notifications")
    await expect(page.getByRole("heading", { level: 2, name: "Reminders" })).toBeVisible()
    for (const name of ["Session today", "Check-in not done"]) {
      const group = page.getByRole("group", { name })
      await expect(group.getByRole("switch", { name: `${name}, in app` })).toHaveAttribute("aria-checked", "true")
      await expect(group.getByRole("switch", { name: `${name}, email` })).toHaveAttribute("aria-checked", "false")
    }
    const closing = page.getByRole("group", { name: "Test week closing" })
    await expect(closing.getByRole("switch", { name: "Test week closing, email" })).toHaveAttribute("aria-checked", "true")
    // The coach digest is not an athlete's business.
    await expect(page.getByRole("group", { name: "Sessions not logged" })).toHaveCount(0)

    // A choice sticks.
    await page.getByRole("switch", { name: "Session today, email" }).click()
    await expect(page.getByText("Session today: email turned on.")).toBeVisible()
    await page.reload()
    await expect(page.getByRole("switch", { name: "Session today, email" })).toHaveAttribute("aria-checked", "true")
    // No sideways scroll on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test("athlete: with the whole email channel off, reminder email switches are off and locked", async ({ page }) => {
    await openApp(page, "athlete", "/settings/notifications")
    await page.getByRole("switch", { name: "By email" }).click()
    const closingEmail = page.getByRole("switch", { name: /^Test week closing, email/ })
    await expect(closingEmail).toHaveAttribute("aria-checked", "false")
    await expect(closingEmail).toBeDisabled()
  })
})

test.describe("reminders on desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test("coach: one digest row under the bell, and it opens the team", async ({ page }) => {
    await openApp(page, "coach", "/coach/dashboard")
    await bell(page).click()
    const sheet = page.getByRole("dialog", { name: "Notifications" })
    await expect(sheet.getByRole("link", { name: /athletes did not log yesterday's session/ })).toHaveCount(1)
    await sheet.getByRole("link", { name: /4 athletes did not log yesterday's session/ }).click()
    await expect(page).toHaveURL(/\/coach\/teams\/t1$/)
  })

  test("coach: the test week reminder opens the coach test week, and settings show the coach reminders", async ({ page }) => {
    await openApp(page, "coach", "/notifications")
    await page.getByRole("main").getByRole("link", { name: /Autumn testing closes tonight/ }).click()
    await expect(page).toHaveURL(/\/coach\/test-week$/)

    await page.goto("/settings/notifications")
    await expect(page.getByRole("heading", { level: 2, name: "Reminders" })).toBeVisible()
    await expect(page.getByRole("switch", { name: "Sessions not logged, email" })).toHaveAttribute("aria-checked", "false")
    await expect(page.getByRole("switch", { name: "Test week closing, email" })).toHaveAttribute("aria-checked", "true")
    await expect(page.getByRole("group", { name: "Session today" })).toHaveCount(0)
  })

  test("platform admin has no reminders section", async ({ page }) => {
    await openApp(page, "platform-admin", "/settings/notifications")
    await expect(page.getByRole("heading", { level: 2, name: "What you hear about" })).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: "Reminders" })).toHaveCount(0)
  })

  test("club admin sets the club time zone", async ({ page }) => {
    await openApp(page, "club-admin", "/club-admin/profile")
    const facts = page.locator('dl[aria-label="Time zone"]')
    await expect(facts).toContainText("Jamaica (America)")
    await expect(facts).toContainText("UTC-5")
    await page.getByRole("button", { name: "Edit time zone" }).click()
    await page.getByLabel("Time zone").selectOption("Europe/London")
    await expect(page.getByText(/It is \d\d:\d\d there now/)).toBeVisible()
    await page.getByRole("button", { name: "Save time zone" }).click()
    await expect(facts).toContainText("London (Europe)")
    await page.reload()
    await expect(facts).toContainText("London (Europe)")
  })
})
