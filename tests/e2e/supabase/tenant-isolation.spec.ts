import { expect, test } from "@playwright/test"
import { access, constants } from "node:fs/promises"
import { hasRoleCredential } from "../helpers/supabase-auth"

async function fileExists(path: string) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

test("club-admin tenant isolation: invite from tenant A is not visible in tenant B", async ({ browser }) => {
  test.skip(
    !hasRoleCredential("clubAdminTenantB"),
    "Missing tenant B club-admin credentials. Set PW_SUPABASE_CLUB_ADMIN_TENANT_B_EMAIL/PASSWORD.",
  )

  const tenantAState = "playwright/.auth/club-admin.json"
  const tenantBState = "playwright/.auth/club-admin-tenant-b.json"

  test.skip(!(await fileExists(tenantAState)), `Missing storage state: ${tenantAState}`)
  test.skip(!(await fileExists(tenantBState)), `Missing storage state: ${tenantBState}`)

  const inviteEmail = `e2e-tenant-a-${Date.now()}@pacelab.local`

  const tenantAContext = await browser.newContext({ storageState: tenantAState })
  const tenantAPage = await tenantAContext.newPage()
  await tenantAPage.goto("/club-admin/users")
  await tenantAPage.getByPlaceholder("coach@email.com").fill(inviteEmail)
  await tenantAPage.getByRole("button", { name: "Send invite" }).click()
  await expect(tenantAPage.locator("body")).toContainText(inviteEmail)
  await tenantAContext.close()

  const tenantBContext = await browser.newContext({ storageState: tenantBState })
  const tenantBPage = await tenantBContext.newPage()
  await tenantBPage.goto("/club-admin/users")
  await expect(tenantBPage.locator("body")).not.toContainText(inviteEmail)
  await tenantBContext.close()
})
