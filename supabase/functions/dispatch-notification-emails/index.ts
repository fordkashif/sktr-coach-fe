import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type DispatchPayload = {
  limit?: number
  eventIds?: string[]
}

type EmailEventRow = {
  id: string
  recipient_user_id: string | null
  recipient_email: string | null
  event_type: string
  subject: string
  body: string | null
  delivery_attempt_count: number
}

async function sendWithResend(params: {
  apiKey: string
  fromEmail: string
  toEmail: string
  subject: string
  body: string | null
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: params.fromEmail,
      to: [params.toEmail],
      subject: params.subject,
      text: params.body ?? params.subject,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5;"><h2>${params.subject}</h2><p>${
        (params.body ?? params.subject).replace(/\n/g, "<br />")
      }</p></div>`,
    }),
  })

  const payload = await response.json()
  if (!response.ok) {
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : `Resend request failed with status ${response.status}`
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

  if (!resendApiKey || !fromEmail) {
    return new Response(JSON.stringify({ error: "Missing notification email provider environment." }), {
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
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const token = authorization.replace(/^Bearer\s+/i, "").trim()
  const [{ data: authData, error: authError }, payload] = await Promise.all([
    serviceClient.auth.getUser(token),
    request.json() as Promise<DispatchPayload>,
  ])

  if (authError || !authData.user) {
    return new Response(JSON.stringify({ error: "Invalid authenticated user." }), {
      status: 401,
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

  const limit = Math.max(1, Math.min(payload.limit ?? 25, 100))
  let query = serviceClient
    .from("notification_events")
    .select("id, recipient_user_id, recipient_email, event_type, subject, body, delivery_attempt_count")
    .eq("channel", "email")
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(limit)

  if (payload.eventIds && payload.eventIds.length > 0) {
    query = query.in("id", payload.eventIds)
  }

  const { data, error } = await query
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const rows = ((data as EmailEventRow[] | null) ?? []).filter((row) => Boolean(row.recipient_email))
  const results: Array<{ id: string; status: "sent" | "failed"; error?: string }> = []

  for (const row of rows) {
    const { data: emailEnabled, error: preferenceError } = await serviceClient.rpc("notification_channel_enabled", {
      p_channel: "email",
      p_event_type: row.event_type,
      p_recipient_user_id: row.recipient_user_id,
      p_recipient_email: row.recipient_email,
    })

    if (preferenceError) {
      await serviceClient
        .from("notification_events")
        .update({
          status: "failed",
          last_error: preferenceError.message,
          processing_started_at: null,
        })
        .eq("id", row.id)

      results.push({ id: row.id, status: "failed", error: preferenceError.message })
      continue
    }

    if (!emailEnabled) {
      await serviceClient
        .from("notification_events")
        .update({
          status: "suppressed",
          last_error: "Suppressed by notification preferences.",
          processing_started_at: null,
        })
        .eq("id", row.id)

      results.push({ id: row.id, status: "sent" })
      continue
    }

    await serviceClient
      .from("notification_events")
      .update({
        processing_started_at: new Date().toISOString(),
        delivery_attempt_count: row.delivery_attempt_count + 1,
        last_error: null,
      })
      .eq("id", row.id)

    try {
      const providerResponse = await sendWithResend({
        apiKey: resendApiKey,
        fromEmail,
        toEmail: row.recipient_email!,
        subject: row.subject,
        body: row.body,
      })

      await serviceClient
        .from("notification_events")
        .update({
          status: "sent",
          delivered_at: new Date().toISOString(),
          last_error: null,
          provider_message_id: providerResponse.id ?? null,
          processing_started_at: null,
        })
        .eq("id", row.id)

      results.push({ id: row.id, status: "sent" })
    } catch (dispatchError) {
      const message = dispatchError instanceof Error ? dispatchError.message : "Unknown email dispatch failure"

      await serviceClient
        .from("notification_events")
        .update({
          status: "failed",
          last_error: message,
          processing_started_at: null,
        })
        .eq("id", row.id)

      results.push({ id: row.id, status: "failed", error: message })
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})
