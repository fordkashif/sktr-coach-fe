import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

/** The athlete report in mock mode: build, save, share in the app and by link, print. The demo coach has the Sprint Group (t1). */

async function asCoach(page: Page) {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
}

async function buildAndSave(page: Page, summary: string) {
  await page.goto("/coach/athletes/a1/report")
  await expect(page.getByRole("heading", { name: "New report" })).toBeVisible()
  await page.getByLabel("Summary").fill(summary)
  await page.getByRole("button", { name: "Save report" }).click()
  await expect(page.getByRole("heading", { name: /^Report, / })).toBeVisible()
}

test.describe("athlete report (mock mode)", () => {
  test("build a report: sections, health off by default, live preview, no coach notes", async ({ page }) => {
    await asCoach(page)
    // A private coach note exists for this athlete.
    await page.goto("/coach/athletes/a1")
    const notes = page.locator("[data-coach-notes]")
    await notes.getByRole("button", { name: "Add note" }).click()
    await notes.getByRole("textbox", { name: "Note" }).fill("Private worry about commitment")
    await notes.getByRole("button", { name: "Save note" }).click()
    await expect(notes.locator("[data-coach-note]")).toHaveCount(1)

    await page.getByRole("link", { name: "Create report" }).first().click()
    await expect(page.getByRole("heading", { name: "New report" })).toBeVisible()
    const preview = page.locator("[data-report-preview]")
    await expect(preview.locator("[data-report-club]")).toContainText("Elite Track Club")
    await expect(preview).toContainText("Marcus Johnson")
    await expect(preview).toContainText("Sprint Group")
    await expect(preview).toContainText("Coach: Andre Campbell")

    // Health sections are off, with the consent line beside them.
    await expect(page.getByRole("checkbox", { name: /Wellness trend/ })).not.toBeChecked()
    await expect(page.getByRole("checkbox", { name: /Injury notes/ })).not.toBeChecked()
    await expect(page.locator("[data-report-health]")).toContainText("Share it only with the athlete's consent, or a parent's or guardian's for an athlete under 18.")
    await expect(preview.locator("[data-report-section='wellness']")).toHaveCount(0)
    await expect(preview.locator("[data-report-section='injuries']")).toHaveCount(0)
    await expect(page.getByText("Your private coach notes are never part of a report.")).toBeVisible()

    // The summary shows in the preview as it is typed.
    await page.getByLabel("Summary").fill("Starts are sharper this block.")
    await expect(preview.locator("[data-report-section='summary']")).toContainText("Starts are sharper this block.")

    // Unticking a section removes it; ticking a health section adds it.
    await expect(preview.locator("[data-report-section='goals']")).toHaveCount(1)
    await page.getByRole("checkbox", { name: /^Goals/ }).uncheck()
    await expect(preview.locator("[data-report-section='goals']")).toHaveCount(0)
    await page.getByRole("checkbox", { name: /Wellness trend/ }).check()
    await expect(preview.locator("[data-report-section='wellness']")).toContainText("Health information")

    // A longer period brings in the results of the period with their bests.
    await page.getByRole("radio", { name: "Last 12 weeks" }).click()
    await expect(preview.locator("[data-report-section='results']")).toContainText("Season best")
    await expect(preview.locator("[data-report-section='results']")).toContainText("11.35s")

    // The private note is nowhere on the sheet.
    await expect(preview).not.toContainText("Private worry")
    await page.getByRole("button", { name: "Save report" }).click()
    await expect(page.getByRole("heading", { name: /^Report, / })).toBeVisible()
    await expect(page.locator("[data-report-sheet]")).toContainText("Starts are sharper this block.")
    const stored = await page.evaluate(() => Object.entries(window.localStorage).filter(([key]) => key.includes("athlete-report")).map(([, value]) => value).join(""))
    expect(stored).toContain("Starts are sharper this block.")
    expect(stored).not.toContain("Private worry")
  })

  test("a saved report is a snapshot, the summary can change until it is shared, then duplicate and delete", async ({ page }) => {
    await asCoach(page)
    await buildAndSave(page, "First words.")
    const sheet = page.locator("[data-report-sheet]")
    await expect(page.locator("[data-report-status]")).toContainText("Not shared yet")

    await page.getByRole("button", { name: "Edit summary" }).click()
    await page.getByLabel("Summary").fill("Better words.")
    await page.getByRole("button", { name: "Save summary" }).click()
    await expect(sheet).toContainText("Better words.")
    await page.reload()
    await expect(sheet).toContainText("Better words.")

    // Listed on the athlete screen with the date and the author.
    await page.goto("/coach/athletes/a1")
    const list = page.locator("[data-athlete-reports]")
    await expect(list.locator("[data-report]")).toHaveCount(1)
    await expect(list.locator("[data-report]")).toContainText("by Andre Campbell")
    await expect(list.locator("[data-report]")).toContainText("not shared")
    await list.getByRole("link", { name: /Saved/ }).click()

    // Share with the athlete: frozen from then on.
    await page.getByRole("button", { name: "Share with Marcus" }).click()
    await page.getByRole("button", { name: "Share", exact: true }).click()
    await expect(page.locator("[data-report-status]")).toContainText("Shared with Marcus")
    await expect(page.getByRole("button", { name: "Edit summary" })).toHaveCount(0)
    await expect(page.getByText("Shared, so it can no longer be changed.")).toBeVisible()

    // Duplicate for the next period: same sections, empty summary.
    await page.getByRole("button", { name: "More for this report" }).click()
    await page.getByRole("menuitem", { name: "Duplicate for the next period" }).click()
    await expect(page.getByRole("heading", { name: "New report" })).toBeVisible()
    await expect(page.getByText(/^Started from the report for /)).toBeVisible()
    await expect(page.getByLabel("Summary")).toHaveValue("")
    await expect(page.getByRole("radio", { name: "Custom" })).toBeChecked()
    await page.getByLabel("Summary").fill("Second report.")
    await page.getByRole("button", { name: "Save report" }).click()
    await expect(page.getByRole("heading", { name: /^Report, / })).toBeVisible()

    // Delete the second one.
    await page.getByRole("button", { name: "More for this report" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await page.getByRole("button", { name: "Delete report" }).click()
    await expect(page).toHaveURL(/\/coach\/athletes\/a1$/)
    await expect(page.locator("[data-athlete-reports] [data-report]")).toHaveCount(1)
  })

  test("the athlete sees only shared reports under Progress, read only", async ({ page }) => {
    await asCoach(page)
    await buildAndSave(page, "Not for sharing yet.")
    await buildAndSave(page, "Shared with you, Marcus.")
    await page.getByRole("button", { name: "Share with Marcus" }).click()
    await page.getByRole("button", { name: "Share", exact: true }).click()
    await expect(page.locator("[data-report-status]")).toContainText("Shared with Marcus")

    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/trends")
    const mine = page.locator("[data-my-reports]")
    await expect(mine).toContainText("Reports from your coach")
    await expect(mine.getByRole("link")).toHaveCount(1)
    await expect(mine).toContainText("From Andre Campbell")
    await mine.getByRole("link").click()
    await expect(page.getByRole("heading", { name: "Report from your coach" })).toBeVisible()
    await expect(page.locator("[data-report-sheet]")).toContainText("Shared with you, Marcus.")
    await expect(page.locator("[data-report-sheet]")).not.toContainText("Not for sharing yet.")
    await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible()
    // Nothing to change or share from here.
    await expect(page.getByRole("button", { name: /Edit summary|Make a link|Share with/ })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "More for this report" })).toHaveCount(0)

    // A report that was not shared cannot be opened by its address either.
    await page.goto("/athlete/reports/not-a-report")
    await expect(page.getByText("This report is not here")).toBeVisible()
  })

  test("a private link opens the report signed out, counts opens, and stops when revoked", async ({ page, context }) => {
    await asCoach(page)
    await buildAndSave(page, "For the family to read.")
    const links = page.locator("[data-report-links]")
    await links.getByRole("button", { name: "Make a link" }).click()
    await page.getByLabel("Who is it for").fill("Dana Johnson, mother")
    // 30 days unless the coach picks another.
    await expect(page.getByRole("radio", { name: "30 days" })).toBeChecked()
    await page.getByRole("radio", { name: "7 days" }).click()
    await page.getByRole("button", { name: "Make link" }).click()
    await expect(page.locator("[data-report-link-made]")).toContainText("it cannot be shown again")
    const url = await page.getByRole("textbox", { name: "Private link" }).inputValue()
    expect(url).toMatch(/\/shared\/report#[0-9a-f]{64}$/)
    const token = url.split("#")[1]
    await page.getByRole("button", { name: "Done" }).click()
    await expect(links.locator("[data-report-link='active']")).toContainText("Dana Johnson, mother")
    await expect(links.locator("[data-report-link='active']")).toContainText("Not opened yet")
    // A report with a link is frozen.
    await expect(page.getByRole("button", { name: "Edit summary" })).toHaveCount(0)
    // Only a hash of the token is kept.
    const stored = await page.evaluate(() => window.localStorage.getItem("pacelab:athlete-report-links:v1") ?? "")
    expect(stored).not.toContain(token)
    const reportUrl = page.url()

    // Signed out, in the same browser.
    const visitor = await context.newPage()
    await context.clearCookies()
    await visitor.goto(url)
    await expect(visitor.locator("[data-shared-report='found']")).toBeVisible()
    await expect(visitor.getByRole("heading", { level: 1, name: "Marcus Johnson" })).toBeVisible()
    await expect(visitor.locator("[data-report-sheet]")).toContainText("For the family to read.")
    await expect(visitor.locator("[data-report-sheet] [data-report-club]")).toContainText("Elite Track Club")
    // Only the sheet: no app navigation, no way into the club.
    await expect(visitor.locator("[data-shell]")).toHaveCount(0)
    await expect(visitor.getByRole("link")).toHaveCount(0)
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // A wrong link says the same thing a stopped one will.
    await visitor.goto(`/shared/report#${"ab".repeat(32)}`)
    await visitor.reload()
    await expect(visitor.locator("[data-shared-report='not-found']")).toBeVisible()
    const wrongText = await visitor.locator("main").innerText()

    // The coach sees the open and stops the link.
    await asCoach(page)
    await page.goto(reportUrl)
    await expect(links.locator("[data-report-link='active']")).toContainText("Opened 1 time")
    await page.getByRole("button", { name: "More for the link for Dana Johnson, mother" }).click()
    await page.getByRole("menuitem", { name: "Stop this link" }).click()
    await page.getByRole("button", { name: "Stop link" }).click()
    await expect(links.locator("[data-report-link='revoked']")).toContainText("Stopped")

    await context.clearCookies()
    await visitor.goto(url)
    await visitor.reload()
    await expect(visitor.locator("[data-shared-report='not-found']")).toBeVisible()
    expect(await visitor.locator("main").innerText()).toBe(wrongText)

    // An expired link looks the same too.
    await asCoach(page)
    await page.goto(reportUrl)
    await links.getByRole("button", { name: "Make a link" }).click()
    await page.getByLabel("Who is it for").fill("Grandparent")
    await page.getByRole("button", { name: "Make link" }).click()
    const second = await page.getByRole("textbox", { name: "Private link" }).inputValue()
    await page.evaluate(() => {
      const key = "pacelab:athlete-report-links:v1"
      const all = JSON.parse(window.localStorage.getItem(key) ?? "[]") as Array<{ madeFor: string; expiresAt: string }>
      window.localStorage.setItem(key, JSON.stringify(all.map((link) => (link.madeFor === "Grandparent" ? { ...link, expiresAt: new Date(Date.now() - 60_000).toISOString() } : link))))
    })
    await context.clearCookies()
    await visitor.goto(second)
    await visitor.reload()
    await expect(visitor.locator("[data-shared-report='not-found']")).toBeVisible()
    expect(await visitor.locator("main").innerText()).toBe(wrongText)
  })

  test("print gives the sheet and nothing else", async ({ page }) => {
    await asCoach(page)
    await buildAndSave(page, "On paper.")
    await page.emulateMedia({ media: "print" })
    const paper = page.locator(".sk-print-sheet")
    await expect(paper).toBeVisible()
    await expect(paper.locator("h1")).toHaveText("Marcus Johnson")
    await expect(paper).toContainText("Elite Track Club")
    await expect(paper).toContainText("On paper.")
    await expect(paper).toContainText("Coach: Andre Campbell")
    // The app around it is not printed.
    await expect(page.locator("[data-shell]").first()).toBeHidden()
    await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeHidden()
    // Nothing on the sheet is wider than the paper.
    const overflow = await paper.evaluate((sheet) => [...sheet.querySelectorAll("*")].filter((element) => element.getBoundingClientRect().right > sheet.getBoundingClientRect().right + 1).length)
    expect(overflow).toBe(0)
  })

  test("drafts for the whole team, written one after another", async ({ page }) => {
    await asCoach(page)
    await page.goto("/coach/athletes/a1/report")
    await page.getByRole("button", { name: "Create reports for the team" }).click()
    await page.getByRole("button", { name: "Make drafts" }).click()
    await expect(page.getByRole("heading", { name: /^Report, / })).toBeVisible()
    await expect(page.getByText(/^Draft \d+ of \d+$/)).toBeVisible()
    // A draft opens ready for its summary.
    await page.getByLabel("Summary").fill("Written first.")
    await page.getByRole("button", { name: "Save summary" }).click()
    await expect(page.locator("[data-report-sheet]")).toContainText("Written first.")
    const next = page.getByRole("link", { name: /^Next: / })
    if ((await next.count()) > 0) {
      await next.click()
      await expect(page.getByText(/^Draft 2 of \d+$/)).toBeVisible()
      await expect(page.getByLabel("Summary")).toHaveValue("")
    }
  })

  test("phone: the builder and the sheet do not scroll sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await asCoach(page)
    await page.goto("/coach/athletes/a1/report")
    await expect(page.getByRole("heading", { name: "New report" })).toBeVisible()
    await page.getByRole("radio", { name: "Last 12 weeks" }).click()
    await expect(page.locator("[data-report-preview] [data-report-section='results']")).toContainText("Season best")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
