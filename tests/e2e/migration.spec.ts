import { expect, test } from "@playwright/test"

type Role = "athlete" | "coach" | "club-admin"

const athleteRoutes = [
  "/athlete/home",
  "/athlete/join",
  "/athlete/join/t1",
  "/athlete/log",
  "/athlete/profile",
  "/athlete/prs",
  "/athlete/test-week",
  "/athlete/training-plan",
  "/athlete/trends",
  "/athlete/wellness",
]

const coachRoutes = [
  "/coach/dashboard",
  "/coach/reports",
  "/coach/teams",
  "/coach/teams/t4",
  "/coach/test-week",
  "/coach/training-plan",
  "/coach/athletes/a4",
]

const clubAdminRoutes = [
  "/club-admin/dashboard",
  "/club-admin/profile",
  "/club-admin/users",
  "/club-admin/teams",
  "/club-admin/reports",
  "/club-admin/billing",
  "/club-admin/audit",
]

async function seedSession(page: import("@playwright/test").Page, role: Role) {
  const email =
    role === "athlete"
      ? "athlete@pacelab.local"
      : role === "coach"
        ? "coach@pacelab.local"
        : "clubadmin@pacelab.local"
  const coachTeamId = role === "coach" ? "t4" : undefined

  await page.addInitScript(
    ({ roleValue, emailValue, coachTeamIdValue }) => {
      window.localStorage.setItem("pacelab:mock-role", roleValue)
      window.localStorage.setItem("pacelab:mock-user-email", emailValue)
      if (coachTeamIdValue) {
        window.localStorage.setItem("pacelab:mock-coach-team", coachTeamIdValue)
      } else {
        window.localStorage.removeItem("pacelab:mock-coach-team")
      }
    },
    { roleValue: role, emailValue: email, coachTeamIdValue: coachTeamId },
  )

  await page.context().addCookies([
    { name: "pacelab_session", value: "1", url: "http://127.0.0.1:3007" },
    { name: "pacelab_role", value: role, url: "http://127.0.0.1:3007" },
    { name: "pacelab_tenant", value: "elite-track-club", url: "http://127.0.0.1:3007" },
    { name: "pacelab_user", value: encodeURIComponent(email), url: "http://127.0.0.1:3007" },
    {
      name: "pacelab_coach_team",
      value: coachTeamId ?? "",
      url: "http://127.0.0.1:3007",
    },
  ])
}

test("root and invite redirects behave correctly", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.locator("body")).toContainText("Sign in")

  await seedSession(page, "athlete")
  await page.goto("/invite/t1")
  await expect(page).toHaveURL(/\/athlete\/claim\/t1$/)
  await expect(page.locator("body")).toContainText("Claim athlete access")
})

test("protected routes redirect to login when unauthenticated", async ({ page }) => {
  await page.goto("/club-admin/dashboard")
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.locator("body")).toContainText("Sign in")
})

test("login flow reaches the coach dashboard", async ({ page }) => {
  await page.goto("/login")
  await page.getByLabel("Email").fill("coach@pacelab.local")
  await page.getByLabel("Password").fill("Password123!")
  await page.locator("form").getByRole("button", { name: "Sign in" }).click()

  await expect(page).toHaveURL(/\/coach\/dashboard$/)
  await expect(page.locator("body")).toContainText("Dashboard")
})

test("athlete route inventory resolves for an athlete session", async ({ page }) => {
  await seedSession(page, "athlete")

  for (const route of athleteRoutes) {
    await page.goto(route)
    await expect(page).toHaveURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
    await expect(page.locator("body")).toContainText(/PaceLab|Join Team|Profile|Training Plan|Test Week|Wellness|Trends/)
  }
})

test("coach route inventory resolves for a coach session", async ({ page }) => {
  await seedSession(page, "coach")

  for (const route of coachRoutes) {
    await page.goto(route)
    if (route === "/coach/teams") {
      await expect(page).toHaveURL(/\/coach\/teams\/t4$/)
      await expect(page.locator("body")).toContainText(/Sprint Group|Team not found|Roster State/)
      continue
    }

    await expect(page).toHaveURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
    await expect(page.locator("body")).toContainText(/PaceLab|Dashboard|Teams|Reports|Training Plan|Test Weeks|Athlete/)
  }
})

test("club-admin route inventory resolves for a club-admin session", async ({ page }) => {
  await seedSession(page, "club-admin")

  for (const route of clubAdminRoutes) {
    await page.goto(route)
    await expect(page).toHaveURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
    await expect(page.locator("body")).toContainText(/PaceLab|Dashboard|Profile|Users|Teams|Reports|Billing|Audit/)
  }
})

test("invalid coach entity routes render not-found equivalents", async ({ page }) => {
  await seedSession(page, "coach")

  await page.goto("/coach/teams/unknown-team")
  await expect(page.locator("body")).toContainText("Team not found")

  await page.goto("/coach/athletes/unknown-athlete")
  await expect(page.locator("body")).toContainText("Athlete not found")
})

test("desktop shell shows the sidebar navigation", async ({ page }) => {
  await seedSession(page, "coach")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/coach/dashboard")

  await expect(page.locator("aside")).toContainText("PaceLab")
  await expect(page.locator("aside")).toContainText("Dashboard")
})

test("mobile shell shows the bottom navigation", async ({ page }) => {
  await seedSession(page, "athlete")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/athlete/trends")

  await expect(page.locator("nav.fixed")).toContainText("Home")
  await expect(page.locator("nav.fixed a")).toHaveCount(5)
})

test("coach can complete the training plan setup-build-review-publish flow", async ({ page }) => {
  await seedSession(page, "coach")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/coach/training-plan")

  await page.getByRole("button", { name: "Create program" }).click()

  await page.getByLabel("Plan Name").fill("Throws Preseason Block")
  await page.getByPlaceholder("Optional plan notes").fill("High emphasis on power and technical rhythm.")
  const buildModeCombobox = page
    .locator("label:has-text('Build Mode')")
    .locator("xpath=following::button[@role='combobox'][1]")
  await buildModeCombobox.click()
  await page.getByText("Advanced", { exact: true }).click()
  await page.getByRole("button", { name: "Continue to Build" }).click()

  await expect(page.getByRole("heading", { name: "Build", exact: true })).toBeVisible()
  await expect(page.locator("body")).toContainText("Build Summary")

  const regenerateButton = page.getByRole("button", { name: "Regenerate from source" })
  if (await regenerateButton.count()) {
    await regenerateButton.click()
    await expect(page.getByRole("alertdialog")).toContainText("Regenerate plan structure?")
    await page.getByRole("button", { name: "Keep current build" }).click()
  }

  await page.getByRole("button", { name: "Continue to Review" }).first().click()
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible()
  await expect(page.locator("body")).toContainText("Throws Preseason Block")

  await page.getByRole("button", { name: "Publish" }).click()
  await expect(page.locator("body")).toContainText("Plan published to")
})
