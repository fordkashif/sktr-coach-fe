import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn("block", className)}>
      <span className="sk-label mb-1.5 block">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-sm text-sk-mute">{hint}</span> : null}
    </label>
  )
}

export function ErrorNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]", className)}>
      {children}
    </p>
  )
}

/** Action bar that stays at the bottom of the screen while the page scrolls. */
export function StickyBar({ status, children }: { status?: ReactNode; children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 -mb-10 border-t border-sk-line bg-white px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-10 lg:mt-auto lg:px-10">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p aria-live="polite" className="text-sm font-semibold text-sk-mute empty:hidden">
          {status}
        </p>
        <div className="flex items-center gap-2 sm:ml-auto [&>*]:flex-1 sm:[&>*]:flex-none">{children}</div>
      </div>
    </div>
  )
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

/** Page frame for screens that end in a StickyBar: the bar sits at the bottom even when the page is short. */
export const STICKY_PAGE = "sk-page lg:flex lg:min-h-dvh lg:flex-col"
