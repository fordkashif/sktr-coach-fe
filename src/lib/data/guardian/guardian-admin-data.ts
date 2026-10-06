import type { SupabaseClient } from "@supabase/supabase-js"
import { getCookieValue, ROLE_COOKIE, USER_COOKIE } from "@/lib/auth-session"
import { resolveMockCoachTeamIds, resolveMockCoachTeamRole } from "@/lib/coach-scope"
import { MOCK_ATHLETE_ID } from "@/lib/data/athlete/profile-data"
import {
  acceptMockGuardianInvite,
  cancelMockGuardianInvite,
  getMockGuardianContact,
  getMockGuardianInvite,
  getMockHealthSharing,
  inviteMockGuardian,
  listMockActiveLinks,
  listMockGuardiansOfAthlete,
  listMockPendingInvites,
  markMockInviteEmailed,
  MOCK_GUARDIAN_EMAIL,
  mockAthleteName,
  mockAthleteTeam,
  mockEmailStanding,
  mockGuardianHealthRule,
  revokeMockGuardianLink,
  setMockHealthSharing,
} from "@/lib/data/guardian/mock-guardian-store"
import type { AthleteGuardians, ClubGuardianRow, GuardianInvitePreview, GuardianInviteRow, GuardianLinkRow, MyGuardianSharing } from "@/lib/data/guardian/types"
import { sendInviteEmail, type InviteEmailSent } from "@/lib/data/invites/invite-email-data"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { asGuardianHealthRule } from "@/lib/guardian/health-visibility"
import { loadClubProfile } from "@/lib/mock-club-admin"
import { mockAthletes, mockTeams } from "@/lib/mock-data"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * Parent and guardian access, seen from the club (invite, link, revoke), from the athlete (who
 * follows me, and the adult's sharing switch) and from the invited person (the claim page).
 * The rule: access is always by invite from the club. A lead or coach of the athlete's team, or a
 * club admin, invites and revokes. Assistants do not. A guardian cannot remove themselves.
 */

export const GUARDIANS_CHANGED_EVENT = "pacelab:guardians-changed"
export const RELATIONSHIP_OPTIONS = ["Mother", "Father", "Guardian", "Grandparent", "Other family"]

const NO_CLIENT = "Supabase client is not configured."
const NOT_ALLOWED = "Only a coach of this athlete's team or a club admin can manage guardians."

function isMock() {
  return getBackendMode() !== "supabase"
}

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(GUARDIANS_CHANGED_EVENT))
}

/** The database writes its refusals for the person reading them: pass those sentences on as they are. */
function mapGuardianError(error: { code?: string; message: string; hint?: string | null; details?: string | null }): DataError {
  const mapped = mapPostgrestError(error as Parameters<typeof mapPostgrestError>[0])
  if (error.hint === "access_paused") return mapped
  if (error.hint === "role_mixing" || error.hint === "too_many") return { code: "CONFLICT", message: error.message, cause: error }
  if (error.hint === "invalid_email") return { code: "VALIDATION", message: error.message, cause: error }
  if (error.hint === "not_allowed") return { code: "FORBIDDEN", message: error.message, cause: error }
  if (error.code === "P0001") return { code: "CONFLICT", message: error.message, cause: error }
  return mapped
}

async function attempt<T>(run: (supabase: SupabaseClient) => Promise<Result<T>>): Promise<Result<T>> {
  const supabase = getBrowserSupabaseClient()
  if (!supabase) return err("UNKNOWN", NO_CLIENT)
  try {
    return await run(supabase)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server. Check your connection and try again.", cause)
  }
}

/** Demo: may the signed-in person manage guardians of this athlete? Lead or coach of the team, or a club admin. */
function mockCanManage(athleteId: string): boolean {
  const role = getCookieValue(ROLE_COOKIE)
  if (role === "club-admin") return true
  if (role !== "coach") return false
  const team = mockAthleteTeam(athleteId)
  if (!team) return false
  if (!resolveMockCoachTeamIds(mockTeams.map((item) => item.id)).includes(team.id)) return false
  return resolveMockCoachTeamRole(team.id) !== "assistant"
}

/* ---------- Staff ------------------------------------------------------------------------------ */

/** The guardians and open invites of one athlete. Null when the caller may not manage them (an assistant). */
export async function getAthleteGuardians(athleteId: string): Promise<Result<AthleteGuardians | null>> {
  if (isMock()) {
    if (!mockCanManage(athleteId)) return ok(null)
    const contact = getMockGuardianContact(athleteId)
    return ok({
      healthRule: mockGuardianHealthRule(athleteId),
      storedGuardian: { name: contact.name, email: contact.email },
      links: listMockGuardiansOfAthlete(athleteId).map((link): GuardianLinkRow => ({ id: link.id, name: link.name, email: link.email, relationship: link.relationship, since: link.createdAt })),
      invites: listMockPendingInvites(athleteId).map(
        (invite): GuardianInviteRow => ({ id: invite.id, name: invite.name, email: invite.email, relationship: invite.relationship, expiresAt: invite.expiresAt, expired: invite.expiresAt < new Date().toISOString(), lastEmailSentAt: invite.lastEmailSentAt }),
      ),
    })
  }
  return attempt(async (supabase) => {
    const { data, error } = await supabase.rpc("get_athlete_guardians", { p_athlete_id: athleteId })
    if (error) {
      // A database that does not have guardian access yet: the section simply stays away.
      if (error.code === "PGRST202" || error.code === "42883") return ok(null)
      return { ok: false, error: mapGuardianError(error) }
    }
    type Body = {
      health_rule?: string
      stored_guardian?: { name?: string | null; email?: string | null } | null
      links?: Array<{ id: string; name: string | null; email: string | null; relationship: string; since: string }>
      invites?: Array<{ id: string; name: string | null; email: string; relationship: string; expires_at: string | null; expired: boolean; last_email_sent_at: string | null }>
    }
    const body = data as Body | null
    if (!body) return ok(null)
    return ok({
      healthRule: asGuardianHealthRule(body.health_rule),
      storedGuardian: { name: body.stored_guardian?.name ?? null, email: body.stored_guardian?.email ?? null },
      links: (body.links ?? []).map((link) => ({ id: link.id, name: link.name, email: link.email, relationship: link.relationship, since: link.since })),
      invites: (body.invites ?? []).map((invite) => ({ id: invite.id, name: invite.name, email: invite.email, relationship: invite.relationship, expiresAt: invite.expires_at, expired: invite.expired === true, lastEmailSentAt: invite.last_email_sent_at })),
    })
  })
}

export type GuardianInviteOutcome =
  | { outcome: "linked" }
  /** `email` is how the invite email went: sent, or the reason it could not be (the invite itself stands either way). */
  | { outcome: "invited"; inviteId: string; email: Result<InviteEmailSent> }

/**
 * Invites a parent or guardian for one athlete and emails the invite. An email that is already a
 * guardian in this club is linked straight away, with no new account. An email that already has
 * a coach, admin, athlete or platform admin account is refused.
 */
export async function inviteGuardian(input: { athleteId: string; email: string; name: string; relationship: string }): Promise<Result<GuardianInviteOutcome>> {
  if (isMock()) {
    if (!mockCanManage(input.athleteId)) return err("FORBIDDEN", NOT_ALLOWED)
    const result = inviteMockGuardian({ athleteId: input.athleteId, email: input.email, name: input.name || null, relationship: input.relationship })
    if (!result.ok) return err(result.code, result.message)
    announce()
    if (result.outcome === "linked") return ok({ outcome: "linked" })
    const email = await sendInviteEmail({ kind: "guardian", inviteId: result.inviteId })
    if (email.ok) markMockInviteEmailed(result.inviteId)
    return ok({ outcome: "invited", inviteId: result.inviteId, email })
  }
  return attempt(async (supabase) => {
    const { data, error } = await supabase.rpc("invite_guardian", {
      p_athlete_id: input.athleteId,
      p_email: input.email.trim().toLowerCase(),
      p_name: input.name.trim() || null,
      p_relationship: input.relationship.trim() || null,
    })
    if (error) return { ok: false, error: mapGuardianError(error) }
    const body = data as { outcome?: string; invite_id?: string } | null
    announce()
    if (body?.outcome === "linked") return ok({ outcome: "linked" })
    if (body?.outcome !== "invited" || !body.invite_id) return err("UNKNOWN", "The invite could not be created. Try again.")
    const email = await sendInviteEmail({ kind: "guardian", inviteId: body.invite_id })
    return ok({ outcome: "invited", inviteId: body.invite_id, email })
  })
}

export async function resendGuardianInvite(inviteId: string): Promise<Result<InviteEmailSent>> {
  const result = await sendInviteEmail({ kind: "guardian", inviteId })
  if (result.ok && isMock()) markMockInviteEmailed(inviteId)
  if (result.ok) announce()
  return result
}

/** The address of the page the invited person opens. Shown so the coach can pass it on by hand. */
export function guardianInviteLink(inviteId: string): string {
  const path = `/guardian/claim/${inviteId}`
  return typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path
}

/** Ends a guardian's access to one athlete at once. */
export async function revokeGuardianLink(linkId: string): Promise<Result<null>> {
  if (isMock()) {
    const link = listMockActiveLinks().find((item) => item.id === linkId)
    if (!link || !mockCanManage(link.athleteId)) return err("FORBIDDEN", NOT_ALLOWED)
    if (!revokeMockGuardianLink(linkId)) return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    announce()
    return ok(null)
  }
  return attempt(async (supabase) => {
    const { error } = await supabase.rpc("revoke_guardian_link", { p_link_id: linkId })
    if (error) return { ok: false, error: mapGuardianError(error) }
    announce()
    return ok(null)
  })
}

export async function cancelGuardianInvite(inviteId: string): Promise<Result<null>> {
  if (isMock()) {
    const invite = getMockGuardianInvite(inviteId)
    if (!invite || !mockCanManage(invite.athleteId)) return err("FORBIDDEN", NOT_ALLOWED)
    cancelMockGuardianInvite(inviteId)
    announce()
    return ok(null)
  }
  return attempt(async (supabase) => {
    const { error } = await supabase.rpc("cancel_guardian_invite", { p_invite_id: inviteId })
    if (error) return { ok: false, error: mapGuardianError(error) }
    announce()
    return ok(null)
  })
}

/** Every guardian link and open invite of the club, for the club admin's People screen. */
export async function listClubGuardians(): Promise<Result<ClubGuardianRow[]>> {
  if (isMock()) {
    if (getCookieValue(ROLE_COOKIE) !== "club-admin") return ok([])
    const known = (athleteId: string) => mockAthletes.some((athlete) => athlete.id === athleteId)
    const rows: ClubGuardianRow[] = [
      ...listMockActiveLinks()
        .filter((link) => known(link.athleteId))
        .map((link): ClubGuardianRow => ({ kind: "link", id: link.id, athleteId: link.athleteId, athleteName: mockAthleteName(link.athleteId), teamName: mockAthleteTeam(link.athleteId)?.name ?? null, guardianName: link.name, email: link.email, relationship: link.relationship, since: link.createdAt, expired: false })),
      ...listMockPendingInvites()
        .filter((invite) => known(invite.athleteId))
        .map((invite): ClubGuardianRow => ({ kind: "invite", id: invite.id, athleteId: invite.athleteId, athleteName: mockAthleteName(invite.athleteId), teamName: mockAthleteTeam(invite.athleteId)?.name ?? null, guardianName: invite.name, email: invite.email, relationship: invite.relationship, since: invite.createdAt, expired: invite.expiresAt < new Date().toISOString() })),
    ]
    return ok(rows.sort((left, right) => left.athleteName.localeCompare(right.athleteName)))
  }
  return attempt(async (supabase) => {
    const { data, error } = await supabase.rpc("get_club_guardians")
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") return ok([])
      return { ok: false, error: mapGuardianError(error) }
    }
    type Row = { kind: string; id: string; athlete_id: string; athlete_name: string; team_name: string | null; guardian_name: string | null; email: string | null; relationship: string; since: string; expired: boolean }
    return ok(
      ((data as Row[] | null) ?? []).map((row) => ({
        kind: row.kind === "invite" ? "invite" : "link",
        id: row.id,
        athleteId: row.athlete_id,
        athleteName: row.athlete_name,
        teamName: row.team_name,
        guardianName: row.guardian_name,
        email: row.email,
        relationship: row.relationship,
        since: row.since,
        expired: row.expired === true,
      })),
    )
  })
}

/* ---------- Athlete ---------------------------------------------------------------------------- */

/** Who follows the signed-in athlete, and whether their health information is shared. Null for anyone who is not an athlete. */
export async function getMyGuardianSharing(): Promise<Result<MyGuardianSharing | null>> {
  if (isMock()) {
    if (getCookieValue(ROLE_COOKIE) !== "athlete") return ok(null)
    return ok({
      healthRule: mockGuardianHealthRule(MOCK_ATHLETE_ID),
      shareHealth: getMockHealthSharing(MOCK_ATHLETE_ID),
      guardians: listMockGuardiansOfAthlete(MOCK_ATHLETE_ID).map((link) => ({ name: link.name ?? "Guardian", relationship: link.relationship })),
    })
  }
  return attempt(async (supabase) => {
    const { data, error } = await supabase.rpc("get_my_guardian_sharing")
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") return ok(null)
      return { ok: false, error: mapGuardianError(error) }
    }
    const body = data as { health_rule?: string; share_health?: boolean; guardians?: Array<{ name: string; relationship: string }> } | null
    if (!body) return ok(null)
    return ok({ healthRule: asGuardianHealthRule(body.health_rule), shareHealth: body.share_health === true, guardians: body.guardians ?? [] })
  })
}

/** The athlete's own choice. It only has an effect from the age of 18: before that health is always shared. */
export async function setMyGuardianHealthSharing(enabled: boolean): Promise<Result<boolean>> {
  if (isMock()) {
    if (getCookieValue(ROLE_COOKIE) !== "athlete") return err("FORBIDDEN", "Only an athlete can change this.")
    return setMockHealthSharing(MOCK_ATHLETE_ID, enabled) ? ok(enabled) : err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
  }
  return attempt(async (supabase) => {
    const { data, error } = await supabase.rpc("set_my_guardian_health_sharing", { p_enabled: enabled })
    if (error) return { ok: false, error: mapGuardianError(error) }
    return ok(data === true)
  })
}

/* ---------- The invited person ----------------------------------------------------------------- */

export async function getPublicGuardianInvite(inviteId: string): Promise<Result<GuardianInvitePreview>> {
  if (isMock()) {
    const invite = getMockGuardianInvite(inviteId)
    if (!invite) return err("NOT_FOUND", "Invite not found.")
    return ok({
      inviteId: invite.id,
      email: invite.email,
      status: invite.status,
      expired: invite.expiresAt < new Date().toISOString(),
      clubName: loadClubProfile().clubName,
      athleteFirstName: mockAthleteName(invite.athleteId).split(" ")[0] ?? "the athlete",
      inviteeName: invite.name,
      relationship: invite.relationship,
      hasExistingAccount: invite.email === MOCK_GUARDIAN_EMAIL || mockEmailStanding(invite.email) !== "new",
    })
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inviteId)) return err("NOT_FOUND", "Invite not found.")
  return attempt(async (supabase) => {
    const { data, error } = await supabase.rpc("get_public_guardian_invite", { p_invite_id: inviteId })
    if (error) return { ok: false, error: mapGuardianError(error) }
    type Row = { invite_id: string; email: string; status: string; expired: boolean; organization_name: string; athlete_first_name: string; invitee_name: string | null; relationship: string; has_existing_account: boolean }
    const row = (Array.isArray(data) ? data[0] : data) as Row | null
    if (!row) return err("NOT_FOUND", "Invite not found.")
    return ok({
      inviteId: row.invite_id,
      email: row.email,
      status: row.status === "accepted" ? "accepted" : row.status === "revoked" ? "revoked" : "pending",
      expired: row.expired === true,
      clubName: row.organization_name,
      athleteFirstName: row.athlete_first_name,
      inviteeName: row.invitee_name,
      relationship: row.relationship,
      hasExistingAccount: row.has_existing_account === true,
    })
  })
}

/** Creates the sign-in for an invited email that has none yet (claim-guardian-invite-account). Public: nobody is signed in. */
export async function claimGuardianInviteAccount(params: { inviteId: string; email: string; password: string; displayName: string }): Promise<Result<null>> {
  if (isMock()) return ok(null)
  return attempt(async (supabase) => {
    // Plain invoke, not invokeSignedIn: there is no sign-in to refresh yet.
    const { data, error } = await supabase.functions.invoke("claim-guardian-invite-account", {
      body: { inviteId: params.inviteId, email: params.email.trim().toLowerCase(), password: params.password, displayName: params.displayName.trim() },
    })
    if (error) {
      let message = "The account could not be created. Try again."
      const response = (error as { context?: unknown }).context
      if (response instanceof Response) {
        try {
          const body = (await response.clone().json()) as { error?: unknown }
          if (typeof body.error === "string" && body.error) message = body.error
        } catch {
          // Not JSON: keep the plain message.
        }
      }
      return err("UNKNOWN", message, error)
    }
    if (data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string") return err("UNKNOWN", (data as { error: string }).error)
    return ok(null)
  })
}

/** The signed-in person accepts the invite sent to their email. Links every open invite the club sent to that email. */
export async function acceptGuardianInvite(inviteId: string, displayName?: string): Promise<Result<null>> {
  if (isMock()) {
    const result = acceptMockGuardianInvite(inviteId, displayName ?? null)
    if (!result.ok) return err("CONFLICT", result.message)
    announce()
    return ok(null)
  }
  return attempt(async (supabase) => {
    const { error } = await supabase.rpc("accept_guardian_invite", { p_invite_id: inviteId })
    if (error) return { ok: false, error: mapGuardianError(error) }
    return ok(null)
  })
}

/** Demo only: who is signed in, so the claim page can tell a signed-in demo guardian from a visitor. */
export function mockSignedInEmail(): string | null {
  return getCookieValue(USER_COOKIE)?.trim().toLowerCase() ?? null
}
