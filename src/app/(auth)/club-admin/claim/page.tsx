import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { ArrowClockwise, ArrowLeft, ArrowRight } from "@phosphor-icons/react"
import {
  FirstAccessFrame,
  FormError,
  PasswordFields,
  validateNewPassword,
} from "@/components/club-admin/first-access-setup-panel"
import { setClubAdminFirstAccessPassword } from "@/lib/data/club-admin/first-access-data"
import { getClubAdminProfileRecord } from "@/lib/data/club-admin/ops-data"
import { resolveSessionActor } from "@/lib/supabase/actor"
import { getBackendMode, isSupabaseEnabled } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

async function diagnoseClaimFailure(
  supabase: NonNullable<ReturnType<typeof getBrowserSupabaseClient>>,
  userId: string,
  email: string | null,
) {
  if (!email) {
    return "This claim session has no email identity. Open the latest claim link again."
  }

  const normalizedEmail = email.trim().toLowerCase()

  const [profileResult, requestResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("role, tenant_id")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("tenant_provision_requests")
      .select("status, provisioned_tenant_id")
      .eq("requestor_email", normalizedEmail)
      .order("reviewed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (profileResult.error) {
    return `Claim bootstrap could not inspect your profile record: ${profileResult.error.message}`
  }

  if (profileResult.data && profileResult.data.role !== "club-admin") {
    return `This account resolved to role "${profileResult.data.role}", not "club-admin".`
  }

  if (requestResult.error) {
    return `Claim bootstrap could not inspect the approved request record: ${requestResult.error.message}`
  }

  if (!requestResult.data) {
    return "No club request was found for this email. A request for this exact email has to be approved first."
  }

  if (requestResult.data.status !== "approved") {
    return `The request for this email is "${requestResult.data.status}", not "approved".`
  }

  if (!requestResult.data.provisioned_tenant_id) {
    return "The request was approved, but the club workspace has not been created yet."
  }

  return "The claim session exists, but the club admin profile did not finish setting up."
}

async function getCurrentClubAdminActivationState(
  supabase: NonNullable<ReturnType<typeof getBrowserSupabaseClient>>,
) {
  const result = await supabase.rpc("get_current_club_admin_activation_state")
  if (result.error) return null
  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as { lifecycle_status: string | null } | null
  return row?.lifecycle_status ?? null
}

/** Where a claimed admin belongs next, given what is already saved. */
function nextRouteAfterPassword(lifecycleStatus: string | null, onboardingCompleted: boolean) {
  if (lifecycleStatus === "approved_pending_billing" || lifecycleStatus === "billing_failed") return "/club-admin/setup/billing"
  if (!onboardingCompleted) return "/club-admin/get-started"
  return "/club-admin/dashboard"
}

export default function ClubAdminClaimPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isSupabaseMode = getBackendMode() === "supabase"
  const tokenHash = searchParams.get("token_hash")
  const tokenType = searchParams.get("type")
  const [email, setEmail] = useState<string | null>(isSupabaseMode ? null : searchParams.get("email"))
  const [clubName, setClubName] = useState<string | null>(null)
  const [lifecycleStatus, setLifecycleStatus] = useState<string | null>(null)
  const [onboardingCompleted, setOnboardingCompleted] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(isSupabaseMode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    // Mock mode has no claim tokens. The page still walks through the same step.
    if (!isSupabaseMode) return
    if (!isSupabaseEnabled()) {
      setError("Supabase mode is enabled but URL/key are missing in environment.")
      setLoading(false)
      return
    }

    const supabase = getBrowserSupabaseClient()
    if (!supabase) {
      setError("Supabase client failed to initialize.")
      setLoading(false)
      return
    }

    let cancelled = false

    const bootstrapClaim = async () => {
      setLoading(true)

      let verifyError: string | null = null
      if (tokenHash && tokenType) {
        const verifyResult = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: tokenType as "magiclink" | "invite",
        })
        if (cancelled) return
        // Claim links work once. If this one was already used on this device the
        // session from that first visit is still valid, so carry on with it.
        verifyError = verifyResult.error?.message ?? null
      }

      const { data } = await supabase.auth.getSession()
      const session = data.session
      if (cancelled) return
      if (!session) {
        setError(
          verifyError
            ? `${verifyError}. Claim links only work once. If you already set a password, sign in with it. If not, ask for a new claim link.`
            : "No first access session found. Open the latest claim link from your email again.",
        )
        setLoading(false)
        return
      }

      const actor = await resolveSessionActor(supabase, session)
      if (cancelled) return
      if (!actor || actor.role !== "club-admin") {
        const diagnosis = await diagnoseClaimFailure(supabase, session.user.id, session.user.email ?? null)
        if (cancelled) return
        setError(diagnosis)
        setLoading(false)
        return
      }

      const profileResult = await getClubAdminProfileRecord()
      if (cancelled) return
      if (!profileResult.ok) {
        setError(profileResult.error.message)
        setLoading(false)
        return
      }

      const lifecycle = await getCurrentClubAdminActivationState(supabase)
      if (cancelled) return

      const completed = Boolean(profileResult.data.onboardingCompletedAt)
      if (profileResult.data.passwordSetAt) {
        navigate(nextRouteAfterPassword(lifecycle, completed), { replace: true })
        return
      }

      setEmail(session.user.email ?? null)
      setClubName(profileResult.data.clubName || null)
      setLifecycleStatus(lifecycle)
      setOnboardingCompleted(completed)
      setError(null)
      setLoading(false)
    }

    void bootstrapClaim()

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode, navigate, tokenHash, tokenType])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const invalid = validateNewPassword(password, confirmPassword)
    if (invalid) {
      setFormError(invalid)
      return
    }

    if (!isSupabaseMode) {
      setFormError(null)
      navigate("/club-admin/setup/billing", { replace: true })
      return
    }

    setSaving(true)
    const result = await setClubAdminFirstAccessPassword(password)
    setSaving(false)

    if (!result.ok) {
      setFormError(result.error.message)
      return
    }

    setFormError(null)
    navigate(nextRouteAfterPassword(lifecycleStatus, onboardingCompleted), { replace: true })
  }

  if (loading) {
    return (
      <FirstAccessFrame brand title="Opening your claim link" lede="Checking your link and finding your club.">
        <p className="text-sm font-semibold text-sk-mute" role="status">
          Loading...
        </p>
      </FirstAccessFrame>
    )
  }

  if (error) {
    return (
      <FirstAccessFrame
        brand
        title="This claim link could not be opened"
        lede="Nothing has been changed on your account."
      >
        <section className="sk-card space-y-5">
          <FormError>
            <p>{error}</p>
            <p className="font-normal text-sk-ink-2">
              Claim links are sent once your club request is approved, and each link works one time.
            </p>
          </FormError>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="sk-btn sk-btn-primary" onClick={() => window.location.reload()}>
              <ArrowClockwise className="size-5" weight="bold" />
              Try again
            </button>
            <Link to="/login" className="sk-btn sk-btn-quiet">
              <ArrowLeft className="size-5" weight="bold" />
              Back to login
            </Link>
          </div>
        </section>
      </FirstAccessFrame>
    )
  }

  return (
    <FirstAccessFrame
      brand
      step="password"
      title={clubName ? `Welcome to ${clubName}` : "Claim your club"}
      lede="Your club request was approved. Set a password first, so you can always get back in. Then we will walk you through the rest."
    >
      <form className="sk-card grid gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <h2 className="sk-h2">Set your password</h2>
        {email ? (
          <p className="-mt-2 text-sm leading-relaxed text-sk-mute">
            You will sign in as <span className="break-all font-bold text-sk-ink">{email}</span>.
          </p>
        ) : null}
        <PasswordFields
          email={email}
          password={password}
          confirmPassword={confirmPassword}
          onPasswordChange={setPassword}
          onConfirmPasswordChange={setConfirmPassword}
        />
        <FormError>{formError}</FormError>
        <div>
          <button type="submit" disabled={saving} className="sk-btn sk-btn-primary w-full sm:w-auto">
            {saving ? "Saving password..." : "Save password and continue"}
            {saving ? null : <ArrowRight className="size-5" weight="bold" />}
          </button>
        </div>
      </form>
    </FirstAccessFrame>
  )
}
