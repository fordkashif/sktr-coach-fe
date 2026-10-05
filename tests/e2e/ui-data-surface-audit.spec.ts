import { expect, test } from "@playwright/test"
import fs from "node:fs/promises"
import path from "node:path"
import { seedMockSession } from "./helpers/session"

const desktopViewport = { width: 1440, height: 1100 }

const screenshotDirName = "ui-data-surface-audit"

test.describe("ui data surface audit", () => {
  test("capture dense admin data surfaces", async ({ page }, testInfo) => {
    test.setTimeout(90000)
    await page.setViewportSize(desktopViewport)

    const screenshotDir = path.resolve(testInfo.config.rootDir, "artifacts", screenshotDirName)
    await fs.mkdir(screenshotDir, { recursive: true })

    await seedMockSession(page, { role: "platform-admin" })
    await page.goto("/platform-admin/requests")
    await page.waitForLoadState("networkidle")
    await expect(page.locator("main")).toBeVisible()
    await page.waitForTimeout(250)
    await page.screenshot({
      path: path.join(screenshotDir, "platform-admin-requests-table.png"),
      fullPage: true,
    })

    await page.goto("/platform-admin/audit")
    await page.waitForLoadState("networkidle")
    await expect(page.locator("main")).toBeVisible()
    await page.waitForTimeout(250)
    await page.screenshot({
      path: path.join(screenshotDir, "platform-admin-audit.png"),
      fullPage: true,
    })

    await seedMockSession(page, { role: "club-admin" })
    await page.goto("/club-admin/users")
    await page.waitForLoadState("networkidle")
    await expect(page.locator("main")).toBeVisible()
    await page.waitForTimeout(250)
    await page.screenshot({
      path: path.join(screenshotDir, "club-admin-users.png"),
      fullPage: true,
    })

    await page.goto("/club-admin/audit")
    await page.waitForLoadState("networkidle")
    await expect(page.locator("main")).toBeVisible()
    await page.waitForTimeout(250)
    await page.screenshot({
      path: path.join(screenshotDir, "club-admin-audit.png"),
      fullPage: true,
    })

    await page.goto("/club-admin/reports")
    await page.waitForLoadState("networkidle")
    await expect(page.locator("main")).toBeVisible()
    await page.waitForTimeout(250)
    await page.screenshot({
      path: path.join(screenshotDir, "club-admin-reports.png"),
      fullPage: true,
    })
  })
})
