import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type PreviewPayload = {
  email?: string
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
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase function environment." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const payload = (await request.json()) as PreviewPayload
  const email = payload.email?.trim().toLowerCase()
  const redirectBaseUrl = normalizeOrigin(payload.appBaseUrl) ?? normalizeOrigin(Deno.env.get("PUBLIC_APP_URL"))

  if (!email || !redirectBaseUrl) {
    return new Response(JSON.stringify({ error: "Missing required payload fields." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (!isLocalOrigin(redirectBaseUrl)) {
    return new Response(JSON.stringify({ error: "Local password reset preview is only enabled from localhost origins." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const generateResult = await serviceClient.auth.admin.generateLink({
    type: "recovery",
    email,
    options: {
      redirectTo: `${redirectBaseUrl}/reset-password`,
    },
  })

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

  const actionLink = `${redirectBaseUrl}/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`

  return new Response(JSON.stringify({ actionLink }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})
