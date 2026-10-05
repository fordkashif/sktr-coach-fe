import { expect, test } from "@playwright/test"

type Role = "athlete" | "coach" | "club-admin"

const athleteRoutes = [
  "/athlete/home",
  "/athlete/join",
  "/athlete/join/t1",
  "/athlete/log",
  "/athlete/profile",
  "/athlete/competitions",
  "/athlete/prs",
  "/athlete/prs/event/k%3A100m",
  "/athlete/test-week",
  "/athlete/test-week/history",
  "/athlete/training-plan",
  "/athlete/trends",
  "/athlete/wellness",
  "/athlete/wellness/history",
  "/athlete/wellness/pain",
  "/athlete/messages",
]

const coachRoutes = [
  "/coach/dashboard",
  "/coach/reports",
  "/coach/teams",
  "/coach/teams/t4",
  "/coach/test-week",
  "/coach/training-plan",
  "/coach/athletes/a4",
  "/coach/competitions",
  "/coach/competitions/new",
  "/coach/messages",
  "/coach/messages/a/new",
]

const clubAdminRoutes = [
  "/club-admin/dashboard",
  "/club-admin/profile",
  "/club-admin/users",
  "/club-admin/teams",
  "/club-admin/reports",
  "/club-admin/billing",
  "/club-admin/audit",
  "/club-admin/messages",
  "/club-admin/messages/a/new",
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
  await expect(page.locator("body")).toContainText("Join Sprint Group")
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
    await expect(page.locator("body")).toContainText(/PaceLab|Join a team|Profile|Training Plan|Test Week|Wellness|Trends/)
  }
})

test("coach route inventory resolves for a coach session", async ({ page }) => {
  await seedSession(page, "coach")

  for (const route of coachRoutes) {
    await page.goto(route)
    if (route === "/coach/teams") {
      await expect(page).toHaveURL(/\/coach\/teams\/t4$/)
      await expect(page.locator("body")).toContainText(/Sprint Group|Throws Group|Team not found|Roster/)
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

test("desktop shell shows the top bar navigation", async ({ page }) => {
  await seedSession(page, "coach")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/coach/dashboard")

  const topBar = page.locator("header[data-shell='topbar']")
  await expect(topBar).toBeVisible()
  await expect(topBar).toContainText("SKTR Coach")
  const nav = topBar.getByRole("navigation", { name: "Main" })
  for (const name of ["Dashboard", "Athletes", "Plans", "Test weeks", "Competitions", "Reports"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible()
  }
  await expect(nav.getByRole("link")).toHaveCount(6)
  await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page")
  // Messages is not a tab on desktop: it is an icon button with its unread count beside the bell.
  const messages = topBar.getByRole("link", { name: /^Messages/ })
  await expect(messages).toBeVisible()
  await messages.click()
  await expect(page).toHaveURL(/\/coach\/messages$/)
  await expect(messages).toHaveAttribute("aria-current", "page")
  // There is no sidebar any more, and the phone tab bar stays out of the way on desktop.
  await expect(page.locator("aside")).toHaveCount(0)
  await expect(page.locator("nav[data-shell='tabbar']")).toBeHidden()
})

test("the top bar keeps every club admin destination on one row at 1024px", async ({ page }) => {
  await seedSession(page, "club-admin")
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/club-admin/dashboard")

  const nav = page.locator("header[data-shell='topbar']").getByRole("navigation", { name: "Main" })
  for (const name of ["Dashboard", "People", "Teams", "Reports", "Club", "Activity", "Billing"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible()
  }
  const layout = await nav.evaluate((element) => ({
    rows: new Set([...element.children].map((child) => Math.round(child.getBoundingClientRect().top))).size,
    clipped: element.scrollWidth > element.clientWidth + 1,
    pageScrolls: document.documentElement.scrollWidth > window.innerWidth,
  }))
  expect(layout).toEqual({ rows: 1, clipped: false, pageScrolls: false })
})

test("the top bar keeps every coach destination on one row at 1024px", async ({ page }) => {
  await seedSession(page, "coach")
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/coach/dashboard")

  const topBar = page.locator("header[data-shell='topbar']")
  const nav = topBar.getByRole("navigation", { name: "Main" })
  for (const name of ["Dashboard", "Athletes", "Plans", "Test weeks", "Competitions", "Reports"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible()
  }
  const layout = await nav.evaluate((element) => ({
    rows: new Set([...element.children].map((child) => Math.round(child.getBoundingClientRect().top))).size,
    clipped: element.scrollWidth > element.clientWidth + 1,
    pageScrolls: document.documentElement.scrollWidth > window.innerWidth,
  }))
  expect(layout).toEqual({ rows: 1, clipped: false, pageScrolls: false })
  // The Messages button, the bell and the profile menu are all inside the bar.
  for (const control of [
    topBar.getByRole("link", { name: /^Messages/ }),
    topBar.getByRole("button", { name: /^Notifications/ }),
    topBar.getByRole("button", { name: "Open profile menu" }),
  ]) {
    const box = await control.boundingBox()
    expect(box !== null && box.x + box.width <= 1024).toBe(true)
  }
})

test("mobile shell shows the bottom navigation", async ({ page }) => {
  await seedSession(page, "athlete")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/athlete/trends")

  const tabBar = page.locator("nav[data-shell='tabbar']")
  await expect(tabBar).toBeVisible()
  await expect(tabBar).toContainText("Home")
  await expect(tabBar.locator("a")).toHaveCount(5)
  await expect(tabBar.getByRole("link", { name: "Progress" })).toHaveAttribute("aria-current", "page")
  // The athlete's centre item is the log button.
  await tabBar.getByRole("link", { name: "Log a session" }).click()
  await expect(page).toHaveURL(/\/athlete\/log$/)
  await expect(page.locator("header[data-shell='topbar']")).toBeHidden()
  // Messages is not one of the athlete's five tabs: it is an icon button beside the bell in the app bar.
  await expect(tabBar.getByRole("link", { name: /Messages/ })).toHaveCount(0)
  const appBar = page.locator("header[data-shell='appbar']")
  await appBar.getByRole("link", { name: /^Messages/ }).click()
  await expect(page).toHaveURL(/\/athlete\/messages$/)
  await expect(tabBar).toBeVisible()
})

test("a coach's phone tabs are Dashboard, Athletes, Plans, Messages and More", async ({ page }) => {
  await seedSession(page, "coach")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/coach/dashboard")

  const tabBar = page.locator("nav[data-shell='tabbar']")
  await expect(tabBar.locator("a")).toHaveCount(4)
  await expect(tabBar.locator("a span.truncate")).toHaveText(["Dashboard", "Athletes", "Plans", "Messages"])
  await tabBar.getByRole("link", { name: /^Messages/ }).click()
  await expect(page).toHaveURL(/\/coach\/messages$/)
  await expect(tabBar.getByRole("link", { name: /^Messages/ })).toHaveAttribute("aria-current", "page")

  await tabBar.getByRole("button", { name: "More" }).click()
  const sheet = page.getByRole("dialog", { name: "More" })
  await expect(sheet.getByRole("link")).toHaveText(["Test weeks", "Competitions", "Reports"])
  await sheet.getByRole("link", { name: "Competitions" }).click()
  await expect(page).toHaveURL(/\/coach\/competitions$/)
  await expect(sheet).toBeHidden()
  // More stays lit on a screen that lives behind it.
  await expect(tabBar.getByRole("button", { name: "More" })).toHaveClass(/text-sk-blue/)
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(fits).toBe(true)
})

test("a role with more than five destinations gets a More tab on a phone", async ({ page }) => {
  await seedSession(page, "club-admin")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/club-admin/dashboard")

  const tabBar = page.locator("nav[data-shell='tabbar']")
  await expect(tabBar.locator("a")).toHaveCount(4)
  await tabBar.getByRole("button", { name: "More" }).click()
  const sheet = page.getByRole("dialog", { name: "More" })
  for (const name of ["Messages", "Club", "Activity", "Billing"]) {
    await expect(sheet.getByRole("link", { name })).toBeVisible()
  }
  await sheet.getByRole("link", { name: "Billing" }).click()
  await expect(page).toHaveURL(/\/club-admin\/billing$/)
  await expect(sheet).toBeHidden()
})

test("the profile menu opens the account screen for every signed-in role", async ({ page }) => {
  await seedSession(page, "coach")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/coach/dashboard")

  await page.locator("header[data-shell='topbar']").getByRole("button", { name: "Open profile menu" }).click()
  await page.getByRole("menuitem", { name: "Your account" }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible()
})

test("athlete home shows today's session, the week and what is left to do", async ({ page }) => {
  await seedSession(page, "athlete")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/athlete/home")

  const main = page.locator("#main-content")
  await expect(main.getByRole("heading", { level: 1 })).toBeVisible()
  // One colour block at most, and it carries the primary action.
  await expect(main.locator("[data-sk-hero]")).toHaveCount(1)
  await expect(main.locator("[data-sk-hero]").getByRole("link", { name: /session$/ })).toHaveAttribute("href", "/athlete/log")
  await expect(main.getByRole("list", { name: "This week" }).getByRole("listitem")).toHaveCount(7)
  await expect(main.getByRole("link", { name: /Wellness check-in/ })).toHaveAttribute("href", "/athlete/wellness")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test("coach dashboard lists the team's athletes in a table that links to each athlete", async ({ page }) => {
  await seedSession(page, "coach")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/coach/dashboard")

  const main = page.locator("#main-content")
  await expect(main.getByRole("heading", { level: 1, name: "Throws Group" })).toBeVisible()
  const table = main.getByRole("table", { name: "Athletes on this team" })
  await expect(table.getByRole("columnheader")).toHaveText(["Athlete", "Readiness", "Availability", "Last check-in", "Adherence"])
  // Who has done today's planned session sits beside the table.
  await expect(main.getByRole("heading", { level: 2, name: "Today's session" })).toBeVisible()
  await expect(table.getByRole("rowheader")).toHaveCount(2)
  await expect(main.locator("[data-sk-hero]")).toHaveCount(0)
  await table.getByRole("link", { name: /Mia Anderson/ }).click()
  await expect(page).toHaveURL(/\/coach\/athletes\/a8$/)
})

test("coach can complete the training plan setup-build-review-publish flow", async ({ page }) => {
  await seedSession(page, "coach")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/coach/training-plan")

  await page.getByRole("button", { name: "New plan" }).click()

  await page.getByLabel("Plan name").fill("Throws Preseason Block")
  await page.getByPlaceholder("Optional plan notes").fill("High emphasis on power and technical rhythm.")
  await page.getByRole("tab", { name: "Template" }).click()
  await page.getByRole("button", { name: "Continue to build" }).click()

  await expect(page.getByRole("heading", { name: "Throws Preseason Block" })).toBeVisible()
  await expect(page.getByRole("heading", { name: /^Week 1/ })).toBeVisible()
  await expect(page.locator('[data-has-session="true"]')).toHaveCount(5)

  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Publish plan" })).toBeVisible()
  await expect(page.locator("body")).toContainText("Throws Preseason Block")

  await page.getByRole("button", { name: /^Publish to/ }).click()
  await expect(page.locator("body")).toContainText("Plan published to")
})
