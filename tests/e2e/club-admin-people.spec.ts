import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

// Each test uses its own demo club, so what one test removes is still there for the next.
async function signIn(page: Page, tenantId: string) {
  await seedMockSession(page, { role: "club-admin", tenantId })
  await page.setViewportSize({ width: 1440, height: 900 })
}

const auditLog = (page: Page, tenantId: string) => page.evaluate((key) => window.localStorage.getItem(key) ?? "", `pacelab:audit-logs:${tenantId}`)

test("club admin invites several coaches at once from a pasted list", async ({ page }) => {
  await signIn(page, "people-bulk")
  await page.goto("/club-admin/users")

  await page.getByRole("button", { name: "Invite staff" }).first().click()
  const dialog = page.getByRole("dialog", { name: "Invite staff" })
  await dialog.getByRole("tab", { name: "List" }).click()
  await dialog.getByLabel("Coaches, one per line").fill(
    ["jordan@club.test", "Sam Reid, sam@club.test", "coach.rivera@pacelab.local", "not-an-email", "jordan@club.test"].join("\n"),
  )

  // The preview says what happens to every line before anything is sent.
  await expect(dialog.locator("[data-bulk-count]")).toHaveText("2 ready to invite, 3 will be skipped")
  await expect(dialog.locator('[data-line-status="ok"]')).toHaveCount(2)
  await expect(dialog.locator('[data-line-status="staff"]')).toContainText("Already on the staff")
  await expect(dialog.locator('[data-line-status="invalid"]')).toHaveCount(2)

  await dialog.getByRole("button", { name: "Send 2 invites" }).click()
  await expect(dialog.locator("[data-bulk-summary]")).toContainText("2 coach invites sent.")
  await expect(dialog.locator('[data-line-status="sent"]')).toHaveCount(2)
  await dialog.getByRole("button", { name: "Close" }).click()

  // Both are on the Invites list, emailed and waiting.
  for (const email of ["jordan@club.test", "sam@club.test"]) {
    const row = page.locator(`[data-invite="${email}"]`)
    await expect(row).toContainText("Waiting")
    await expect(row).toHaveAttribute("data-invite-role", "coach")
    await expect(row.locator("[data-invite-email-status]")).toContainText("Emailed")
  }
  await expect(page.getByRole("tab", { name: /Invites/ })).toContainText("2")
  expect(await auditLog(page, "people-bulk")).toContain("coach_invite_bulk_send")

  // A second list with the same people invites nobody twice.
  await page.getByRole("button", { name: "Invite staff" }).first().click()
  await dialog.getByRole("tab", { name: "List" }).click()
  await dialog.getByLabel("Coaches, one per line").fill("jordan@club.test")
  await expect(dialog.locator('[data-line-status="invited"]')).toContainText("Already invited")
  await expect(dialog.getByRole("button", { name: "Send invites" })).toBeDisabled()
})

test("club admin invites someone directly as a club admin", async ({ page }) => {
  await signIn(page, "people-admin-invite")
  await page.goto("/club-admin/users")

  await page.getByRole("button", { name: "Invite staff" }).first().click()
  const dialog = page.getByRole("dialog", { name: "Invite staff" })
  await dialog.getByRole("radio", { name: "Club admin" }).click()
  await expect(dialog).toContainText("Invite only people you trust with that")
  await dialog.getByLabel("Email").fill("second.admin@club.test")
  await dialog.getByRole("button", { name: "Send invite" }).click()
  await expect(dialog).toContainText("Invite emailed to second.admin@club.test")
  await dialog.getByRole("button", { name: "Close" }).click()

  const row = page.locator('[data-invite="second.admin@club.test"]')
  await expect(row).toHaveAttribute("data-invite-role", "club-admin")
  await expect(row).toContainText("Club admin")
  await expect(row).toContainText("Waiting")
  expect(await auditLog(page, "people-admin-invite")).toContain("club admin, no team")
})

test("an athlete taken off a team waits under Unassigned until the club admin assigns them", async ({ page }) => {
  await signIn(page, "people-assign")

  // Take an athlete off their team from the team's own screen.
  await page.goto("/club-admin/teams")
  await page.locator('[data-team="Sprint Group"]').getByRole("link", { name: /Sprint Group/ }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Sprint Group" })).toBeVisible()
  const rosterRow = page.locator('[data-roster-athlete="Sarah Chen"]')
  await rosterRow.getByRole("button", { name: "More for Sarah Chen" }).click()
  await page.getByRole("menuitem", { name: "Take off this team" }).click()
  await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Take off team" }).click()
  await expect(rosterRow).toHaveCount(0)

  // The dashboard says somebody is waiting, and links to them.
  await page.goto("/club-admin/dashboard")
  await page.getByRole("link", { name: /1 athlete not on a team/ }).click()
  await expect(page).toHaveURL(/\/club-admin\/users\?view=athletes$/)

  // People, Athletes: every athlete of the club, the unassigned one included.
  const athleteRow = page.locator('[data-athlete="Sarah Chen"]')
  await expect(athleteRow).toContainText("Unassigned")
  // The demo club has ten athletes: nobody drops off the list for having no team.
  await expect(page.locator("[data-athlete]")).toHaveCount(10)
  await page.getByRole("radio", { name: /Unassigned/ }).click()
  await expect(page.locator("[data-athlete]")).toHaveCount(1)

  await athleteRow.getByRole("button", { name: "More for Sarah Chen" }).click()
  await page.getByRole("menuitem", { name: "Assign to a team" }).click()
  const dialog = page.getByRole("dialog", { name: "Assign to a team" })
  await dialog.getByRole("combobox", { name: "Team" }).selectOption({ label: "Jumps Group" })
  await dialog.getByRole("button", { name: "Assign to team" }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole("radio", { name: "All", exact: true }).first().click()
  await expect(athleteRow).toContainText("Jumps Group")
  await expect(athleteRow).toHaveAttribute("data-athlete-team", "t3")

  // And they are on the new team's roster.
  await page.goto("/club-admin/teams?team=t3")
  await expect(page.locator('[data-roster-athlete="Sarah Chen"]')).toBeVisible()
  expect(await auditLog(page, "people-assign")).toContain("athlete_team_assign")
})

test("club admin removes a coach from the club for good, and cannot remove themselves", async ({ page }) => {
  await signIn(page, "people-remove")
  await page.goto("/club-admin/users")

  // Their own row has no menu: nobody removes or demotes themselves.
  const ownRow = page.locator('[data-person="clubadmin@pacelab.local"]')
  await expect(ownRow).toContainText("(you)")
  await expect(ownRow.getByRole("button")).toHaveCount(0)

  const coachRow = page.locator('[data-person="coach.rivera@pacelab.local"]')
  await coachRow.getByRole("button", { name: "More for Coach Rivera" }).click()
  await page.getByRole("menuitem", { name: "Remove from club" }).click()
  // Coach Rivera still leads Sprint Group, so the team is handed over first (see coach-handover-and-assistants.spec.ts).
  const handover = page.getByRole("dialog", { name: "Hand over teams, then remove Coach Rivera" })
  await expect(handover).toContainText("Plans, test weeks, templates, exercises and coach notes stay with the club")
  // Changing your mind leaves them where they were.
  await handover.getByRole("button", { name: "Cancel" }).click()
  await expect(coachRow).toBeVisible()

  await coachRow.getByRole("button", { name: "More for Coach Rivera" }).click()
  await page.getByRole("menuitem", { name: "Remove from club" }).click()
  await handover.locator('[data-handover-team="Sprint Group"]').selectOption({ label: "Coach Smith takes over as lead (joins the team)" })
  await handover.getByRole("button", { name: "Hand over and remove" }).click()
  await expect(coachRow).toHaveCount(0)
  await expect(page.getByRole("tab", { name: /Staff/ })).toContainText("2")
  expect(await auditLog(page, "people-remove")).toContain("member_removed")

  // Their team is never left without a lead coach.
  await page.goto("/club-admin/teams")
  await expect(page.locator('[data-team="Sprint Group"]')).toContainText("Coach Smith")
})

test("an athlete removed from the club keeps their record and can be brought back or deleted with a typed name", async ({ page }) => {
  await signIn(page, "people-athlete-remove")
  await page.goto("/club-admin/users?view=athletes")

  const row = page.locator('[data-athlete="David Okafor"]')
  await row.getByRole("button", { name: "More for David Okafor" }).click()
  await page.getByRole("menuitem", { name: "Remove from club" }).click()
  await expect(page.getByRole("group", { name: "Confirm" })).toContainText("Their history is kept")
  await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Remove from club" }).click()
  await expect(row).toHaveCount(0)
  await expect(page.locator("[data-athlete]")).toHaveCount(9)

  // Still on record, under Left the club.
  await page.getByRole("radio", { name: /Left the club/ }).click()
  await expect(row).toContainText("Left the club")

  // Bring them back: in the club again, on no team yet.
  await row.getByRole("button", { name: "More for David Okafor" }).click()
  await page.getByRole("menuitem", { name: "Bring back to club" }).click()
  await expect(row).toContainText("Unassigned")
  await expect(page.locator("[data-athlete]")).toHaveCount(10)

  // Deleting all their data is a separate, deliberate step behind their typed name.
  await row.getByRole("button", { name: "More for David Okafor" }).click()
  await page.getByRole("menuitem", { name: "Delete athlete and data" }).click()
  const dialog = page.getByRole("dialog", { name: "Delete athlete and all their data" })
  const deleteButton = dialog.getByRole("button", { name: "Delete athlete and data" })
  await expect(deleteButton).toBeDisabled()
  await dialog.getByLabel("Type David Okafor to confirm").fill("David")
  await expect(deleteButton).toBeDisabled()
  await dialog.getByLabel("Type David Okafor to confirm").fill("david okafor")
  await deleteButton.click()
  await expect(dialog).toBeHidden()
  await expect(row).toHaveCount(0)
  await expect(page.locator("[data-athlete]")).toHaveCount(9)
  // Gone for good: not under Left the club either (that filter disappears when nobody is in it).
  await expect(page.getByRole("radio", { name: /Left the club/ })).toHaveCount(0)
  const log = await auditLog(page, "people-athlete-remove")
  expect(log).toContain("athlete_data_deleted")
  // The entry about the deletion names nobody.
  expect(log).not.toMatch(/athlete_data_deleted[^}]*David Okafor/)
})

test("people and teams fit a phone without sideways scrolling", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin", tenantId: "people-phone" })
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ["/club-admin/dashboard", "/club-admin/users", "/club-admin/users?view=athletes", "/club-admin/teams", "/club-admin/teams?team=t1"]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    const fits = await page.evaluate(() => {
      const main = document.getElementById("main-content")
      return document.documentElement.scrollWidth <= window.innerWidth && (!main || main.scrollWidth <= main.clientWidth)
    })
    expect(fits, `${path} scrolls sideways`).toBe(true)
  }
})
