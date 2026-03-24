import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"

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
    .select("id, tenant_id, team_id, status, expires_at")
    .eq("id", inviteId)
    .maybeSingle()

  if (inviteError) return json(400, { error: inviteError.message })
  if (!invite) return json(404, { error: "Athlete invite not found." })
  if (invite.status !== "pending") return json(400, { error: "Athlete invite is not pending." })
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return json(400, { error: "Athlete invite has expired." })
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

    const updateResult = await serviceClient.auth.admin.updateUserById(existingUser.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...(existingUser.user_metadata ?? {}),
        display_name: displayName,
        role: "athlete",
        tenant_id: invite.tenant_id,
        team_id: invite.team_id,
      },
    })

    if (updateResult.error) return json(400, { error: updateResult.error.message })
    return json(200, { userId: existingUser.id, mode: "updated" })
  }

  const createResult = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: displayName,
      role: "athlete",
      tenant_id: invite.tenant_id,
      team_id: invite.team_id,
    },
  })

  if (createResult.error) return json(400, { error: createResult.error.message })

  return json(200, { userId: createResult.data.user?.id ?? null, mode: "created" })
})
