import { useId, type ReactNode } from "react"
import { Check, WarningCircle } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

/**
 * Shared frame for the club admin first access journey:
 * claim (password) -> setup/billing (plan) -> get-started (club, team, coach, finish).
 * One column, one numbered step indicator, one primary action per step.
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

export function FirstAccessStepIndicator({ current }: { current: FirstAccessStepId }) {
  const currentIndex = FIRST_ACCESS_STEPS.findIndex((step) => step.id === current)
  return (
    <nav aria-label="Setup progress">
      <ol className="flex items-center">
        {FIRST_ACCESS_STEPS.map((step, index) => {
          const done = index < currentIndex
          const active = index === currentIndex
          return (
            <li
              key={step.id}
              aria-current={active ? "step" : undefined}
              className={cn("flex items-center", index > 0 && "flex-1")}
            >
              {index > 0 ? <span aria-hidden className={cn("mx-1.5 h-0.5 flex-1 rounded-full sm:mx-2", done || active ? "bg-sk-blue" : "bg-sk-line")} /> : null}
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold",
                  done && "bg-sk-blue-tint text-[#1638b8]",
                  active && "bg-sk-blue text-white",
                  !done && !active && "border border-sk-line bg-white text-sk-mute",
                )}
              >
                {done ? <Check className="size-4" weight="bold" aria-hidden /> : index + 1}
                <span className="sr-only">
                  {step.label}
                  {done ? ", done" : active ? ", current step" : ""}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-sm font-semibold text-sk-mute">
        Step {currentIndex + 1} of {FIRST_ACCESS_STEPS.length}: <span className="text-sk-ink">{FIRST_ACCESS_STEPS[currentIndex]?.label}</span>
      </p>
    </nav>
  )
}

export function FirstAccessFrame({
  step,
  title,
  lede,
  brand = false,
  children,
}: {
  step?: FirstAccessStepId
  title: ReactNode
  lede?: ReactNode
  /** Show the SKTR Coach wordmark. Use on pages outside the app shell. */
  brand?: boolean
  children: ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-6 px-4 pb-12 pt-6 sm:px-6 sm:pt-10">
      {brand ? <p className="text-lg font-extrabold tracking-[-0.03em] text-sk-blue">SKTR Coach</p> : null}
      {step ? <FirstAccessStepIndicator current={step} /> : null}
      <header className="space-y-3">
        <h1 className="text-[2rem] font-extrabold leading-[1] tracking-[-0.04em] text-sk-ink sm:text-[2.5rem]">{title}</h1>
        {lede ? <p className="sk-lede">{lede}</p> : null}
      </header>
      {children}
    </div>
  )
}

export function FormError({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "notice" }) {
  if (!children) return null
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-2xl p-4 text-sm font-semibold", tone === "error" ? "bg-sk-coral-tint text-[#b32a0c]" : "bg-sk-yellow-tint text-[#7a5600]")}
    >
      <WarningCircle className="mt-0.5 size-5 shrink-0" weight="fill" aria-hidden />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  )
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string
  hint?: ReactNode
  htmlFor: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="sk-label mb-1.5 block">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-sm text-sk-mute">
          {hint}
        </p>
      ) : null}
    </div>
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
  const id = useId()
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword
  return (
    <>
      {email ? <input type="email" name="username" autoComplete="username" value={email} readOnly hidden /> : null}
      <Field label="New password" htmlFor={`${id}-password`} hint="At least 8 characters.">
        <input
          id={`${id}-password`}
          name="new-password"
          type="password"
          className="sk-field"
          autoComplete="new-password"
          aria-describedby={`${id}-password-hint`}
          minLength={8}
          required
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
      </Field>
      <Field label="Confirm password" htmlFor={`${id}-confirm`} hint={mismatch ? <span className="font-semibold text-[#b32a0c]">These do not match yet.</span> : undefined}>
        <input
          id={`${id}-confirm`}
          name="confirm-password"
          type="password"
          className="sk-field"
          autoComplete="new-password"
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? `${id}-confirm-hint` : undefined}
          required
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
