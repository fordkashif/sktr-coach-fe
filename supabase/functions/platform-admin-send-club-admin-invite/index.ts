// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type InvitePayload = {
  requestId?: string
  tenantId?: string
  requestorEmail?: string
  requestorName?: string
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase function environment." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const authorization = request.headers.get("Authorization")
  if (!authorization) {
    return new Response(JSON.stringify({ error: "Missing authorization header." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: authorization },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const token = authorization.replace(/^Bearer\s+/i, "").trim()
  const [{ data: authData, error: authError }, payloadResult] = await Promise.all([
    userClient.auth.getUser(token),
    request.json() as Promise<InvitePayload>,
  ])

  if (authError || !authData.user) {
    return new Response(JSON.stringify({ error: "Invalid authenticated user." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const payload = payloadResult
  const requestId = payload.requestId?.trim()
  const tenantId = payload.tenantId?.trim()
  const requestorEmail = payload.requestorEmail?.trim().toLowerCase()
  const requestorName = payload.requestorName?.trim()

  if (!requestId || !tenantId || !requestorEmail || !requestorName) {
    return new Response(JSON.stringify({ error: "Missing required payload fields." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const { data: platformAdminContact, error: platformAdminError } = await userClient
    .from("platform_admin_contacts")
    .select("id")
    .limit(1)
    .maybeSingle()

  if (platformAdminError || !platformAdminContact) {
    return new Response(JSON.stringify({ error: "Current user is not an active platform admin." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const otpClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const otpResult = await otpClient.auth.signInWithOtp({
    email: requestorEmail,
    options: {
      data: {
        tenant_id: tenantId,
        role: "club-admin",
        display_name: requestorName,
      },
    },
  })

  const sentAt = new Date().toISOString()

  if (otpResult.error) {
    await serviceClient
      .from("tenant_provision_requests")
      .update({
        access_invite_last_error: otpResult.error.message,
        access_invite_sent_at: null,
        access_invite_sent_by_user_id: authData.user.id,
      })
      .eq("id", requestId)

    return new Response(JSON.stringify({ error: otpResult.error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  await serviceClient
    .from("tenant_provision_requests")
    .update({
      access_invite_sent_at: sentAt,
      access_invite_sent_by_user_id: authData.user.id,
      access_invite_last_error: null,
    })
    .eq("id", requestId)

  return new Response(JSON.stringify({ sentAt }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})
