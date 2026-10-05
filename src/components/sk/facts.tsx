import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** FactList: read-only details as label and value rows with hairlines (a profile, an invite). Children are Fact. */
export function FactList({ children, className, ...rest }: { children: ReactNode; className?: string; "aria-label"?: string }) {
  return (
    <dl className={cn("flex flex-col", className)} {...rest}>
      {children}
    </dl>
  )
}

/**
 * Fact: one detail. The label is on the left in grey and the value on the right in ink. A value that
 * is not there yet is passed as `empty` ("Not added yet") and shows in grey. `stack` puts a long
 * value (a note) under its label instead of beside it.
 */
export function Fact({ label, children, empty, stack = false }: { label: string; children?: ReactNode; empty?: string; stack?: boolean }) {
  const missing = children === null || children === undefined || children === ""
  return (
    <div className={cn("flex min-h-12 gap-x-4 gap-y-0.5 border-b border-sk-line py-3 last:border-b-0", stack ? "flex-col" : "items-baseline justify-between")}>
      <dt className="shrink-0 text-[0.9375rem] text-sk-mute">{label}</dt>
      <dd className={cn("min-w-0 break-words text-[0.9375rem]", !stack && "text-right", missing ? "text-sk-mute" : "font-semibold text-sk-ink", stack && "whitespace-pre-wrap")}>
        {missing ? (empty ?? "Not added") : children}
      </dd>
    </div>
  )
}
