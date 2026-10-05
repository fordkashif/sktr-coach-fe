import { Eye, EyeSlash } from "@phosphor-icons/react"
import { useState, type InputHTMLAttributes } from "react"
import { cn } from "@/lib/utils"
import { Input } from "./controls"

/**
 * PasswordInput: an Input for a password with a "Show" / "Hide" button inside it on the right.
 * Wrap it in a Field like any Input. Pass `shown` and `onShownChange` when two fields (new password
 * and confirm) should show and hide together; otherwise it keeps its own state.
 */
export function PasswordInput({
  shown,
  onShownChange,
  className,
  ...props
}: { shown?: boolean; onShownChange?: (next: boolean) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [ownShown, setOwnShown] = useState(false)
  const isShown = shown ?? ownShown
  const toggle = () => {
    if (onShownChange) onShownChange(!isShown)
    else setOwnShown(!isShown)
  }
  return (
    <span className="relative block">
      <Input type={isShown ? "text" : "password"} className={cn("pr-[5.25rem]", className)} {...props} />
      <button
        type="button"
        aria-pressed={isShown}
        onClick={toggle}
        className="absolute inset-y-0 right-0 inline-flex min-w-11 cursor-pointer items-center gap-1.5 rounded-r-[14px] px-3.5 text-sm font-bold text-sk-ink-2 hover:text-sk-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sk-blue"
      >
        {isShown ? <EyeSlash className="size-4" weight="bold" aria-hidden /> : <Eye className="size-4" weight="bold" aria-hidden />}
        {isShown ? "Hide" : "Show"}
      </button>
    </span>
  )
}
