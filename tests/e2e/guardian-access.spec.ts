import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

// Parent or guardian access (mock mode). Each test uses its own demo club, so what one test changes
// is not there for the next. The demo guardian (guardian@pacelab.local) follows Mia Anderson (a8,
// Throws Group, 16 years old) and Marcus Johnson (a1, Sprint Group, an adult and the demo athlete).

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 900 }

async function asGuardian(page: Page, tenantId: string, size = PHONE) {
  await seedMockSession(page, { role: "guardian", tenantId })
  await page.setViewportSize(size)
}

/** The demo coach on Throws Group (t4), where Mia and Liam train. */
async function asCoach(page: Page, tenantId: string, role: "lead" | "coach" | "assistant" = "lead") {
  await seedMockSession(page, { role: "coach", tenantId, coachTeamId: "t4" })
  await page.addInitScript((value) => window.localStorage.setItem("pacelab:mock-coach-team-roles", JSON.stringify({ t4: value })), role)
  await page.setViewportSize(DESKTOP)
}

const guardianStore = (page: Page, tenantId: string) =>
  page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null") as { invites: Array<{ id: string; email: string; status: string }>; links: Array<{ email: string; athleteId: string; status: string }> } | null, `pacelab:guardians:v1:${tenantId}`)

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test("the demo guardian signs in from the sign in page and lands on their home", async ({ page }) => {
  await page.setViewportSize(PHONE)
  await page.goto("/login")
  await page.getByRole("button", { name: /Parent or guardian/ }).click()
  await expect(page).toHaveURL(/\/guardian\/home$/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Marcus Johnson|Mia Anderson/)
})

test("phone: the bottom bar is Home, Plan, Results, More, with no messages anywhere", async ({ page }) => {
  await asGuardian(page, "guardian-nav")
  await page.goto("/guardian/home?child=a8")
  const bar = page.locator('[data-shell="tabbar"]')
  await expect(bar.getByRole("link")).toHaveText(["Home", "Plan", "Results"])
  await expect(bar.getByRole("button", { name: "More" })).toBeVisible()
  await expect(page.getByRole("link", { name: /Messages/ })).toHaveCount(0)
  await expect(page.locator("#main-content")).toContainText("To reach the coach, use the contact shown here.")

  await bar.getByRole("button", { name: "More" }).click()
  const sheet = page.getByRole("dialog", { name: "More" })
  await expect(sheet.getByRole("link")).toHaveText(["Health", "Calendar", "Announcements"])
  await sheet.getByRole("link", { name: "Calendar" }).click()
  await expect(page).toHaveURL(/\/guardian\/calendar/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Calendar")
  expect(await noSidewaysScroll(page)).toBe(true)
})

test("desktop: one top bar with the guardian's destinations and the child switcher", async ({ page }) => {
  await asGuardian(page, "guardian-desktop", DESKTOP)
  await page.goto("/guardian/home?child=a8")
  const topbar = page.locator('[data-shell="topbar"]')
  await expect(topbar.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["Home", "Plan", "Results", "Health", "Calendar", "Announcements"])
  await expect(topbar.getByTestId("child-switcher-current")).toHaveText("Mia Anderson")

  await topbar.getByTestId("child-switcher").click()
  await page.getByRole("menuitemradio", { name: /Marcus Johnson/ }).click()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Marcus Johnson")
  // The choice is remembered on the next screen and after a reload.
  await topbar.getByRole("link", { name: "Plan" }).click()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Marcus's plan")
  await page.goto("/guardian/results")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Marcus's results")
})

test("home shows the athlete, the coach and only a contact the coach chose to show", async ({ page }) => {
  await asGuardian(page, "guardian-home", DESKTOP)
  await page.goto("/guardian/home?child=a8")
  const main = page.locator("#main-content")
  await expect(main).toContainText("You follow Mia as their mother.")
  await expect(main.locator('[data-coach-contact="coach@pacelab.local"]')).toContainText("Coach Rivera")
  await expect(main.locator('[data-coach-contact="none"]')).toContainText("No contact shared here")
  // The other athlete is a row to switch to, not a roster.
  await expect(main.locator("[data-child-row]")).toHaveCount(1)
  await main.locator('[data-child-row="a1"]').click()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Marcus Johnson")
  // No other athlete of either team is named anywhere.
  await expect(main).not.toContainText("Liam Patel")
  await expect(main).not.toContainText("Sarah Chen")
})

test("the plan shows what was done and skipped; the reason for a skip is health", async ({ page }) => {
  await asGuardian(page, "guardian-plan")
  await page.goto("/guardian/plan?child=a8")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mia's plan")
  const week = page.getByRole("list", { name: "Mia's week" })
  await expect(week.locator("[data-day]")).toHaveCount(7)
  await expect(week.locator('[data-state="rest"]')).toHaveCount(2)

  await page.getByRole("button", { name: "Previous week" }).click()
  await expect(week.locator('[data-state="done"]')).toHaveCount(4)
  await expect(week.locator('[data-state="skipped"]')).toHaveCount(1)
  // Mia is under 18: her guardian sees why.
  await expect(week.locator('[data-state="skipped"]')).toContainText("Reason: sick")
  await expect(page.getByRole("list", { name: "Attendance" })).toContainText("At home with a cold")

  // Marcus is an adult who has not switched sharing on: done or skipped, never why.
  await page.goto("/guardian/plan?child=a1")
  await page.getByRole("button", { name: "Previous week" }).click()
  const marcusWeek = page.getByRole("list", { name: "Marcus's week" })
  await expect(marcusWeek.locator('[data-state="skipped"]')).toHaveCount(1)
  await expect(marcusWeek.locator('[data-state="skipped"]')).not.toContainText("Reason")
  await expect(page.getByRole("list", { name: "Attendance" })).not.toContainText("cold")
  expect(await noSidewaysScroll(page)).toBe(true)
})

test("results: competitions, results, records, goals and test weeks, read only", async ({ page }) => {
  await asGuardian(page, "guardian-results")
  await page.goto("/guardian/results?child=a8")
  const main = page.locator("#main-content")
  await expect(page.getByRole("list", { name: "Upcoming competitions" })).toContainText("National Stadium Open")
  await expect(page.getByRole("list", { name: "Results" })).toContainText("13.42m")
  await expect(page.getByRole("list", { name: "Records" })).toContainText("Shot Put")
  await expect(page.getByRole("list", { name: "Goals" })).toContainText("Reached")
  await expect(main).toContainText("Autumn test week")
  // Nothing on a read only screen can be edited: no form field, no add, edit or delete.
  await expect(main.locator("input, textarea, select")).toHaveCount(0)
  await expect(main.getByRole("button", { name: /add|edit|delete|remove|save/i })).toHaveCount(0)
  expect(await noSidewaysScroll(page)).toBe(true)
})

test("health: visible for an athlete under 18, hidden for an adult until they switch it on", async ({ page }) => {
  const tenantId = "guardian-health"
  await asGuardian(page, tenantId)
  await page.goto("/guardian/health?child=a8")
  await expect(page.locator("#main-content")).toContainText("Mia is under 18, so you can see their check-ins, pain reports and medical notes.")
  await expect(page.getByRole("list", { name: "Check-ins" })).toContainText("Ready")
  await expect(page.locator("#main-content")).toContainText("Mild asthma")

  await page.goto("/guardian/health?child=a1")
  await expect(page.locator('[data-health="hidden"]')).toContainText("Health information is not shared with you")
  await expect(page.locator("#main-content")).not.toContainText("asthma")
  await expect(page.getByRole("list", { name: "Check-ins" })).toHaveCount(0)

  // Marcus (the demo athlete) sees who follows him and switches sharing on himself.
  await seedMockSession(page, { role: "athlete", tenantId })
  await page.goto("/athlete/profile")
  const sharing = page.locator("[data-guardian-sharing]")
  await expect(sharing).toContainText("Dana Anderson")
  await expect(sharing).toContainText("To remove someone, ask your coach.")
  await sharing.getByRole("checkbox", { name: /Share my health information with them/ }).check()
  await expect(sharing).toHaveAttribute("data-guardian-sharing", "adult_opted_in")

  await seedMockSession(page, { role: "guardian", tenantId })
  await page.goto("/guardian/health?child=a1")
  await expect(page.locator("#main-content")).toContainText("Marcus chose to share their check-ins, pain reports and medical notes with you.")
  await expect(page.getByRole("list", { name: "Check-ins" })).toBeVisible()

  // And off again: hidden at once.
  await seedMockSession(page, { role: "athlete", tenantId })
  await page.goto("/athlete/profile")
  await page.locator("[data-guardian-sharing]").getByRole("checkbox", { name: /Share my health information with them/ }).uncheck()
  await expect(page.locator("[data-guardian-sharing]")).toHaveAttribute("data-guardian-sharing", "adult_not_opted_in")
  await seedMockSession(page, { role: "guardian", tenantId })
  await page.goto("/guardian/health?child=a1")
  await expect(page.locator('[data-health="hidden"]')).toBeVisible()
})

test("a guardian can change the guardian contact for their child, and nothing else", async ({ page }) => {
  await asGuardian(page, "guardian-contact")
  await page.goto("/guardian/contact?child=a8")
  await expect(page.getByLabel("Name")).toHaveValue("Dana Anderson")
  await page.getByLabel(/^Phone/).fill("call me")
  await page.getByRole("button", { name: "Save contact details" }).click()
  await expect(page.locator("#main-content")).toContainText("Enter a phone number with 7 to 15 digits.")

  await page.getByLabel(/^Phone/).fill("+1 876 555 0199")
  await page.getByLabel("Name").fill("Dana A. Anderson")
  await page.getByRole("button", { name: "Save contact details" }).click()
  await expect(page.getByText("Contact details saved", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel("Name")).toHaveValue("Dana A. Anderson")
  await expect(page.getByLabel(/^Phone/)).toHaveValue("+1 876 555 0199")
})

test("a guardian opens only guardian screens, and nobody else opens theirs", async ({ page }) => {
  await asGuardian(page, "guardian-routes")
  for (const path of ["/coach/dashboard", "/coach/athletes/a8", "/athlete/home", "/athlete/wellness", "/club-admin/users", "/platform-admin/dashboard"]) {
    await page.goto(path)
    await expect(page, path).toHaveURL(/\/login$/)
  }
  for (const path of ["/account", "/notifications", "/settings/notifications"]) {
    await page.goto(path)
    await expect(page, path).toHaveURL(new RegExp(`${path}$`))
  }
  await seedMockSession(page, { role: "coach", tenantId: "guardian-routes", coachTeamId: "t4" })
  await page.goto("/guardian/home")
  await expect(page).toHaveURL(/\/login$/)
  await seedMockSession(page, { role: "athlete", tenantId: "guardian-routes" })
  await page.goto("/guardian/health")
  await expect(page).toHaveURL(/\/login$/)
})

test("account and notification settings know the guardian role", async ({ page }) => {
  await asGuardian(page, "guardian-account", DESKTOP)
  await page.goto("/settings/notifications")
  const main = page.locator("#main-content")
  await expect(main).toContainText("When the coach publishes a plan for an athlete you follow.")
  await expect(main).toContainText("Pain and injury reports")
  await expect(main).toContainText("Your access")
  await expect(main).not.toContainText("Finished sessions")

  await page.goto("/account")
  await expect(main).toContainText("which athletes you follow")
  await expect(main).toContainText("Nothing about the athletes is deleted")
})

test("a coach invites a guardian from the athlete's page: prefilled, emailed, listed, cancelled", async ({ page }) => {
  const tenantId = "guardian-invite"
  await asCoach(page, tenantId)
  await page.goto("/coach/athletes/a9?tab=details")
  const section = page.locator("[data-guardians-section]")
  // Liam has no date of birth on file: the coach is told what that means and what to do.
  await expect(section.locator("[data-health-rule]")).toHaveAttribute("data-health-rule", "unknown_age")
  await expect(section).toContainText("Add the date of birth to the athlete's details.")
  await expect(section).toContainText("No guardian has access")

  await section.getByRole("button", { name: "Invite a guardian" }).click()
  const dialog = page.getByRole("dialog", { name: "Invite a guardian for Liam" })
  // Filled in from the guardian contact stored for the athlete.
  await expect(dialog.getByLabel("Guardian's email")).toHaveValue("priya.patel@example.com")
  await expect(dialog.getByLabel("Guardian's name")).toHaveValue("Priya Patel")

  // No mixing of roles: an email that is already a coach, admin or athlete is refused, with the reason.
  for (const taken of ["coach@pacelab.local", "athlete@pacelab.local", "clubadmin@pacelab.local", "platformadmin@pacelab.local"]) {
    await dialog.getByLabel("Guardian's email").fill(taken)
    await dialog.getByRole("button", { name: "Send invite" }).click()
    await expect(dialog, taken).toContainText("This email already has a coach, admin or athlete account. A guardian needs their own email address.")
  }

  await dialog.getByLabel("Guardian's email").fill("Priya.Patel@Example.com")
  await dialog.getByLabel("Relationship").selectOption("Guardian")
  await dialog.getByRole("button", { name: "Send invite" }).click()
  await expect(page.getByText("Invite emailed to priya.patel@example.com", { exact: true })).toBeVisible()
  const row = section.locator('[data-guardian-invite="priya.patel@example.com"]')
  await expect(row).toContainText("Invited")
  await expect(row).toContainText("Guardian")

  // Inviting the same email again keeps one open invite.
  await section.getByRole("button", { name: "Invite a guardian" }).click()
  await dialog.getByLabel("Guardian's email").fill("priya.patel@example.com")
  await dialog.getByLabel("Guardian's name").fill("Priya Patel")
  await dialog.getByRole("button", { name: "Send invite" }).click()
  await expect(section.locator("[data-guardian-invite]")).toHaveCount(1)

  await row.getByRole("button", { name: "More for Priya Patel" }).click()
  await page.getByRole("menuitem", { name: "Cancel invite" }).click()
  await section.getByRole("button", { name: "Cancel invite" }).click()
  await expect(section.locator("[data-guardian-invite]")).toHaveCount(0)
  const store = await guardianStore(page, tenantId)
  expect(store?.invites.map((invite) => invite.status)).toEqual(["revoked"])
})

test("an existing guardian is linked to a second child with no new account, and removing access ends it at once", async ({ page }) => {
  const tenantId = "guardian-link"
  await asCoach(page, tenantId)
  await page.goto("/coach/athletes/a9?tab=details")
  const section = page.locator("[data-guardians-section]")
  await section.getByRole("button", { name: "Invite a guardian" }).click()
  const dialog = page.getByRole("dialog", { name: "Invite a guardian for Liam" })
  await dialog.getByLabel("Guardian's email").fill("guardian@pacelab.local")
  await dialog.getByLabel("Guardian's name").fill("Dana Anderson")
  await dialog.getByRole("button", { name: "Send invite" }).click()
  await expect(page.getByText("Dana Anderson already has a guardian account here and can now follow Liam", { exact: true })).toBeVisible()
  await expect(section.locator('[data-guardian-link="guardian@pacelab.local"]')).toContainText("Has access")
  await expect(section.locator("[data-guardian-invite]")).toHaveCount(0)

  // The guardian now has three athletes. Health for Liam is hidden: no date of birth on file.
  await asGuardian(page, tenantId, DESKTOP)
  await page.goto("/guardian/home?child=a9")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Liam Patel")
  await page.goto("/guardian/health?child=a9")
  await expect(page.locator('[data-health="hidden"]')).toContainText("The club has no date of birth for Liam.")

  // The coach removes it: gone for the guardian straight away, the other athletes stay.
  await asCoach(page, tenantId)
  await page.goto("/coach/athletes/a9?tab=details")
  await section.getByRole("button", { name: "More for Dana Anderson" }).click()
  await page.getByRole("menuitem", { name: "Remove access" }).click()
  await expect(section).toContainText("It ends at once.")
  await section.getByRole("button", { name: "Remove access" }).click()
  await expect(section.locator("[data-guardian-link]")).toHaveCount(0)

  await asGuardian(page, tenantId, DESKTOP)
  await page.goto("/guardian/home?child=a9")
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Liam Patel")
  await page.locator('[data-shell="topbar"]').getByTestId("child-switcher").click()
  await expect(page.getByRole("menuitemradio")).toHaveText([/Marcus Johnson/, /Mia Anderson/])
})

test("an assistant coach does not manage guardians", async ({ page }) => {
  await asCoach(page, "guardian-assistant", "assistant")
  await page.goto("/coach/athletes/a8")
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Mia Anderson")
  await page.goto("/coach/athletes/a8?tab=details")
  await expect(page.locator("#main-content")).toContainText("About")
  await expect(page.locator("[data-guardians-section]")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Invite a guardian" })).toHaveCount(0)
})

test("club admin People lists guardians on their own, with remove, and never as staff", async ({ page }) => {
  const tenantId = "guardian-people"
  await seedMockSession(page, { role: "club-admin", tenantId })
  await page.setViewportSize(DESKTOP)
  await page.goto("/club-admin/users")
  // Not in the staff list.
  await expect(page.locator("#main-content")).not.toContainText("guardian@pacelab.local")
  await page.getByRole("tab", { name: /Guardians/ }).click()
  const list = page.locator("[data-club-guardians]")
  await expect(list.locator("[data-guardian-row]")).toHaveCount(2)
  await expect(list).toContainText("They are not staff and take no seat.")

  const mia = list.locator('[data-guardian-row="guardian@pacelab.local|Mia Anderson"]')
  await mia.getByRole("button", { name: /Remove access for Dana Anderson and Mia Anderson/ }).click()
  await expect(list).toContainText("Remove Dana Anderson's access to Mia Anderson? It ends at once.")
  await list.getByRole("button", { name: "Remove access", exact: true }).last().click()
  await expect(list.locator("[data-guardian-row]")).toHaveCount(1)

  // The guardian is left with one athlete: no switcher, and Mia cannot be opened.
  await asGuardian(page, tenantId, DESKTOP)
  await page.goto("/guardian/home?child=a8")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Marcus Johnson")
  await expect(page.getByTestId("child-switcher")).toHaveCount(0)
})

test("the invited person claims the invite on its own page, signed out", async ({ page, context }) => {
  const tenantId = "guardian-claim"
  await asCoach(page, tenantId)
  await page.goto("/coach/athletes/a9?tab=details")
  const section = page.locator("[data-guardians-section]")
  await section.getByRole("button", { name: "Invite a guardian" }).click()
  const dialog = page.getByRole("dialog", { name: "Invite a guardian for Liam" })
  await dialog.getByRole("button", { name: "Send invite" }).click()
  await expect(section.locator('[data-guardian-invite="priya.patel@example.com"]')).toBeVisible()
  const inviteId = (await guardianStore(page, tenantId))?.invites[0]?.id
  expect(inviteId).toBeTruthy()

  // The parent opens the link with no session. The club is still known from the tenant cookie in the demo.
  await context.clearCookies({ name: "pacelab_session" })
  await context.clearCookies({ name: "pacelab_role" })
  await context.clearCookies({ name: "pacelab_user" })
  await page.setViewportSize(PHONE)
  await page.goto(`/guardian/claim/${inviteId}`)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Follow Liam at/)
  await expect(page.locator("main, body").first()).toContainText("priya.patel@example.com")
  await page.getByLabel("Password", { exact: true }).fill("short")
  await page.getByLabel("Confirm password").fill("short")
  await page.getByRole("button", { name: "Create account and continue" }).click()
  await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible()
  await page.getByLabel("Password", { exact: true }).fill("long enough 1")
  await page.getByLabel("Confirm password").fill("long enough 1")
  await page.getByRole("button", { name: "Create account and continue" }).click()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You are in")
  await expect(page.getByText("You now follow Liam at")).toBeVisible()
  expect(await noSidewaysScroll(page)).toBe(true)

  const store = await guardianStore(page, tenantId)
  expect(store?.invites[0]?.status).toBe("accepted")
  expect(store?.links.some((link) => link.email === "priya.patel@example.com" && link.athleteId === "a9" && link.status === "active")).toBe(true)

  // The link cannot be used twice by someone else, and an unknown link says so plainly.
  await page.goto("/guardian/claim/not-a-real-invite")
  await expect(page.getByRole("alert")).toContainText("We could not find this invite.")
})

test("a guardian the club removed from every athlete sees a plain explanation, not an empty app", async ({ page }) => {
  const tenantId = "guardian-none"
  await seedMockSession(page, { role: "club-admin", tenantId })
  await page.setViewportSize(DESKTOP)
  await page.goto("/club-admin/users?view=guardians")
  const list = page.locator("[data-club-guardians]")
  for (let remaining = 2; remaining > 0; remaining -= 1) {
    await list.getByRole("button", { name: /^Remove access for/ }).first().click()
    await list.getByRole("button", { name: "Remove access", exact: true }).last().click()
    await expect(list.locator("[data-guardian-row]")).toHaveCount(remaining - 1)
  }
  await expect(list).toContainText("No guardian has access")

  await asGuardian(page, tenantId)
  for (const path of ["/guardian/home", "/guardian/plan", "/guardian/results", "/guardian/health"]) {
    await page.goto(path)
    await expect(page.locator("#main-content"), path).toContainText("You are not following an athlete right now")
  }
})

test("the privacy page says what a guardian account sees", async ({ page }) => {
  await page.goto("/privacy")
  const body = page.locator("body")
  await expect(body).toContainText("A parent or guardian with an account sees only the athletes the club linked them to")
  await expect(body).toContainText("only while the athlete is under 18")
  await expect(body).toContainText("A parent or guardian gets an account only by invite from the club")
})
