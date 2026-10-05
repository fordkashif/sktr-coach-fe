import { createContext, useContext, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react"
import { Link, type LinkProps } from "react-router-dom"
import { cn } from "@/lib/utils"

/**
 * primary: the one main action of the screen, solid blue. One per screen.
 * secondary: outlined. quiet: text only, for links and cancel. danger: outlined coral text, for destructive actions.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger"
export type ButtonSize = "sm" | "md" | "lg"

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "sk-btn-primary",
  secondary: "sk-btn-secondary",
  quiet: "sk-btn-text",
  danger: "sk-btn-danger",
}

function buttonClass(variant: ButtonVariant, size: ButtonSize, block: boolean | undefined, className: string | undefined) {
  return cn("sk-btn", VARIANT_CLASS[variant], size === "sm" && "sk-btn-sm", size === "lg" && "sk-btn-lg", block && "sk-btn-block", className)
}

type ButtonOwnProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Full width. */
  block?: boolean
}

/** Button: an action on this screen. Text says what happens ("Save plan"), an icon goes before the text. */
export function Button({ variant = "secondary", size = "md", block, className, type = "button", ...props }: ButtonOwnProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={buttonClass(variant, size, block, className)} {...props} />
}

/** LinkButton: the same looks for navigation. Use it whenever pressing goes to another screen. */
export function LinkButton({ variant = "secondary", size = "md", block, className, ...props }: ButtonOwnProps & LinkProps) {
  return <Link className={buttonClass(variant, size, block, className)} {...props} />
}

/** OnColorButton: the white button inside a HeroBlock. Pass `to` for a link. */
export function HeroAction({ to, onClick, children }: { to?: string; onClick?: () => void; children: ReactNode }) {
  const className = "sk-btn sk-btn-on-color sk-btn-lg sk-btn-block"
  return to ? (
    <Link to={to} className={className}>
      {children}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  )
}

const FieldContext = createContext<{ id: string; describedBy?: string; invalid: boolean } | null>(null)

/**
 * Field: label, control, then a hint or an error. Wrap exactly one Input, Textarea or Select;
 * ids and aria wiring are handled for you.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: string
  hint?: ReactNode
  error?: ReactNode
  /** Adds "(optional)" after the label. */
  optional?: boolean
  children: ReactNode
  className?: string
}) {
  const id = useId()
  const messageId = `${id}-message`
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="sk-field-label">
        {label}
        {optional ? <span className="font-normal text-sk-mute"> (optional)</span> : null}
      </label>
      <FieldContext.Provider value={{ id, describedBy: hint || error ? messageId : undefined, invalid: Boolean(error) }}>{children}</FieldContext.Provider>
      {error ? (
        <p id={messageId} className="sk-field-error">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="sk-field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function useFieldProps() {
  const field = useContext(FieldContext)
  return field ? { id: field.id, "aria-describedby": field.describedBy, "aria-invalid": field.invalid || undefined } : {}
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...useFieldProps()} className={cn("sk-field", className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...useFieldProps()} className={cn("sk-field", className)} {...props} />
}

/** Select: the native select, styled. Use it for short fixed lists. */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...useFieldProps()} className={cn("sk-field", className)} {...props} />
}

/** Segmented: switch between two to four views of the same thing. Short labels. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  label,
}: {
  value: T
  onChange: (next: T) => void
  options: Array<{ value: T; label: ReactNode }>
  className?: string
  label?: string
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("sk-seg", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          data-active={option.value === value}
          className="sk-seg-item"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Tabs: sections of one screen, underlined. Use when there are more than four or the labels are long; otherwise Segmented. */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
  className,
  label,
}: {
  value: T
  onChange: (next: T) => void
  options: Array<{ value: T; label: ReactNode; count?: number }>
  className?: string
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("sk-tabs", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          data-active={option.value === value}
          className="sk-tab"
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined ? <span className="ml-1.5 font-semibold text-sk-mute">{option.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/**
 * InlineConfirm: asks "are you sure" in place, where the button was. Use it instead of a dialog for
 * destructive actions on a row or a form (remove, archive, cancel an invite).
 */
export function InlineConfirm({
  question,
  confirmLabel,
  cancelLabel = "Keep it",
  onConfirm,
  onCancel,
  busy = false,
  className,
}: {
  question: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  className?: string
}) {
  return (
    <div role="group" aria-label="Confirm" className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-sk-line py-3", className)}>
      <p className="min-w-0 flex-1 basis-56 text-[0.9375rem] font-semibold text-sk-ink">{question}</p>
      <div className="flex shrink-0 gap-2">
        <Button variant="quiet" size="sm" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <button type="button" className="sk-btn sk-btn-danger-solid sk-btn-sm" onClick={onConfirm} disabled={busy}>
          {busy ? "Working..." : confirmLabel}
        </button>
      </div>
    </div>
  )
}
