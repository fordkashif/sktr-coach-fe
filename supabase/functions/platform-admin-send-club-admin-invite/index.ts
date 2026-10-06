import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"
import { chooseAppBaseUrl, renderClubApprovalEmail } from "../_shared/club-approval-email.ts"

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

function normalizeRedirectBaseUrl(value: string | null | undefined) {
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

async function sendWithResend(params: { apiKey: string; fromEmail: string; toEmail: string; subject: string; text: string; html: string }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: params.fromEmail,
      to: [params.toEmail],
      reply_to: "support@thesktr.com",
      subject: params.subject,
      text: params.text,
      html: params.html,
    }),
  })

  const payload = await response.json()
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : `Resend request failed with status ${response.status}`
    throw new Error(message)
  }

  return payload as { id?: string }
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
  const resendApiKey = Deno.env.get("RESEND_API_KEY")
  const fromEmail = Deno.env.get("NOTIFICATION_FROM_EMAIL")

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
    request.json() as Promise<InvitePayload>,
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
  // The server's own address wins, so the link in the email is on the app's domain whatever address
  // the platform admin is browsing from.
  const redirectBaseUrl = chooseAppBaseUrl(
    normalizeRedirectBaseUrl(Deno.env.get("PUBLIC_APP_URL")),
    normalizeRedirectBaseUrl(payload.appBaseUrl),
    isLocalOrigin,
  )

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

  if (!redirectBaseUrl) {
    return new Response(JSON.stringify({ error: "Missing app redirect base URL." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if ((!resendApiKey || !fromEmail) && !isLocalOrigin(redirectBaseUrl)) {
    return new Response(JSON.stringify({ error: "Missing invite email provider environment." }), {
      status: 500,
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

  const sentAt = new Date().toISOString()

  if (generateResult.error) {
    await serviceClient
      .from("tenant_provision_requests")
      .update({
        access_invite_last_error: generateResult.error.message,
        access_invite_sent_at: null,
        access_invite_sent_by_user_id: authData.user.id,
      })
      .eq("id", requestId)

    return new Response(JSON.stringify({ error: generateResult.error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const linkData = generateResult.data as GenerateLinkResponse | null
  const tokenHash =
    linkData?.properties?.hashed_token ??
    linkData?.properties?.hashedToken ??
    linkData?.hashed_token ??
    linkData?.hashedToken ??
    null

  if (!tokenHash) {
    return new Response(JSON.stringify({ error: "Auth generateLink did not return a token hash." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const appLink = `${redirectBaseUrl}/club-admin/claim?token_hash=${encodeURIComponent(tokenHash)}&type=${tokenType}`

  if (isLocalOrigin(redirectBaseUrl)) {
    await serviceClient
      .from("tenant_provision_requests")
      .update({
        access_invite_sent_at: sentAt,
        access_invite_sent_by_user_id: authData.user.id,
        access_invite_last_error: null,
      })
      .eq("id", requestId)

    return new Response(JSON.stringify({ sentAt, actionLink: appLink }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const { data: requestRow } = await serviceClient.from("tenant_provision_requests").select("organization_name").eq("id", requestId).maybeSingle()
    const email = renderClubApprovalEmail({
      clubName: (requestRow as { organization_name?: string } | null)?.organization_name ?? null,
      recipientName: requestorName,
      recipientEmail: requestorEmail,
      link: appLink,
    })
    await sendWithResend({ apiKey: resendApiKey!, fromEmail: fromEmail!, toEmail: requestorEmail, subject: email.subject, text: email.text, html: email.html })
  } catch (dispatchError) {
    const message = dispatchError instanceof Error ? dispatchError.message : "Invite email dispatch failed."

    await serviceClient
      .from("tenant_provision_requests")
      .update({
        access_invite_last_error: message,
        access_invite_sent_at: null,
        access_invite_sent_by_user_id: authData.user.id,
      })
      .eq("id", requestId)

    return new Response(JSON.stringify({ error: message }), {
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
