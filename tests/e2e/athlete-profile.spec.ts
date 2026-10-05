import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test("athlete edits their profile and the changes survive a reload", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/profile")

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Marcus Johnson")
  await expect(page.getByRole("heading", { name: "Your team" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Notification settings" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible()

  await page.getByRole("button", { name: "Edit profile" }).click()
  await page.getByLabel("First name").fill("Marcus")
  await page.getByLabel("Last name").fill("Johnson-Reid")
  await page.getByLabel("Primary event").fill("200m")
  await page.getByLabel("Event group").selectOption("Sprint")
  await page.getByLabel("Date of birth").fill("2003-04-12")
  await page.getByRole("button", { name: "Save profile" }).click()

  await expect(page.getByRole("status")).toContainText("Profile saved")
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Marcus Johnson-Reid")

  await page.reload()

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Marcus Johnson-Reid")
  const about = page.locator("section", { has: page.getByRole("heading", { name: "About you" }) })
  await expect(about).toContainText("200m")
  await expect(about).toContainText("April 12, 2003")
})

test("athlete profile rejects an empty name and cancel discards edits", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/profile")

  await page.getByRole("button", { name: "Edit profile" }).click()
  await page.getByLabel("First name").fill("")
  await page.getByRole("button", { name: "Save profile" }).click()
  await expect(page.getByText("Enter your first name.")).toBeVisible()

  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Marcus Johnson")
})

test("athlete adds a profile photo, keeps it after a reload, and their coach sees it on the roster", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/athlete/profile")

  const heading = page.getByRole("heading", { level: 1 })
  await expect(heading).toContainText("Marcus Johnson")
  await expect(heading.locator("img")).toHaveCount(0)

  await page.getByTestId("avatar-file-input").setInputFiles({
    name: "me.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAHElEQVR42mP832PDQA3AxEAlMGrQqEGjBo1UgwBnLQHnvLPlYgAAAABJRU5ErkJggg==", "base64"),
  })
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible()
  await expect(heading.locator("img")).toHaveAttribute("src", /^data:image\/jpeg/)

  await page.reload()
  await expect(heading.locator("img")).toHaveAttribute("src", /^data:image\/jpeg/)
  await expect(page.locator("header[data-shell='topbar']").getByRole("button", { name: "Open profile menu" }).locator("img")).toHaveCount(1)

  // The rest of the account lives one tap away.
  await page.getByRole("link", { name: "Account and security" }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole("heading", { level: 1, name: "Account and security" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Change password" })).toBeVisible()

  // Same browser, now signed in as the coach of that team: the photo is on the roster.
  await page.evaluate(() => {
    window.localStorage.setItem("pacelab:mock-role", "coach")
    window.localStorage.setItem("pacelab:mock-user-email", "coach@pacelab.local")
    window.localStorage.setItem("pacelab:mock-coach-team", "t1")
  })
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/teams/t1")
  // The roster is a table: one row per athlete.
  const row = page.getByRole("row").filter({ hasText: "Marcus Johnson" }).first()
  await expect(row.locator("img")).toHaveAttribute("src", /^data:image\/jpeg/)
  await expect(page.getByRole("row").filter({ hasText: "Sarah Chen" }).first().locator("img")).toHaveCount(0)
})

test("an under 18 athlete adds private details and a guardian, and bad contact details are refused", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/profile")

  // An adult with nothing filled in is not asked for a guardian.
  await expect(page.getByRole("heading", { name: "Emergency contact" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Parent or guardian" })).toHaveCount(0)

  await page.getByRole("button", { name: "Edit profile" }).click()
  await expect(page.getByLabel("Guardian name")).toHaveCount(0)
  await page.getByLabel("Date of birth").fill("2011-03-09")
  await expect(page.getByLabel("Guardian name")).toBeVisible()

  await page.getByLabel("Contact name").fill("Dana Johnson")
  await page.getByLabel("Contact phone").fill("12")
  await page.getByLabel("Guardian email").fill("nope")
  await page.getByRole("button", { name: "Save profile" }).click()
  await expect(page.getByText("Enter a phone number with 7 to 15 digits.")).toBeVisible()
  await expect(page.getByText("Enter an email address like name@example.com.")).toBeVisible()

  await page.getByLabel("Contact phone").fill("+1 (876) 555-0101")
  await page.getByLabel("Guardian name").fill("Dana Johnson")
  await page.getByLabel("Guardian email").fill("dana@example.com")
  await page.getByLabel("Height in cm").fill("178")
  await page.getByLabel("Medical notes and allergies").fill("Asthma, carries an inhaler.")
  await page.getByLabel("Preferred name").fill("MJ")
  await page.getByRole("button", { name: "Save profile" }).click()
  await expect(page.getByText("Profile saved.")).toBeVisible()

  await page.reload()
  const health = page.locator("section", { has: page.getByRole("heading", { name: "Body and health" }) })
  await expect(health).toContainText("178 cm")
  await expect(health).toContainText("Asthma, carries an inhaler.")
  await expect(health).toContainText("Only you, the coaches of your team and your club's admins can see this.")
  const guardian = page.locator("section", { has: page.getByRole("heading", { name: "Parent or guardian" }) })
  await expect(guardian).toContainText("dana@example.com")
  await expect(page.locator("section", { has: page.getByRole("heading", { name: "Emergency contact" }) })).toContainText("+1 (876) 555-0101")
})

test("athlete leaves their team after an inline confirm and can join another by code", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/profile")

  const team = page.locator("section", { has: page.getByRole("heading", { name: "Your team" }) })
  await expect(team).toContainText("Sprint Group")
  await expect(team).toContainText("Andre Campbell")
  // The coach has not chosen to show their email.
  await expect(team.getByRole("link", { name: /Email Andre Campbell/ })).toHaveCount(0)

  await team.getByRole("button", { name: "Leave this team" }).click()
  await expect(team).toContainText("Your history is kept. You stop seeing this team's plans and test weeks, and your coach is told.")
  await team.getByRole("button", { name: "Stay" }).click()
  await expect(team).toContainText("Sprint Group")

  await team.getByRole("button", { name: "Leave this team" }).click()
  await team.getByRole("button", { name: "Leave team" }).click()
  await expect(team).toContainText("You are not on a team")
  await expect(team).not.toContainText("Sprint Group")

  await page.reload()
  await expect(page.locator("section", { has: page.getByRole("heading", { name: "Your team" }) })).toContainText("You are not on a team")

  await page.goto("/athlete/join")
  await expect(page.locator("main")).toContainText("You are not on a team yet")
  await page.getByLabel("Invite link or code").fill("t2")
  await page.getByRole("button", { name: "Join Distance Group" }).click()
  await expect(page.getByRole("heading", { level: 1 })).toContainText("You are on Distance Group")

  await page.goto("/athlete/profile")
  await expect(page.locator("section", { has: page.getByRole("heading", { name: "Your team" }) })).toContainText("Distance Group")
})

test("a coach who opts in shows their email to their athletes", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/account")
  const contact = page.locator("section", { has: page.getByRole("heading", { name: "Contact for athletes" }) })
  await expect(contact).toContainText("Off. Athletes cannot see your email.")
  await contact.getByRole("button", { name: "Show email" }).click()
  await expect(contact).toContainText("On. They see coach@pacelab.local on their profile.")

  await page.evaluate(() => {
    window.localStorage.setItem("pacelab:mock-role", "athlete")
    window.localStorage.setItem("pacelab:mock-user-email", "athlete@pacelab.local")
  })
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/profile")
  await expect(page.getByRole("link", { name: /Email Andre Campbell/ })).toHaveAttribute("href", "mailto:coach@pacelab.local")
})
