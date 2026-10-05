import { useState, type ReactNode } from "react"
import { Field, PasswordInput, Screen, ScreenHeader, StepIndicator } from "@/components/sk"
import { PublicFrame } from "@/layouts/auth-layout"

/**
 * Shared frame for the club admin first access journey:
 * claim (password) -> setup/billing (plan) -> get-started (club, team, coach, finish).
 * One column, one step indicator, one primary action per step.
 */

export const FIRST_ACCESS_STEPS = [
  { id: "password", label: "Password" },
  { id: "plan", label: "Plan" },
  { id: "club", label: "Club details" },
  { id: "team", label: "First team" },
  { id: "coach", label: "First coach" },
  { id: "finish", label: "Finish" },
] as const

export type FirstAccessStepId = (typeof FIRST_ACCESS_STEPS)[number]["id"]

const STEPS = FIRST_ACCESS_STEPS.map((step) => ({ id: step.id as string, label: step.label as string }))

export function FirstAccessFrame({
  step,
  title,
  lede,
  outside = false,
  children,
}: {
  /** Leave out on a loading or error screen: no step is shown then. */
  step?: FirstAccessStepId
  title: ReactNode
  lede?: ReactNode
  /** The page is outside the app shell (the claim link): it gets the public frame with the brand and the footer. */
  outside?: boolean
  children: ReactNode
}) {
  const index = step ? FIRST_ACCESS_STEPS.findIndex((item) => item.id === step) : -1
  const body = (
    <>
      <ScreenHeader fact={index >= 0 ? `Step ${index + 1} of ${FIRST_ACCESS_STEPS.length}: ${FIRST_ACCESS_STEPS[index].label}` : undefined} title={title} lede={lede} />
      {step ? <StepIndicator steps={STEPS} current={step} label="Club setup progress" /> : null}
      {children}
    </>
  )
  if (outside) return <PublicFrame>{body}</PublicFrame>
  return (
    <Screen width="narrow">
      {/* The shell shows the brand in the phone app bar; on desktop it shows no bar during setup. */}
      <p className="text-lg font-extrabold tracking-[-0.03em] text-sk-blue max-lg:hidden">SKTR Coach</p>
      {body}
    </Screen>
  )
}

export function PasswordFields({
  email,
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
}: {
  /** The account email, so password managers save the right login. */
  email?: string | null
  password: string
  confirmPassword: string
  onPasswordChange: (value: string) => void
  onConfirmPasswordChange: (value: string) => void
}) {
  const [shown, setShown] = useState(false)
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword
  return (
    <>
      {email ? <input type="email" name="username" autoComplete="username" value={email} readOnly hidden /> : null}
      <Field label="New password" hint="At least 8 characters.">
        <PasswordInput name="new-password" autoComplete="new-password" minLength={8} required shown={shown} onShownChange={setShown} value={password} onChange={(event) => onPasswordChange(event.target.value)} />
      </Field>
      <Field label="Confirm password" error={mismatch ? "These do not match yet." : undefined}>
        <PasswordInput
          name="confirm-password"
          autoComplete="new-password"
          required
          shown={shown}
          onShownChange={setShown}
          value={confirmPassword}
          onChange={(event) => onConfirmPasswordChange(event.target.value)}
        />
      </Field>
    </>
  )
}

export function validateNewPassword(password: string, confirmPassword: string) {
  if (password.length < 8) return "Password must be at least 8 characters."
  if (password !== confirmPassword) return "Passwords do not match."
  return null
}
