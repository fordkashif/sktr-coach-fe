import { readFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

/** File names inside a zip, read from its central directory. */
function zipFileNames(bytes: Buffer): string[] {
  const end = bytes.length - 22
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50)
  const count = bytes.readUInt16LE(end + 10)
  let offset = bytes.readUInt32LE(end + 16)
  const names: string[] = []
  for (let i = 0; i < count; i += 1) {
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50)
    const nameLength = bytes.readUInt16LE(offset + 28)
    names.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"))
    offset += 46 + nameLength
  }
  return names
}

async function downloadFrom(page: Page, click: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent("download"), click()])
  const path = await download.path()
  return { name: download.suggestedFilename(), bytes: readFileSync(path) }
}

/** A second active club admin in the demo club, so ownership has somewhere to go. */
async function seedSecondAdmin(page: Page) {
  await page.addInitScript(() => {
    const key = "pacelab:club-users:elite-track-club"
    if (window.localStorage.getItem(key)) return
    window.localStorage.setItem(
      key,
      JSON.stringify([
        { id: "u-admin-1", name: "Club Admin", email: "clubadmin@pacelab.local", role: "club-admin", status: "active" },
        { id: "u-admin-2", name: "Nadia Brown", email: "nadia.brown@pacelab.local", role: "club-admin", status: "active" },
        { id: "u-coach-1", name: "Coach Rivera", email: "coach.rivera@pacelab.local", role: "coach", status: "active", teamId: "t1" },
      ]),
    )
  })
}

test("athlete downloads their data: one file, summary first, no coach notes", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/account")

  await expect(page.getByRole("heading", { level: 2, name: "Your data" })).toBeVisible()
  const file = await downloadFrom(page, () => page.getByRole("button", { name: "Download" }).click())
  expect(file.name).toMatch(/^sktr-coach-my-data-.*\.json$/)

  const text = file.bytes.toString("utf8")
  const parsed = JSON.parse(text) as { summary: { about: string; account: { email: string; role: string }; counts: Array<{ key: string; records: number }>; not_included: string[] }; data: Record<string, unknown[]> }
  expect(text.indexOf('"summary"')).toBeLessThan(text.indexOf('"data"'))
  expect(parsed.summary.about).toContain("SAMPLE")
  expect(parsed.summary.account).toMatchObject({ email: "athlete@pacelab.local", role: "athlete" })
  const keys = parsed.summary.counts.map((item) => item.key)
  for (const key of ["account", "athlete_profile", "private_details", "session_logs", "wellness_check_ins", "pain_reports", "goals", "attendance", "messages", "notifications"]) {
    expect(keys).toContain(key)
  }
  expect(Object.keys(parsed.data).some((key) => key.includes("coach_notes"))).toBe(false)
  expect(parsed.summary.not_included.join(" ")).toContain("notes your coaches wrote")
  expect(parsed.data.wellness_check_ins.length).toBeGreaterThan(0)

  await expect(page.getByRole("status").filter({ hasText: "Downloaded sktr-coach-my-data" })).toBeVisible()
  // Nothing scrolls sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
})

test("coach gets the notes they wrote in their export, and is told which team blocks deleting", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/account")

  const file = await downloadFrom(page, () => page.getByRole("button", { name: "Download" }).click())
  const parsed = JSON.parse(file.bytes.toString("utf8")) as { data: Record<string, unknown[]> }
  expect(parsed.data.coach_notes_you_wrote.length).toBeGreaterThan(0)
  expect(parsed.data.plans_you_wrote.length).toBeGreaterThan(0)

  const section = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Delete your account" }) })
  await expect(section).toContainText('shown as written by "A former coach"')
  await expect(section.getByRole("list", { name: "Teams that block deleting your account" })).toContainText("You are the lead coach of Sprint Group.")
  await expect(section).toContainText("A club admin must give this team another lead coach first.")
  await expect(section.getByRole("button", { name: "Delete account" })).toHaveCount(0)
})

test("athlete deletes their account behind their typed email", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/account")

  const section = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Delete your account" }) })
  await expect(section).toContainText('shown as from "Deleted account"')
  await section.getByRole("button", { name: "Delete account" }).click()

  const confirm = section.getByRole("button", { name: "Delete my account for good" })
  await expect(confirm).toBeDisabled()
  await section.getByLabel("Type athlete@pacelab.local to confirm").fill("someone@else.com")
  await expect(confirm).toBeDisabled()
  await section.getByLabel("Type athlete@pacelab.local to confirm").fill(" Athlete@pacelab.local ")
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect(page).toHaveURL(/\/login\?account=deleted$/)
  await expect(page.getByText("Your account and your data have been deleted.")).toBeVisible({ timeout: 15_000 })
  // Signed out: the app is closed to this browser.
  await page.goto("/athlete/home")
  await expect(page).toHaveURL(/\/login/)
})

test("platform admin cannot delete their account in the app but can download their data", async ({ page }) => {
  await seedMockSession(page, { role: "platform-admin", tenantId: "platform" })
  await page.goto("/account")
  await expect(page.getByText("A platform admin account is not deleted in the app.").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Delete account" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Download" })).toBeVisible()
})

test("club owner exports the club: health data only when the box is ticked", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin" })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/club-admin/profile")

  const area = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Club data and ownership" }) })
  await expect(area.getByRole("heading", { level: 3, name: "Export club data" })).toBeVisible()

  const plain = await downloadFrom(page, () => area.getByRole("button", { name: "Export club data" }).click())
  expect(plain.name).toMatch(/^elite-track-club-data-export-\d{4}-\d{2}-\d{2}\.zip$/)
  expect(plain.bytes.subarray(0, 2).toString("latin1")).toBe("PK")
  const plainNames = zipFileNames(plain.bytes)
  expect(plainNames).toEqual(expect.arrayContaining(["README.txt", "teams.csv", "people.csv", "athletes.csv", "plans.csv", "session-logs.csv", "activity-log.csv"]))
  expect(plainNames).not.toContain("wellness.csv")
  expect(plainNames).not.toContain("pain-reports.csv")
  expect(plain.bytes.toString("utf8")).toContain("Health data: not included")
  // Stored, not compressed, so the CSV header can be read straight from the archive.
  expect(plain.bytes.toString("utf8")).not.toContain('"medical_notes"')
  await expect(area.getByRole("status").filter({ hasText: "without health data" })).toBeVisible()

  await area.getByLabel("Include health data").check()
  await expect(area.getByText("This export contains health information about your athletes.")).toBeVisible()
  const withHealth = await downloadFrom(page, () => area.getByRole("button", { name: "Export club data" }).click())
  const healthNames = zipFileNames(withHealth.bytes)
  expect(healthNames).toEqual(expect.arrayContaining(["wellness.csv", "pain-reports.csv"]))
  expect(withHealth.bytes.toString("utf8")).toContain('"medical_notes"')
  expect(withHealth.bytes.toString("utf8")).toContain("Health data: INCLUDED")
  await expect(area.getByRole("status").filter({ hasText: "health data included" })).toBeVisible()

  // Both exports are in the club's activity log, without their content.
  await page.goto("/club-admin/audit")
  await expect(page.locator("body")).toContainText("Exported the whole club's data")
})

test("club owner cannot delete their account, transfers ownership, then can", async ({ page }) => {
  await seedSecondAdmin(page)
  await seedMockSession(page, { role: "club-admin" })
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.goto("/account")
  const deleteSection = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Delete your account" }) })
  await expect(deleteSection).toContainText("You own this club, so your account cannot be deleted yet.")
  await expect(deleteSection.getByRole("button", { name: "Delete account" })).toHaveCount(0)
  await deleteSection.getByRole("link", { name: "club profile" }).click()

  await expect(page).toHaveURL(/\/club-admin\/profile$/)
  const area = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Club data and ownership" }) })
  const owner = area.locator("section").filter({ has: page.getByRole("heading", { level: 3, name: "Owner" }) })
  await expect(owner).toContainText("Club Admin (you)")
  await area.getByRole("button", { name: "Transfer ownership" }).click()

  const dialog = page.getByRole("dialog", { name: "Transfer ownership" })
  await expect(dialog.getByRole("radio", { name: /Nadia Brown/ })).toBeChecked()
  const transfer = dialog.getByRole("button", { name: "Transfer ownership" })
  await expect(transfer).toBeDisabled()
  await dialog.getByLabel("Type Elite Track Club to confirm").fill("Elite Track")
  await expect(transfer).toBeDisabled()
  await dialog.getByLabel("Type Elite Track Club to confirm").fill("elite track club")
  await transfer.click()

  await expect(area.getByText("Nadia Brown now owns the club. You are still a club admin.")).toBeVisible()
  await expect(owner).toContainText("Nadia Brown")
  await expect(owner).not.toContainText("(you)")
  await expect(area.getByRole("button", { name: "Transfer ownership" })).toHaveCount(0)
  await expect(area.getByText("Only the club owner, Nadia Brown, can close the club.")).toBeVisible()
  await expect(area.getByRole("button", { name: "Close club" })).toHaveCount(0)

  // No longer the owner: the account can go.
  await page.goto("/account")
  await deleteSection.getByRole("button", { name: "Delete account" }).click()
  await deleteSection.getByLabel("Type clubadmin@pacelab.local to confirm").fill("clubadmin@pacelab.local")
  await deleteSection.getByRole("button", { name: "Delete my account for good" }).click()
  await expect(page).toHaveURL(/\/login\?account=deleted$/)
})

test("owner closes the club, members are locked out, platform admin reopens it, then deletes it for good", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin" })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/club-admin/profile")

  const area = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Club data and ownership" }) })
  const closeClub = async () => {
    await area.getByRole("button", { name: "Close club" }).click()
    const dialog = page.getByRole("dialog", { name: "Close this club" })
    await expect(dialog).toContainText("kept for 90 days and then deleted for good")
    // Export is right there, before the point of no return.
    await expect(dialog.getByRole("button", { name: "Export club data" })).toBeVisible()
    const confirm = dialog.getByRole("button", { name: "Close club" })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel("Type Elite Track Club to confirm").fill("Elite Track Club")
    await confirm.click()
    await expect(page).toHaveURL(/\/login\?club=closed$/)
  }
  await closeClub()
  await expect(page.getByText("The club is closed and nobody in it can sign in.")).toBeVisible({ timeout: 15_000 })

  // An athlete of the club gets the closed notice instead of the app.
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/home")
  await expect(page.getByRole("heading", { level: 1, name: "This club is closed" })).toBeVisible()
  await expect(page.getByRole("status")).toContainText("Elite Track Club was closed by its owner")
  await expect(page.getByRole("status")).toContainText("is then deleted for good")

  // The owner too, with the way back.
  await seedMockSession(page, { role: "club-admin" })
  await page.goto("/club-admin/dashboard")
  await expect(page.getByRole("heading", { level: 1, name: "This club is closed" })).toBeVisible()
  await expect(page.getByRole("status")).toContainText("To reopen the club before then, email")

  // The platform admin sees it with its date and reopens it.
  await seedMockSession(page, { role: "platform-admin", tenantId: "platform" })
  await page.goto("/platform-admin/tenants")
  const closed = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Closed clubs" }) })
  const row = closed.locator("[data-closed-club='Elite Track Club']")
  await expect(row).toContainText("Deleted after")
  await expect(row).toContainText("90 days left")
  await row.getByRole("button", { name: "Reopen Elite Track Club" }).click()
  await row.getByRole("button", { name: "Reopen club" }).click()
  await expect(closed.getByText("Elite Track Club is open again.")).toBeVisible()
  await expect(closed.locator("[data-closed-club]")).toHaveCount(0)

  // Members are back in.
  await seedMockSession(page, { role: "club-admin" })
  await page.goto("/club-admin/profile")
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("This club is closed")
  await closeClub()

  // This time the platform admin deletes it now, behind the typed name.
  await seedMockSession(page, { role: "platform-admin", tenantId: "platform" })
  await page.goto("/platform-admin/tenants")
  await row.getByRole("button", { name: "Delete now: Elite Track Club" }).click()
  const dialog = page.getByRole("dialog", { name: "Delete permanently now" })
  const confirm = dialog.getByRole("button", { name: "Delete club for good" })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel("Type Elite Track Club to confirm").fill("Elite Track Club")
  await confirm.click()
  await expect(closed.getByText("Elite Track Club and all its data were deleted for good.")).toBeVisible()
  await expect(closed.locator("[data-closed-club]")).toHaveCount(0)

  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/home")
  await expect(page.getByRole("heading", { level: 1, name: "This club has been deleted" })).toBeVisible()
})

test("privacy page says what the app now does", async ({ page }) => {
  await page.goto("/privacy")
  await expect(page.locator("body")).toContainText("You can download a copy of your information and delete your account yourself")
  await expect(page.locator("body")).toContainText('shown as from "Deleted account"')
  await expect(page.locator("body")).toContainText("kept for 90 days")
})
