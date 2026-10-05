// HTTP handler for send-invite-email. Everything it touches from the outside world (environment,
// Supabase clients, fetch, the clock) is passed in, so the whole flow can be exercised without a
// network. index.ts wires in the real things.

import {
  APP_NAME,
  buildClaimLink,
  canSendInvite,
  checkInviteSendable,
  checkRateLimit,
  cleanName,
  describeNotSendable,
  isLocalBaseUrl,
  MAX_SENDS_PER_INVITE,
  MAX_INVITES_PER_BATCH,
  normalizeAppBaseUrl,
  parseInviteBatchPayload,
  parseInvitePayload,
  renderInviteEmail,
  RESEND_COOLDOWN_SECONDS,
  type InviteEmailErrorCode,
  type InviteKind,
} from "./invite-email.ts"

// The Supabase client is used structurally so tests can pass a small fake.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any

export type HandlerDeps = {
  getEnv: (name: string) => string | undefined
  /** Client that carries the caller's JWT: used only to identify the caller and ask the database what they may do. */
  createUserClient: (supabaseUrl: string, anonKey: string, authorization: string) => LooseClient
  /** Service role client: reads the invite and records the send. Never returned to the caller. */
  createServiceClient: (supabaseUrl: string, serviceRoleKey: string) => LooseClient
  fetch: typeof fetch
  now: () => Date
  /** Pause between two provider calls of one batch. Left out in tests, where nothing waits. */
  sleep?: (milliseconds: number) => Promise<void>
}

/** A batch sends one email at a time with this pause in between, so the email provider is never flooded. */
export const BATCH_PAUSE_MS = 600

type InviteRow = {
  id: string
  tenant_id: string
  team_id: string | null
  email: string | null
  status: string
  expires_at: string | null
  email_send_count: number | null
  last_email_attempt_at: string | null
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  })
}

function fail(
  status: number,
  code: InviteEmailErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {},
) {
  return json(status, { ok: false, code, error: message, ...extra }, extraHeaders)
}

const INVITE_COLUMNS = "id, tenant_id, team_id, email, status, expires_at, email_send_count, last_email_attempt_at"
const NOT_ALLOWED_MESSAGE = "You are not allowed to send this invite."

export async function handleSendInviteEmail(request: Request, deps: HandlerDeps): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return fail(405, "method_not_allowed", "Method not allowed.")

  const supabaseUrl = deps.getEnv("SUPABASE_URL")
  const supabaseAnonKey = deps.getEnv("SUPABASE_ANON_KEY")
  const supabaseServiceRoleKey = deps.getEnv("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return fail(500, "server_misconfigured", "Missing Supabase function environment.")
  }

  const authorization = request.headers.get("Authorization")
  if (!authorization) return fail(401, "not_authenticated", "Sign in to send invites.")

  let rawPayload: unknown = null
  try {
    rawPayload = await request.json()
  } catch {
    rawPayload = null
  }
  // Only kind and inviteId (or inviteIds) are read. Anything else the caller sends (an origin, an email, a link)
  // is ignored: the recipient comes from the invite row and the link from the server-side PUBLIC_APP_URL.
  //
  // Batch mode: { kind, inviteIds: [...] } sends up to MAX_INVITES_PER_BATCH invites in one call. The caller is
  // identified once; after that EVERY invite goes through exactly the same steps as a single send (club and
  // team permission, still pending, opt-out, per-invite cooldown and maximum, the send slot, the audit event),
  // one after the other. The answer lists what happened to each invite.
  const isBatch = Boolean(rawPayload && typeof rawPayload === "object" && "inviteIds" in (rawPayload as Record<string, unknown>))
  const batch = isBatch ? parseInviteBatchPayload(rawPayload) : null
  const single = isBatch ? null : parseInvitePayload(rawPayload)
  if (isBatch && !batch) {
    return fail(400, "invalid_request", `Expected { kind: 'coach' | 'athlete', inviteIds: 1 to ${MAX_INVITES_PER_BATCH} invite ids }.`)
  }
  if (!isBatch && !single) return fail(400, "invalid_request", "Expected { kind: 'coach' | 'athlete', inviteId }.")
  const kind: InviteKind = (batch ?? single)!.kind

  const userClient = deps.createUserClient(supabaseUrl, supabaseAnonKey, authorization)
  const serviceClient = deps.createServiceClient(supabaseUrl, supabaseServiceRoleKey)

  const { data: authData, error: authError } = await userClient.auth.getUser()
  const caller = authData?.user ?? null
  if (authError || !caller) return fail(401, "not_authenticated", "Sign in to send invites.")

  // Ask the database, as the caller, the same questions the RLS insert policies ask.
  const [tenantResult, clubAdminResult] = await Promise.all([
    userClient.rpc("current_tenant_id"),
    userClient.rpc("is_club_admin"),
  ])
  if (tenantResult.error || clubAdminResult.error) {
    return fail(403, "not_allowed", NOT_ALLOWED_MESSAGE)
  }
  const callerTenantId = typeof tenantResult.data === "string" ? tenantResult.data : null
  const callerIsClubAdmin = clubAdminResult.data === true

  const table = kind === "coach" ? "coach_invites" : "athlete_invites"
  // is_team_coach() is asked once per team in a batch.
  const teamCoachAnswers = new Map<string, boolean>()
  let providerCalls = 0

  const sendOne = async (payload: { kind: InviteKind; inviteId: string }): Promise<Response> => {
  const { data: inviteData, error: inviteError } = await serviceClient
    .from(table)
    .select(INVITE_COLUMNS)
    .eq("id", payload.inviteId)
    .maybeSingle()
  const invite = (inviteData as InviteRow | null) ?? null

  // A coach may only send the athlete invites of a team they are assigned to. The question is only asked
  // once the invite is known to be in the caller's own club, and any failure to get an answer counts as no.
  let callerIsTeamCoach = false
  if (
    payload.kind === "athlete" &&
    !inviteError &&
    invite &&
    invite.team_id &&
    !callerIsClubAdmin &&
    callerTenantId !== null &&
    callerTenantId === invite.tenant_id
  ) {
    const known = teamCoachAnswers.get(invite.team_id)
    if (known !== undefined) {
      callerIsTeamCoach = known
    } else {
      const teamCoachResult = await userClient.rpc("is_team_coach", { p_team_id: invite.team_id })
      callerIsTeamCoach = !teamCoachResult.error && teamCoachResult.data === true
      teamCoachAnswers.set(invite.team_id, callerIsTeamCoach)
    }
  }

  // A missing invite, an invite of another club and an invite of a team the coach is not assigned to all
  // get the same answer, so the function cannot be used to find out which invite ids exist.
  if (
    inviteError ||
    !invite ||
    !canSendInvite({
      kind: payload.kind,
      callerTenantId,
      callerIsClubAdmin,
      callerIsTeamCoach,
      inviteTenantId: invite.tenant_id,
    })
  ) {
    return fail(403, "not_allowed", NOT_ALLOWED_MESSAGE)
  }

  const nowMs = deps.now().getTime()
  const sendable = checkInviteSendable(invite, nowMs)
  if (!sendable.sendable) {
    return fail(409, "invite_not_sendable", describeNotSendable(sendable.reason), { reason: sendable.reason })
  }
  const recipientEmail = (invite.email as string).trim().toLowerCase()

  const recordError = (code: string) =>
    serviceClient.from(table).update({ last_email_error: code }).eq("id", invite.id)

  const appBaseUrl = normalizeAppBaseUrl(deps.getEnv("PUBLIC_APP_URL"))
  const resendApiKey = deps.getEnv("RESEND_API_KEY")
  const fromEmail = deps.getEnv("NOTIFICATION_FROM_EMAIL")
  const providerConfigured = Boolean(resendApiKey && fromEmail)
  // Local preview: a local stack whose app URL is localhost and has no email provider. Nothing is sent.
  const isLocalPreview = !providerConfigured && isLocalBaseUrl(appBaseUrl)

  if (!appBaseUrl || (!providerConfigured && !isLocalPreview)) {
    await recordError("email_not_configured")
    return fail(503, "email_not_configured", "Email sending is not set up for this environment yet.", {
      missing: [
        ...(appBaseUrl ? [] : ["PUBLIC_APP_URL"]),
        ...(resendApiKey ? [] : ["RESEND_API_KEY"]),
        ...(fromEmail ? [] : ["NOTIFICATION_FROM_EMAIL"]),
      ],
    })
  }

  // Same preference check dispatch-notification-emails uses. With no user id it matches by email only,
  // and it answers "enabled" when no preference row exists, so a brand new address is never suppressed.
  // It only says no when the owner of that address has turned email off themselves.
  const eventType = payload.kind === "coach" ? "coach_invite_created" : "athlete_invite_created"
  const { data: emailEnabled, error: preferenceError } = await serviceClient.rpc("notification_channel_enabled", {
    p_channel: "email",
    p_event_type: eventType,
    p_recipient_user_id: null,
    p_recipient_email: recipientEmail,
  })
  // If the preference lookup itself fails the invite still goes out: someone asked for this one email by hand.
  if (!preferenceError && emailEnabled === false) {
    await recordError("recipient_opted_out")
    return fail(409, "recipient_opted_out", "This person has turned off emails from SKTR Coach. Share the invite link with them directly.")
  }

  const rateLimitResponse = (decision: { reason: "cooldown"; retryAfterSeconds: number } | { reason: "max_sends" }) =>
    decision.reason === "max_sends"
      ? fail(429, "rate_limited", `This invite has already been emailed ${MAX_SENDS_PER_INVITE} times. Cancel it and create a new invite to send again.`, {
          reason: "max_sends",
          maxSends: MAX_SENDS_PER_INVITE,
        })
      : fail(
          429,
          "rate_limited",
          `This invite was emailed a moment ago. Try again in ${decision.retryAfterSeconds} seconds.`,
          { reason: "cooldown", retryAfterSeconds: decision.retryAfterSeconds },
          { "Retry-After": String(decision.retryAfterSeconds) },
        )

  const rateLimit = checkRateLimit(invite, nowMs)
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit)

  // Take the send slot with one conditional update, so two requests at the same moment cannot both send.
  const attemptAt = new Date(nowMs).toISOString()
  const cooldownCutoff = new Date(nowMs - RESEND_COOLDOWN_SECONDS * 1000).toISOString()
  const { data: claimed, error: claimError } = await serviceClient
    .from(table)
    .update({ last_email_attempt_at: attemptAt })
    .eq("id", invite.id)
    .eq("status", "pending")
    .lt("email_send_count", MAX_SENDS_PER_INVITE)
    .or(`last_email_attempt_at.is.null,last_email_attempt_at.lt."${cooldownCutoff}"`)
    .select("id, email_send_count")
  if (claimError) return fail(502, "provider_failure", "The invite email could not be sent. Try again.")
  const claimedRow = ((claimed as Array<{ id: string; email_send_count: number | null }> | null) ?? [])[0]
  if (!claimedRow) return rateLimitResponse({ reason: "cooldown", retryAfterSeconds: RESEND_COOLDOWN_SECONDS })
  const previousSendCount = claimedRow.email_send_count ?? 0

  const [tenantRow, teamRow, inviterRow] = await Promise.all([
    serviceClient.from("tenants").select("name").eq("id", invite.tenant_id).maybeSingle(),
    invite.team_id
      ? serviceClient.from("teams").select("name").eq("id", invite.team_id).maybeSingle()
      : Promise.resolve({ data: null }),
    serviceClient.from("profiles").select("display_name, role").eq("user_id", caller.id).maybeSingle(),
  ])
  const clubName = cleanName((tenantRow.data as { name?: string } | null)?.name) || null
  const teamName = cleanName((teamRow.data as { name?: string } | null)?.name) || null
  const inviterName = cleanName((inviterRow.data as { display_name?: string } | null)?.display_name) || null
  const callerRole = (inviterRow.data as { role?: string } | null)?.role ?? null

  const claimLink = buildClaimLink(appBaseUrl, payload.kind, invite.id)
  const email = renderInviteEmail({
    kind: payload.kind,
    recipientEmail,
    inviterName,
    clubName,
    teamName,
    claimLink,
    expiresAt: invite.expires_at,
  })

  const audit = (action: string, detail: string) =>
    serviceClient.from("audit_events").insert({
      tenant_id: invite.tenant_id,
      actor_user_id: caller.id,
      actor_role: callerRole,
      action,
      target: recipientEmail,
      detail,
    })
  const inviteLabel = `${payload.kind} invite ${invite.id}${teamName ? `, team ${teamName}` : ""}`

  let providerMessageId: string | null = null
  if (!isLocalPreview) {
    let providerError: string | null = null
    // Second and later emails of a batch wait a moment first.
    if (providerCalls > 0 && deps.sleep) await deps.sleep(BATCH_PAUSE_MS)
    providerCalls += 1
    try {
      const response = await deps.fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail!.includes("<") ? fromEmail : `${APP_NAME} <${fromEmail}>`,
          to: [recipientEmail],
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
      })
      const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null
      if (!response.ok) {
        providerError = typeof body?.message === "string" ? body.message : `Resend request failed with status ${response.status}`
      } else {
        providerMessageId = body?.id ?? null
      }
    } catch (error) {
      providerError = error instanceof Error ? error.message : "Email provider request failed."
    }

    if (providerError) {
      // Give the slot back so the inviter can try again straight away: nothing reached the recipient.
      await serviceClient
        .from(table)
        .update({ last_email_attempt_at: invite.last_email_attempt_at, last_email_error: "provider_failure" })
        .eq("id", invite.id)
      // The provider's own wording goes to the club's audit log, not back to the browser.
      await audit(`${payload.kind}_invite_email_failed`, `${inviteLabel}: ${cleanName(providerError, 300)}`)
      return fail(502, "provider_failure", "The email provider did not accept the invite email. Try again in a moment.")
    }
  }

  const sentAt = deps.now().toISOString()
  const sendCount = previousSendCount + 1
  await serviceClient
    .from(table)
    .update({ last_email_sent_at: sentAt, email_send_count: sendCount, last_email_error: null })
    .eq("id", invite.id)

  const isResend = previousSendCount > 0
  await audit(
    `${payload.kind}_invite_email_${isResend ? "resent" : "sent"}`,
    `${inviteLabel}, send ${sendCount} of ${MAX_SENDS_PER_INVITE}${isLocalPreview ? ", local preview (not delivered)" : ""}${providerMessageId ? `, provider id ${providerMessageId}` : ""}`,
  )

  return json(200, {
    ok: true,
    sentAt,
    sendCount,
    resend: isResend,
    recipientEmail,
    ...(isLocalPreview ? { preview: true, actionLink: claimLink } : {}),
  })
  }

  if (single) return sendOne(single)

  const results: Array<Record<string, unknown>> = []
  for (const inviteId of batch!.inviteIds) {
    let body: Record<string, unknown> | null = null
    try {
      const response = await sendOne({ kind, inviteId })
      body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    } catch {
      // One invite going wrong must not hide what happened to the ones before it.
      body = null
    }
    results.push(body ? { inviteId, ...body } : { inviteId, ok: false, code: "provider_failure", error: "The invite email could not be sent. Try again." })
  }
  const sent = results.filter((result) => result.ok === true).length
  return json(200, { ok: true, batch: true, sent, failed: results.length - sent, results })
}
