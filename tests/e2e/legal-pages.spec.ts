import { expect, test } from "@playwright/test"

// The privacy and terms pages are public: they open with no session, and the sign-in page links to both.
test("privacy and terms open signed out and are linked from sign in", async ({ page }) => {
  await page.goto("/login")
  const footer = page.locator("footer")
  await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy")
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms")

  await footer.getByRole("link", { name: "Privacy" }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible()
  await expect(page.getByText("Draft. This page has not been reviewed by a lawyer yet.")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Who can see what" })).toBeVisible()

  await page.goto("/terms")
  await expect(page).toHaveURL(/\/terms$/)
  await expect(page.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible()
  await expect(page.getByText("Draft. This page has not been reviewed by a lawyer yet.")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Not medical advice" })).toBeVisible()
})

test("the request form says that sending it accepts the terms and privacy notice", async ({ page }) => {
  await page.goto("/login?mode=request")
  const form = page.locator("form")
  await expect(form.getByRole("link", { name: "terms" })).toHaveAttribute("href", "/terms")
  await expect(form.getByRole("link", { name: "privacy notice" })).toHaveAttribute("href", "/privacy")
})
