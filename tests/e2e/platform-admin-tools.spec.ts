import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

/** Two demo clubs with a workspace: one in use, one where nobody has done anything. Seeded once per test. */
async function seedClubs(page: Page) {
  await page.addInitScript(() => {
    const key = "pacelab:platform-admin:requests"
    if (window.localStorage.getItem(key)) return
    const base = {
      jobTitle: "Head coach",
      organizationType: "club",
      organizationWebsite: null,
      region: "Jamaica",
      expectedSeats: 40,
      expectedCoachCount: 3,
      expectedAthleteCount: 37,
      desiredStartDate: null,
      notes: null,
      status: "approved",
      lifecycleStatus: "active",
      billingStatus: "active",
      billingProvider: null,
      billingCustomerId: null,
      billingSubscriptionId: null,
      billingContactName: null,
      billingContactEmail: null,
      billingCycle: "monthly",
      billingStartedAt: "2026-06-02T10:00:00.000Z",
      billingFailedAt: null,
      previousLifecycleStatus: null,
      reviewNotes: null,
      reviewedAt: "2026-06-01T10:00:00.000Z",
      accessInviteSentAt: "2026-06-01T10:05:00.000Z",
      accessInviteLastError: null,
    }
    window.localStorage.setItem(
      key,
      JSON.stringify([
        { ...base, id: "req-tools-1", organizationName: "Tools Test Club", requestorName: "Olive Owner", requestorEmail: "olive@toolstest.example", requestedPlan: "starter", provisionedTenantId: "tools-test-club", createdAt: "2026-06-01T09:00:00.000Z" },
        { ...base, id: "req-tools-2", organizationName: "Quiet Harbour Club", requestorName: "Quentin Quay", requestorEmail: "quentin@quietharbour.example", requestedPlan: "pro", provisionedTenantId: "quiet-harbour-club", createdAt: "2026-05-01T09:00:00.000Z" },
      ]),
    )
  })
}

async function asPlatformAdmin(page: Page) {
  await seedMockSession(page, { role: "platform-admin", tenantId: "platform" })
}

/** The page itself must never scroll sideways. */
async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const scroller = document.getElementById("main-content")
    return Math.max(document.documentElement.scrollWidth - window.innerWidth, scroller ? scroller.scrollWidth - scroller.clientWidth : 0)
  })
  expect(overflow).toBeLessThanOrEqual(1)
}

test.describe("platform admin tools", () => {
  test.beforeEach(async ({ page }) => {
    await seedClubs(page)
    await asPlatformAdmin(page)
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  test("club overview shows support facts, nothing personal, and is written to the activity", async ({ page }) => {
    await page.goto("/platform-admin/tenants")
    await page.locator('[data-club="Tools Test Club"]').click()
    const sheet = page.getByRole("dialog").filter({ hasText: "Tools Test Club" })
    await sheet.getByRole("link", { name: "Club overview" }).click()

    await expect(page).toHaveURL(/\/platform-admin\/tenants\/tools-test-club$/)
    await expect(page.getByRole("heading", { level: 1, name: "Tools Test Club" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Clubs", exact: true }).first()).toBeVisible()

    // Owner and admins by name and email.
    const admins = page.getByRole("list", { name: "Owner and club admins" })
    await expect(admins).toContainText("Olive Owner")
    await expect(admins).toContainText("olive@toolstest.example")
    await expect(admins).toContainText("Owner")

    // Package limits against use, teams with counts, season, last sign-in per role, counts.
    const main = page.locator("#main-content")
    await expect(main).toContainText("Starter package.")
    await expect(main).toContainText(/Athletes\s*\d+ now, limit 40/)
    await expect(main).toContainText("Photos and videos")
    await expect(page.getByRole("table", { name: "Teams with their size" })).toContainText("Sprint Group")
    await expect(main).toContainText("Last sign-in by role")
    await expect(main).toContainText("Season")
    await expect(main).toContainText("Sessions logged")
    await expect(main).toContainText("Test weeks")
    await expect(main).toContainText("Failed emails, last 28 days")
    await expect(main).toContainText("Nobody here can read them")

    // The club's log: kinds of events only, and nothing about messages.
    const activity = page.getByRole("list", { name: "Recent club activity" })
    await expect(activity).toContainText("Season started")
    await expect(activity).not.toContainText(/message/i)

    // Read only: nothing to press that changes the club or acts as a member.
    await expect(main.getByRole("button")).toHaveCount(0)
    await expect(main).not.toContainText(/readiness|soreness|wellness|pain report|impersonat/i)

    // Who looked, which club, when.
    await page.goto("/platform-admin/audit")
    const firstEntry = page.locator("#main-content li").filter({ hasText: "Opened a club overview for support" }).first()
    await expect(firstEntry).toContainText("Tools Test Club")
    await expect(firstEntry).toContainText("platformadmin@pacelab.local")

    // A club that does not exist says so.
    await page.goto("/platform-admin/tenants/no-such-club")
    await expect(page.getByRole("alert")).toContainText("That club was not found")
  })

  test("platform admins: add by email, guards, deactivate with an inline confirm, reactivate", async ({ page }) => {
    await page.goto("/platform-admin/admins")
    await expect(page.getByRole("heading", { level: 1, name: "Platform admins" })).toBeVisible()
    const table = page.getByRole("table", { name: "Platform admins" })
    const self = table.locator('[data-admin="platformadmin@pacelab.local"]')
    await expect(self).toContainText("(you)")
    await expect(self).toContainText("Active")
    // Cannot deactivate yourself: there is no button, only the reason.
    await expect(self.getByRole("button")).toHaveCount(0)
    await expect(self).toContainText("You cannot switch yourself off")

    // An email that belongs to a club member is refused.
    await page.getByLabel("Email").fill("coach@pacelab.local")
    await page.getByRole("button", { name: "Add platform admin" }).click()
    await expect(page.locator("#main-content")).toContainText("That email belongs to a club member")
    await expect(table.locator('[data-admin="coach@pacelab.local"]')).toHaveCount(0)

    // So is the owner of a club (they get club admin access by that email).
    await page.getByLabel("Email").fill("olive@toolstest.example")
    await page.getByRole("button", { name: "Add platform admin" }).click()
    await expect(page.locator("#main-content")).toContainText("That email belongs to a club member")

    await page.getByLabel("Email").fill("not-an-email")
    await page.getByRole("button", { name: "Add platform admin" }).click()
    await expect(page.locator("#main-content")).toContainText("Enter a full email address.")

    await page.getByLabel("Email").fill("New.Admin@sktr.example")
    await page.getByLabel(/^Name/).fill("New Admin")
    await page.getByRole("button", { name: "Add platform admin" }).click()
    const added = table.locator('[data-admin="new.admin@sktr.example"]')
    await expect(added).toContainText("New Admin")
    await expect(added).toContainText("by platformadmin@pacelab.local")
    await expect(added).toContainText("Has not signed in yet")

    // The same email twice is refused.
    await page.getByLabel("Email").fill("new.admin@sktr.example")
    await page.getByRole("button", { name: "Add platform admin" }).click()
    await expect(page.locator("#main-content")).toContainText("already a platform admin")

    // Deactivate asks in place, and backing out changes nothing.
    await added.getByRole("button", { name: "Deactivate new.admin@sktr.example" }).click()
    const confirm = page.getByRole("group", { name: "Confirm" })
    await expect(confirm).toContainText("Switch off platform access for new.admin@sktr.example?")
    await confirm.getByRole("button", { name: "Keep access" }).click()
    await expect(added).toContainText("Active")
    await added.getByRole("button", { name: "Deactivate new.admin@sktr.example" }).click()
    await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Deactivate" }).click()
    await expect(added).toContainText("Switched off")

    // With the other admin off too, the one left is the last active admin.
    const support = table.locator('[data-admin="support@sktr.example"]')
    await support.getByRole("button", { name: "Deactivate support@sktr.example" }).click()
    await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Deactivate" }).click()
    await expect(support).toContainText("Switched off")
    await expect(self).toContainText("The last active admin")

    await added.getByRole("button", { name: "Reactivate new.admin@sktr.example" }).click()
    await expect(added).toContainText("Active")
    await expect(self).toContainText("You cannot switch yourself off")

    // Every change is in the platform activity.
    await page.goto("/platform-admin/audit")
    const log = page.locator("#main-content")
    await expect(log).toContainText("Added a platform admin")
    await expect(log).toContainText("Switched off a platform admin")
    await expect(log).toContainText("Switched a platform admin back on")
  })

  test("usage: periods, totals, chart, clubs with no activity and a CSV", async ({ page }) => {
    await page.goto("/platform-admin/usage")
    await expect(page.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible()
    await expect(page.locator("#main-content")).toContainText("2 clubs in the last 28 days. 1 club had no activity.")

    const table = page.getByRole("table", { name: "Usage by club, last 28 days" })
    const busy = table.locator('[data-club="Tools Test Club"]')
    await expect(busy).toContainText("olive@toolstest.example")
    await expect(table.locator('[data-club="Quiet Harbour Club"]')).toContainText("No activity")
    const sessions28 = Number((await busy.locator('td[data-label="Sessions"]').innerText()).replace(/\D/g, ""))
    expect(sessions28).toBeGreaterThan(0)

    await expect(page.getByRole("list", { name: "Clubs with no activity" })).toContainText("Quiet Harbour Club")
    await expect(page.getByRole("list", { name: "Clubs with no activity" })).toContainText("quentin@quietharbour.example")
    await expect(page.getByRole("img", { name: /Sessions logged per week across all clubs/ })).toBeVisible()
    await expect(page.getByRole("list", { name: /Totals for the last 28 days/ }).or(page.locator('dl[aria-label="Totals for the last 28 days"]'))).toContainText("Reminders sent")

    // A shorter period has fewer sessions.
    await page.getByRole("tab", { name: "7 days" }).click()
    const week = page.getByRole("table", { name: "Usage by club, last 7 days" }).locator('[data-club="Tools Test Club"]')
    await expect(week).toBeVisible()
    const sessions7 = Number((await week.locator('td[data-label="Sessions"]').innerText()).replace(/\D/g, ""))
    expect(sessions7).toBeLessThan(sessions28)
    await page.getByRole("tab", { name: "90 days" }).click()
    await expect(page.getByRole("table", { name: "Usage by club, last 90 days" })).toBeVisible()

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()])
    expect(download.suggestedFilename()).toBe("platform-usage-90-days.csv")

    // A club name opens its overview.
    await page.getByRole("table", { name: "Usage by club, last 90 days" }).getByRole("link", { name: "Tools Test Club" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Tools Test Club" })).toBeVisible()
  })

  test("notice to all clubs: audience, banner, notification, dismiss and withdraw", async ({ page }) => {
    // Many screens and several roles in one run.
    test.setTimeout(120_000)
    await page.goto("/platform-admin/notices")
    await expect(page.getByRole("heading", { level: 1, name: "Notices" })).toBeVisible()
    await expect(page.locator("#main-content")).toContainText("No notices sent yet")

    // Nothing is sent without a title and a body.
    await page.getByRole("button", { name: "Review and send" }).click()
    await expect(page.locator("#main-content")).toContainText("Give the notice a title of at least 3 characters.")
    await expect(page.locator("#main-content")).toContainText("Write the notice.")

    // A notice for staff only.
    await page.getByLabel("Title").fill("Staff briefing")
    await page.getByLabel("Notice", { exact: true }).fill("New squad tools arrive on Monday.")
    await page.getByLabel(/^Link/).fill("http://insecure.example")
    await page.getByLabel("Who is it for").selectOption("staff")
    await page.getByRole("button", { name: "Review and send" }).click()
    await expect(page.locator("#main-content")).toContainText("The link must start with https://")
    await page.getByLabel(/^Link/).fill("/settings/notifications")
    await page.getByRole("button", { name: "Review and send" }).click()
    await expect(page.getByRole("group", { name: "Confirm" })).toContainText("Send this to staff only in every open club?")
    await page.getByRole("button", { name: "Send notice" }).click()

    const sent = page.getByRole("table", { name: "Sent notices" })
    const staffRow = sent.locator('[data-notice="Staff briefing"]')
    await expect(staffRow).toContainText("Staff only")
    await expect(staffRow).toContainText("Showing")
    await expect(staffRow).toContainText("people in the app")
    await expect(staffRow).toContainText("No email")

    // And one for everyone, emailed to club admins, with an end date.
    await page.getByLabel("Title").fill("Planned maintenance")
    await page.getByLabel("Notice", { exact: true }).fill("The app is offline on Sunday from 6 to 7 am.")
    await page.getByLabel(/Stop showing on/).fill("2030-01-01T10:00")
    await page.getByLabel("Also email club admins").check()
    await page.getByRole("button", { name: "Review and send" }).click()
    await expect(page.getByRole("group", { name: "Confirm" })).toContainText("Send this to everyone in every open club, and email club admins?")
    await page.getByRole("button", { name: "Send notice" }).click()
    const everyoneRow = sent.locator('[data-notice="Planned maintenance"]')
    await expect(everyoneRow).toContainText("emails to club admins")
    await expect(page.locator("#main-content")).toContainText("2 notices showing in the app right now.")

    // The platform admin gets no banner.
    await expect(page.locator("[data-platform-notice]")).toHaveCount(0)

    // An athlete sees only the notice for everyone.
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/home")
    const banner = page.locator("[data-platform-notice]")
    await expect(banner).toHaveCount(1)
    await expect(banner).toContainText("Planned maintenance")
    await expect(banner).toContainText("The app is offline on Sunday from 6 to 7 am.")
    await expect(page.locator("body")).not.toContainText("Staff briefing")
    // It is in the notification list too.
    await page.goto("/notifications")
    await expect(page.locator("#main-content")).toContainText("Planned maintenance")
    await expect(page.locator("#main-content")).not.toContainText("Staff briefing")

    // A guardian too: only the one for everyone.
    await seedMockSession(page, { role: "guardian" })
    await page.goto("/guardian/home")
    await expect(page.locator("[data-platform-notice]")).toContainText("Planned maintenance")
    await expect(page.locator("body")).not.toContainText("Staff briefing")

    // A coach sees both, newest first, and dismissing one brings up the other.
    await seedMockSession(page, { role: "coach" })
    await page.goto("/coach/dashboard")
    await expect(banner).toContainText("Planned maintenance")
    await banner.getByRole("button", { name: "Dismiss notice: Planned maintenance" }).click()
    await expect(banner).toContainText("Staff briefing")
    await expect(banner.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/settings/notifications")
    // Dismissed stays dismissed after a reload.
    await page.reload()
    await expect(banner).toContainText("Staff briefing")
    await expect(page.locator("body")).not.toContainText("Planned maintenance")
    await page.goto("/notifications")
    await expect(page.locator("#main-content")).toContainText("Staff briefing")

    // The dismissal was the coach's own: the athlete still has the banner.
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/home")
    await expect(banner).toContainText("Planned maintenance")

    // Withdrawing removes the banner and the notification for everyone.
    await asPlatformAdmin(page)
    await page.goto("/platform-admin/notices")
    await expect(sent.locator('[data-notice="Planned maintenance"]')).toContainText("1 dismissed")
    await sent.locator('[data-notice="Planned maintenance"]').getByRole("button", { name: "Withdraw Planned maintenance" }).click()
    await expect(page.getByRole("group", { name: "Confirm" })).toContainText("The banner disappears for everyone")
    await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Withdraw notice" }).click()
    await expect(sent.locator('[data-notice="Planned maintenance"]')).toContainText("Withdrawn")
    await expect(sent.locator('[data-notice="Planned maintenance"]').getByRole("button")).toHaveCount(0)

    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/home")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expect(page.locator("[data-platform-notice]")).toHaveCount(0)
    await page.goto("/notifications")
    await expect(page.locator("#main-content")).not.toContainText("Planned maintenance")

    await seedMockSession(page, { role: "club-admin" })
    await page.goto("/club-admin/dashboard")
    await expect(page.locator("[data-platform-notice]")).toContainText("Staff briefing")

    // Sending and withdrawing are in the platform activity.
    await asPlatformAdmin(page)
    await page.goto("/platform-admin/audit")
    await expect(page.locator("#main-content")).toContainText("Sent a notice to all clubs")
    await expect(page.locator("#main-content")).toContainText("Withdrew a notice")
  })

  test("system status says what works, what does not, and what to do", async ({ page }) => {
    await page.goto("/platform-admin/status")
    await expect(page.getByRole("heading", { level: 1, name: "Status" })).toBeVisible()

    const email = page.getByRole("region", { name: "Email" })
    await expect(email).toContainText("Working")
    await expect(email).toContainText("Last run")
    await expect(email).toContainText("Queued")
    await expect(email).toContainText("Failed, last 24 hours")

    const reminders = page.getByRole("region", { name: "Reminders" })
    await expect(reminders).toContainText("Working")
    await expect(reminders).toContainText("Scheduled every hour.")

    // The demo has no push keys: not set up, with the one line on what to do.
    const push = page.getByRole("region", { name: "Push" })
    await expect(push).toContainText("Not set up")
    await expect(push).toContainText("What to do: Set the VAPID keys")

    await expect(page.getByRole("region", { name: "Storage clean-up" })).toContainText("3 files waiting to be removed")
    await expect(page.locator("#main-content")).toContainText("Latest migration")
    await expect(page.locator("#main-content")).toContainText("No club is paused")
    await expect(page.locator("#main-content")).toContainText("No club is closing")

    await page.getByRole("button", { name: "Check again" }).click()
    await expect(email).toContainText("Working")
  })

  test("navigation: the new screens sit under Dashboard, the top bar stays one row at 1024px, phones do not scroll sideways", async ({ page }) => {
    // Many screens and several roles in one run.
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto("/platform-admin/dashboard")
    const tabs = page.getByRole("navigation", { name: "Platform sections" })
    await expect(tabs.getByRole("link")).toHaveText(["Overview", "Usage", "Notices", "Status", "Admins"])

    const topbar = page.locator('[data-shell="topbar"]')
    const mainNav = topbar.getByRole("navigation", { name: "Main" })
    // Still the six destinations it had, on one row, with nothing cut off.
    await expect(mainNav.getByRole("link")).toHaveText(["Dashboard", "Requests", "Clubs", "Billing", "Packages", "Activity"])
    expect(await mainNav.evaluate((nav) => nav.scrollWidth - nav.clientWidth)).toBeLessThanOrEqual(1)
    expect(await topbar.evaluate((bar) => bar.getBoundingClientRect().height)).toBeLessThanOrEqual(70)

    for (const [label, heading, path] of [
      ["Usage", "Usage", "/platform-admin/usage"],
      ["Notices", "Notices", "/platform-admin/notices"],
      ["Status", "Status", "/platform-admin/status"],
      ["Admins", "Platform admins", "/platform-admin/admins"],
    ] as const) {
      await page.getByRole("navigation", { name: "Platform sections" }).getByRole("link", { name: label }).click()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()
      await expect(mainNav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page")
      await expect(page.getByRole("navigation", { name: "Platform sections" }).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page")
    }
    // A club overview belongs to Clubs.
    await page.goto("/platform-admin/tenants/tools-test-club")
    await expect(mainNav.getByRole("link", { name: "Clubs" })).toHaveAttribute("aria-current", "page")

    await page.setViewportSize({ width: 390, height: 844 })
    for (const path of ["/platform-admin/usage", "/platform-admin/notices", "/platform-admin/status", "/platform-admin/admins", "/platform-admin/tenants/tools-test-club"]) {
      await page.goto(path)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await expect(page.locator(".sk-skel").first()).toBeHidden()
      await expectNoSidewaysScroll(page)
    }
  })
})
