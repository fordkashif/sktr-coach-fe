// HTTP handler for claim-guardian-invite-account. Public: the invited parent or guardian is not signed
// in yet. It creates a CONFIRMED sign-in for the invited email on the word of whoever holds the invite
// link, and nothing else: the guardian profile and the link to the athlete are made by the database
// (accept_guardian_invite) when the new person signs in.
//
// Everything from the outside world is passed in, so the flow is tested without a network.

import { CLUB_ACCESS_PAUSED_CODE, CLUB_ACCESS_PAUSED_MESSAGE, isClubAccessPaused } from "../_shared/club-access.ts"

// The Supabase client is used structurally so tests can pass a small fake.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any

export type ClaimHandlerDeps = {
  getEnv: (name: string) => string | undefined
  createServiceClient: (supabaseUrl: string, serviceRoleKey: string) => LooseClient
  now: () => Date
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const EXISTING_ACCOUNT_MESSAGE =
  "An account already exists for this email. Sign in with it, then open this invite link again. If you do not know the password, reset it from the sign in page."
export const ROLE_MIXING_MESSAGE =
  "This email already has a coach, admin or athlete account. A guardian needs their own email address. Ask the club to invite a different email."

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })
}

export async function handleClaimGuardianInvite(request: Request, deps: ClaimHandlerDeps): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return json(405, { error: "Method not allowed" })

  const supabaseUrl = deps.getEnv("SUPABASE_URL")
  const serviceRoleKey = deps.getEnv("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Missing Supabase function environment." })

  let payload: Record<string, unknown> = {}
  try {
    payload = ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    payload = {}
  }
  const inviteId = typeof payload.inviteId === "string" ? payload.inviteId.trim().toLowerCase() : ""
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : ""
  const password = typeof payload.password === "string" ? payload.password : ""
  const displayName = typeof payload.displayName === "string" ? payload.displayName.replace(/\s+/g, " ").trim().slice(0, 120) : ""

  if (!UUID_PATTERN.test(inviteId) || !email || !password || !displayName) return json(400, { error: "Missing required payload fields." })
  if (password.length < 8) return json(400, { error: "Password must be at least 8 characters." })

  const serviceClient = deps.createServiceClient(supabaseUrl, serviceRoleKey)

  const { data: invite, error: inviteError } = await serviceClient
    .from("guardian_invites")
    .select("id, email, tenant_id, status, expires_at")
    .eq("id", inviteId)
    .maybeSingle()

  if (inviteError) return json(400, { error: "This invite could not be read. Try again." })
  if (!invite) return json(404, { error: "Invite not found." })
  if (invite.status !== "pending") return json(400, { error: "This invite is no longer open. Ask the club for a new one." })
  if ((invite.email ?? "").trim().toLowerCase() !== email) return json(400, { error: "This invite is for a different email address." })
  if (invite.expires_at && new Date(invite.expires_at).getTime() < deps.now().getTime()) {
    return json(400, { error: "This invite has expired. Ask the club for a new one." })
  }

  // A paused or closed club is closed to everyone. accept_guardian_invite refuses too; this stops earlier.
  if (await isClubAccessPaused(serviceClient, invite.tenant_id)) {
    return json(403, { error: CLUB_ACCESS_PAUSED_MESSAGE, code: CLUB_ACCESS_PAUSED_CODE })
  }

  // The database knows what this email already is: a coach, admin, athlete, platform admin or the
  // requestor of an approved club (all refused: no mixing of roles), an existing account (never
  // touched from here: this function is public), or nothing. If the question cannot be answered,
  // no account is created.
  const { data: standingData, error: standingError } = await serviceClient.rpc("guardian_email_standing", {
    p_tenant_id: invite.tenant_id,
    p_email: email,
  })
  if (standingError) return json(503, { error: "The invite could not be checked right now. Try again in a moment." })
  const standing = (Array.isArray(standingData) ? standingData[0] : standingData) as { standing?: string; found_user_id?: string | null } | null
  if (!standing || typeof standing.standing !== "string") {
    return json(503, { error: "The invite could not be checked right now. Try again in a moment." })
  }
  if (standing.standing === "has_role" || standing.standing === "other_club") {
    return json(409, { error: ROLE_MIXING_MESSAGE, code: "role_mixing" })
  }
  if (standing.found_user_id) {
    return json(409, { error: EXISTING_ACCOUNT_MESSAGE, code: "existing_account" })
  }

  const createResult = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // Display name only. Club and role are never read from metadata.
    user_metadata: { display_name: displayName },
  })
  if (createResult.error) {
    const message = String(createResult.error.message ?? "")
    if (/already|registered|exists/i.test(message)) return json(409, { error: EXISTING_ACCOUNT_MESSAGE, code: "existing_account" })
    return json(400, { error: "The account could not be created. Try again." })
  }

  return json(200, { userId: createResult.data?.user?.id ?? null, mode: "created" })
}
