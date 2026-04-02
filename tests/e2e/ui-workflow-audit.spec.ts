import { expect, test } from "@playwright/test"
import fs from "node:fs/promises"
import path from "node:path"
import { seedMockSession } from "./helpers/session"

const desktopViewport = { width: 1440, height: 1100 }

test.describe("ui workflow audit", () => {
  test("capture builder and dense workflow surfaces", async ({ page }, testInfo) => {
    test.setTimeout(90000)
    await page.setViewportSize(desktopViewport)

    const screenshotDir = path.resolve(testInfo.config.rootDir, "artifacts", "ui-workflow-audit")
    await fs.mkdir(screenshotDir, { recursive: true })

    await seedMockSession(page, { role: "coach", coachTeamId: "t4" })

    await page.goto("/coach/training-plan")
    await page.waitForLoadState("networkidle")
    await expect(page.locator("main")).toBeVisible()
    await page.getByRole("button", { name: "Create program" }).click()
    await page.waitForTimeout(250)
    await page.screenshot({
      path: path.join(screenshotDir, "coach-training-plan-setup.png"),
      fullPage: true,
    })

    await page.getByRole("button", { name: /continue to build/i }).click()
    await page.waitForTimeout(250)
    await page.screenshot({
      path: path.join(screenshotDir, "coach-training-plan-build.png"),
      fullPage: true,
    })

    await page.goto("/coach/test-week")
    await page.waitForLoadState("networkidle")
    await page.getByRole("button", { name: "Create test" }).click()
    await expect(page.locator("main")).toContainText("Create test")
    await page.waitForTimeout(250)
    await page.screenshot({
      path: path.join(screenshotDir, "coach-test-week-setup.png"),
      fullPage: true,
    })

    await page.goto("/coach/teams/t4")
    await page.waitForLoadState("networkidle")
    await page.getByRole("tab", { name: "Invites" }).click()
    await page.getByRole("button", { name: /generate invite/i }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.waitForTimeout(250)
    await page.screenshot({
      path: path.join(screenshotDir, "coach-team-invite-dialog.png"),
      fullPage: true,
    })

    await seedMockSession(page, { role: "athlete", coachTeamId: "t1" })
    await page.goto("/athlete/log")
    await page.waitForLoadState("networkidle")
    await expect(page.locator("main")).toBeVisible()
    await page.waitForTimeout(250)
    await page.screenshot({
      path: path.join(screenshotDir, "athlete-log-workflow.png"),
      fullPage: true,
    })
  })
})
