import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { CLUB_ACCESS_PAUSED_CODE, CLUB_ACCESS_PAUSED_MESSAGE, isClubAccessPaused } from "../_shared/club-access.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type ClaimPayload = {
  inviteId?: string
  email?: string
  password?: string
  displayName?: string
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return json(405, { error: "Method not allowed" })

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return json(500, { error: "Missing Supabase function environment." })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const payload = (await request.json()) as ClaimPayload
  const inviteId = payload.inviteId?.trim()
  const email = payload.email?.trim().toLowerCase()
  const password = payload.password?.trim()
  const displayName = payload.displayName?.trim()

  if (!inviteId || !email || !password || !displayName) {
    return json(400, { error: "Missing required payload fields." })
  }

  if (password.length < 8) {
    return json(400, { error: "Password must be at least 8 characters." })
  }

  const { data: invite, error: inviteError } = await serviceClient
    .from("athlete_invites")
    .select("id, tenant_id, team_id, email, status, expires_at")
    .eq("id", inviteId)
    .maybeSingle()

  if (inviteError) return json(400, { error: inviteError.message })
  if (!invite) return json(404, { error: "Athlete invite not found." })
  if (invite.status !== "pending") return json(400, { error: "Athlete invite is not pending." })
  if ((invite.email ?? "").trim().toLowerCase() !== email) {
    return json(400, { error: "This invite is for a different email address." })
  }
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return json(400, { error: "Athlete invite has expired." })
  }

  // A suspended or cancelled club is closed to everyone, so no account is created for its invites.
  // The database refuses to accept such an invite anyway (accept_athlete_invite); this stops one step earlier.
  if (await isClubAccessPaused(serviceClient, invite.tenant_id)) {
    return json(403, { error: CLUB_ACCESS_PAUSED_MESSAGE, code: CLUB_ACCESS_PAUSED_CODE })
  }

  const listUsersResult = await serviceClient.auth.admin.listUsers()
  if (listUsersResult.error) return json(400, { error: listUsersResult.error.message })

  const existingUser = (listUsersResult.data.users ?? []).find(
    (user) => (user.email ?? "").trim().toLowerCase() === email,
  )

  if (existingUser) {
    const { data: existingProfile, error: profileError } = await serviceClient
      .from("profiles")
      .select("tenant_id, role")
      .eq("user_id", existingUser.id)
      .maybeSingle()

    if (profileError) return json(400, { error: profileError.message })
    if (existingProfile && existingProfile.tenant_id !== invite.tenant_id) {
      return json(400, { error: "This email already belongs to another tenant. Sign in with the correct athlete account or use another email." })
    }
    if (existingProfile && existingProfile.role !== "athlete") {
      return json(400, { error: `This email already belongs to a ${existingProfile.role} account, not an athlete account.` })
    }

    // Never change an existing account from here. This function is public and the invite id is known to
    // whoever created the invite, so resetting the password of an existing account (which this branch
    // used to do) let an inviter take over any account that had no profile in another club, including a
    // platform admin's. Someone who already has an account signs in with their own password and then
    // accepts the invite; the database checks the invite against their email.
    return json(409, {
      error: "An account already exists for this email. Sign in with it, then open this invite link again. If you do not know the password, reset it from the sign in page.",
    })
  }

  // This function creates a CONFIRMED account for the invited email on the word of whoever holds the
  // invite link, and the person who created the invite holds it too. That is fine for an email that
  // means nothing elsewhere, but two things in the database are granted by email alone: platform admin
  // access (platform_admin_contacts) and club admin first access (an approved club request). An inviter
  // must not be able to mint an account for such an email, so those are refused here.
  // ilike is used for a case-insensitive exact match, so its wildcards are escaped.
  const emailPattern = email.replace(/[\\%_]/g, "\\$&")
  const [platformContactResult, approvedRequestResult] = await Promise.all([
    serviceClient.from("platform_admin_contacts").select("id").ilike("email", emailPattern).limit(1),
    serviceClient
      .from("tenant_provision_requests")
      .select("id")
      .ilike("requestor_email", emailPattern)
      .eq("status", "approved")
      .limit(1),
  ])

  if (platformContactResult.error) return json(400, { error: platformContactResult.error.message })
  if (approvedRequestResult.error) return json(400, { error: approvedRequestResult.error.message })
  if ((platformContactResult.data ?? []).length > 0 || (approvedRequestResult.data ?? []).length > 0) {
    return json(409, {
      error: "This email already has its own access to SKTR Coach. Sign in with it first, then open this invite link again.",
    })
  }

  const createResult = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // Display name only. Club and role are never read from metadata: accept_athlete_invite takes them
    // from the invite when the new athlete signs in.
    user_metadata: {
      display_name: displayName,
    },
  })

  if (createResult.error) return json(400, { error: createResult.error.message })

  return json(200, { userId: createResult.data.user?.id ?? null, mode: "created" })
})
