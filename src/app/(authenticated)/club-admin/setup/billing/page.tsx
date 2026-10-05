import { useEffect, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight } from "@phosphor-icons/react"
import { FirstAccessFrame } from "@/components/club-admin/first-access-setup-panel"
import { Button, Choices, Fact, FactList, Field, Input, Notice, Section, SkeletonRows } from "@/components/sk"
import { getPackageById } from "@/lib/billing/package-catalog"
import {
  completeCurrentClubAdminMockBillingSetup,
  getCurrentClubAdminActivationState,
  type ClubAdminActivationState,
} from "@/lib/data/club-admin/ops-data"
import { getBackendMode } from "@/lib/supabase/config"
import { loadProfileSafe } from "../../state"
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support"

function limit(value: number, singular: string, plural: string) {
  if (!Number.isFinite(value)) return `Unlimited ${plural}`
  return `${value} ${value === 1 ? singular : plural}`
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
        <SkeletonRows rows={4} label="Loading your plan" />
      </FirstAccessFrame>
    )
  }

  if (!activationState) {
    return (
      <FirstAccessFrame title="We could not load your plan" lede="Nothing has been changed on your club.">
        <Notice tone="error">{error ?? "No approved club request was found for this account."}</Notice>
        <div>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
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
      <Notice tone="success">
        No card needed. Nothing is charged today.
        <span className="mt-0.5 block font-normal">
          Online payment is not switched on in SKTR Coach yet. This step only records your plan and your billing contact. You cannot be charged until you add payment details yourself, and that is
          not possible yet.
        </span>
      </Notice>

      {activationState.lifecycleStatus === "billing_failed" ? (
        <Notice tone="warning">
          Your plan was not confirmed last time
          <span className="mt-0.5 block font-normal">
            Check the details below and confirm again. If it keeps failing, email{" "}
            <a href={SUPPORT_MAILTO} className="sk-link">
              {SUPPORT_EMAIL}
            </a>{" "}
            and we will sort it out for you.
          </span>
        </Notice>
      ) : null}

      <Section
        title="Your plan"
        hint={
          requestedPackage
            ? "Chosen on your club request. You can ask to change it from Billing once setup is done."
            : "No plan was recorded on your club request. You can ask for one from Billing once setup is done."
        }
      >
        {requestedPackage ? (
          <FactList aria-label="Your plan">
            <Fact label="Plan">{requestedPackage.label}</Fact>
            <Fact label="Teams">{limit(requestedPackage.limits.teams, "team", "teams")}</Fact>
            <Fact label="Coaches">{limit(requestedPackage.limits.coaches, "coach", "coaches")}</Fact>
            <Fact label="Athletes">{limit(requestedPackage.limits.athletes, "athlete", "athletes")}</Fact>
            <Fact label="What it is for" stack>
              {requestedPackage.description}
            </Fact>
          </FactList>
        ) : (
          <FactList aria-label="Your plan">
            <Fact label="Plan" empty="Not chosen yet" />
          </FactList>
        )}
      </Section>

      <Section title="Billing contact" hint="The person we should talk to about invoices. It can be you.">
        <form className="flex flex-col gap-4 pt-3" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <Field label="Contact name">
            <Input name="billing-name" autoComplete="name" required value={billingContactName} onChange={(event) => setBillingContactName(event.target.value)} />
          </Field>
          <Field label="Contact email">
            <Input name="billing-email" type="email" inputMode="email" autoComplete="email" required value={billingContactEmail} onChange={(event) => setBillingContactEmail(event.target.value)} />
          </Field>
          <Choices
            label="How you would like to be billed"
            hint="A preference for later. It does not start a charge."
            value={billingCycle}
            onChange={setBillingCycle}
            columns={2}
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "annual", label: "Annually" },
            ]}
          />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div>
            <Button type="submit" variant="primary" size="lg" disabled={saving}>
              {saving ? "Confirming..." : "Confirm plan and continue"}
              {saving ? null : <ArrowRight className="size-5" weight="bold" aria-hidden />}
            </Button>
          </div>
        </form>
      </Section>
    </FirstAccessFrame>
  )
}
