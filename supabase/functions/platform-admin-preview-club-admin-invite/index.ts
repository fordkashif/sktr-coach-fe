// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type PreviewPayload = {
  requestId?: string
  tenantId?: string
  requestorEmail?: string
  requestorName?: string
  appBaseUrl?: string
}

type GenerateLinkResponse = {
  properties?: {
    hashed_token?: string
    hashedToken?: string
  }
  hashed_token?: string
  hashedToken?: string
}

function isAlreadyRegisteredError(message: string | undefined) {
  return typeof message === "string" && message.toLowerCase().includes("already been registered")
}

function normalizeOrigin(value: string | null | undefined) {
  const candidate = value?.trim()
  if (!candidate) return null

  try {
    return new URL(candidate).origin
  } catch {
    return null
  }
}

function isLocalOrigin(origin: string | null) {
  if (!origin) return false

  try {
    const url = new URL(origin)
    return url.hostname === "localhost" || url.hostname === "127.0.0.1"
  } catch {
    return false
  }
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

  const [{ data: authData, error: authError }, payloadResult] = await Promise.all([
    userClient.auth.getUser(authorization.replace(/^Bearer\s+/i, "")),
    request.json() as Promise<PreviewPayload>,
  ])

  if (authError || !authData.user) {
    console.error("caller check failed:", authError?.message ?? "no user")
    return new Response(JSON.stringify({ error: "Your sign-in could not be confirmed. Sign out, sign in again, then retry." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const payload = payloadResult
  const requestId = payload.requestId?.trim()
  const tenantId = payload.tenantId?.trim()
  const requestorEmail = payload.requestorEmail?.trim().toLowerCase()
  const requestorName = payload.requestorName?.trim()
  const redirectBaseUrl =
    normalizeOrigin(payload.appBaseUrl) ??
    normalizeOrigin(Deno.env.get("PUBLIC_APP_URL"))

  if (!requestId || !tenantId || !requestorEmail || !requestorName || !redirectBaseUrl) {
    return new Response(JSON.stringify({ error: "Missing required payload fields." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (!isLocalOrigin(redirectBaseUrl)) {
    return new Response(JSON.stringify({ error: "Invite preview is only enabled from localhost origins." }), {
      status: 403,
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

  const generateOptions = {
    redirectTo: `${redirectBaseUrl}/login`,
    data: {
      tenant_id: tenantId,
      role: "club-admin",
      display_name: requestorName,
    },
  }

  let tokenType: "invite" | "magiclink" = "invite"
  let generateResult = await serviceClient.auth.admin.generateLink({
    type: tokenType,
    email: requestorEmail,
    options: generateOptions,
  })

  if (generateResult.error && isAlreadyRegisteredError(generateResult.error.message)) {
    tokenType = "magiclink"
    generateResult = await serviceClient.auth.admin.generateLink({
      type: tokenType,
      email: requestorEmail,
      options: generateOptions,
    })
  }

  if (generateResult.error) {
    return new Response(JSON.stringify({ error: generateResult.error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const data = generateResult.data as GenerateLinkResponse | null
  const tokenHash =
    data?.properties?.hashed_token ??
    data?.properties?.hashedToken ??
    data?.hashed_token ??
    data?.hashedToken ??
    null

  if (!tokenHash) {
    return new Response(JSON.stringify({ error: "Auth generateLink did not return a token hash." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const actionLink = `${redirectBaseUrl}/club-admin/claim?token_hash=${encodeURIComponent(tokenHash)}&type=${tokenType}`

  return new Response(JSON.stringify({ actionLink }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})
