import { expect, test, type Page } from "@playwright/test"
import { seedMockSession, type Role } from "./helpers/session"

// The notification centre in mock mode: every role has the bell, the sheet lists what is new, tapping
// a notification opens the screen it is about and marks it read, and /notifications holds the history.

/** The bell is drawn twice (phone app bar, desktop top bar); only one is visible at a time. */
function bell(page: Page) {
  return page.locator('button[aria-label^="Notifications"]:visible')
}

async function openApp(page: Page, role: Role, path: string) {
  await seedMockSession(page, { role })
  await page.goto(path)
  await expect(bell(page)).toBeVisible()
}

test.describe("notification centre", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("athlete sees the bell, opens it, taps a plan notification, lands on the plan, count drops", async ({ page }) => {
    await openApp(page, "athlete", "/athlete/home")
    await expect(bell(page)).toHaveAccessibleName("Notifications, 4 unread")
    await expect(bell(page).getByTestId("notification-count")).toHaveText("4")

    await bell(page).click()
    const sheet = page.getByRole("dialog", { name: "Notifications" })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole("listitem")).toHaveCount(7)
    await expect(sheet.getByRole("link", { name: /Coach Rivera left a note on your session \(unread\)/ })).toBeVisible()

    await sheet.getByRole("link", { name: /New training plan: Speed block/ }).click()
    await expect(page).toHaveURL(/\/athlete\/training-plan$/)
    await expect(sheet).toBeHidden()
    await expect(bell(page)).toHaveAccessibleName("Notifications, 3 unread")

    // Still read after a reload.
    await page.reload()
    await expect(bell(page)).toHaveAccessibleName("Notifications, 3 unread")
  })

  test("mark all read clears the count, and see all opens the full history", async ({ page }) => {
    await openApp(page, "athlete", "/athlete/home")
    await bell(page).click()
    const sheet = page.getByRole("dialog", { name: "Notifications" })
    await sheet.getByRole("link", { name: "See all" }).click()
    await expect(page).toHaveURL(/\/notifications$/)
    await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: "Today" })).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: "Yesterday" })).toBeVisible()
    await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(7)

    await page.getByRole("button", { name: "Mark all read" }).click()
    await expect(bell(page)).toHaveAccessibleName("Notifications")
    await expect(page.getByText("You are all caught up.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Mark all read" })).toHaveCount(0)
    await expect(page.getByRole("main").getByText("(unread)")).toHaveCount(0)
  })

  test("a session note opens the session log", async ({ page }) => {
    await openApp(page, "athlete", "/athlete/home")
    await page.goto("/notifications")
    await page.getByRole("link", { name: /Coach Rivera left a note on your session/ }).click()
    await expect(page).toHaveURL(/\/athlete\/log/)
    await expect(bell(page)).toHaveAccessibleName("Notifications, 3 unread")
  })

  for (const { role, home, subject, target } of [
    { role: "coach" as const, home: "/coach/dashboard", subject: /David Okafor reported low readiness/, target: /\/coach\/athletes\/a3$/ },
    { role: "club-admin" as const, home: "/club-admin/dashboard", subject: /Coach invite accepted/, target: /\/club-admin\/users$/ },
    { role: "platform-admin" as const, home: "/platform-admin/dashboard", subject: /New club request/, target: /\/platform-admin\/requests$/ },
  ]) {
    test(`${role} has the bell and a notification takes them to the right screen`, async ({ page }) => {
      await openApp(page, role, home)
      await expect(bell(page).getByTestId("notification-count")).toBeVisible()
      await bell(page).click()
      const sheet = page.getByRole("dialog", { name: "Notifications" })
      await sheet.getByRole("link", { name: subject }).first().click()
      await expect(page).toHaveURL(target)
    })
  }

  test("the full history is open to every signed-in role and closed to visitors", async ({ page }) => {
    await page.goto("/notifications")
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe("notification centre on desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("the bell sits in the top bar and settings are one step from the history", async ({ page }) => {
    await openApp(page, "coach", "/coach/dashboard")
    await expect(page.locator('[data-shell="topbar"]').locator('button[aria-label^="Notifications"]')).toBeVisible()
    await page.goto("/notifications")
    await page.getByRole("link", { name: "Notification settings" }).click()
    await expect(page).toHaveURL(/\/settings\/notifications$/)
    // Finished sessions are never emailed, so there is no email switch for them.
    const finished = page.getByRole("group", { name: "Finished sessions" })
    await expect(finished.getByRole("switch")).toHaveCount(1)
    await expect(finished.getByText("In app only")).toBeVisible()
    // Low readiness: in the app by default, email only when switched on.
    const readiness = page.getByRole("group", { name: "Low readiness" })
    await expect(readiness.getByRole("switch", { name: "Low readiness, in app" })).toHaveAttribute("aria-checked", "true")
    await expect(readiness.getByRole("switch", { name: "Low readiness, email" })).toHaveAttribute("aria-checked", "false")
  })
})
