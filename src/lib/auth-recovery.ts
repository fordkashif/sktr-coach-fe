import { getBackendMode } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { resolveSessionActor } from "@/lib/supabase/actor"
import { setSessionCookies } from "@/lib/auth-session"
import {
  createMockPasswordResetToken,
  completeMockPasswordReset,
  getMockPasswordResetEmail,
  getMockCredentialByEmail,
  MOCK_COACH_TEAM_STORAGE_KEY,
  MOCK_ROLE_STORAGE_KEY,
  MOCK_USER_EMAIL_STORAGE_KEY,
} from "@/lib/mock-auth"

export async function requestPasswordReset(email: string) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) {
    return { ok: false as const, message: "Email is required." }
  }

  if (getBackendMode() !== "supabase") {
    const token = createMockPasswordResetToken(normalizedEmail)
    return {
      ok: true as const,
      mode: "mock" as const,
      message: "If that account exists, the reset flow is ready.",
      actionLink: token ? `/reset-password?mock_token=${encodeURIComponent(token)}` : null,
    }
  }

  const supabase = getBrowserSupabaseClient()
  if (!supabase) {
    return { ok: false as const, message: "Supabase client is not configured." }
  }

  const isLocalOrigin =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")

  if (isLocalOrigin) {
    const { data, error } = await supabase.functions.invoke("local-preview-password-reset", {
      body: {
        email: normalizedEmail,
        appBaseUrl: window.location.origin,
      },
    })

    if (error) {
      const contextualMessage =
        typeof (error as { context?: { json?: { error?: string } } }).context?.json?.error === "string"
          ? (error as { context?: { json?: { error?: string } } }).context!.json!.error!
          : error.message
      return { ok: false as const, message: contextualMessage }
    }

    const response = (data ?? {}) as { actionLink?: string; error?: string }
    if (response.error) return { ok: false as const, message: response.error }
    if (!response.actionLink) {
      return { ok: false as const, message: "Local reset preview did not return an action link." }
    }

    return {
      ok: true as const,
      mode: "supabase" as const,
      message: "Local dev generated a reset link instead of sending email.",
      actionLink: response.actionLink,
    }
  }

  const redirectTo = `${window.location.origin}/reset-password`
  const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo })

  if (error) {
    return { ok: false as const, message: error.message }
  }

  return {
    ok: true as const,
    mode: "supabase" as const,
    message: "If that account exists, a reset link has been sent.",
    actionLink: null,
  }
}

export async function bootstrapPasswordReset(params: { code: string | null; tokenHash: string | null; type: string | null }) {
  if (getBackendMode() !== "supabase") {
    const email = getMockPasswordResetEmail(params.tokenHash ?? params.code ?? "")
    if (!email) {
      return { ok: false as const, message: "Reset link is invalid or expired." }
    }

    return {
      ok: true as const,
      mode: "mock" as const,
      email,
      actorRole: getMockCredentialByEmail(email)?.role ?? null,
    }
  }

  const supabase = getBrowserSupabaseClient()
  if (!supabase) {
    return { ok: false as const, message: "Supabase client is not configured." }
  }

  if (params.code) {
    const exchangeResult = await supabase.auth.exchangeCodeForSession(params.code)
    if (exchangeResult.error) {
      return { ok: false as const, message: exchangeResult.error.message }
    }
  } else if (params.tokenHash && params.type) {
    const verifyResult = await supabase.auth.verifyOtp({
      token_hash: params.tokenHash,
      type: params.type as "recovery" | "magiclink" | "invite",
    })
    if (verifyResult.error) {
      return { ok: false as const, message: verifyResult.error.message }
    }
  }

  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) {
    return { ok: false as const, message: "Reset session was not established. Open the latest reset link again." }
  }

  const actor = await resolveSessionActor(supabase, session)
  return {
    ok: true as const,
    mode: "supabase" as const,
    email: session.user.email ?? "",
    actorRole: actor?.role ?? null,
  }
}

export async function completePasswordReset(params: { password: string; token?: string | null }) {
  const password = params.password.trim()
  if (password.length < 8) {
    return { ok: false as const, message: "Password must be at least 8 characters." }
  }

  if (getBackendMode() !== "supabase") {
    const result = completeMockPasswordReset(params.token ?? "", password)
    if (!result.ok) {
      return { ok: false as const, message: result.message }
    }

    const account = getMockCredentialByEmail(result.email)
    if (!account) {
      return { ok: false as const, message: "Mock account no longer exists." }
    }

    window.localStorage.setItem(MOCK_ROLE_STORAGE_KEY, account.role)
    window.localStorage.setItem(MOCK_USER_EMAIL_STORAGE_KEY, account.email)
    if (account.role === "coach" && account.defaultTeamId) {
      window.localStorage.setItem(MOCK_COACH_TEAM_STORAGE_KEY, account.defaultTeamId)
    } else {
      window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
    }

    setSessionCookies(
      account.role,
      account.tenantId,
      account.email,
      account.role === "coach" ? account.defaultTeamId : undefined,
    )

    return {
      ok: true as const,
      mode: "mock" as const,
      email: result.email,
      actorRole: result.role,
      redirectTo: account.redirectTo,
    }
  }

  const supabase = getBrowserSupabaseClient()
  if (!supabase) {
    return { ok: false as const, message: "Supabase client is not configured." }
  }

  const updateResult = await supabase.auth.updateUser({ password })
  if (updateResult.error || !updateResult.data.user) {
    return { ok: false as const, message: updateResult.error?.message ?? "Password update failed." }
  }

  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) {
    return { ok: false as const, message: "Password updated, but the recovery session is missing." }
  }

  const actor = await resolveSessionActor(supabase, session)
  const email = session.user.email ?? ""

  if (actor) {
    setSessionCookies(
      actor.role,
      actor.tenantId ?? "platform",
      email,
      undefined,
    )
  }

  return {
    ok: true as const,
    mode: "supabase" as const,
    email,
    actorRole: actor?.role ?? null,
    redirectTo:
      actor?.role === "athlete"
        ? "/athlete/home"
        : actor?.role === "coach"
          ? "/coach/dashboard"
          : actor?.role === "platform-admin"
            ? "/platform-admin/dashboard"
            : "/club-admin/dashboard",
  }
}
