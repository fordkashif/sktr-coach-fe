import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

// Demo data: the coach is on t1 "Sprint Group" (Marcus Johnson, Sarah Chen, David Okafor, Sophia Kim).
// Mia Anderson is on t4 "Throws Group", a team this coach is not on. The demo guardian follows
// Mia Anderson and Marcus Johnson.

const topBar = (page: Page) => page.locator("header[data-shell='topbar']")
const appBar = (page: Page) => page.locator("header[data-shell='appbar']")
const panel = (page: Page) => page.locator("[data-search-panel]")
const box = (page: Page) => page.getByRole("searchbox", { name: "Search" })
const group = (page: Page, id: string) => panel(page).locator(`[data-search-group='${id}']`)
const empty = (page: Page) => panel(page).locator("[data-search-empty]")

async function openSearch(page: Page) {
  await page.getByRole("button", { name: "Search", exact: true }).filter({ visible: true }).first().click()
  await expect(box(page)).toBeFocused()
}

/** Types a query and waits until the answer for it is on screen (the "Searching" rows are gone). */
async function search(page: Page, query: string) {
  await box(page).fill(query)
  await expect(panel(page).getByRole("status", { name: "Searching" })).toHaveCount(0)
}

test("coach: finds athletes of their own team, plans, exercises and screens, and goes there", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/coach/dashboard")
  await expect(topBar(page).getByRole("button", { name: "Search", exact: true })).toBeVisible()

  await openSearch(page)
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible()
  await expect(panel(page)).toContainText("Find an athlete, a team, a plan or template")

  // One letter does not search.
  await box(page).fill("m")
  await expect(panel(page)).toContainText("Keep typing. Search starts at 2 letters.")

  // Accents and case do not matter; team and squad are shown.
  await search(page, "MÁRCUS")
  await expect(group(page, "athletes").getByRole("link")).toHaveCount(1)
  await expect(group(page, "athletes")).toContainText("Marcus Johnson")
  await expect(group(page, "athletes")).toContainText("Sprint Group")

  // An athlete of a team this coach is not on is not found.
  await search(page, "mia anderson")
  await expect(group(page, "athletes")).toHaveCount(0)
  await expect(empty(page)).toContainText('Nothing found for "mia anderson"')
  await expect(empty(page)).toContainText("Search only looks at what you can open.")

  // Their team, their plan, a library exercise.
  await search(page, "sprint")
  await expect(group(page, "teams")).toContainText("Sprint Group")
  await search(page, "throws")
  await expect(group(page, "teams")).toHaveCount(0)
  await search(page, "spring build")
  await expect(group(page, "plans")).toContainText("Spring Build Phase")
  await search(page, "squat")
  await expect(group(page, "exercises").getByRole("link").first()).toBeVisible()

  // Nothing a coach has no screen for.
  for (const id of ["people", "invites", "seasons", "clubs", "sessions", "children"]) await expect(group(page, id)).toHaveCount(0)

  // A screen by its name, opened with Enter.
  await search(page, "attendance")
  await expect(group(page, "screens").getByRole("link", { name: "Attendance" })).toHaveAttribute("aria-current", "true")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/coach\/teams\/t1\/attendance$/)
  await expect(page.getByRole("dialog", { name: "Search" })).toHaveCount(0)

  // A screen by another word for it, opened with a click.
  await openSearch(page)
  await search(page, "maxes")
  await group(page, "screens").getByRole("link", { name: "Best lifts" }).click()
  await expect(page).toHaveURL(/\/coach\/training-plan\/maxes$/)

  // An athlete result goes to the athlete.
  await openSearch(page)
  await search(page, "sarah")
  await group(page, "athletes").getByRole("link", { name: /Sarah Chen/ }).click()
  await expect(page).toHaveURL(/\/coach\/athletes\/a2$/)
})

test("coach: keyboard shortcuts, arrow keys, escape and recent searches kept on the device", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/coach/dashboard")
  await expect(topBar(page)).toBeVisible()

  // "/" opens it, Escape closes it.
  await page.keyboard.press("/")
  await expect(box(page)).toBeFocused()
  await expect(box(page)).toHaveValue("")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Search" })).toHaveCount(0)

  // Ctrl and K opens it too.
  await page.keyboard.press("Control+k")
  await expect(box(page)).toBeFocused()

  // Arrow keys move through the rows across groups and wrap round.
  await search(page, "sp")
  const rows = panel(page).locator("[data-search-group] a")
  const count = await rows.count()
  expect(count).toBeGreaterThan(2)
  await expect(rows.nth(0)).toHaveAttribute("aria-current", "true")
  await page.keyboard.press("ArrowDown")
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true")
  await expect(panel(page).locator("[aria-current='true']")).toHaveCount(1)
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("ArrowUp")
  await expect(rows.nth(count - 1)).toHaveAttribute("aria-current", "true")

  // Following a result remembers the search, on this device only.
  await search(page, "sophia")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/coach\/athletes\/a10$/)
  expect(await page.evaluate(() => window.localStorage.getItem("sktr:recent-searches:coach@pacelab.local"))).toBe('["sophia"]')

  await page.keyboard.press("Control+k")
  await expect(group(page, "recent")).toContainText("sophia")
  await expect(group(page, "recent")).toContainText("Kept on this device only.")
  await group(page, "recent").getByRole("button", { name: "sophia" }).click()
  await expect(box(page)).toHaveValue("sophia")
  await expect(group(page, "athletes")).toContainText("Sophia Kim")
  await box(page).fill("")
  await group(page, "recent").getByRole("button", { name: "Clear" }).click()
  await expect(group(page, "recent")).toHaveCount(0)
  expect(await page.evaluate(() => window.localStorage.getItem("sktr:recent-searches:coach@pacelab.local"))).toBeNull()

  // "/" typed in a field is just a character.
  await box(page).fill("")
  await box(page).press("/")
  await expect(box(page)).toHaveValue("/")
})

test("coach: search still works when the browser refuses storage", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.addInitScript(() => {
    const real = Storage.prototype.getItem
    Storage.prototype.getItem = function (key: string) {
      if (key.startsWith("sktr:recent-searches")) throw new Error("blocked")
      return real.call(this, key)
    }
    const realSet = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("sktr:recent-searches")) throw new Error("blocked")
      return realSet.call(this, key, value)
    }
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/coach/dashboard")
  await openSearch(page)
  await search(page, "marcus")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/coach\/athletes\/a1$/)
  await openSearch(page)
  await expect(group(page, "recent")).toHaveCount(0)
})

test("coach: the top bar stays on one row at 1024px with the search button, with and without the team switcher", async ({ page }) => {
  for (const coachTeamIds of [undefined, ["t1", "t4"]]) {
    await seedMockSession(page, { role: "coach", coachTeamId: "t1", coachTeamIds })
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto("/coach/dashboard")
    const bar = topBar(page)
    await expect(bar.getByRole("button", { name: "Search", exact: true })).toBeVisible()
    await expect(bar.getByRole("link", { name: "Reports" })).toBeVisible()
    const metrics = await bar.evaluate((element) => {
      const nav = element.querySelector("nav")!
      return { height: element.getBoundingClientRect().height, barOverflow: element.scrollWidth - element.clientWidth, navOverflow: nav.scrollWidth - nav.clientWidth }
    })
    expect(metrics.height).toBeLessThanOrEqual(70)
    expect(metrics.barOverflow).toBeLessThanOrEqual(0)
    expect(metrics.navOverflow).toBeLessThanOrEqual(0)
  }
})

test("assistant coach: is not offered plans, the library, competitions or reports", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.addInitScript(() => window.localStorage.setItem("pacelab:mock-coach-team-roles", JSON.stringify({ t1: "assistant" })))
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/coach/dashboard")
  await expect(topBar(page).getByRole("link", { name: "Plans" })).toHaveCount(0)
  await openSearch(page)

  // The roster is theirs to see.
  await search(page, "marcus")
  await expect(group(page, "athletes")).toContainText("Marcus Johnson")
  await search(page, "attendance")
  await expect(group(page, "screens").getByRole("link", { name: "Attendance" })).toBeVisible()

  for (const query of ["spring build", "squat", "best lifts", "plans", "reports", "competitions", "templates", "announcement"]) {
    await search(page, query)
    await expect(group(page, "plans"), query).toHaveCount(0)
    await expect(group(page, "exercises"), query).toHaveCount(0)
    await expect(group(page, "competitions"), query).toHaveCount(0)
    await expect(group(page, "screens"), query).toHaveCount(0)
  }
})

test("club admin: finds people, teams and screens, not coach or athlete things", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin" })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/club-admin/dashboard")
  await openSearch(page)
  await expect(panel(page)).toContainText("Find a person, a team, an invite by email")

  await search(page, "rivera")
  await expect(group(page, "people")).toContainText("Coach Rivera")
  await expect(group(page, "people")).toContainText("Coach")
  // Emails of people are not shown in results.
  await expect(panel(page)).not.toContainText("@pacelab.local")

  // Athletes of every team are people to a club admin.
  await search(page, "mia")
  await expect(group(page, "people")).toContainText("Mia Anderson")
  await expect(group(page, "people")).toContainText("Athlete")

  // Guardians by name, with whose guardian they are and no contact details.
  await search(page, "dana")
  await expect(group(page, "people")).toContainText("Dana Anderson")
  await expect(group(page, "people")).toContainText("Guardian of")
  await expect(panel(page)).not.toContainText("@")

  await search(page, "throws")
  await expect(group(page, "teams")).toContainText("Throws Group")

  await search(page, "squat")
  await expect(group(page, "exercises")).toHaveCount(0)
  await search(page, "best lifts")
  await expect(empty(page)).toBeVisible()

  await search(page, "seasons")
  await group(page, "screens").getByRole("link", { name: "Seasons" }).click()
  await expect(page).toHaveURL(/\/club-admin\/profile\/seasons$/)

  await openSearch(page)
  await search(page, "sprint group")
  await group(page, "teams").getByRole("link", { name: /Sprint Group/ }).click()
  await expect(page).toHaveURL(/\/club-admin\/teams\?team=t1$/)
})

test("club admin: the top bar stays on one row at 1024px with the search button", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin" })
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto("/club-admin/dashboard")
  const bar = topBar(page)
  await expect(bar.getByRole("button", { name: "Search", exact: true })).toBeVisible()
  await expect(bar.getByRole("link", { name: "Billing" })).toBeVisible()
  const metrics = await bar.evaluate((element) => {
    const nav = element.querySelector("nav")!
    return { height: element.getBoundingClientRect().height, barOverflow: element.scrollWidth - element.clientWidth, navOverflow: nav.scrollWidth - nav.clientWidth }
  })
  expect(metrics.height).toBeLessThanOrEqual(70)
  expect(metrics.barOverflow).toBeLessThanOrEqual(0)
  expect(metrics.navOverflow).toBeLessThanOrEqual(0)
})

test("athlete on a phone: a full screen sheet with their own sessions, records, goals and screens, and no other athletes", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/athlete/home")
  await expect(appBar(page).getByRole("button", { name: "Search", exact: true })).toBeVisible()
  // The app bar still fits: brand, search, messages, bell, profile on one row with no sideways scroll.
  expect(await appBar(page).evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0)

  await openSearch(page)
  const sheet = page.getByRole("dialog", { name: "Search" })
  const size = await sheet.boundingBox()
  expect(size?.width).toBe(390)
  expect(size?.height).toBe(844)
  await expect(panel(page)).toContainText("Find a session by name or day")

  await search(page, "tempo")
  await expect(group(page, "sessions").getByRole("link").first()).toContainText("Tempo")
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)

  // Their records and goals by event.
  await search(page, "100m")
  await expect(group(page, "records")).toContainText("100m")
  await expect(group(page, "goals")).toContainText("100m")

  // Other athletes, staff lists and coach tools are not there.
  for (const query of ["sarah chen", "mia anderson", "best lifts", "attendance", "spring build"]) {
    await search(page, query)
    await expect(empty(page), query).toBeVisible()
  }

  // A coach of their team.
  await search(page, "campbell")
  await expect(group(page, "coaches").getByRole("link")).toHaveCount(1)
  await expect(group(page, "coaches")).toContainText("Lead coach")
  await expect(panel(page)).not.toContainText("@")

  // A screen.
  await search(page, "goals")
  await group(page, "screens").getByRole("link", { name: "Goals" }).click()
  await expect(page).toHaveURL(/\/athlete\/goals$/)
  await expect(page.getByRole("dialog", { name: "Search" })).toHaveCount(0)

  // A record goes to the event's history.
  await openSearch(page)
  await search(page, "100m")
  await group(page, "records").getByRole("link").first().click()
  await expect(page).toHaveURL(/\/athlete\/prs\/event\//)
})

test("guardian: finds the children they follow and their own screens only", async ({ page }) => {
  await seedMockSession(page, { role: "guardian" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/guardian/home")
  await openSearch(page)
  await expect(panel(page)).toContainText("Find a child you follow")

  await search(page, "mia")
  await expect(group(page, "children").getByRole("link")).toHaveCount(1)
  await expect(group(page, "children")).toContainText("Mia Anderson")

  // Athletes they do not follow, coaches, sessions, plans and staff screens are not there.
  for (const query of ["sarah chen", "david", "rivera", "tempo", "spring build", "attendance", "best lifts", "squat"]) {
    await search(page, query)
    await expect(empty(page), query).toBeVisible()
  }
  for (const id of ["athletes", "sessions", "coaches", "people", "plans", "records", "goals"]) await expect(group(page, id)).toHaveCount(0)

  await search(page, "health")
  await expect(group(page, "screens").getByRole("link", { name: "Health" })).toBeVisible()

  // Picking a child switches to that child.
  await search(page, "marcus")
  await group(page, "children").getByRole("link", { name: /Marcus Johnson/ }).click()
  await expect(page).toHaveURL(/\/guardian\/home$/)
  await expect(page.locator("#main-content")).toContainText("Marcus")
})

test("platform admin: finds clubs and requests by name or requestor email, and no club data", async ({ page }) => {
  await seedMockSession(page, { role: "platform-admin" })
  await page.addInitScript(() => {
    const base = { requestorName: "Req", jobTitle: null, organizationType: null, organizationWebsite: null, region: null, requestedPlan: "starter", expectedSeats: 10, expectedCoachCount: null, expectedAthleteCount: null, desiredStartDate: null, notes: null, billingStatus: "pending", reviewNotes: null, reviewedAt: null, accessInviteSentAt: null, accessInviteLastError: null }
    window.localStorage.setItem(
      "pacelab:platform-admin:requests",
      JSON.stringify([
        { ...base, id: "req-1", organizationName: "Kingston Harriers", requestorEmail: "owner@harriers.test", status: "approved", lifecycleStatus: "active", provisionedTenantId: "kingston-harriers", createdAt: "2026-09-01T10:00:00.000Z" },
        { ...base, id: "req-2", organizationName: "Harbour View Striders", requestorEmail: "asker@striders.test", status: "pending", lifecycleStatus: "pending_review", provisionedTenantId: null, createdAt: "2026-09-20T10:00:00.000Z" },
      ]),
    )
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/platform-admin/dashboard")
  await openSearch(page)
  await expect(panel(page)).toContainText("Find a club, a request by club or email")

  await search(page, "harriers")
  await expect(group(page, "clubs")).toContainText("Kingston Harriers")
  await expect(group(page, "requests")).toHaveCount(0)

  // A request by the requestor's email.
  await search(page, "asker@")
  await expect(group(page, "requests")).toContainText("Harbour View Striders")
  await expect(group(page, "clubs")).toHaveCount(0)

  await search(page, "platform")
  await expect(group(page, "admins")).toContainText("Platform Admin")

  // No athlete or club data.
  for (const query of ["marcus", "sprint group", "rivera", "squat", "attendance"]) {
    await search(page, query)
    await expect(empty(page), query).toBeVisible()
  }

  await search(page, "striders")
  await group(page, "requests").getByRole("link", { name: /Harbour View Striders/ }).click()
  await expect(page).toHaveURL(/\/platform-admin\/requests$/)
})

test("more than five results in a group are behind Show all", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/athlete/home")
  await openSearch(page)
  // The demo plan has the same session on many days.
  await search(page, "tempo")
  const sessions = group(page, "sessions")
  await expect(sessions.getByRole("link")).toHaveCount(5)
  const showAll = sessions.getByRole("button", { name: /^Show all \d+$/ })
  await expect(showAll).toBeVisible()
  const total = Number((await showAll.textContent())!.replace(/\D/g, ""))
  expect(total).toBeGreaterThan(5)
  // Most recent first inside the group.
  const days = await sessions.locator(".sk-list-sub").allTextContents()
  const stamps = days.map((text) => Date.parse(text.split(",")[0]))
  expect([...stamps].sort((left, right) => right - left)).toEqual(stamps)
  await showAll.click()
  await expect(sessions.getByRole("link")).toHaveCount(total)
  await expect(showAll).toHaveCount(0)
})
