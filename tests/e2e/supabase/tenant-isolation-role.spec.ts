import { expect, test } from "@playwright/test"
import { hasRoleCredential } from "../helpers/supabase-auth"
import { deleteTeamForRole, insertTeamForRole, listTeamNamesForRole } from "../helpers/supabase-rest"

// Probe teams are created and removed by the tenant A club admin: since 20261006120000_coach_team_scope.sql
// a coach can no longer create or delete teams. Coaches and athletes still read every team name of their own club.
test("coach tenant isolation: tenant A team is not visible to tenant B coach", async () => {
  test.skip(!hasRoleCredential("clubAdmin"), "Missing tenant A club-admin credentials for probe-team creation.")
  test.skip(!hasRoleCredential("coach"), "Missing tenant A coach credentials.")
  test.skip(
    !hasRoleCredential("coachTenantB"),
    "Missing tenant B coach credentials. Set PW_SUPABASE_COACH_TENANT_B_EMAIL/PASSWORD.",
  )

  const probeTeamName = `E2E-TENANT-A-COACH-${Date.now()}`
  const inserted = await insertTeamForRole({ role: "clubAdmin", name: probeTeamName })

  try {
    const tenantATeamNames = await listTeamNamesForRole("coach")
    const tenantBTeamNames = await listTeamNamesForRole("coachTenantB")

    expect(tenantATeamNames).toContain(probeTeamName)
    expect(tenantBTeamNames).not.toContain(probeTeamName)
  } finally {
    await deleteTeamForRole({ role: "clubAdmin", teamId: inserted.id })
  }
})

test("coach cannot create a team (club admins only)", async () => {
  test.skip(!hasRoleCredential("coach"), "Missing tenant A coach credentials.")

  const probeTeamName = `E2E-COACH-CANNOT-CREATE-${Date.now()}`
  let insertedId: string | null = null
  try {
    insertedId = (await insertTeamForRole({ role: "coach", name: probeTeamName })).id
  } catch {
    insertedId = null
  }

  if (insertedId && hasRoleCredential("clubAdmin")) {
    await deleteTeamForRole({ role: "clubAdmin", teamId: insertedId })
  }
  expect(insertedId, "a coach must not be able to create a team").toBeNull()
})

test("athlete tenant isolation: tenant A team is not visible to tenant B athlete", async () => {
  test.skip(!hasRoleCredential("clubAdmin"), "Missing tenant A club-admin credentials for probe-team creation.")
  test.skip(!hasRoleCredential("athlete"), "Missing tenant A athlete credentials.")
  test.skip(
    !hasRoleCredential("athleteTenantB"),
    "Missing tenant B athlete credentials. Set PW_SUPABASE_ATHLETE_TENANT_B_EMAIL/PASSWORD.",
  )

  const probeTeamName = `E2E-TENANT-A-ATHLETE-${Date.now()}`
  const inserted = await insertTeamForRole({ role: "clubAdmin", name: probeTeamName })

  try {
    const tenantATeamNames = await listTeamNamesForRole("athlete")
    const tenantBTeamNames = await listTeamNamesForRole("athleteTenantB")

    expect(tenantATeamNames).toContain(probeTeamName)
    expect(tenantBTeamNames).not.toContain(probeTeamName)
  } finally {
    await deleteTeamForRole({ role: "clubAdmin", teamId: inserted.id })
  }
})
