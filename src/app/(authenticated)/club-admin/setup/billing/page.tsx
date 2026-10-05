import { useEffect, useId, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, CheckCircle, ShieldCheck } from "@phosphor-icons/react"
import { Field, FirstAccessFrame, FormError } from "@/components/club-admin/first-access-setup-panel"
import { Panel, Tag } from "@/components/sk"
import { getPackageById, packageOptions, type PackageDefinition } from "@/lib/billing/package-catalog"
import {
  completeCurrentClubAdminMockBillingSetup,
  getCurrentClubAdminActivationState,
  type ClubAdminActivationState,
} from "@/lib/data/club-admin/ops-data"
import { getBackendMode } from "@/lib/supabase/config"
import { cn } from "@/lib/utils"
import { loadProfileSafe } from "../../state"
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support"

function limit(value: number, singular: string, plural: string) {
  if (!Number.isFinite(value)) return `Unlimited ${plural}`
  return `${value} ${value === 1 ? singular : plural}`
}

function packageLimits(definition: PackageDefinition) {
  const { teams, coaches, athletes } = definition.limits
  if (![teams, coaches, athletes].some(Number.isFinite)) return "Unlimited teams, coaches and athletes"
  return [
    limit(definition.limits.teams, "team", "teams"),
    limit(definition.limits.coaches, "coach", "coaches"),
    limit(definition.limits.athletes, "athlete", "athletes"),
  ].join(", ")
}

/** Mock mode has no activation record. This lets the step be walked through locally. */
function buildMockActivationState(): ClubAdminActivationState {
  return {
    tenantId: "mock-tenant",
    lifecycleStatus: "approved_pending_billing",
    billingStatus: "pending",
    billingProvider: null,
    billingContactName: null,
    billingContactEmail: null,
    billingCycle: "monthly",
    requestedPlan: "pro",
    organizationName: loadProfileSafe().clubName || null,
    onboardingStep: "club_profile",
  }
}

export default function ClubAdminBillingSetupPage() {
  const navigate = useNavigate()
  const formId = useId()
  const isSupabaseMode = getBackendMode() === "supabase"
  const [loading, setLoading] = useState(isSupabaseMode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activationState, setActivationState] = useState<ClubAdminActivationState | null>(() =>
    isSupabaseMode ? null : buildMockActivationState(),
  )
  const [billingContactName, setBillingContactName] = useState("")
  const [billingContactEmail, setBillingContactEmail] = useState("")
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly")

  useEffect(() => {
    if (!isSupabaseMode) return

    let cancelled = false
    const load = async () => {
      setLoading(true)
      const result = await getCurrentClubAdminActivationState()
      if (cancelled) return
      if (!result.ok) {
        setError(result.error.message)
        setLoading(false)
        return
      }

      if (result.data.lifecycleStatus !== "approved_pending_billing" && result.data.lifecycleStatus !== "billing_failed") {
        navigate("/club-admin/get-started", { replace: true })
        return
      }

      setActivationState(result.data)
      setBillingContactName(result.data.billingContactName ?? "")
      setBillingContactEmail(result.data.billingContactEmail ?? "")
      setBillingCycle(result.data.billingCycle ?? "monthly")
      setError(null)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode, navigate])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!billingContactName.trim()) {
      setError("Add the name of your billing contact.")
      return
    }
    const email = billingContactEmail.trim()
    if (!email) {
      setError("Add an email for your billing contact.")
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("That billing email does not look right. Check it and try again.")
      return
    }

    if (!isSupabaseMode) {
      setError(null)
      navigate("/club-admin/get-started", { replace: true })
      return
    }

    setSaving(true)
    const result = await completeCurrentClubAdminMockBillingSetup({
      billingContactName,
      billingContactEmail,
      billingCycle,
    })
    setSaving(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }

    setError(null)
    navigate("/club-admin/get-started", { replace: true })
  }

  if (loading) {
    return (
      <FirstAccessFrame step="plan" title="Confirm your plan">
        <p className="text-sm font-semibold text-sk-mute" role="status">
          Loading...
        </p>
      </FirstAccessFrame>
    )
  }

  if (!activationState) {
    return (
      <FirstAccessFrame title="We could not load your plan" lede="Nothing has been changed on your club.">
        <section className="sk-card space-y-5">
          <FormError>{error ?? "No approved club request was found for this account."}</FormError>
          <div>
            <button type="button" className="sk-btn sk-btn-primary" onClick={() => window.location.reload()}>
              Try again
            </button>
          </div>
        </section>
      </FirstAccessFrame>
    )
  }

  const requestedPackage = getPackageById(activationState.requestedPlan)
  const clubName = activationState.organizationName

  return (
    <FirstAccessFrame
      step="plan"
      title="Confirm your plan"
      lede={
        clubName
          ? `This is the plan ${clubName} was approved on. Check it, tell us who to contact about billing, and carry on.`
          : "Check the plan your club was approved on, tell us who to contact about billing, and carry on."
      }
    >
      <div className="flex items-start gap-3 rounded-[20px] bg-sk-green-tint p-4 sm:p-5">
        <ShieldCheck className="mt-0.5 size-6 shrink-0 text-sk-green" weight="fill" aria-hidden />
        <div className="space-y-1">
          <p className="font-bold text-sk-ink">No card needed. Nothing is charged today.</p>
          <p className="text-sm leading-relaxed text-sk-ink-2">
            Online payment is not switched on in SKTR Coach yet. This step only records your plan and your billing contact. You
            cannot be charged until you add payment details yourself, and that is not possible yet.
          </p>
        </div>
      </div>

      {activationState.lifecycleStatus === "billing_failed" ? (
        <FormError tone="notice">
          <p>Your plan was not confirmed last time. Check the details below and confirm again. If it keeps failing, email{" "}
            <a href={SUPPORT_MAILTO} className="font-bold underline underline-offset-2">{SUPPORT_EMAIL}</a>{" "}
            and we will sort it out for you.</p>
        </FormError>
      ) : null}

      <Panel
        title="Your plan"
        hint={
          requestedPackage
            ? "Chosen on your club request. You can ask to change it from Billing once setup is done."
            : "No plan was recorded on your club request. You can ask for one from Billing once setup is done."
        }
      >
        <ul className="-mx-3 space-y-1">
          {packageOptions.map((option) => {
            const selected = option.id === requestedPackage?.id
            return (
              <li
                key={option.id}
                className={cn("flex items-start gap-3 rounded-2xl p-3", selected && "bg-sk-blue-tint")}
              >
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center" aria-hidden>
                  {selected ? (
                    <CheckCircle className="size-6 text-sk-blue" weight="fill" />
                  ) : (
                    <span className="size-4 rounded-full border-2 border-[#cdd2de]" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={cn("sk-h3", !selected && requestedPackage && "text-sk-ink-2")}>{option.label}</p>
                    {selected ? <Tag tone="blue">Your plan</Tag> : null}
                  </div>
                  <p className="mt-0.5 text-sm font-semibold text-sk-ink-2">{packageLimits(option)}</p>
                  <p className="mt-1 text-sm leading-relaxed text-sk-mute">{option.description}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </Panel>

      <form className="sk-card grid gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div>
          <h2 className="sk-h2">Billing contact</h2>
          <p className="mt-1 text-sm text-sk-mute">The person we should talk to about invoices. It can be you.</p>
        </div>
        <Field label="Contact name" htmlFor={`${formId}-name`}>
          <input
            id={`${formId}-name`}
            name="billing-name"
            className="sk-field"
            autoComplete="name"
            required
            value={billingContactName}
            onChange={(event) => setBillingContactName(event.target.value)}
          />
        </Field>
        <Field label="Contact email" htmlFor={`${formId}-email`}>
          <input
            id={`${formId}-email`}
            name="billing-email"
            type="email"
            inputMode="email"
            className="sk-field"
            autoComplete="email"
            required
            value={billingContactEmail}
            onChange={(event) => setBillingContactEmail(event.target.value)}
          />
        </Field>
        <fieldset>
          <legend className="sk-label mb-1.5">How you would like to be billed</legend>
          <div className="sk-seg">
            {(["monthly", "annual"] as const).map((cycle) => (
              <label key={cycle} className="sk-seg-item cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-sk-blue" data-active={billingCycle === cycle}>
                <input
                  type="radio"
                  name="billing-cycle"
                  value={cycle}
                  className="sr-only"
                  checked={billingCycle === cycle}
                  onChange={() => setBillingCycle(cycle)}
                />
                {cycle === "monthly" ? "Monthly" : "Annually"}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-sm text-sk-mute">A preference for later. It does not start a charge.</p>
        </fieldset>
        <FormError>{error}</FormError>
        <div>
          <button type="submit" disabled={saving} className="sk-btn sk-btn-primary w-full sm:w-auto">
            {saving ? "Confirming..." : "Confirm plan and continue"}
            {saving ? null : <ArrowRight className="size-5" weight="bold" />}
          </button>
        </div>
      </form>
    </FirstAccessFrame>
  )
}
