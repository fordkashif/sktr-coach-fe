import { expect, test } from "@playwright/test"
import fs from "node:fs/promises"
import path from "node:path"
import { seedMockSession, type Role } from "./helpers/session"

const desktopViewport = { width: 1440, height: 1100 }

type CaptureTarget = {
  role: Role
  path: string
  file: string
  coachTeamId?: string
}

const captureTargets: CaptureTarget[] = [
  { role: "athlete", path: "/athlete/home", file: "athlete-home.png", coachTeamId: "t1" },
  { role: "athlete", path: "/athlete/training-plan", file: "athlete-training-plan.png" },
  { role: "athlete", path: "/athlete/log", file: "athlete-log.png" },
  { role: "athlete", path: "/athlete/trends", file: "athlete-trends.png" },
  { role: "athlete", path: "/athlete/profile", file: "athlete-profile.png" },
  { role: "coach", path: "/coach/dashboard", file: "coach-dashboard.png", coachTeamId: "t4" },
  { role: "coach", path: "/coach/teams/t4", file: "coach-team-detail.png", coachTeamId: "t4" },
  { role: "coach", path: "/coach/reports", file: "coach-reports.png", coachTeamId: "t4" },
  { role: "coach", path: "/coach/training-plan", file: "coach-training-plan.png", coachTeamId: "t4" },
  { role: "coach", path: "/coach/test-week", file: "coach-test-week.png", coachTeamId: "t4" },
  { role: "club-admin", path: "/club-admin/dashboard", file: "club-admin-dashboard.png" },
  { role: "club-admin", path: "/club-admin/profile", file: "club-admin-profile.png" },
  { role: "club-admin", path: "/club-admin/users", file: "club-admin-users.png" },
  { role: "club-admin", path: "/club-admin/teams", file: "club-admin-teams.png" },
  { role: "club-admin", path: "/club-admin/reports", file: "club-admin-reports.png" },
  { role: "club-admin", path: "/club-admin/audit", file: "club-admin-audit.png" },
  { role: "club-admin", path: "/club-admin/billing", file: "club-admin-billing.png" },
  { role: "platform-admin", path: "/platform-admin/dashboard", file: "platform-admin-dashboard.png" },
  { role: "platform-admin", path: "/platform-admin/requests", file: "platform-admin-requests.png" },
  { role: "platform-admin", path: "/platform-admin/audit", file: "platform-admin-audit.png" },
]

test.describe("ui screenshot audit", () => {
  test("capture actor pages", async ({ page }, testInfo) => {
    test.setTimeout(90000)
    await page.setViewportSize(desktopViewport)

    const screenshotDir = path.resolve(testInfo.config.rootDir, "artifacts", "ui-screenshot-audit")
    await fs.mkdir(screenshotDir, { recursive: true })

    for (const target of captureTargets) {
      await seedMockSession(page, {
        role: target.role,
        coachTeamId: target.coachTeamId,
      })

      await page.goto(target.path)
      await page.waitForLoadState("networkidle")
      await expect(page.locator("main")).toBeVisible()
      await page.waitForTimeout(250)

      await page.screenshot({
        path: path.join(screenshotDir, target.file),
        fullPage: true,
      })
    }
  })
})
