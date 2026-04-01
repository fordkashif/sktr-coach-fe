import { getBackendMode } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { resolveSessionActor } from "@/lib/supabase/actor"
import { clearSessionCookies, setSessionCookies } from "@/lib/auth-session"
import {
  createMockPasswordResetToken,
  completeMockPasswordReset,
  getMockPasswordResetEmail,
  getMockCredentialByEmail,
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

    clearSessionCookies()
    return {
      ok: true as const,
      mode: "mock" as const,
      email: result.email,
      actorRole: result.role,
      redirectTo: "/login",
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
