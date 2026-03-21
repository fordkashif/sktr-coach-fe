import { expect, test } from "@playwright/test"
import { hasRoleCredential } from "../helpers/supabase-auth"
import { deleteTeamForRole, insertTeamForRole, listTeamNamesForRole } from "../helpers/supabase-rest"

test("coach tenant isolation: tenant A team is not visible to tenant B coach", async () => {
  test.skip(!hasRoleCredential("coach"), "Missing tenant A coach credentials.")
  test.skip(
    !hasRoleCredential("coachTenantB"),
    "Missing tenant B coach credentials. Set PW_SUPABASE_COACH_TENANT_B_EMAIL/PASSWORD.",
  )

  const probeTeamName = `E2E-TENANT-A-COACH-${Date.now()}`
  const inserted = await insertTeamForRole({ role: "coach", name: probeTeamName })

  try {
    const tenantATeamNames = await listTeamNamesForRole("coach")
    const tenantBTeamNames = await listTeamNamesForRole("coachTenantB")

    expect(tenantATeamNames).toContain(probeTeamName)
    expect(tenantBTeamNames).not.toContain(probeTeamName)
  } finally {
    await deleteTeamForRole({ role: "coach", teamId: inserted.id })
  }
})

test("athlete tenant isolation: tenant A team is not visible to tenant B athlete", async () => {
  test.skip(!hasRoleCredential("coach"), "Missing tenant A coach credentials for probe-team creation.")
  test.skip(!hasRoleCredential("athlete"), "Missing tenant A athlete credentials.")
  test.skip(
    !hasRoleCredential("athleteTenantB"),
    "Missing tenant B athlete credentials. Set PW_SUPABASE_ATHLETE_TENANT_B_EMAIL/PASSWORD.",
  )

  const probeTeamName = `E2E-TENANT-A-ATHLETE-${Date.now()}`
  const inserted = await insertTeamForRole({ role: "coach", name: probeTeamName })

  try {
    const tenantATeamNames = await listTeamNamesForRole("athlete")
    const tenantBTeamNames = await listTeamNamesForRole("athleteTenantB")

    expect(tenantATeamNames).toContain(probeTeamName)
    expect(tenantBTeamNames).not.toContain(probeTeamName)
  } finally {
    await deleteTeamForRole({ role: "coach", teamId: inserted.id })
  }
})
