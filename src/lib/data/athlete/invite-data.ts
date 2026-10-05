import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { loadMockRoster, mergeMockAthletes, mockAthleteLimit, mockId, updateMockRoster, type MockInvite } from "@/lib/data/coach/roster-mock"
import { INVITE_EMAIL_COLUMNS, isMissingInviteEmailColumns } from "@/lib/data/invites/invite-email-data"
import { isInviteEmail } from "@/lib/data/invites/invite-list"
import { buildPackageLimitError, getTenantPackageUsage } from "@/lib/tenant/package-enforcement"

type ClientResolution =
  | { ok: true; client: SupabaseClient }
  | { ok: false; error: DataError }

type InvitePreview = {
  inviteId: string
  teamId: string
  teamName: string
  eventGroup: string | null
  /** Pending invites past their expiry are reported as expired. */
  status: "pending" | "accepted" | "expired" | "revoked"
  expiresAt: string | null
  /** True when the invite was sent to a different email address than the signed-in athlete's. */
  addressedToSomeoneElse: boolean
}

function requireSupabaseClient(operation: string): ClientResolution {
  if (getBackendMode() !== "supabase") {
    return {
      ok: false,
      error: { code: "UNKNOWN", message: `[${operation}] backend mode is not 'supabase'.` },
    }
  }

  const client = getBrowserSupabaseClient()
  if (!client) {
    return {
      ok: false,
      error: { code: "UNKNOWN", message: `[${operation}] Supabase client is not configured.` },
    }
  }

  return { ok: true, client }
}

export async function createAthleteInviteForCurrentCoach(params: {
  teamId: string
  email: string
  expiresInDays?: number
}): Promise<Result<{ inviteId: string; invitePath: string }>> {
  if (getBackendMode() !== "supabase") {
    const email = params.email.trim().toLowerCase()
    if (!isInviteEmail(email)) return err("VALIDATION", "Enter a valid email address.")
    const days = Math.max(1, Math.min(params.expiresInDays ?? 7, 30))
    const invite = newMockInvite({ teamId: params.teamId, email, name: null, athleteId: null, days })
    try {
      updateMockRoster((state) => ({ ...state, invites: [invite, ...state.invites] }))
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    return ok({ inviteId: invite.id, invitePath: `/athlete/claim/${params.teamId}?token=${invite.id}` })
  }

  const clientResult = requireSupabaseClient("createAthleteInviteForCurrentCoach")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const expiryDays = Math.max(1, Math.min(params.expiresInDays ?? 7, 30))
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()
  const inviteEmail = params.email.trim().toLowerCase()

  if (!inviteEmail) return err("VALIDATION", "Athlete email is required.")

  const { data: profile, error: profileError } = await clientResult.client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()

  if (profileError) return { ok: false, error: mapPostgrestError(profileError) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "coach" && profile.role !== "club-admin") {
    return err("FORBIDDEN", "Only coach or club-admin users can create athlete invites.")
  }

  const packageUsageResult = await getTenantPackageUsage(clientResult.client, profile.tenant_id as string)
  if (!packageUsageResult.ok) return packageUsageResult
  if (
    packageUsageResult.data.packageDefinition &&
    packageUsageResult.data.usage.athletes >= packageUsageResult.data.packageDefinition.limits.athletes
  ) {
    return buildPackageLimitError({
      packageDefinition: packageUsageResult.data.packageDefinition,
      resourceLabel: "athletes",
    })
  }

  const { data, error } = await clientResult.client
    .from("athlete_invites")
    .insert({
      tenant_id: profile.tenant_id,
      team_id: params.teamId,
      email: inviteEmail,
      invited_by_user_id: userId,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok({
    inviteId: data.id,
    invitePath: `/athlete/claim/${data.id}`,
  })
}

type InvitePreviewRow = {
  invite_id: string
  team_id: string
  team_name: string | null
  event_group: string | null
  status: InvitePreview["status"]
  expires_at: string | null
  is_for_caller: boolean | null
}

function toInvitePreview(row: {
  id: string
  teamId: string
  teamName: string | null
  eventGroup: string | null
  status: InvitePreview["status"]
  expiresAt: string | null
  addressedToSomeoneElse: boolean
}): InvitePreview {
  const isPastExpiry = row.status === "pending" && row.expiresAt !== null && new Date(row.expiresAt).getTime() < Date.now()
  return {
    inviteId: row.id,
    teamId: row.teamId,
    teamName: row.teamName ?? "Team",
    eventGroup: row.eventGroup,
    status: isPastExpiry ? "expired" : row.status,
    expiresAt: row.expiresAt,
    addressedToSomeoneElse: row.addressedToSomeoneElse,
  }
}

/** PostgREST and Postgres codes for "this function does not exist (yet)". */
function isMissingFunction(error: { code?: string } | null) {
  return error?.code === "PGRST202" || error?.code === "42883"
}

/**
 * What the join screen shows for an invite code. Athletes cannot read athlete_invites or other
 * teams any more (migration 20261006150000), so this goes through get_athlete_invite_preview().
 * The direct read below only runs against a database that does not have that function yet.
 */
export async function getAthleteInvitePreviewForCurrentUser(inviteId: string): Promise<Result<InvitePreview>> {
  const clientResult = requireSupabaseClient("getAthleteInvitePreviewForCurrentUser")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const preview = await clientResult.client.rpc("get_athlete_invite_preview", { p_invite_id: inviteId })
  if (!isMissingFunction(preview.error)) {
    if (preview.error) return { ok: false, error: mapPostgrestError(preview.error) }
    const row = (Array.isArray(preview.data) ? preview.data[0] : preview.data) as InvitePreviewRow | null | undefined
    if (!row) return err("NOT_FOUND", "Invite not found.")
    return ok(
      toInvitePreview({
        id: row.invite_id,
        teamId: row.team_id,
        teamName: row.team_name,
        eventGroup: row.event_group ?? null,
        status: row.status,
        expiresAt: row.expires_at ?? null,
        addressedToSomeoneElse: row.is_for_caller === false,
      }),
    )
  }

  const { data: profile, error: profileError } = await clientResult.client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()

  if (profileError) return { ok: false, error: mapPostgrestError(profileError) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")

  const { data, error } = await clientResult.client
    .from("athlete_invites")
    .select("id, team_id, status, expires_at, teams(name, event_group)")
    .eq("id", inviteId)
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return err("NOT_FOUND", "Invite not found.")

  const team = Array.isArray(data.teams) ? data.teams[0] : data.teams
  return ok(
    toInvitePreview({
      id: data.id,
      teamId: data.team_id,
      teamName: team?.name ?? null,
      eventGroup: team?.event_group ?? null,
      status: data.status,
      expiresAt: (data.expires_at as string | null) ?? null,
      addressedToSomeoneElse: false,
    }),
  )
}

export async function acceptAthleteInviteForCurrentUser(inviteId: string): Promise<Result<void>> {
  const clientResult = requireSupabaseClient("acceptAthleteInviteForCurrentUser")
  if (!clientResult.ok) return clientResult

  const { error } = await clientResult.client.rpc("accept_athlete_invite", {
    p_invite_id: inviteId,
  })

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(undefined)
}

export type AthleteInviteStatus = "pending" | "accepted" | "expired" | "revoked"

export type TeamAthleteInvite = {
  id: string
  email: string
  status: AthleteInviteStatus
  createdAt: string
  expiresAt: string | null
  invitePath: string
  /** When the invite email last went out. Null or missing means it has not been emailed. */
  emailSentAt?: string | null
  emailSendCount?: number
  /** Machine code of the last failed email attempt. */
  emailError?: string | null
  /** The name the coach typed for this person, when they did. */
  name?: string | null
  /** Set on a "give them a login" invite: the athlete without a login this invite is for. */
  forAthleteId?: string | null
}

function newMockInvite(params: { teamId: string; email: string; name: string | null; athleteId: string | null; days: number }): MockInvite {
  return {
    id: mockId("inv"),
    teamId: params.teamId,
    email: params.email,
    name: params.name,
    athleteId: params.athleteId,
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + params.days * 24 * 60 * 60 * 1000).toISOString(),
    emailSentAt: null,
    emailSendCount: 0,
    emailError: null,
  }
}

function fromMockInvite(invite: MockInvite): TeamAthleteInvite {
  const expired = invite.status === "pending" && invite.expiresAt !== null && new Date(invite.expiresAt).getTime() < Date.now()
  return {
    id: invite.id,
    email: invite.email,
    status: expired ? "expired" : invite.status,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    invitePath: `/athlete/claim/${invite.teamId}?token=${invite.id}`,
    emailSentAt: invite.emailSentAt,
    emailSendCount: invite.emailSendCount,
    emailError: invite.emailError,
    name: invite.name,
    forAthleteId: invite.athleteId,
  }
}

/** Mock mode: remember what the (simulated) email send did, so the invite list shows it after a reload. */
export function recordMockInviteEmail(inviteId: string, sent: { sentAt: string } | { error: string }) {
  if (getBackendMode() === "supabase") return
  try {
    updateMockRoster((state) => ({
      ...state,
      invites: state.invites.map((invite) =>
        invite.id !== inviteId
          ? invite
          : "sentAt" in sent
            ? { ...invite, emailSentAt: sent.sentAt, emailSendCount: invite.emailSendCount + 1, emailError: null }
            : { ...invite, emailError: sent.error },
      ),
    }))
  } catch {
    // The list still shows the outcome for this visit.
  }
}

/** Invites issued for one team, newest first. Pending invites past their expiry are reported as expired. */
export async function getAthleteInvitesForTeam(teamId: string): Promise<Result<TeamAthleteInvite[]>> {
  if (getBackendMode() !== "supabase") {
    return ok(
      loadMockRoster()
        .invites.filter((invite) => invite.teamId === teamId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(fromMockInvite),
    )
  }

  const clientResult = requireSupabaseClient("getAthleteInvitesForTeam")
  if (!clientResult.ok) return clientResult

  const selectInvites = (columns: string) =>
    clientResult.client.from("athlete_invites").select(columns).eq("team_id", teamId).order("created_at", { ascending: false }).limit(500)
  const baseColumns = "id, email, status, created_at, expires_at"

  // Columns arrive with migrations (email delivery, then name and athlete link). Until each has run, still show the invites.
  let attempt = await selectInvites(`${baseColumns}, ${INVITE_EMAIL_COLUMNS}, invitee_name, athlete_id`)
  if (attempt.error && /invitee_name|athlete_id/.test(attempt.error.message ?? "")) attempt = await selectInvites(`${baseColumns}, ${INVITE_EMAIL_COLUMNS}`)
  const { data, error } = isMissingInviteEmailColumns(attempt.error) ? await selectInvites(baseColumns) : attempt

  if (error) return { ok: false, error: mapPostgrestError(error) }

  const now = Date.now()
  return ok(
    ((data as unknown as Array<{
      id: string
      email: string | null
      status: AthleteInviteStatus
      created_at: string
      expires_at: string | null
      last_email_sent_at?: string | null
      email_send_count?: number | null
      last_email_error?: string | null
      invitee_name?: string | null
      athlete_id?: string | null
    }> | null) ?? []).map((row) => ({
      name: row.invitee_name ?? null,
      forAthleteId: row.athlete_id ?? null,
      id: row.id,
      email: row.email ?? "",
      status:
        row.status === "pending" && row.expires_at && new Date(row.expires_at).getTime() < now ? "expired" : row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      invitePath: `/athlete/claim/${row.id}`,
      emailSentAt: row.last_email_sent_at ?? null,
      emailSendCount: row.email_send_count ?? 0,
      emailError: row.last_email_error ?? null,
    })),
  )
}

/** Cancels a pending invite so its link stops working. */
export async function revokeAthleteInviteForCurrentCoach(inviteId: string): Promise<Result<void>> {
  if (getBackendMode() !== "supabase") {
    try {
      updateMockRoster((state) => ({
        ...state,
        invites: state.invites.map((invite) => (invite.id === inviteId && invite.status === "pending" ? { ...invite, status: "revoked" } : invite)),
      }))
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    return ok(undefined)
  }

  const clientResult = requireSupabaseClient("revokeAthleteInviteForCurrentCoach")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client
    .from("athlete_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("status", "pending")
    .select("id")

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) return err("NOT_FOUND", "This invite is no longer pending.")
  return ok(undefined)
}

/* ---------- Many invites at once ------------------------------------------------------------------ */

/**
 * What the database says about one line of a pasted list.
 *   ok             can be invited (preview)            created      the invite now exists (create)
 *   invalid        not an email address                duplicate    same email earlier in the list
 *   on_team        already an athlete of this team     invited      already has a waiting invite to this team
 *   staff_account  a coach or club admin of this club  over_limit   the club has no athlete seat left for it
 */
export type InviteLineStatus = "ok" | "created" | "invalid" | "duplicate" | "on_team" | "invited" | "staff_account" | "over_limit"

export type InviteLineResult = {
  /** Position in the list that was sent, starting at 1. */
  lineNo: number
  email: string
  status: InviteLineStatus
  inviteId: string | null
  invitePath: string | null
}

export type InviteEntry = { email: string; name: string | null }

const INVITE_LINE_STATUSES: InviteLineStatus[] = ["ok", "created", "invalid", "duplicate", "on_team", "invited", "staff_account", "over_limit"]

function toLineStatus(value: unknown): InviteLineStatus {
  return INVITE_LINE_STATUSES.includes(value as InviteLineStatus) ? (value as InviteLineStatus) : "invalid"
}

/** Demo accounts of mock mode, so the preview can show "already on the team" and "staff account". */
const MOCK_STAFF_EMAILS = ["coach@pacelab.local", "clubadmin@pacelab.local", "platformadmin@pacelab.local"]

function mockAthleteEmail(athlete: { id: string; name: string }) {
  return athlete.id === "a1" ? "athlete@pacelab.local" : `${athlete.name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@pacelab.local`
}

async function mockProcessInvites(teamId: string, entries: InviteEntry[], days: number, dryRun: boolean): Promise<Result<InviteLineResult[]>> {
  const module = await import("@/lib/mock-data")
  const state = loadMockRoster()
  const athletes = mergeMockAthletes(module.mockAthletes, state).filter((athlete) => athlete.hasLogin)
  const pending = state.invites.filter((invite) => invite.status === "pending" && (invite.expiresAt === null || new Date(invite.expiresAt).getTime() >= Date.now()))
  let seatsLeft = mockAthleteLimit() - mergeMockAthletes(module.mockAthletes, state).length - pending.filter((invite) => !invite.athleteId).length
  const seen = new Set<string>()
  const created: MockInvite[] = []

  const results = entries.map((entry, index): InviteLineResult => {
    const email = entry.email.trim().toLowerCase()
    const existing = athletes.find((athlete) => mockAthleteEmail(athlete) === email)
    let status: InviteLineStatus
    if (!isInviteEmail(email)) status = "invalid"
    else if (seen.has(email)) status = "duplicate"
    else if (MOCK_STAFF_EMAILS.includes(email)) status = "staff_account"
    else if (existing?.teamId === teamId) status = "on_team"
    else if (pending.some((invite) => invite.teamId === teamId && invite.email === email)) status = "invited"
    else if (!existing && seatsLeft <= 0) status = "over_limit"
    else status = "ok"

    let inviteId: string | null = null
    if (status === "ok") {
      seen.add(email)
      if (!existing) seatsLeft -= 1
      if (!dryRun) {
        const invite = newMockInvite({ teamId, email, name: entry.name, athleteId: null, days })
        created.push(invite)
        inviteId = invite.id
        status = "created"
      }
    }
    return { lineNo: index + 1, email, status, inviteId, invitePath: inviteId ? `/athlete/claim/${teamId}?token=${inviteId}` : null }
  })

  if (created.length > 0) {
    try {
      updateMockRoster((current) => ({ ...current, invites: [...created, ...current.invites] }))
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
  }
  return ok(results)
}

function mapLineRows(rows: unknown): InviteLineResult[] {
  return ((rows as Array<{ line_no: number; email: string | null; status: string; invite_id?: string | null }> | null) ?? []).map((row) => ({
    lineNo: row.line_no,
    email: row.email ?? "",
    status: toLineStatus(row.status),
    inviteId: row.invite_id ?? null,
    invitePath: row.invite_id ? `/athlete/claim/${row.invite_id}` : null,
  }))
}

/** A coach function refusal carries a sentence written for the coach; keep it. */
function bulkError(error: { code?: string; message: string; hint?: string }): DataError {
  const mapped = mapPostgrestError(error as Parameters<typeof mapPostgrestError>[0])
  if ((error.code === "42501" || error.code === "22023") && error.hint !== "access_paused" && !/row-level security|permission denied/i.test(error.message)) {
    return { code: error.code === "42501" ? "FORBIDDEN" : "VALIDATION", message: error.message, cause: error }
  }
  return mapped
}

/**
 * Asks the database what would happen to each line, without creating anything. The answer comes
 * back in the order the entries were given (lineNo is the position in `entries`, from 1).
 */
export async function previewAthleteInvites(teamId: string, entries: InviteEntry[]): Promise<Result<InviteLineResult[]>> {
  if (entries.length === 0) return ok([])
  if (getBackendMode() !== "supabase") return mockProcessInvites(teamId, entries, 7, true)
  const clientResult = requireSupabaseClient("previewAthleteInvites")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("preview_athlete_invites", { p_team_id: teamId, p_entries: entries })
  if (error) return { ok: false, error: bulkError(error) }
  return ok(mapLineRows(data))
}

/**
 * Creates an invite for every line that can have one and reports every line. Nothing is emailed
 * here: send the created invites with sendInviteEmails() afterwards.
 */
export async function createAthleteInvites(teamId: string, entries: InviteEntry[], expiresInDays = 7): Promise<Result<InviteLineResult[]>> {
  if (entries.length === 0) return ok([])
  const days = Math.max(1, Math.min(expiresInDays, 30))
  if (getBackendMode() !== "supabase") return mockProcessInvites(teamId, entries, days, false)
  const clientResult = requireSupabaseClient("createAthleteInvites")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("create_athlete_invites", { p_team_id: teamId, p_entries: entries, p_expires_in_days: days })
  if (error) return { ok: false, error: bulkError(error) }
  return ok(mapLineRows(data))
}

/**
 * "Give them a login": invites an email address to take over the record of an athlete who has no
 * login. When the invite is accepted the new account is linked to that same record, history and all.
 */
export async function createAthleteLoginInvite(params: {
  athleteId: string
  teamId: string
  athleteName: string
  email: string
  expiresInDays?: number
}): Promise<Result<{ inviteId: string; invitePath: string }>> {
  const email = params.email.trim().toLowerCase()
  if (!isInviteEmail(email)) return err("VALIDATION", "Enter a valid email address.")
  const days = Math.max(1, Math.min(params.expiresInDays ?? 7, 30))

  if (getBackendMode() !== "supabase") {
    if (MOCK_STAFF_EMAILS.includes(email) || email === "athlete@pacelab.local") {
      return err("VALIDATION", "This email already belongs to someone in your club. Use an email address that has no SKTR Coach account yet.")
    }
    const invite = newMockInvite({ teamId: params.teamId, email, name: params.athleteName, athleteId: params.athleteId, days })
    try {
      updateMockRoster((state) => ({
        ...state,
        invites: [invite, ...state.invites.map((item) => (item.athleteId === params.athleteId && item.status === "pending" ? { ...item, status: "revoked" as const } : item))],
      }))
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
    return ok({ inviteId: invite.id, invitePath: `/athlete/claim/${params.teamId}?token=${invite.id}` })
  }

  const clientResult = requireSupabaseClient("createAthleteLoginInvite")
  if (!clientResult.ok) return clientResult
  const { data, error } = await clientResult.client.rpc("create_athlete_login_invite", {
    p_athlete_id: params.athleteId,
    p_email: email,
    p_expires_in_days: days,
  })
  if (error) return { ok: false, error: bulkError(error) }
  return ok({ inviteId: data as string, invitePath: `/athlete/claim/${data as string}` })
}
