import { expect, test } from "@playwright/test"
import { hasRoleCredential } from "../helpers/supabase-auth"
import { deleteTeamForRole, insertTeamForRole, listTeamNamesForRole } from "../helpers/supabase-rest"

// Probe teams are created and removed by the tenant A club admin: since 20261006120000_coach_team_scope.sql
// a coach can no longer create or delete teams. Coaches still read every team name of their own club.
// Since 20261006150000_athlete_read_scope.sql an athlete reads only the team they are on.
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

test("athlete team scope: a team the athlete is not on is not visible, in their own club or another", async () => {
  test.skip(!hasRoleCredential("clubAdmin"), "Missing tenant A club-admin credentials for probe-team creation.")
  test.skip(!hasRoleCredential("athlete"), "Missing tenant A athlete credentials.")

  const probeTeamName = `E2E-TENANT-A-ATHLETE-${Date.now()}`
  const inserted = await insertTeamForRole({ role: "clubAdmin", name: probeTeamName })

  try {
    // Same club, but not the athlete's team: athletes only read their own team.
    const tenantATeamNames = await listTeamNamesForRole("athlete")
    expect(tenantATeamNames).not.toContain(probeTeamName)
    expect(tenantATeamNames.length, "an athlete sees at most the one team they are on").toBeLessThanOrEqual(1)

    if (hasRoleCredential("athleteTenantB")) {
      const tenantBTeamNames = await listTeamNamesForRole("athleteTenantB")
      expect(tenantBTeamNames).not.toContain(probeTeamName)
    }
  } finally {
    await deleteTeamForRole({ role: "clubAdmin", teamId: inserted.id })
  }
})
